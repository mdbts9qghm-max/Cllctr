/**
 * Die Erholung wird **geschätzt**, nicht eingetragen.
 *
 * Früher gab es drei Knöpfe: niedrig, mittel, hoch. Das war eine zweite
 * Wahrheit neben den Messwerten — stand auf der Uhr 28 % und im Knopf "mittel",
 * wusste niemand, welche gilt. Und wer morgens um sechs nach einer Nachtschicht
 * eine Selbsteinschätzung abgeben soll, drückt "mittel", weil das die Mitte ist.
 *
 * Jetzt leitet die App die Stufe aus dem ab, was da ist:
 *
 *   1. **Recovery in Prozent** — liegt sie vor, ist sie die Antwort. WHOOP
 *      verrechnet dafür bereits HRV, Ruhepuls, Schlaf und Atemfrequenz. Diesen
 *      Wert mit unseren schwächeren Signalen zu überstimmen, wäre schlechter.
 *   2. **Sonst ein Punktestand** aus Schlafdauer, Schlafschuld, HRV und
 *      Ruhepuls — jeweils gegen die eigene Basislinie der letzten Wochen, nicht
 *      gegen einen Lehrbuchwert.
 *   3. **Sonst der Zusammenhang**: heute und rückwärts gilt der Normalfall,
 *      für künftige Tage wird von guter Erholung ausgegangen, damit der Plan
 *      die harten Einheiten überhaupt irgendwo hinlegen kann.
 *
 * Was hier bewusst **nicht** einfließt: die Trainingslast der letzten Tage.
 * Harte Tage in Folge und das Wochenkontingent sind bereits Regeln in
 * `rules.ts`. Sie zusätzlich in die Erholung zu rechnen hieße, dieselbe
 * Belastung zweimal abzuziehen — der Plan würde nach jeder harten Woche
 * einbrechen, ohne dass ein Messwert das hergäbe.
 */

import { daysBetween } from './dates';
import {
  DEFAULT_RECOVERY,
  DEFAULT_SLEEP_DEBT,
  recoveryFromPct,
  sleepDebtFromHours,
  type DayReadiness,
  type IsoDate,
  type Recovery,
  type SleepDebt,
} from './types';

/** Woher die Stufe kommt — entscheidet, wie die App darüber spricht. */
export type RecoveryBasis =
  /** Aus der Recovery-Prozentzahl. */
  | 'measured'
  /** Aus Schlaf, HRV und Ruhepuls geschätzt. */
  | 'derived'
  /** Nichts gemessen — aus dem Zusammenhang angenommen. */
  | 'assumed';

export interface RecoveryEstimate {
  recovery: Recovery;
  sleepDebt: SleepDebt;
  basis: RecoveryBasis;
  /** Ein Satz, wie die Stufe zustande kam. */
  headline: string;
  /** Die einzelnen Signale, jedes in einem Halbsatz. */
  reasons: string[];
}

/* ------------------------------------------------------------------ */
/* Basislinie                                                          */
/* ------------------------------------------------------------------ */

/**
 * Der eigene Normalwert für HRV und Ruhepuls.
 *
 * Absolute Zahlen sagen nichts: Eine HRV von 45 ms ist für den einen
 * hervorragend und für den anderen ein Alarmsignal. Verglichen wird deshalb
 * gegen den eigenen Schnitt der letzten Wochen.
 */
export interface Baseline {
  hrvMs: number | null;
  restingHr: number | null;
  /** Auf wie vielen Tagen die Basislinie beruht. */
  days: number;
}

/** Wie weit zurück Werte für die Basislinie zählen. */
const BASELINE_WINDOW_DAYS = 21;
/** Weniger als so viele Werte sind kein Schnitt, sondern Zufall. */
const BASELINE_MIN_DAYS = 4;

export function buildBaseline(rows: DayReadiness[], before: IsoDate): Baseline {
  const window = rows.filter(
    (r) => r.date < before && daysBetween(r.date, before) <= BASELINE_WINDOW_DAYS,
  );

  const mean = (values: number[]) =>
    values.length >= BASELINE_MIN_DAYS
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;

  const hrv = window.map((r) => r.hrvMs).filter((v): v is number => v !== null && v > 0);
  const rhr = window.map((r) => r.restingHr).filter((v): v is number => v !== null && v > 0);

  return {
    hrvMs: mean(hrv),
    restingHr: mean(rhr),
    days: Math.max(hrv.length, rhr.length),
  };
}

/* ------------------------------------------------------------------ */
/* Schlafschuld                                                        */
/* ------------------------------------------------------------------ */

/** Stundenziel, gegen das die Schlafschuld gerechnet wird. */
const SLEEP_TARGET_H = 7.5;
/** So viele Nächte zurück werden für die Schuld betrachtet. */
const DEBT_WINDOW_NIGHTS = 4;

/**
 * Die Schlafschuld eines Tages.
 *
 * Steht sie in den Daten (WHOOP weist sie aus), gilt sie. Sonst wird sie aus
 * den letzten vier Nächten gegen 7,5 Stunden gerechnet — dem Wert, bei dem die
 * meisten Schichtarbeiter gerade so über die Runden kommen. Unter zwei bekannten
 * Nächten wird nichts behauptet.
 */
export function sleepDebtFor(
  date: IsoDate,
  row: DayReadiness | undefined,
  rows: DayReadiness[],
): SleepDebt {
  if (row?.sleepDebtHours !== null && row?.sleepDebtHours !== undefined) {
    return sleepDebtFromHours(row.sleepDebtHours);
  }

  const nights = rows
    .filter(
      (r) =>
        r.sleepHours !== null &&
        r.date <= date &&
        daysBetween(r.date, date) < DEBT_WINDOW_NIGHTS,
    )
    .map((r) => r.sleepHours as number);

  if (nights.length < 2) return DEFAULT_SLEEP_DEBT;
  const deficit = nights.reduce((sum, h) => sum + Math.max(0, SLEEP_TARGET_H - h), 0);
  return sleepDebtFromHours(deficit);
}

/* ------------------------------------------------------------------ */
/* Schätzung                                                           */
/* ------------------------------------------------------------------ */

/** Ab diesem Punktestand gilt die Erholung als hoch bzw. niedrig. */
const HIGH_AT = 2;
const LOW_AT = -2;

export interface RecoveryInput {
  date: IsoDate;
  row: DayReadiness | undefined;
  baseline: Baseline;
  sleepDebt: SleepDebt;
  /** Lag am Vortag eine Nachtschicht? Kostet Erholung, ohne dass etwas gemessen sein muss. */
  afterNightShift: boolean;
  todayIso: IsoDate;
}

export function estimateRecovery(input: RecoveryInput): RecoveryEstimate {
  const { row, baseline, sleepDebt, afterNightShift, date, todayIso } = input;

  // 1. Die gemessene Prozentzahl schlägt alles.
  if (row?.recoveryPct !== null && row?.recoveryPct !== undefined) {
    const recovery = recoveryFromPct(row.recoveryPct);
    return {
      recovery,
      sleepDebt,
      basis: 'measured',
      headline: `${row.recoveryPct} % Recovery — das ist ${SHORT[recovery]}.`,
      reasons: sleepNote(row, sleepDebt),
    };
  }

  // 2. Punktestand aus den übrigen Messwerten.
  let score = 0;
  const reasons: string[] = [];
  let measured = false;

  if (row?.sleepHours !== null && row?.sleepHours !== undefined) {
    measured = true;
    const h = row.sleepHours;
    if (h < 5) {
      score -= 2;
      reasons.push(`${fmt(h)} h Schlaf — zu wenig für einen Reiz.`);
    } else if (h < 6) {
      score -= 1;
      reasons.push(`${fmt(h)} h Schlaf — knapp.`);
    } else if (h >= 7.5) {
      score += 1;
      reasons.push(`${fmt(h)} h Schlaf — ausreichend.`);
    } else {
      reasons.push(`${fmt(h)} h Schlaf — durchschnittlich.`);
    }
  }

  if (sleepDebt === 'high') {
    score -= 2;
    reasons.push('Große Schlafschuld aus den letzten Nächten.');
  } else if (sleepDebt === 'some') {
    score -= 1;
    reasons.push('Etwas Schlafschuld aus den letzten Nächten.');
  }

  if (row?.hrvMs && baseline.hrvMs) {
    measured = true;
    const change = (row.hrvMs - baseline.hrvMs) / baseline.hrvMs;
    if (change <= -0.12) {
      score -= 2;
      reasons.push(`HRV ${pct(change)} unter deinem Schnitt — deutlich.`);
    } else if (change <= -0.06) {
      score -= 1;
      reasons.push(`HRV ${pct(change)} unter deinem Schnitt.`);
    } else if (change >= 0.08) {
      score += 1;
      reasons.push(`HRV ${pct(change)} über deinem Schnitt.`);
    } else {
      reasons.push('HRV auf deinem Schnitt.');
    }
  }

  if (row?.restingHr && baseline.restingHr) {
    measured = true;
    const diff = row.restingHr - baseline.restingHr;
    if (diff >= 5) {
      score -= 2;
      reasons.push(`Ruhepuls ${Math.round(diff)} Schläge über deinem Schnitt — deutlich.`);
    } else if (diff >= 3) {
      score -= 1;
      reasons.push(`Ruhepuls ${Math.round(diff)} Schläge über deinem Schnitt.`);
    } else if (diff <= -3) {
      score += 1;
      reasons.push(`Ruhepuls ${Math.abs(Math.round(diff))} Schläge unter deinem Schnitt.`);
    }
  }

  if (afterNightShift) {
    score -= 1;
    reasons.push('Tag nach der Nachtschicht — der Körper holt noch Schlaf nach.');
  }

  if (measured || sleepDebt !== 'none') {
    const recovery: Recovery = score >= HIGH_AT ? 'high' : score <= LOW_AT ? 'low' : 'mid';
    return {
      recovery,
      sleepDebt,
      basis: 'derived',
      headline: `Aus deinen Werten geschätzt: ${SHORT[recovery]}.`,
      reasons,
    };
  }

  // 3. Nichts gemessen.
  //
  // Heute und rückwärts gilt der Normalfall: Wie es einem geht, weiß man am
  // selben Tag, und wer nichts einträgt, bekommt keine harte Einheit geschenkt.
  // Für künftige Tage wird von guter Erholung ausgegangen — nicht als Aussage
  // über den Körper, sondern über den Plan: Er muss die harten Einheiten
  // irgendwo hinlegen, sonst gibt es nie welche. Kommen später Zahlen dazu,
  // gibt er von selbst nach.
  // Ein Tag nach der Nachtschicht ist kein erholter Tag, auch wenn nichts
  // gemessen wurde. Ihn trotzdem als "hoch" anzunehmen und den Grund darunter
  // zu nennen, ohne dass er wirkt, wäre ein Widerspruch auf einem Bildschirm.
  const future = date > todayIso && !afterNightShift;
  return {
    recovery: future ? 'high' : DEFAULT_RECOVERY,
    sleepDebt,
    basis: 'assumed',
    headline: afterNightShift
      ? 'Noch keine Werte — nach einer Nachtschicht wird nicht von Erholung ausgegangen.'
      : date > todayIso
        ? 'Noch keine Werte — geplant, als wärst du erholt.'
        : 'Keine Werte für heute — gerechnet wird mit dem Normalfall.',
    reasons: afterNightShift
      ? ['Tag nach der Nachtschicht — der Körper holt noch Schlaf nach.']
      : [],
  };
}

const SHORT: Record<Recovery, string> = { low: 'niedrig', mid: 'mittel', high: 'hoch' };

function fmt(n: number): string {
  return n.toString().replace('.', ',');
}

function pct(change: number): string {
  return `${Math.abs(Math.round(change * 100))} %`;
}

function sleepNote(row: DayReadiness, debt: SleepDebt): string[] {
  const out: string[] = [];
  if (row.sleepHours !== null) out.push(`${fmt(row.sleepHours)} h Schlaf.`);
  if (debt === 'high') out.push('Große Schlafschuld — die Regeln schließen Hartes ohnehin aus.');
  else if (debt === 'some') out.push('Etwas Schlafschuld.');
  return out;
}

/* ------------------------------------------------------------------ */
/* Für ganze Zeiträume                                                 */
/* ------------------------------------------------------------------ */

/**
 * Die Schätzung für jeden Tag eines Zeitraums.
 *
 * Der Generator braucht das für jeden geplanten Tag, und die Basislinie hängt
 * an den Tagen davor — beides einmal vorzurechnen ist billiger und vor allem
 * gleich, als es an zwei Stellen leicht verschieden zu tun.
 */
export function recoveryTimeline(
  rows: DayReadiness[],
  dates: IsoDate[],
  todayIso: IsoDate,
  afterNightShift: (date: IsoDate) => boolean,
): Map<IsoDate, RecoveryEstimate> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((r) => [r.date, r]));
  const out = new Map<IsoDate, RecoveryEstimate>();

  for (const date of dates) {
    const row = byDate.get(date);
    out.set(
      date,
      estimateRecovery({
        date,
        row,
        baseline: buildBaseline(sorted, date),
        sleepDebt: sleepDebtFor(date, row, sorted),
        afterNightShift: afterNightShift(date),
        todayIso,
      }),
    );
  }
  return out;
}

/** Die Schätzung für einen einzelnen Tag. Für Anzeigen, die nur einen brauchen. */
export function recoveryFor(
  date: IsoDate,
  rows: DayReadiness[],
  todayIso: IsoDate,
  afterNightShift: boolean,
): RecoveryEstimate {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const row = sorted.find((r) => r.date === date);
  return estimateRecovery({
    date,
    row,
    baseline: buildBaseline(sorted, date),
    sleepDebt: sleepDebtFor(date, row, sorted),
    afterNightShift,
    todayIso,
  });
}

/** Ob für einen Tag überhaupt eine Zahl vorliegt. */
export function hasMeasurement(row: DayReadiness | undefined): boolean {
  if (!row) return false;
  return (
    row.recoveryPct !== null ||
    row.sleepHours !== null ||
    row.sleepDebtHours !== null ||
    row.hrvMs !== null ||
    row.restingHr !== null ||
    row.strain !== null
  );
}
