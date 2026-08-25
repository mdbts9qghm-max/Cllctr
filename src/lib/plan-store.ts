/**
 * Datenbank-Operationen rund um den Trainingsplan.
 *
 * Trennt die reine Planungslogik (planner.ts, replan.ts) von den Schreibzugriffen.
 * Alles läuft in Transaktionen, damit ein abgebrochener Vorgang keinen halben
 * Plan hinterlässt.
 */

import { db } from './db';
import { addDays, today } from './dates';
import { newId, now } from './ids';
import { generateTrainingPlan, type GeneratedPlan, type PlanInput } from './planner';
import {
  applyRescheduleToSessions,
  proposeReschedule,
  type ReschedulePlan,
  type RescheduleContext,
} from './replan';
import {
  PROGRESSING_TYPES,
  progresses,
  sessionForm,
  type ProgressionLevels,
} from './progression';
import type { ShiftContext } from './shifts';
import type {
  IsoDate,
  Session,
  SessionFeeling,
  SessionLog,
  SessionTypeKey,
  Settings,
} from './types';

/**
 * Der aktuelle Stufenstand je Einheitsart.
 *
 * **Gezählt, nicht fortgeschrieben.** Früher stand hier ein Zähler in den
 * Einstellungen, der beim Neuerzeugen um die erledigten Einheiten erhöht wurde.
 * Der konnte nur hoch: nahm man eine Einheit zurück oder löschte sie, blieb die
 * Stufe oben stehen, weil die Zahl längst in den Einstellungen klebte.
 *
 * Jetzt ergibt sich die Stufe aus dem, was tatsächlich in der Datenbank steht:
 * so viele erledigte Einheiten dieser Art, wie es gibt. Zurücknehmen zählt
 * damit von selbst zurück. `progressionAdjust` ist der Griff daneben — eine
 * bewusste Korrektur nach oben oder unten.
 */
export async function currentProgressionLevels(): Promise<ProgressionLevels> {
  const settings = await db.settings.get('singleton');
  const adjust = settings?.progressionAdjust ?? {};

  const counts: Record<string, number> = {};
  for (const session of await db.sessions.toArray()) {
    if (session.status !== 'done') continue;
    if (!progresses(session.type)) continue;
    // Alte Einheiten kennen die Marke noch nicht; bei ihnen entscheidet die Art.
    if (session.countsForProgression === false) continue;
    counts[session.type] = (counts[session.type] ?? 0) + 1;
  }

  const levels: ProgressionLevels = {};
  for (const type of PROGRESSING_TYPES) {
    const value = (counts[type] ?? 0) + (adjust[type] ?? 0);
    if (value !== 0) levels[type] = Math.max(0, value);
  }
  return levels;
}

/** Setzt die Korrektur so, dass diese Art auf der gewünschten Stufe steht. */
export async function setProgressionLevel(
  type: SessionTypeKey,
  level: number,
): Promise<void> {
  const settings = await db.settings.get('singleton');
  if (!settings) return;

  let done = 0;
  for (const session of await db.sessions.toArray()) {
    if (session.status !== 'done' || session.type !== type) continue;
    if (!progresses(type) || session.countsForProgression === false) continue;
    done++;
  }

  await db.settings.update('singleton', {
    progressionAdjust: { ...(settings.progressionAdjust ?? {}), [type]: Math.max(0, level) - done },
    updatedAt: now(),
  });
  await relevelPlannedProgression();
}

/** Erzeugt einen Plan und schreibt ihn. Ein bestehender aktiver Plan wird ersetzt. */
export async function createAndSavePlan(input: PlanInput): Promise<GeneratedPlan> {
  let plan!: GeneratedPlan;

  // sessionLogs gehört in den Transaktionsbereich, weil das Aufräumen prüft,
  // welche Sessions bereits protokolliert sind — ohne das bricht Dexie ab.
  // settings ebenso: dort steht der fortgeschriebene Stufenstand.
  await db.transaction(
    'rw',
    [db.macrocycles, db.mesocycles, db.microcycles, db.sessions, db.sessionLogs, db.settings],
    async () => {
      // Der Stand ergibt sich aus den erledigten Einheiten — die überleben das
      // Löschen, also muss er nicht vorher gerettet werden.
      const progressionBase = input.progressionBase ?? (await currentProgressionLevels());

      // Protokollierte Einheiten überleben das Löschen. Der neue Plan muss sie
      // kennen, sonst legt er auf denselben Tag noch eine zweite.
      const completed =
        input.completed ??
        (await db.sessions.toArray())
          .filter((s) => s.status === 'done' && s.date >= input.startDate)
          .map((s) => ({ date: s.date, type: s.type }));

      plan = generateTrainingPlan({ ...input, progressionBase, completed });

      await clearActivePlanInternal();
      await db.macrocycles.put(plan.macrocycle);
      await db.mesocycles.bulkPut(plan.mesocycles);
      await db.microcycles.bulkPut(plan.microcycles);
      await db.sessions.bulkPut(plan.sessions);
    },
  );

  return plan;
}



/**
 * Löscht den aktiven Plan samt Sessions.
 *
 * Protokollierte Einheiten bleiben erhalten: ein SessionLog hängt zwar an einer
 * Session-Id, die Aufzeichnung selbst ist aber Verlauf und kein Plan. Sessions
 * mit Log werden deshalb nicht gelöscht, sondern nur aus dem Plan gelöst.
 */
async function clearActivePlanInternal(): Promise<void> {
  const macros = await db.macrocycles.toArray();
  const mesos = await db.mesocycles.toArray();
  const micros = await db.microcycles.toArray();
  const microIds = new Set(micros.map((m) => m.id));

  const loggedSessionIds = new Set((await db.sessionLogs.toArray()).map((l) => l.sessionId));

  const sessions = await db.sessions.toArray();
  const toDelete = sessions
    .filter((s) => microIds.has(s.microcycleId) && !loggedSessionIds.has(s.id))
    .map((s) => s.id);

  await db.sessions.bulkDelete(toDelete);

  // Was bleibt, wird tatsächlich gelöst: sonst zeigte die Einheit weiter auf
  // einen Mikrozyklus, den es nicht mehr gibt.
  const ts = now();
  const detached = sessions
    .filter((s) => microIds.has(s.microcycleId) && loggedSessionIds.has(s.id))
    .map((s) => ({ ...s, microcycleId: '', updatedAt: ts }));
  if (detached.length > 0) await db.sessions.bulkPut(detached);

  await db.microcycles.bulkDelete(micros.map((m) => m.id));
  await db.mesocycles.bulkDelete(mesos.map((m) => m.id));
  await db.macrocycles.bulkDelete(macros.map((m) => m.id));
}

export async function clearActivePlan(): Promise<void> {
  await db.transaction(
    'rw',
    [db.macrocycles, db.mesocycles, db.microcycles, db.sessions, db.sessionLogs],
    clearActivePlanInternal,
  );
}

/** Markiert eine Einheit als erledigt. */
export async function markSessionDone(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { status: 'done', updatedAt: now() });
  await relevelPlannedProgression();
}

export interface QuickLog {
  rpe: number | null;
  durationMin: number | null;
  distanceKm: number | null;
  feeling: SessionFeeling | null;
  note: string;
}

/**
 * Hakt eine Einheit ab und schreibt zugleich das Protokoll.
 *
 * Beides zusammen, weil ein "erledigt" ohne RPE die Information verliert, aus
 * der später die Deload-Erkennung und die Statistiken entstehen. Pro Session
 * gibt es höchstens einen Eintrag — erneutes Abhaken aktualisiert ihn.
 */
export async function logSession(session: Session, entry: QuickLog): Promise<void> {
  const ts = now();

  await db.transaction('rw', [db.sessions, db.sessionLogs], async () => {
    const existing = (await db.sessionLogs.where('sessionId').equals(session.id).toArray())[0];

    const record: SessionLog = {
      id: existing?.id ?? newId('log'),
      sessionId: session.id,
      date: session.date,
      completed: true,
      rpe: entry.rpe,
      durationMin: entry.durationMin ?? session.plannedDurationMin,
      distanceKm: entry.distanceKm,
      avgHr: existing?.avgHr ?? null,
      maxHr: existing?.maxHr ?? null,
      feeling: entry.feeling,
      note: entry.note,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };

    await db.sessionLogs.put(record);
    await db.sessions.update(session.id, { status: 'done', updatedAt: ts });
  });

  // Eine erledigte Einheit erhöht den gezählten Stand — was danach geplant ist,
  // rückt eine Stufe nach.
  await relevelPlannedProgression();
}

/** Das Protokoll zu einer Einheit, falls es eines gibt. */
export async function getSessionLog(sessionId: string): Promise<SessionLog | undefined> {
  return (await db.sessionLogs.where('sessionId').equals(sessionId).toArray())[0];
}

/** Setzt eine Einheit zurück auf geplant. */
export async function resetSessionStatus(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { status: 'planned', updatedAt: now() });
  await relevelPlannedProgression();
}

export async function toggleSessionLock(sessionId: string, locked: boolean): Promise<void> {
  await db.sessions.update(sessionId, { locked, updatedAt: now() });
}

/**
 * Baut den Vorschlag für eine verpasste Einheit. Schreibt noch nichts —
 * so kann der Vorschlag erst angezeigt und bestätigt werden.
 */
export async function buildRescheduleProposal(
  session: Session,
  shiftContext: ShiftContext,
  settings: Settings,
): Promise<ReschedulePlan> {
  const windowEnd = addDays(session.date, Math.max(settings.rescheduleWindowDays, 1) + 1);
  const sessions = await db.sessions
    .where('date')
    .between(addDays(session.date, -2), windowEnd, true, true)
    .toArray();

  const ctx: RescheduleContext = { sessions, shiftContext, settings };
  return proposeReschedule(session, ctx);
}

/** Wendet einen bestätigten Vorschlag an. */
export async function applyRescheduleProposal(plan: ReschedulePlan): Promise<void> {
  const ids = new Set([
    plan.trigger.sessionId,
    ...plan.moves.map((m) => m.sessionId),
    ...plan.drops.map((d) => d.sessionId),
  ]);

  await db.transaction('rw', db.sessions, async () => {
    const affected = await db.sessions.bulkGet([...ids]);
    const present = affected.filter((s): s is Session => Boolean(s));
    const updated = applyRescheduleToSessions(present, plan);
    await db.sessions.bulkPut(updated);
  });

  await relevelPlannedProgression();
}

/**
 * Nummeriert die Stufen der noch geplanten Einheiten neu durch.
 *
 * Nötig, sobald eine Einheit ausfällt: sonst rutscht die nächste desselben Typs
 * um eine Stufe nach oben, obwohl die darunter nie trainiert wurde. Nach einer
 * Krankheitswoche stünde man plötzlich zwei Stufen weiter als je gelaufen —
 * genau das Gegenteil von "die Stufe wird verdient".
 *
 * Was zählt: erledigte Einheiten schieben die Stufe hoch und behalten ihre
 * eigene, denn sie sind Verlauf und werden nicht rückwirkend umgeschrieben.
 * Gestrichene und verpasste zählen nicht. Deload-Einheiten fahren die aktuelle
 * Stufe, ohne sie zu erhöhen — wie beim Erzeugen des Plans.
 */
async function relevelPlannedProgression(): Promise<void> {
  const settings = await db.settings.get('singleton');
  if (!settings) return;

  // Der Startpunkt ist der gezählte Stand: so viele erledigte Einheiten dieser
  // Art, wie es gibt, plus Korrektur. Erledigte behalten ihre eigene Stufe —
  // sie ist Verlauf und beschreibt, was tatsächlich trainiert wurde.
  const levels = await currentProgressionLevels();
  const micros = await db.microcycles.toArray();
  const microById = new Map(micros.map((m) => [m.id, m]));

  const all = (await db.sessions.toArray()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.orderInDay - b.orderInDay,
  );

  const ts = now();
  const updated: Session[] = [];

  for (const type of PROGRESSING_TYPES) {
    let step = levels[type] ?? 0;

    for (const session of all) {
      if (session.type !== type || session.status !== 'planned') continue;
      const isDeload = microById.get(session.microcycleId)?.isDeload ?? false;

      const form = sessionForm(type, settings.hrZones, step, isDeload);
      if (session.progressionStep !== step) {
        updated.push({
          ...session,
          progressionStep: step,
          progressionNote: form.note,
          plannedDurationMin: form.durationMin,
          targetRpe: form.targetRpe,
          countsForProgression: !isDeload,
          content: form.content,
          updatedAt: ts,
        });
      }
      // Deload zählt nicht hoch — dort wird bewusst unter dem Stand trainiert.
      if (!isDeload) step++;
    }
  }

  if (updated.length > 0) await db.sessions.bulkPut(updated);
}

/**
 * Streicht eine Einheit ersatzlos, mit Begründung.
 *
 * Bewusst `skipped` und nicht `missed`: eine gestrichene Einheit ist eine
 * Entscheidung, keine liegengelassene. Nur `missed` bricht die Serie.
 */
export async function cancelSession(sessionId: string, reason: string): Promise<void> {
  await db.sessions.update(sessionId, {
    status: 'skipped',
    rescheduleReason: reason,
    updatedAt: now(),
  });
  await relevelPlannedProgression();
}

/**
 * Streicht alle noch geplanten Einheiten in einem Zeitraum.
 *
 * Der Anlass ist immer derselbe: ein Block, an dem nicht trainiert wird, wurde
 * nachträglich eingetragen. Gibt die Anzahl zurück, damit die Oberfläche sagen
 * kann, was passiert ist.
 */
export async function cancelSessionsInRange(
  from: IsoDate,
  to: IsoDate,
  reason: string,
): Promise<number> {
  const affected = (await db.sessions.toArray()).filter(
    (s) => s.status === 'planned' && s.date >= from && s.date <= to,
  );
  if (affected.length === 0) return 0;

  const ts = now();
  await db.sessions.bulkPut(
    affected.map((s) => ({
      ...s,
      status: 'skipped' as const,
      rescheduleReason: reason,
      updatedAt: ts,
    })),
  );
  await relevelPlannedProgression();
  return affected.length;
}

/**
 * Löscht eine Einheit samt Protokoll und Satzeinträgen.
 *
 * Für versehentlich Protokolliertes und für Reste aus einem ersetzten Plan.
 * Bewusst nur über einen ausdrücklichen Knopf: eine protokollierte Einheit ist
 * Verlauf, und Verlauf verschwindet nicht nebenbei.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction('rw', [db.sessions, db.sessionLogs, db.setEntries], async () => {
    const logs = await db.sessionLogs.where('sessionId').equals(sessionId).toArray();
    for (const log of logs) {
      const entries = await db.setEntries.where('sessionLogId').equals(log.id).toArray();
      if (entries.length > 0) await db.setEntries.bulkDelete(entries.map((e) => e.id));
    }
    if (logs.length > 0) await db.sessionLogs.bulkDelete(logs.map((l) => l.id));
    await db.sessions.delete(sessionId);
  });

  await relevelPlannedProgression();
}

/** Markiert als verpasst, ohne umzuplanen — für den Fall, dass der Vorschlag verworfen wird. */
export async function markSessionMissed(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { status: 'missed', updatedAt: now() });
  await relevelPlannedProgression();
}

/** Die heutige Einheit, falls es eine gibt. */
export async function getTodaySession(): Promise<Session | undefined> {
  const list = await db.sessions.where('date').equals(today()).toArray();
  return list.find((s) => s.status === 'planned') ?? list[0];
}
