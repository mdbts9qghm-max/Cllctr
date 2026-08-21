/**
 * Bestwerte.
 *
 * Die App erkennt selbst, wenn ein neuer Bestwert dabei war — man soll nicht
 * daran denken müssen. Grundlage sind die eingetragenen Sätze bzw. Zeiten; die
 * Erkennung läuft beim Speichern des Protokolls.
 */

import { db } from './db';
import { newId, now } from './ids';
import type {
  Exercise,
  IsoDate,
  PersonalRecord,
  PrKind,
  SetEntry,
} from './types';

/**
 * Geschätztes Einer-Maximum nach Epley.
 *
 * Damit zählt auch ein Satz mit weniger Gewicht und mehr Wiederholungen als
 * Fortschritt — sonst wäre nur der eine schwere Versuch je ein Bestwert.
 * Über zehn Wiederholungen wird die Formel unzuverlässig, deshalb die Grenze.
 */
export function estimatedOneRepMax(weightKg: number, reps: number): number | null {
  if (weightKg <= 0 || reps <= 0 || reps > 10) return null;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/** Ein Kandidat für einen Bestwert, bevor er mit dem bisherigen verglichen wird. */
interface Candidate {
  kind: PrKind;
  value: number;
  unit: string;
  note: string;
}

function candidatesFor(exercise: Exercise, entry: SetEntry): Candidate[] {
  const out: Candidate[] = [];

  switch (exercise.metric) {
    case 'weight': {
      if (entry.weightKg && entry.weightKg > 0) {
        out.push({
          kind: 'weight',
          value: entry.weightKg,
          unit: 'kg',
          note: entry.reps ? `${entry.reps} Wdh.` : '',
        });
        const oneRm = entry.reps ? estimatedOneRepMax(entry.weightKg, entry.reps) : null;
        if (oneRm !== null) {
          out.push({
            kind: 'estimated1rm',
            value: oneRm,
            unit: 'kg',
            note: `geschätzt aus ${entry.weightKg} kg × ${entry.reps}`,
          });
        }
      }
      break;
    }
    case 'reps': {
      if (entry.reps && entry.reps > 0) {
        out.push({ kind: 'reps', value: entry.reps, unit: 'Wdh.', note: '' });
      }
      break;
    }
    case 'time': {
      if (entry.timeSec && entry.timeSec > 0) {
        out.push({ kind: 'time', value: entry.timeSec, unit: 's', note: '' });
      }
      break;
    }
    case 'distance': {
      if (entry.distanceM && entry.distanceM > 0) {
        out.push({ kind: 'distance', value: entry.distanceM, unit: 'm', note: '' });
      }
      break;
    }
  }

  return out;
}

/** Ist der neue Wert besser als der bisherige? Bei Zeiten gewinnt der kleinere. */
function beats(exercise: Exercise, kind: PrKind, value: number, previous: number | null): boolean {
  if (previous === null) return true;
  // Die Richtung hängt an der Übung, nicht an der Kennzahl: eine 5-km-Zeit soll
  // sinken, ein Gewicht steigen.
  return exercise.higherIsBetter ? value > previous : value < previous;
}

export interface NewRecord {
  record: PersonalRecord;
  exercise: Exercise;
  /** Verbesserung gegenüber dem alten Wert, in derselben Einheit. */
  improvement: number | null;
}

/**
 * Prüft eingetragene Sätze gegen die bisherigen Bestwerte und legt neue an.
 * Gibt zurück, was tatsächlich neu ist — für die Rückmeldung an den Nutzer und
 * später als Auslöser für Seelen.
 */
export async function detectRecords(entries: SetEntry[]): Promise<NewRecord[]> {
  if (entries.length === 0) return [];

  const found: NewRecord[] = [];
  const exerciseIds = [...new Set(entries.map((e) => e.exerciseId))];

  await db.transaction('rw', [db.exercises, db.personalRecords], async () => {
    const exercises = await db.exercises.bulkGet(exerciseIds);
    const byId = new Map(
      exercises.filter((e): e is Exercise => Boolean(e)).map((e) => [e.id, e]),
    );

    for (const entry of entries) {
      const exercise = byId.get(entry.exerciseId);
      if (!exercise) continue;

      for (const candidate of candidatesFor(exercise, entry)) {
        const existing = await db.personalRecords
          .where('[exerciseId+kind]')
          .equals([exercise.id, candidate.kind])
          .toArray();

        const best = existing.reduce<PersonalRecord | null>((acc, pr) => {
          if (!acc) return pr;
          return beats(exercise, candidate.kind, pr.value, acc.value) ? pr : acc;
        }, null);

        if (!beats(exercise, candidate.kind, candidate.value, best?.value ?? null)) continue;

        const record: PersonalRecord = {
          id: newId('pr'),
          exerciseId: exercise.id,
          kind: candidate.kind,
          value: candidate.value,
          unit: candidate.unit,
          date: entry.date,
          setEntryId: entry.id,
          previousValue: best?.value ?? null,
          note: candidate.note,
          createdAt: now(),
        };

        await db.personalRecords.put(record);
        found.push({
          record,
          exercise,
          improvement: best ? Math.round(Math.abs(candidate.value - best.value) * 10) / 10 : null,
        });
      }
    }
  });

  return found;
}

export interface SetInput {
  exerciseId: string;
  weightKg?: number | null;
  reps?: number | null;
  timeSec?: number | null;
  distanceM?: number | null;
  note?: string;
}

/** Schreibt Sätze zu einem Protokoll und prüft sie direkt auf Bestwerte. */
export async function recordSets(
  sessionLogId: string | null,
  date: IsoDate,
  inputs: SetInput[],
): Promise<NewRecord[]> {
  const ts = now();
  const entries: SetEntry[] = inputs.map((input) => ({
    id: newId('set'),
    sessionLogId,
    exerciseId: input.exerciseId,
    date,
    weightKg: input.weightKg ?? null,
    reps: input.reps ?? null,
    timeSec: input.timeSec ?? null,
    distanceM: input.distanceM ?? null,
    note: input.note ?? '',
    createdAt: ts,
  }));

  await db.setEntries.bulkPut(entries);
  return detectRecords(entries);
}

/** Der jeweils beste Wert je Übung und Kennzahl, für die Bestwert-Liste. */
export async function currentRecords(): Promise<Array<{ exercise: Exercise; records: PersonalRecord[] }>> {
  const [exercises, records] = await Promise.all([
    db.exercises.toArray(),
    db.personalRecords.toArray(),
  ]);

  return exercises
    .filter((e) => !e.archived)
    .map((exercise) => {
      const own = records.filter((r) => r.exerciseId === exercise.id);
      const bestByKind = new Map<PrKind, PersonalRecord>();

      for (const record of own) {
        const current = bestByKind.get(record.kind);
        if (!current || beats(exercise, record.kind, record.value, current.value)) {
          bestByKind.set(record.kind, record);
        }
      }

      return { exercise, records: [...bestByKind.values()] };
    })
    .filter((x) => x.records.length > 0);
}

/** Sekunden als "mm:ss" bzw. "h:mm:ss". */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatRecordValue(record: PersonalRecord): string {
  if (record.kind === 'time') return formatTime(record.value);
  if (record.kind === 'distance') return `${(record.value / 1000).toFixed(2)} km`;
  return `${record.value} ${record.unit}`;
}

export const PR_KIND_LABEL: Record<PrKind, string> = {
  weight: 'Bestes Gewicht',
  estimated1rm: 'Geschätztes 1RM',
  time: 'Bestzeit',
  distance: 'Weiteste Distanz',
  reps: 'Meiste Wiederholungen',
};
