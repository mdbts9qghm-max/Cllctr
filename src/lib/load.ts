/**
 * Belastung: was das Training kostet.
 *
 * Bewusst ein einfaches Modell. `load = Minuten × Intensitätsfaktor ×
 * Sportfaktor`. Kein TRIMP, kein TSS, keine Herzfrequenzintegration — die
 * bräuchten sekundengenaue Daten, die es ohne Geräteanbindung nicht gibt, und
 * ein Modell, das niemand nachrechnen kann, wird nicht geglaubt und deshalb
 * nicht befolgt.
 *
 * Was daraus entsteht, reicht für die eigentliche Frage: Wird gerade zu schnell
 * gesteigert, und ist heute noch Platz für etwas Hartes?
 */

import { addDays, dateRange, startOfWeek } from './dates';
import {
  ENDURANCE_SPORTS,
  INTENSITY_FACTOR,
  SPORT_LOAD_FACTOR,
  type IsoDate,
  type Sport,
  type TrainingSession,
} from './types';

/** Die Minuten, die zählen: tatsächlich, sonst geplant. */
export function minutesOf(s: TrainingSession): number {
  return s.actualMinutes ?? s.plannedMinutes ?? 0;
}

export function distanceOf(s: TrainingSession): number {
  return s.actualDistanceKm ?? s.plannedDistanceKm ?? 0;
}

/**
 * Belastung einer Einheit.
 *
 * Liegt ein RPE vor, ersetzt er die geplante Intensität: Was sich hart
 * angefühlt hat, war hart — unabhängig davon, was auf dem Plan stand.
 */
export function loadOf(s: TrainingSession): number {
  const minutes = minutesOf(s);
  if (minutes <= 0) return 0;
  const intensityFactor =
    s.rpe !== null && s.rpe > 0
      ? // RPE 1–10 auf den Faktorbereich 1,0–2,5 abgebildet.
        1.0 + (Math.min(10, Math.max(1, s.rpe)) - 1) * (1.5 / 9)
      : INTENSITY_FACTOR[s.intensity];
  return Math.round(minutes * intensityFactor * SPORT_LOAD_FACTOR[s.sport]);
}

/** Zählt eine Einheit als harter Tag? */
export function isHard(s: TrainingSession): boolean {
  if (s.rpe !== null && s.rpe >= 8) return true;
  return s.intensity === 'hard';
}

/** Einheiten, die stattgefunden haben oder noch stattfinden sollen. */
export function counts(s: TrainingSession): boolean {
  return s.status === 'done' || s.status === 'planned';
}

/* ------------------------------------------------------------------ */
/* Zeiträume                                                           */
/* ------------------------------------------------------------------ */

export interface VolumeSummary {
  minutes: number;
  load: number;
  sessions: number;
  hardSessions: number;
  /** Kilometer je Sportart. */
  km: Partial<Record<Sport, number>>;
  /** Minuten je Sportart. */
  minutesBySport: Partial<Record<Sport, number>>;
  /** Tage mit mindestens einer Einheit. */
  activeDays: number;
}

export function summarize(sessions: TrainingSession[]): VolumeSummary {
  const km: Partial<Record<Sport, number>> = {};
  const minutesBySport: Partial<Record<Sport, number>> = {};
  const days = new Set<IsoDate>();
  let minutes = 0;
  let load = 0;
  let hardSessions = 0;

  for (const s of sessions) {
    const m = minutesOf(s);
    minutes += m;
    load += loadOf(s);
    if (isHard(s)) hardSessions++;
    if (m > 0) days.add(s.date);
    minutesBySport[s.sport] = (minutesBySport[s.sport] ?? 0) + m;
    const d = distanceOf(s);
    if (d > 0) km[s.sport] = Math.round(((km[s.sport] ?? 0) + d) * 10) / 10;
  }

  return {
    minutes,
    load,
    sessions: sessions.length,
    hardSessions,
    km,
    minutesBySport,
    activeDays: days.size,
  };
}

export function inRange(
  sessions: TrainingSession[],
  from: IsoDate,
  to: IsoDate,
): TrainingSession[] {
  return sessions.filter((s) => counts(s) && s.date >= from && s.date <= to);
}

export function ofWeek(sessions: TrainingSession[], anyDayOfWeek: IsoDate): TrainingSession[] {
  const start = startOfWeek(anyDayOfWeek);
  return inRange(sessions, start, addDays(start, 6));
}

/* ------------------------------------------------------------------ */
/* Akut, chronisch, Rampe                                              */
/* ------------------------------------------------------------------ */

export interface LoadBalance {
  /** Belastung der letzten 7 Tage. */
  acute: number;
  /** Wochenschnitt der letzten 28 Tage. */
  chronic: number;
  /**
   * Wie stark die letzten 7 Tage über dem Vierwochenschnitt liegen, in Prozent.
   * Null, solange es keinen belastbaren Schnitt gibt.
   */
  rampPct: number | null;
  /** Über der eingestellten Grenze — die App warnt. */
  rising: boolean;
}

/**
 * Steigerung im Blick behalten.
 *
 * Verglichen wird die laufende Woche mit dem Schnitt der vier Wochen davor.
 * Unter zwei Wochen Vorgeschichte wird nichts behauptet: Wer neu anfängt, hat
 * immer eine Steigerung von unendlich Prozent, und eine Warnung, die am ersten
 * Tag erscheint, wird nie wieder ernst genommen.
 */
export function loadBalance(
  sessions: TrainingSession[],
  reference: IsoDate,
  warnPct: number,
): LoadBalance {
  const acute = summarize(inRange(sessions, addDays(reference, -6), reference)).load;

  const earlier = inRange(sessions, addDays(reference, -34), addDays(reference, -7));
  const chronicWeeks = 4;
  const chronic = Math.round(summarize(earlier).load / chronicWeeks);

  const historyDays = earlier.length > 0 ? 1 : 0;
  const rampPct =
    historyDays > 0 && chronic >= 50 ? Math.round(((acute - chronic) / chronic) * 100) : null;

  return { acute, chronic, rampPct, rising: rampPct !== null && rampPct > warnPct };
}

/* ------------------------------------------------------------------ */
/* Harte Tage                                                          */
/* ------------------------------------------------------------------ */

export interface HardContext {
  /** Harte Tage in den sieben Tagen vor dem Stichtag. */
  last7: number;
  /** Harte Tage direkt davor, ohne Unterbrechung. */
  streakBefore: number;
  /** Harte Einheiten in der laufenden Woche, vor dem Stichtag. */
  thisWeek: number;
  /** Tage seit der letzten Einheit je Sportart. Fehlt eine, war nie eine da. */
  daysSince: Partial<Record<Sport, number>>;
  /** Tage seit der letzten langen Ausdauereinheit (≥ 90 min). */
  daysSinceLong: number | null;
  /**
   * Längste Ausdauereinheit der letzten vier Wochen, in Minuten.
   *
   * Der Bezugspunkt für die nächste lange Einheit: Ein Sprung über das hinaus,
   * was zuletzt tatsächlich gelaufen wurde, ist die häufigste Verletzungsquelle
   * im Ausdauertraining — und ein Wochenziel, das man sich vorgenommen hat, ist
   * kein Beleg dafür, dass die Beine dort schon waren.
   */
  longestRecentMin: number;
}

const LONG_SESSION_MIN = 90;

export function hardContext(
  sessions: TrainingSession[],
  date: IsoDate,
): HardContext {
  const hardDays = new Set<IsoDate>();
  const lastBySport = new Map<Sport, IsoDate>();
  let lastLong: IsoDate | null = null;
  let longestRecentMin = 0;
  const recentFrom = addDays(date, -28);

  for (const s of sessions) {
    if (s.status === 'skipped' || s.status === 'missed') continue;
    if (s.date >= date) continue;
    if (isHard(s)) hardDays.add(s.date);

    if (ENDURANCE_SPORTS.includes(s.sport) && s.date >= recentFrom) {
      longestRecentMin = Math.max(longestRecentMin, minutesOf(s));
    }

    const previous = lastBySport.get(s.sport);
    if (!previous || s.date > previous) lastBySport.set(s.sport, s.date);

    if (
      ENDURANCE_SPORTS.includes(s.sport) &&
      minutesOf(s) >= LONG_SESSION_MIN &&
      (!lastLong || s.date > lastLong)
    ) {
      lastLong = s.date;
    }
  }

  let last7 = 0;
  for (let i = 1; i <= 7; i++) if (hardDays.has(addDays(date, -i))) last7++;

  let streakBefore = 0;
  let cursor = addDays(date, -1);
  while (hardDays.has(cursor)) {
    streakBefore++;
    cursor = addDays(cursor, -1);
  }

  const weekStart = startOfWeek(date);
  const thisWeek = dateRange(weekStart, addDays(date, -1)).filter((d) => hardDays.has(d)).length;

  const daysSince: Partial<Record<Sport, number>> = {};
  for (const [sport, last] of lastBySport) {
    daysSince[sport] = Math.max(0, daysDiff(last, date));
  }

  return {
    last7,
    streakBefore,
    thisWeek,
    daysSince,
    daysSinceLong: lastLong ? daysDiff(lastLong, date) : null,
    longestRecentMin,
  };
}

function daysDiff(from: IsoDate, to: IsoDate): number {
  return dateRange(from, to).length - 1;
}
