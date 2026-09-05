/**
 * Erstbefüllung.
 *
 * Läuft bei jedem Start, legt aber nur an, was fehlt. Die Werte stammen aus dem
 * Profil des Nutzers — die App startet nicht leer, sondern mit dem, was schon
 * bekannt ist. Alles davon ist unter Profil änderbar.
 */

import { db } from './db';
import { addDays, startOfWeek, today } from './dates';
import { newId, now } from './ids';
import {
  SCHEMA_VERSION,
  type Exercise,
  type Goal,
  type Habit,
  type Profile,
  type Settings,
  type ShiftType,
  type TrainingPhase,
} from './types';

/* ------------------------------------------------------------------ */
/* Herzfrequenzzonen                                                   */
/* ------------------------------------------------------------------ */

/**
 * Zonen nach Herzfrequenzreserve (Karvonen), nicht nach Prozent der Maximal-HF.
 *
 * Der Unterschied ist bei niedrigem Ruhepuls erheblich: 70 % der Maximal-HF sind
 * für einen trainierten Läufer noch Spazierentempo, 70 % der Reserve treffen die
 * Grundlage. Die Zonen lassen sich einzeln überschreiben — hier steht nur der
 * Startwert.
 */
const ZONE_BOUNDS: Array<[number, number]> = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
];

export function hrZonesFor(maxHr: number, restHr: number) {
  const reserve = Math.max(1, maxHr - restHr);
  const labels = ['Regeneration', 'Grundlage', 'Tempo', 'Schwelle', 'Maximal'];
  return ZONE_BOUNDS.map(([lo, hi], i) => ({
    zone: (i + 1) as 1 | 2 | 3 | 4 | 5,
    label: labels[i],
    minBpm: Math.round(restHr + reserve * lo),
    maxBpm: Math.round(restHr + reserve * hi),
  }));
}

/* ------------------------------------------------------------------ */
/* Schichtarten samt Regeln                                            */
/* ------------------------------------------------------------------ */

/**
 * Die fünf Schichtarten — und was sie erlauben.
 *
 * `maxIntensity` ist die Tabelle aus der Anforderung, hier als Daten statt als
 * Code: Sie lässt sich unter Profil ändern, ohne dass jemand etwas neu baut.
 * Gelesen wird sie mit dem Erholungsstatus des Tages als Schlüssel.
 */
export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  {
    id: 'day',
    name: 'Tagschicht',
    short: 'T',
    startTime: '07:00',
    endTime: '19:00',
    crossesMidnight: false,
    capability: 'none',
    // Auch bei bester Erholung kein Training: Zwölf Stunden plus Anfahrt lassen
    // keinen Reiz zu, der die Erholung wert wäre.
    maxIntensity: { ready: null, moderate: null, low: null },
    sports: ['mobility', 'recovery'],
    maxMinutes: 20,
    trainingWindow: null,
    color: '#F59E0B',
    note: 'Zwölf Stunden. Kein echtes Training — höchstens 20 Minuten Mobility oder Dehnen.',
    cancelsPlanned: false,
    pausesStreaks: false,
    isBuiltIn: true,
    sortOrder: 1,
  },
  {
    id: 'night',
    name: 'Nachtschicht',
    short: 'N',
    startTime: '19:00',
    endTime: '07:00',
    crossesMidnight: true,
    capability: 'moderate',
    // Vor der Schicht ist Zeit, aber der Schlaf 14:00–17:00 ist Pflicht. Was
    // davor liegt, darf den Schlaf nicht kosten.
    maxIntensity: { ready: 'hard', moderate: 'moderate', low: 'easy' },
    sports: ['run', 'bike', 'strength', 'mobility', 'recovery'],
    maxMinutes: 75,
    trainingWindow: '11:00–13:30, vor dem Schlaf',
    color: '#6366F1',
    note: 'Schlaf 14:00–17:00, Schicht ab 19:00. Training davor, danach nichts mehr.',
    cancelsPlanned: false,
    pausesStreaks: false,
    isBuiltIn: true,
    sortOrder: 2,
  },
  {
    id: 'sleep',
    name: 'Schlaftag',
    short: 'S',
    startTime: '08:00',
    endTime: '14:00',
    crossesMidnight: false,
    capability: 'moderate',
    // In erster Linie Regenerationstag. Kein automatischer Trainingstag, auch
    // nicht bei guter Erholung — die Nacht steckt noch in den Knochen.
    maxIntensity: { ready: 'moderate', moderate: 'easy', low: null },
    sports: ['run', 'bike', 'swim', 'strength', 'mobility', 'recovery'],
    maxMinutes: 75,
    trainingWindow: '16:00–19:30, nach dem Schlaf',
    color: '#0EA5E9',
    note: 'Hauptschlaf 08:00–14:00. Vor allem Regeneration; nichts Hartes.',
    cancelsPlanned: false,
    pausesStreaks: false,
    isBuiltIn: true,
    sortOrder: 3,
  },
  {
    id: 'free',
    name: 'Freischicht',
    short: 'F',
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    capability: 'full',
    maxIntensity: { ready: 'hard', moderate: 'moderate', low: 'easy' },
    sports: ['run', 'bike', 'swim', 'strength', 'mobility', 'recovery', 'hike'],
    maxMinutes: 240,
    trainingWindow: 'ganzer Tag',
    color: '#22C55E',
    note: 'Ganzer Tag frei. Hier liegen lange und harte Einheiten — und nur hier ein Doppeltag.',
    cancelsPlanned: false,
    pausesStreaks: false,
    isBuiltIn: true,
    sortOrder: 4,
  },
  {
    id: 'variable',
    name: 'V-Schicht',
    short: 'V',
    startTime: '08:00',
    endTime: '20:00',
    crossesMidnight: false,
    capability: 'short',
    maxIntensity: { ready: 'easy', moderate: 'easy', low: null },
    sports: ['run', 'mobility', 'recovery'],
    maxMinutes: 35,
    trainingWindow: '06:30–07:30 oder abends',
    color: '#F97316',
    note: 'Zwölf Stunden mit wenig Luft. Wenn überhaupt: kurzer Lauf oder Mobility.',
    cancelsPlanned: false,
    pausesStreaks: false,
    isBuiltIn: true,
    sortOrder: 5,
  },
  {
    id: 'vacation',
    name: 'Urlaub',
    short: 'U',
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    capability: 'full',
    maxIntensity: { ready: 'hard', moderate: 'moderate', low: 'easy' },
    sports: ['run', 'bike', 'swim', 'strength', 'mobility', 'recovery', 'hike'],
    maxMinutes: 300,
    trainingWindow: 'ganzer Tag',
    color: '#14B8A6',
    note: 'Frei wie eine Freischicht. Mehr freie Tage heißen nicht mehr Training, sondern bessere Verteilung.',
    cancelsPlanned: false,
    pausesStreaks: true,
    isBuiltIn: true,
    sortOrder: 6,
  },
  {
    id: 'sick',
    name: 'Krank',
    short: 'K',
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    capability: 'none',
    maxIntensity: { ready: null, moderate: null, low: null },
    sports: [],
    maxMinutes: 0,
    trainingWindow: null,
    color: '#A1A1AA',
    note: 'Kein Training. Geplante Einheiten entfallen ersatzlos — nachholen wäre hier die falsche Reaktion.',
    cancelsPlanned: true,
    pausesStreaks: true,
    isBuiltIn: true,
    sortOrder: 7,
  },
];

/** Ein üblicher Durchlauf, nur als Vorschlag zum Vorbelegen. */
export const DEFAULT_SEQUENCE = ['day', 'night', 'sleep', 'free', 'free'];

/* ------------------------------------------------------------------ */
/* Startdaten                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MAX_HR = 196;
const DEFAULT_REST_HR = 50;

export function defaultProfile(): Profile {
  const ts = now();
  return {
    id: 'singleton',
    displayName: '',
    birthYear: new Date().getFullYear() - 24,
    heightCm: 184,
    weightKg: 75,
    restingHr: DEFAULT_REST_HR,
    // 220 − Alter ist grob, aber ein ehrlicher Startwert. Wer seine echte
    // Maximal-HF kennt, trägt sie ein und alle Zonen rechnen sich neu.
    maxHr: DEFAULT_MAX_HR,
    hrZones: hrZonesFor(DEFAULT_MAX_HR, DEFAULT_REST_HR),
    zone2PaceSec: 380, // 6:20 min/km
    best5kSec: 1500, // 25:00
    ftpWatts: 161,
    swimPace100Sec: 120, // 2:00 /100 m
    pullUps: 6,
    pushUps: 30,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function defaultSettings(): Settings {
  const ts = now();
  return {
    id: 'singleton',
    theme: 'system',
    planStartDate: null,
    /**
     * 8 Stunden statt der genannten 10–12.
     *
     * 10–12 h sind das Dach, nicht der Alltag: In einer Woche mit drei
     * Tagschichten sind sie nicht erreichbar. Ein Ziel, das man systematisch
     * verfehlt, taugt nicht als Maßstab — es macht jede Auswertung rot und
     * damit wertlos. Der Wert ist einstellbar und je Phase überschreibbar.
     */
    weeklyMinutesTarget: 480,
    weeklyDaysTarget: 5,
    /**
     * Verteilung für einen Hybrid-Athleten mit Ultra-Ziel: Laufen trägt die
     * Hauptlast, Rad liefert Umfang ohne Aufprall, Kraft hält die Struktur
     * zusammen, Mobility ist die Versicherung.
     */
    sportMix: { run: 45, bike: 20, swim: 5, strength: 22, mobility: 8 },
    maxHardPerWeek: 3,
    maxConsecutiveHardDays: 2,
    rampWarnPct: 25,
    notificationsEnabled: true,
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Startphase: Base über zwölf Wochen — die richtige Antwort auf ein Ultra-Ziel. */
function defaultPhase(): TrainingPhase {
  const ts = now();
  const start = startOfWeek(today());
  return {
    id: newId('phase'),
    kind: 'base',
    name: 'Base',
    startDate: start,
    endDate: addDays(start, 12 * 7 - 1),
    weeklyMinutesTarget: null,
    focus: 'Grundlagenausdauer aufbauen, Kraftbasis halten, Technik sauber.',
    notes:
      'Zwölf Wochen Base sind für ein Ultra-Ziel kein Umweg, sondern die Voraussetzung. Intensität kommt später.',
    createdAt: ts,
    updatedAt: ts,
  };
}

const DEFAULT_EXERCISES: Array<Pick<Exercise, 'name' | 'muscleGroups' | 'metric' | 'higherIsBetter'>> = [
  { name: 'Kniebeuge', muscleGroups: ['Beine', 'Rumpf'], metric: 'weight', higherIsBetter: true },
  { name: 'Kreuzheben', muscleGroups: ['Rücken', 'Beine'], metric: 'weight', higherIsBetter: true },
  { name: 'Bankdrücken', muscleGroups: ['Brust', 'Trizeps'], metric: 'weight', higherIsBetter: true },
  { name: 'Schulterdrücken', muscleGroups: ['Schultern'], metric: 'weight', higherIsBetter: true },
  { name: 'Klimmzüge', muscleGroups: ['Rücken', 'Bizeps'], metric: 'reps', higherIsBetter: true },
  { name: 'Liegestütze', muscleGroups: ['Brust'], metric: 'reps', higherIsBetter: true },
  { name: 'Rudern', muscleGroups: ['Rücken'], metric: 'weight', higherIsBetter: true },
  { name: 'Ausfallschritte', muscleGroups: ['Beine'], metric: 'weight', higherIsBetter: true },
  { name: 'Plank', muscleGroups: ['Rumpf'], metric: 'time', higherIsBetter: true },
];

const DEFAULT_HABITS: Array<Omit<Habit, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'Schlaf',
    kind: 'quantity',
    category: 'sleep',
    unit: 'h',
    target: 7.5,
    minimum: 6.5,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: false,
    active: true,
    sortOrder: 1,
  },
  {
    name: 'Wasser',
    kind: 'quantity',
    category: 'nutrition',
    unit: 'l',
    target: 3,
    minimum: 2,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: false,
    active: true,
    sortOrder: 2,
  },
  {
    name: 'Protein',
    kind: 'quantity',
    category: 'nutrition',
    unit: 'g',
    // 2 g pro kg bei 75 kg. Rechnet sich neu, wenn das Gewicht sich ändert.
    target: 150,
    minimum: 120,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: false,
    active: true,
    sortOrder: 3,
  },
  {
    name: 'Supplements',
    kind: 'check',
    category: 'nutrition',
    unit: '',
    target: null,
    minimum: null,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: false,
    active: true,
    sortOrder: 4,
  },
  {
    name: 'Mobility',
    kind: 'quantity',
    category: 'movement',
    unit: 'min',
    target: 10,
    minimum: 5,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: true,
    active: true,
    sortOrder: 5,
  },
  {
    name: 'Schritte',
    kind: 'quantity',
    category: 'movement',
    unit: '',
    target: 8000,
    minimum: 5000,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: true,
    active: true,
    sortOrder: 6,
  },
  {
    name: 'Kein Social Media vor dem Schlafen',
    kind: 'check',
    category: 'mind',
    unit: '',
    target: null,
    minimum: null,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: false,
    active: true,
    sortOrder: 7,
  },
  {
    name: 'Lesen',
    kind: 'quantity',
    category: 'mind',
    unit: 'min',
    target: 20,
    minimum: 10,
    schedule: { type: 'timesPerWeek', weekdays: null, timesPerWeek: 4 },
    restDayExempt: false,
    active: true,
    sortOrder: 8,
  },
];

/** Die Ziele aus dem Profil — mit dem heutigen Stand als Ausgangswert. */
function defaultGoals(): Goal[] {
  const ts = now();
  const base = { active: true, notes: '', createdAt: ts, updatedAt: ts };
  return [
    {
      id: newId('goal'),
      title: '100 km Ultra',
      kind: 'endurance',
      startValue: 0,
      currentValue: 0,
      targetValue: 100,
      unit: 'km',
      higherIsBetter: true,
      // Ohne genanntes Datum bleibt es offen. Sobald eins steht, richtet sich
      // die Periodisierung danach.
      targetDate: null,
      ...base,
      notes: 'Längster Lauf bisher zählt als Fortschritt. Zieldatum eintragen, sobald es feststeht.',
    },
    {
      id: newId('goal'),
      title: '5 km unter 23 Minuten',
      kind: 'endurance',
      startValue: 1500,
      currentValue: 1500,
      targetValue: 1380,
      unit: 's',
      higherIsBetter: false,
      targetDate: null,
      ...base,
    },
    {
      id: newId('goal'),
      title: '10 Klimmzüge',
      kind: 'strength',
      startValue: 6,
      currentValue: 6,
      targetValue: 10,
      unit: 'Wdh',
      higherIsBetter: true,
      targetDate: null,
      ...base,
    },
    {
      id: newId('goal'),
      title: 'FTP 200 Watt',
      kind: 'endurance',
      startValue: 161,
      currentValue: 161,
      targetValue: 200,
      unit: 'W',
      higherIsBetter: true,
      targetDate: null,
      ...base,
    },
  ];
}

/* ------------------------------------------------------------------ */

const SEED_MARK = 'seed.v1';

/**
 * Legt an, was fehlt. Mehrfaches Aufrufen ist unschädlich.
 *
 * Die Marke in `meta` sorgt dafür, dass gelöschte Startdaten gelöscht bleiben:
 * Wer alle Habits wegwirft, will sie beim nächsten Start nicht wiederhaben.
 */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction(
    'rw',
    [db.profile, db.settings, db.shiftTypes, db.phases, db.exercises, db.habits, db.goals, db.meta],
    async () => {
      if ((await db.profile.count()) === 0) await db.profile.put(defaultProfile());
      if ((await db.settings.count()) === 0) await db.settings.put(defaultSettings());
      if ((await db.shiftTypes.count()) === 0) await db.shiftTypes.bulkPut(DEFAULT_SHIFT_TYPES);
      if ((await db.phases.count()) === 0) await db.phases.put(defaultPhase());

      if (await db.meta.get(SEED_MARK)) return;

      const ts = now();
      if ((await db.exercises.count()) === 0) {
        await db.exercises.bulkPut(
          DEFAULT_EXERCISES.map((e) => ({
            id: newId('ex'),
            ...e,
            archived: false,
            createdAt: ts,
          })),
        );
      }
      if ((await db.habits.count()) === 0) {
        await db.habits.bulkPut(
          DEFAULT_HABITS.map((h) => ({ id: newId('habit'), ...h, createdAt: ts, updatedAt: ts })),
        );
      }
      if ((await db.goals.count()) === 0) await db.goals.bulkPut(defaultGoals());

      await db.meta.put({ key: SEED_MARK, value: true, updatedAt: ts });
    },
  );
}

/** Löscht alles auf diesem Gerät und legt die Startdaten neu an. */
export async function resetAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  await seedIfEmpty();
}
