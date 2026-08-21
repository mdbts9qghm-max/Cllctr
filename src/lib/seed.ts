/**
 * Erstbefüllung. Läuft genau einmal, wenn die Datenbank noch leer ist.
 *
 * Die Schichtarten bilden den beschriebenen 12-Stunden-Rhythmus ab. Die
 * Rotation ist bewusst nur ein Platzhalter — sie muss unter Setup auf den
 * echten Rhythmus gesetzt werden, sonst plant die App am Leben vorbei.
 */

import { db } from './db';
import { newId, now } from './ids';
import { startOfWeek, today } from './dates';
import { SCHEMA_VERSION, type Exercise, type Settings, type ShiftPattern, type ShiftType } from './types';

export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  {
    id: 'tag',
    name: 'Tagschicht',
    short: 'T',
    startTime: '07:00',
    endTime: '19:00',
    crossesMidnight: false,
    capacity: 'light',
    trainingWindow: 'ab ca. 20:00',
    color: '#eab308',
    note: '12 Stunden. Danach geht höchstens eine kurze lockere Einheit.',
    isBuiltIn: true,
    sortOrder: 1,
  },
  {
    id: 'nacht',
    name: 'Nachtschicht',
    short: 'N',
    startTime: '19:00',
    endTime: '07:00',
    crossesMidnight: true,
    capacity: 'light',
    trainingWindow: 'vormittags, vor der Schicht',
    color: '#6366f1',
    note: 'Vor der Schicht ist Zeit, aber nichts, was den Schlaf davor frisst.',
    isBuiltIn: true,
    sortOrder: 2,
  },
  {
    id: 'schlaf',
    name: 'Schlaftag',
    short: 'S',
    startTime: '08:00',
    endTime: '14:00',
    crossesMidnight: false,
    capacity: 'moderate',
    trainingWindow: 'ab ca. 15:00',
    color: '#0ea5e9',
    note: 'Tag nach der Nachtschicht, Schlaf 08:00–14:00. Nachmittags normales Volumen, keine Key-Session.',
    isBuiltIn: true,
    sortOrder: 3,
  },
  {
    id: 'frei',
    name: 'Freischicht',
    short: 'F',
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    capacity: 'full',
    trainingWindow: 'ganzer Tag',
    color: '#22c55e',
    note: 'Kompletter Tag frei. Hier liegen die Key-Sessions.',
    isBuiltIn: true,
    sortOrder: 4,
  },
  {
    id: 'v',
    name: 'V-Schicht',
    short: 'V',
    startTime: '08:00',
    endTime: '20:00',
    crossesMidnight: false,
    capacity: 'light',
    trainingWindow: 'ab ca. 21:00',
    color: '#f97316',
    note: 'Willkürlich 08:00–20:00. Wie Tagschicht zu behandeln.',
    isBuiltIn: true,
    sortOrder: 5,
  },
];

/** Platzhalter-Rotation: 2 Tag, 2 Nacht, Schlaftag, 2 frei. Unbedingt anpassen. */
export const PLACEHOLDER_SEQUENCE = ['tag', 'tag', 'nacht', 'nacht', 'schlaf', 'frei', 'frei'];

const DEFAULT_EXERCISES: Array<Pick<Exercise, 'name' | 'discipline' | 'metric' | 'higherIsBetter'>> = [
  { name: 'Kniebeuge', discipline: 'strength', metric: 'weight', higherIsBetter: true },
  { name: 'Kreuzheben', discipline: 'strength', metric: 'weight', higherIsBetter: true },
  { name: 'Bankdrücken', discipline: 'strength', metric: 'weight', higherIsBetter: true },
  { name: 'Schulterdrücken', discipline: 'strength', metric: 'weight', higherIsBetter: true },
  { name: 'Klimmzüge', discipline: 'strength', metric: 'reps', higherIsBetter: true },
  { name: '5 km', discipline: 'run', metric: 'time', higherIsBetter: false },
  { name: '10 km', discipline: 'run', metric: 'time', higherIsBetter: false },
  { name: 'Halbmarathon', discipline: 'run', metric: 'time', higherIsBetter: false },
];

export function defaultSettings(): Settings {
  const ts = now();
  return {
    id: 'singleton',
    displayName: '',
    // Platzhalter — unter Setup mit den eigenen, bereits berechneten Zonen überschreiben.
    hrZones: [
      { zone: 1, label: 'Regeneration', minBpm: 0, maxBpm: 0 },
      { zone: 2, label: 'Grundlage', minBpm: 0, maxBpm: 0 },
      { zone: 3, label: 'Tempo', minBpm: 0, maxBpm: 0 },
      { zone: 4, label: 'Schwelle', minBpm: 0, maxBpm: 0 },
      { zone: 5, label: 'Maximal', minBpm: 0, maxBpm: 0 },
    ],
    maxHr: null,
    restHr: null,
    weeklyTargets: { strength: 3, run: 2, optional: 1 },
    minHoursBetweenKeySessions: 24,
    rescheduleWindowDays: 7,
    confirmRescheduleProposals: true,
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

function defaultPattern(): ShiftPattern {
  const ts = now();
  return {
    id: newId('pat'),
    name: 'Meine Rotation',
    // Auf den Montag dieser Woche verankert, damit der Start nachvollziehbar ist.
    anchorDate: startOfWeek(today()),
    sequence: [...PLACEHOLDER_SEQUENCE],
    active: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Legt Startdaten an, falls noch keine existieren. Mehrfaches Aufrufen ist
 * unschädlich — jede Tabelle wird nur befüllt, wenn sie leer ist.
 */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.settings, db.shiftTypes, db.shiftPatterns, db.exercises, async () => {
    if ((await db.settings.count()) === 0) {
      await db.settings.put(defaultSettings());
    }
    if ((await db.shiftTypes.count()) === 0) {
      await db.shiftTypes.bulkPut(DEFAULT_SHIFT_TYPES);
    }
    if ((await db.shiftPatterns.count()) === 0) {
      await db.shiftPatterns.put(defaultPattern());
    }
    if ((await db.exercises.count()) === 0) {
      const ts = now();
      await db.exercises.bulkPut(
        DEFAULT_EXERCISES.map((e) => ({
          id: newId('ex'),
          ...e,
          archived: false,
          createdAt: ts,
        })),
      );
    }
  });
}

/** Löscht alle lokalen Daten und legt die Startdaten neu an. */
export async function resetAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  await seedIfEmpty();
}
