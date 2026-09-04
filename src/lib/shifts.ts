/**
 * Schichtauflösung — die Grundlage der gesamten Planung.
 *
 * Cllctr plant nicht auf Wochentage, sondern auf Kapazität. Für jeden
 * Kalendertag wird hier bestimmt, welche Schicht anliegt und wie viel
 * Training an diesem Tag überhaupt möglich ist.
 *
 * Reihenfolge der Auflösung:
 *   1. Gibt es für den Tag eine manuelle Abweichung? Die gewinnt immer.
 *   2. Sonst: Position in der aktiven Rotation ab deren anchorDate.
 *   3. Gibt es keine aktive Rotation, gilt der Tag als frei.
 */

import { addDays, dateRange, daysBetween, mod, startOfWeek } from './dates';
import { shiftAllowance, shiftKindOf } from './rules';
import {
  CAPACITY_RANK,
  SESSION_TYPES,
  type IsoDate,
  type ResolvedShiftDay,
  type SessionTypeKey,
  type ShiftOverride,
  type ShiftPattern,
  type ShiftType,
  type TrainingCapacity,
} from './types';

export interface ShiftContext {
  shiftTypes: ShiftType[];
  pattern: ShiftPattern | null;
  overrides: ShiftOverride[];
}

interface IndexedContext {
  typesById: Map<string, ShiftType>;
  overridesByDate: Map<IsoDate, ShiftOverride>;
  pattern: ShiftPattern | null;
  fallback: ShiftType;
}

/**
 * Der Tag, für den nichts eingetragen ist.
 *
 * Ohne Rotation ist ein leerer Tag keine Freischicht, sondern schlicht
 * unbekannt — und was man nicht kennt, verplant man nicht. Deshalb `none`:
 * der Plan reicht so weit wie der eingetragene Schichtplan, keinen Tag weiter.
 */
export const UNPLANNED_SHIFT: ShiftType = {
  id: '__unplanned',
  name: 'Nicht eingetragen',
  short: '–',
  startTime: null,
  endTime: null,
  crossesMidnight: false,
  capacity: 'none',
  kind: 'off',
  trainingWindow: null,
  color: '#3f3f46',
  note: 'Für diesen Tag steht noch keine Schicht. Trag sie ein, dann schlägt der Plan etwas vor.',
  cancelsPlanned: false,
  pausesRoutines: false,
  isBuiltIn: false,
  sortOrder: 998,
};

/** Notnagel, falls eine Schichtart fehlt oder gelöscht wurde. */
const UNKNOWN_SHIFT: ShiftType = {
  id: '__unknown',
  name: 'Unbekannt',
  short: '?',
  startTime: null,
  endTime: null,
  crossesMidnight: false,
  capacity: 'full',
  kind: 'free',
  trainingWindow: null,
  color: '#3f3f46',
  note: 'Keine Schichtart hinterlegt — der Tag wird als frei behandelt.',
  cancelsPlanned: false,
  pausesRoutines: false,
  isBuiltIn: false,
  sortOrder: 999,
};

function indexContext(ctx: ShiftContext): IndexedContext {
  return {
    typesById: new Map(ctx.shiftTypes.map((t) => [t.id, t])),
    overridesByDate: new Map(ctx.overrides.map((o) => [o.date, o])),
    pattern: ctx.pattern && ctx.pattern.sequence.length > 0 ? ctx.pattern : null,
    // Mit Rotation ist ein Tag ohne Eintrag ein freier Tag. Ohne Rotation ist er
    // schlicht nicht eingetragen — und wird deshalb auch nicht verplant.
    fallback:
      ctx.pattern && ctx.pattern.sequence.length > 0
        ? (ctx.shiftTypes.find((t) => t.capacity === 'full') ?? UNKNOWN_SHIFT)
        : UNPLANNED_SHIFT,
  };
}

/** Welche Schichtart fällt laut Rotation/Abweichung auf diesen Tag? */
function shiftTypeForDate(date: IsoDate, idx: IndexedContext): { type: ShiftType; isOverride: boolean; note: string | null } {
  const override = idx.overridesByDate.get(date);
  if (override) {
    return {
      type: idx.typesById.get(override.shiftTypeId) ?? idx.fallback,
      isOverride: true,
      note: override.note || null,
    };
  }

  if (!idx.pattern) {
    return { type: idx.fallback, isOverride: false, note: null };
  }

  const offset = daysBetween(idx.pattern.anchorDate, date);
  const position = mod(offset, idx.pattern.sequence.length);
  const typeId = idx.pattern.sequence[position];
  return {
    type: idx.typesById.get(typeId) ?? idx.fallback,
    isOverride: false,
    note: null,
  };
}

/** Löst einen einzelnen Tag auf. */
export function resolveShiftDay(date: IsoDate, ctx: ShiftContext): ResolvedShiftDay {
  const idx = indexContext(ctx);
  return resolveWithIndex(date, idx);
}

function resolveWithIndex(date: IsoDate, idx: IndexedContext): ResolvedShiftDay {
  const { type, isOverride, note } = shiftTypeForDate(date, idx);
  const previous = shiftTypeForDate(addDays(date, -1), idx);

  return {
    date,
    shiftType: type,
    capacity: type.capacity,
    isOverride,
    overrideNote: note,
    afterNightShift: previous.type.crossesMidnight,
  };
}

/**
 * Löst einen ganzen Zeitraum auf. Für Wochen- und Kalenderansichten —
 * baut den Index nur einmal statt pro Tag.
 */
export function resolveShiftRange(start: IsoDate, end: IsoDate, ctx: ShiftContext): ResolvedShiftDay[] {
  const idx = indexContext(ctx);
  return dateRange(start, end).map((date) => resolveWithIndex(date, idx));
}

/** Darf dieser Session-Typ an einem Tag mit dieser Kapazität liegen? */
export function capacityAllows(capacity: TrainingCapacity, type: SessionTypeKey): boolean {
  return CAPACITY_RANK[capacity] >= CAPACITY_RANK[SESSION_TYPES[type].minCapacity];
}

/**
 * Alle Session-Typen, die an diesem Tag möglich wären.
 *
 * `allowStrengthOnLightDays` wird mitgeführt, damit die Anzeige nicht etwas
 * verspricht, das der Generator ohnehin nie einplant — an der V-Schicht geht
 * Laufen während der Schicht, aber man kommt nicht ins Gym.
 */
export function allowedSessionTypes(
  capacity: TrainingCapacity,
  allowStrengthOnLightDays = true,
): SessionTypeKey[] {
  return (Object.keys(SESSION_TYPES) as SessionTypeKey[]).filter((key) => {
    if (!capacityAllows(capacity, key)) return false;
    if (
      capacity === 'light' &&
      !allowStrengthOnLightDays &&
      SESSION_TYPES[key].discipline === 'strength'
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Kurze Begründung für den Nutzer, warum an diesem Tag nur begrenzt
 * trainiert werden kann. Erscheint auf dem Heute-Screen.
 */
export function capacityExplanation(day: ResolvedShiftDay): string {
  const { shiftType, capacity, afterNightShift } = day;

  if (capacity === 'none') {
    // Datumsneutral formuliert: der Satz steht auch über künftigen Tagen in
    // der Schichtvorschau und im Plan, nicht nur über dem heutigen.
    return `${shiftType.name} — an diesem Tag ist kein Training eingeplant.`;
  }

  const window = shiftType.trainingWindow ? ` (${shiftType.trainingWindow})` : '';

  if (afterNightShift && capacity !== 'full') {
    return `${shiftType.name} nach Nachtschicht${window} — nichts Hartes, der Körper holt Schlaf nach.`;
  }
  if (capacity === 'light') {
    return `${shiftType.name}${window} — nur eine kurze, lockere Einheit.`;
  }
  if (capacity === 'moderate') {
    return `${shiftType.name}${window} — normales Volumen, aber keine Key-Session.`;
  }
  return `${shiftType.name} — voller Tag, alles möglich.`;
}

/* ------------------------------------------------------------------ */
/* Machbarkeit                                                         */
/* ------------------------------------------------------------------ */

export interface CapacityBudget {
  /** Betrachteter Zeitraum in Tagen. */
  days: number;
  /** Länge der Rotation in Tagen, null ohne aktive Rotation. */
  cycleLength: number | null;
  /** Tage je Kapazitätsstufe, hochgerechnet auf eine Woche. */
  perWeek: Record<TrainingCapacity, number>;
  /**
   * Volle Tage in einer einzelnen Kalenderwoche — Minimum und Maximum.
   * Läuft die Rotation quer zur Woche, liegen diese Werte auseinander,
   * und genau das muss die Planung aushalten.
   */
  fullDaysPerWeek: { min: number; max: number };
}

/**
 * Wie viele Tage welcher Kapazität die Rotation liefert.
 *
 * Betrachtet 35 Tage: das ist das kleinste gemeinsame Vielfache von einer
 * 5-Tage-Rotation und der 7-Tage-Woche, also der Zeitraum, nach dem sich das
 * Muster gegenüber dem Kalender wiederholt.
 */
export function weeklyCapacityBudget(
  start: IsoDate,
  ctx: ShiftContext,
  days = 35,
): CapacityBudget {
  const weekStart = startOfWeek(start);
  const weeks = Math.max(1, Math.round(days / 7));
  const resolved = resolveShiftRange(weekStart, addDays(weekStart, weeks * 7 - 1), ctx);

  const counts: Record<TrainingCapacity, number> = { none: 0, light: 0, moderate: 0, full: 0 };
  for (const day of resolved) counts[day.capacity] += 1;

  // Volle Tage je Kalenderwoche einzeln zählen.
  const fullPerWeek: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const slice = resolved.slice(w * 7, w * 7 + 7);
    fullPerWeek.push(slice.filter((d) => d.capacity === 'full').length);
  }

  return {
    days: weeks * 7,
    cycleLength: ctx.pattern && ctx.pattern.sequence.length > 0 ? ctx.pattern.sequence.length : null,
    perWeek: {
      none: counts.none / weeks,
      light: counts.light / weeks,
      moderate: counts.moderate / weeks,
      full: counts.full / weeks,
    },
    fullDaysPerWeek: {
      min: Math.min(...fullPerWeek),
      max: Math.max(...fullPerWeek),
    },
  };
}

export type FeasibilityVerdict = 'fits' | 'tight' | 'impossible';

export interface FeasibilityCheck {
  verdict: FeasibilityVerdict;
  /** Kernaussage in einem Satz. */
  headline: string;
  /** Ergänzende Hinweise. */
  messages: string[];
  budget: CapacityBudget;
}

/**
 * Passen die Wochenziele zu den eingetragenen Schichten?
 *
 * Gerechnet wird mit **mittlerer Erholung** — dem Normalfall. Bei hoher
 * Erholung ginge mehr, bei niedriger weniger; ein Machbarkeitscheck, der vom
 * besten Fall ausgeht, verspricht etwas, das im Alltag nie eintritt.
 *
 * Gezählt werden zwei Dinge getrennt: Tage, die eine harte Einheit tragen, und
 * Tage, an denen überhaupt Krafttraining möglich ist. Die V-Schicht ist der
 * Grund für die Trennung — sie ist ein Trainingstag, aber keiner fürs Gym.
 */
export function checkFeasibility(
  start: IsoDate,
  ctx: ShiftContext,
  targets: { strength: number; run: number; optional: number },
): FeasibilityCheck {
  const budget = weeklyCapacityBudget(start, ctx);
  const messages: string[] = [];
  const round = (n: number) => Math.round(n * 10) / 10;

  const weekStart = startOfWeek(start);
  const weeks = Math.max(1, Math.round(budget.days / 7));
  const resolved = resolveShiftRange(weekStart, addDays(weekStart, weeks * 7 - 1), ctx);

  // Bei hoher Erholung — der Tag, an dem eine harte Einheit überhaupt möglich
  // wäre. Bei mittlerer Erholung fällt sie auf mittel zurück; das ist gewollt
  // und kein Mangel des Schichtplans.
  const hardCapable = (day: ResolvedShiftDay) =>
    !day.shiftType.cancelsPlanned && shiftAllowance(shiftKindOf(day), 'high').cap === 'hard';
  const liftCapable = (day: ResolvedShiftDay) => {
    const a = shiftAllowance(shiftKindOf(day), 'mid');
    return !day.shiftType.cancelsPlanned && a.cap !== null && a.disciplines.includes('strength');
  };

  const hardPerWeek: number[] = [];
  const liftPerWeek: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const slice = resolved.slice(w * 7, w * 7 + 7);
    hardPerWeek.push(slice.filter(hardCapable).length);
    liftPerWeek.push(slice.filter(liftCapable).length);
  }

  const min = Math.min(...hardPerWeek);
  const max = Math.max(...hardPerWeek);
  // Harte Einheiten insgesamt: harte Läufe plus die eine schwere Krafteinheit.
  const needHard = targets.run + 1;

  let verdict: FeasibilityVerdict;
  let headline: string;

  if (min >= needHard) {
    verdict = 'fits';
    headline = `Passt: jede Woche bringt mindestens ${min} Tage, die eine harte Einheit tragen — gebraucht werden ${needHard}.`;
  } else if (max >= needHard) {
    verdict = 'tight';
    headline =
      `Knapp: je nach Woche hast du ${min} oder ${max} Tage für harte Einheiten, gebraucht werden ${needHard}. ` +
      `In den schwachen Wochen fällt eine davon auf mittel zurück.`;
  } else {
    verdict = 'impossible';
    headline =
      `Geht nicht auf: keine Woche bringt mehr als ${max} Tage für harte Einheiten, ` +
      `für ${targets.run}× harte Ausdauer plus einen schweren Krafttag bräuchte es ${needHard}.`;
  }

  if (budget.cycleLength !== null && 7 % budget.cycleLength !== 0) {
    messages.push(
      `Deine Rotation ist ${budget.cycleLength} Tage lang, die Kalenderwoche 7. ` +
        `Dadurch verschiebt sie sich Woche für Woche und deckt sich erst nach ` +
        `${(budget.cycleLength * 7) / gcd(budget.cycleLength, 7)} Tagen wieder mit ihr. ` +
        `Ein starres Wochenprogramm kann es deshalb nicht geben — die Planung muss pro Woche mitgehen.`,
    );
  }

  const liftDays = liftPerWeek.reduce((a, b) => a + b, 0) / weeks;
  if (liftDays < targets.strength) {
    messages.push(
      `${targets.strength} Krafteinheiten treffen auf ${round(liftDays)} Tage pro Woche, an denen ` +
        `Krafttraining überhaupt möglich ist. An der V-Schicht kommt man nicht ins Gym, an der ` +
        `Tagschicht bleibt keine Zeit.`,
    );
  }

  const trainable =
    resolved.filter((d) => {
      const a = shiftAllowance(shiftKindOf(d), 'mid');
      return !d.shiftType.cancelsPlanned && a.cap !== null;
    }).length / weeks;
  const total = targets.strength + targets.run + targets.optional;
  if (trainable < total) {
    messages.push(
      `${total} geplante Einheiten treffen auf ${round(trainable)} trainierbare Tage pro Woche. ` +
        `Der Rest fällt weg — das ist gewollt: Erholung steht über dem Training.`,
    );
  }

  return { verdict, headline, messages, budget };
}

/** Größter gemeinsamer Teiler — für die Angabe, wann Rotation und Woche wieder zusammenfallen. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
