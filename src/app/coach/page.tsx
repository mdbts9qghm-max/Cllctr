'use client';

/**
 * Der Coach.
 *
 * Feste Fragen, echte Antworten. Kein Chatfenster — ein Eingabefeld würde ein
 * Sprachmodell versprechen, das es hier nicht gibt, und jede Frage außerhalb
 * der Liste mit einer Ausrede beantworten.
 */

import Link from 'next/link';
import { useState } from 'react';
import { today } from '@/lib/dates';
import {
  useCheckIns,
  useGoals,
  useHabitEntries,
  useHabits,
  usePhases,
  useProfile,
  useSessions,
  useSettings,
  useShiftContext,
} from '@/lib/hooks';
import { COACH_QUESTIONS, answer, type CoachAnswer } from '@/lib/coach';
import { buildBaseline, estimateRecovery } from '@/lib/recovery';
import { resolveDay } from '@/lib/shifts';
import { Card, Loading, Section } from '@/components/ui';

export default function CoachPage() {
  const todayIso = today();
  const [answers, setAnswers] = useState<CoachAnswer[]>([]);

  const settings = useSettings();
  const profile = useProfile();
  const ctx = useShiftContext();
  const sessions = useSessions();
  const phases = usePhases();
  const checkIns = useCheckIns();
  const habits = useHabits();
  const habitEntries = useHabitEntries();
  const goals = useGoals();

  if (
    !settings || !profile || !ctx || !sessions || !phases ||
    !checkIns || !habits || !habitEntries || !goals
  ) {
    return <Loading />;
  }

  // Nach der Prüfung oben sind alle Werte da. In der Closure unten weiß
  // TypeScript das nicht mehr, deshalb hier festhalten.
  const data = { sessions, habits, habitEntries, checkIns, phases, goals, ctx, settings, profile };

  const day = resolveDay(todayIso, ctx);
  const recovery = estimateRecovery(
    checkIns.find((c) => c.date === todayIso),
    buildBaseline(checkIns, todayIso),
    { afterNightShift: day.afterNightShift },
  ).status;

  const engine = {
    date: todayIso,
    shiftContext: ctx,
    sessions,
    settings,
    profile,
    phases,
    recovery,
  };

  function ask(id: string) {
    const result = answer(id, {
      engine,
      score: {
        sessions: data.sessions,
        habits: data.habits,
        habitEntries: data.habitEntries,
        checkIns: data.checkIns,
        phases: data.phases,
        settings: data.settings,
        reference: todayIso,
      },
      review: {
        anyDayOfWeek: todayIso,
        sessions: data.sessions,
        habits: data.habits,
        habitEntries: data.habitEntries,
        checkIns: data.checkIns,
        phases: data.phases,
        settings: data.settings,
        shiftContext: data.ctx,
      },
      goals: data.goals,
    });
    setAnswers((prev) => [result, ...prev].slice(0, 8));
  }

  return (
    <>
      <Link href="/profil" className="mb-5 inline-block text-xs text-ink-faint hover:text-ink">
        ‹ Profil
      </Link>

      <Section
        title="Coach"
        hint="Rechnet mit deinen gespeicherten Daten. Kein Sprachmodell, keine Verbindung nach außen — deshalb eine feste Auswahl an Fragen, die dafür verlässlich beantwortet werden."
      >
        <div className="flex flex-wrap gap-2">
          {COACH_QUESTIONS.map((q) => (
            <button
              key={q.id}
              onClick={() => ask(q.id)}
              className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-sm text-ink transition-colors hover:border-[color:var(--color-accent)]"
            >
              {q.question}
            </button>
          ))}
        </div>
      </Section>

      {answers.length > 0 ? (
        <Section title="Antworten">
          <div className="space-y-2">
            {answers.map((a, i) => (
              <Card key={i} tone={i === 0 ? 'accent' : 'default'}>
                <p className="text-[11px] uppercase tracking-wider text-ink-faint">{a.question}</p>
                <p className="mt-1.5 text-base font-semibold leading-snug text-ink">{a.headline}</p>
                {a.details.length > 0 ? (
                  <ul className="mt-2.5 space-y-1">
                    {a.details.map((d, j) => (
                      <li key={j} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
                        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[color:var(--color-accent)]" />
                        {d}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
