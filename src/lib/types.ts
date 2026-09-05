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
export const SCHEMA_VERSION = 13;

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
 * Welche der fünf Schichtarten das hier ist — unabhängig davon, wie sie heißt.
 *
 * Die Regeln hängen nicht am Namen und nicht an der Kapazität, sondern an der
 * Art des Tages: eine V-Schicht erlaubt Laufen, aber kein Gym, obwohl sie
 * zeitlich einer Tagschicht gleicht. Wer eine Schichtart umbenennt, ändert
 * damit nicht, wie sie geplant wird — dafür ist diese Marke da.
 */
export type ShiftKind = 'day' | 'night' | 'sleep' | 'free' | 'variable' | 'off';

export const SHIFT_KIND_LABEL: Record<ShiftKind, string> = {
  day: 'Tagschicht',
  night: 'Nachtschicht',
  sleep: 'Schlaftag',
  free: 'Freischicht',
  variable: 'V-Schicht',
  off: 'Kein Training',
};

/**
 * Die drei Intensitäten. Der ganze Plan besteht aus nichts anderem:
 * Die Schicht und die Erholung sagen, welche Intensität ein Tag verträgt,
 * und erst danach wird entschieden, welche Einheit das konkret wird.
 */
export type Intensity = 'hard' | 'medium' | 'easy';

export const INTENSITY_LABEL: Record<Intensity, string> = {
  hard: 'Hart',
  medium: 'Mittel',
  easy: 'Locker',
};

export const INTENSITY_RANK: Record<Intensity, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

export const INTENSITY_RPE: Record<Intensity, string> = {
  hard: 'RPE 8–10',
  medium: 'RPE 6–7',
  easy: 'RPE 3–5',
};

/* ------------------------------------------------------------------ */
/* Erholung                                                            */
/* ------------------------------------------------------------------ */

/**
 * Erholungszustand des Tages. Steht in der Priorität **über** der Schicht:
 * Ein freier Tag mit schlechter Erholung ist kein harter Tag.
 *
 * **Wird nicht eingetragen, sondern geschätzt.** Aus den Zahlen, die für den Tag
 * vorliegen — Recovery, Schlaf, HRV, Ruhepuls — leitet `recovery.ts` diese
 * Stufe ab. Eine Auswahl "niedrig/mittel/hoch" von Hand wäre eine zweite
 * Wahrheit neben den Messwerten, und bei jedem Widerspruch wüsste niemand,
 * welche gilt.
 */
export type Recovery = 'low' | 'mid' | 'high';

export const RECOVERY_LABEL: Record<Recovery, string> = {
  low: 'Niedrig',
  mid: 'Mittel',
  high: 'Hoch',
};

/** Grobe Schlafschuld der letzten Tage. */
export type SleepDebt = 'none' | 'some' | 'high';

export const SLEEP_DEBT_LABEL: Record<SleepDebt, string> = {
  none: 'Keine',
  some: 'Etwas',
  high: 'Groß',
};

export const DEFAULT_RECOVERY: Recovery = 'mid';
export const DEFAULT_SLEEP_DEBT: SleepDebt = 'none';

/**
 * WHOOPs Recovery-Prozent in die drei Stufen der Planung.
 *
 * Die Grenzen sind nicht erfunden, sondern WHOOPs eigene Farbbereiche: rot bis
 * 33, gelb bis 66, grün darüber. Eigene Schwellen zu setzen hieße, der Zahl auf
 * dem Handgelenk zu widersprechen — und dann stünde in der App etwas anderes
 * als auf der Uhr.
 */
export function recoveryFromPct(pct: number): Recovery {
  if (pct <= 33) return 'low';
  if (pct <= 66) return 'mid';
  return 'high';
}

/**
 * WHOOPs Sleep Debt in Stunden in die drei Stufen.
 *
 * Unter einer Stunde ist Rauschen. Ab drei Stunden fehlt eine halbe Nacht —
 * das ist der Punkt, ab dem die Regeln hartes Training ausschließen.
 */
export function sleepDebtFromHours(hours: number): SleepDebt {
  if (hours < 1) return 'none';
  if (hours < 3) return 'some';
  return 'high';
}

/**
 * Was an einem Tag **gemessen** wurde.
 *
 * Nur Zahlen, keine Einschätzungen: Erholung und Schlafschuld stehen bewusst
 * nicht hier, sie werden aus diesen Werten abgeleitet (`recovery.ts`). Eine
 * gespeicherte Stufe würde veralten, sobald sich die persönliche Basislinie
 * verschiebt — dann stünde in der Datenbank eine Einschätzung, die aus Zahlen
 * stammt, die inzwischen etwas anderes bedeuten.
 *
 * Die Werte liegen flach nebeneinander und nicht in einem `whoop`-Block: Ob
 * eine Zahl von der Uhr kommt oder von Hand geschätzt ist, ändert nichts daran,
 * was sie aussagt.
 *
 * Pro Tag höchstens ein Datensatz, Primärschlüssel ist das Datum. Alle Felder
 * dürfen leer sein.
 */
export interface DayReadiness {
  date: IsoDate;
  /** Schlafdauer der letzten Nacht in Stunden. */
  sleepHours: number | null;
  /** Recovery in Prozent, 0–100 — WHOOPs eigener Wert. */
  recoveryPct: number | null;
  /** Sleep Debt in Stunden, wie WHOOP sie ausweist. */
  sleepDebtHours: number | null;
  /** Day Strain 0–21. Verlauf; geht nicht in die Schätzung ein. */
  strain: number | null;
  /** Herzfrequenzvariabilität in Millisekunden. */
  hrvMs: number | null;
  /** Ruhepuls. */
  restingHr: number | null;
  /**
   * Wann der Check-in erledigt wurde, null solange er offen ist.
   *
   * Getrennt von "es steht eine Zahl drin": Ein Tag ohne Recovery-Wert kann
   * trotzdem abgeschlossen sein — nicht jeden Morgen liegt die Uhr bereit. Der
   * Zeitstempel sagt "ich habe hingeschaut", die Werte sagen, was dabei
   * herauskam. Ohne diese Trennung hinge der offene Check-in ewig am Bildschirm.
   */
  checkedInAt: IsoDateTime | null;
  /** Wann der Check-out erledigt wurde. */
  checkedOutAt: IsoDateTime | null;
  /** Freitext aus dem Check-out: wie der Tag war. */
  note: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Die messbaren Felder eines Tages, in der Reihenfolge der Eingabe. */
export const MEASUREMENT_KEYS = [
  'recoveryPct',
  'sleepHours',
  'sleepDebtHours',
  'strain',
  'hrvMs',
  'restingHr',
] as const;

export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

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
  /**
   * Welche der fünf Schichtarten das ist. Bestimmt die Regeln — die Kapazität
   * ist nur noch die grobe Kurzfassung davon für Anzeige und Filter.
   */
  kind: ShiftKind;
  /** Freitext, wann das Zeitfenster liegt — erscheint auf dem Heute-Screen. */
  trainingWindow: string | null;
  /** Tailwind-taugliche Hex-Farbe für die Kalenderansicht. */
  color: string;
  note: string;
  /**
   * Abwesenheit: geplante Einheiten an solchen Tagen **entfallen**, statt
   * umgeplant zu werden.
   *
   * Der Unterschied zu einer Schicht ohne Kapazität ist die Absicht. Fällt ein
   * freier Tag einer Tagschicht zum Opfer, will man die Einheit retten. Ist man
   * krank, will man sie loswerden — sie am nächsten Tag nachzuholen wäre genau
   * die falsche Reaktion.
   */
  cancelsPlanned: boolean;
  /**
   * An solchen Tagen pausiert der Weg: eine Serie reißt nicht, zählt aber auch
   * nicht weiter.
   *
   * Getrennt von `cancelsPlanned`, weil Urlaub und Krankheit sich beim Training
   * unterscheiden (im Urlaub trainiert man, krank nicht), beim Alltag aber
   * gleich verhalten — an beiden Tagen läuft der normale Ablauf nicht.
   */
  pausesRoutines: boolean;
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

/**
 * Alle Einheitsarten, sortiert nach Disziplin und Intensität.
 *
 * Die alten Schlüssel bleiben bestehen, auch wo neuere sie fachlich ablösen:
 * Sie stehen in erledigten Einheiten im Logbuch, und Verlauf wird nicht
 * umgeschrieben.
 */
export type SessionTypeKey =
  // Ausdauer hart
  | 'run_intervals'
  | 'run_threshold'
  | 'run_tempo'
  | 'run_long'
  // Ausdauer mittel
  | 'run_long_easy'
  | 'run_steady'
  | 'run_progressive'
  // Ausdauer locker
  | 'run_easy'
  | 'run_recovery'
  | 'walk'
  // Kraft hart
  | 'strength_heavy'
  | 'strength_lower'
  // Kraft mittel
  | 'strength_hypertrophy'
  | 'strength_upper'
  | 'strength_full'
  // Kraft/Mobility locker
  | 'strength_short'
  | 'strength_technique'
  | 'mobility';

/**
 * Feste Eigenschaften pro Session-Typ. Bewusst Code und nicht Datenbank:
 * das sind Trainingsregeln, keine Nutzerdaten.
 */
export interface SessionTypeMeta {
  key: SessionTypeKey;
  label: string;
  discipline: Discipline;
  /**
   * Die Intensität. Der Kern der neuen Planung: Erst entscheiden Schicht und
   * Erholung, welche Intensität ein Tag verträgt, dann wird aus den Einheiten
   * dieser Intensität eine ausgewählt.
   */
  intensity: Intensity;
  /** Key-Session: wird beim Umplanen verschoben, nie gestrichen. */
  isKey: boolean;
  /** Mindestkapazität des Tages. Nur noch für die manuelle Auswahl im Plan. */
  minCapacity: TrainingCapacity;
  /** Belastungsgewicht 1–10. Basis für Wochenlast und Deload-Erkennung. */
  load: number;
  /**
   * Zählt für die Regeln "höchstens 3 harte Einheiten pro Woche" und
   * "nie mehr als 2 harte Tage in Folge".
   *
   * Deckt sich jetzt mit `intensity === 'hard'`: Nach den neuen Regeln zählt
   * auch schweres Krafttraining als harter Tag, nicht mehr nur harte Läufe.
   */
  countsAsHardDay: boolean;
  /** Standarddauer in Minuten, wenn der Generator nichts Besseres weiß. */
  defaultDurationMin: number;
  /** Ziel-HF-Zone 1–5, null bei Kraft/Mobility. */
  defaultZone: HrZoneNumber | null;
  defaultRpe: number;
  /** Ein Halbsatz, was diese Einheit ist — steht in der Auswahl unter dem Namen. */
  description: string;
}

type SessionTypeDef = Omit<SessionTypeMeta, 'key' | 'countsAsHardDay'>;

const SESSION_TYPE_DEFS: Record<SessionTypeKey, SessionTypeDef> = {
  /* ---- Ausdauer hart: RPE 8–10 ---- */
  run_intervals: {
    label: 'Intervalle',
    discipline: 'run',
    intensity: 'hard',
    isKey: true,
    minCapacity: 'full',
    load: 9,
    defaultDurationMin: 60,
    defaultZone: 4,
    defaultRpe: 8,
    description: 'Kurze harte Abschnitte mit Trabpause.',
  },
  run_threshold: {
    label: 'Schwellenlauf',
    discipline: 'run',
    intensity: 'hard',
    isKey: true,
    minCapacity: 'full',
    load: 8,
    defaultDurationMin: 55,
    defaultZone: 4,
    defaultRpe: 8,
    description: 'Lange Blöcke knapp unter der Schwelle.',
  },
  run_tempo: {
    label: 'Tempolauf',
    discipline: 'run',
    intensity: 'hard',
    isKey: true,
    minCapacity: 'full',
    load: 7,
    defaultDurationMin: 50,
    defaultZone: 3,
    defaultRpe: 7,
    description: 'Zügiger Block am Stück, kontrolliert hart.',
  },
  run_long: {
    label: 'Long Run mit Endbeschleunigung',
    discipline: 'run',
    intensity: 'hard',
    isKey: true,
    minCapacity: 'full',
    load: 8,
    defaultDurationMin: 90,
    defaultZone: 2,
    defaultRpe: 7,
    description: 'Langer Lauf, die letzten Kilometer forciert.',
  },

  /* ---- Ausdauer mittel: RPE 6–7 ---- */
  run_long_easy: {
    label: 'Langer Lauf locker',
    discipline: 'run',
    intensity: 'medium',
    isKey: true,
    minCapacity: 'moderate',
    load: 6,
    defaultDurationMin: 80,
    defaultZone: 2,
    defaultRpe: 6,
    description: 'Lang, aber durchgehend ruhig — kein Endspurt.',
  },
  run_steady: {
    label: 'Zügiger Dauerlauf',
    discipline: 'run',
    intensity: 'medium',
    isKey: false,
    minCapacity: 'moderate',
    load: 5,
    defaultDurationMin: 55,
    defaultZone: 3,
    defaultRpe: 6,
    description: '40–70 Minuten in gleichmäßig zügigem Tempo.',
  },
  run_progressive: {
    label: 'Steigerungslauf',
    discipline: 'run',
    intensity: 'medium',
    isKey: false,
    minCapacity: 'moderate',
    load: 5,
    defaultDurationMin: 50,
    defaultZone: 3,
    defaultRpe: 6,
    description: 'Ruhig anfangen, Abschnitt für Abschnitt schneller.',
  },

  /* ---- Ausdauer locker: RPE 3–5 ---- */
  run_easy: {
    label: 'Lockerer Lauf',
    discipline: 'run',
    intensity: 'easy',
    isKey: false,
    minCapacity: 'light',
    load: 4,
    defaultDurationMin: 45,
    defaultZone: 2,
    defaultRpe: 4,
    description: '20–50 Minuten im Wohlfühltempo.',
  },
  run_recovery: {
    label: 'Regenerationslauf',
    discipline: 'run',
    intensity: 'easy',
    isKey: false,
    minCapacity: 'light',
    load: 2,
    defaultDurationMin: 30,
    defaultZone: 1,
    defaultRpe: 3,
    description: 'Bewusst langsam, nur um in Bewegung zu bleiben.',
  },
  walk: {
    label: 'Spaziergang',
    discipline: 'mobility',
    intensity: 'easy',
    isKey: false,
    minCapacity: 'light',
    load: 1,
    defaultDurationMin: 40,
    defaultZone: 1,
    defaultRpe: 2,
    description: '20–60 Minuten gehen. Zählt als Erholung, nicht als Training.',
  },

  /* ---- Kraft hart: RPE 8–10 ---- */
  strength_heavy: {
    label: 'Kraft schwer',
    discipline: 'strength',
    intensity: 'hard',
    isKey: true,
    minCapacity: 'moderate',
    load: 10,
    defaultDurationMin: 70,
    defaultZone: null,
    defaultRpe: 9,
    description: 'Ganzkörper, schwere Grundübungen nahe ans Limit.',
  },
  strength_lower: {
    label: 'Kraft Unterkörper',
    discipline: 'strength',
    intensity: 'hard',
    isKey: true,
    minCapacity: 'moderate',
    load: 9,
    defaultDurationMin: 65,
    defaultZone: null,
    defaultRpe: 8,
    description: 'Beinlastig und schwer — der harte Krafttag.',
  },

  /* ---- Kraft mittel: RPE 6–7 ---- */
  strength_hypertrophy: {
    label: 'Kraft Hypertrophie',
    discipline: 'strength',
    intensity: 'medium',
    isKey: true,
    minCapacity: 'moderate',
    load: 6,
    defaultDurationMin: 60,
    defaultZone: null,
    defaultRpe: 7,
    description: 'Moderates Gewicht, mehr Wiederholungen, zwei bis drei Sätze Reserve.',
  },
  strength_upper: {
    label: 'Kraft Oberkörper',
    discipline: 'strength',
    intensity: 'medium',
    isKey: true,
    minCapacity: 'moderate',
    load: 6,
    defaultDurationMin: 60,
    defaultZone: null,
    defaultRpe: 7,
    description: 'Drücken und Ziehen, schont die Beine für den Lauftag.',
  },
  strength_full: {
    label: 'Kraft Ganzkörper',
    discipline: 'strength',
    intensity: 'medium',
    isKey: true,
    minCapacity: 'moderate',
    load: 7,
    defaultDurationMin: 55,
    defaultZone: null,
    defaultRpe: 7,
    description: 'Alles einmal, nichts ausgereizt.',
  },

  /* ---- Kraft & Mobility locker: RPE 3–5 ---- */
  strength_short: {
    label: 'Kraft kurz',
    discipline: 'strength',
    intensity: 'easy',
    isKey: false,
    minCapacity: 'light',
    load: 4,
    defaultDurationMin: 35,
    defaultZone: null,
    defaultRpe: 5,
    description: 'Halbe Stunde, hält die Gewohnheit.',
  },
  strength_technique: {
    label: 'Technik & leichte Kraft',
    discipline: 'strength',
    intensity: 'easy',
    isKey: false,
    minCapacity: 'light',
    load: 3,
    defaultDurationMin: 35,
    defaultZone: null,
    defaultRpe: 4,
    description: 'Bewegungen sauber machen, kein Gewicht ausreizen.',
  },
  mobility: {
    label: 'Mobility',
    discipline: 'mobility',
    intensity: 'easy',
    isKey: false,
    minCapacity: 'light',
    load: 1,
    defaultDurationMin: 25,
    defaultZone: null,
    defaultRpe: 2,
    description: 'Hüfte, Brustwirbelsäule, Sprunggelenk.',
  },
};

/**
 * Die Einheitsarten mit abgeleiteten Feldern.
 *
 * `countsAsHardDay` wird nicht mehr einzeln gepflegt, sondern aus der
 * Intensität abgeleitet — sonst könnten die beiden auseinanderlaufen und die
 * Regel "höchstens 3 harte Einheiten" hinge an einer zweiten Wahrheit.
 */
export const SESSION_TYPES: Record<SessionTypeKey, SessionTypeMeta> = Object.fromEntries(
  (Object.keys(SESSION_TYPE_DEFS) as SessionTypeKey[]).map((key) => [
    key,
    {
      ...SESSION_TYPE_DEFS[key],
      key,
      countsAsHardDay: SESSION_TYPE_DEFS[key].intensity === 'hard',
    },
  ]),
) as Record<SessionTypeKey, SessionTypeMeta>;

/** Alle Arten dieser Intensität, in der Reihenfolge des Katalogs. */
export function typesWithIntensity(intensity: Intensity): SessionTypeKey[] {
  return (Object.keys(SESSION_TYPES) as SessionTypeKey[]).filter(
    (k) => SESSION_TYPES[k].intensity === intensity,
  );
}

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
  /**
   * Fingerabdruck der Eingaben, aus denen dieser Plan entstand.
   *
   * Weicht er vom aktuellen ab, beschreibt der Plan eine Woche, die es nicht
   * mehr gibt — dann passt sich der Plan selbst an. Leer bei Plänen, die vor
   * dieser Automatik erzeugt wurden.
   */
  inputFingerprint: string;
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

/**
 * Das Wochenziel des Hybrid-Athleten. Anzahl Einheiten, nicht Wochentage —
 * welcher Tag welche Einheit bekommt, entscheidet die Schicht.
 *
 * Bewusst als Richtwert und nicht als Pflicht: Eine Woche mit drei Tagschichten
 * gibt die Einheiten schlicht nicht her, und dann ist weniger richtig.
 */
export interface WeeklyTargets {
  /** Krafteinheiten pro Woche. Davon `strengthHard` schwer, der Rest mittel. */
  strength: number;
  /** Harte Ausdauereinheiten pro Woche (Intervalle, Schwelle, Tempo, Long Run). */
  run: number;
  /** Lockere Ausdauertage pro Woche. Spanne 1–3, hier steht der Zielwert. */
  optional: number;
  /**
   * Obergrenze harter Einheiten pro Woche — Ausdauer und Kraft zusammen.
   * Harte Grenze, kein Richtwert: Was darüber läge, wird locker geplant.
   */
  maxHardPerWeek: number;
  /** Wie viele der Krafteinheiten schwer sein sollen. Üblich: eine. */
  strengthHard: number;
}

/**
 * Ein Mikrozyklus ist eine **Kalenderwoche**, Montag bis Sonntag.
 *
 * Früher war es ein Durchlauf der Schichtrotation. Das passte, solange der Plan
 * aus der Rotation entstand. Die Regeln zählen aber in Wochen — höchstens drei
 * harte Einheiten pro Woche, Wochenkilometer plus 5–10 % pro Woche, Deload alle
 * vier bis sechs Wochen. Ein Zyklus, der quer zur Woche liegt, könnte keine
 * dieser Regeln sauber einhalten.
 */
export interface Microcycle {
  id: string;
  mesocycleId: string;
  /** 1-basiert innerhalb des Mesozyklus. */
  index: number;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Länge in Tagen. 7, außer bei der angebrochenen ersten Woche. */
  lengthDays: number;
  /** Geplante harte Einheiten dieser Woche. Nie mehr als maxHardPerWeek. */
  plannedHard: number;
  /** Geplante Trainingsminuten. Grundlage für die Steigerung von Woche zu Woche. */
  plannedMinutes: number;
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
  /**
   * Kopie aus SESSION_TYPES. Mitgespeichert, damit eine erledigte Einheit auch
   * dann noch sagt, wie hart sie war, wenn der Katalog sich später ändert.
   */
  intensity: Intensity;
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
  /**
   * Zählt diese Einheit für die Stufe, sobald sie erledigt ist?
   *
   * Falsch bei Deload- und Ersatzformen: dort wird bewusst unter dem Stand
   * trainiert, das ist kein Fortschritt. Steht auf der Einheit statt am
   * Zyklus, damit die Stufe auch aus Einheiten zählbar bleibt, deren Zyklus
   * längst ersetzt wurde.
   */
  countsForProgression: boolean;
  content: SessionBlock[];
  status: SessionStatus;
  /** Ursprungsdatum, falls die Session verschoben wurde. */
  originalDate: IsoDate | null;
  /** Warum die App so umgeplant hat — wird dem Nutzer angezeigt. */
  rescheduleReason: string | null;
  /**
   * Warum an diesem Tag genau diese Intensität steht — ein Satz aus dem
   * Regelwerk, z.B. "Nachtschicht bei hoher Erholung: hart möglich".
   */
  planReason: string | null;
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
  /** Bereich des Wegs, zu dem diese Aufgabe gehört. Null: freie Aufgabe. */
  wayArea: string | null;
  /**
   * Position im Bereich. Bei Schritten die Stufe, ab der sie dazukommen;
   * bei Brocken null — die liegen einfach da.
   */
  wayOrder: number | null;
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
  /**
   * Tag 1 des Plans — ab wann gezählt wird.
   *
   * Zwei Dinge hängen daran: die Nummerierung ("Tag 34, Woche 5") und der
   * Blockrhythmus, also wo die Deload-Wochen liegen. Beides muss fest im
   * Kalender stehen, weil der Plan sich täglich neu rechnet: Zählte er seine
   * eigenen Wochen, rückte die Deload-Woche jeden Tag weiter und käme nie an.
   *
   * Wird beim ersten Plan auf den Starttag gesetzt und lässt sich unter Setup
   * ändern — etwa, wenn der Aufbau erst nächsten Montag richtig losgeht.
   */
  planStartDate: IsoDate | null;
  /** Zyklen pro Mesozyklus: Belastung und anschließender Deload. */
  mesoLoadCycles: number;
  mesoDeloadCycles: number;
  /**
   * Manuelle Korrektur der Stufe je Einheitsart, positiv wie negativ.
   *
   * Die Stufe selbst wird **gezählt**, nicht gespeichert: sie ergibt sich aus
   * den erledigten Einheiten. Nur so geht sie auch wieder herunter, wenn man
   * eine zurücknimmt. Diese Korrektur ist der Griff daneben — für den
   * Einstieg auf einem höheren Niveau oder zum Zurücksetzen nach einem
   * Fehleintrag. Leer heißt: keine Korrektur.
   */
  progressionAdjust: Record<string, number>;
  /**
   * Passt sich der Plan von selbst an, wenn sich Schichten oder Ziele ändern?
   *
   * An heißt: nach einem Schichttausch steht der Plan schon richtig da, ohne
   * dass man ihn neu erzeugen muss. Aus heißt: die App wartet auf den Knopf.
   */
  autoUpdatePlan: boolean;
  /**
   * Wie viele harte Tage direkt aufeinanderfolgen dürfen. Standard 2 — die
   * Regel aus dem Regelwerk. Der dritte harte Tag in Folge wird nie geplant.
   */
  maxConsecutiveHardDays: number;
  /**
   * Um wie viel Prozent das Wochenvolumen höchstens wachsen darf, wenn die
   * Erholung mitspielt. 5–10 % ist der brauchbare Bereich; darüber holt der
   * Körper die Steigerung nicht mehr ein.
   */
  weeklyVolumeGrowthPct: number;
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

/* ------------------------------------------------------------------ */
/* Der Weg                                                             */
/* ------------------------------------------------------------------ */

/**
 * Ein Bereich des Wegs — Hygiene, Schlaf, Ernährung, Haushalt.
 *
 * `locked` heißt: noch nicht dran. `active` ist die aktuelle Etappe, an der
 * gearbeitet wird. `established` sind die Bereiche davor: ihre Routinen laufen
 * weiter, aber sie stehen nicht mehr im Vordergrund. Es gibt immer höchstens
 * einen aktiven Bereich — das ist der Kern der Idee, einen nach dem anderen.
 */
export type WayAreaStatus = 'locked' | 'active' | 'established';

export interface WayArea {
  key: string;
  name: string;
  /** Feste Reihenfolge; kleiner kommt früher. */
  order: number;
  status: WayAreaStatus;
  /**
   * Wie weit der Bereich aufgebaut ist: Stufe 0 heißt ein einziger Schritt,
   * jede weitere Stufe bringt einen dazu. Sinkt nie.
   */
  level: number;
  startedAt: IsoDate | null;
  establishedAt: IsoDate | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
