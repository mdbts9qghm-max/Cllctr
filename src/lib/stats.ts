/**
 * Auswertung der Trainingsprotokolle.
 *
 * Grundsatz: kein Diagramm ohne Aussage. Jede Funktion hier beantwortet genau
 * eine Frage, die man sich als Athlet wirklich stellt — nicht "was lässt sich
 * aus den Daten zeichnen", sondern "was muss ich wissen".
 */

import { addDays, daysBetween, startOfWeek, today } from './dates';
import {
  SESSION_TYPES,
  type Discipline,
  type HrZoneNumber,
  type IsoDate,
  type Session,
  type SessionLog,
} from './types';

/** Ein Protokoll zusammen mit der Einheit, zu der es gehört. */
export interface LoggedSession {
  session: Session;
  log: SessionLog;
}

export function joinLogs(sessions: Session[], logs: SessionLog[]): LoggedSession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return logs
    .map((log) => {
      const session = byId.get(log.sessionId);
      return session ? { session, log } : null;
    })
    .filter((x): x is LoggedSession => x !== null)
    .sort((a, b) => a.log.date.localeCompare(b.log.date));
}

/* ------------------------------------------------------------------ */
/* Wochenvolumen                                                       */
/* ------------------------------------------------------------------ */

export interface WeekVolume {
  weekStart: IsoDate;
  /** Kurzes Achsenlabel, z.B. "17.8." */
  label: string;
  run: number;
  strength: number;
  mobility: number;
  total: number;
}

/**
 * Trainingsminuten je Woche und Disziplin.
 *
 * Frage: Halte ich das Volumen konstant, oder schwankt es mit der Schicht?
 * Bewusst in Kalenderwochen, obwohl geplant wird in Rotationszyklen — für die
 * Rückschau ist die Woche das Maß, in dem man denkt.
 */
export function weeklyVolume(
  logged: LoggedSession[],
  weeks = 8,
  reference: IsoDate = today(),
): WeekVolume[] {
  const firstWeek = startOfWeek(addDays(reference, -7 * (weeks - 1)));
  const buckets = new Map<IsoDate, WeekVolume>();

  for (let i = 0; i < weeks; i++) {
    const weekStart = addDays(firstWeek, i * 7);
    const [, month, dayOfMonth] = weekStart.split('-');
    buckets.set(weekStart, {
      weekStart,
      label: `${Number(dayOfMonth)}.${Number(month)}.`,
      run: 0,
      strength: 0,
      mobility: 0,
      total: 0,
    });
  }

  for (const { session, log } of logged) {
    if (!log.completed) continue;
    const weekStart = startOfWeek(log.date);
    const bucket = buckets.get(weekStart);
    if (!bucket) continue;

    const minutes = log.durationMin ?? session.plannedDurationMin ?? 0;
    bucket[session.discipline] += minutes;
    bucket.total += minutes;
  }

  return [...buckets.values()];
}

/* ------------------------------------------------------------------ */
/* Intensitätsverteilung                                               */
/* ------------------------------------------------------------------ */

export interface ZoneShare {
  zone: HrZoneNumber;
  minutes: number;
  /** Anteil an der Gesamtlaufzeit, 0–1. */
  share: number;
}

/**
 * Laufminuten je Herzfrequenz-Zone.
 *
 * Frage: Läuft das Training polarisiert — viel locker, wenig hart — oder
 * versandet alles im Mitteltempo? Das ist der klassische Fehler, und man sieht
 * ihn nur in dieser Verteilung.
 *
 * Nur Laufeinheiten, weil nur die eine Zone tragen.
 */
export function runZoneDistribution(logged: LoggedSession[], sinceDays = 56): ZoneShare[] {
  const since = addDays(today(), -sinceDays);
  const minutes = new Map<HrZoneNumber, number>([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);

  for (const { session, log } of logged) {
    if (!log.completed || log.date < since) continue;
    if (session.discipline !== 'run' || session.zone === null) continue;
    minutes.set(session.zone, (minutes.get(session.zone) ?? 0) + (log.durationMin ?? 0));
  }

  const total = [...minutes.values()].reduce((a, b) => a + b, 0);
  return [...minutes.entries()].map(([zone, min]) => ({
    zone,
    minutes: min,
    share: total > 0 ? min / total : 0,
  }));
}

/* ------------------------------------------------------------------ */
/* RPE-Verlauf                                                         */
/* ------------------------------------------------------------------ */

export interface RpePoint {
  date: IsoDate;
  label: string;
  /** Tatsächlich empfundene Anstrengung. */
  actual: number;
  /** Was geplant war — als Bezugslinie. */
  planned: number | null;
  title: string;
}

/**
 * RPE über die letzten Einheiten, gegen den geplanten Wert.
 *
 * Frage: Fühlt sich das Training härter an, als es sein sollte? Wenn die
 * tatsächliche Linie dauerhaft über der geplanten liegt, ist das ein
 * Ermüdungssignal — noch bevor die Leistung einbricht.
 */
export function rpeTrend(logged: LoggedSession[], limit = 20): RpePoint[] {
  return logged
    .filter((x) => x.log.completed && x.log.rpe !== null)
    .slice(-limit)
    .map(({ session, log }) => {
      const [, month, dayOfMonth] = log.date.split('-');
      return {
        date: log.date,
        label: `${Number(dayOfMonth)}.${Number(month)}.`,
        actual: log.rpe as number,
        planned: session.targetRpe,
        title: session.title,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Kennzahlen                                                          */
/* ------------------------------------------------------------------ */

export interface Headline {
  /** Anteil erledigter Einheiten, 0–1. */
  completionRate: number;
  plannedCount: number;
  doneCount: number;
  /** Minuten in der laufenden Kalenderwoche. */
  minutesThisWeek: number;
  /** Durchschnittliche RPE der letzten Einheiten, null ohne Daten. */
  avgRpe: number | null;
  /** Abweichung zur geplanten RPE — positiv heißt härter als vorgesehen. */
  rpeDelta: number | null;
}

export function headline(
  sessions: Session[],
  logged: LoggedSession[],
  sinceDays = 28,
  reference: IsoDate = today(),
): Headline {
  const since = addDays(reference, -sinceDays);

  // Nur vergangene Einheiten zählen — was noch bevorsteht, ist keine verpasste Chance.
  const relevant = sessions.filter(
    (s) => s.date >= since && s.date <= reference && s.status !== 'skipped',
  );
  const done = relevant.filter((s) => s.status === 'done');

  const weekStart = startOfWeek(reference);
  const minutesThisWeek = logged
    .filter((x) => x.log.completed && x.log.date >= weekStart && x.log.date <= reference)
    .reduce((sum, x) => sum + (x.log.durationMin ?? 0), 0);

  const recent = logged.filter((x) => x.log.completed && x.log.rpe !== null).slice(-10);
  const avgRpe =
    recent.length > 0 ? recent.reduce((s, x) => s + (x.log.rpe as number), 0) / recent.length : null;

  const withPlan = recent.filter((x) => x.session.targetRpe !== null);
  const rpeDelta =
    withPlan.length > 0
      ? withPlan.reduce((s, x) => s + ((x.log.rpe as number) - (x.session.targetRpe as number)), 0) /
        withPlan.length
      : null;

  return {
    completionRate: relevant.length > 0 ? done.length / relevant.length : 0,
    plannedCount: relevant.length,
    doneCount: done.length,
    minutesThisWeek,
    avgRpe,
    rpeDelta,
  };
}

/* ------------------------------------------------------------------ */
/* Deload-Erkennung                                                    */
/* ------------------------------------------------------------------ */

export type DeloadSeverity = 'none' | 'watch' | 'recommend';

export interface DeloadSignal {
  severity: DeloadSeverity;
  /** Ein Satz für die Anzeige. */
  summary: string;
  /** Welche Regeln angeschlagen haben. */
  reasons: string[];
}

/**
 * Braucht der Körper eine Entlastungswoche?
 *
 * Drei unabhängige Signale, jedes für sich ein Hinweis, zwei davon eine
 * Empfehlung:
 *
 *   1. Mehrere Einheiten in Folge schlecht bewertet.
 *   2. Die tatsächliche Anstrengung liegt deutlich über der geplanten.
 *   3. Das Volumen ist über mehrere Wochen stark gestiegen.
 *
 * Bewusst zurückhaltend: Eine App, die bei jeder schlechten Einheit Alarm
 * schlägt, wird ignoriert.
 */
export function deloadSignal(logged: LoggedSession[], reference: IsoDate = today()): DeloadSignal {
  const reasons: string[] = [];
  const completed = logged.filter((x) => x.log.completed);

  // 1 — schlechte Bewertungen in Folge
  const lastFive = completed.slice(-5);
  let streak = 0;
  for (let i = lastFive.length - 1; i >= 0; i--) {
    if (lastFive[i].log.feeling === 'bad') streak++;
    else break;
  }
  if (streak >= 3) {
    reasons.push(`${streak} Einheiten in Folge als schlecht bewertet.`);
  }

  // 2 — spürbar härter als geplant
  const recent = completed.filter((x) => x.log.rpe !== null && x.session.targetRpe !== null).slice(-6);
  if (recent.length >= 4) {
    const delta =
      recent.reduce((s, x) => s + ((x.log.rpe as number) - (x.session.targetRpe as number)), 0) /
      recent.length;
    if (delta >= 1.5) {
      reasons.push(
        `Die letzten ${recent.length} Einheiten waren im Schnitt ${delta.toFixed(1)} RPE-Punkte härter als geplant.`,
      );
    }
  }

  // 3 — steil steigendes Volumen
  const weeks = weeklyVolume(completed, 4, reference).filter((w) => w.total > 0);
  if (weeks.length >= 3) {
    const [first, , last] = [weeks[0], weeks[1], weeks[weeks.length - 1]];
    if (first.total > 0 && last.total / first.total >= 1.4) {
      const rise = Math.round((last.total / first.total - 1) * 100);
      reasons.push(`Das Wochenvolumen ist in drei Wochen um ${rise} % gestiegen.`);
    }
  }

  if (reasons.length === 0) {
    return {
      severity: 'none',
      summary: 'Keine Ermüdungssignale. Der Block läuft wie geplant weiter.',
      reasons: [],
    };
  }

  if (reasons.length === 1) {
    return {
      severity: 'watch',
      summary: 'Ein Hinweis auf Ermüdung — im Auge behalten, noch kein Grund umzuplanen.',
      reasons,
    };
  }

  return {
    severity: 'recommend',
    summary:
      'Mehrere Ermüdungssignale gleichzeitig. Eine Entlastungswoche jetzt ist billiger als eine erzwungene Pause später.',
    reasons,
  };
}

/** Belastung je Disziplin über einen Zeitraum — für die Kennzahlenzeile. */
export function disciplineMinutes(
  logged: LoggedSession[],
  sinceDays = 28,
): Record<Discipline, number> {
  const since = addDays(today(), -sinceDays);
  const result: Record<Discipline, number> = { run: 0, strength: 0, mobility: 0 };
  for (const { session, log } of logged) {
    if (!log.completed || log.date < since) continue;
    result[session.discipline] += log.durationMin ?? 0;
  }
  return result;
}

/** Anteil der Einheiten, die als hart gelten — grobe Polarisierungs-Kennzahl. */
export function hardShare(logged: LoggedSession[], sinceDays = 28): number {
  const since = addDays(today(), -sinceDays);
  const relevant = logged.filter((x) => x.log.completed && x.log.date >= since);
  if (relevant.length === 0) return 0;
  const hard = relevant.filter((x) => SESSION_TYPES[x.session.type].countsAsHardDay).length;
  return hard / relevant.length;
}

/** Tage seit der letzten erledigten Einheit — für die Comeback-Erkennung in Phase 6. */
export function daysSinceLastSession(logged: LoggedSession[], reference: IsoDate = today()): number | null {
  const last = logged.filter((x) => x.log.completed).at(-1);
  return last ? daysBetween(last.log.date, reference) : null;
}
