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

/** Notnagel, falls eine Schichtart fehlt oder gelöscht wurde. */
const UNKNOWN_SHIFT: ShiftType = {
  id: '__unknown',
  name: 'Unbekannt',
  short: '?',
  startTime: null,
  endTime: null,
  crossesMidnight: false,
  capacity: 'full',
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
    fallback: ctx.shiftTypes.find((t) => t.capacity === 'full') ?? UNKNOWN_SHIFT,
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
 * Passen die Wochenziele in die Rotation?
 *
 * Hintergrund: Key-Sessions (Intervalle, Long Run, schwere Beinarbeit) brauchen
 * einen vollen Tag. Kraft Oberkörper und lockeres Volumen kommen mit einem
 * halben Tag aus. Liefert die Rotation davon zu wenige, kann kein Generator den
 * Plan retten — dann müssen die Ziele runter.
 *
 * Drei Ergebnisse:
 *   fits       — geht in jeder Woche auf
 *   tight      — geht in guten Wochen auf, in schwachen fehlt ein Tag
 *   impossible — geht in keiner Woche auf
 */
export function checkFeasibility(
  start: IsoDate,
  ctx: ShiftContext,
  targets: { strength: number; run: number; optional: number },
): FeasibilityCheck {
  const budget = weeklyCapacityBudget(start, ctx);
  const messages: string[] = [];
  const round = (n: number) => Math.round(n * 10) / 10;

  // Nur die harten Laufeinheiten brauchen einen ganzen Tag. Krafttraining kommt
  // mit einem halben aus — Schlaftag oder der Vormittag vor der Nachtschicht.
  const needFull = targets.run;
  const { min, max } = budget.fullDaysPerWeek;

  let verdict: FeasibilityVerdict;
  let headline: string;

  if (min >= needFull) {
    verdict = 'fits';
    headline = `Passt: jede Woche bringt mindestens ${min} volle Tage, gebraucht werden ${needFull}.`;
  } else if (max >= needFull) {
    verdict = 'tight';
    headline =
      `Knapp: je nach Woche hast du ${min} oder ${max} volle Tage, gebraucht werden ${needFull}. ` +
      `In den schwachen Wochen fehlt ein Tag für eine harte Laufeinheit.`;
  } else {
    verdict = 'impossible';
    headline =
      `Geht nicht auf: keine Woche bringt mehr als ${max} volle Tage, ` +
      `für ${targets.run}× harte Laufeinheiten bräuchte es ${needFull}.`;
  }

  if (budget.cycleLength !== null && 7 % budget.cycleLength !== 0) {
    messages.push(
      `Deine Rotation ist ${budget.cycleLength} Tage lang, die Kalenderwoche 7. ` +
        `Dadurch verschiebt sie sich Woche für Woche und deckt sich erst nach ` +
        `${(budget.cycleLength * 7) / gcd(budget.cycleLength, 7)} Tagen wieder mit ihr. ` +
        `Ein starres Wochenprogramm kann es deshalb nicht geben — die Planung muss pro Woche mitgehen.`,
    );
  }

  const needAtLeastModerate = targets.strength + targets.run;
  const haveAtLeastModerate = budget.perWeek.full + budget.perWeek.moderate;
  if (haveAtLeastModerate < needAtLeastModerate) {
    messages.push(
      `${needAtLeastModerate} feste Einheiten treffen auf ${round(haveAtLeastModerate)} Tage mit ` +
        `mindestens normalem Volumen. Die Differenz muss auf lockere Schichttage ausweichen — ` +
        `das geht nur mit Recovery-Läufen und Mobility.`,
    );
  }

  const trainableDays =
    budget.perWeek.full + budget.perWeek.moderate + budget.perWeek.light;
  const totalTargets = targets.strength + targets.run + targets.optional;
  if (trainableDays < totalTargets) {
    messages.push(
      `${totalTargets} geplante Einheiten treffen auf ${round(trainableDays)} trainierbare Tage pro Woche.`,
    );
  }

  return { verdict, headline, messages, budget };
}

/** Größter gemeinsamer Teiler — für die Angabe, wann Rotation und Woche wieder zusammenfallen. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
