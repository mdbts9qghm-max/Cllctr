/**
 * Datenbank-Operationen rund um den Trainingsplan.
 *
 * Trennt die reine Planungslogik (planner.ts, replan.ts) von den Schreibzugriffen.
 * Alles läuft in Transaktionen, damit ein abgebrochener Vorgang keinen halben
 * Plan hinterlässt.
 */

import { db } from './db';
import { addDays, today } from './dates';
import { now } from './ids';
import { generateTrainingPlan, type GeneratedPlan, type PlanInput } from './planner';
import {
  applyRescheduleToSessions,
  proposeReschedule,
  type ReschedulePlan,
  type RescheduleContext,
} from './replan';
import type { ShiftContext } from './shifts';
import type { Session, Settings } from './types';

/** Erzeugt einen Plan und schreibt ihn. Ein bestehender aktiver Plan wird ersetzt. */
export async function createAndSavePlan(input: PlanInput): Promise<GeneratedPlan> {
  const plan = generateTrainingPlan(input);

  // sessionLogs gehört in den Transaktionsbereich, weil das Aufräumen prüft,
  // welche Sessions bereits protokolliert sind — ohne das bricht Dexie ab.
  await db.transaction(
    'rw',
    [db.macrocycles, db.mesocycles, db.microcycles, db.sessions, db.sessionLogs],
    async () => {
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
}

/** Setzt eine Einheit zurück auf geplant. */
export async function resetSessionStatus(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { status: 'planned', updatedAt: now() });
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
}

/** Markiert als verpasst, ohne umzuplanen — für den Fall, dass der Vorschlag verworfen wird. */
export async function markSessionMissed(sessionId: string): Promise<void> {
  await db.sessions.update(sessionId, { status: 'missed', updatedAt: now() });
}

/** Die heutige Einheit, falls es eine gibt. */
export async function getTodaySession(): Promise<Session | undefined> {
  const list = await db.sessions.where('date').equals(today()).toArray();
  return list.find((s) => s.status === 'planned') ?? list[0];
}
