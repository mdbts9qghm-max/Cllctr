/**
 * Die Messwerte eines Tages.
 *
 * Hier stehen nur Zahlen. Was sie bedeuten — hohe, mittlere oder niedrige
 * Erholung —, rechnet `recovery.ts` aus. Die Trennung ist der Punkt: Eine
 * eingetragene Stufe neben den Zahlen wäre eine zweite Wahrheit, und bei jedem
 * Widerspruch wüsste niemand, welche gilt.
 *
 * Es gibt keine Schnittstelle zu WHOOP: Cllctr hat keinen Server und keine
 * API-Schlüssel, das ist der Kern des Projekts. Übertragen werden deshalb die
 * Zahlen, die morgens ohnehin auf dem Bildschirm stehen.
 */

import { db } from './db';
import { now } from './ids';
import {
  MEASUREMENT_KEYS,
  type DayReadiness,
  type IsoDate,
  type MeasurementKey,
} from './types';

/** Ein leerer Tag — alle Werte offen. */
export function emptyReadiness(date: IsoDate): DayReadiness {
  const ts = now();
  return {
    date,
    sleepHours: null,
    recoveryPct: null,
    sleepDebtHours: null,
    strain: null,
    hrvMs: null,
    restingHr: null,
    note: '',
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Alles Eingetragene eines Zeitraums. */
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

/**
 * Schreibt einen einzelnen Messwert.
 *
 * Bleibt danach kein Wert mehr übrig, verschwindet der Datensatz: Ein leerer
 * Eintrag und gar kein Eintrag bedeuten dasselbe, und zwei Zustände für
 * dieselbe Sache führen früher oder später dazu, dass sie auseinanderlaufen.
 */
export async function setMeasurement(
  date: IsoDate,
  key: MeasurementKey,
  value: number | null,
): Promise<void> {
  // In einer Transaktion, weil Lesen und Schreiben zusammengehören: Tippt man
  // zwei Felder schnell hintereinander, liest der zweite Aufruf sonst den Stand
  // von **vor** dem ersten und schreibt dessen Änderung wieder weg. Genau das
  // ist beim Durchprobieren passiert — eine gelöschte Recovery stand danach
  // wieder da.
  await db.transaction('rw', db.readiness, async () => {
    const existing = await db.readiness.get(date);
    const ts = now();
    const next: DayReadiness = {
      ...(existing ?? emptyReadiness(date)),
      [key]: value,
      date,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };

    if (MEASUREMENT_KEYS.every((k) => next[k] === null) && next.note === '') {
      await db.readiness.delete(date);
      return;
    }
    await db.readiness.put(next);
  });
}

/** Entfernt alle Werte eines Tages. */
export async function clearReadiness(date: IsoDate): Promise<void> {
  await db.readiness.delete(date);
}

/**
 * Trägt mehrere Werte auf einmal ein. Für Tests und den Import; die Oberfläche
 * schreibt Feld für Feld, damit jede Eingabe sofort wirkt.
 */
export async function setMeasurements(
  date: IsoDate,
  values: Partial<Record<MeasurementKey, number | null>>,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await setMeasurement(date, key as MeasurementKey, value ?? null);
  }
}
