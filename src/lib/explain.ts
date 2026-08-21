/**
 * Begründungen für den Heute-Screen.
 *
 * Das Kernversprechen der App ist, das Nachdenken abzunehmen. Dazu gehört, dass
 * sie nicht nur sagt *was* heute ansteht, sondern *warum* — sonst bleibt der
 * Verdacht, die App würfle. Die Sätze hier sind deshalb keine Deko, sondern der
 * eigentliche Grund, warum man dem Plan folgt.
 *
 * Alle Regeln lesen nur aus dem, was der Generator ohnehin entschieden hat:
 * Schichtkapazität, Position im Zyklus, Nachbartage.
 */

import { addDays, formatShort } from './dates';
import { capacityAllows, type ShiftContext, resolveShiftDay, resolveShiftRange } from './shifts';
import {
  SESSION_TYPES,
  type IsoDate,
  type Microcycle,
  type ResolvedShiftDay,
  type Session,
} from './types';

export interface SessionExplanation {
  /** Ein Satz: warum diese Einheit heute liegt. */
  reason: string;
  /** Kurze Zusatzhinweise, jeweils ein Halbsatz. */
  notes: string[];
}

/** Der nächste Tag ab morgen, der diese Einheit tragen könnte. */
function nextCapableDay(
  from: IsoDate,
  type: Session['type'],
  ctx: ShiftContext,
  withinDays = 10,
): ResolvedShiftDay | null {
  const days = resolveShiftRange(addDays(from, 1), addDays(from, withinDays), ctx);
  return days.find((d) => capacityAllows(d.capacity, type)) ?? null;
}

/**
 * Warum liegt diese Einheit heute?
 *
 * Reihenfolge der Erklärung: eine Umplanung erklärt sich selbst und schlägt
 * alles andere. Sonst zählt der Engpass — je knapper der Tag, desto mehr sagt
 * er darüber aus, warum genau hier trainiert wird.
 */
export function explainSession(
  session: Session,
  day: ResolvedShiftDay,
  ctx: ShiftContext,
  options: {
    microcycle?: Microcycle | null;
    /** Alle Einheiten desselben Tages, um Doppeltage zu erkennen. */
    sameDay?: Session[];
    /** Einheiten des Vortags, für den Rückblick. */
    previousDay?: Session[];
  } = {},
): SessionExplanation {
  const meta = SESSION_TYPES[session.type];
  const notes: string[] = [];

  // --- Der eigentliche Grund ---
  let reason: string;

  if (session.rescheduleReason) {
    reason = session.rescheduleReason;
  } else if (meta.minCapacity === 'full') {
    const next = nextCapableDay(session.date, session.type, ctx);
    reason = next
      ? `${meta.label} braucht einen ganzen Tag. Heute ist ${day.shiftType.name} — der nächste Tag, ` +
        `der das hergibt, wäre erst ${formatShort(next.date)}.`
      : `${meta.label} braucht einen ganzen Tag, und heute ist ${day.shiftType.name}.`;
  } else if (day.capacity === 'light') {
    reason =
      `${day.shiftType.name}${day.shiftType.trainingWindow ? ` (${day.shiftType.trainingWindow})` : ''} — ` +
      `mehr als eine kurze, lockere Einheit ist heute nicht drin. Deshalb ${meta.label}.`;
  } else if (day.capacity === 'moderate') {
    reason =
      `${day.shiftType.name}${day.shiftType.trainingWindow ? `, ${day.shiftType.trainingWindow}` : ''} — ` +
      `normales Volumen geht, nichts Hartes. ${meta.label} passt genau dahin.`;
  } else {
    reason = `${day.shiftType.name} — voller Tag. ${meta.label} steht im Zyklus als Nächstes an.`;
  }

  // --- Zusatzhinweise ---
  if (options.microcycle?.isDeload) {
    notes.push('Deload-Zyklus: bewusst kürzer und lockerer als sonst. Das ist so gewollt.');
  }

  if (day.afterNightShift) {
    notes.push('Tag nach der Nachtschicht — der Körper holt noch Schlaf nach.');
  }

  const sameDay = (options.sameDay ?? []).filter((s) => s.id !== session.id);
  if (sameDay.length > 0) {
    notes.push(
      `Doppeltag: dazu kommt ${sameDay.map((s) => s.title).join(' und ')}. ` +
        `Laufen zuerst, Kraft danach — mit frischen Beinen läuft es sich besser.`,
    );
  }

  const previousHard = (options.previousDay ?? []).filter(
    (s) => SESSION_TYPES[s.type].countsAsHardDay,
  );
  if (previousHard.length > 0 && !meta.countsAsHardDay) {
    notes.push(`Gestern war ${previousHard[0].title} — heute deshalb bewusst leichter.`);
  }

  // Was morgen kommt, erklärt oft, warum heute etwas vorgezogen wurde.
  const tomorrow = resolveShiftDay(addDays(session.date, 1), ctx);
  if (day.capacity === 'full' && tomorrow.capacity !== 'full') {
    notes.push(`Morgen ist ${tomorrow.shiftType.name} — die gute Gelegenheit ist heute.`);
  }

  if (session.locked) {
    notes.push('Von dir fixiert — der Umplaner fasst sie nicht an.');
  }

  return { reason, notes };
}

/** Warum heute nichts ansteht. */
export function explainRestDay(
  day: ResolvedShiftDay,
  next: { session: Session; date: IsoDate } | null,
  /** Einheiten, die heute geplant waren und verpasst oder gestrichen wurden. */
  cancelledToday: Session[] = [],
): SessionExplanation {
  const notes: string[] = [];

  let reason: string;
  if (cancelledToday.length > 0) {
    // Nicht „der Zyklus ist voll" behaupten, wenn der Tag schlicht ausgefallen ist.
    const titles = cancelledToday.map((s) => s.title).join(' und ');
    reason =
      cancelledToday.length === 1
        ? `${titles} ist für heute abgehakt — verpasst oder gestrichen. Damit ist der Tag durch.`
        : `${titles} sind für heute abgehakt — verpasst oder gestrichen. Damit ist der Tag durch.`;
  } else if (day.capacity === 'none') {
    reason = `${day.shiftType.name} — heute ist bewusst kein Training vorgesehen.`;
  } else if (day.afterNightShift) {
    reason = `${day.shiftType.name} nach der Nachtschicht — heute ist Ruhetag.`;
  } else {
    reason = 'Ruhetag. Der Zyklus ist voll, heute steht nichts an.';
  }

  if (cancelledToday.length > 0) {
    notes.push('Ein ausgefallener Tag bricht nichts — der nächste Zyklus läuft unverändert weiter.');
  } else if (day.capacity === 'full') {
    notes.push('Der Tag wäre frei — Erholung ist hier die bessere Investition als eine Zusatzeinheit.');
  }

  if (next) {
    notes.push(`Als Nächstes: ${next.session.title} am ${formatShort(next.date)}.`);
  }

  return { reason, notes };
}

export interface BlockStatus {
  cycleIndex: number;
  cyclesPerMeso: number;
  isDeload: boolean;
  /** Zyklen bis zum nächsten Deload, 0 wenn er läuft. */
  cyclesToDeload: number;
  /** Ungefähre Tage bis zum Deload — für Menschen greifbarer als Zyklen. */
  daysToDeload: number;
  doneInCycle: number;
  plannedInCycle: number;
  /** Ein Satz für die Anzeige. */
  summary: string;
}

export function blockStatus(
  micro: Microcycle,
  sessionsInCycle: Session[],
  loadCycles: number,
  deloadCycles: number,
): BlockStatus {
  const cyclesPerMeso = loadCycles + deloadCycles;
  const cyclesToDeload = micro.isDeload ? 0 : Math.max(0, loadCycles - micro.index + 1);
  const daysToDeload = cyclesToDeload * micro.lengthDays;

  const done = sessionsInCycle.filter((s) => s.status === 'done').length;
  const planned = sessionsInCycle.filter((s) => s.status !== 'skipped').length;

  const summary = micro.isDeload
    ? 'Deload läuft — danach beginnt der nächste Block.'
    : cyclesToDeload <= 1
      ? 'Deload beginnt mit dem nächsten Zyklus.'
      : `Deload in ${cyclesToDeload} Zyklen, also in etwa ${daysToDeload} Tagen.`;

  return {
    cycleIndex: micro.index,
    cyclesPerMeso,
    isDeload: micro.isDeload,
    cyclesToDeload,
    daysToDeload,
    doneInCycle: done,
    plannedInCycle: planned,
    summary,
  };
}
