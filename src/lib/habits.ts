/**
 * Habits: Zeitplan, Erfüllung, Serien.
 *
 * Der wichtigste Grundsatz steht in `streakOf`: **Eine Serie reißt nicht an
 * einem Tag, an dem Ruhe richtig war.** Eine Streak-Mechanik, die Anwesenheit
 * belohnt statt Verhalten, erzieht zum Schummeln — man hakt ab, statt zu tun.
 */

import { addDays, dateRange, startOfWeek, today } from './dates';
import type { Habit, HabitEntry, IsoDate } from './types';

/** Steht dieser Habit an diesem Tag überhaupt an? */
export function isDue(habit: Habit, date: IsoDate): boolean {
  if (!habit.active) return false;
  const s = habit.schedule;
  if (s.type === 'daily') return true;
  if (s.type === 'weekdays') {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    return (s.weekdays ?? []).includes(weekday);
  }
  // timesPerWeek: Jeder Tag ist möglich, gezählt wird die Woche. Einen
  // bestimmten Tag zu verlangen wäre das Gegenteil von "X-mal pro Woche".
  return true;
}

export type HabitState = 'done' | 'partial' | 'open' | 'notDue';

export interface HabitStatus {
  habit: Habit;
  entry: HabitEntry | undefined;
  value: number;
  state: HabitState;
  /** 0–1. Bei Mengen-Habits der Anteil am Ziel. */
  ratio: number;
}

export function statusOf(
  habit: Habit,
  entries: HabitEntry[],
  date: IsoDate,
): HabitStatus {
  const entry = entries.find((e) => e.habitId === habit.id && e.date === date);
  const value = entry?.value ?? 0;

  if (!isDue(habit, date)) {
    return { habit, entry, value, state: 'notDue', ratio: value > 0 ? 1 : 0 };
  }

  if (habit.kind === 'check') {
    return {
      habit,
      entry,
      value,
      state: value > 0 ? 'done' : 'open',
      ratio: value > 0 ? 1 : 0,
    };
  }

  const target = habit.target ?? 1;
  const ratio = target > 0 ? Math.min(1, value / target) : 0;
  const state: HabitState =
    value >= target ? 'done' : habit.minimum !== null && value >= habit.minimum ? 'partial' : 'open';
  return { habit, entry, value, state, ratio };
}

/** Erfüllungsgrad eines Tages über alle fälligen Habits, 0–1. */
export function dayCompletion(
  habits: Habit[],
  entries: HabitEntry[],
  date: IsoDate,
): { ratio: number; done: number; due: number } {
  const due = habits.filter((h) => h.active && isDue(h, date));
  if (due.length === 0) return { ratio: 1, done: 0, due: 0 };

  let sum = 0;
  let done = 0;
  for (const h of due) {
    const s = statusOf(h, entries, date);
    sum += s.ratio;
    if (s.state === 'done') done++;
  }
  return { ratio: sum / due.length, done, due: due.length };
}

/** Wie oft ein Habit in der Woche erfüllt wurde — für `timesPerWeek`. */
export function weekCount(
  habit: Habit,
  entries: HabitEntry[],
  anyDayOfWeek: IsoDate,
): { done: number; target: number } {
  const start = startOfWeek(anyDayOfWeek);
  const days = dateRange(start, addDays(start, 6));
  const done = days.filter((d) => statusOf(habit, entries, d).state === 'done').length;
  const target =
    habit.schedule.type === 'timesPerWeek'
      ? (habit.schedule.timesPerWeek ?? 1)
      : habit.schedule.type === 'weekdays'
        ? (habit.schedule.weekdays ?? []).length
        : 7;
  return { done, target };
}

/**
 * Serie in Tagen.
 *
 * `exemptDays` sind Tage, an denen ein Aussetzen nicht zählt: Ruhetage bei
 * niedriger Erholung, Tagschichten, Urlaub, Krankheit. Sie unterbrechen die
 * Serie nicht und verlängern sie auch nicht — sie werden übersprungen.
 *
 * Der heutige Tag darf noch offen sein. Wer abends abhakt, hätte sonst
 * tagsüber eine gerissene Serie, obwohl nichts passiert ist.
 */
export function streakOf(
  habit: Habit,
  entries: HabitEntry[],
  exemptDays: Set<IsoDate>,
  reference: IsoDate = today(),
): number {
  let cursor = statusOf(habit, entries, reference).state === 'done' ? reference : addDays(reference, -1);
  let length = 0;

  for (let guard = 0; guard < 400; guard++) {
    const state = statusOf(habit, entries, cursor).state;
    if (state === 'done') {
      length++;
    } else if (state === 'notDue') {
      // Nicht fällig heißt nicht verpasst.
    } else if (habit.restDayExempt && exemptDays.has(cursor)) {
      // Ruhetag: übersprungen, nicht gezählt.
    } else {
      break;
    }
    cursor = addDays(cursor, -1);
  }
  return length;
}

/** Erfüllung über einen Zeitraum, in Prozent — für Score und Rückblick. */
export function completionOverRange(
  habits: Habit[],
  entries: HabitEntry[],
  from: IsoDate,
  to: IsoDate,
): number {
  const days = dateRange(from, to);
  if (days.length === 0) return 0;
  const sum = days.reduce((acc, d) => acc + dayCompletion(habits, entries, d).ratio, 0);
  return Math.round((sum / days.length) * 100);
}

/** Verlauf für die Trendanzeige: ein Wert je Tag. */
export function completionTrend(
  habits: Habit[],
  entries: HabitEntry[],
  from: IsoDate,
  to: IsoDate,
): Array<{ date: IsoDate; pct: number }> {
  return dateRange(from, to).map((date) => ({
    date,
    pct: Math.round(dayCompletion(habits, entries, date).ratio * 100),
  }));
}
