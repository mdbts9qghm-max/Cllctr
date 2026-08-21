/**
 * Datums-Hilfen. Bewusst ohne Bibliothek: wir rechnen ausschließlich mit
 * lokalen Kalendertagen als "YYYY-MM-DD"-Strings, nie mit UTC-Zeitstempeln.
 * Das vermeidet die klassischen Zeitzonen-Verschiebungen um einen Tag.
 */

import type { IsoDate } from './types';

const MS_PER_DAY = 86_400_000;

/** Heute als "YYYY-MM-DD" in der lokalen Zeitzone. */
export function today(): IsoDate {
  return toIsoDate(new Date());
}

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parst "YYYY-MM-DD" zu einem lokalen Date auf Mitternacht. */
export function fromIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = fromIsoDate(value);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === value;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Ganze Kalendertage zwischen zwei Daten (b - a). Kann negativ sein. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const da = fromIsoDate(a);
  const db = fromIsoDate(b);
  // Auf Mittag normalisieren, damit Sommerzeit-Wechsel nicht zu 0.96 Tagen führen.
  da.setHours(12, 0, 0, 0);
  db.setHours(12, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / MS_PER_DAY);
}

/** Montag der Woche, in der iso liegt. */
export function startOfWeek(iso: IsoDate): IsoDate {
  const d = fromIsoDate(iso);
  const dow = d.getDay(); // 0 = Sonntag
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, diff);
}

export function endOfWeek(iso: IsoDate): IsoDate {
  return addDays(startOfWeek(iso), 6);
}

/** Alle Tage von start bis end (beide inklusive). */
export function dateRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const total = daysBetween(start, end);
  for (let i = 0; i <= total; i++) out.push(addDays(start, i));
  return out;
}

const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

export function weekdayShort(iso: IsoDate): string {
  return WEEKDAYS_SHORT[fromIsoDate(iso).getDay()];
}

/** "Do, 21. Aug" */
export function formatShort(iso: IsoDate): string {
  const d = fromIsoDate(iso);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

/** Positiver Modulo — anders als % in JS auch bei negativen Zahlen korrekt. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
