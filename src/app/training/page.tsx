'use client';

/**
 * Training — Wochenansicht und Planung.
 *
 * Die Woche ist die richtige Einheit: Kürzer sieht man die Verteilung nicht,
 * länger passt sie nicht mehr auf ein Telefon. Jeder Tag zeigt Schicht,
 * Training und Erholung — die drei Dinge, aus denen die Empfehlung entsteht.
 */

import { useState } from 'react';
import {
  addDays,
  formatDuration,
  formatShort,
  isoWeek,
  num,
  startOfWeek,
  today,
  weekdayShort,
} from '@/lib/dates';
import {
  useCheckIns,
  useExercises,
  usePhases,
  useProfile,
  useSessions,
  useSettings,
  useShiftContext,
} from '@/lib/hooks';
import { planDay } from '@/lib/engine';
import { minutesOf, summarize } from '@/lib/load';
import { activePhase } from '@/lib/phases';
import { buildBaseline, estimateRecovery } from '@/lib/recovery';
import { dayAllowance, resolveRange } from '@/lib/shifts';
import { addSession } from '@/lib/store';
import { PHASE_LABEL, PHASE_PURPOSE, SPORT_ICON, SPORT_LABEL, type TrainingSession } from '@/lib/types';
import { SessionSheet } from '@/components/SessionSheet';
import { RECOVERY_TONE } from '@/components/CheckInSheet';
import { Bar, Button, Card, Chip, Dot, Empty, Loading, Section, Stat } from '@/components/ui';

export default function TrainingPage() {
  const todayIso = today();
  const [weekOffset, setWeekOffset] = useState(0);
  const [editing, setEditing] = useState<{ date: string; session: TrainingSession | null } | null>(
    null,
  );

  const settings = useSettings();
  const profile = useProfile();
  const ctx = useShiftContext();
  const sessions = useSessions();
  const phases = usePhases();
  const checkIns = useCheckIns();
  const exercises = useExercises();

  if (!settings || !profile || !ctx || !sessions || !phases || !checkIns || !exercises) {
    return <Loading />;
  }

  const weekStart = addDays(startOfWeek(todayIso), weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);
  const days = resolveRange(weekStart, weekEnd, ctx);
  const phase = activePhase(phases, settings, weekStart);

  const weekSessions = sessions.filter((s) => s.date >= weekStart && s.date <= weekEnd);
  const done = summarize(weekSessions.filter((s) => s.status === 'done'));
  const planned = summarize(weekSessions.filter((s) => s.status !== 'skipped'));

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w - 1)}>
          ‹ Woche
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold text-ink">KW {isoWeek(weekStart)}</p>
          <p className="text-[11px] text-ink-faint">
            {formatShort(weekStart)} – {formatShort(weekEnd)}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w + 1)}>
          Woche ›
        </Button>
      </div>

      <Section title="Wochenbilanz">
        <Card>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat
              label="Erledigt"
              value={formatDuration(done.minutes)}
              sub={`geplant ${formatDuration(planned.minutes)}`}
              tone={done.minutes >= phase.weeklyMinutesTarget * 0.9 ? 'good' : 'neutral'}
            />
            <Stat label="Ziel" value={formatDuration(phase.weeklyMinutesTarget)} sub={PHASE_LABEL[phase.kind]} />
            <Stat
              label="Hart"
              value={`${planned.hardSessions}/${phase.hardPerWeek}`}
              tone={planned.hardSessions > phase.hardPerWeek ? 'warn' : 'neutral'}
            />
            <Stat label="Tage" value={`${done.activeDays}/${settings.weeklyDaysTarget}`} />
          </div>
          <Bar
            className="mt-4"
            ratio={done.minutes / Math.max(1, phase.weeklyMinutesTarget)}
            tone="accent"
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(Object.entries(planned.km) as Array<[string, number]>).map(([sport, km]) => (
              <Chip key={sport}>
                {SPORT_LABEL[sport as keyof typeof SPORT_LABEL]} {num(km)} km
              </Chip>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Die Woche">
        <div className="space-y-2">
          {days.map((day) => {
            const entry = checkIns.find((c) => c.date === day.date);
            const estimate = estimateRecovery(entry, buildBaseline(checkIns, day.date), {
              afterNightShift: day.afterNightShift,
            });
            const allowance = dayAllowance(day, estimate.status);
            const own = sessions.filter((s) => s.date === day.date && s.status !== 'skipped');
            const isToday = day.date === todayIso;

            return (
              <div
                key={day.date}
                className={`rounded-[14px] border p-3 ${
                  isToday ? 'border-[color:var(--color-accent)]/60 bg-surface' : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 shrink-0 text-center">
                    <span className="block text-[11px] text-ink-faint">
                      {weekdayShort(day.date)}
                    </span>
                    <span className="block text-sm font-semibold tabular text-ink">
                      {day.date.slice(8)}
                    </span>
                  </span>
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-black"
                    style={{ backgroundColor: day.shift.color }}
                    title={day.shift.name}
                  >
                    {day.shift.short}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{day.shift.name}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {allowance.cap === null
                        ? 'Ruhetag'
                        : `bis ${allowance.cap === 'hard' ? 'hart' : allowance.cap === 'moderate' ? 'moderat' : 'locker'}`}
                      {entry ? ` · ${estimate.percent} %` : ''}
                    </span>
                  </span>
                  <Dot tone={RECOVERY_TONE[estimate.status]} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing({ date: day.date, session: null })}
                  >
                    +
                  </Button>
                </div>

                {own.length > 0 ? (
                  <div className="mt-2 space-y-1.5 pl-11">
                    {own.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setEditing({ date: day.date, session: s })}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span aria-hidden="true">{SPORT_ICON[s.sport]}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.title}</span>
                        <span className="shrink-0 text-[11px] tabular text-ink-faint">
                          {minutesOf(s) > 0 ? formatDuration(minutesOf(s)) : '–'}
                        </span>
                        <Chip tone={s.status === 'done' ? 'good' : 'neutral'}>
                          {s.status === 'done' ? '✓' : '·'}
                        </Chip>
                      </button>
                    ))}
                  </div>
                ) : allowance.cap !== null && day.date >= todayIso ? (
                  <SuggestLine
                    date={day.date}
                    shiftContext={ctx}
                    sessions={sessions}
                    settings={settings}
                    profile={profile}
                    phases={phases}
                    recovery={estimate.status}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Phase">
        {phase.phase ? (
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-ink">
                {PHASE_LABEL[phase.kind]}
                {phase.week ? ` · Woche ${phase.week}${phase.totalWeeks ? ` von ${phase.totalWeeks}` : ''}` : ''}
              </p>
              <span className="text-[11px] text-ink-faint">
                bis {formatShort(phase.phase.endDate)}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              {phase.phase.focus || PHASE_PURPOSE[phase.kind]}
            </p>
            <p className="mt-2 text-[11px] text-ink-faint">
              {phase.hardPerWeek} harte Einheiten und {phase.strengthPerWeek}× Kraft pro Woche,
              Ziel {formatDuration(phase.weeklyMinutesTarget)}.
            </p>
          </Card>
        ) : (
          <Empty title="Keine Phase für diese Woche">
            Unter Profil → Trainingsphasen lässt sich eine anlegen.
          </Empty>
        )}
      </Section>

      {editing ? (
        <SessionSheet
          date={editing.date}
          session={editing.session}
          exercises={exercises}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Was die Engine für diesen Tag vorschlägt — einzeilig, mit einem Griff
 * übernehmbar. Ohne diese Zeile müsste man für jeden Tag auf „Heute" wechseln.
 */
function SuggestLine(props: Parameters<typeof planDay>[0]) {
  const [busy, setBusy] = useState(false);
  const plan = planDay(props);
  if (!plan.primary) return null;

  return (
    <div className="mt-2 flex items-center gap-2 pl-11">
      <span className="text-sm opacity-50" aria-hidden="true">
        {SPORT_ICON[plan.primary.sport]}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
        Vorschlag: {plan.primary.title} · {plan.primary.minutes} min
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void addSession({
            date: props.date,
            sport: plan.primary!.sport,
            title: plan.primary!.title,
            intensity: plan.primary!.intensity,
            zone: plan.primary!.zone,
            purpose: plan.primary!.purpose,
            plannedMinutes: plan.primary!.minutes,
            source: 'suggestion',
          }).finally(() => setBusy(false));
        }}
      >
        Übernehmen
      </Button>
    </div>
  );
}
