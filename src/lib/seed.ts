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
import {
  SCHEMA_VERSION,
  type Exercise,
  type Settings,
  type ShiftPattern,
  type ShiftType,
  type Task,
  type TaskEnergy,
} from './types';

/**
 * Abwesenheiten — keine Schichten, aber sie belegen einen Tag genauso.
 *
 * Sie stehen bewusst neben den Schichtarten statt in einem eigenen Konzept:
 * Für die Planung ist die einzige Frage, was an einem Tag geht. Urlaub ist ein
 * voller Tag, Krankheit ist keiner. Alles andere — Rotation überschreiben,
 * Zeitraum setzen, Konflikte erkennen — funktioniert damit unverändert.
 */
export const ABSENCE_SHIFT_TYPES: ShiftType[] = [
  {
    id: 'urlaub',
    name: 'Urlaub',
    short: 'U',
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    capacity: 'full',
    trainingWindow: 'ganzer Tag',
    color: '#14b8a6',
    note: 'Ganzer Tag frei. Zählt wie eine Freischicht — mehr freie Tage heißen aber nicht mehr Training, sondern nur, dass sich dieselben Einheiten sauberer verteilen.',
    cancelsPlanned: false,
    isBuiltIn: true,
    sortOrder: 6,
  },
  {
    id: 'krank',
    name: 'Krank',
    short: 'K',
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    capacity: 'none',
    trainingWindow: null,
    color: '#a1a1aa',
    note: 'Kein Training. Geplante Einheiten an diesen Tagen entfallen ersatzlos, statt auf den nächsten Tag zu rutschen — nachholen wäre hier genau die falsche Reaktion. Sie zählen auch nicht als verpasst.',
    cancelsPlanned: true,
    isBuiltIn: true,
    sortOrder: 7,
  },
];

export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  {
    id: 'tag',
    name: 'Tagschicht',
    short: 'T',
    startTime: '07:00',
    endTime: '19:00',
    crossesMidnight: false,
    capacity: 'none',
    trainingWindow: null,
    color: '#eab308',
    note: '12 Stunden. Danach ist nichts mehr drin — der Tag ist ein Ruhetag.',
    cancelsPlanned: false,
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
    capacity: 'moderate',
    trainingWindow: 'vormittags, vor der Schicht',
    color: '#6366f1',
    note: 'Der Vormittag vor der Schicht ist frei: normales Volumen inklusive Kraft geht, nur nichts, was den Schlaf davor frisst.',
    cancelsPlanned: false,
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
    cancelsPlanned: false,
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
    cancelsPlanned: false,
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
    trainingWindow: 'während der Schicht',
    color: '#f97316',
    note: 'Willkürlich 08:00–20:00, kann kurzfristig vor einer Tagschicht liegen. Gehört deshalb nicht in die Rotation — sie wird auf dem Schicht-Screen als Abweichung für den betroffenen Tag gesetzt. Laufen geht während der Schicht, ins Gym kommt man dabei nicht.',
    cancelsPlanned: false,
    isBuiltIn: true,
    sortOrder: 5,
  },
  ...ABSENCE_SHIFT_TYPES,
];

/**
 * Die tatsächliche Rotation: Tag, Nacht, Schlaftag, frei, frei.
 *
 * Fünf Tage, nicht sieben — der Rhythmus läuft also quer zur Kalenderwoche und
 * deckt sich erst nach 35 Tagen wieder mit ihr. Deshalb hat eine Woche mal zwei
 * und mal drei volle Tage.
 *
 * Die V-Schicht steht bewusst nicht in dieser Folge: sie kommt kurzfristig und
 * wird als Abweichung für den einzelnen Tag gesetzt.
 */
export const DEFAULT_SEQUENCE = ['tag', 'nacht', 'schlaf', 'frei', 'frei'];

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

/**
 * Tägliche Routinen, die ab Werk drinstehen.
 *
 * Bewusst nur Kleinigkeiten, die ohnehin jeden Tag anstehen und nichts kosten
 * außer daran zu denken — genau dafür ist die Liste da. Alles hier lässt sich
 * umbenennen oder löschen; gelöscht bleibt gelöscht.
 */
const DEFAULT_DAILY_ROUTINES: Array<{ title: string; notes: string; energy: TaskEnergy }> = [
  { title: 'Supplements', notes: 'Kreatin, Vitamin D, Magnesium', energy: 'light' },
  { title: '3 Liter trinken', notes: 'An Schichttagen die Flasche mitnehmen.', energy: 'light' },
  { title: 'Proteinziel erreichen', notes: '', energy: 'light' },
  { title: 'Mobility 10 Minuten', notes: 'Hüfte, Brustwirbelsäule, Sprunggelenk.', energy: 'light' },
];

/**
 * Schlüssel in der Meta-Tabelle, der festhält, dass die Routinen schon einmal
 * angelegt wurden. Ohne ihn kämen sie nach jedem Löschen wieder — mit ihm
 * bekommt auch eine bestehende Installation sie einmalig nachgereicht.
 */
const ABSENCE_SHIFTS_SEEDED = 'seed.absenceShifts.v1';
const DAILY_ROUTINES_SEEDED = 'seed.dailyRoutines.v1';

export function defaultSettings(): Settings {
  const ts = now();
  return {
    id: 'singleton',
    displayName: '',
    // Eigene Werte, nach Herzfrequenzreserve berechnet. Unter Setup änderbar.
    hrZones: [
      { zone: 1, label: 'Regeneration', minBpm: 114, maxBpm: 138 },
      { zone: 2, label: 'Grundlage', minBpm: 139, maxBpm: 160 },
      { zone: 3, label: 'Tempo', minBpm: 161, maxBpm: 175 },
      { zone: 4, label: 'Schwelle', minBpm: 176, maxBpm: 190 },
      { zone: 5, label: 'Maximal', minBpm: 191, maxBpm: 205 },
    ],
    maxHr: 205,
    restHr: 49,
    weeklyTargets: { strength: 3, run: 2, optional: 1 },
    planningProfile: 'runFirst',
    // Aus: Die V-Schicht ist die einzige Schichtart mit lockerer Kapazität, und
    // dort geht Laufen während der Schicht — aber kein Gym.
    allowStrengthOnLightDays: false,
    allowDoubleDayPerCycle: true,
    mesoLoadCycles: 4,
    mesoDeloadCycles: 1,
    // Leer: keine Korrektur, der erste Plan fängt bei null an.
    progressionAdjust: {},
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
    sequence: [...DEFAULT_SEQUENCE],
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
  await db.transaction(
    'rw',
    [db.settings, db.shiftTypes, db.shiftPatterns, db.exercises, db.tasks, db.meta],
    async () => {
    if ((await db.settings.count()) === 0) {
      await db.settings.put(defaultSettings());
    } else {
      // Nachgereicht für Installationen von vor der progressiven Steigerung:
      // ohne den Stufenstand fiele jeder neue Plan auf Stufe 0 zurück.
      const existing = await db.settings.get('singleton');
      if (existing && !existing.progressionAdjust) {
        // Der frühere `progressionBase` war ein aufsummierter Zähler und wird
        // bewusst nicht übernommen: die Stufe wird jetzt aus den erledigten
        // Einheiten gezählt, ein Übertrag würde doppelt zählen.
        await db.settings.update('singleton', { progressionAdjust: {}, updatedAt: now() });
      }
    }
    if ((await db.shiftTypes.count()) === 0) {
      await db.shiftTypes.bulkPut(DEFAULT_SHIFT_TYPES);
      await db.meta.put({ key: ABSENCE_SHIFTS_SEEDED, value: true, updatedAt: now() });
    } else if (!(await db.meta.get(ABSENCE_SHIFTS_SEEDED))) {
      // Urlaub und Krank kamen später dazu. An eine Markierung gekoppelt statt
      // an "Tabelle leer": so bekommt sie auch eine bestehende Installation —
      // und wer sie löscht, bekommt sie nicht wieder aufgedrängt.
      const existing = new Set((await db.shiftTypes.toArray()).map((t) => t.id));
      const missing = ABSENCE_SHIFT_TYPES.filter((t) => !existing.has(t.id));
      if (missing.length > 0) await db.shiftTypes.bulkPut(missing);
      await db.meta.put({ key: ABSENCE_SHIFTS_SEEDED, value: true, updatedAt: now() });
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

    // Nicht an "Tabelle leer" gekoppelt, sondern an eine eigene Markierung:
    // So bekommt auch eine Installation, in der schon Aufgaben liegen, die
    // Routinen einmalig nachgereicht — und ein Löschen hält.
    if (!(await db.meta.get(DAILY_ROUTINES_SEEDED))) {
      const ts = now();
      const routines: Task[] = DEFAULT_DAILY_ROUTINES.map((r) => ({
        id: newId('task'),
        kind: 'chore',
        title: r.title,
        notes: r.notes,
        dueDate: null,
        time: null,
        priority: 2,
        energy: r.energy,
        status: 'open',
        recurrence: { kind: 'daily', interval: 1, weekdays: null, dayOfMonth: null },
        templateTaskId: null,
        completedAt: null,
        createdAt: ts,
        updatedAt: ts,
      }));
      await db.tasks.bulkPut(routines);
      await db.meta.put({ key: DAILY_ROUTINES_SEEDED, value: true, updatedAt: ts });
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
