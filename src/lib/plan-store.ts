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
import {
  generateTrainingPlan,
  planFingerprint,
  type GeneratedPlan,
  type PlanInput,
} from './planner';
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
import { readinessRange } from './readiness';
import type { ShiftContext } from './shifts';
import type {
  IsoDate,
  Macrocycle,
  Mesocycle,
  Microcycle,
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
  // settings ebenso: dort steht der fortgeschriebene Stufenstand, und
  // readiness, weil der Generator die Erholung der geplanten Tage liest.
  await db.transaction(
    'rw',
    [
      db.macrocycles,
      db.mesocycles,
      db.microcycles,
      db.sessions,
      db.sessionLogs,
      db.settings,
      db.readiness,
    ],
    async () => {
      // Der Stand ergibt sich aus den erledigten Einheiten — die überleben das
      // Löschen, also muss er nicht vorher gerettet werden.
      const progressionBase = input.progressionBase ?? (await currentProgressionLevels());

      // Protokollierte Einheiten überleben das Löschen. Der neue Plan muss sie
      // kennen, sonst legt er auf denselben Tag noch eine zweite.
      const completed =
        input.completed ??
        (await db.sessions.toArray())
          .filter(
            (s) =>
              s.date >= input.startDate &&
              (s.status === 'done' || (s.locked && s.status === 'planned')),
          )
          .map((s) => ({ date: s.date, type: s.type }));

      // Harte Tage vor dem Startdatum: ohne sie könnte direkt hinter zwei
      // harten Tagen ein dritter stehen.
      const history = (await db.sessions.toArray())
        .filter(
          (s) =>
            s.date < input.startDate &&
            s.date >= addDays(input.startDate, -8) &&
            s.status !== 'skipped' &&
            s.status !== 'missed',
        )
        .map((s) => ({ date: s.date, type: s.type }));

      const until = input.until ?? planningHorizon(input.ctx, input.weeks, input.startDate);
      const readiness = input.readiness ?? (await readinessRange(input.startDate, until));

      plan = generateTrainingPlan({
        ...input,
        progressionBase,
        completed,
        history: input.history ?? history,
        readiness,
        until,
      });

      await clearPlanFrom(input.startDate);
      await db.macrocycles.put(plan.macrocycle);
      await db.mesocycles.bulkPut(plan.mesocycles);
      await db.microcycles.bulkPut(plan.microcycles);
      await db.sessions.bulkPut(plan.sessions);
    },
  );

  return plan;
}



/**
 * Bis wann überhaupt geplant werden kann.
 *
 * Mit Rotation reicht der Plan die vollen Wochen weit, weil sich die Folge
 * wiederholt. Ohne Rotation endet er am letzten eingetragenen Schichttag — was
 * danach kommt, weiß niemand, und geraten wird nicht.
 */
export function planningHorizon(ctx: ShiftContext, weeks: number, from: IsoDate): IsoDate {
  const full = addDays(from, Math.max(1, weeks) * 7 - 1);
  if (ctx.pattern && ctx.pattern.sequence.length > 0) return full;
  const dates = ctx.overrides.map((o) => o.date).sort();
  const last = dates[dates.length - 1];
  if (!last) return from;
  return last < full ? last : full;
}

/**
 * Wie viele Kalenderwochen im Voraus geplant werden.
 *
 * Zwölf, damit im Monatsraster immer der laufende und die beiden folgenden
 * Monate stehen. Weiter zu planen brächte nichts: Bis dahin haben sich
 * Schichten und Erholung ohnehin geändert, und der Plan passt sich dann an.
 */
export const PLAN_WEEKS = 12;

/**
 * Passt den Plan an, wenn sich die Grundlage geändert hat.
 *
 * Der Nutzer soll nicht daran denken müssen, nach jedem Schichttausch "Plan neu
 * erzeugen" zu drücken. Verglichen wird der Fingerabdruck der Eingaben —
 * Rotation, Schichtarten, Abweichungen, Wochenziele. Weicht er ab, wird ab
 * heute neu geplant.
 *
 * Was dabei nicht angerührt wird: erledigte und protokollierte Einheiten, und
 * alles, was **fixiert** ist. Wer eine bestimmte Einheit an ihrem Tag halten
 * will, fixiert sie — dann überlebt sie jede Anpassung.
 *
 * Gibt zurück, was passiert ist, oder null, wenn nichts zu tun war.
 */
export async function syncPlan(
  ctx: ShiftContext,
  settings: Settings,
): Promise<{ changed: number; sessions: number } | null> {
  if (settings.autoUpdatePlan === false) return null;

  const macro = (await db.macrocycles.toArray()).find((m) => m.active);
  if (!macro) return null;

  const from = today();
  // Ein Plan, der ganz in der Vergangenheit liegt, wird nicht mehr angefasst —
  // es sei denn, es sind Schichten für die Zukunft eingetragen. Dann gibt es
  // wieder etwas zu planen.
  const horizon = planningHorizon(ctx, PLAN_WEEKS, from);
  const reach = [macro.endDate, horizon].filter((d): d is IsoDate => d !== null && d !== undefined);
  if (reach.length === 0 || reach.every((d) => d < from)) return null;

  // Die Erholung gehört zur Grundlage: Trägt man für morgen "niedrig" ein, muss
  // der Plan das von selbst berücksichtigen, ohne dass man etwas drückt.
  const readiness = await readinessRange(from, horizon);
  const current = planFingerprint(ctx, settings, from, readiness);
  if (macro.inputFingerprint === '') {
    // Plan von vor der Automatik: Fingerabdruck nachtragen, aber nicht neu
    // planen — sonst würde ein Update den Plan ungefragt umbauen.
    await db.macrocycles.update(macro.id, { inputFingerprint: current, updatedAt: now() });
    return null;
  }
  if (macro.inputFingerprint === current) return null;

  // Gezählt wird in **Tagen**, nicht in Einheiten: "an drei Tagen liegt jetzt
  // etwas anderes" sagt mehr als eine Zahl, die durch Verschiebungen in beide
  // Richtungen ohnehin nur die halbe Wahrheit trifft.
  const dayMap = (list: Session[]) => {
    const out = new Map<IsoDate, string>();
    for (const s of list) {
      if (s.status !== 'planned' || s.date < from) continue;
      out.set(s.date, [...(out.get(s.date)?.split(',') ?? []), s.type].sort().join(','));
    }
    return out;
  };

  const before = dayMap(await db.sessions.toArray());

  const plan = await createAndSavePlan({
    startDate: from,
    ctx,
    settings,
    weeks: PLAN_WEEKS,
    name: macro.name,
    readiness,
    until: horizon,
  });

  const after = dayMap(plan.sessions);
  const dates = new Set([...before.keys(), ...after.keys()]);
  let changed = 0;
  for (const date of dates) {
    if (before.get(date) !== after.get(date)) changed++;
  }

  return { changed, sessions: plan.sessions.length };
}

/**
 * Räumt den Plan **ab einem Stichtag** ab — alles davor bleibt stehen.
 *
 * Ein neuer Plan schreibt die Zukunft neu, nicht die Vergangenheit. Früher
 * wurden alle Zyklen gelöscht; damit verschwand der gesamte Verlauf: erledigte
 * Einheiten hingen an keinem Zyklus mehr, die Serie fing bei null an, und im
 * Plan war von dem, was man geleistet hatte, nichts mehr zu sehen. Die Daten
 * waren zwar noch da, aber ohne Zusammenhang — und das kommt einem Verlust
 * gleich.
 *
 * Deshalb gilt jetzt:
 *
 * - Zyklen, die vor dem Stichtag zu Ende waren, bleiben unverändert.
 * - Ein Zyklus, der über den Stichtag reicht, wird auf den Vortag gekürzt.
 * - Alles ab dem Stichtag wird entfernt — außer erledigten und protokollierten
 *   Einheiten, die sind Verlauf.
 */
async function clearPlanFrom(from: IsoDate): Promise<void> {
  const loggedSessionIds = new Set((await db.sessionLogs.toArray()).map((l) => l.sessionId));

  const micros = await db.microcycles.toArray();
  const keptMicroIds = new Set<string>();
  const dropMicroIds: string[] = [];
  const truncated: Microcycle[] = [];
  const ts = now();

  for (const micro of micros) {
    if (micro.endDate < from) {
      keptMicroIds.add(micro.id);
      continue;
    }
    if (micro.startDate >= from) {
      dropMicroIds.push(micro.id);
      continue;
    }
    // Angebrochen: der vergangene Teil bleibt als Verlauf stehen.
    truncated.push({ ...micro, endDate: addDays(from, -1), updatedAt: ts });
    keptMicroIds.add(micro.id);
  }

  const sessions = await db.sessions.toArray();
  // Fixiert heißt: Finger weg. Das ist der Griff, mit dem man eine einzelne
  // Einheit gegen jede Neuplanung schützt.
  const keep = (s: Session) =>
    s.status === 'done' || s.locked || loggedSessionIds.has(s.id);

  const toDelete = sessions
    .filter((s) => s.date >= from && !keep(s) && (dropMicroIds.includes(s.microcycleId) || keptMicroIds.has(s.microcycleId)))
    .map((s) => s.id);

  // Erledigtes, das an einem entfallenden Zyklus hing, wird gelöst statt
  // gelöscht — sonst zeigte es auf einen Zyklus, den es nicht mehr gibt.
  const dropSet = new Set(dropMicroIds);
  const detached = sessions
    .filter((s) => dropSet.has(s.microcycleId) && keep(s))
    .map((s) => ({ ...s, microcycleId: '', updatedAt: ts }));

  if (toDelete.length > 0) await db.sessions.bulkDelete(toDelete);
  if (detached.length > 0) await db.sessions.bulkPut(detached);
  if (truncated.length > 0) await db.microcycles.bulkPut(truncated);
  if (dropMicroIds.length > 0) await db.microcycles.bulkDelete(dropMicroIds);

  // Mesozyklen und Makrozyklen ohne verbleibenden Zyklus verschwinden; die
  // übrigen enden am letzten Tag, der ihnen geblieben ist, und geben die
  // Aktivmarkierung ab.
  const remaining = await db.microcycles.toArray();
  const mesos = await db.mesocycles.toArray();
  const mesoDrop: string[] = [];
  const mesoKeep: Mesocycle[] = [];

  for (const meso of mesos) {
    const own = remaining.filter((m) => m.mesocycleId === meso.id);
    if (own.length === 0) {
      mesoDrop.push(meso.id);
      continue;
    }
    const last = own.map((m) => m.endDate).sort().slice(-1)[0];
    mesoKeep.push({ ...meso, endDate: last, status: 'done', updatedAt: ts });
  }
  if (mesoKeep.length > 0) await db.mesocycles.bulkPut(mesoKeep);
  if (mesoDrop.length > 0) await db.mesocycles.bulkDelete(mesoDrop);

  const macros = await db.macrocycles.toArray();
  const macroDrop: string[] = [];
  const macroKeep: Macrocycle[] = [];

  for (const macro of macros) {
    const own = mesoKeep.filter((m) => m.macrocycleId === macro.id);
    if (own.length === 0) {
      macroDrop.push(macro.id);
      continue;
    }
    const last = own.map((m) => m.endDate).sort().slice(-1)[0];
    macroKeep.push({ ...macro, endDate: last, active: false, updatedAt: ts });
  }
  if (macroKeep.length > 0) await db.macrocycles.bulkPut(macroKeep);
  if (macroDrop.length > 0) await db.macrocycles.bulkDelete(macroDrop);
}

/**
 * Löscht den Plan ab heute. Der Verlauf bleibt.
 *
 * Für einen echten Neuanfang gibt es unter Daten das Zurücksetzen — hier geht
 * es nur darum, den Plan loszuwerden, nicht das Geleistete.
 */
export async function clearActivePlan(): Promise<void> {
  await db.transaction(
    'rw',
    [db.macrocycles, db.mesocycles, db.microcycles, db.sessions, db.sessionLogs],
    () => clearPlanFrom(today()),
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
 * Einheiten, die doppelt in den Daten stehen.
 *
 * Gleicher Tag, gleiche Art, beide erledigt — das kann der Generator nicht
 * erzeugen (ein Doppeltag ist immer Kraft **und** Laufen). Solche Paare stammen
 * aus einem früheren Fehler, bei dem das Neuerzeugen eine zweite Einheit auf
 * einen Tag legte, an dem schon eine protokolliert war. Sie zählen in der
 * Auswertung doppelt und ließen sich sonst nur einzeln im Plan aufspüren.
 *
 * Behalten wird die Einheit mit Protokoll, sonst die ältere.
 */
export async function findDuplicateSessions(): Promise<
  Array<{ keep: Session; drop: Session[] }>
> {
  const sessions = await db.sessions.toArray();
  const logged = new Set((await db.sessionLogs.toArray()).map((l) => l.sessionId));

  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    if (session.status !== 'done') continue;
    const key = `${session.date}|${session.type}`;
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }

  const out: Array<{ keep: Session; drop: Session[] }> = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ranked = [...list].sort((a, b) => {
      const byLog = Number(logged.has(b.id)) - Number(logged.has(a.id));
      if (byLog !== 0) return byLog;
      return a.createdAt.localeCompare(b.createdAt);
    });
    out.push({ keep: ranked[0], drop: ranked.slice(1) });
  }
  return out.sort((a, b) => a.keep.date.localeCompare(b.keep.date));
}

/** Entfernt die überzähligen Einträge und gibt zurück, wie viele es waren. */
export async function removeDuplicateSessions(): Promise<number> {
  const duplicates = await findDuplicateSessions();
  let removed = 0;
  for (const { drop } of duplicates) {
    for (const session of drop) {
      await deleteSession(session.id);
      removed++;
    }
  }
  return removed;
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
