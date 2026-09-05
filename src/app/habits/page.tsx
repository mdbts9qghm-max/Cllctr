'use client';

/**
 * Habits.
 *
 * Nicht „erledigt / nicht erledigt", sondern Trend: Was diese Woche und diesen
 * Monat zusammengekommen ist. Ein Häkchen sagt nichts darüber, ob etwas trägt.
 */

import { useState } from 'react';
import { addDays, lastDays, num, startOfWeek, today, weekdayShort } from '@/lib/dates';
import { useCheckIns, useHabitEntries, useHabits, useShiftContext } from '@/lib/hooks';
import { completionOverRange, dayCompletion, isDue, statusOf, streakOf, weekCount } from '@/lib/habits';
import { buildBaseline, estimateRecovery } from '@/lib/recovery';
import { resolveRange } from '@/lib/shifts';
import { deleteHabit, saveHabit, setHabitValue } from '@/lib/store';
import { newId, now } from '@/lib/ids';
import {
  HABIT_CATEGORY_LABEL,
  type Habit,
  type HabitCategory,
  type HabitScheduleType,
} from '@/lib/types';
import {
  Bar,
  Button,
  Card,
  Chip,
  Empty,
  Field,
  Loading,
  Section,
  Segmented,
  Sheet,
  Stat,
  inputClass,
} from '@/components/ui';

export default function HabitsPage() {
  const todayIso = today();
  const habits = useHabits();
  const entries = useHabitEntries();
  const checkIns = useCheckIns();
  const ctx = useShiftContext();
  const [editing, setEditing] = useState<Habit | null | undefined>(undefined);

  if (!habits || !entries || !checkIns || !ctx) return <Loading />;

  const active = habits.filter((h) => h.active);
  const weekStart = startOfWeek(todayIso);
  const monthStart = addDays(todayIso, -27);

  /**
   * Tage, an denen ein Aussetzen nicht zählt.
   *
   * Ruhe ist kein Versäumnis. Ohne diese Menge würde jede Tagschicht und jeder
   * schlechte Erholungstag eine Serie reißen — und eine Serie, die man nur mit
   * Selbstschädigung hält, erzieht zum Schummeln.
   */
  const exempt = new Set(
    resolveRange(addDays(todayIso, -120), todayIso, ctx)
      .filter((day) => {
        if (day.shift.pausesStreaks || day.shift.capability === 'none') return true;
        const entry = checkIns.find((c) => c.date === day.date);
        return (
          estimateRecovery(entry, buildBaseline(checkIns, day.date), {
            afterNightShift: day.afterNightShift,
          }).status === 'low'
        );
      })
      .map((d) => d.date),
  );

  const weekPct = completionOverRange(habits, entries, weekStart, todayIso);
  const monthPct = completionOverRange(habits, entries, monthStart, todayIso);
  const dayInfo = dayCompletion(habits, entries, todayIso);

  return (
    <>
      <Section title="Überblick">
        <Card>
          <div className="grid grid-cols-3 gap-5">
            <Stat
              label="Heute"
              value={`${dayInfo.done}/${dayInfo.due}`}
              tone={dayInfo.ratio >= 0.8 ? 'good' : dayInfo.ratio >= 0.5 ? 'ok' : 'warn'}
            />
            <Stat
              label="Diese Woche"
              value={weekPct}
              unit="%"
              tone={weekPct >= 80 ? 'good' : weekPct >= 60 ? 'ok' : 'warn'}
            />
            <Stat label="4 Wochen" value={monthPct} unit="%" />
          </div>
        </Card>
      </Section>

      <Section
        title="Heute"
        action={
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            + Neu
          </Button>
        }
      >
        {active.length === 0 ? (
          <Empty title="Noch keine Habits">Leg einen an — Schlaf, Wasser, Protein, Mobility.</Empty>
        ) : (
          <div className="space-y-2">
            {active.map((habit) => {
              const s = statusOf(habit, entries, todayIso);
              const streak = streakOf(habit, entries, exempt, todayIso);
              const week = weekCount(habit, entries, todayIso);
              const due = isDue(habit, todayIso);

              return (
                <Card key={habit.id}>
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() =>
                        void setHabitValue(
                          habit.id,
                          todayIso,
                          s.state === 'done' ? 0 : (habit.target ?? 1),
                        )
                      }
                      aria-pressed={s.state === 'done'}
                      aria-label={`${habit.name} abhaken`}
                      className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border text-sm transition-colors ${
                        s.state === 'done'
                          ? 'border-[color:var(--color-good)] bg-[color:var(--color-good)] text-black'
                          : s.state === 'partial'
                            ? 'border-[color:var(--color-ok)] text-[color:var(--color-ok)]'
                            : 'border-line-strong'
                      }`}
                    >
                      {s.state === 'done' ? '✓' : s.state === 'partial' ? '·' : ''}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <button
                          onClick={() => setEditing(habit)}
                          className="truncate text-left text-sm font-medium text-ink"
                        >
                          {habit.name}
                        </button>
                        <span className="shrink-0 text-[11px] tabular text-ink-faint">
                          {habit.kind === 'quantity'
                            ? `${num(s.value)} / ${num(habit.target ?? 0)} ${habit.unit}`
                            : due
                              ? ''
                              : 'heute nicht fällig'}
                        </span>
                      </div>

                      {habit.kind === 'quantity' ? (
                        <>
                          <Bar
                            ratio={s.ratio}
                            tone={s.state === 'done' ? 'good' : s.state === 'partial' ? 'ok' : 'neutral'}
                            className="mt-2"
                          />
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            placeholder={`${num(habit.target ?? 0)} ${habit.unit}`}
                            defaultValue={s.value || ''}
                            onChange={(e) => {
                              const v = Number(e.target.value.replace(',', '.'));
                              void setHabitValue(habit.id, todayIso, Number.isFinite(v) ? v : 0);
                            }}
                            className="mt-2 w-24 rounded-lg border border-line-strong bg-surface-2 px-2 py-1 text-sm tabular text-ink outline-none focus:border-[color:var(--color-accent)]"
                          />
                        </>
                      ) : null}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Chip tone={streak >= 7 ? 'good' : 'neutral'}>
                          {streak} {streak === 1 ? 'Tag' : 'Tage'} Serie
                        </Chip>
                        <Chip>
                          Woche {week.done}/{week.target}
                        </Chip>
                        <Chip>{HABIT_CATEGORY_LABEL[habit.category]}</Chip>
                      </div>

                      <WeekDots habit={habit} entries={entries} today={todayIso} />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {editing !== undefined ? (
        <HabitSheet habit={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
}

/** Die letzten sieben Tage als Punktreihe — Trend auf einen Blick. */
function WeekDots({
  habit,
  entries,
  today: todayIso,
}: {
  habit: Habit;
  entries: Parameters<typeof statusOf>[1];
  today: string;
}) {
  return (
    <div className="mt-2 flex gap-1">
      {lastDays(7, todayIso).map((date) => {
        const s = statusOf(habit, entries, date);
        const color =
          s.state === 'done'
            ? 'bg-[color:var(--color-good)]'
            : s.state === 'partial'
              ? 'bg-[color:var(--color-ok)]'
              : s.state === 'notDue'
                ? 'bg-transparent border border-line'
                : 'bg-[color:var(--color-line-strong)]';
        return (
          <span key={date} className="flex flex-1 flex-col items-center gap-1">
            <span className={`h-1.5 w-full rounded-full ${color}`} />
            <span className="text-[9px] text-ink-faint">{weekdayShort(date).slice(0, 2)}</span>
          </span>
        );
      })}
    </div>
  );
}

function emptyHabit(): Habit {
  const ts = now();
  return {
    id: newId('habit'),
    name: '',
    kind: 'check',
    category: 'other',
    unit: '',
    target: null,
    minimum: null,
    schedule: { type: 'daily', weekdays: null, timesPerWeek: null },
    restDayExempt: false,
    active: true,
    sortOrder: 99,
    createdAt: ts,
    updatedAt: ts,
  };
}

function HabitSheet({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Habit>(habit ?? emptyHabit());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = (p: Partial<Habit>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Sheet title={habit ? 'Habit bearbeiten' : 'Neuer Habit'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Protein, Schlaf, Mobility …"
            className={inputClass}
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Art
          </span>
          <Segmented
            value={draft.kind}
            onChange={(kind) => patch({ kind })}
            options={[
              { value: 'check', label: 'Abhaken' },
              { value: 'quantity', label: 'Menge' },
            ]}
          />
        </div>

        {draft.kind === 'quantity' ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Ziel">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={draft.target ?? ''}
                onChange={(e) => patch({ target: e.target.value === '' ? null : Number(e.target.value) })}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Minimum">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={draft.minimum ?? ''}
                onChange={(e) => patch({ minimum: e.target.value === '' ? null : Number(e.target.value) })}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Einheit">
              <input
                value={draft.unit}
                onChange={(e) => patch({ unit: e.target.value })}
                placeholder="g, l, min"
                className={inputClass}
              />
            </Field>
          </div>
        ) : null}

        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Rhythmus
          </span>
          <Segmented
            value={draft.schedule.type}
            onChange={(type: HabitScheduleType) =>
              patch({
                schedule: {
                  type,
                  weekdays: type === 'weekdays' ? (draft.schedule.weekdays ?? [1, 3, 5]) : null,
                  timesPerWeek: type === 'timesPerWeek' ? (draft.schedule.timesPerWeek ?? 3) : null,
                },
              })
            }
            options={[
              { value: 'daily', label: 'Täglich' },
              { value: 'weekdays', label: 'Wochentage' },
              { value: 'timesPerWeek', label: 'X pro Woche' },
            ]}
            size="sm"
          />
        </div>

        {draft.schedule.type === 'weekdays' ? (
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
              const on = (draft.schedule.weekdays ?? []).includes(wd);
              return (
                <button
                  key={wd}
                  onClick={() => {
                    const list = new Set(draft.schedule.weekdays ?? []);
                    if (on) list.delete(wd);
                    else list.add(wd);
                    patch({ schedule: { ...draft.schedule, weekdays: [...list] } });
                  }}
                  aria-pressed={on}
                  className={`flex-1 rounded-lg border py-2 text-xs ${
                    on
                      ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                      : 'border-line-strong text-ink-muted'
                  }`}
                >
                  {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][wd]}
                </button>
              );
            })}
          </div>
        ) : null}

        {draft.schedule.type === 'timesPerWeek' ? (
          <Field label="Wie oft pro Woche">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={7}
              value={draft.schedule.timesPerWeek ?? 3}
              onChange={(e) =>
                patch({ schedule: { ...draft.schedule, timesPerWeek: Number(e.target.value) } })
              }
              className={`${inputClass} tabular`}
            />
          </Field>
        ) : null}

        <Field label="Kategorie">
          <select
            value={draft.category}
            onChange={(e) => patch({ category: e.target.value as HabitCategory })}
            className={inputClass}
          >
            {(Object.keys(HABIT_CATEGORY_LABEL) as HabitCategory[]).map((c) => (
              <option key={c} value={c}>
                {HABIT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <input
            type="checkbox"
            checked={draft.restDayExempt}
            onChange={(e) => patch({ restDayExempt: e.target.checked })}
            className="mt-0.5 size-4"
          />
          <span className="text-sm leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">An Ruhetagen aussetzen</span> — die Serie reißt
            nicht, wenn an einem Tag mit niedriger Erholung, Tagschicht oder Urlaub nichts passiert.
          </span>
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="primary"
            disabled={!draft.name.trim()}
            onClick={() => void saveHabit(draft).then(onClose)}
          >
            Speichern
          </Button>
          {habit ? (
            confirmDelete ? (
              <Button variant="danger" onClick={() => void deleteHabit(habit.id).then(onClose)}>
                Wirklich löschen
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Löschen
              </Button>
            )
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
