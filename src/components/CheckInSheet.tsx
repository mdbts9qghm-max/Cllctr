'use client';

/**
 * Der Check-in des Morgens.
 *
 * Alles, was die App zum Planen braucht, in einem Formular: Schlaf, Befinden,
 * optional die Zahlen von der Uhr. Nichts ist Pflicht — was fehlt, wird
 * geschätzt statt erfunden.
 */

import { useState } from 'react';
import { estimateRecovery, type RecoveryEstimate } from '@/lib/recovery';
import { completeCheckIn, updateCheckIn } from '@/lib/store';
import { RECOVERY_HINT, RECOVERY_LABEL, type DailyCheckIn, type IsoDate } from '@/lib/types';
import { Button, Dot, Field, Sheet, inputClass, type Tone } from './ui';

const SCALES: Array<{
  key: 'sleepQuality' | 'soreness' | 'stress' | 'motivation';
  label: string;
  low: string;
  high: string;
}> = [
  { key: 'sleepQuality', label: 'Schlafqualität', low: 'schlecht', high: 'top' },
  { key: 'soreness', label: 'Muskelkater', low: 'keiner', high: 'stark' },
  { key: 'stress', label: 'Stress', low: 'entspannt', high: 'hoch' },
  { key: 'motivation', label: 'Energie', low: 'leer', high: 'voll' },
];

const NUMBERS: Array<{
  key: 'sleepHours' | 'whoopRecovery' | 'restingHr' | 'hrvMs';
  label: string;
  unit: string;
  step: string;
  max: number;
}> = [
  { key: 'sleepHours', label: 'Schlaf', unit: 'h', step: '0.25', max: 14 },
  { key: 'whoopRecovery', label: 'Recovery', unit: '%', step: '1', max: 100 },
  { key: 'restingHr', label: 'Ruhepuls', unit: 'bpm', step: '1', max: 120 },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', step: '1', max: 300 },
];

export const RECOVERY_TONE: Record<string, Tone> = {
  ready: 'good',
  moderate: 'ok',
  low: 'warn',
};

export function CheckInSheet({
  date,
  entry,
  estimate,
  onClose,
}: {
  date: IsoDate;
  entry: DailyCheckIn | undefined;
  estimate: RecoveryEstimate;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const setNumber = (key: string, raw: string, max: number) => {
    const trimmed = raw.trim();
    void updateCheckIn(date, {
      [key]: trimmed === '' ? null : Math.max(0, Math.min(max, Number(trimmed) || 0)),
    });
  };

  return (
    <Sheet title="Check-in" onClose={onClose}>
      <p className="mb-4 text-sm leading-relaxed text-ink-muted">
        Was die App zum Planen braucht. Nichts davon ist Pflicht — was fehlt, schätzt sie aus
        dem, was da ist.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3">
        {NUMBERS.map((f) => (
          <Field key={f.key} label={`${f.label} (${f.unit})`}>
            <input
              type="number"
              inputMode="decimal"
              step={f.step}
              min={0}
              max={f.max}
              placeholder="–"
              defaultValue={entry?.[f.key] ?? ''}
              onChange={(e) => setNumber(f.key, e.target.value, f.max)}
              className={`${inputClass} tabular`}
            />
          </Field>
        ))}
      </div>

      <div className="mb-5 space-y-3">
        {SCALES.map((s) => {
          const value = entry?.[s.key] ?? null;
          return (
            <div key={s.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                  {s.label}
                </span>
                <span className="text-[11px] text-ink-faint">
                  {s.low} → {s.high}
                </span>
              </div>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => void updateCheckIn(date, { [s.key]: value === n ? null : n })}
                    aria-pressed={value === n}
                    className={`flex-1 rounded-lg border py-2 text-sm tabular transition-colors ${
                      value === n
                        ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]'
                        : 'border-line-strong text-ink-muted'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-5 rounded-lg border border-line bg-surface-2 p-3">
        <div className="flex items-center gap-2">
          <Dot tone={RECOVERY_TONE[estimate.status]} />
          <span className="text-sm font-semibold text-ink">
            {RECOVERY_LABEL[estimate.status]}
          </span>
          <span className="text-xs text-ink-faint">{RECOVERY_HINT[estimate.status]}</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{estimate.headline}</p>
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

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void completeCheckIn(date, true).then(onClose);
          }}
        >
          Check-in abschließen
        </Button>
        {entry?.completedAt ? (
          <Button onClick={() => void completeCheckIn(date, false)}>Zurücknehmen</Button>
        ) : null}
      </div>
    </Sheet>
  );
}
