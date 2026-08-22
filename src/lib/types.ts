/**
 * Cllctr — Datenmodell
 *
 * Alle Daten liegen ausschließlich lokal im Browser (IndexedDB via Dexie).
 * Kein Server, kein Login. Dieses File ist die einzige Wahrheit über die
 * Struktur — db.ts, backup.ts und alle Screens leiten sich davon ab.
 */

/** ISO-Datum ohne Zeit, z.B. "2026-08-21". Immer lokale Kalendertage, nie UTC-Timestamps. */
export type IsoDate = string;
/** Voller ISO-Zeitstempel, z.B. "2026-08-21T06:44:12.000Z". Nur für createdAt/updatedAt. */
export type IsoDateTime = string;

/** Version des Schemas im Export. Wird bei jeder Änderung am Modell hochgezählt. */
export const SCHEMA_VERSION = 5;

/* ------------------------------------------------------------------ */
/* Schicht                                                             */
/* ------------------------------------------------------------------ */

/**
 * Wie viel Training an einem Tag realistisch möglich ist.
 * Der Umplaner kennt nur diese vier Stufen — alles andere leitet sich daraus ab.
 */
export type TrainingCapacity = 'none' | 'light' | 'moderate' | 'full';

export const CAPACITY_RANK: Record<TrainingCapacity, number> = {
  none: 0,
  light: 1,
  moderate: 2,
  full: 3,
};

/** Kurzform für enge Listenzeilen. */
export const CAPACITY_SHORT: Record<TrainingCapacity, string> = {
  none: 'Keins',
  light: 'Locker',
  moderate: 'Normal',
  full: 'Voll',
};

export const CAPACITY_LABEL: Record<TrainingCapacity, string> = {
  none: 'Kein Training',
  light: 'Nur locker',
  moderate: 'Normal, nichts Hartes',
  full: 'Alles möglich',
};

/**
 * Eine Schichtart. Die fünf Standardarten kommen aus dem Seed, du kannst
 * sie umbenennen, Zeiten ändern oder eigene ergänzen.
 */
export interface ShiftType {
  id: string;
  name: string;
  /** Ein bis zwei Zeichen für die Kalenderansicht, z.B. "T", "N", "S". */
  short: string;
  /** "HH:MM" oder null bei freien Tagen. */
  startTime: string | null;
  endTime: string | null;
  /** true, wenn die Schicht über Mitternacht geht (Nachtschicht 19:00–07:00). */
  crossesMidnight: boolean;
  /** Wie viel Training an so einem Tag geht. Kern der Planungslogik. */
  capacity: TrainingCapacity;
  /** Freitext, wann das Zeitfenster liegt — erscheint auf dem Heute-Screen. */
  trainingWindow: string | null;
  /** Tailwind-taugliche Hex-Farbe für die Kalenderansicht. */
  color: string;
  note: string;
  /** Standardarten können nicht gelöscht werden, nur bearbeitet. */
  isBuiltIn: boolean;
  sortOrder: number;
}

/**
 * Die Rotation. sequence wird ab anchorDate endlos wiederholt:
 * Tag N bekommt sequence[(N - anchor) mod sequence.length].
 */
export interface ShiftPattern {
  id: string;
  name: string;
  anchorDate: IsoDate;
  sequence: string[];
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Einzelner Tag, der von der Rotation abweicht (Tausch, Urlaub, krank). */
export interface ShiftOverride {
  /** Primärschlüssel ist das Datum — pro Tag höchstens eine Abweichung. */
  date: IsoDate;
  shiftTypeId: string;
  note: string;
  createdAt: IsoDateTime;
}

/** Ergebnis der Auflösung Rotation + Abweichung für einen konkreten Tag. */
export interface ResolvedShiftDay {
  date: IsoDate;
  shiftType: ShiftType;
  capacity: TrainingCapacity;
  /** true, wenn dieser Tag manuell überschrieben wurde. */
  isOverride: boolean;
  overrideNote: string | null;
  /** true, wenn der Vortag eine Nachtschicht war — beeinflusst die Planung. */
  afterNightShift: boolean;
}

/* ------------------------------------------------------------------ */
/* Training                                                            */
/* ------------------------------------------------------------------ */

export type Discipline = 'run' | 'strength' | 'mobility';

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  run: 'Laufen',
  strength: 'Kraft',
  mobility: 'Mobility',
};

export type SessionTypeKey =
  | 'run_intervals'
  | 'run_tempo'
  | 'run_long'
  | 'run_easy'
  | 'run_recovery'
  | 'strength_upper'
  | 'strength_lower'
  | 'strength_full'
  | 'strength_short'
  | 'mobility';

/**
 * Feste Eigenschaften pro Session-Typ. Bewusst Code und nicht Datenbank:
 * das sind Trainingsregeln, keine Nutzerdaten. Der Umplaner liest hier,
 * was er verschieben muss und was er streichen darf.
 */
export interface SessionTypeMeta {
  key: SessionTypeKey;
  label: string;
  discipline: Discipline;
  /** Key-Session: wird beim Umplanen verschoben, nie gestrichen. */
  isKey: boolean;
  /** Mindestkapazität des Tages, damit diese Session dort liegen darf. */
  minCapacity: TrainingCapacity;
  /**
   * Belastungsgewicht 1–10. Basis für Wochenlast und Deload-Erkennung.
   * Sagt nichts darüber aus, ob der Tag als "hart" zählt — das ist
   * countsAsHardDay.
   */
  load: number;
  /**
   * Zählt für die Regel "keine zwei harten Tage in Folge".
   *
   * Bewusst getrennt von load: Krafttraining ist anstrengend, aber es
   * blockiert den Folgetag nicht so wie eine harte Laufeinheit. Nur Intervalle,
   * Tempolauf und Long Run zählen deshalb als harter Tag.
   */
  countsAsHardDay: boolean;
  /** Standarddauer in Minuten, wenn der Generator nichts Besseres weiß. */
  defaultDurationMin: number;
  /** Ziel-HF-Zone 1–5, null bei Kraft/Mobility. */
  defaultZone: HrZoneNumber | null;
  defaultRpe: number;
}

export const SESSION_TYPES: Record<SessionTypeKey, SessionTypeMeta> = {
  run_intervals: {
    key: 'run_intervals',
    label: 'Intervalle',
    discipline: 'run',
    isKey: true,
    minCapacity: 'full',
    countsAsHardDay: true,
    load: 9,
    defaultDurationMin: 60,
    defaultZone: 4,
    defaultRpe: 8,
  },
  run_tempo: {
    key: 'run_tempo',
    label: 'Tempolauf',
    discipline: 'run',
    isKey: true,
    minCapacity: 'full',
    countsAsHardDay: true,
    load: 7,
    defaultDurationMin: 50,
    defaultZone: 3,
    defaultRpe: 7,
  },
  run_long: {
    key: 'run_long',
    label: 'Long Run',
    discipline: 'run',
    isKey: true,
    minCapacity: 'full',
    countsAsHardDay: true,
    load: 8,
    defaultDurationMin: 90,
    defaultZone: 2,
    defaultRpe: 6,
  },
  run_easy: {
    key: 'run_easy',
    label: 'Lockerer Lauf',
    discipline: 'run',
    isKey: false,
    minCapacity: 'moderate',
    countsAsHardDay: false,
    load: 4,
    defaultDurationMin: 45,
    defaultZone: 2,
    defaultRpe: 4,
  },
  run_recovery: {
    key: 'run_recovery',
    label: 'Recovery Run',
    discipline: 'run',
    isKey: false,
    minCapacity: 'light',
    countsAsHardDay: false,
    load: 2,
    defaultDurationMin: 30,
    defaultZone: 1,
    defaultRpe: 3,
  },
  strength_upper: {
    key: 'strength_upper',
    label: 'Kraft Oberkörper',
    discipline: 'strength',
    isKey: true,
    minCapacity: 'moderate',
    // Bewusst unter der Schwelle für "harter Tag": schweres Oberkörpertraining
    // beeinträchtigt weder den Lauf noch die Beinarbeit am Folgetag. Läge der
    // Wert darüber, würde die Regel gegen zwei harte Tage in Folge diese Einheit
    // dauerhaft blockieren — die beiden freien Tage liegen ja nebeneinander.
    countsAsHardDay: false,
    load: 6,
    defaultDurationMin: 60,
    defaultZone: null,
    defaultRpe: 7,
  },
  strength_lower: {
    key: 'strength_lower',
    label: 'Kraft Unterkörper',
    discipline: 'strength',
    isKey: true,
    // Ein halber Tag reicht: schwere Beinarbeit passt an den Schlaftag ab 15:00
    // ebenso wie an den Vormittag vor der Nachtschicht. Nur die harten
    // Laufeinheiten brauchen wirklich einen ganzen Tag.
    minCapacity: 'moderate',
    countsAsHardDay: false,
    load: 9,
    defaultDurationMin: 65,
    defaultZone: null,
    defaultRpe: 8,
  },
  strength_full: {
    key: 'strength_full',
    label: 'Kraft Ganzkörper',
    discipline: 'strength',
    isKey: true,
    minCapacity: 'moderate',
    countsAsHardDay: false,
    load: 7,
    defaultDurationMin: 55,
    defaultZone: null,
    defaultRpe: 7,
  },
  strength_short: {
    key: 'strength_short',
    label: 'Kraft kurz',
    discipline: 'strength',
    isKey: false,
    minCapacity: 'light',
    countsAsHardDay: false,
    load: 4,
    defaultDurationMin: 35,
    defaultZone: null,
    defaultRpe: 5,
  },
  mobility: {
    key: 'mobility',
    label: 'Mobility',
    discipline: 'mobility',
    isKey: false,
    minCapacity: 'light',
    countsAsHardDay: false,
    load: 1,
    defaultDurationMin: 25,
    defaultZone: null,
    defaultRpe: 2,
  },
};

export type MacrocycleGoalKind = 'event' | 'yearRound';

export interface Macrocycle {
  id: string;
  name: string;
  goalKind: MacrocycleGoalKind;
  startDate: IsoDate;
  /** null bei ganzjähriger Planung ohne festes Ende. */
  endDate: IsoDate | null;
  targetEventName: string | null;
  targetEventDate: IsoDate | null;
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type MesoFocus = 'base' | 'build' | 'peak' | 'taper' | 'maintain';
export type MesoEmphasis = 'run' | 'strength' | 'balanced';
export type CycleStatus = 'planned' | 'active' | 'done';

export interface Mesocycle {
  id: string;
  macrocycleId: string;
  /** 1-basiert, fortlaufend innerhalb des Makrozyklus. */
  index: number;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Anzahl Belastungs-Zyklen (nicht Wochen — siehe Microcycle). */
  loadCycles: number;
  deloadCycles: number;
  focus: MesoFocus;
  emphasis: MesoEmphasis;
  status: CycleStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Wochenziele als Anzahl Sessions — nicht als Wochentage. Wegen Schicht. */
export interface WeeklyTargets {
  strength: number;
  run: number;
  optional: number;
}

/**
 * Ein Mikrozyklus ist bei Cllctr **ein Durchlauf der Schichtrotation**, nicht eine
 * Kalenderwoche. Bei einer 5-Tage-Rotation sind das fünf Tage.
 *
 * Grund: Nur so ist jeder Zyklus gleich aufgebaut und die Belastung schwankt nicht
 * zufällig damit, wie die Rotation gerade in der Woche liegt. Angezeigt wird der
 * Fortschritt trotzdem in Wochen — das rechnet die Oberfläche um.
 */
export interface Microcycle {
  id: string;
  mesocycleId: string;
  /** 1-basiert innerhalb des Mesozyklus. */
  index: number;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Länge des Zyklus in Tagen, entspricht der Länge der Rotation. */
  lengthDays: number;
  isDeload: boolean;
  targetSessions: WeeklyTargets;
  /** Summe der load-Werte aller geplanten Sessions. Basis für Deload-Erkennung. */
  plannedLoad: number;
  /** Stufenstand je Einheitsart zu Beginn dieses Zyklus. */
  progression: Record<string, number>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type SessionStatus = 'planned' | 'done' | 'missed' | 'skipped' | 'moved';

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  planned: 'Geplant',
  done: 'Erledigt',
  missed: 'Verpasst',
  skipped: 'Gestrichen',
  moved: 'Verschoben',
};

/** Ein Block innerhalb einer Session, z.B. "6x 800m" / "Zone 4, 2 Min Trabpause". */
export interface SessionBlock {
  label: string;
  detail: string;
}

export type HrZoneNumber = 1 | 2 | 3 | 4 | 5;

export interface Session {
  id: string;
  microcycleId: string;
  date: IsoDate;
  /**
   * Position innerhalb des Tages, 1-basiert. Normalerweise 1 — an einem
   * Doppeltag gibt es zusätzlich eine 2.
   */
  orderInDay: number;
  discipline: Discipline;
  type: SessionTypeKey;
  title: string;
  plannedDurationMin: number | null;
  plannedDistanceKm: number | null;
  zone: HrZoneNumber | null;
  targetRpe: number | null;
  /** Kopie aus SESSION_TYPES, damit manuelle Änderungen das überschreiben können. */
  isKey: boolean;
  load: number;
  /**
   * Stufe der progressiven Steigerung, mit der diese Einheit geplant wurde.
   * 0 ist die erste Einheit dieser Art überhaupt. Wird mitgespeichert, damit
   * eine Einheit auch nach einer Planänderung noch erklärt, wo sie herkommt.
   */
  progressionStep: number;
  /** Was sich gegenüber der letzten Stufe ändert — ein Halbsatz. */
  progressionNote: string | null;
  content: SessionBlock[];
  status: SessionStatus;
  /** Ursprungsdatum, falls die Session verschoben wurde. */
  originalDate: IsoDate | null;
  /** Warum die App so umgeplant hat — wird dem Nutzer angezeigt. */
  rescheduleReason: string | null;
  /** Vom Nutzer fixiert: der Umplaner fasst diese Session nicht an. */
  locked: boolean;
  manuallyEdited: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type SessionFeeling = 'good' | 'ok' | 'bad';

export interface SessionLog {
  id: string;
  sessionId: string;
  date: IsoDate;
  completed: boolean;
  /** 1–10, null wenn nicht angegeben. */
  rpe: number | null;
  durationMin: number | null;
  distanceKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  feeling: SessionFeeling | null;
  note: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Übungen & Bestwerte                                                */
/* ------------------------------------------------------------------ */

/** Womit die Leistung dieser Übung gemessen wird. */
export type ExerciseMetric = 'weight' | 'time' | 'distance' | 'reps';

export interface Exercise {
  id: string;
  name: string;
  discipline: Discipline;
  metric: ExerciseMetric;
  /** true, wenn bei dieser Übung ein höherer Wert besser ist (Gewicht ja, Zeit nein). */
  higherIsBetter: boolean;
  archived: boolean;
  createdAt: IsoDateTime;
}

/** Ein einzelner Satz bzw. Versuch. Grundlage der automatischen PR-Erkennung. */
export interface SetEntry {
  id: string;
  sessionLogId: string | null;
  exerciseId: string;
  date: IsoDate;
  weightKg: number | null;
  reps: number | null;
  timeSec: number | null;
  distanceM: number | null;
  note: string;
  createdAt: IsoDateTime;
}

export type PrKind = 'weight' | 'estimated1rm' | 'time' | 'distance' | 'reps';

export interface PersonalRecord {
  id: string;
  exerciseId: string;
  kind: PrKind;
  value: number;
  unit: string;
  date: IsoDate;
  setEntryId: string | null;
  /** Vorheriger Bestwert, damit die App "+2,5 kg" anzeigen kann. */
  previousValue: number | null;
  note: string;
  createdAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

/** Energiebedarf einer Aufgabe. Wird gegen die Tagesbelastung gematcht. */
export type TaskEnergy = 'light' | 'focus' | 'hard';

export const TASK_ENERGY_LABEL: Record<TaskEnergy, string> = {
  light: 'Leicht',
  focus: 'Fokussiert',
  hard: 'Anstrengend',
};

/** 1 ist am wichtigsten. */
export type TaskPriority = 1 | 2 | 3;

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  1: 'Hoch',
  2: 'Mittel',
  3: 'Niedrig',
};

/**
 * Haushalt oder Termin.
 *
 * Der Unterschied ist nicht kosmetisch: Ein Termin liegt fest und wird immer
 * angezeigt, egal wie der Tag aussieht. Eine Haushaltsaufgabe ist verschiebbar
 * und wird deshalb nur vorgeschlagen, wenn die Energie des Tages dazu passt.
 */
export type TaskKind = 'chore' | 'appointment';

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  chore: 'Haushalt',
  appointment: 'Termin',
};

export type TaskStatus = 'open' | 'done' | 'archived';
export type RecurrenceKind = 'daily' | 'weekly' | 'monthly';

export interface Recurrence {
  kind: RecurrenceKind;
  /** Alle N Tage/Wochen/Monate. */
  interval: number;
  /** Nur bei weekly: 0=Sonntag … 6=Samstag. */
  weekdays: number[] | null;
  /** Nur bei monthly: 1–31. */
  dayOfMonth: number | null;
}

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  notes: string;
  dueDate: IsoDate | null;
  /** Uhrzeit "HH:MM", nur bei Terminen. */
  time: string | null;
  priority: TaskPriority;
  energy: TaskEnergy;
  status: TaskStatus;
  recurrence: Recurrence | null;
  /** Bei wiederkehrenden Tasks: Verweis auf die Vorlage. */
  templateTaskId: string | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Soul Collector                                                      */
/* ------------------------------------------------------------------ */

export type SoulRarity = 'common' | 'rare' | 'legendary';

export const RARITY_LABEL: Record<SoulRarity, string> = {
  common: 'Gewöhnlich',
  rare: 'Selten',
  legendary: 'Legendär',
};

export type SoulSourceKind =
  | 'mesocycle'
  | 'microcycle'
  | 'pr'
  | 'volume'
  | 'streak'
  | 'comeback'
  | 'event'
  | 'manual';

export interface Soul {
  id: string;
  /** Stabiler Schlüssel der Seelen-Definition, z.B. "first_mesocycle". */
  key: string;
  name: string;
  description: string;
  rarity: SoulRarity;
  collectedAt: IsoDateTime;
  sourceKind: SoulSourceKind;
  /** Id des auslösenden Objekts (Mesozyklus, PR, …). */
  sourceId: string | null;
  /** Freitext-Detail, z.B. "Kniebeuge 120 kg". */
  detail: string;
}

/* ------------------------------------------------------------------ */
/* Einstellungen                                                       */
/* ------------------------------------------------------------------ */

/**
 * Wer die knappen vollen Tage bekommt. Weil pro Rotationszyklus nur zwei Tage
 * volle Belastung zulassen, entscheidet dieses Profil faktisch über die
 * Volumenverteilung zwischen Laufen und Kraft.
 */
export type PlanningProfile = 'runFirst' | 'strengthFirst' | 'balanced';

export const PLANNING_PROFILE_LABEL: Record<PlanningProfile, string> = {
  runFirst: 'Laufen hat Vorrang',
  strengthFirst: 'Kraft hat Vorrang',
  balanced: 'Abwechselnd',
};

export interface HrZone {
  zone: HrZoneNumber;
  label: string;
  minBpm: number;
  maxBpm: number;
}

/** Genau ein Datensatz, id ist immer "singleton". */
export interface Settings {
  id: 'singleton';
  displayName: string;
  /** Selbst eingetragene Zonen — die App rechnet nichts aus, sie übernimmt. */
  hrZones: HrZone[];
  maxHr: number | null;
  restHr: number | null;
  weeklyTargets: WeeklyTargets;
  planningProfile: PlanningProfile;
  /**
   * Erlaubt kurze Krafteinheiten (35 Min) an Schichttagen. Ohne das lässt sich
   * ein Kraftziel von 3×/Woche mit dieser Rotation nicht erreichen.
   */
  allowStrengthOnLightDays: boolean;
  /**
   * Erlaubt höchstens einen Doppeltag pro Zyklus: zwei Einheiten an einem
   * freien Tag, immer eine Kraft- und eine Laufeinheit. Wird nur als Ausweg
   * genutzt, wenn sonst etwas ausfallen oder verkürzt werden müsste.
   */
  allowDoubleDayPerCycle: boolean;
  /** Zyklen pro Mesozyklus: Belastung und anschließender Deload. */
  mesoLoadCycles: number;
  mesoDeloadCycles: number;
  /**
   * Erreichte Stufe je Einheitsart, über Pläne hinweg.
   *
   * Ein neuer Plan setzt hier auf, statt wieder bei null anzufangen — erhöht
   * wird aber nur um die Einheiten, die auch wirklich erledigt wurden. Leer
   * bedeutet: alles auf Stufe 0.
   */
  progressionBase: Record<string, number>;
  /** Zwei harte Tage dürfen nicht direkt aufeinanderfolgen. */
  minHoursBetweenKeySessions: number;
  /** Wie viele Tage der Umplaner nach vorne suchen darf. */
  rescheduleWindowDays: number;
  /** Vorschlagen statt automatisch anwenden. */
  confirmRescheduleProposals: boolean;
  schemaVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Schlüssel-Wert-Ablage für Kleinkram (letzter Export, Onboarding-Status …). */
export interface AppMeta {
  key: string;
  value: unknown;
  updatedAt: IsoDateTime;
}
