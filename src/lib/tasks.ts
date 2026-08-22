/**
 * Aufgaben und ihre Verbindung zum Training.
 *
 * Das ist der Punkt, an dem sich Cllctr von einer normalen To-do-App
 * unterscheidet: Die App schlägt nur vor, was zum Tag passt. Nach einer
 * 12-Stunden-Schicht ist kein Platz für ein großes Projekt, und nach einer
 * harten Laufeinheit auch nicht.
 *
 * Termine sind davon ausgenommen — die liegen fest und werden immer gezeigt.
 */

import { addDays, fromIsoDate, toIsoDate } from './dates';
import {
  SESSION_TYPES,
  type IsoDate,
  type Recurrence,
  type ResolvedShiftDay,
  type Session,
  type Task,
  type TaskEnergy,
} from './types';

const ENERGY_ORDER: TaskEnergy[] = ['light', 'focus', 'hard'];

/**
 * Grundausstattung des Tages, abgeleitet aus der Schicht.
 *
 * Bewusst dieselbe Skala wie beim Training, weil sie dasselbe misst: wie viel
 * von diesem Tag dir tatsächlich gehört.
 */
function baseEnergy(day: ResolvedShiftDay): TaskEnergy[] {
  switch (day.capacity) {
    case 'full':
      return ['light', 'focus', 'hard'];
    case 'moderate':
      return ['light', 'focus'];
    default:
      return ['light'];
  }
}

export interface TaskEnergyBudget {
  allowed: TaskEnergy[];
  /** Ein Satz für die Anzeige, warum heute nur so viel geht. */
  reason: string;
}

/**
 * Was heute an Aufgaben realistisch ist.
 *
 * Erst die Schicht, dann das Training: eine harte Einheit kostet den Rest des
 * Tages, also fällt die oberste Stufe weg.
 */
export function taskEnergyBudget(
  day: ResolvedShiftDay,
  sessionsToday: Session[],
): TaskEnergyBudget {
  const active = sessionsToday.filter((s) => s.status === 'planned' || s.status === 'done');
  const hardSession = active.find((s) => SESSION_TYPES[s.type].countsAsHardDay);
  const totalLoad = active.reduce((sum, s) => sum + s.load, 0);

  /**
   * Ab dieser Tageslast frisst das Training den Rest des Tages.
   *
   * Bewusst niedriger als es die Härte-Regel des Planers verlangt: für die
   * Trainingsplanung ist schwere Beinarbeit kein harter Tag, für den Haushalt
   * danach sehr wohl. Wer 65 Minuten Kniebeugen und Kreuzheben hinter sich hat,
   * fängt keinen Großputz mehr an.
   */
  const DAY_EATING_LOAD = 8;
  const heavy = hardSession !== undefined || totalLoad >= DAY_EATING_LOAD;

  let allowed = baseEnergy(day);
  if (heavy && allowed.length > 1) allowed = allowed.slice(0, -1);

  const window = day.shiftType.trainingWindow ? `, ${day.shiftType.trainingWindow}` : '';
  let reason: string;

  if (day.capacity === 'full' && !heavy) {
    reason = `${day.shiftType.name} — der ganze Tag gehört dir. Auch etwas Anstrengendes ist drin.`;
  } else if (day.capacity === 'full' && heavy) {
    const what = hardSession ? hardSession.title : 'die heutige Einheit';
    reason = `${day.shiftType.name}, aber ${what} steht an. Danach ist kein großes Projekt mehr drin — Leichtes und Fokussiertes schon.`;
  } else if (day.capacity === 'moderate' && !heavy) {
    reason = `${day.shiftType.name}${window} — für Leichtes und eine fokussierte Sache reicht es.`;
  } else if (day.capacity === 'moderate' && heavy) {
    reason = `${day.shiftType.name}${window}, dazu die heutige Einheit — heute nur Kleinkram.`;
  } else {
    reason = `${day.shiftType.name} — zwölf Stunden weg. Heute nur, was nebenbei geht.`;
  }

  return { allowed, reason };
}

/** Nächster Termin einer Wiederholung, ausgehend von einem Datum. */
export function nextOccurrence(from: IsoDate, recurrence: Recurrence): IsoDate {
  const interval = Math.max(1, recurrence.interval);

  if (recurrence.kind === 'daily') {
    return addDays(from, interval);
  }

  if (recurrence.kind === 'weekly') {
    const weekdays = recurrence.weekdays;
    if (weekdays && weekdays.length > 0) {
      // Nächster passender Wochentag; spätestens in einer Woche ist einer dabei.
      for (let offset = 1; offset <= 7 * interval; offset++) {
        const candidate = addDays(from, offset);
        if (weekdays.includes(fromIsoDate(candidate).getDay())) return candidate;
      }
    }
    return addDays(from, 7 * interval);
  }

  // monthly — auf den Monatsletzten begrenzen, damit der 31. im Februar nicht
  // in den März rutscht.
  const date = fromIsoDate(from);
  const targetDay = recurrence.dayOfMonth ?? date.getDate();
  const shifted = new Date(date.getFullYear(), date.getMonth() + interval, 1);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(targetDay, lastDay));
  return toIsoDate(shifted);
}

export function isOverdue(task: Task, todayIso: IsoDate): boolean {
  return task.status === 'open' && task.dueDate !== null && task.dueDate < todayIso;
}

/** Termine des Tages, nach Uhrzeit sortiert. */
export function appointmentsOn(tasks: Task[], date: IsoDate): Task[] {
  return tasks
    .filter((t) => t.kind === 'appointment' && t.status === 'open' && t.dueDate === date)
    .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
}

/** Eine tägliche Routine — kein gewöhnlicher Vorschlag. */
export function isDaily(task: Task): boolean {
  return task.recurrence?.kind === 'daily';
}

/**
 * Tägliche Routinen, die heute anstehen.
 *
 * Sie laufen bewusst an der Vorschlagslogik vorbei: Was man sich täglich
 * vorgenommen hat, soll nicht mit einmaligen Aufgaben um drei Plätze
 * konkurrieren und auch an einem knappen Tag nicht stillschweigend
 * verschwinden. Die Entscheidung, ob es heute passt, ist dann deine — die App
 * hält den Vorsatz nur sichtbar.
 */
export function dailyTasks(tasks: Task[], todayIso: IsoDate): Task[] {
  return tasks
    .filter(
      (t) =>
        t.kind === 'chore' &&
        t.status === 'open' &&
        isDaily(t) &&
        (t.dueDate === null || t.dueDate <= todayIso),
    )
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        ENERGY_ORDER.indexOf(a.energy) - ENERGY_ORDER.indexOf(b.energy),
    );
}

/**
 * Die Aufgaben, die heute wirklich sinnvoll sind.
 *
 * Reihenfolge: überfällig vor fällig vor irgendwann, dann Priorität. Aufgaben,
 * deren Energiebedarf der Tag nicht hergibt, tauchen gar nicht erst auf — sie
 * als "heute vielleicht" anzuzeigen wäre genau das Nachdenken, das die App
 * abnehmen soll.
 *
 * Tägliche Routinen sind hier ausgenommen; die stehen in ihrem eigenen
 * Abschnitt und würden sonst jeden Tag alle Plätze belegen.
 */
export function suggestTasks(
  tasks: Task[],
  budget: TaskEnergyBudget,
  todayIso: IsoDate,
  limit = 3,
): Task[] {
  const candidates = tasks.filter(
    (t) =>
      t.kind === 'chore' &&
      t.status === 'open' &&
      !isDaily(t) &&
      budget.allowed.includes(t.energy) &&
      (t.dueDate === null || t.dueDate <= todayIso),
  );

  return candidates
    .sort((a, b) => {
      const dueRank = (t: Task) => (isOverdue(t, todayIso) ? 0 : t.dueDate === todayIso ? 1 : 2);
      const rank = dueRank(a) - dueRank(b);
      if (rank !== 0) return rank;
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Bei gleichem Rang die kleinere Aufgabe zuerst — sie ist eher erledigt.
      return ENERGY_ORDER.indexOf(a.energy) - ENERGY_ORDER.indexOf(b.energy);
    })
    .slice(0, limit);
}

/** Aufgaben, die heute nicht passen — für die ehrliche Begründung im Screen. */
export function tasksBlockedByEnergy(
  tasks: Task[],
  budget: TaskEnergyBudget,
  todayIso: IsoDate,
): Task[] {
  return tasks.filter(
    (t) =>
      t.kind === 'chore' &&
      t.status === 'open' &&
      !isDaily(t) &&
      !budget.allowed.includes(t.energy) &&
      (t.dueDate === null || t.dueDate <= todayIso),
  );
}
