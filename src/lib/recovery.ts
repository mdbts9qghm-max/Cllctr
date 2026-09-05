/**
 * Erholung: READY, MODERATE oder RECOVERY.
 *
 * Die App stellt keine Diagnosen. Sie fasst zusammen, was eingetragen wurde, und
 * benennt, worauf sie sich stützt — mehr behauptet sie nicht.
 *
 * Zwei Grundsätze:
 *
 *   1. **Eine gemessene Recovery-Prozentzahl gewinnt.** WHOOP verrechnet dafür
 *      bereits HRV, Ruhepuls, Schlaf und Atemfrequenz. Sie mit unseren
 *      schwächeren Einzelsignalen zu überstimmen wäre schlechter, nicht besser.
 *   2. **Sonst wird gegen die eigene Basislinie gerechnet**, nicht gegen einen
 *      Lehrbuchwert. Eine HRV von 45 ms ist für den einen hervorragend und für
 *      den anderen ein Alarmsignal.
 */

import { daysBetween } from './dates';
import type { DailyCheckIn, IsoDate, Recovery } from './types';

/** Woher die Einstufung kommt. Entscheidet, wie die App darüber spricht. */
export type RecoveryBasis = 'measured' | 'derived' | 'assumed';

export interface RecoveryEstimate {
  status: Recovery;
  basis: RecoveryBasis;
  /** 0–100, für Anzeige und Score. Aus der Messung oder aus dem Punktestand. */
  percent: number;
  headline: string;
  /** Die einzelnen Signale, jedes in einem Halbsatz. */
  reasons: string[];
}

/* ------------------------------------------------------------------ */
/* Basislinie                                                          */
/* ------------------------------------------------------------------ */

export interface Baseline {
  hrvMs: number | null;
  restingHr: number | null;
  sleepHours: number | null;
  days: number;
}

const WINDOW_DAYS = 21;
/** Unter vier Werten ist ein Schnitt kein Schnitt, sondern Zufall. */
const MIN_DAYS = 4;

export function buildBaseline(entries: DailyCheckIn[], before: IsoDate): Baseline {
  const window = entries.filter(
    (e) => e.date < before && daysBetween(e.date, before) <= WINDOW_DAYS,
  );
  const mean = (values: number[]) =>
    values.length >= MIN_DAYS ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const hrv = window.map((e) => e.hrvMs).filter((v): v is number => !!v && v > 0);
  const rhr = window.map((e) => e.restingHr).filter((v): v is number => !!v && v > 0);
  const sleep = window.map((e) => e.sleepHours).filter((v): v is number => !!v && v > 0);

  return {
    hrvMs: mean(hrv),
    restingHr: mean(rhr),
    sleepHours: mean(sleep),
    days: Math.max(hrv.length, rhr.length, sleep.length),
  };
}

/* ------------------------------------------------------------------ */
/* Einstufung                                                          */
/* ------------------------------------------------------------------ */

const READY_AT = 2;
const LOW_AT = -2;

/** WHOOPs eigene Farbgrenzen — damit in der App nichts anderes steht als auf der Uhr. */
export function statusFromPercent(pct: number): Recovery {
  if (pct <= 33) return 'low';
  if (pct <= 66) return 'moderate';
  return 'ready';
}

function percentFromScore(score: number): number {
  // −5 … +5 auf 15 … 95 abbilden. Nie 0 und nie 100: Der Punktestand ist eine
  // Schätzung, und eine Schätzung, die 100 % behauptet, überschätzt sich.
  const clamped = Math.max(-5, Math.min(5, score));
  return Math.round(55 + clamped * 8);
}

export function estimateRecovery(
  entry: DailyCheckIn | undefined,
  baseline: Baseline,
  options: { afterNightShift?: boolean } = {},
): RecoveryEstimate {
  const afterNight = options.afterNightShift ?? false;

  // 1 — Die gemessene Prozentzahl schlägt alles.
  if (entry?.whoopRecovery !== null && entry?.whoopRecovery !== undefined) {
    const pct = entry.whoopRecovery;
    const status = statusFromPercent(pct);
    const reasons: string[] = [];
    if (entry.sleepHours) reasons.push(`${fmt(entry.sleepHours)} h Schlaf.`);
    if (entry.soreness && entry.soreness >= 4) reasons.push('Deutlicher Muskelkater.');
    if (entry.stress && entry.stress >= 4) reasons.push('Hohe Belastung außerhalb des Trainings.');
    return {
      status,
      basis: 'measured',
      percent: pct,
      headline: `${pct} % Recovery — ${LABEL[status]}.`,
      reasons,
    };
  }

  // 2 — Punktestand aus dem, was da ist.
  let score = 0;
  const reasons: string[] = [];
  let measured = false;

  if (entry?.sleepHours) {
    measured = true;
    const h = entry.sleepHours;
    if (h < 5) {
      score -= 2;
      reasons.push(`${fmt(h)} h Schlaf — zu wenig für einen Reiz.`);
    } else if (h < 6.5) {
      score -= 1;
      reasons.push(`${fmt(h)} h Schlaf — knapp.`);
    } else if (h >= 7.5) {
      score += 1;
      reasons.push(`${fmt(h)} h Schlaf — ausreichend.`);
    } else {
      reasons.push(`${fmt(h)} h Schlaf.`);
    }
  }

  if (entry?.sleepQuality) {
    measured = true;
    if (entry.sleepQuality <= 2) {
      score -= 1;
      reasons.push('Schlafqualität schlecht.');
    } else if (entry.sleepQuality >= 4) {
      score += 1;
    }
  }

  if (entry?.soreness) {
    measured = true;
    if (entry.soreness >= 4) {
      score -= 2;
      reasons.push('Starker Muskelkater.');
    } else if (entry.soreness === 3) {
      score -= 1;
      reasons.push('Spürbarer Muskelkater.');
    }
  }

  if (entry?.stress) {
    measured = true;
    if (entry.stress >= 4) {
      score -= 1;
      reasons.push('Hoher Stress außerhalb des Trainings.');
    }
  }

  if (entry?.motivation) {
    measured = true;
    if (entry.motivation <= 2) {
      score -= 1;
      reasons.push('Wenig Energie.');
    } else if (entry.motivation >= 4) {
      score += 1;
    }
  }

  if (entry?.hrvMs && baseline.hrvMs) {
    measured = true;
    const change = (entry.hrvMs - baseline.hrvMs) / baseline.hrvMs;
    if (change <= -0.12) {
      score -= 2;
      reasons.push(`HRV ${pct(change)} unter deinem Schnitt — deutlich.`);
    } else if (change <= -0.06) {
      score -= 1;
      reasons.push(`HRV ${pct(change)} unter deinem Schnitt.`);
    } else if (change >= 0.08) {
      score += 1;
      reasons.push(`HRV ${pct(change)} über deinem Schnitt.`);
    }
  }

  if (entry?.restingHr && baseline.restingHr) {
    measured = true;
    const diff = entry.restingHr - baseline.restingHr;
    if (diff >= 5) {
      score -= 2;
      reasons.push(`Ruhepuls ${Math.round(diff)} Schläge über deinem Schnitt.`);
    } else if (diff >= 3) {
      score -= 1;
      reasons.push(`Ruhepuls ${Math.round(diff)} Schläge über deinem Schnitt.`);
    } else if (diff <= -3) {
      score += 1;
    }
  }

  if (afterNight) {
    score -= 1;
    reasons.push('Tag nach der Nachtschicht — der Körper holt noch Schlaf nach.');
  }

  if (measured) {
    const status: Recovery = score >= READY_AT ? 'ready' : score <= LOW_AT ? 'low' : 'moderate';
    return {
      status,
      basis: 'derived',
      percent: percentFromScore(score),
      headline: `Aus deinem Check-in geschätzt: ${LABEL[status]}.`,
      reasons,
    };
  }

  // 3 — Nichts eingetragen.
  //
  // Ohne Angaben gilt der Normalfall, nicht der beste Fall: Wer nichts
  // einträgt, bekommt keine harte Einheit geschenkt.
  //
  // Die Nachtschicht zieht hier bewusst **nicht** zusätzlich ab. Sie steckt
  // bereits in der Schichtregel — der Schlaftag lässt ohnehin höchstens
  // Mittleres zu. Beides zu rechnen machte aus jedem Schlaftag ohne Check-in
  // einen Ruhetag, und damit aus einem Regenerationstag einen Nichttag.
  return {
    status: 'moderate',
    basis: 'assumed',
    percent: 55,
    headline: afterNight
      ? 'Kein Check-in — nach der Nachtschicht wird ohnehin nichts Hartes geplant.'
      : 'Kein Check-in — gerechnet wird mit dem Normalfall.',
    reasons: afterNight ? ['Tag nach der Nachtschicht.'] : [],
  };
}

const LABEL: Record<Recovery, string> = {
  ready: 'ready',
  moderate: 'moderat',
  low: 'Regeneration',
};

function fmt(n: number): string {
  return n.toString().replace('.', ',');
}

function pct(change: number): string {
  return `${Math.abs(Math.round(change * 100))} %`;
}

/** Ob für einen Tag überhaupt etwas eingetragen wurde. */
export function hasInput(entry: DailyCheckIn | undefined): boolean {
  if (!entry) return false;
  return (
    entry.sleepHours !== null ||
    entry.sleepQuality !== null ||
    entry.soreness !== null ||
    entry.stress !== null ||
    entry.motivation !== null ||
    entry.whoopRecovery !== null ||
    entry.restingHr !== null ||
    entry.hrvMs !== null
  );
}
