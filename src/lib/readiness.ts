/**
 * Der Tageseintrag: Messwerte und die beiden Haken.
 *
 * Hier stehen nur Zahlen und Zeitstempel. Was sie bedeuten — hohe, mittlere oder niedrige
 * Erholung —, rechnet `recovery.ts` aus. Die Trennung ist der Punkt: Eine
 * eingetragene Stufe neben den Zahlen wäre eine zweite Wahrheit, und bei jedem
 * Widerspruch wüsste niemand, welche gilt.
 *
 * Es gibt keine Schnittstelle zu WHOOP: Cllctr hat keinen Server und keine
 * API-Schlüssel, das ist der Kern des Projekts. Übertragen werden deshalb die
 * Zahlen, die morgens ohnehin auf dem Bildschirm stehen.
 */

import { db } from './db';
import { addDays } from './dates';
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
    checkedInAt: null,
    checkedOutAt: null,
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
      // Der leere Tag zuerst: Einträge aus einer älteren Version kennen die
      // Haken noch nicht, und undefined weiterzureichen hieße, sie später
      // überall abfangen zu müssen.
      ...emptyReadiness(date),
      ...existing,
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

/** Entfernt alle Werte eines Tages, samt beider Haken. */
export async function clearReadiness(date: IsoDate): Promise<void> {
  await db.readiness.delete(date);
}

/* ------------------------------------------------------------------ */
/* Check-in und Check-out                                              */
/* ------------------------------------------------------------------ */

/**
 * Setzt oder löst den Haken eines der beiden Tagespunkte.
 *
 * Der Haken ist bewusst getrennt von den Werten: Ein Morgen ohne Uhr am
 * Handgelenk ist trotzdem ein erledigter Check-in. Hinge er an "es steht eine
 * Zahl drin", stünde er an solchen Tagen für immer offen — und offene Punkte,
 * die man nicht schließen kann, hört man nach einer Woche auf zu lesen.
 */
export async function setCheck(
  date: IsoDate,
  which: 'in' | 'out',
  done: boolean,
): Promise<void> {
  await db.transaction('rw', db.readiness, async () => {
    const existing = await db.readiness.get(date);
    const ts = now();
    const next: DayReadiness = {
      ...emptyReadiness(date),
      ...existing,
      [which === 'in' ? 'checkedInAt' : 'checkedOutAt']: done ? ts : null,
      date,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };

    // Ein Eintrag ohne Werte und ohne Haken ist kein Eintrag.
    if (
      MEASUREMENT_KEYS.every((k) => next[k] === null) &&
      next.checkedInAt === null &&
      next.checkedOutAt === null &&
      next.note === ''
    ) {
      await db.readiness.delete(date);
      return;
    }
    await db.readiness.put(next);
  });
}

/** Schreibt die Notiz aus dem Check-out. */
export async function setDayNote(date: IsoDate, note: string): Promise<void> {
  await db.transaction('rw', db.readiness, async () => {
    const existing = await db.readiness.get(date);
    const ts = now();
    await db.readiness.put({
      ...emptyReadiness(date),
      ...existing,
      note,
      date,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
  });
}

/**
 * Ab wann der Check-out ansteht.
 *
 * Vorher wäre er verfrüht — der Tag ist noch nicht gelaufen, der Strain steht
 * noch nicht fest. Bewusst früh genug für eine Nachtschicht, die um 19:00
 * beginnt: Wer danach eincheckt, kommt bis zum nächsten Morgen nicht mehr dazu.
 */
export const CHECKOUT_FROM_HOUR = 17;

export type CheckState = 'open' | 'done' | 'early';

export interface DayChecks {
  checkIn: CheckState;
  checkOut: CheckState;
}

/** Was an diesem Tag noch offen ist. `hour` ist die aktuelle Stunde 0–23. */
export function dayChecks(row: DayReadiness | undefined, hour: number): DayChecks {
  return {
    checkIn: row?.checkedInAt ? 'done' : 'open',
    checkOut: row?.checkedOutAt
      ? 'done'
      : hour >= CHECKOUT_FROM_HOUR
        ? 'open'
        : 'early',
  };
}

/** Tage in Folge mit erledigtem Check-in, bis zu einem Stichtag zurück. */
export function checkInStreak(rows: DayReadiness[], todayIso: IsoDate): number {
  const done = new Set(rows.filter((r) => r.checkedInAt).map((r) => r.date));
  // Heute darf noch fehlen: Wer erst mittags eincheckt, hätte sonst vormittags
  // eine gerissene Serie, obwohl nichts passiert ist.
  let cursor = done.has(todayIso) ? todayIso : addDays(todayIso, -1);
  let length = 0;
  while (done.has(cursor)) {
    length++;
    cursor = addDays(cursor, -1);
  }
  return length;
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
