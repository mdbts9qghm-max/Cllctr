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
    kind: 'free',
    trainingWindow: 'ganzer Tag',
    color: '#14b8a6',
    note: 'Ganzer Tag frei. Zählt wie eine Freischicht — mehr freie Tage heißen aber nicht mehr Training, sondern nur, dass sich dieselben Einheiten sauberer verteilen. Der Weg pausiert an diesen Tagen: die Serie reißt nicht.',
    cancelsPlanned: false,
    pausesRoutines: true,
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
    kind: 'off',
    trainingWindow: null,
    color: '#a1a1aa',
    note: 'Kein Training. Geplante Einheiten an diesen Tagen entfallen ersatzlos, statt auf den nächsten Tag zu rutschen — nachholen wäre hier genau die falsche Reaktion. Sie zählen auch nicht als verpasst.',
    cancelsPlanned: true,
    pausesRoutines: true,
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
    kind: 'day',
    trainingWindow: null,
    color: '#eab308',
    note: '12 Stunden. Kein Training: Schlaf, Regeneration, höchstens ein Spaziergang. Dafür genug essen — der Tag kostet Energie.',
    cancelsPlanned: false,
    pausesRoutines: false,
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
    kind: 'night',
    trainingWindow: '15:30–18:00, vor der Schicht',
    color: '#6366f1',
    note: 'Das Fenster liegt zwischen 15:30 und 18:00, danach nichts mehr. Bei hoher Erholung ist eine harte Einheit möglich, sonst mittel oder locker.',
    cancelsPlanned: false,
    pausesRoutines: false,
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
    kind: 'sleep',
    trainingWindow: '16:00–19:30',
    color: '#0ea5e9',
    note: 'Tag nach der Nachtschicht, Hauptschlaf 08:00–14:00. In erster Linie Regenerationstag: bei hoher Erholung mittel, sonst locker oder frei.',
    cancelsPlanned: false,
    pausesRoutines: false,
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
    kind: 'free',
    trainingWindow: 'ganzer Tag',
    color: '#22c55e',
    note: 'Kompletter Tag frei. Hier liegen die harten Einheiten — aber nur, wenn die Erholung sie hergibt.',
    cancelsPlanned: false,
    pausesRoutines: false,
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
    kind: 'variable',
    trainingWindow: 'während der Schicht',
    color: '#f97316',
    note: 'Willkürlich 08:00–20:00, kann kurzfristig vor einer Tagschicht liegen. Gehört deshalb nicht in die Rotation — sie wird auf dem Schicht-Screen als Abweichung für den betroffenen Tag gesetzt. Laufen geht während der Schicht, ins Gym kommt man dabei nicht.',
    cancelsPlanned: false,
    pausesRoutines: false,
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
/**
 * Markiert, dass die Schichtarten ihre Art (`kind`) und die neuen
 * Trainingsfenster bekommen haben. Ohne die Art wüsste das Regelwerk nicht, ob
 * ein Tag eine V-Schicht oder ein Schlaftag ist — es fiele auf die Kapazität
 * zurück und plante gröber, als es müsste.
 */
const SHIFT_KINDS_SEEDED = 'seed.shiftKinds.v1';
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
    weeklyTargets: { strength: 2, run: 2, optional: 2, maxHardPerWeek: 3, strengthHard: 1 },
    planningProfile: 'runFirst',
    // Aus: Die V-Schicht ist die einzige Schichtart mit lockerer Kapazität, und
    // dort geht Laufen während der Schicht — aber kein Gym.
    allowStrengthOnLightDays: false,
    allowDoubleDayPerCycle: true,
    // Leer: Der Anker wird beim ersten Plan auf die dann laufende Woche gesetzt.
    // Leer: wird beim ersten Plan auf den Starttag gesetzt.
    planStartDate: null,
    mesoLoadCycles: 4,
    mesoDeloadCycles: 1,
    // Leer: keine Korrektur, der erste Plan fängt bei null an.
    progressionAdjust: {},
    autoUpdatePlan: true,
    // Zwei harte Tage in Folge sind erlaubt, drei nie.
    maxConsecutiveHardDays: 2,
    // Mitte des brauchbaren Bereichs von 5–10 %.
    weeklyVolumeGrowthPct: 8,
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
    [db.settings, db.shiftTypes, db.shiftPatterns, db.exercises, db.tasks, db.meta, db.wayAreas],
    async () => {
    if ((await db.settings.count()) === 0) {
      await db.settings.put(defaultSettings());
    } else {
      // Nachgereicht für Installationen von vor der progressiven Steigerung:
      // ohne den Stufenstand fiele jeder neue Plan auf Stufe 0 zurück.
      const existing = await db.settings.get('singleton');
      if (existing && existing.autoUpdatePlan === undefined) {
        await db.settings.update('singleton', { autoUpdatePlan: true, updatedAt: now() });
      }
      // Die neuen Regelgrenzen kamen mit dem Regelwerk dazu. Ohne sie stünde
      // in `maxHardPerWeek` undefined und jede harte Einheit fiele durch die
      // Prüfung — der Plan hätte gar keine mehr.
      if (existing && existing.maxConsecutiveHardDays === undefined) {
        await db.settings.update('singleton', {
          maxConsecutiveHardDays: 2,
          weeklyVolumeGrowthPct: 8,
          weeklyTargets: {
            strength: existing.weeklyTargets?.strength ?? 2,
            run: existing.weeklyTargets?.run ?? 2,
            optional: existing.weeklyTargets?.optional ?? 2,
            maxHardPerWeek: existing.weeklyTargets?.maxHardPerWeek ?? 3,
            strengthHard: existing.weeklyTargets?.strengthHard ?? 1,
          },
          updatedAt: now(),
        });
      }
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

    // Art und Trainingsfenster kamen mit dem neuen Regelwerk dazu. Nachgereicht
    // für die Standardarten; eigene Schichtarten bekommen die Art aus ihrer
    // Kapazität und lassen sich unter Setup korrigieren.
    if (!(await db.meta.get(SHIFT_KINDS_SEEDED))) {
      const byId = new Map(DEFAULT_SHIFT_TYPES.map((t) => [t.id, t]));
      const patched = (await db.shiftTypes.toArray())
        .filter((t) => t.kind === undefined)
        .map((t) => {
          const std = byId.get(t.id);
          if (std) {
            // Name, Farbe und eigene Notizen bleiben — geändert wird nur, was
            // die Regeln brauchen.
            return { ...t, kind: std.kind, trainingWindow: std.trainingWindow };
          }
          const kind =
            t.capacity === 'none' ? 'off' : t.capacity === 'full' ? 'free' : t.capacity === 'light' ? 'variable' : 'sleep';
          return { ...t, kind: kind as ShiftType['kind'] };
        });
      if (patched.length > 0) await db.shiftTypes.bulkPut(patched);
      await db.meta.put({ key: SHIFT_KINDS_SEEDED, value: true, updatedAt: now() });
    }

    // Die Marke, ob eine Schichtart den Weg pausiert, kam später dazu. Ohne sie
    // würde jeder Urlaubstag als Lücke in der Serie zählen.
    const withoutFlag = (await db.shiftTypes.toArray()).filter(
      (t) => t.pausesRoutines === undefined,
    );
    if (withoutFlag.length > 0) {
      await db.shiftTypes.bulkPut(
        withoutFlag.map((t) => ({
          ...t,
          pausesRoutines: t.cancelsPlanned || t.id === 'urlaub',
        })),
      );
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
        wayArea: null,
        wayOrder: null,
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
