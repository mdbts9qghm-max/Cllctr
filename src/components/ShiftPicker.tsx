'use client';

import { useState } from 'react';
import { db } from '@/lib/db';
import { dateRange, daysBetween, formatShort, today } from '@/lib/dates';
import { now } from '@/lib/ids';
import { cancelSessionsInRange } from '@/lib/plan-store';
import type { IsoDate, ResolvedShiftDay, ShiftType } from '@/lib/types';
import { Button, Field, inputClass } from './ui';

/**
 * Einen einzelnen Tag abweichend von der Rotation setzen.
 *
 * Steht an zwei Stellen: im Schicht-Screen für die Vorschau der nächsten
 * Wochen und direkt im Plan. Der Plan ist der Ort, an dem ein Tausch auffällt
 * ("da kann ich nicht") — dort ihn auch ändern zu können, spart den Umweg über
 * einen zweiten Screen.
 */
export async function setShiftOverride(
  date: IsoDate,
  shiftTypeId: string | null,
): Promise<void> {
  if (shiftTypeId === null) {
    await db.shiftOverrides.delete(date);
  } else {
    await db.shiftOverrides.put({ date, shiftTypeId, note: '', createdAt: now() });
  }
}

export function ShiftPicker({
  day,
  shiftTypes,
  onDone,
  label = 'Abweichend setzen',
}: {
  day: ResolvedShiftDay;
  shiftTypes: ShiftType[];
  onDone?: () => void;
  label?: string;
}) {
  async function set(shiftTypeId: string | null) {
    await setShiftOverride(day.date, shiftTypeId);
    onDone?.();
  }

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-widest text-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-2">
        {shiftTypes.map((t) => {
          const current = t.id === day.shiftType.id;
          return (
            <button
              key={t.id}
              onClick={() => void set(t.id)}
              aria-pressed={current}
              className={`rounded border px-2.5 py-1 text-sm ${
                current
                  ? 'border-ember text-ember'
                  : 'border-line-strong text-ink hover:border-ember'
              }`}
            >
              {t.name}
            </button>
          );
        })}
        {day.isOverride ? (
          <button
            onClick={() => void set(null)}
            className="rounded border border-danger/50 px-2.5 py-1 text-sm text-danger"
          >
            Zurück zur Rotation
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Länger als ein halbes Jahr am Stück ist kein Urlaub mehr, sondern ein Tippfehler. */
const MAX_RANGE_DAYS = 183;

/**
 * Mehrere Tage auf einmal abweichend setzen.
 *
 * Urlaub, Lehrgang, längere Krankheit: das sind zusammenhängende Blöcke. Sie
 * Tag für Tag anzutippen ist bei zwei Wochen zwanzig Griffe — und genau dann
 * lässt man es und der Plan rechnet gegen Schichten, die es nicht gibt.
 */
export function ShiftRange({ shiftTypes }: { shiftTypes: ShiftType[] }) {
  const [from, setFrom] = useState<IsoDate>(today());
  const [to, setTo] = useState<IsoDate>(today());
  const [typeId, setTypeId] = useState<string>(
    shiftTypes.find((t) => t.capacity === 'full')?.id ?? shiftTypes[0]?.id ?? '',
  );
  const [message, setMessage] = useState<string | null>(null);

  const span = daysBetween(from, to) + 1;
  const valid = span >= 1 && span <= MAX_RANGE_DAYS;

  async function apply(clear: boolean) {
    if (!valid) return;
    const dates = dateRange(from, to);
    if (clear) {
      await db.shiftOverrides.bulkDelete(dates);
      setMessage(`${dates.length} ${dates.length === 1 ? 'Tag' : 'Tage'} zurück auf die Rotation.`);
      return;
    }
    const type = shiftTypes.find((t) => t.id === typeId);
    if (!type) return;
    const ts = now();
    await db.shiftOverrides.bulkPut(
      dates.map((date) => ({ date, shiftTypeId: typeId, note: '', createdAt: ts })),
    );

    const parts = [
      `${dates.length} ${dates.length === 1 ? 'Tag' : 'Tage'} auf ${type.name} gesetzt: ` +
        `${formatShort(from)} – ${formatShort(to)}.`,
    ];

    // Bei einer Abwesenheit gleich mit aufräumen: die Einheiten stehen sonst
    // als Konflikte im Plan und man müsste jede einzeln wegklicken.
    if (type.cancelsPlanned) {
      const struck = await cancelSessionsInRange(
        from,
        to,
        `${type.name} — die Einheit entfällt ersatzlos.`,
      );
      parts.push(
        struck === 0
          ? 'Im Zeitraum stand nichts Geplantes.'
          : `${struck} geplante ${struck === 1 ? 'Einheit' : 'Einheiten'} gestrichen — sie zählen nicht als verpasst.`,
      );
    }

    setMessage(parts.join(' '));
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Von">
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              // Ein Ende vor dem Anfang ergibt keinen Zeitraum — mitziehen
              // statt eine Fehlermeldung zu zeigen.
              if (e.target.value > to) setTo(e.target.value);
              setMessage(null);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Bis">
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setMessage(null);
            }}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mb-3">
        <Field label="Schichtart">
          <select
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              setMessage(null);
            }}
            className={inputClass}
          >
            {shiftTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void apply(false)} disabled={!valid}>
          {valid ? `${span} ${span === 1 ? 'Tag' : 'Tage'} setzen` : 'Zeitraum prüfen'}
        </Button>
        <Button onClick={() => void apply(true)} disabled={!valid}>
          Abweichungen entfernen
        </Button>
      </div>

      {message ? <p className="mt-3 text-xs leading-relaxed text-ok">{message}</p> : null}
      {!valid ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          Der Zeitraum muss mit dem früheren Datum beginnen und darf höchstens {MAX_RANGE_DAYS}{' '}
          Tage umfassen.
        </p>
      ) : null}
    </div>
  );
}
