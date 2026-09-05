/**
 * Das Datenmodell — die einzige Wahrheit über die Struktur.
 *
 * Alles liegt lokal im Browser (IndexedDB via Dexie). Kein Server, kein Konto,
 * keine Übertragung. `db.ts`, `backup.ts` und jeder Screen leiten sich von hier
 * ab; wer etwas ändern will, ändert es hier zuerst.
 *
 * Zwei Konventionen ziehen sich durch:
 *
 *   1. **Tage sind Zeichenketten** (`IsoDate`, "2026-09-07"), keine Date-Objekte
 *      und keine UTC-Zeitstempel. Ein Trainingstag ist ein Kalendertag; wer ihn
 *      als Zeitpunkt speichert, verschiebt ihn irgendwann über Mitternacht.
 *   2. **Geplant und tatsächlich stehen nebeneinander.** Nur so lässt sich
 *      später vergleichen, und nur so kann ein Import aus Garmin die Ist-Seite
 *      füllen, ohne den Plan anzufassen.
 */

/** Lokaler Kalendertag, "2026-09-07". */
export type IsoDate = string;
/** Voller Zeitstempel, nur für createdAt/updatedAt. */
export type IsoDateTime = string;

/** Version des Exportformats. Wird bei jeder Modelländerung erhöht. */
export const SCHEMA_VERSION = 1;

/* ================================================================== */
/* Profil und Einstellungen                                            */
/* ================================================================== */

export type HrZoneNumber = 1 | 2 | 3 | 4 | 5;

export interface HrZone {
  zone: HrZoneNumber;
  label: string;
  minBpm: number;
  maxBpm: number;
}

export const ZONE_PURPOSE: Record<HrZoneNumber, string> = {
  1: 'Regeneration',
  2: 'Grundlage',
  3: 'Tempo',
  4: 'Schwelle',
  5: 'Maximal',
};

/**
 * Stammdaten und Leistungswerte. Genau ein Datensatz, id ist "singleton".
 *
 * Die Leistungswerte stehen hier und nicht in den Zielen: Sie beschreiben, wo
 * man **ist**. Wo man hin will, steht in `Goal`.
 */
export interface Profile {
  id: 'singleton';
  displayName: string;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  restingHr: number | null;
  maxHr: number | null;
  hrZones: HrZone[];
  /** Zone-2-Pace in Sekunden pro Kilometer. */
  zone2PaceSec: number | null;
  /** Bestzeit 5 km in Sekunden. */
  best5kSec: number | null;
  ftpWatts: number | null;
  /** Schwimmpace in Sekunden pro 100 m. */
  swimPace100Sec: number | null;
  pullUps: number | null;
  pushUps: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ThemeChoice = 'system' | 'dark' | 'light';

/** Alles, was sich einstellen lassen muss. Genau ein Datensatz. */
export interface Settings {
  id: 'singleton';
  theme: ThemeChoice;
  /** Tag 1 des Plans — Bezugspunkt für Wochenzählung und Phasen. */
  planStartDate: IsoDate | null;
  /** Zielumfang pro Woche in Minuten. Phasen dürfen ihn überschreiben. */
  weeklyMinutesTarget: number;
  /** Zieltage pro Woche mit Training. */
  weeklyDaysTarget: number;
  /** Zielverteilung der Wochenminuten je Sportart, in Prozent. */
  sportMix: Partial<Record<Sport, number>>;
  /** Höchstens so viele harte Einheiten pro Woche. */
  maxHardPerWeek: number;
  /** Höchstens so viele harte Tage direkt hintereinander. */
  maxConsecutiveHardDays: number;
  /** Ab dieser Steigerung gegenüber dem Vierwochenschnitt warnt die App (Prozent). */
  rampWarnPct: number;
  /** Hinweise beim Öffnen der App anzeigen. */
  notificationsEnabled: boolean;
  schemaVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ================================================================== */
/* Schicht                                                             */
/* ================================================================== */

/**
 * Wie viel Training eine Schicht grundsätzlich zulässt.
 *
 * Bewusst getrennt von der Intensität: `capability` sagt, was der **Tag**
 * hergibt, `Intensity` sagt, was der **Körper** hergibt. Erst beides zusammen
 * ergibt eine Empfehlung.
 */
export type ShiftCapability = 'none' | 'short' | 'moderate' | 'full';

export const CAPABILITY_LABEL: Record<ShiftCapability, string> = {
  none: 'Kein Training',
  short: 'Nur kurz',
  moderate: 'Normal',
  full: 'Alles möglich',
};

export type Intensity = 'easy' | 'moderate' | 'hard';

export const INTENSITY_LABEL: Record<Intensity, string> = {
  easy: 'Locker',
  moderate: 'Moderat',
  hard: 'Hart',
};

export const INTENSITY_RANK: Record<Intensity, number> = { easy: 1, moderate: 2, hard: 3 };

/** Belastungsfaktor je Intensität. Basis der gesamten Lastrechnung. */
export const INTENSITY_FACTOR: Record<Intensity, number> = {
  easy: 1.0,
  moderate: 1.7,
  hard: 2.5,
};

export type Recovery = 'ready' | 'moderate' | 'low';

export const RECOVERY_LABEL: Record<Recovery, string> = {
  ready: 'Ready',
  moderate: 'Moderate',
  low: 'Recovery',
};

export const RECOVERY_HINT: Record<Recovery, string> = {
  ready: 'Hartes Training möglich',
  moderate: 'Moderates Training',
  low: 'Regeneration bevorzugen',
};

/**
 * Eine Schichtart — samt der Regel, was sie erlaubt.
 *
 * Die Regel steht an der Schichtart und nicht im Code: Sie muss sich ändern
 * lassen, ohne dass jemand etwas neu baut (Anforderung 10). Der Generator liest
 * `maxIntensity`, `sports` und `window`; er kennt keine Schichtnamen.
 */
export interface ShiftType {
  id: string;
  name: string;
  /** Ein bis zwei Zeichen für Kalenderzellen. */
  short: string;
  /** "HH:MM" oder null bei freien Tagen. */
  startTime: string | null;
  endTime: string | null;
  /** Geht über Mitternacht (Nachtschicht). */
  crossesMidnight: boolean;
  capability: ShiftCapability;
  /**
   * Höchste erlaubte Intensität je Erholungsstufe. `null` heißt Ruhetag.
   * Das ist die Tabelle aus Anforderung 10 — als Daten, nicht als Code.
   */
  maxIntensity: Record<Recovery, Intensity | null>;
  /** Sportarten, die an so einem Tag überhaupt gehen. */
  sports: Sport[];
  /** Realistische Trainingsdauer in Minuten, Obergrenze. */
  maxMinutes: number;
  /** Wann trainiert werden kann, als Klartext: "15:30–18:00". */
  trainingWindow: string | null;
  color: string;
  note: string;
  /** Abwesenheit: geplante Einheiten entfallen ersatzlos statt zu rutschen. */
  cancelsPlanned: boolean;
  /** An solchen Tagen pausieren Habit-Serien, statt zu reißen. */
  pausesStreaks: boolean;
  isBuiltIn: boolean;
  sortOrder: number;
}

/** Welche Schicht an welchem Tag. Primärschlüssel ist das Datum. */
export interface ShiftAssignment {
  date: IsoDate;
  shiftTypeId: string;
  note: string;
  createdAt: IsoDateTime;
}

/** Optionale Rotation zum Vorbelegen ganzer Monate. */
export interface ShiftPattern {
  id: string;
  name: string;
  anchorDate: IsoDate;
  sequence: string[];
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Ergebnis der Auflösung für einen konkreten Tag. */
export interface ResolvedDay {
  date: IsoDate;
  shift: ShiftType;
  /** Kein Eintrag im Dienstplan — anders als "frei". */
  isUnknown: boolean;
  /** Der Vortag war eine Nachtschicht. */
  afterNightShift: boolean;
}

/* ================================================================== */
/* Training                                                            */
/* ================================================================== */

export type Sport = 'run' | 'bike' | 'swim' | 'strength' | 'mobility' | 'recovery' | 'hike';

export const SPORT_LABEL: Record<Sport, string> = {
  run: 'Laufen',
  bike: 'Radfahren',
  swim: 'Schwimmen',
  strength: 'Krafttraining',
  mobility: 'Mobility',
  recovery: 'Regeneration',
  hike: 'Wandern',
};

export const SPORT_ICON: Record<Sport, string> = {
  run: '🏃',
  bike: '🚴',
  swim: '🏊',
  strength: '🏋️',
  mobility: '🧘',
  recovery: '💤',
  hike: '🥾',
};

/** Sportarten, die auf Ausdauer einzahlen. Für Score und Wochenverteilung. */
export const ENDURANCE_SPORTS: Sport[] = ['run', 'bike', 'swim', 'hike'];

/** Belastungsfaktor je Sportart, multiplikativ zur Intensität. */
export const SPORT_LOAD_FACTOR: Record<Sport, number> = {
  run: 1.0,
  bike: 0.85,
  swim: 0.95,
  strength: 1.0,
  mobility: 0.3,
  recovery: 0.3,
  hike: 0.6,
};

export type SessionStatus = 'planned' | 'done' | 'skipped' | 'missed';

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  planned: 'Geplant',
  done: 'Erledigt',
  skipped: 'Gestrichen',
  missed: 'Verpasst',
};

/** Woher eine Einheit kommt — wichtig, sobald Importe dazukommen. */
export type DataSource = 'manual' | 'suggestion' | 'import';

export interface TrainingSession {
  id: string;
  date: IsoDate;
  sport: Sport;
  title: string;
  intensity: Intensity;
  /** Ziel-HF-Zone, null bei Kraft und Mobility. */
  zone: HrZoneNumber | null;
  /** Wozu die Einheit da ist, ein Halbsatz. */
  purpose: string;

  plannedMinutes: number | null;
  plannedDistanceKm: number | null;
  actualMinutes: number | null;
  actualDistanceKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Rate of Perceived Exertion 1–10. */
  rpe: number | null;

  status: SessionStatus;
  notes: string;
  source: DataSource;
  /** Id beim externen Anbieter — für spätere Importe, heute immer null. */
  externalId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ExerciseMetric = 'weight' | 'reps' | 'time' | 'distance';

export interface Exercise {
  id: string;
  name: string;
  muscleGroups: string[];
  metric: ExerciseMetric;
  higherIsBetter: boolean;
  archived: boolean;
  createdAt: IsoDateTime;
}

/** Ein einzelner Satz. Grundlage der Bestwerterkennung. */
export interface StrengthSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  date: IsoDate;
  order: number;
  reps: number | null;
  weightKg: number | null;
  timeSec: number | null;
  distanceM: number | null;
  createdAt: IsoDateTime;
}

/* ================================================================== */
/* Periodisierung                                                      */
/* ================================================================== */

export type PhaseKind = 'base' | 'build' | 'peak' | 'taper';

export const PHASE_LABEL: Record<PhaseKind, string> = {
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
};

export const PHASE_PURPOSE: Record<PhaseKind, string> = {
  base: 'Grundlagenausdauer, Technik, Kraftbasis. Viel Umfang, wenig Intensität.',
  build: 'Mehr Umfang und gezielte Intensität. Hier entsteht die Leistung.',
  peak: 'Spezifische Belastung, wettkampfnah. Umfang zugunsten Qualität zurück.',
  taper: 'Belastung runter, Fitness halten. Erholung ist der Trainingsreiz.',
};

/** Wie sich die Phase auf die Wochenstruktur auswirkt. */
export const PHASE_PROFILE: Record<
  PhaseKind,
  { hardPerWeek: number; longSessionShare: number; strengthPerWeek: number }
> = {
  // Anteil der Wochenminuten, der in die lange Einheit geht.
  base: { hardPerWeek: 1, longSessionShare: 0.3, strengthPerWeek: 2 },
  build: { hardPerWeek: 2, longSessionShare: 0.32, strengthPerWeek: 2 },
  peak: { hardPerWeek: 3, longSessionShare: 0.35, strengthPerWeek: 1 },
  taper: { hardPerWeek: 1, longSessionShare: 0.2, strengthPerWeek: 1 },
};

export interface TrainingPhase {
  id: string;
  kind: PhaseKind;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Überschreibt das Wochenziel aus den Einstellungen. Null: Einstellung gilt. */
  weeklyMinutesTarget: number | null;
  focus: string;
  notes: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ================================================================== */
/* Check-in                                                            */
/* ================================================================== */

/**
 * Die Eingabe des Morgens. Primärschlüssel ist das Datum.
 *
 * Alle Felder dürfen leer sein: Ein Morgen ohne Uhr am Handgelenk ist trotzdem
 * ein Morgen. Was fehlt, wird geschätzt statt erfunden — siehe `recovery.ts`.
 */
export interface DailyCheckIn {
  date: IsoDate;
  sleepHours: number | null;
  /** 1 = schlecht … 5 = sehr gut. */
  sleepQuality: number | null;
  /** 1 = kein Muskelkater … 5 = stark. */
  soreness: number | null;
  /** 1 = entspannt … 5 = hohe Belastung. */
  stress: number | null;
  /** 1 = kraftlos … 5 = voller Energie. */
  motivation: number | null;
  /** WHOOP-Recovery in Prozent. */
  whoopRecovery: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  note: string;
  /** Zeitstempel des Abschlusses; null solange der Check-in offen ist. */
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ================================================================== */
/* Habits                                                              */
/* ================================================================== */

export type HabitKind = 'check' | 'quantity';

export type HabitScheduleType = 'daily' | 'weekdays' | 'timesPerWeek';

export interface HabitSchedule {
  type: HabitScheduleType;
  /** Nur bei `weekdays`: 0 = Sonntag … 6 = Samstag. */
  weekdays: number[] | null;
  /** Nur bei `timesPerWeek`. */
  timesPerWeek: number | null;
}

export type HabitCategory = 'sleep' | 'nutrition' | 'movement' | 'mind' | 'care' | 'other';

export const HABIT_CATEGORY_LABEL: Record<HabitCategory, string> = {
  sleep: 'Schlaf',
  nutrition: 'Ernährung',
  movement: 'Bewegung',
  mind: 'Kopf',
  care: 'Pflege',
  other: 'Sonstiges',
};

export interface Habit {
  id: string;
  name: string;
  kind: HabitKind;
  category: HabitCategory;
  /** Nur bei `quantity`: "g", "l", "h", "Schritte". */
  unit: string;
  /** Zielwert bei `quantity`. */
  target: number | null;
  /** Ab hier zählt der Tag als teilweise erfüllt. Null: nur Ziel zählt. */
  minimum: number | null;
  schedule: HabitSchedule;
  /**
   * An Ruhetagen ausgesetzt: Die Serie reißt nicht, wenn an einem Tag mit
   * Erholungsstatus RECOVERY oder an einer Tagschicht nichts passiert.
   */
  restDayExempt: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface HabitEntry {
  id: string;
  habitId: string;
  date: IsoDate;
  /** Bei `check` 0 oder 1, bei `quantity` der gemessene Wert. */
  value: number;
  note: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ================================================================== */
/* Aufgaben                                                            */
/* ================================================================== */

export type TaskPriority = 1 | 2 | 3;

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  1: 'Wichtig',
  2: 'Normal',
  3: 'Niedrig',
};

export type TaskCategory =
  | 'work'
  | 'private'
  | 'sport'
  | 'nutrition'
  | 'admin'
  | 'learning'
  | 'other';

export const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  work: 'Arbeit',
  private: 'Privat',
  sport: 'Sport',
  nutrition: 'Ernährung',
  admin: 'Organisation',
  learning: 'Lernen',
  other: 'Sonstiges',
};

/** Wie viel der Tag dafür hergeben muss. */
export type TaskEffort = 'quick' | 'focus' | 'heavy';

export const TASK_EFFORT_LABEL: Record<TaskEffort, string> = {
  quick: 'Kurz',
  focus: 'Fokussiert',
  heavy: 'Aufwendig',
};

export type TaskStatus = 'open' | 'done' | 'archived';

export type RecurrenceKind = 'daily' | 'weekly' | 'monthly';

export interface Recurrence {
  kind: RecurrenceKind;
  interval: number;
  weekdays: number[] | null;
  dayOfMonth: number | null;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  priority: TaskPriority;
  category: TaskCategory;
  effort: TaskEffort;
  dueDate: IsoDate | null;
  time: string | null;
  recurrence: Recurrence | null;
  status: TaskStatus;
  /** Optional an einen Habit gekoppelt: Abhaken erfüllt beides. */
  habitId: string | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ================================================================== */
/* Ziele und Bestwerte                                                 */
/* ================================================================== */

export type GoalKind = 'endurance' | 'strength' | 'body' | 'habit' | 'other';

export const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  endurance: 'Ausdauer',
  strength: 'Kraft',
  body: 'Körper',
  habit: 'Alltag',
  other: 'Sonstiges',
};

export interface Goal {
  id: string;
  title: string;
  kind: GoalKind;
  /** Ausgangswert beim Anlegen — ohne ihn wäre kein Fortschritt messbar. */
  startValue: number;
  currentValue: number;
  targetValue: number;
  unit: string;
  /** Bei Zeiten ist kleiner besser. */
  higherIsBetter: boolean;
  targetDate: IsoDate | null;
  active: boolean;
  notes: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type RecordKind =
  | 'run_5k'
  | 'run_10k'
  | 'run_longest'
  | 'bike_longest'
  | 'bike_ftp'
  | 'swim_longest'
  | 'strength_1rm'
  | 'strength_reps'
  | 'week_volume'
  | 'habit_streak';

export const RECORD_LABEL: Record<RecordKind, string> = {
  run_5k: 'Schnellste 5 km',
  run_10k: 'Schnellste 10 km',
  run_longest: 'Längster Lauf',
  bike_longest: 'Längste Radtour',
  bike_ftp: 'Höchste FTP',
  swim_longest: 'Längste Schwimmeinheit',
  strength_1rm: 'Stärkstes Gewicht',
  strength_reps: 'Meiste Wiederholungen',
  week_volume: 'Größte Trainingswoche',
  habit_streak: 'Längste Habit-Serie',
};

export interface PersonalRecord {
  id: string;
  kind: RecordKind;
  /** Bei Kraft die Übung, sonst null. */
  exerciseId: string | null;
  value: number;
  unit: string;
  date: IsoDate;
  previousValue: number | null;
  detail: string;
  createdAt: IsoDateTime;
}

/* ================================================================== */
/* Rückblick und Kleinkram                                             */
/* ================================================================== */

export interface WeeklyReview {
  /** Montag der Woche, Primärschlüssel. */
  weekStart: IsoDate;
  /** Momentaufnahme der Zahlen — damit der Rückblick später noch stimmt. */
  totalMinutes: number;
  runKm: number;
  bikeKm: number;
  swimKm: number;
  strengthSessions: number;
  habitPct: number;
  avgSleepHours: number | null;
  avgRecoveryPct: number | null;
  wentWell: string;
  improve: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Meta {
  key: string;
  value: unknown;
  updatedAt: IsoDateTime;
}
