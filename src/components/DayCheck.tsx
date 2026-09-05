'use client';

/**
 * Check-in und Check-out — der Rahmen des Tages.
 *
 * Vorher lagen die Eingaben verstreut: Werte in einer Karte, die Schicht auf
 * einem anderen Screen, das Protokoll an der Einheit, der Strain irgendwo
 * dazwischen. Das ergab keine Reihenfolge, und was keine Reihenfolge hat, macht
 * man unregelmäßig.
 *
 * Jetzt gibt es zwei feste Punkte:
 *
 *   **Morgens** wird alles eingetragen, was die App zum Planen braucht — die
 *   Werte und die Schicht. Danach steht der Tag.
 *
 *   **Abends** wird eingetragen, was aus dem Tag geworden ist — Strain und
 *   eine Notiz. Das fließt nicht in die Planung des Tages ein, der ist ja
 *   vorbei; es ist Verlauf.
 *
 * Beide sind abhakbar, ohne dass ein Feld gefüllt sein muss: Ein Morgen ohne
 * Uhr am Handgelenk ist trotzdem ein erledigter Check-in.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { addDays, today } from '@/lib/dates';
import {
  CHECKOUT_FROM_HOUR,
  dayChecks,
  setCheck,
  setDayNote,
  setMeasurement,
  type CheckState,
} from '@/lib/readiness';
import { recoveryFor } from '@/lib/recovery';
import { setShiftOverride } from '@/components/ShiftPicker';
import {
  RECOVERY_LABEL,
  SLEEP_DEBT_LABEL,
  type DayReadiness,
  type MeasurementKey,
  type Recovery,
  type ResolvedShiftDay,
  type ShiftType,
} from '@/lib/types';

/** Die Felder des Check-ins — was der Plan braucht. */
const MORNING: Array<{ key: MeasurementKey; label: string; unit: string; step: string; max: number; extra?: boolean }> = [
  { key: 'recoveryPct', label: 'Recovery', unit: '%', step: '1', max: 100 },
  { key: 'sleepHours', label: 'Schlaf', unit: 'h', step: '0.25', max: 14 },
  { key: 'sleepDebtHours', label: 'Sleep Debt', unit: 'h', step: '0.25', max: 20 },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', step: '1', max: 300, extra: true },
  { key: 'restingHr', label: 'Ruhepuls', unit: 'bpm', step: '1', max: 120, extra: true },
];

/** Die Felder des Check-outs — was aus dem Tag geworden ist. */
const EVENING: Array<{ key: MeasurementKey; label: string; unit: string; step: string; max: number }> = [
  { key: 'strain', label: 'Day Strain', unit: '', step: '0.1', max: 21 },
];

const numberInput =
  'w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-sm text-ink tabular outline-none focus:border-ember';

const RECOVERY_TONE: Record<Recovery, string> = {
  low: 'text-ember',
  mid: 'text-ink',
  high: 'text-ok',
};

export function DayCheck({
  day,
  shiftTypes,
  openSessions = 0,
}: {
  day: ResolvedShiftDay;
  /** Für den Schichtwechsel im Check-in. */
  shiftTypes: ShiftType[];
  /**
   * Wie viele Einheiten heute noch nicht abgehakt sind. Der Check-out hakt sie
   * nicht selbst ab — das gehört an die Einheit, mit Protokoll —, aber er soll
   * auch nicht so tun, als wäre der Tag fertig, wenn er es nicht ist.
   */
  openSessions?: number;
}) {
  const rows = useLiveQuery(
    () =>
      db.readiness.where('date').between(addDays(day.date, -21), day.date, true, true).toArray(),
    [day.date],
  );

  const list = rows ?? [];
  const row = list.find((r) => r.date === day.date);
  const checks = dayChecks(row, new Date().getHours());

  // Offen wird aufgeklappt, erledigt bleibt zu. Wer nachbessern will, tippt drauf.
  const [open, setOpen] = useState<'in' | 'out' | null>(null);
  const active = open ?? (checks.checkIn === 'open' ? 'in' : checks.checkOut === 'open' ? 'out' : null);

  const estimate = recoveryFor(day.date, list, today(), day.afterNightShift);

  return (
    <div className="rounded-lg border border-line-strong bg-surface-2 p-3">
      <div className="flex gap-2">
        <CheckTab
          label="Check-in"
          hint="morgens"
          state={checks.checkIn}
          active={active === 'in'}
          onClick={() => setOpen(active === 'in' ? null : 'in')}
        />
        <CheckTab
          label="Check-out"
          hint={checks.checkOut === 'early' ? `ab ${CHECKOUT_FROM_HOUR}:00` : 'abends'}
          state={checks.checkOut}
          active={active === 'out'}
          onClick={() => setOpen(active === 'out' ? null : 'out')}
        />
      </div>

      {active === 'in' ? (
        <div className="mt-3 space-y-3">
          <Fields
            date={day.date}
            fields={MORNING}
            row={row}
            note="Was auf der Uhr steht. Leer lassen geht — dann schätzt die App aus dem, was da ist."
          />

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-ink-faint">
              Schicht heute
            </p>
            <div className="flex flex-wrap gap-1.5">
              {shiftTypes.map((t) => {
                const current = t.id === day.shiftType.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => void setShiftOverride(day.date, t.id)}
                    aria-pressed={current}
                    className={`rounded border px-2 py-1 text-xs ${
                      current ? 'border-ember text-ember' : 'border-line-strong text-ink'
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>

          <Verdict estimate={estimate} />

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void setCheck(day.date, 'in', checks.checkIn !== 'done');
                setOpen(null);
              }}
              className={`rounded border px-3 py-1.5 text-sm ${
                checks.checkIn === 'done'
                  ? 'border-line-strong text-ink-muted'
                  : 'border-ember bg-ember/10 text-ember'
              }`}
            >
              {checks.checkIn === 'done' ? 'Check-in zurücknehmen' : 'Check-in abschließen'}
            </button>
          </div>
        </div>
      ) : null}

      {active === 'out' ? (
        <div className="mt-3 space-y-3">
          <Fields
            date={day.date}
            fields={EVENING}
            row={row}
            note="Was der Tag gekostet hat. Geht nicht mehr in die Planung von heute ein — heute ist gelaufen."
          />

          {openSessions > 0 ? (
            <p className="rounded border border-ember-dim bg-ember/10 p-2 text-xs leading-relaxed text-ink">
              {openSessions === 1 ? 'Eine Einheit steht' : `${openSessions} Einheiten stehen`} noch
              offen. Hak sie unten ab, bevor du auscheckst — was hier offen bleibt, zählt morgen
              als nicht durchgezogen.
            </p>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-widest text-ink-faint">
              Notiz zum Tag
            </span>
            <textarea
              rows={2}
              value={row?.note ?? ''}
              placeholder="Wie war's?"
              onChange={(e) => void setDayNote(day.date, e.target.value)}
              className="w-full resize-none rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-ember"
            />
          </label>

          <button
            onClick={() => {
              void setCheck(day.date, 'out', checks.checkOut !== 'done');
              setOpen(null);
            }}
            className={`rounded border px-3 py-1.5 text-sm ${
              checks.checkOut === 'done'
                ? 'border-line-strong text-ink-muted'
                : 'border-ember bg-ember/10 text-ember'
            }`}
          >
            {checks.checkOut === 'done' ? 'Check-out zurücknehmen' : 'Check-out abschließen'}
          </button>
        </div>
      ) : null}

      {/* Zugeklappt bleibt die Schlussfolgerung sichtbar — sie ist der Grund,
          warum der Tag so geplant ist. */}
      {active === null ? (
        <div className="mt-3 border-t border-line pt-3">
          <Verdict estimate={estimate} compact />
        </div>
      ) : null}
    </div>
  );
}

function CheckTab({
  label,
  hint,
  state,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  state: CheckState;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-ember bg-ember/5'
          : state === 'done'
            ? 'border-line text-ink-muted'
            : state === 'open'
              ? 'border-ember-dim'
              : 'border-line text-ink-faint'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${
            state === 'done' ? 'bg-ok' : state === 'open' ? 'bg-ember' : 'bg-line-strong'
          }`}
        />
        <span className="text-sm text-ink">{label}</span>
      </span>
      <span className="mt-0.5 block text-[11px] text-ink-faint">
        {state === 'done' ? 'erledigt' : state === 'early' ? hint : `offen · ${hint}`}
      </span>
    </button>
  );
}

function Fields({
  date,
  fields,
  row,
  note,
}: {
  date: string;
  fields: typeof MORNING;
  row: DayReadiness | undefined;
  note: string;
}) {
  const [showExtra, setShowExtra] = useState(false);
  const shown = fields.filter((f) => !f.extra || showExtra);

  return (
    <div>
      <div className={`grid gap-2 ${fields.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
        {shown.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block truncate text-[11px] uppercase tracking-widest text-ink-faint">
              {f.label}
              {f.unit ? ` (${f.unit})` : ''}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step={f.step}
              min={0}
              max={f.max}
              placeholder="–"
              value={row?.[f.key] ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                void setMeasurement(
                  date,
                  f.key,
                  raw === '' ? null : Math.max(0, Math.min(f.max, Number(raw) || 0)),
                );
              }}
              className={numberInput}
            />
          </label>
        ))}
      </div>
      {fields.some((f) => f.extra) ? (
        <button
          onClick={() => setShowExtra((v) => !v)}
          className="mt-2 text-[11px] text-ink-faint underline decoration-dotted hover:text-ink"
        >
          {showExtra ? 'Weniger' : 'HRV und Ruhepuls'}
        </button>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{note}</p>
    </div>
  );
}

function Verdict({
  estimate,
  compact = false,
}: {
  estimate: ReturnType<typeof recoveryFor>;
  compact?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`text-sm font-medium ${RECOVERY_TONE[estimate.recovery]}`}>
          Erholung {RECOVERY_LABEL[estimate.recovery].toLowerCase()}
        </p>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {estimate.basis === 'measured'
            ? 'gemessen'
            : estimate.basis === 'derived'
              ? 'geschätzt'
              : 'angenommen'}
          {estimate.sleepDebt !== 'none'
            ? ` · Schlafschuld ${SLEEP_DEBT_LABEL[estimate.sleepDebt].toLowerCase()}`
            : ''}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{estimate.headline}</p>
      {!compact && estimate.reasons.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {estimate.reasons.map((r, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-ink-faint">
              {r}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
