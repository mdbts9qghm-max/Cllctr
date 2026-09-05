/**
 * Kalenderarithmetik auf lokalen Tagen.
 *
 * Alle Funktionen rechnen mit `IsoDate`-Zeichenketten und der lokalen Zeitzone.
 * Ein Trainingstag ist ein Kalendertag — wer ihn als UTC-Zeitstempel behandelt,
 * verschiebt ihn irgendwann über Mitternacht und wundert sich, warum der Long
 * Run im Kalender einen Tag zu früh steht.
 */

import type { IsoDate } from './types';

export function today(): IsoDate {
  return toIsoDate(new Date());
}

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mittag statt Mitternacht: So kippt kein Tag durch die Sommerzeit. */
export function fromIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Ganze Tage von a nach b. Positiv, wenn b später liegt. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const ms = fromIsoDate(b).getTime() - fromIsoDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Montag der Woche, in der dieses Datum liegt. */
export function startOfWeek(iso: IsoDate): IsoDate {
  const d = fromIsoDate(iso);
  // getDay(): 0 = Sonntag. Der Sonntag gehört zur Woche davor.
  const offset = (d.getDay() + 6) % 7;
  return addDays(iso, -offset);
}

export function endOfWeek(iso: IsoDate): IsoDate {
  return addDays(startOfWeek(iso), 6);
}

export function dateRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let cursor = start;
  // Obergrenze gegen Endlosschleifen bei vertauschten Grenzen.
  for (let i = 0; cursor <= end && i < 4000; i++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Die letzten n Tage einschließlich heute, aufsteigend. */
export function lastDays(n: number, reference: IsoDate = today()): IsoDate[] {
  return dateRange(addDays(reference, -(n - 1)), reference);
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export function weekdayShort(iso: IsoDate): string {
  return WEEKDAYS[fromIsoDate(iso).getDay()];
}

export function weekdayLong(iso: IsoDate): string {
  return WEEKDAYS_LONG[fromIsoDate(iso).getDay()];
}

/** "7. Sep" */
export function formatShort(iso: IsoDate): string {
  const d = fromIsoDate(iso);
  return `${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/** "Montag, 7. September" */
export function formatLong(iso: IsoDate): string {
  const d = fromIsoDate(iso);
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

/**
 * ISO-Kalenderwoche.
 *
 * Nach ISO 8601: Die Woche gehört zu dem Jahr, in dem ihr Donnerstag liegt.
 * Die naive Rechnung „Tage seit dem 1. Januar durch 7" liegt am Jahreswechsel
 * regelmäßig daneben.
 */
export function isoWeek(iso: IsoDate): number {
  const d = fromIsoDate(iso);
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(
    firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7),
  );
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export function monthKey(iso: IsoDate): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
}

export function firstOfMonth(key: string): IsoDate {
  return `${key}-01`;
}

export function lastOfMonth(key: string): IsoDate {
  const [y, m] = key.split('-').map(Number);
  return toIsoDate(new Date(y, m, 0));
}

/** Volle Wochen, die den Monat abdecken — für ein Montag-bis-Sonntag-Raster. */
export function monthGridDays(key: string): IsoDate[] {
  return dateRange(startOfWeek(firstOfMonth(key)), endOfWeek(lastOfMonth(key)));
}

/** Minuten als "1:24 h" oder "45 min". */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}:${`${m % 60}`.padStart(2, '0')} h`;
}

/** Sekunden als "25:14" oder "1:05:22". */
export function formatClock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const mm = `${m}`.padStart(h > 0 ? 2 : 1, '0');
  return h > 0
    ? `${h}:${mm}:${`${rest}`.padStart(2, '0')}`
    : `${mm}:${`${rest}`.padStart(2, '0')}`;
}

/** Sekunden pro Kilometer als "6:20 /km". */
export function formatPace(secPerKm: number): string {
  return `${formatClock(secPerKm)} /km`;
}

/** Deutsche Dezimalschreibweise, ohne unnötige Nachkommastellen. */
export function num(value: number, digits = 1): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return rounded.toString().replace('.', ',');
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
