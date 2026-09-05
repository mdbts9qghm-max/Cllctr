'use client';

/**
 * Schichten: der Dienstplan und die Regeln dahinter.
 *
 * Zwei Dinge auf einer Seite, weil sie zusammengehören: Wann welche Schicht
 * liegt — und was jede Schichtart erlaubt. Die Regeln sind Daten, keine
 * Programmzeilen; wer sie ändert, ändert damit sofort jede Empfehlung.
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  addDays,
  firstOfMonth,
  lastOfMonth,
  monthGridDays,
  monthKey,
  monthLabel,
  shiftMonth,
  today,
} from '@/lib/dates';
import { useShiftContext } from '@/lib/hooks';
import { resolveRange } from '@/lib/shifts';
import { saveShiftType, setShift, setShiftRange } from '@/lib/store';
import {
  CAPABILITY_LABEL,
  INTENSITY_LABEL,
  RECOVERY_LABEL,
  SPORT_LABEL,
  type Intensity,
  type Recovery,
  type ShiftType,
  type Sport,
} from '@/lib/types';
import {
  Button,
  Card,
  Chip,
  Field,
  Loading,
  Section,
  Sheet,
  inputClass,
} from '@/components/ui';

const RECOVERIES: Recovery[] = ['ready', 'moderate', 'low'];
const INTENSITIES: Array<Intensity | 'none'> = ['none', 'easy', 'moderate', 'hard'];

export default function SchichtenPage() {
  const todayIso = today();
  const ctx = useShiftContext();
  const [month, setMonth] = useState(() => monthKey(todayIso));
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShiftType | null>(null);
  const [rangeFrom, setRangeFrom] = useState(todayIso);
  const [rangeTo, setRangeTo] = useState(addDays(todayIso, 6));
  const [rangeType, setRangeType] = useState('free');
  const [message, setMessage] = useState<string | null>(null);

  if (!ctx) return <Loading />;

  const days = resolveRange(
    monthGridDays(month)[0],
    monthGridDays(month)[monthGridDays(month).length - 1],
    ctx,
  );
  const byDate = new Map(days.map((d) => [d.date, d]));

  return (
    <>
      <Link href="/profil" className="mb-5 inline-block text-xs text-ink-faint hover:text-ink">
        ‹ Profil
      </Link>

      {message ? (
        <div className="mb-4 rounded-lg border border-[color:var(--color-good)]/40 bg-[color:var(--color-good)]/10 p-3 text-sm text-ink">
          {message}
        </div>
      ) : null}

      <Section title="Dienstplan" hint="Tippe einen Tag an und setz die Schicht.">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              ‹
            </Button>
            <span className="text-sm font-medium text-ink">{monthLabel(month)}</span>
            <Button size="sm" variant="ghost" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
              ›
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
              <span key={d} className="pb-1 text-[10px] text-ink-faint">
                {d}
              </span>
            ))}
            {monthGridDays(month).map((date) => {
              const day = byDate.get(date);
              const inMonth = date >= firstOfMonth(month) && date <= lastOfMonth(month);
              const isToday = date === todayIso;
              return (
                <button
                  key={date}
                  onClick={() => setPicked(picked === date ? null : date)}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg border text-[11px] transition-colors ${
                    picked === date
                      ? 'border-[color:var(--color-accent)]'
                      : isToday
                        ? 'border-line-strong'
                        : 'border-transparent'
                  } ${inMonth ? '' : 'opacity-30'}`}
                >
                  <span className="tabular text-ink">{Number(date.slice(8))}</span>
                  {day && !day.isUnknown ? (
                    <span
                      className="mt-0.5 flex size-4 items-center justify-center rounded text-[9px] font-bold text-black"
                      style={{ backgroundColor: day.shift.color }}
                    >
                      {day.shift.short}
                    </span>
                  ) : (
                    <span className="mt-0.5 text-[9px] text-ink-faint">–</span>
                  )}
                </button>
              );
            })}
          </div>

          {picked ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs text-ink-faint">Schicht am {picked}</p>
              <div className="flex flex-wrap gap-1.5">
                {ctx.shiftTypes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => void setShift(picked, t.id)}
                    aria-pressed={byDate.get(picked)?.shift.id === t.id}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      byDate.get(picked)?.shift.id === t.id
                        ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                        : 'border-line-strong text-ink-muted'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
                <button
                  onClick={() => void setShift(picked, null)}
                  className="rounded-lg border border-line-strong px-2.5 py-1.5 text-xs text-ink-faint"
                >
                  Leeren
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      </Section>

      <Section title="Mehrere Tage" hint="Urlaub, Krankheit, ein ganzer Block auf einmal.">
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Von">
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Bis">
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className={`${inputClass} tabular`}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Schichtart">
              <select
                value={rangeType}
                onChange={(e) => setRangeType(e.target.value)}
                className={inputClass}
              >
                {ctx.shiftTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void setShiftRange(rangeFrom, rangeTo, rangeType).then((n) =>
                  setMessage(`${n} Tage gesetzt.`),
                )
              }
              disabled={rangeTo < rangeFrom}
            >
              Setzen
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void setShiftRange(rangeFrom, rangeTo, null).then((n) =>
                  setMessage(`${n} Tage geleert.`),
                )
              }
            >
              Leeren
            </Button>
          </div>
        </Card>
      </Section>

      <Section
        title="Schichtarten und Regeln"
        hint="Was jede Schicht erlaubt — je nach Erholung. Die Empfehlung liest genau diese Tabelle."
      >
        <div className="space-y-2">
          {ctx.shiftTypes.map((t) => (
            <Card key={t.id}>
              <button onClick={() => setEditing(t)} className="w-full text-left">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-black"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.short}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {t.startTime && t.endTime ? `${t.startTime}–${t.endTime} · ` : ''}
                      {CAPABILITY_LABEL[t.capability]}
                      {t.trainingWindow ? ` · ${t.trainingWindow}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-ink-faint">›</span>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {RECOVERIES.map((r) => {
                    const cap = t.maxIntensity[r];
                    return (
                      <Chip key={r} tone={cap === null ? 'neutral' : cap === 'hard' ? 'good' : 'ok'}>
                        {RECOVERY_LABEL[r]}: {cap === null ? 'Ruhe' : INTENSITY_LABEL[cap]}
                      </Chip>
                    );
                  })}
                </div>
              </button>
            </Card>
          ))}
        </div>
      </Section>

      {editing ? <ShiftTypeSheet type={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function ShiftTypeSheet({ type, onClose }: { type: ShiftType; onClose: () => void }) {
  const [draft, setDraft] = useState<ShiftType>(type);
  const patch = (p: Partial<ShiftType>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Sheet title={draft.name} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Kürzel">
            <input
              value={draft.short}
              maxLength={2}
              onChange={(e) => patch({ short: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Beginn">
            <input
              type="time"
              value={draft.startTime ?? ''}
              onChange={(e) => patch({ startTime: e.target.value || null })}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Ende">
            <input
              type="time"
              value={draft.endTime ?? ''}
              onChange={(e) => patch({ endTime: e.target.value || null })}
              className={`${inputClass} tabular`}
            />
          </Field>
        </div>

        <Field label="Trainingsfenster" hint="Klartext, erscheint auf dem Heute-Screen.">
          <input
            value={draft.trainingWindow ?? ''}
            onChange={(e) => patch({ trainingWindow: e.target.value || null })}
            placeholder="15:30–18:00"
            className={inputClass}
          />
        </Field>

        <Field label="Höchstdauer (min)">
          <input
            type="number"
            inputMode="numeric"
            value={draft.maxMinutes}
            onChange={(e) => patch({ maxMinutes: Number(e.target.value) })}
            className={`${inputClass} tabular`}
          />
        </Field>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Höchste Intensität je Erholung
          </p>
          <div className="space-y-2">
            {RECOVERIES.map((r) => (
              <div key={r} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-ink-muted">{RECOVERY_LABEL[r]}</span>
                <div className="flex flex-1 gap-1">
                  {INTENSITIES.map((i) => {
                    const value = i === 'none' ? null : (i as Intensity);
                    const on = draft.maxIntensity[r] === value;
                    return (
                      <button
                        key={i}
                        onClick={() =>
                          patch({ maxIntensity: { ...draft.maxIntensity, [r]: value } })
                        }
                        aria-pressed={on}
                        className={`flex-1 rounded-md border py-1.5 text-[11px] transition-colors ${
                          on
                            ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                            : 'border-line-strong text-ink-muted'
                        }`}
                      >
                        {i === 'none' ? 'Ruhe' : INTENSITY_LABEL[i as Intensity]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Mögliche Sportarten
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SPORT_LABEL) as Sport[]).map((s) => {
              const on = draft.sports.includes(s);
              return (
                <button
                  key={s}
                  onClick={() =>
                    patch({
                      sports: on ? draft.sports.filter((x) => x !== s) : [...draft.sports, s],
                    })
                  }
                  aria-pressed={on}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    on
                      ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                      : 'border-line-strong text-ink-muted'
                  }`}
                >
                  {SPORT_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Notiz">
          <textarea
            rows={2}
            value={draft.note}
            onChange={(e) => patch({ note: e.target.value })}
            className={`${inputClass} resize-none`}
          />
        </Field>

        <Button variant="primary" onClick={() => void saveShiftType(draft).then(onClose)}>
          Speichern
        </Button>
      </div>
    </Sheet>
  );
}
