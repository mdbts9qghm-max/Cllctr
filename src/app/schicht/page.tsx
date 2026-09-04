'use client';

import Link from 'next/link';
import { useState } from 'react';
import { db } from '@/lib/db';
import { addDays, formatShort, monthKey, today } from '@/lib/dates';
import { now } from '@/lib/ids';
import {
  capacityAllows,
  capacityExplanation,
  checkFeasibility,
  resolveShiftDay,
  resolveShiftRange,
} from '@/lib/shifts';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { CAPACITY_LABEL, type IsoDate } from '@/lib/types';
import { ShiftPicker, ShiftRange } from '@/components/ShiftPicker';
import { MonthGrid } from '@/components/MonthGrid';
import { Button, Card, Field, inputClass, Notice, Section } from '@/components/ui';

const PREVIEW_DAYS = 21;

export default function SchichtPage() {
  const ctx = useShiftContext();
  const settings = useSettings();
  const [openDay, setOpenDay] = useState<IsoDate | null>(null);
  const [month, setMonth] = useState(() => monthKey(today()));
  // Auch die abgeschaltete Rotation wird geladen: sie soll erhalten bleiben und
  // sich wieder einschalten lassen, ohne sie neu einzutippen.
  const patterns = useLiveQuery(() => db.shiftPatterns.toArray(), []);
  const plannedSessions = useLiveQuery(
    () => db.sessions.where('status').equals('planned').toArray(),
    [],
  );

  if (!ctx || !settings || !plannedSessions || !patterns) {
    return <p className="text-sm text-ink-faint">Lade …</p>;
  }

  const start = today();
  const days = resolveShiftRange(start, addDays(start, PREVIEW_DAYS - 1), ctx);
  const pattern = ctx.pattern ?? patterns?.[0] ?? null;
  const usesRotation = ctx.pattern !== null;
  const feasibility = checkFeasibility(start, ctx, settings.weeklyTargets);

  /**
   * Einheiten, die nach einer geänderten Schicht nicht mehr auf ihren Tag
   * passen. Ohne diesen Hinweis müsste man selbst darauf kommen, dass der Plan
   * nach einem Schichttausch nicht mehr stimmt.
   */
  const byDate = new Map(days.map((d) => [d.date, d]));
  const misfits = plannedSessions.filter((session) => {
    const day = byDate.get(session.date);
    return day !== undefined && !capacityAllows(day.capacity, session.type);
  });
  const round = (n: number) => Math.round(n * 10) / 10;
  const sessionDates = new Set(plannedSessions.map((x) => x.date));

  /**
   * Schaltet die Rotation ein oder aus.
   *
   * Aus heißt nicht gelöscht: die Folge bleibt stehen, sie greift nur nicht
   * mehr. Wer zwischen den Wegen hin- und herprobiert, soll seine Folge nicht
   * jedes Mal neu eintippen.
   */
  async function setRotationActive(active: boolean) {
    if (!pattern) return;
    await db.shiftPatterns.update(pattern.id, { active, updatedAt: now() });
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
      {/* Zwei Wege, denselben Kalender zu füllen: eine Rotation, die sich
          endlos wiederholt, oder Tag für Tag von Hand. Wer einen Dienstplan
          bekommt, der jeden Monat anders aussieht, ist mit der Rotation nur
          beschäftigt, sie ständig zu korrigieren. */}
      <div className="mb-6 flex gap-1 rounded-lg border border-line bg-surface p-1">
        {[
          { key: false, label: 'Tag für Tag' },
          { key: true, label: 'Nach Rotation' },
        ].map((m) => (
          <button
            key={String(m.key)}
            onClick={() => void setRotationActive(m.key)}
            aria-pressed={usesRotation === m.key}
            className={`flex-1 rounded px-2 py-2 text-xs transition-colors ${
              usesRotation === m.key
                ? 'bg-surface-2 font-medium text-ink'
                : 'text-ink-faint hover:text-ink-muted'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Section
        title="Schichtplan"
        hint="Trag ein, was auf deinem Dienstplan steht. Der Trainingsplan richtet sich danach — jede Änderung wirkt sofort."
      >
        <Card>
          <MonthGrid
            month={month}
            onMonthChange={setMonth}
            selected={openDay}
            onPick={(date) => setOpenDay(openDay === date ? null : date)}
            cellFor={(date) => {
              const d = resolveShiftDay(date, ctx!);
              const unplanned = d.shiftType.id === '__unplanned';
              return {
                mark: d.shiftType.short,
                color: unplanned ? null : d.shiftType.color,
                dot: sessionDates.has(date) ? ('accent' as const) : null,
              };
            }}
          />

          {/* Die Legende steht mit im Raster: zwei Zeichen, die man sonst raten
              müsste — die Farbe der Schicht und der Punkt fürs Training. */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3">
            {ctx!.shiftTypes.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                <span
                  className="flex size-4 items-center justify-center rounded text-[9px] font-bold text-void"
                  style={{ backgroundColor: t.color }}
                >
                  {t.short}
                </span>
                {t.name}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="size-1 rounded-full bg-ember" />
              Training geplant
            </span>
          </div>
        </Card>

        {openDay ? (
          <div className="mt-3 rounded border border-line-strong bg-surface-2 p-3">
            <p className="mb-1 text-sm font-medium text-ink">{formatShort(openDay)}</p>
            <p className="mb-3 text-sm leading-relaxed text-ink-muted">
              {capacityExplanation(resolveShiftDay(openDay, ctx!))}
            </p>
            <ShiftPicker
              day={resolveShiftDay(openDay, ctx!)}
              shiftTypes={ctx!.shiftTypes}
              label="Schicht an diesem Tag"
            />
          </div>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Tippe einen Tag an, um seine Schicht zu setzen. Für längere Blöcke — Urlaub,
            Krankheit — ist der Zeitraum darüber schneller.
          </p>
        )}
      </Section>

      <Section
        title="Mehrere Tage auf einmal"
        hint="Urlaub, Lehrgang, längere Krankheit — ein Block am Stück statt Tag für Tag. Überschreibt die Rotation für den ganzen Zeitraum."
      >
        <Card>
          <ShiftRange shiftTypes={ctx.shiftTypes} />
        </Card>
      </Section>

      {misfits.length > 0 ? (
        <div className="mb-8">
          <Notice tone="warn">
            <span className="mb-1 block font-medium text-ink">
              {misfits.length === 1
                ? 'Eine geplante Einheit passt nicht mehr zu ihrem Tag.'
                : `${misfits.length} geplante Einheiten passen nicht mehr zu ihrem Tag.`}
            </span>
            {misfits.slice(0, 3).map((session) => (
              <span key={session.id} className="block text-xs">
                · {session.title} am {formatShort(session.date)}
              </span>
            ))}
            <Link href="/plan" className="mt-2 block text-sm text-ember underline">
              Im Plan umplanen
            </Link>
          </Notice>
        </div>
      ) : null}

      {/* Die Hochrechnung setzt eine sich wiederholende Folge voraus. Trägt man
          Tag für Tag ein, sagt ein Schnitt über nicht eingetragene Tage nichts
          — dann steht hier lieber gar nichts. */}
      {usesRotation ? (
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
            {settings.weeklyTargets.strength}× Kraft (davon{' '}
            {settings.weeklyTargets.strengthHard ?? 1}× schwer),{' '}
            {settings.weeklyTargets.run}× harte Ausdauer, {settings.weeklyTargets.optional}× locker
            — höchstens {settings.weeklyTargets.maxHardPerWeek ?? 3} harte Einheiten pro Woche.
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
      ) : null}

      {usesRotation ? (
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
      ) : null}

    </>
  );
}
