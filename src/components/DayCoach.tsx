'use client';

/**
 * Was für einen Tag gilt: Erholung eintragen, Regel lesen, Ernährung sehen.
 *
 * Die drei gehören zusammen und stehen deshalb in einer Karte. Die Erholung ist
 * die Eingabe, die Regel ist die Folgerung daraus, die Ernährung die zweite
 * Folgerung — sie in drei Ecken der App zu verteilen hieße, den Zusammenhang zu
 * verstecken, auf den es ankommt.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { today } from '@/lib/dates';
import { explainDay, hardContextFor } from '@/lib/planner';
import { nutritionFor } from '@/lib/nutrition';
import { setReadiness, clearReadiness } from '@/lib/readiness';
import {
  INTENSITY_LABEL,
  INTENSITY_RPE,
  RECOVERY_LABEL,
  SLEEP_DEBT_LABEL,
  type Recovery,
  type ResolvedShiftDay,
  type Session,
  type SessionTypeKey,
  type Settings,
  type SleepDebt,
} from '@/lib/types';

const RECOVERIES: Recovery[] = ['low', 'mid', 'high'];
const DEBTS: SleepDebt[] = ['none', 'some', 'high'];

export function DayCoach({
  day,
  settings,
  sessions,
  allSessions,
  isDeloadWeek = false,
}: {
  day: ResolvedShiftDay;
  settings: Settings;
  /** Die Einheiten dieses Tages. */
  sessions: Session[];
  /** Alle Einheiten — für "harte Tage in Folge" und "diese Woche". */
  allSessions: Array<{ date: string; type: SessionTypeKey; status: string }>;
  isDeloadWeek?: boolean;
}) {
  // useLiveQuery liefert undefined sowohl beim Laden als auch, wenn es für den
  // Tag keinen Eintrag gibt. Beides führt zum selben Ergebnis — dem Normalfall
  // "mittel" —, deshalb wird hier nicht auf das Laden gewartet.
  const readiness = useLiveQuery(() => db.readiness.get(day.date), [day.date]);

  const todayIso = today();
  const hard = hardContextFor(day.date, allSessions);
  const { ctx, allowance } = explainDay(
    day,
    readiness ?? undefined,
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
  const entered = readiness !== undefined && readiness !== null;

  return (
    <div className="space-y-3">
      {/* --- Erholung eintragen ----------------------------------------- */}
      <div className="rounded border border-line bg-surface p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-xs uppercase tracking-widest text-ink-faint">Erholung</p>
          {entered ? (
            <button
              onClick={() => void clearReadiness(day.date)}
              className="text-[11px] text-ink-faint underline decoration-dotted hover:text-ink"
            >
              Eintrag löschen
            </button>
          ) : (
            <span className="text-[11px] text-ink-faint">
              {day.date > todayIso
                ? 'nicht eingetragen — geplant, als wärst du erholt'
                : 'nicht eingetragen — gilt als mittel'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {RECOVERIES.map((r) => (
            <button
              key={r}
              onClick={() => void setReadiness(day.date, { recovery: r })}
              aria-pressed={entered && readiness?.recovery === r}
              className={`rounded border px-2.5 py-1 text-sm ${
                entered && readiness?.recovery === r
                  ? 'border-ember text-ember'
                  : 'border-line-strong text-ink hover:border-ember'
              }`}
            >
              {RECOVERY_LABEL[r]}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-widest text-ink-faint">
              Schlaf (h)
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min={0}
              max={14}
              value={readiness?.sleepHours ?? ''}
              placeholder="–"
              onChange={(e) => {
                const raw = e.target.value.trim();
                void setReadiness(day.date, {
                  sleepHours: raw === '' ? null : Math.max(0, Math.min(14, Number(raw) || 0)),
                });
              }}
              className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-sm text-ink tabular outline-none focus:border-ember"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-widest text-ink-faint">
              Schlafschuld
            </span>
            <select
              value={readiness?.sleepDebt ?? 'none'}
              onChange={(e) => void setReadiness(day.date, { sleepDebt: e.target.value as SleepDebt })}
              className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-ember"
            >
              {DEBTS.map((d) => (
                <option key={d} value={d}>
                  {SLEEP_DEBT_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* --- Was die Regeln sagen --------------------------------------- */}
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

      {/* --- Ernährung --------------------------------------------------- */}
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
    </div>
  );
}
