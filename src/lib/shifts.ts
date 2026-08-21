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

import { addDays, dateRange, daysBetween, mod } from './dates';
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

/** Alle Session-Typen, die an diesem Tag möglich wären. */
export function allowedSessionTypes(capacity: TrainingCapacity): SessionTypeKey[] {
  return (Object.keys(SESSION_TYPES) as SessionTypeKey[]).filter((key) =>
    capacityAllows(capacity, key),
  );
}

/**
 * Kurze Begründung für den Nutzer, warum an diesem Tag nur begrenzt
 * trainiert werden kann. Erscheint auf dem Heute-Screen.
 */
export function capacityExplanation(day: ResolvedShiftDay): string {
  const { shiftType, capacity, afterNightShift } = day;

  if (capacity === 'none') {
    return `${shiftType.name} — heute ist kein Training eingeplant.`;
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
  /** Tage je Kapazitätsstufe, hochgerechnet auf eine Woche. */
  perWeek: Record<TrainingCapacity, number>;
}

/**
 * Wie viele Tage welcher Kapazität die Rotation im Schnitt pro Woche liefert.
 * Betrachtet einen längeren Zeitraum, weil Rotationen selten 7 Tage lang sind.
 */
export function weeklyCapacityBudget(
  start: IsoDate,
  ctx: ShiftContext,
  days = 28,
): CapacityBudget {
  const resolved = resolveShiftRange(start, addDays(start, days - 1), ctx);
  const counts: Record<TrainingCapacity, number> = { none: 0, light: 0, moderate: 0, full: 0 };
  for (const day of resolved) counts[day.capacity] += 1;

  const weeks = days / 7;
  return {
    days,
    perWeek: {
      none: counts.none / weeks,
      light: counts.light / weeks,
      moderate: counts.moderate / weeks,
      full: counts.full / weeks,
    },
  };
}

export interface FeasibilityCheck {
  fits: boolean;
  messages: string[];
  budget: CapacityBudget;
}

/**
 * Passen die Wochenziele überhaupt in die Rotation?
 *
 * Hintergrund: Key-Sessions (Intervalle, Long Run, schwere Beinarbeit) brauchen
 * einen vollen Tag. Kraft Oberkörper und lockeres Volumen kommen mit einem
 * halben Tag aus. Wenn die Rotation davon zu wenige liefert, kann kein
 * Generator der Welt den Plan retten — dann müssen die Ziele runter.
 */
export function checkFeasibility(
  start: IsoDate,
  ctx: ShiftContext,
  targets: { strength: number; run: number; optional: number },
): FeasibilityCheck {
  const budget = weeklyCapacityBudget(start, ctx);
  const messages: string[] = [];

  const fullDays = budget.perWeek.full;
  const trainableDays = fullDays + budget.perWeek.moderate + budget.perWeek.light;

  // Beide Laufeinheiten sind Key-Sessions, dazu mindestens eine schwere Beineinheit.
  const needFull = targets.run + Math.min(1, targets.strength);
  // Kraft und Laufen brauchen mindestens einen halben Tag; nur "optional" geht auch locker.
  const needAtLeastModerate = targets.strength + targets.run;
  const haveAtLeastModerate = fullDays + budget.perWeek.moderate;

  const round = (n: number) => Math.round(n * 10) / 10;

  if (fullDays < needFull) {
    messages.push(
      `Deine Rotation liefert im Schnitt ${round(fullDays)} volle Tage pro Woche, ` +
        `für ${targets.run}× Laufen plus schwere Beinarbeit bräuchte es ${needFull}. ` +
        `Entweder weniger harte Einheiten pro Woche — oder eine Schichtart höher einstufen.`,
    );
  }

  if (haveAtLeastModerate < needAtLeastModerate) {
    messages.push(
      `Für ${needAtLeastModerate} feste Einheiten stehen nur ${round(haveAtLeastModerate)} Tage ` +
        `mit normalem Volumen zur Verfügung. Der Rest müsste auf Schichttage ausweichen.`,
    );
  }

  const totalTargets = targets.strength + targets.run + targets.optional;
  if (trainableDays < totalTargets) {
    messages.push(
      `${totalTargets} geplante Einheiten treffen auf ${round(trainableDays)} trainierbare Tage pro Woche.`,
    );
  }

  return { fits: messages.length === 0, messages, budget };
}
