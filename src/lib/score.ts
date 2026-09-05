/**
 * Der Hybrid Score.
 *
 * Eine Zahl, die niemand erklären kann, ist eine Zahl, der niemand glaubt.
 * Deshalb besteht der Score aus sechs Teilwerten, jeder mit seinen eigenen
 * Eingangsgrößen, und jeder Teilwert nennt sie. Die Frage „warum heute 78?" ist
 * damit vollständig beantwortbar — bis auf die einzelne Zeile.
 *
 * Gewichtung: Endurance 25, Strength 20, Consistency 20, Recovery 15,
 * Habits 15, Mobility 5. Sie folgt dem Ziel: Ultra mit erhaltener Kraft.
 * Konstanz zählt so viel wie Kraft, weil sie über Jahre mehr entscheidet.
 */

import { addDays, lastDays, startOfWeek } from './dates';
import { completionOverRange } from './habits';
import { inRange, minutesOf, summarize } from './load';
import { estimateRecovery, buildBaseline } from './recovery';
import { activePhase } from './phases';
import {
  ENDURANCE_SPORTS,
  type DailyCheckIn,
  type Habit,
  type HabitEntry,
  type IsoDate,
  type Settings,
  type TrainingPhase,
  type TrainingSession,
} from './types';

export interface ScorePart {
  key: 'endurance' | 'strength' | 'consistency' | 'recovery' | 'habits' | 'mobility';
  label: string;
  value: number;
  weight: number;
  /** Woraus der Wert entstanden ist, in ganzen Sätzen. */
  reasons: string[];
}

export interface HybridScore {
  total: number;
  parts: ScorePart[];
  /** Der Wert von vor sieben Tagen, für die Richtung. Null ohne Vergleich. */
  previous: number | null;
}

const WEIGHTS = {
  endurance: 25,
  strength: 20,
  consistency: 20,
  recovery: 15,
  habits: 15,
  mobility: 5,
} as const;

/** Linear auf 0–100, gedeckelt. */
function ratio(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((actual / target) * 100)));
}

export interface ScoreInput {
  sessions: TrainingSession[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  checkIns: DailyCheckIn[];
  phases: TrainingPhase[];
  settings: Settings;
  reference: IsoDate;
}

export function hybridScore(input: ScoreInput): HybridScore {
  const parts = computeParts(input);
  const total = Math.round(
    parts.reduce((sum, p) => sum + (p.value * p.weight) / 100, 0),
  );

  // Der Vorwochenwert entsteht aus derselben Rechnung mit verschobenem Stichtag.
  // Eine gespeicherte Historie wäre schneller, aber sie würde veralten, sobald
  // jemand einen alten Eintrag korrigiert.
  const before = addDays(input.reference, -7);
  const previousParts = computeParts({ ...input, reference: before });
  const previous = Math.round(
    previousParts.reduce((sum, p) => sum + (p.value * p.weight) / 100, 0),
  );

  return { total, parts, previous: Number.isFinite(previous) ? previous : null };
}

function computeParts(input: ScoreInput): ScorePart[] {
  const { sessions, habits, habitEntries, checkIns, phases, settings, reference } = input;
  const phase = activePhase(phases, settings, reference);

  const from28 = addDays(reference, -27);
  const last28 = inRange(sessions, from28, reference);
  const done28 = last28.filter((s) => s.status === 'done');
  const sum28 = summarize(done28);
  const weeks = 4;

  /* --- Endurance ------------------------------------------------- */
  const enduranceMinutes = ENDURANCE_SPORTS.reduce(
    (acc, sport) => acc + (sum28.minutesBySport[sport] ?? 0),
    0,
  );
  const enduranceTargetShare = ENDURANCE_SPORTS.reduce(
    (acc, sport) => acc + (settings.sportMix[sport] ?? 0),
    0,
  );
  const enduranceTarget = Math.round(
    (phase.weeklyMinutesTarget * enduranceTargetShare * weeks) / 100,
  );
  const longSessions = done28.filter(
    (s) => ENDURANCE_SPORTS.includes(s.sport) && minutesOf(s) >= 90,
  ).length;
  // Volumen zählt doppelt so viel wie die langen Einheiten: Ohne Umfang nützt
  // die längste Einzelleistung nichts, aber ohne lange Einheit fehlt bei einem
  // Ultra-Ziel genau das Entscheidende.
  const enduranceValue = Math.round(
    ratio(enduranceMinutes, enduranceTarget) * 0.7 + ratio(longSessions, weeks) * 0.3,
  );

  /* --- Strength -------------------------------------------------- */
  const strengthSessions = done28.filter((s) => s.sport === 'strength').length;
  const strengthTarget = phase.strengthPerWeek * weeks;
  const strengthValue = ratio(strengthSessions, strengthTarget);

  /* --- Consistency ----------------------------------------------- */
  const planned28 = last28.filter((s) => s.status === 'planned' || s.status === 'done');
  const kept = planned28.length > 0 ? done28.length / planned28.length : 0;
  const activeDays = sum28.activeDays;
  const dayTarget = settings.weeklyDaysTarget * weeks;
  const consistencyValue = Math.round(
    ratio(activeDays, dayTarget) * 0.6 + Math.min(100, kept * 100) * 0.4,
  );

  /* --- Recovery -------------------------------------------------- */
  const recent = lastDays(14, reference);
  const percentages: number[] = [];
  for (const date of recent) {
    const entry = checkIns.find((c) => c.date === date);
    if (!entry) continue;
    const baseline = buildBaseline(checkIns, date);
    percentages.push(estimateRecovery(entry, baseline).percent);
  }
  const avgRecovery =
    percentages.length > 0
      ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
      : null;
  const sleepValues = recent
    .map((d) => checkIns.find((c) => c.date === d)?.sleepHours)
    .filter((v): v is number => !!v);
  const avgSleep =
    sleepValues.length > 0 ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length : null;
  const recoveryValue =
    avgRecovery === null && avgSleep === null
      ? 0
      : Math.round(
          (avgRecovery ?? 55) * 0.6 + ratio(avgSleep ?? 6.5, 7.5) * 0.4,
        );

  /* --- Habits ---------------------------------------------------- */
  const habitsValue = completionOverRange(habits, habitEntries, from28, reference);

  /* --- Mobility -------------------------------------------------- */
  const mobilityMinutes = sum28.minutesBySport.mobility ?? 0;
  const mobilityTarget = Math.round((phase.weeklyMinutesTarget * (settings.sportMix.mobility ?? 8) * weeks) / 100);
  const mobilityValue = ratio(mobilityMinutes, mobilityTarget);

  return [
    {
      key: 'endurance',
      label: 'Endurance',
      value: enduranceValue,
      weight: WEIGHTS.endurance,
      reasons: [
        `${Math.round(enduranceMinutes / 60)} von ${Math.round(enduranceTarget / 60)} Ausdauerstunden in vier Wochen.`,
        `${longSessions} lange Einheiten (≥ 90 min), Ziel ${weeks}.`,
      ],
    },
    {
      key: 'strength',
      label: 'Strength',
      value: strengthValue,
      weight: WEIGHTS.strength,
      reasons: [
        `${strengthSessions} von ${strengthTarget} Krafteinheiten in vier Wochen.`,
        `Die ${phase.kind === 'base' ? 'Base' : 'aktuelle'}-Phase sieht ${phase.strengthPerWeek} pro Woche vor.`,
      ],
    },
    {
      key: 'consistency',
      label: 'Consistency',
      value: consistencyValue,
      weight: WEIGHTS.consistency,
      reasons: [
        `An ${activeDays} von ${dayTarget} Zieltagen trainiert.`,
        planned28.length > 0
          ? `${Math.round(kept * 100)} % des Geplanten auch erledigt.`
          : 'Noch nichts geplant, an dem sich das messen ließe.',
      ],
    },
    {
      key: 'recovery',
      label: 'Recovery',
      value: recoveryValue,
      weight: WEIGHTS.recovery,
      reasons: [
        avgRecovery !== null
          ? `Ø ${avgRecovery} % Erholung über 14 Tage.`
          : 'Keine Erholungsdaten der letzten 14 Tage.',
        avgSleep !== null
          ? `Ø ${avgSleep.toFixed(1).replace('.', ',')} h Schlaf, Ziel 7,5 h.`
          : 'Keine Schlafdaten eingetragen.',
      ],
    },
    {
      key: 'habits',
      label: 'Habits',
      value: habitsValue,
      weight: WEIGHTS.habits,
      reasons: [`${habitsValue} % der fälligen Habits über vier Wochen erfüllt.`],
    },
    {
      key: 'mobility',
      label: 'Mobility',
      value: mobilityValue,
      weight: WEIGHTS.mobility,
      reasons: [
        `${mobilityMinutes} von ${mobilityTarget} Mobility-Minuten in vier Wochen.`,
      ],
    },
  ];
}

/** Ampelfarbe für einen Wert 0–100. */
export function scoreTone(value: number): 'good' | 'ok' | 'warn' {
  if (value >= 75) return 'good';
  if (value >= 50) return 'ok';
  return 'warn';
}

/** Der aktuelle Wochenstart — für Anzeigen, die den Score einordnen. */
export function scoreWeek(reference: IsoDate): IsoDate {
  return startOfWeek(reference);
}
