'use client';

import { useState } from 'react';
import { db } from '@/lib/db';
import { addDays, formatShort, today, weekdayShort } from '@/lib/dates';
import { now } from '@/lib/ids';
import { capacityExplanation, checkFeasibility, resolveShiftRange } from '@/lib/shifts';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { CAPACITY_LABEL, CAPACITY_SHORT, type IsoDate } from '@/lib/types';
import { Button, CapacityBadge, Card, Field, inputClass, Notice, Section } from '@/components/ui';

const PREVIEW_DAYS = 21;

export default function SchichtPage() {
  const ctx = useShiftContext();
  const settings = useSettings();
  const [openDay, setOpenDay] = useState<IsoDate | null>(null);

  if (!ctx || !settings) return <p className="text-sm text-ink-faint">Lade …</p>;

  const start = today();
  const days = resolveShiftRange(start, addDays(start, PREVIEW_DAYS - 1), ctx);
  const pattern = ctx.pattern;
  const feasibility = checkFeasibility(start, ctx, settings.weeklyTargets);
  const round = (n: number) => Math.round(n * 10) / 10;

  async function setOverride(date: IsoDate, shiftTypeId: string | null) {
    if (shiftTypeId === null) {
      await db.shiftOverrides.delete(date);
    } else {
      await db.shiftOverrides.put({ date, shiftTypeId, note: '', createdAt: now() });
    }
    setOpenDay(null);
  }

  async function updateSequence(next: string[]) {
    if (!pattern) return;
    await db.shiftPatterns.update(pattern.id, { sequence: next, updatedAt: now() });
  }

  async function updateAnchor(date: string) {
    if (!pattern || !date) return;
    await db.shiftPatterns.update(pattern.id, { anchorDate: date, updatedAt: now() });
  }

  return (
    <>
      <Section
        title="Rotation"
        hint="Dein Grundrhythmus. Die App wiederholt diese Folge ab dem Startdatum endlos und plant das Training in die Lücken."
      >
        {!pattern ? (
          <Notice tone="error">Keine Rotation hinterlegt.</Notice>
        ) : (
          <Card>
            <div className="mb-4">
              <Field label="Startdatum der Folge" hint="Der Tag, an dem der erste Eintrag der Folge liegt.">
                <input
                  type="date"
                  value={pattern.anchorDate}
                  onChange={(e) => void updateAnchor(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <p className="mb-2 text-sm text-ink-muted">Folge ({pattern.sequence.length} Tage)</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {pattern.sequence.map((typeId, i) => (
                <div key={i} className="flex items-center gap-1">
                  <select
                    value={typeId}
                    onChange={(e) => {
                      const next = [...pattern.sequence];
                      next[i] = e.target.value;
                      void updateSequence(next);
                    }}
                    className="rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink focus:border-ember focus:outline-none"
                  >
                    {ctx!.shiftTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void updateSequence(pattern.sequence.filter((_, j) => j !== i))}
                    className="px-1 text-ink-faint hover:text-danger"
                    aria-label={`Tag ${i + 1} entfernen`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <Button
              onClick={() =>
                void updateSequence([...pattern.sequence, ctx!.shiftTypes[0]?.id ?? 'frei'])
              }
            >
              + Tag anhängen
            </Button>
          </Card>
        )}
      </Section>

      <Section
        title="Passt das zusammen?"
        hint="Was deine Rotation im Schnitt pro Woche hergibt — verglichen mit deinen Wochenzielen."
      >
        <Card>
          <div className="mb-3 grid grid-cols-4 gap-2 text-center">
            {(['full', 'moderate', 'light', 'none'] as const).map((c) => (
              <div key={c}>
                <p className="text-xl font-semibold text-ink tabular">
                  {round(feasibility.budget.perWeek[c])}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-ink-faint">
                  {CAPACITY_LABEL[c]}
                </p>
              </div>
            ))}
          </div>
          <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
            Tage pro Woche, gemittelt über {feasibility.budget.days} Tage. Volle Tage schwanken
            zwischen {feasibility.budget.fullDaysPerWeek.min} und{' '}
            {feasibility.budget.fullDaysPerWeek.max} pro Woche. Ziel:{' '}
            {settings.weeklyTargets.strength}× Kraft, {settings.weeklyTargets.run}× Laufen,{' '}
            {settings.weeklyTargets.optional}× optional.
          </p>
        </Card>

        <div className="mt-3 space-y-2">
          <Notice
            tone={
              feasibility.verdict === 'fits'
                ? 'ok'
                : feasibility.verdict === 'tight'
                  ? 'warn'
                  : 'error'
            }
          >
            {feasibility.headline}
          </Notice>
          {feasibility.messages.map((m, i) => (
            <Notice key={i} tone="info">
              {m}
            </Notice>
          ))}
        </div>
      </Section>

      <Section
        title={`Nächste ${PREVIEW_DAYS} Tage`}
        hint="So sieht die App deine Verfügbarkeit. Tippe einen Tag an, um ihn abweichend zu setzen — bei Tausch, Urlaub oder Krankheit."
      >
        <div className="space-y-1.5">
          {days.map((day) => {
            const isOpen = openDay === day.date;
            return (
              <div key={day.date}>
                <button
                  onClick={() => setOpenDay(isOpen ? null : day.date)}
                  className="flex w-full items-center gap-3 rounded border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                >
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded text-xs font-bold text-void"
                    style={{ backgroundColor: day.shiftType.color }}
                  >
                    {day.shiftType.short}
                  </span>
                  {/* Kompaktes Datum: der Schichtname braucht den Platz mehr. */}
                  <span className="w-[68px] shrink-0 text-sm text-ink tabular">
                    {weekdayShort(day.date)} {day.date.slice(8)}.{day.date.slice(5, 7)}.
                  </span>
                  {/* "nach Nacht" in eine eigene Zeile statt hinter den Namen:
                      nebeneinander wird beides abgeschnitten. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-muted">
                      {day.shiftType.name}
                      {day.isOverride ? ' ∗' : ''}
                    </span>
                    {day.afterNightShift ? (
                      <span className="block text-[10px] leading-tight text-ink-faint">
                        nach Nacht
                      </span>
                    ) : null}
                  </span>
                  <CapacityBadge capacity={day.capacity} label={CAPACITY_SHORT[day.capacity]} />
                </button>

                {isOpen ? (
                  <div className="mt-1 rounded border border-line-strong bg-surface-2 p-3">
                    <p className="mb-3 text-sm leading-relaxed text-ink-muted">
                      {capacityExplanation(day)}
                    </p>
                    <p className="mb-2 text-xs uppercase tracking-widest text-ink-faint">
                      Abweichend setzen
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ctx!.shiftTypes.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => void setOverride(day.date, t.id)}
                          className="rounded border border-line-strong px-2.5 py-1 text-sm text-ink hover:border-ember"
                        >
                          {t.name}
                        </button>
                      ))}
                      {day.isOverride ? (
                        <button
                          onClick={() => void setOverride(day.date, null)}
                          className="rounded border border-danger/50 px-2.5 py-1 text-sm text-danger"
                        >
                          Zurück zur Rotation
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
