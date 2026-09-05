'use client';

/**
 * Heute — der Bildschirm, der zählt.
 *
 * Aufbau von oben nach unten in der Reihenfolge, in der die Fragen morgens
 * kommen: Welcher Tag ist das? Wie geht es mir? Was soll ich tun? Was steht
 * sonst an?
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  formatDuration,
  formatLong,
  isoWeek,
  num,
  today,
} from '@/lib/dates';
import {
  useCheckIns,
  useExercises,
  useHabitEntries,
  useHabits,
  usePhases,
  useProfile,
  useSessions,
  useSettings,
  useShiftContext,
  useTasks,
} from '@/lib/hooks';
import { planDay, type Suggestion } from '@/lib/engine';
import { buildBaseline, estimateRecovery, hasInput } from '@/lib/recovery';
import { dayCompletion, statusOf } from '@/lib/habits';
import { effortBudget, suggestTasks } from '@/lib/tasks';
import { loadBalance, minutesOf } from '@/lib/load';
import { addSession, completeTask, setHabitValue } from '@/lib/store';
import {
  PHASE_LABEL,
  RECOVERY_HINT,
  RECOVERY_LABEL,
  SPORT_ICON,
  SPORT_LABEL,
  type TrainingSession,
} from '@/lib/types';
import { CheckInSheet, RECOVERY_TONE } from '@/components/CheckInSheet';
import { SessionSheet } from '@/components/SessionSheet';
import { Bar, Button, Card, Chip, Dot, Loading, Section, Stat } from '@/components/ui';

export default function HeutePage() {
  const todayIso = today();

  const settings = useSettings();
  const profile = useProfile();
  const ctx = useShiftContext();
  const sessions = useSessions();
  const phases = usePhases();
  const checkIns = useCheckIns();
  const habits = useHabits();
  const habitEntries = useHabitEntries();
  const tasks = useTasks();
  const exercises = useExercises();

  const [showCheckIn, setShowCheckIn] = useState(false);
  const [editing, setEditing] = useState<TrainingSession | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (
    !settings || !profile || !ctx || !sessions || !phases || !checkIns ||
    !habits || !habitEntries || !tasks || !exercises
  ) {
    return <Loading />;
  }

  const entry = checkIns.find((c) => c.date === todayIso);
  const estimate = estimateRecovery(entry, buildBaseline(checkIns, todayIso), {
    afterNightShift: false,
  });

  const plan = planDay({
    date: todayIso,
    shiftContext: ctx,
    sessions,
    settings,
    profile,
    phases,
    recovery: estimate.status,
  });

  // Die Erholung hängt auch daran, ob gestern Nachtschicht war — das weiß erst
  // die Schichtauflösung, deshalb hier ein zweites Mal.
  const trueEstimate = estimateRecovery(entry, buildBaseline(checkIns, todayIso), {
    afterNightShift: plan.day.afterNightShift,
  });
  const dayPlan =
    trueEstimate.status === estimate.status
      ? plan
      : planDay({
          date: todayIso,
          shiftContext: ctx,
          sessions,
          settings,
          profile,
          phases,
          recovery: trueEstimate.status,
        });

  const todaysSessions = sessions.filter(
    (s) => s.date === todayIso && s.status !== 'skipped',
  );
  const openSessions = todaysSessions.filter((s) => s.status === 'planned');
  const doneSessions = todaysSessions.filter((s) => s.status === 'done');

  const balance = loadBalance(sessions, todayIso, settings.rampWarnPct);
  const habitDay = dayCompletion(habits, habitEntries, todayIso);
  const openTasks = tasks.filter((t) => t.status === 'open');

  const budget = effortBudget({
    shiftCapability: dayPlan.day.shift.capability,
    hadHardSession: todaysSessions.some((s) => s.intensity === 'hard'),
    recovery: trueEstimate.status,
  });
  const suggestedTasks = suggestTasks(openTasks, budget.allowed, todayIso, 3);

  async function acceptSuggestion(s: Suggestion) {
    setBusy(true);
    try {
      await addSession({
        date: todayIso,
        sport: s.sport,
        title: s.title,
        intensity: s.intensity,
        zone: s.zone,
        purpose: s.purpose,
        plannedMinutes: s.minutes,
        plannedDistanceKm: null,
        source: 'suggestion',
      });
    } finally {
      setBusy(false);
    }
  }

  const zoneHint = (zone: number | null) => {
    const z = profile.hrZones.find((x) => x.zone === zone);
    return z ? `Zone ${z.zone} · ${z.minBpm}–${z.maxBpm} bpm` : zone ? `Zone ${zone}` : null;
  };

  return (
    <>
      {/* ---- Kopf: welcher Tag ist das? ---------------------------- */}
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {formatLong(todayIso)} · KW {isoWeek(todayIso)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link
            href="/profil/schichten"
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
          >
            <span
              className="flex size-6 items-center justify-center rounded text-[11px] font-bold text-black"
              style={{ backgroundColor: dayPlan.day.shift.color }}
            >
              {dayPlan.day.shift.short}
            </span>
            <span className="text-sm text-ink">{dayPlan.day.shift.name}</span>
            {dayPlan.allowance.window ? (
              <span className="text-[11px] text-ink-faint">{dayPlan.allowance.window}</span>
            ) : null}
          </Link>
          <Chip tone="accent">
            {PHASE_LABEL[dayPlan.phase.kind]}
            {dayPlan.phase.week ? ` · Woche ${dayPlan.phase.week}` : ''}
          </Chip>
        </div>
      </div>

      {/* ---- Check-in --------------------------------------------- */}
      <button
        onClick={() => setShowCheckIn(true)}
        className="mb-5 flex w-full items-center gap-3 rounded-[14px] border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong"
      >
        <Dot tone={RECOVERY_TONE[trueEstimate.status]} className="size-3" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">
            {RECOVERY_LABEL[trueEstimate.status]}
            <span className="ml-2 text-xs font-normal text-ink-faint">
              {RECOVERY_HINT[trueEstimate.status]}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">
            {entry?.completedAt
              ? trueEstimate.headline
              : hasInput(entry)
                ? 'Check-in noch nicht abgeschlossen.'
                : 'Check-in offen — tippen und eintragen.'}
          </span>
        </span>
        <span className="shrink-0 text-2xl font-semibold tabular text-ink">
          {trueEstimate.percent}
          <span className="text-sm font-normal text-ink-faint">%</span>
        </span>
      </button>

      {/* ---- Die Empfehlung --------------------------------------- */}
      <Section title="Heute">
        {doneSessions.length > 0 || openSessions.length > 0 ? (
          <div className="space-y-2">
            {todaysSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setEditing(s)}
                className="flex w-full items-center gap-3 rounded-[14px] border border-line bg-surface p-4 text-left"
              >
                <span className="text-xl" aria-hidden="true">
                  {SPORT_ICON[s.sport]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{s.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">
                    {[
                      minutesOf(s) > 0 ? formatDuration(minutesOf(s)) : null,
                      s.actualDistanceKm ?? s.plannedDistanceKm
                        ? `${num(s.actualDistanceKm ?? s.plannedDistanceKm ?? 0)} km`
                        : null,
                      zoneHint(s.zone),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Chip tone={s.status === 'done' ? 'good' : 'neutral'}>
                  {s.status === 'done' ? 'erledigt' : 'geplant'}
                </Chip>
              </button>
            ))}
          </div>
        ) : dayPlan.primary ? (
          <Card tone="accent">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden="true">
                {SPORT_ICON[dayPlan.primary.sport]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-ink">{dayPlan.primary.title}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {formatDuration(dayPlan.primary.minutes)}
                  {zoneHint(dayPlan.primary.zone) ? ` · ${zoneHint(dayPlan.primary.zone)}` : ''}
                </p>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              {dayPlan.primary.purpose}
            </p>

            <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Warum
            </p>
            <ul className="mt-1.5 space-y-1">
              {dayPlan.primary.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[color:var(--color-accent)]" />
                  {r}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void acceptSuggestion(dayPlan.primary!)}
              >
                Übernehmen
              </Button>
              <Button onClick={() => setEditing(null)}>Anders planen</Button>
            </div>
          </Card>
        ) : (
          <Card tone="quiet">
            <p className="text-sm font-semibold text-ink">Ruhetag</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{dayPlan.headline}</p>
            {dayPlan.alternatives.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void acceptSuggestion(dayPlan.alternatives[0])}>
                  {dayPlan.alternatives[0].title} · {dayPlan.alternatives[0].minutes} min
                </Button>
              </div>
            ) : null}
          </Card>
        )}

        {openSessions.length === 0 && doneSessions.length === 0 && dayPlan.alternatives.length > 0 ? (
          <div className="mt-2 space-y-2">
            {dayPlan.alternatives.map((a, i) => (
              <SuggestionRow key={i} suggestion={a} onAccept={() => void acceptSuggestion(a)} />
            ))}
          </div>
        ) : null}

        {dayPlan.discouraged.length > 0 && openSessions.length === 0 ? (
          <div className="mt-2 space-y-2">
            {dayPlan.discouraged.map((d, i) => (
              <div key={i} className="rounded-[14px] border border-dashed border-line p-3">
                <p className="flex items-center gap-2 text-sm text-ink-faint">
                  <Dot tone="warn" />
                  Nicht empfohlen: {d.title}
                </p>
                <p className="mt-1 pl-4 text-xs leading-relaxed text-ink-faint">
                  {d.reasons[0]}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      {/* ---- Tagesstatus ------------------------------------------ */}
      <Section title="Tagesstatus">
        <Card>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat
              label="Recovery"
              value={trueEstimate.percent}
              unit="%"
              tone={RECOVERY_TONE[trueEstimate.status] as 'good' | 'ok' | 'warn'}
              sub={RECOVERY_LABEL[trueEstimate.status]}
            />
            <Stat
              label="Woche"
              value={formatDuration(dayPlan.week.minutesDone)}
              tone={dayPlan.week.minutesDone >= dayPlan.week.minutesTarget * 0.9 ? 'good' : 'neutral'}
              sub={`Ziel ${formatDuration(dayPlan.week.minutesTarget)}`}
            />
            <Stat
              label="Load 7 Tage"
              value={balance.acute}
              tone={balance.rising ? 'warn' : 'neutral'}
              sub={
                balance.rampPct === null
                  ? 'noch kein Vergleich'
                  : `${balance.rampPct >= 0 ? '+' : ''}${balance.rampPct} % zum Schnitt`
              }
            />
            <Stat
              label="Habits"
              value={`${habitDay.done}/${habitDay.due}`}
              tone={habitDay.ratio >= 0.8 ? 'good' : habitDay.ratio >= 0.5 ? 'ok' : 'warn'}
              sub={`${Math.round(habitDay.ratio * 100)} % erfüllt`}
            />
          </div>

          <div className="mt-4">
            <Bar
              ratio={dayPlan.week.minutesDone / Math.max(1, dayPlan.week.minutesTarget)}
              tone="accent"
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              {dayPlan.week.daysLeft > 0
                ? `Noch ${dayPlan.week.daysLeft} trainierbare Tage diese Woche.`
                : 'Keine trainierbaren Tage mehr in dieser Woche.'}
              {dayPlan.week.hasLongSession
                ? ' Lange Einheit steht.'
                : ' Lange Einheit fehlt noch.'}
            </p>
          </div>
        </Card>
      </Section>

      {/* ---- Habits ----------------------------------------------- */}
      <Section
        title="Habits"
        action={
          <Link href="/habits" className="text-[11px] text-ink-faint hover:text-ink">
            alle ›
          </Link>
        }
      >
        <Card>
          <div className="space-y-3">
            {habits
              .filter((h) => h.active)
              .slice(0, 5)
              .map((habit) => {
                const s = statusOf(habit, habitEntries, todayIso);
                return (
                  <div key={habit.id} className="flex items-center gap-3">
                    <button
                      onClick={() =>
                        void setHabitValue(
                          habit.id,
                          todayIso,
                          s.state === 'done' ? 0 : (habit.target ?? 1),
                        )
                      }
                      aria-pressed={s.state === 'done'}
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        s.state === 'done'
                          ? 'border-[color:var(--color-good)] bg-[color:var(--color-good)] text-black'
                          : 'border-line-strong'
                      }`}
                    >
                      {s.state === 'done' ? '✓' : ''}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-ink">{habit.name}</span>
                        <span className="shrink-0 text-[11px] tabular text-ink-faint">
                          {habit.kind === 'quantity'
                            ? `${num(s.value)} / ${num(habit.target ?? 0)} ${habit.unit}`
                            : ''}
                        </span>
                      </div>
                      {habit.kind === 'quantity' ? (
                        <Bar
                          ratio={s.ratio}
                          tone={s.state === 'done' ? 'good' : s.state === 'partial' ? 'ok' : 'neutral'}
                          className="mt-1.5"
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      </Section>

      {/* ---- Aufgaben --------------------------------------------- */}
      <Section
        title="Heute sinnvoll"
        hint={budget.reason}
        action={
          <Link href="/tasks" className="text-[11px] text-ink-faint hover:text-ink">
            alle ›
          </Link>
        }
      >
        {suggestedTasks.length === 0 ? (
          <Card tone="quiet">
            <p className="text-sm text-ink-muted">
              {openTasks.length === 0
                ? 'Keine offenen Aufgaben.'
                : 'Nichts, was zum heutigen Tag passt.'}
            </p>
          </Card>
        ) : (
          <Card>
            <div className="space-y-2.5">
              {suggestedTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3">
                  <button
                    onClick={() => void completeTask(task, todayIso)}
                    aria-label={`${task.title} erledigen`}
                    className="size-5 shrink-0 rounded-md border border-line-strong"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.title}</span>
                  <Dot tone={task.priority === 1 ? 'warn' : task.priority === 2 ? 'ok' : 'good'} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      {showCheckIn ? (
        <CheckInSheet
          date={todayIso}
          entry={entry}
          estimate={trueEstimate}
          onClose={() => setShowCheckIn(false)}
        />
      ) : null}

      {editing !== undefined ? (
        <SessionSheet
          date={todayIso}
          session={editing}
          exercises={exercises}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function SuggestionRow({
  suggestion,
  onAccept,
}: {
  suggestion: Suggestion;
  onAccept: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-line bg-surface p-3">
      <span className="text-lg" aria-hidden="true">
        {SPORT_ICON[suggestion.sport]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          Alternative: {suggestion.title}
          <span className="ml-1.5 text-xs text-ink-faint">{suggestion.minutes} min</span>
        </p>
        <p className="mt-0.5 truncate text-[11px] text-ink-faint">{suggestion.reasons[0]}</p>
      </div>
      <Button size="sm" onClick={onAccept}>
        Übernehmen
      </Button>
    </div>
  );
}
