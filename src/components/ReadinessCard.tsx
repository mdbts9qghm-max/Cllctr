'use client';

/**
 * Die Werte eines Tages — und was daraus folgt.
 *
 * Eingetragen werden nur **Zahlen**. Die Erholungsstufe darunter ist die
 * Schlussfolgerung daraus, nicht noch eine Eingabe: Drei Knöpfe neben den
 * Messwerten wären eine zweite Wahrheit, und bei jedem Widerspruch — 28 % auf
 * der Uhr, "mittel" im Knopf — wüsste niemand, welche gilt.
 *
 * Was der Tag daraufhin hergibt, steht bewusst nicht hier. Der Plan zieht die
 * Schlüsse selbst und passt sich täglich an; die Regel daneben noch einmal
 * auszuformulieren hieße, dem Nutzer eine Rechnung vorzulegen, die er nicht
 * nachrechnen soll. Warum eine Einheit so aussieht, steht an der Einheit.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { addDays, today } from '@/lib/dates';
import { setMeasurement, clearReadiness } from '@/lib/readiness';
import { hasMeasurement, recoveryFor, type RecoveryBasis } from '@/lib/recovery';
import {
  RECOVERY_LABEL,
  SLEEP_DEBT_LABEL,
  type MeasurementKey,
  type Recovery,
  type ResolvedShiftDay,
} from '@/lib/types';

/**
 * Die Eingabefelder, in der Reihenfolge, in der die Zahlen morgens auf dem
 * Bildschirm stehen. Die ersten drei steuern die Schätzung am stärksten, die
 * letzten drei liegen deshalb hinter dem Aufklapper.
 */
const FIELDS: Array<{
  key: MeasurementKey;
  label: string;
  unit: string;
  step: string;
  max: number;
  extra?: boolean;
}> = [
  { key: 'recoveryPct', label: 'Recovery', unit: '%', step: '1', max: 100 },
  { key: 'sleepHours', label: 'Schlaf', unit: 'h', step: '0.25', max: 14 },
  { key: 'sleepDebtHours', label: 'Sleep Debt', unit: 'h', step: '0.25', max: 20 },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', step: '1', max: 300, extra: true },
  { key: 'restingHr', label: 'Ruhepuls', unit: 'bpm', step: '1', max: 120, extra: true },
  { key: 'strain', label: 'Day Strain', unit: '', step: '0.1', max: 21, extra: true },
];

const numberInput =
  'w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-sm text-ink tabular outline-none focus:border-ember';

const RECOVERY_TONE: Record<Recovery, string> = {
  low: 'text-ember',
  mid: 'text-ink',
  high: 'text-ok',
};

/** Wie sicher die Stufe ist — steht als Kleingedrucktes daneben. */
const BASIS_LABEL: Record<RecoveryBasis, string> = {
  measured: 'gemessen',
  derived: 'geschätzt',
  assumed: 'angenommen',
};

export function ReadinessCard({ day }: { day: ResolvedShiftDay }) {
  /**
   * Nicht nur der eine Tag, sondern das Fenster davor: Die Basislinie für HRV
   * und Ruhepuls entsteht aus den letzten drei Wochen. Ohne sie wäre eine HRV
   * von 45 ms eine Zahl ohne Bedeutung.
   */
  const readiness = useLiveQuery(
    () =>
      db.readiness.where('date').between(addDays(day.date, -21), day.date, true, true).toArray(),
    [day.date],
  );

  const [showExtra, setShowExtra] = useState(false);
  const rows = readiness ?? [];
  const row = rows.find((r) => r.date === day.date);
  const estimate = recoveryFor(day.date, rows, today(), day.afterNightShift);

  return (
    <div className="rounded border border-line bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-widest text-ink-faint">Werte</p>
        {hasMeasurement(row) ? (
          <button
            onClick={() => void clearReadiness(day.date)}
            className="text-[11px] text-ink-faint underline decoration-dotted hover:text-ink"
          >
            Werte löschen
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {FIELDS.filter((f) => !f.extra || showExtra).map((f) => (
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
                  day.date,
                  f.key,
                  raw === '' ? null : Math.max(0, Math.min(f.max, Number(raw) || 0)),
                );
              }}
              className={numberInput}
            />
          </label>
        ))}
      </div>

      <button
        onClick={() => setShowExtra((v) => !v)}
        className="mt-2 text-[11px] text-ink-faint underline decoration-dotted hover:text-ink"
      >
        {showExtra ? 'Weniger' : 'HRV, Ruhepuls, Strain'}
      </button>

      {/* Die Schlussfolgerung — keine Eingabe, deshalb auch kein Knopf. */}
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-sm font-medium ${RECOVERY_TONE[estimate.recovery]}`}>
            Erholung {RECOVERY_LABEL[estimate.recovery].toLowerCase()}
          </p>
          <span className="shrink-0 text-[11px] text-ink-faint">
            {BASIS_LABEL[estimate.basis]}
            {estimate.sleepDebt !== 'none'
              ? ` · Schlafschuld ${SLEEP_DEBT_LABEL[estimate.sleepDebt].toLowerCase()}`
              : ''}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{estimate.headline}</p>
        {estimate.reasons.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5">
            {estimate.reasons.map((r, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-ink-faint">
                {r}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
