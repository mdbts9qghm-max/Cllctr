/**
 * Schlaf und Erholung pro Tag.
 *
 * Diese Werte kommen **von Hand**. Cllctr hat keinen Server, keinen Login und
 * keinen Zugriff auf eine Uhr — es gibt also niemanden, der die Erholung von
 * außen liefern könnte. Statt eine Zahl zu erfinden, fragt die App danach und
 * geht ohne Eintrag vom Normalfall aus: mittlere Erholung, keine Schlafschuld.
 *
 * Genau deshalb ist der Eintrag auch bewusst grob (niedrig/mittel/hoch statt
 * einer Prozentzahl): Was man morgens in fünf Sekunden ehrlich beantworten
 * kann, wird eingetragen. Was drei Felder braucht, bleibt leer.
 */

import { db } from './db';
import { addDays, dateRange } from './dates';
import { now } from './ids';
import {
  DEFAULT_RECOVERY,
  DEFAULT_SLEEP_DEBT,
  recoveryFromWhoop,
  sleepDebtFromHours,
  type DayReadiness,
  type IsoDate,
  type Recovery,
  type SleepDebt,
  type WhoopEntry,
} from './types';

export const EMPTY_WHOOP: WhoopEntry = {
  recoveryPct: null,
  sleepHours: null,
  sleepDebtHours: null,
  strain: null,
  hrvMs: null,
  restingHr: null,
};

/** Der Normalfall für einen Tag ohne Eintrag. */
export function defaultReadiness(date: IsoDate): DayReadiness {
  const ts = now();
  return {
    date,
    recovery: DEFAULT_RECOVERY,
    sleepHours: null,
    sleepDebt: DEFAULT_SLEEP_DEBT,
    whoop: null,
    note: '',
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Alles Eingetragene eines Zeitraums, als Karte für den Generator. */
export async function readinessRange(
  from: IsoDate,
  to: IsoDate,
): Promise<Map<IsoDate, DayReadiness>> {
  const rows = await db.readiness.where('date').between(from, to, true, true).toArray();
  return new Map(rows.map((r) => [r.date, r]));
}

export async function getReadiness(date: IsoDate): Promise<DayReadiness | undefined> {
  return db.readiness.get(date);
}

/** Schreibt oder ändert den Eintrag eines Tages. */
export async function setReadiness(
  date: IsoDate,
  patch: Partial<Pick<DayReadiness, 'recovery' | 'sleepHours' | 'sleepDebt' | 'note'>>,
): Promise<void> {
  const existing = await db.readiness.get(date);
  const ts = now();
  await db.readiness.put({
    ...(existing ?? defaultReadiness(date)),
    ...patch,
    date,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  });
}

/**
 * Trägt WHOOP-Werte ein und leitet daraus ab, was die Planung braucht.
 *
 * Beides in einem Schritt: Die Rohwerte bleiben stehen, und Erholung, Schlaf
 * und Schlafschuld werden daraus **überschrieben**. Sonst stünde auf der Uhr
 * 28 % und in der App weiter "mittel", weil dort noch die Einschätzung von
 * gestern klebt — und der Plan rechnete mit einer Erholung, die es nicht gibt.
 *
 * Was WHOOP nicht liefert, bleibt unberührt: Wer nur die Recovery überträgt,
 * behält seine eigene Angabe zum Schlaf.
 */
export async function setWhoop(date: IsoDate, patch: Partial<WhoopEntry>): Promise<void> {
  const existing = await db.readiness.get(date);
  const base = existing ?? defaultReadiness(date);
  const whoop: WhoopEntry = { ...EMPTY_WHOOP, ...(base.whoop ?? {}), ...patch };
  const ts = now();

  await db.readiness.put({
    ...base,
    date,
    whoop: isEmptyWhoop(whoop) ? null : whoop,
    recovery: whoop.recoveryPct !== null ? recoveryFromWhoop(whoop.recoveryPct) : base.recovery,
    sleepHours: whoop.sleepHours !== null ? whoop.sleepHours : base.sleepHours,
    sleepDebt:
      whoop.sleepDebtHours !== null ? sleepDebtFromHours(whoop.sleepDebtHours) : base.sleepDebt,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  });
}

export function isEmptyWhoop(w: WhoopEntry | null | undefined): boolean {
  if (!w) return true;
  return (
    w.recoveryPct === null &&
    w.sleepHours === null &&
    w.sleepDebtHours === null &&
    w.strain === null &&
    w.hrvMs === null &&
    w.restingHr === null
  );
}

/** Kommt die Erholung dieses Tages aus WHOOP oder aus eigener Einschätzung? */
export function isFromWhoop(row: DayReadiness | undefined): boolean {
  return row?.whoop?.recoveryPct !== null && row?.whoop?.recoveryPct !== undefined;
}

/** Entfernt den Eintrag wieder — der Tag gilt dann als normal. */
export async function clearReadiness(date: IsoDate): Promise<void> {
  await db.readiness.delete(date);
}

/**
 * Schlafschuld aus den letzten Nächten schätzen.
 *
 * Nur als Vorschlag beim Eintragen gedacht, nicht als Ersatz: Wer sieben Tage
 * nichts eingetragen hat, hat auch keine Schlafschuld zu berechnen. Gerechnet
 * wird gegen 7,5 Stunden — der Wert, bei dem die meisten Schichtarbeiter
 * gerade so über die Runden kommen.
 */
export function estimateSleepDebt(recent: DayReadiness[]): SleepDebt {
  const known = recent.filter((r) => r.sleepHours !== null);
  if (known.length < 2) return 'none';
  const deficit = known.reduce((sum, r) => sum + Math.max(0, 7.5 - (r.sleepHours ?? 7.5)), 0);
  if (deficit >= 6) return 'high';
  if (deficit >= 2.5) return 'some';
  return 'none';
}

/** Vorschlag für die Schlafschuld eines Tages aus den vier Nächten davor. */
export async function suggestSleepDebt(date: IsoDate): Promise<SleepDebt> {
  const rows = await readinessRange(addDays(date, -4), addDays(date, -1));
  const recent = dateRange(addDays(date, -4), addDays(date, -1))
    .map((d): DayReadiness | undefined => rows.get(d))
    .filter((r): r is DayReadiness => r !== undefined);
  return estimateSleepDebt(recent);
}

/**
 * Ob für einen Tag überhaupt etwas eingetragen wurde.
 *
 * Der Unterschied zählt: "mittel, weil nichts eingetragen" und "mittel, weil so
 * eingetragen" sehen im Plan gleich aus, bedeuten aber nicht dasselbe.
 */
export function isEntered(row: DayReadiness | undefined): boolean {
  return row !== undefined;
}

export function recoveryOf(row: DayReadiness | undefined): Recovery {
  return row?.recovery ?? DEFAULT_RECOVERY;
}

/**
 * Die Erholung, mit der ein Tag **geplant** wird.
 *
 * Für heute und die Vergangenheit gilt ohne Eintrag der Normalfall `mid`: Wie
 * es einem geht, weiß man am selben Tag — wer nichts einträgt, bekommt keine
 * harte Einheit geschenkt.
 *
 * Für künftige Tage gilt ohne Eintrag `high`. Das ist keine Annahme über den
 * Körper, sondern eine über den Plan: Ein Plan muss die harten Einheiten
 * irgendwo hinlegen, sonst gibt es nie welche und die Steigerung steht still.
 * Trägt man für einen dieser Tage später etwas Schlechteres ein, gibt der Plan
 * von selbst nach — das ist die Richtung, in der die Regel wirken soll.
 */
export function plannedRecovery(
  date: IsoDate,
  row: DayReadiness | undefined,
  todayIso: IsoDate,
): Recovery {
  if (row) return row.recovery;
  return date > todayIso ? 'high' : DEFAULT_RECOVERY;
}

export function sleepDebtOf(row: DayReadiness | undefined): SleepDebt {
  return row?.sleepDebt ?? DEFAULT_SLEEP_DEBT;
}
