/**
 * Den Dienstplan auflösen.
 *
 * Cllctr plant nicht auf Wochentage, sondern auf Schichten. Für jeden
 * Kalendertag wird hier bestimmt, welche Schicht anliegt — zuerst der
 * eingetragene Tag, sonst die Rotation, sonst „nicht eingetragen".
 *
 * Der Unterschied zwischen „nicht eingetragen" und „frei" ist wichtig: Was man
 * nicht weiß, verplant man nicht.
 */

import { addDays, dateRange, daysBetween, mod } from './dates';
import {
  INTENSITY_RANK,
  type Intensity,
  type IsoDate,
  type Recovery,
  type ResolvedDay,
  type ShiftAssignment,
  type ShiftPattern,
  type ShiftType,
  type Sport,
} from './types';

export interface ShiftContext {
  shiftTypes: ShiftType[];
  pattern: ShiftPattern | null;
  assignments: ShiftAssignment[];
}

/** Der Tag, für den nichts eingetragen ist. */
export const UNKNOWN_SHIFT: ShiftType = {
  id: '__unknown',
  name: 'Nicht eingetragen',
  short: '–',
  startTime: null,
  endTime: null,
  crossesMidnight: false,
  capability: 'none',
  maxIntensity: { ready: null, moderate: null, low: null },
  sports: [],
  maxMinutes: 0,
  trainingWindow: null,
  color: '#3F3F46',
  note: 'Für diesen Tag steht noch keine Schicht. Trag sie ein, dann schlägt die App etwas vor.',
  cancelsPlanned: false,
  pausesStreaks: false,
  isBuiltIn: false,
  sortOrder: 999,
};

interface Indexed {
  byId: Map<string, ShiftType>;
  byDate: Map<IsoDate, ShiftAssignment>;
  pattern: ShiftPattern | null;
}

function index(ctx: ShiftContext): Indexed {
  return {
    byId: new Map(ctx.shiftTypes.map((t) => [t.id, t])),
    byDate: new Map(ctx.assignments.map((a) => [a.date, a])),
    pattern: ctx.pattern && ctx.pattern.sequence.length > 0 ? ctx.pattern : null,
  };
}

function typeFor(date: IsoDate, idx: Indexed): { type: ShiftType; known: boolean } {
  const assigned = idx.byDate.get(date);
  if (assigned) {
    const type = idx.byId.get(assigned.shiftTypeId);
    if (type) return { type, known: true };
  }
  if (idx.pattern) {
    const pos = mod(daysBetween(idx.pattern.anchorDate, date), idx.pattern.sequence.length);
    const type = idx.byId.get(idx.pattern.sequence[pos]);
    if (type) return { type, known: true };
  }
  return { type: UNKNOWN_SHIFT, known: false };
}

export function resolveDay(date: IsoDate, ctx: ShiftContext): ResolvedDay {
  return resolveWith(date, index(ctx));
}

function resolveWith(date: IsoDate, idx: Indexed): ResolvedDay {
  const { type, known } = typeFor(date, idx);
  const previous = typeFor(addDays(date, -1), idx);
  return {
    date,
    shift: type,
    isUnknown: !known,
    afterNightShift: previous.type.crossesMidnight,
  };
}

/** Einen ganzen Zeitraum auflösen — baut den Index nur einmal. */
export function resolveRange(start: IsoDate, end: IsoDate, ctx: ShiftContext): ResolvedDay[] {
  const idx = index(ctx);
  return dateRange(start, end).map((d) => resolveWith(d, idx));
}

/* ------------------------------------------------------------------ */
/* Die Regel eines Tages                                               */
/* ------------------------------------------------------------------ */

export interface DayAllowance {
  /** Höchste erlaubte Intensität, null heißt Ruhetag. */
  cap: Intensity | null;
  /** Sportarten, die dieser Tag zulässt. */
  sports: Sport[];
  /** Realistische Obergrenze in Minuten. */
  maxMinutes: number;
  window: string | null;
  /** Ein Satz, warum der Tag so aussieht. */
  reason: string;
}

/**
 * Was ein Tag hergibt — Schicht **und** Erholung zusammen.
 *
 * Die Reihenfolge ist die Rangfolge: Die Schicht setzt die Obergrenze, die
 * Erholung kann sie nur senken, nie heben. Ein freier Tag mit schlechter
 * Erholung ist kein harter Tag; eine Tagschicht mit bester Erholung bleibt eine
 * Tagschicht.
 */
export function dayAllowance(day: ResolvedDay, recovery: Recovery): DayAllowance {
  const { shift } = day;

  if (shift.cancelsPlanned) {
    return {
      cap: null,
      sports: [],
      maxMinutes: 0,
      window: null,
      reason: `${shift.name}: kein Training.`,
    };
  }

  const cap = shift.maxIntensity?.[recovery] ?? null;
  const recoveryNote =
    recovery === 'ready' ? 'bei guter Erholung' : recovery === 'moderate' ? 'bei mittlerer Erholung' : 'bei niedriger Erholung';

  let reason: string;
  if (cap === null) {
    reason = day.isUnknown
      ? 'Für diesen Tag ist keine Schicht eingetragen.'
      : `${shift.name} ${recoveryNote}: Ruhetag.`;
  } else {
    reason = `${shift.name} ${recoveryNote}: höchstens ${
      cap === 'hard' ? 'hart' : cap === 'moderate' ? 'moderat' : 'locker'
    }.`;
  }

  // Nach der Nachtschicht steckt die Nacht noch in den Knochen, auch wenn der
  // Tag danach formal etwas hergäbe.
  let effective = cap;
  if (day.afterNightShift && effective === 'hard') {
    effective = 'moderate';
    reason += ' Tag nach der Nachtschicht — nichts Hartes.';
  }

  return {
    cap: effective,
    sports: shift.sports,
    maxMinutes: shift.maxMinutes,
    window: shift.trainingWindow,
    reason,
  };
}

/** Erlaubt dieser Tag diese Intensität? */
export function allows(allowance: DayAllowance, intensity: Intensity): boolean {
  return allowance.cap !== null && INTENSITY_RANK[intensity] <= INTENSITY_RANK[allowance.cap];
}

/**
 * Wie viele Trainingstage ein Zeitraum realistisch hergibt.
 *
 * Für die Wochenplanung: Drei Tagschichten in einer Woche heißen vier mögliche
 * Tage, nicht sieben — und ein Wochenziel, das das ignoriert, ist wertlos.
 */
export function trainableDays(days: ResolvedDay[], recovery: Recovery = 'ready'): number {
  return days.filter((d) => dayAllowance(d, recovery).cap !== null).length;
}
