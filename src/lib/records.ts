/**
 * Bestwerte erkennen.
 *
 * Nichts wird von Hand eingetragen: Ein Bestwert ist das Ergebnis aus Daten,
 * die ohnehin da sind. Wer ihn tippen müsste, hätte einen Wunschzettel statt
 * einer Bestenliste.
 */

import { addDays, startOfWeek } from './dates';
import { distanceOf, inRange, minutesOf, summarize } from './load';
import {
  type Exercise,
  type IsoDate,
  type PersonalRecord,
  type RecordKind,
  type StrengthSet,
  type TrainingSession,
} from './types';

export interface RecordCandidate {
  kind: RecordKind;
  exerciseId: string | null;
  value: number;
  unit: string;
  date: IsoDate;
  detail: string;
  /** Bei Zeiten ist kleiner besser. */
  higherIsBetter: boolean;
}

/** Geschätztes 1RM nach Epley. Über zehn Wiederholungen wird es unbrauchbar. */
export function estimated1rm(weightKg: number, reps: number): number | null {
  if (reps < 1 || reps > 10 || weightKg <= 0) return null;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/**
 * Alle Bestwert-Kandidaten aus den Daten.
 *
 * Distanzbestzeiten (5 km, 10 km) werden nur aus Einheiten abgeleitet, deren
 * Distanz nah genug an der Marke liegt — ein 12-km-Lauf ist keine 10-km-Zeit.
 */
export function candidates(
  sessions: TrainingSession[],
  sets: StrengthSet[],
  exercises: Exercise[],
): RecordCandidate[] {
  const out: RecordCandidate[] = [];
  const done = sessions.filter((s) => s.status === 'done');

  for (const s of done) {
    const km = distanceOf(s);
    const min = minutesOf(s);

    if (s.sport === 'run') {
      // ±3 %: genug Spielraum für GPS-Abweichung, zu wenig für einen anderen Lauf.
      for (const [mark, kind] of [
        [5, 'run_5k'],
        [10, 'run_10k'],
      ] as Array<[number, RecordKind]>) {
        if (km >= mark * 0.97 && km <= mark * 1.03 && min > 0) {
          const seconds = Math.round((min * 60 * mark) / km);
          out.push({
            kind,
            exerciseId: null,
            value: seconds,
            unit: 's',
            date: s.date,
            detail: `${km.toFixed(1).replace('.', ',')} km in ${Math.round(min)} min`,
            higherIsBetter: false,
          });
        }
      }
      if (km > 0) {
        out.push({
          kind: 'run_longest',
          exerciseId: null,
          value: km,
          unit: 'km',
          date: s.date,
          detail: s.title,
          higherIsBetter: true,
        });
      }
    }

    if (s.sport === 'bike' && km > 0) {
      out.push({
        kind: 'bike_longest',
        exerciseId: null,
        value: km,
        unit: 'km',
        date: s.date,
        detail: s.title,
        higherIsBetter: true,
      });
    }

    if (s.sport === 'swim' && km > 0) {
      out.push({
        kind: 'swim_longest',
        exerciseId: null,
        value: km,
        unit: 'km',
        date: s.date,
        detail: s.title,
        higherIsBetter: true,
      });
    }
  }

  const byId = new Map(exercises.map((e) => [e.id, e]));
  for (const set of sets) {
    const exercise = byId.get(set.exerciseId);
    if (!exercise) continue;

    if (exercise.metric === 'weight' && set.weightKg && set.reps) {
      const oneRm = estimated1rm(set.weightKg, set.reps);
      if (oneRm !== null) {
        out.push({
          kind: 'strength_1rm',
          exerciseId: exercise.id,
          value: oneRm,
          unit: 'kg',
          date: set.date,
          detail: `${exercise.name}: ${set.weightKg} kg × ${set.reps}`,
          higherIsBetter: true,
        });
      }
    }
    if (exercise.metric === 'reps' && set.reps) {
      out.push({
        kind: 'strength_reps',
        exerciseId: exercise.id,
        value: set.reps,
        unit: 'Wdh',
        date: set.date,
        detail: `${exercise.name}: ${set.reps} Wiederholungen`,
        higherIsBetter: true,
      });
    }
  }

  // Größte Trainingswoche — über alle vollständigen Wochen.
  const weeks = new Map<IsoDate, number>();
  for (const s of done) {
    const week = startOfWeek(s.date);
    weeks.set(week, (weeks.get(week) ?? 0) + minutesOf(s));
  }
  for (const [week, minutes] of weeks) {
    if (minutes <= 0) continue;
    out.push({
      kind: 'week_volume',
      exerciseId: null,
      value: minutes,
      unit: 'min',
      date: addDays(week, 6),
      detail: `Woche ab ${week}`,
      higherIsBetter: true,
    });
  }

  return out;
}

/**
 * Die aktuellen Bestwerte — je Art (und Übung) der beste Kandidat.
 *
 * Bei Gleichstand gewinnt der ältere: Der Rekord wurde damals aufgestellt, nicht
 * beim Wiederholen.
 */
export function bestOf(list: RecordCandidate[]): RecordCandidate[] {
  const groups = new Map<string, RecordCandidate>();
  for (const c of list) {
    const key = `${c.kind}::${c.exerciseId ?? '-'}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, c);
      continue;
    }
    const better = c.higherIsBetter ? c.value > current.value : c.value < current.value;
    if (better || (c.value === current.value && c.date < current.date)) groups.set(key, c);
  }
  return [...groups.values()];
}

/**
 * Vergleicht die Bestenliste mit dem, was gespeichert ist, und gibt zurück, was
 * neu geschrieben werden muss. Schreiben selbst macht `store.ts`.
 */
export function newRecords(
  best: RecordCandidate[],
  stored: PersonalRecord[],
): Array<Omit<PersonalRecord, 'id' | 'createdAt'>> {
  const byKey = new Map(stored.map((r) => [`${r.kind}::${r.exerciseId ?? '-'}`, r]));
  const out: Array<Omit<PersonalRecord, 'id' | 'createdAt'>> = [];

  for (const c of best) {
    const key = `${c.kind}::${c.exerciseId ?? '-'}`;
    const previous = byKey.get(key);
    if (previous && previous.value === c.value && previous.date === c.date) continue;
    out.push({
      kind: c.kind,
      exerciseId: c.exerciseId,
      value: c.value,
      unit: c.unit,
      date: c.date,
      previousValue: previous?.value ?? null,
      detail: c.detail,
    });
  }
  return out;
}

/** Die größte Trainingswoche in Minuten — für den Rückblick. */
export function biggestWeek(sessions: TrainingSession[]): number {
  const weeks = new Map<IsoDate, number>();
  for (const s of sessions.filter((x) => x.status === 'done')) {
    const week = startOfWeek(s.date);
    weeks.set(week, (weeks.get(week) ?? 0) + minutesOf(s));
  }
  return Math.max(0, ...weeks.values());
}

/** Kennzahlen eines Zeitraums, fertig für die Analyse-Seite. */
export function periodStats(sessions: TrainingSession[], from: IsoDate, to: IsoDate) {
  return summarize(inRange(sessions, from, to).filter((s) => s.status === 'done'));
}
