'use client';

/**
 * Was für einen Tag gilt: Werte eintragen, Regel lesen, Ernährung sehen.
 *
 * Eingetragen werden nur **Zahlen**. Die Erholungsstufe darunter ist die
 * Schlussfolgerung daraus, nicht noch eine Eingabe: Drei Knöpfe neben den
 * Messwerten wären eine zweite Wahrheit, und bei jedem Widerspruch — 28 % auf
 * der Uhr, "mittel" im Knopf — wüsste niemand, welche gilt.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { addDays, today } from '@/lib/dates';
import { explainDay, hardContextFor } from '@/lib/planner';
import { nutritionFor } from '@/lib/nutrition';
import { setMeasurement, clearReadiness } from '@/lib/readiness';
import { hasMeasurement, type RecoveryBasis } from '@/lib/recovery';
import {
  INTENSITY_LABEL,
  INTENSITY_RPE,
  RECOVERY_LABEL,
  SLEEP_DEBT_LABEL,
  type MeasurementKey,
  type Recovery,
  type ResolvedShiftDay,
  type Session,
  type SessionTypeKey,
  type Settings,
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

/** Ein Punkt in der Akzentfarbe für niedrig, gedämpft für alles andere. */
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

export function DayCoach({
  day,
  settings,
  sessions,
  allSessions,
  isDeloadWeek = false,
  showRules = true,
  showNutrition = true,
}: {
  day: ResolvedShiftDay;
  settings: Settings;
  /** Die Einheiten dieses Tages. */
  sessions: Session[];
  /** Alle Einheiten — für "harte Tage in Folge" und "diese Woche". */
  allSessions: Array<{ date: string; type: SessionTypeKey; status: string }>;
  isDeloadWeek?: boolean;
  /**
   * Zeigt, was der Tag hergibt. Auf dem Heute-Screen aus: dort steht die
   * Einheit selbst darunter und begründet sich über `planReason` schon selbst.
   */
  showRules?: boolean;
  /** Zeigt die Ernährungsempfehlung. Auf dem Heute-Screen aus — dafür gibt es einen eigenen Tab. */
  showNutrition?: boolean;
}) {
  /**
   * Nicht nur der eine Tag, sondern das Fenster davor: Die Basislinie für HRV
   * und Ruhepuls entsteht aus den letzten drei Wochen. Ohne sie wäre eine HRV
   * von 45 ms eine Zahl ohne Bedeutung.
   */
  const readiness = useLiveQuery(
    () =>
      db.readiness
        .where('date')
        .between(addDays(day.date, -21), day.date, true, true)
        .toArray(),
    [day.date],
  );

  const [showExtra, setShowExtra] = useState(false);
  const todayIso = today();
  const rows = readiness ?? [];
  const row = rows.find((r) => r.date === day.date);

  const hard = hardContextFor(day.date, allSessions);
  const { ctx, allowance, estimate } = explainDay(
    day,
    rows,
    settings,
    hard,
    isDeloadWeek,
    todayIso,
  );
  const nutrition = nutritionFor(
    ctx,
    allowance,
    sessions.filter((s) => s.status !== 'skipped').map((s) => s.type),
  );

  return (
    <div className="space-y-3">
      {/* --- Werte eintragen -------------------------------------------- */}
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

      {/* --- Was die Regeln sagen --------------------------------------- */}
      {showRules ? (
        <div className="rounded border border-line bg-surface p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-widest text-ink-faint">Was heute geht</p>
            <span className="text-[11px] text-ink-faint">
              {allowance.cap === null
                ? 'Ruhetag'
                : `${INTENSITY_LABEL[allowance.cap]} · ${INTENSITY_RPE[allowance.cap]}`}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-ink">{allowance.reason}</p>
          {allowance.window ? (
            <p className="mt-1 text-xs text-ink-muted">Zeitfenster: {allowance.window}</p>
          ) : null}
          {allowance.limits.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {allowance.limits.map((limit, i) => (
                <li key={i} className="text-xs leading-relaxed text-ember">
                  {limit}
                </li>
              ))}
            </ul>
          ) : null}
          {hard.streak > 0 || hard.last7 > 0 ? (
            <p className="mt-2 text-[11px] text-ink-faint tabular">
              {hard.last7 === 1 ? '1 harter Tag' : `${hard.last7} harte Tage`} in den letzten 7 ·{' '}
              {hard.streak} direkt davor · {hard.thisWeek} diese Woche
            </p>
          ) : null}
        </div>
      ) : null}

      {/* --- Ernährung --------------------------------------------------- */}
      {showNutrition ? (
        <div className="rounded border border-line bg-surface p-3">
          <p className="mb-2 text-xs uppercase tracking-widest text-ink-faint">Ernährung</p>
          <p className="text-sm leading-relaxed text-ink">{nutrition.headline}</p>

          <ul className="mt-2 space-y-1">
            {nutrition.macros.map((line, i) => (
              <li key={i} className="text-xs leading-relaxed text-ink-muted">
                {line}
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-1">
            {nutrition.timing.map((t, i) => (
              <p key={i} className="text-xs leading-relaxed text-ink">
                <span className="text-ink-muted">{t.when}:</span> {t.what}
              </p>
            ))}
          </div>

          {nutrition.notes.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-line pt-2">
              {nutrition.notes.map((note, i) => (
                <li key={i} className="text-xs leading-relaxed text-ink-faint">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
