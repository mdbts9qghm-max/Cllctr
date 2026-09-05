/**
 * Wochenrückblick.
 *
 * Zahlen allein sind kein Rückblick. Deshalb erzeugt die App zu jeder Woche
 * auch eine Einschätzung: was getragen hat, was gefehlt hat, und was in der
 * nächsten Woche anders laufen sollte. Alles daraus abgeleitet, nichts erfunden.
 */

import { addDays, formatDuration, startOfWeek } from './dates';
import { completionOverRange } from './habits';
import { inRange, loadBalance, minutesOf, summarize } from './load';
import { activePhase } from './phases';
import { buildBaseline, estimateRecovery } from './recovery';
import { dayAllowance, resolveRange, type ShiftContext } from './shifts';
import {
  ENDURANCE_SPORTS,
  SPORT_LABEL,
  type DailyCheckIn,
  type Habit,
  type HabitEntry,
  type IsoDate,
  type Settings,
  type TrainingPhase,
  type TrainingSession,
} from './types';

export interface ReviewNumbers {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  totalMinutes: number;
  targetMinutes: number;
  load: number;
  sessions: number;
  activeDays: number;
  hardSessions: number;
  km: Partial<Record<string, number>>;
  strengthSessions: number;
  habitPct: number;
  avgSleepHours: number | null;
  avgRecoveryPct: number | null;
  /** Trainierbare Tage laut Dienstplan — die ehrliche Bezugsgröße. */
  possibleDays: number;
}

export interface ReviewText {
  wentWell: string[];
  improve: string[];
  nextWeek: string[];
}

export interface WeekReview {
  numbers: ReviewNumbers;
  text: ReviewText;
}

export interface ReviewInput {
  anyDayOfWeek: IsoDate;
  sessions: TrainingSession[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  checkIns: DailyCheckIn[];
  phases: TrainingPhase[];
  settings: Settings;
  shiftContext: ShiftContext;
}

export function reviewWeek(input: ReviewInput): WeekReview {
  const { anyDayOfWeek, sessions, habits, habitEntries, checkIns, phases, settings, shiftContext } =
    input;

  const weekStart = startOfWeek(anyDayOfWeek);
  const weekEnd = addDays(weekStart, 6);
  const phase = activePhase(phases, settings, weekStart);

  const week = inRange(sessions, weekStart, weekEnd).filter((s) => s.status === 'done');
  const sum = summarize(week);

  const days = resolveRange(weekStart, weekEnd, shiftContext);
  const possibleDays = days.filter((d) => dayAllowance(d, 'ready').cap !== null).length;

  const sleeps = checkIns
    .filter((c) => c.date >= weekStart && c.date <= weekEnd && c.sleepHours)
    .map((c) => c.sleepHours as number);
  const avgSleepHours =
    sleeps.length > 0 ? Math.round((sleeps.reduce((a, b) => a + b, 0) / sleeps.length) * 10) / 10 : null;

  const recoveries = checkIns
    .filter((c) => c.date >= weekStart && c.date <= weekEnd)
    .map((c) => estimateRecovery(c, buildBaseline(checkIns, c.date)).percent);
  const avgRecoveryPct =
    recoveries.length > 0
      ? Math.round(recoveries.reduce((a, b) => a + b, 0) / recoveries.length)
      : null;

  const habitPct = completionOverRange(habits, habitEntries, weekStart, weekEnd);

  const numbers: ReviewNumbers = {
    weekStart,
    weekEnd,
    totalMinutes: sum.minutes,
    targetMinutes: phase.weeklyMinutesTarget,
    load: sum.load,
    sessions: week.length,
    activeDays: sum.activeDays,
    hardSessions: sum.hardSessions,
    km: sum.km,
    strengthSessions: week.filter((s) => s.sport === 'strength').length,
    habitPct,
    avgSleepHours,
    avgRecoveryPct,
    possibleDays,
  };

  return { numbers, text: judge(numbers, phase, week, settings, input) };
}

function judge(
  n: ReviewNumbers,
  phase: ReturnType<typeof activePhase>,
  week: TrainingSession[],
  settings: Settings,
  input: ReviewInput,
): ReviewText {
  const wentWell: string[] = [];
  const improve: string[] = [];
  const nextWeek: string[] = [];

  /* --- Umfang ----------------------------------------------------- */
  const share = n.targetMinutes > 0 ? n.totalMinutes / n.targetMinutes : 0;
  if (share >= 0.9) {
    wentWell.push(
      `${formatDuration(n.totalMinutes)} trainiert — das Wochenziel von ${formatDuration(n.targetMinutes)} steht.`,
    );
  } else if (share >= 0.6) {
    improve.push(
      `${formatDuration(n.totalMinutes)} von ${formatDuration(n.targetMinutes)}. Nicht schlecht, aber es fehlt rund ${formatDuration(n.targetMinutes - n.totalMinutes)}.`,
    );
  } else if (n.possibleDays <= 2) {
    // Bevor die App etwas anmahnt, prüft sie, ob es überhaupt möglich war.
    wentWell.push(
      `Nur ${n.possibleDays} trainierbare Tage in dieser Woche — dass wenig zusammenkam, liegt am Dienstplan, nicht an dir.`,
    );
  } else {
    improve.push(
      `${formatDuration(n.totalMinutes)} von ${formatDuration(n.targetMinutes)} bei ${n.possibleDays} möglichen Tagen. Da war mehr drin.`,
    );
  }

  /* --- Lange Einheit ---------------------------------------------- */
  const longest = week
    .filter((s) => ENDURANCE_SPORTS.includes(s.sport))
    .reduce((max, s) => Math.max(max, minutesOf(s)), 0);
  if (longest >= 90) {
    wentWell.push(`Längste Einheit ${formatDuration(longest)} — die lange Einheit stand.`);
  } else if (n.possibleDays >= 3) {
    improve.push(
      'Keine lange Einheit über 90 Minuten. Bei einem Ultra-Ziel ist sie die wichtigste der Woche.',
    );
    nextWeek.push('Leg die lange Einheit auf die erste Freischicht der Woche, nicht auf die letzte.');
  }

  /* --- Kraft ------------------------------------------------------ */
  if (n.strengthSessions >= phase.strengthPerWeek) {
    wentWell.push(`${n.strengthSessions} Krafteinheiten — Soll erfüllt.`);
  } else {
    improve.push(
      `${n.strengthSessions} von ${phase.strengthPerWeek} Krafteinheiten. Kraft ist das, was beim Umfangsaufbau als Erstes untergeht.`,
    );
  }

  /* --- Intensitätsverteilung -------------------------------------- */
  if (n.hardSessions > phase.hardPerWeek) {
    improve.push(
      `${n.hardSessions} harte Einheiten, vorgesehen sind ${phase.hardPerWeek} in der ${phase.kind}-Phase. Mehr Intensität ist nicht mehr Fortschritt.`,
    );
    nextWeek.push('Nächste Woche eine harte Einheit weniger und dafür die Grundlage länger.');
  } else if (n.hardSessions === 0 && n.totalMinutes > 120 && phase.hardPerWeek > 0) {
    improve.push('Keine einzige intensive Einheit — die Grundlage wächst, das Tempo nicht.');
  }

  /* --- Schlaf und Erholung ---------------------------------------- */
  if (n.avgSleepHours !== null) {
    if (n.avgSleepHours >= 7) {
      wentWell.push(`Ø ${n.avgSleepHours.toFixed(1).replace('.', ',')} h Schlaf.`);
    } else {
      improve.push(
        `Ø ${n.avgSleepHours.toFixed(1).replace('.', ',')} h Schlaf. Unter sieben Stunden frisst der Schichtdienst die Anpassung auf, egal wie gut das Training war.`,
      );
      nextWeek.push('Schlaf vor Umfang: Lieber eine Einheit kürzen als eine Stunde Schlaf.');
    }
  } else {
    improve.push('Keine Schlafdaten — ohne sie kann die App die Erholung nur raten.');
  }

  /* --- Habits ----------------------------------------------------- */
  if (n.habitPct >= 80) {
    wentWell.push(`${n.habitPct} % der Habits erfüllt.`);
  } else if (n.habitPct < 60) {
    improve.push(
      `${n.habitPct} % der Habits. Der Alltag trägt das Training — wenn er wackelt, wackelt der Rest mit.`,
    );
  }

  /* --- Ausblick --------------------------------------------------- */
  const balance = loadBalance(input.sessions, n.weekEnd, settings.rampWarnPct);
  if (balance.rising) {
    nextWeek.push(
      `Die Belastung liegt ${balance.rampPct} % über dem Schnitt. Nächste Woche halten statt steigern.`,
    );
  } else if (share >= 0.9 && n.avgRecoveryPct !== null && n.avgRecoveryPct >= 65) {
    nextWeek.push('Umfang hat gepasst, Erholung stimmt — nächste Woche darf etwas mehr sein.');
  }

  const biggest = Object.entries(n.km).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  if (biggest && biggest[1]) {
    wentWell.push(
      `${SPORT_LABEL[biggest[0] as keyof typeof SPORT_LABEL]}: ${biggest[1].toString().replace('.', ',')} km.`,
    );
  }

  if (nextWeek.length === 0) {
    nextWeek.push('Weitermachen. Die Woche war unauffällig, und das ist im Aufbau die beste Nachricht.');
  }

  return { wentWell, improve, nextWeek };
}
