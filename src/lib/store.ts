/**
 * Alle Schreibzugriffe.
 *
 * Warum an einer Stelle: Dexies `liveQuery` stürzt ab, wenn aus einer laufenden
 * Beobachtung heraus geschrieben wird. Lesen passiert deshalb in Komponenten
 * über `useLiveQuery`, Schreiben ausschließlich hier — aufgerufen aus
 * Event-Handlern und Effekten.
 */

import { db } from './db';
import { addDays, startOfWeek, today } from './dates';
import { newId, now } from './ids';
import { hrZonesFor } from './seed';
import { bestOf, candidates, newRecords } from './records';
import { nextOccurrence } from './tasks';
import type {
  DailyCheckIn,
  Exercise,
  Goal,
  Habit,
  IsoDate,
  PersonalRecord,
  Profile,
  Settings,
  ShiftPattern,
  ShiftType,
  Sport,
  StrengthSet,
  Task,
  TrainingPhase,
  TrainingSession,
  WeeklyReview,
} from './types';

/* ------------------------------------------------------------------ */
/* Profil und Einstellungen                                            */
/* ------------------------------------------------------------------ */

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  const current = await db.profile.get('singleton');
  if (!current) return;
  const next = { ...current, ...patch, updatedAt: now() };

  // Ändern sich Ruhe- oder Maximalpuls, sind die Zonen von vorher falsch. Sie
  // stillschweigend stehen zu lassen wäre der schlimmere Fehler: Der Nutzer
  // liefe nach Zahlen, die nicht mehr zu ihm gehören.
  const hrChanged =
    (patch.maxHr !== undefined && patch.maxHr !== current.maxHr) ||
    (patch.restingHr !== undefined && patch.restingHr !== current.restingHr);
  if (hrChanged && next.maxHr && next.restingHr) {
    next.hrZones = hrZonesFor(next.maxHr, next.restingHr);
  }

  await db.profile.put(next);
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await db.settings.get('singleton');
  if (!current) return;
  await db.settings.put({ ...current, ...patch, updatedAt: now() });
}

/* ------------------------------------------------------------------ */
/* Schichten                                                           */
/* ------------------------------------------------------------------ */

/** Setzt die Schicht eines Tages. `null` entfernt den Eintrag wieder. */
export async function setShift(date: IsoDate, shiftTypeId: string | null): Promise<void> {
  if (shiftTypeId === null) {
    await db.shiftAssignments.delete(date);
    return;
  }
  await db.shiftAssignments.put({ date, shiftTypeId, note: '', createdAt: now() });
}

/** Setzt einen ganzen Zeitraum. Für Urlaub, Krankheit, Blockeinträge. */
export async function setShiftRange(
  from: IsoDate,
  to: IsoDate,
  shiftTypeId: string | null,
): Promise<number> {
  const dates: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > 400) break;
  }
  await db.transaction('rw', db.shiftAssignments, async () => {
    if (shiftTypeId === null) {
      await db.shiftAssignments.bulkDelete(dates);
      return;
    }
    const ts = now();
    await db.shiftAssignments.bulkPut(
      dates.map((date) => ({ date, shiftTypeId, note: '', createdAt: ts })),
    );
  });
  return dates.length;
}

/**
 * Belegt einen Zeitraum aus einer Rotation vor.
 *
 * Bewusst als einmalige Aktion und nicht als dauerhafte Regel: Der Dienstplan
 * ändert sich, und eine Rotation, die im Hintergrund weiterläuft, würde
 * irgendwann etwas behaupten, das längst nicht mehr stimmt. Sie füllt die Tage
 * — danach sind es normale Einträge, die man einzeln ändern kann.
 */
export async function applyPattern(
  pattern: ShiftPattern,
  from: IsoDate,
  to: IsoDate,
  overwrite: boolean,
): Promise<number> {
  const existing = new Set((await db.shiftAssignments.toArray()).map((a) => a.date));
  const ts = now();
  const rows: Array<{ date: IsoDate; shiftTypeId: string; note: string; createdAt: string }> = [];

  let index = 0;
  for (let d = from; d <= to; d = addDays(d, 1), index++) {
    if (!overwrite && existing.has(d)) continue;
    const offset =
      ((index + daysFromAnchor(pattern.anchorDate, from)) % pattern.sequence.length +
        pattern.sequence.length) %
      pattern.sequence.length;
    rows.push({ date: d, shiftTypeId: pattern.sequence[offset], note: '', createdAt: ts });
    if (rows.length > 400) break;
  }
  await db.shiftAssignments.bulkPut(rows);
  return rows.length;
}

function daysFromAnchor(anchor: IsoDate, date: IsoDate): number {
  const a = new Date(`${anchor}T12:00:00`).getTime();
  const b = new Date(`${date}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export async function saveShiftType(type: ShiftType): Promise<void> {
  await db.shiftTypes.put(type);
}

export async function savePattern(pattern: ShiftPattern): Promise<void> {
  await db.shiftPatterns.put({ ...pattern, updatedAt: now() });
}

/* ------------------------------------------------------------------ */
/* Check-in                                                            */
/* ------------------------------------------------------------------ */

export function emptyCheckIn(date: IsoDate): DailyCheckIn {
  const ts = now();
  return {
    date,
    sleepHours: null,
    sleepQuality: null,
    soreness: null,
    stress: null,
    motivation: null,
    whoopRecovery: null,
    restingHr: null,
    hrvMs: null,
    note: '',
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function updateCheckIn(
  date: IsoDate,
  patch: Partial<Omit<DailyCheckIn, 'date' | 'createdAt'>>,
): Promise<void> {
  await db.transaction('rw', db.checkIns, async () => {
    const existing = await db.checkIns.get(date);
    const ts = now();
    await db.checkIns.put({
      ...emptyCheckIn(date),
      ...existing,
      ...patch,
      date,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
  });
}

export async function completeCheckIn(date: IsoDate, done: boolean): Promise<void> {
  await updateCheckIn(date, { completedAt: done ? now() : null });
}

export async function clearCheckIn(date: IsoDate): Promise<void> {
  await db.checkIns.delete(date);
}

/* ------------------------------------------------------------------ */
/* Training                                                            */
/* ------------------------------------------------------------------ */

export interface NewSession {
  date: IsoDate;
  sport: Sport;
  title: string;
  intensity: TrainingSession['intensity'];
  zone: TrainingSession['zone'];
  purpose?: string;
  plannedMinutes?: number | null;
  plannedDistanceKm?: number | null;
  source?: TrainingSession['source'];
}

export async function addSession(input: NewSession): Promise<TrainingSession> {
  const ts = now();
  const session: TrainingSession = {
    id: newId('ses'),
    date: input.date,
    sport: input.sport,
    title: input.title,
    intensity: input.intensity,
    zone: input.zone,
    purpose: input.purpose ?? '',
    plannedMinutes: input.plannedMinutes ?? null,
    plannedDistanceKm: input.plannedDistanceKm ?? null,
    actualMinutes: null,
    actualDistanceKm: null,
    avgHr: null,
    maxHr: null,
    rpe: null,
    status: 'planned',
    notes: '',
    source: input.source ?? 'manual',
    externalId: null,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.sessions.put(session);
  return session;
}

export async function updateSession(
  id: string,
  patch: Partial<TrainingSession>,
): Promise<void> {
  const current = await db.sessions.get(id);
  if (!current) return;
  await db.sessions.put({ ...current, ...patch, updatedAt: now() });
  await refreshRecords();
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', [db.sessions, db.strengthSets], async () => {
    const sets = await db.strengthSets.where('sessionId').equals(id).toArray();
    if (sets.length > 0) await db.strengthSets.bulkDelete(sets.map((s) => s.id));
    await db.sessions.delete(id);
  });
  await refreshRecords();
}

/** Hakt eine Einheit ab und schreibt dabei, was tatsächlich war. */
export async function completeSession(
  id: string,
  actual: {
    minutes: number | null;
    distanceKm: number | null;
    rpe: number | null;
    avgHr: number | null;
    maxHr: number | null;
    notes: string;
  },
): Promise<void> {
  await updateSession(id, {
    status: 'done',
    actualMinutes: actual.minutes,
    actualDistanceKm: actual.distanceKm,
    rpe: actual.rpe,
    avgHr: actual.avgHr,
    maxHr: actual.maxHr,
    notes: actual.notes,
  });
}

export async function saveStrengthSets(
  sessionId: string,
  date: IsoDate,
  sets: Array<{ exerciseId: string; reps: number | null; weightKg: number | null; timeSec: number | null }>,
): Promise<void> {
  await db.transaction('rw', db.strengthSets, async () => {
    const existing = await db.strengthSets.where('sessionId').equals(sessionId).toArray();
    if (existing.length > 0) await db.strengthSets.bulkDelete(existing.map((s) => s.id));
    const ts = now();
    await db.strengthSets.bulkPut(
      sets
        .filter((s) => s.exerciseId && (s.reps || s.weightKg || s.timeSec))
        .map((s, i): StrengthSet => ({
          id: newId('set'),
          sessionId,
          exerciseId: s.exerciseId,
          date,
          order: i + 1,
          reps: s.reps,
          weightKg: s.weightKg,
          timeSec: s.timeSec,
          distanceM: null,
          createdAt: ts,
        })),
    );
  });
  await refreshRecords();
}

export async function addExercise(name: string, metric: Exercise['metric']): Promise<Exercise> {
  const exercise: Exercise = {
    id: newId('ex'),
    name,
    muscleGroups: [],
    metric,
    higherIsBetter: metric !== 'time',
    archived: false,
    createdAt: now(),
  };
  await db.exercises.put(exercise);
  return exercise;
}

/* ------------------------------------------------------------------ */
/* Phasen                                                              */
/* ------------------------------------------------------------------ */

export async function savePhase(phase: TrainingPhase): Promise<void> {
  await db.phases.put({ ...phase, updatedAt: now() });
}

export async function deletePhase(id: string): Promise<void> {
  await db.phases.delete(id);
}

export async function replacePhases(
  specs: Array<{ kind: TrainingPhase['kind']; startDate: IsoDate; endDate: IsoDate }>,
): Promise<void> {
  const ts = now();
  await db.transaction('rw', db.phases, async () => {
    await db.phases.clear();
    await db.phases.bulkPut(
      specs.map((s) => ({
        id: newId('phase'),
        kind: s.kind,
        name: s.kind.charAt(0).toUpperCase() + s.kind.slice(1),
        startDate: s.startDate,
        endDate: s.endDate,
        weeklyMinutesTarget: null,
        focus: '',
        notes: '',
        createdAt: ts,
        updatedAt: ts,
      })),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Habits                                                              */
/* ------------------------------------------------------------------ */

export async function saveHabit(habit: Habit): Promise<void> {
  await db.habits.put({ ...habit, updatedAt: now() });
}

export async function deleteHabit(id: string): Promise<void> {
  await db.transaction('rw', [db.habits, db.habitEntries], async () => {
    const entries = await db.habitEntries.where('habitId').equals(id).toArray();
    if (entries.length > 0) await db.habitEntries.bulkDelete(entries.map((e) => e.id));
    await db.habits.delete(id);
  });
}

/** Setzt den Wert eines Habits an einem Tag. 0 löscht den Eintrag. */
export async function setHabitValue(
  habitId: string,
  date: IsoDate,
  value: number,
): Promise<void> {
  await db.transaction('rw', db.habitEntries, async () => {
    const existing = (
      await db.habitEntries.where('[habitId+date]').equals([habitId, date]).toArray()
    )[0];
    if (value <= 0) {
      if (existing) await db.habitEntries.delete(existing.id);
      return;
    }
    const ts = now();
    await db.habitEntries.put({
      id: existing?.id ?? newId('he'),
      habitId,
      date,
      value,
      note: existing?.note ?? '',
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Aufgaben                                                            */
/* ------------------------------------------------------------------ */

export async function saveTask(task: Task): Promise<void> {
  await db.tasks.put({ ...task, updatedAt: now() });
}

export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}

/**
 * Hakt eine Aufgabe ab.
 *
 * Bei Wiederholung entsteht sofort die nächste: Eine wiederkehrende Aufgabe, die
 * nach dem Abhaken verschwindet, ist keine wiederkehrende Aufgabe. Hängt ein
 * Habit dran, wird er gleich mit erfüllt — zweimal dasselbe abzuhaken ist der
 * sicherste Weg, dass eines von beidem liegen bleibt.
 */
export async function completeTask(task: Task, date: IsoDate = today()): Promise<void> {
  const ts = now();
  await db.transaction('rw', [db.tasks, db.habitEntries, db.habits], async () => {
    await db.tasks.put({ ...task, status: 'done', completedAt: ts, updatedAt: ts });

    if (task.recurrence && task.dueDate) {
      await db.tasks.put({
        ...task,
        id: newId('task'),
        status: 'open',
        completedAt: null,
        dueDate: nextOccurrence(task.dueDate, task.recurrence),
        createdAt: ts,
        updatedAt: ts,
      });
    }
  });

  if (task.habitId) {
    const habit = await db.habits.get(task.habitId);
    if (habit) await setHabitValue(habit.id, date, habit.kind === 'check' ? 1 : (habit.target ?? 1));
  }
}

export async function reopenTask(task: Task): Promise<void> {
  await db.tasks.put({ ...task, status: 'open', completedAt: null, updatedAt: now() });
}

/* ------------------------------------------------------------------ */
/* Ziele                                                               */
/* ------------------------------------------------------------------ */

export async function saveGoal(goal: Goal): Promise<void> {
  await db.goals.put({ ...goal, updatedAt: now() });
}

export async function deleteGoal(id: string): Promise<void> {
  await db.goals.delete(id);
}

/* ------------------------------------------------------------------ */
/* Bestwerte                                                           */
/* ------------------------------------------------------------------ */

/**
 * Rechnet die Bestenliste neu und schreibt, was sich geändert hat.
 *
 * Läuft nach jedem Schreibvorgang am Training. Das ist billig genug — die
 * Alternative wäre ein Zähler, der irgendwann von der Wahrheit abweicht.
 */
export async function refreshRecords(): Promise<PersonalRecord[]> {
  const [sessions, sets, exercises, stored] = await Promise.all([
    db.sessions.toArray(),
    db.strengthSets.toArray(),
    db.exercises.toArray(),
    db.records.toArray(),
  ]);

  const best = bestOf(candidates(sessions, sets, exercises));
  const fresh = newRecords(best, stored);
  if (fresh.length === 0) return [];

  const ts = now();
  const rows: PersonalRecord[] = fresh.map((r) => ({ ...r, id: newId('pr'), createdAt: ts }));

  await db.transaction('rw', db.records, async () => {
    // Je Art und Übung gilt genau ein aktueller Bestwert — der alte wird
    // ersetzt, nicht angehäuft. Die Historie steckt in den Einheiten selbst.
    for (const row of rows) {
      const existing = stored.filter(
        (s) => s.kind === row.kind && (s.exerciseId ?? null) === (row.exerciseId ?? null),
      );
      if (existing.length > 0) await db.records.bulkDelete(existing.map((e) => e.id));
      await db.records.put(row);
    }
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Rückblick                                                           */
/* ------------------------------------------------------------------ */

export async function saveReview(review: WeeklyReview): Promise<void> {
  await db.reviews.put({ ...review, updatedAt: now() });
}

export function emptyReview(anyDayOfWeek: IsoDate): WeeklyReview {
  const ts = now();
  return {
    weekStart: startOfWeek(anyDayOfWeek),
    totalMinutes: 0,
    runKm: 0,
    bikeKm: 0,
    swimKm: 0,
    strengthSessions: 0,
    habitPct: 0,
    avgSleepHours: null,
    avgRecoveryPct: null,
    wentWell: '',
    improve: '',
    createdAt: ts,
    updatedAt: ts,
  };
}
