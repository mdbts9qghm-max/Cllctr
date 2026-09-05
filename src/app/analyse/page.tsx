'use client';

/**
 * Analyse: Hybrid Score, Volumen, Bestwerte, Ziele, Wochenrückblick.
 *
 * Der Score steht oben und ist aufklappbar — eine Zahl ohne Erklärung wäre
 * genau das, was diese App nicht sein soll.
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  addDays,
  formatClock,
  formatDuration,
  formatShort,
  isoWeek,
  num,
  startOfWeek,
  today,
} from '@/lib/dates';
import {
  useCheckIns,
  useExercises,
  useGoals,
  useHabitEntries,
  useHabits,
  usePhases,
  useRecords,
  useSessions,
  useSettings,
  useShiftContext,
} from '@/lib/hooks';
import { hybridScore, scoreTone } from '@/lib/score';
import { inRange, summarize } from '@/lib/load';
import { reviewWeek } from '@/lib/review';
import {
  RECORD_LABEL,
  SPORT_LABEL,
  type PersonalRecord,
  type Sport,
} from '@/lib/types';
import { ScoreBars, TrendChart, WeeklyVolumeChart } from '@/components/Charts';
import { Bar, Card, Chip, Empty, Loading, Section, Segmented, Stat } from '@/components/ui';

type Range = 7 | 28 | 90;

export default function AnalysePage() {
  const todayIso = today();
  const [range, setRange] = useState<Range>(28);
  const [openScore, setOpenScore] = useState(false);

  const settings = useSettings();
  const sessions = useSessions();
  const habits = useHabits();
  const habitEntries = useHabitEntries();
  const checkIns = useCheckIns();
  const phases = usePhases();
  const goals = useGoals();
  const records = useRecords();
  const exercises = useExercises();
  const ctx = useShiftContext();

  if (
    !settings || !sessions || !habits || !habitEntries || !checkIns ||
    !phases || !goals || !records || !exercises || !ctx
  ) {
    return <Loading />;
  }

  const score = hybridScore({
    sessions,
    habits,
    habitEntries,
    checkIns,
    phases,
    settings,
    reference: todayIso,
  });

  const from = addDays(todayIso, -(range - 1));
  const period = summarize(inRange(sessions, from, todayIso).filter((s) => s.status === 'done'));

  /* Wochenbalken über zwölf Wochen — genug für einen Trend, wenig genug fürs Telefon. */
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = addDays(startOfWeek(todayIso), (i - 11) * 7);
    const s = summarize(
      inRange(sessions, start, addDays(start, 6)).filter((x) => x.status === 'done'),
    );
    return { label: `${isoWeek(start)}`, minutes: s.minutes, target: settings.weeklyMinutesTarget };
  });

  const sleepTrend = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(todayIso, i - 13);
    const entry = checkIns.find((c) => c.date === date);
    return { label: date.slice(8), value: entry?.sleepHours ?? 0 };
  });

  const review = reviewWeek({
    anyDayOfWeek: addDays(startOfWeek(todayIso), -1),
    sessions,
    habits,
    habitEntries,
    checkIns,
    phases,
    settings,
    shiftContext: ctx,
  });

  const exerciseName = (id: string | null) =>
    id ? (exercises.find((e) => e.id === id)?.name ?? 'Übung') : '';

  return (
    <>
      {/* ---- Hybrid Score ------------------------------------------ */}
      <Section title="Hybrid Score">
        <Card tone="accent">
          <button
            onClick={() => setOpenScore((v) => !v)}
            className="flex w-full items-end justify-between gap-4 text-left"
          >
            <div>
              <p className="text-5xl font-bold leading-none tabular text-ink">
                {score.total}
                <span className="ml-1 text-lg font-normal text-ink-faint">/ 100</span>
              </p>
              <p className="mt-2 text-xs text-ink-faint">
                {score.previous === null
                  ? 'Noch kein Vergleichswert'
                  : score.total === score.previous
                    ? 'Unverändert zur Vorwoche'
                    : `${score.total > score.previous ? '+' : ''}${score.total - score.previous} zur Vorwoche`}
              </p>
            </div>
            <span className="text-[11px] text-ink-faint">{openScore ? 'weniger' : 'warum?'}</span>
          </button>

          <div className="mt-5">
            <ScoreBars parts={score.parts.map((p) => ({ label: p.label, value: p.value }))} />
          </div>

          {openScore ? (
            <div className="mt-5 space-y-3 border-t border-line pt-4">
              {score.parts.map((p) => (
                <div key={p.key}>
                  <p className="text-sm font-medium text-ink">
                    {p.label} <span className="tabular text-ink-faint">{p.value}</span>
                    <span className="ml-1.5 text-[11px] text-ink-faint">
                      zählt {p.weight} %
                    </span>
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {p.reasons.map((r, i) => (
                      <li key={i} className="text-xs leading-relaxed text-ink-muted">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="pt-1 text-[11px] leading-relaxed text-ink-faint">
                Der Gesamtwert ist der gewichtete Schnitt dieser sechs. Alles rechnet über die
                letzten vier Wochen, die Erholung über vierzehn Tage.
              </p>
            </div>
          ) : null}
        </Card>
      </Section>

      {/* ---- Volumen ----------------------------------------------- */}
      <Section
        title="Umfang"
        action={
          <Segmented
            size="sm"
            value={String(range) as '7' | '28' | '90'}
            onChange={(v) => setRange(Number(v) as Range)}
            options={[
              { value: '7', label: '7 T' },
              { value: '28', label: '4 W' },
              { value: '90', label: '3 M' },
            ]}
          />
        }
      >
        <Card>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Zeit" value={formatDuration(period.minutes)} />
            <Stat label="Einheiten" value={period.sessions} sub={`${period.activeDays} Tage`} />
            <Stat label="Load" value={period.load} />
            <Stat label="Hart" value={period.hardSessions} />
          </div>

          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {(Object.keys(SPORT_LABEL) as Sport[])
              .filter((s) => (period.minutesBySport[s] ?? 0) > 0)
              .sort((a, b) => (period.minutesBySport[b] ?? 0) - (period.minutesBySport[a] ?? 0))
              .map((sport) => {
                const minutes = period.minutesBySport[sport] ?? 0;
                const km = period.km[sport];
                return (
                  <div key={sport} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-xs text-ink-muted">
                      {SPORT_LABEL[sport]}
                    </span>
                    <Bar
                      className="flex-1"
                      ratio={minutes / Math.max(1, period.minutes)}
                      tone="accent"
                    />
                    <span className="w-24 shrink-0 text-right text-[11px] tabular text-ink-faint">
                      {formatDuration(minutes)}
                      {km ? ` · ${num(km)} km` : ''}
                    </span>
                  </div>
                );
              })}
            {period.sessions === 0 ? (
              <p className="text-sm text-ink-faint">
                In diesem Zeitraum ist nichts protokolliert.
              </p>
            ) : null}
          </div>
        </Card>
      </Section>

      <Section title="Wochenumfang, 12 Wochen">
        <Card>
          <WeeklyVolumeChart data={weeks} />
          <p className="mt-2 text-[11px] text-ink-faint">
            Balken in Akzentfarbe: Wochenziel von {formatDuration(settings.weeklyMinutesTarget)}{' '}
            erreicht.
          </p>
        </Card>
      </Section>

      <Section title="Schlaf, 14 Tage">
        <Card>
          <TrendChart data={sleepTrend} unit=" h" />
        </Card>
      </Section>

      {/* ---- Wochenrückblick --------------------------------------- */}
      <Section title={`Rückblick KW ${isoWeek(review.numbers.weekStart)}`}>
        <Card>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Training" value={formatDuration(review.numbers.totalMinutes)} />
            <Stat label="Einheiten" value={review.numbers.sessions} />
            <Stat label="Habits" value={review.numbers.habitPct} unit="%" />
            <Stat
              label="Schlaf Ø"
              value={review.numbers.avgSleepHours !== null ? num(review.numbers.avgSleepHours) : '–'}
              unit={review.numbers.avgSleepHours !== null ? 'h' : ''}
            />
          </div>

          {review.text.wentWell.length > 0 ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-good)]">
                Lief gut
              </p>
              <ul className="mt-1.5 space-y-1">
                {review.text.wentWell.map((t, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-muted">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {review.text.improve.length > 0 ? (
            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-ok)]">
                Besser machen
              </p>
              <ul className="mt-1.5 space-y-1">
                {review.text.improve.map((t, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-muted">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-accent)]">
              Nächste Woche
            </p>
            <ul className="mt-1.5 space-y-1">
              {review.text.nextWeek.map((t, i) => (
                <li key={i} className="text-sm leading-relaxed text-ink-muted">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </Section>

      {/* ---- Ziele ------------------------------------------------- */}
      <Section
        title="Ziele"
        action={
          <Link href="/profil/ziele" className="text-[11px] text-ink-faint hover:text-ink">
            bearbeiten ›
          </Link>
        }
      >
        {goals.filter((g) => g.active).length === 0 ? (
          <Empty title="Keine Ziele">Unter Profil → Ziele lassen sich welche anlegen.</Empty>
        ) : (
          <div className="space-y-2">
            {goals
              .filter((g) => g.active)
              .map((goal) => {
                const span = goal.targetValue - goal.startValue;
                const moved = goal.currentValue - goal.startValue;
                const ratio = span === 0 ? 1 : Math.max(0, Math.min(1, moved / span));
                const fmt = (v: number) =>
                  goal.unit === 's' ? formatClock(v) : `${num(v)} ${goal.unit}`;
                return (
                  <Card key={goal.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink">{goal.title}</p>
                      <span className="shrink-0 text-[11px] tabular text-ink-faint">
                        {fmt(goal.currentValue)} → {fmt(goal.targetValue)}
                      </span>
                    </div>
                    <Bar className="mt-2" ratio={ratio} tone={ratio >= 1 ? 'good' : 'accent'} />
                    {goal.targetDate ? (
                      <p className="mt-1.5 text-[11px] text-ink-faint">
                        bis {formatShort(goal.targetDate)}
                      </p>
                    ) : null}
                  </Card>
                );
              })}
          </div>
        )}
      </Section>

      {/* ---- Bestwerte --------------------------------------------- */}
      <Section title="Bestwerte" hint="Erkennt die App selbst aus deinen Einheiten.">
        {records.length === 0 ? (
          <Empty title="Noch keine Bestwerte">
            Trag bei einer Einheit Distanz und Zeit ein, dann entsteht der Rest von selbst.
          </Empty>
        ) : (
          <Card>
            <div className="space-y-2">
              {[...records]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((r) => (
                  <div key={r.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {RECORD_LABEL[r.kind]}
                      {r.exerciseId ? ` · ${exerciseName(r.exerciseId)}` : ''}
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular text-ink">
                      {formatRecord(r)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] tabular text-ink-faint">
                      {formatShort(r.date)}
                    </span>
                  </div>
                ))}
            </div>
          </Card>
        )}
      </Section>

      <Section title="Coach">
        <Link href="/coach">
          <Card>
            <p className="text-sm font-medium text-ink">Fragen zu deinen Daten stellen</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              Was heute trainieren, warum der Score steht, wo er steht, wie es Richtung Ultra
              läuft. Antworten aus deinen echten Zahlen.
            </p>
            <Chip>öffnen ›</Chip>
          </Card>
        </Link>
      </Section>
    </>
  );
}

function formatRecord(r: PersonalRecord): string {
  if (r.unit === 's') return formatClock(r.value);
  if (r.unit === 'min') return formatDuration(r.value);
  return `${num(r.value)} ${r.unit}`;
}
