/**
 * Aufgaben: Fälligkeit, Sortierung, Wiederholung.
 *
 * Der Aufwand (`effort`) ist der Berührungspunkt zum Training: Nach einer
 * harten Einheit oder an einer Tagschicht schlägt die App keine aufwendigen
 * Aufgaben mehr vor. Sie verschwinden nicht — sie stehen nur nicht mehr unter
 * "heute sinnvoll".
 */

import { addDays, fromIsoDate, toIsoDate } from './dates';
import type { IsoDate, Recurrence, Task, TaskEffort } from './types';

const EFFORT_ORDER: TaskEffort[] = ['quick', 'focus', 'heavy'];

export function isOverdue(task: Task, today: IsoDate): boolean {
  return task.status === 'open' && task.dueDate !== null && task.dueDate < today;
}

export function isDueToday(task: Task, today: IsoDate): boolean {
  return task.status === 'open' && task.dueDate === today;
}

/** Termine des Tages, nach Uhrzeit. Ohne Uhrzeit ans Ende. */
export function appointmentsOn(tasks: Task[], date: IsoDate): Task[] {
  return tasks
    .filter((t) => t.status === 'open' && t.dueDate === date && t.time !== null)
    .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
}

/**
 * Die Aufgaben, die heute sinnvoll sind.
 *
 * Reihenfolge: überfällig vor heute fällig vor undatiert, dann Priorität, dann
 * Aufwand. Was der Tag nicht hergibt, fällt raus — es als "vielleicht" zu
 * zeigen wäre genau das Abwägen, das die App abnehmen soll.
 */
export function suggestTasks(
  tasks: Task[],
  allowedEffort: TaskEffort[],
  today: IsoDate,
  limit = 5,
): Task[] {
  return tasks
    .filter(
      (t) =>
        t.status === 'open' &&
        allowedEffort.includes(t.effort) &&
        (t.dueDate === null || t.dueDate <= today),
    )
    .sort((a, b) => {
      const rank = (t: Task) => (isOverdue(t, today) ? 0 : t.dueDate === today ? 1 : 2);
      return (
        rank(a) - rank(b) ||
        a.priority - b.priority ||
        EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort) ||
        a.createdAt.localeCompare(b.createdAt)
      );
    })
    .slice(0, limit);
}

/** Aufgaben, die heute nur am Aufwand scheitern — für die Begründung. */
export function blockedByEffort(
  tasks: Task[],
  allowedEffort: TaskEffort[],
  today: IsoDate,
): Task[] {
  return tasks.filter(
    (t) =>
      t.status === 'open' &&
      !allowedEffort.includes(t.effort) &&
      (t.dueDate === null || t.dueDate <= today),
  );
}

/** Nächster Termin einer Wiederholung. */
export function nextOccurrence(from: IsoDate, recurrence: Recurrence): IsoDate {
  const interval = Math.max(1, recurrence.interval);

  if (recurrence.kind === 'daily') return addDays(from, interval);

  if (recurrence.kind === 'weekly') {
    const weekdays = recurrence.weekdays;
    if (weekdays && weekdays.length > 0) {
      for (let offset = 1; offset <= 7 * interval; offset++) {
        const candidate = addDays(from, offset);
        if (weekdays.includes(fromIsoDate(candidate).getDay())) return candidate;
      }
    }
    return addDays(from, 7 * interval);
  }

  // monatlich — auf den Monatsletzten begrenzen, damit der 31. im Februar nicht
  // in den März rutscht.
  const date = fromIsoDate(from);
  const targetDay = recurrence.dayOfMonth ?? date.getDate();
  const shifted = new Date(date.getFullYear(), date.getMonth() + interval, 1);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(targetDay, lastDay));
  return toIsoDate(shifted);
}

/**
 * Welcher Aufwand heute realistisch ist.
 *
 * Nicht die Trainingsminuten entscheiden, sondern was übrig bleibt: Zwölf
 * Stunden Schicht lassen nichts übrig, eine harte Einheit auf einem freien Tag
 * lässt Fokussiertes zu, aber kein Großprojekt.
 */
export function effortBudget(input: {
  shiftCapability: 'none' | 'short' | 'moderate' | 'full';
  hadHardSession: boolean;
  recovery: 'ready' | 'moderate' | 'low';
}): { allowed: TaskEffort[]; reason: string } {
  const { shiftCapability, hadHardSession, recovery } = input;

  if (shiftCapability === 'none') {
    return { allowed: ['quick'], reason: 'Zwölf Stunden Schicht — heute nur, was nebenbei geht.' };
  }
  if (recovery === 'low') {
    return {
      allowed: ['quick'],
      reason: 'Niedrige Erholung — der Kopf ist genauso müde wie die Beine.',
    };
  }
  if (shiftCapability === 'short') {
    return { allowed: ['quick', 'focus'], reason: 'Langer Arbeitstag — für eine fokussierte Sache reicht es.' };
  }
  if (hadHardSession) {
    return {
      allowed: ['quick', 'focus'],
      reason: 'Harte Einheit heute — danach ist kein großes Projekt mehr drin.',
    };
  }
  return { allowed: ['quick', 'focus', 'heavy'], reason: 'Der Tag gibt auch etwas Aufwendiges her.' };
}
