'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { addDays, formatShort, today, weekdayShort } from '@/lib/dates';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { capacityAllows, capacityExplanation, resolveShiftDay, resolveShiftRange } from '@/lib/shifts';
import { blockStatus, explainRestDay, explainSession } from '@/lib/explain';
import { applyRescheduleProposal, buildRescheduleProposal, markSessionMissed } from '@/lib/plan-store';
import { appointmentsOn, suggestTasks, taskEnergyBudget, tasksBlockedByEnergy } from '@/lib/tasks';
import { completeTask } from '@/lib/task-store';
import { getSoulsInReach } from '@/lib/soul-store';
import type { ReschedulePlan } from '@/lib/replan';
import { CAPACITY_LABEL, TASK_ENERGY_LABEL, type Session, type Task } from '@/lib/types';
import { Button, CapacityBadge, Card, Mark, Notice, Section } from '@/components/ui';
import { SessionCard } from '@/components/SessionCard';

/** Tage in der Vorschau "Als Nächstes". */
const LOOKAHEAD_DAYS = 4;

export default function HeutePage() {
  const ctx = useShiftContext();
  const settings = useSettings();
  const [proposal, setProposal] = useState<ReschedulePlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const todayIso = today();

  const data = useLiveQuery(async () => {
    const sessions = await db.sessions
      .where('date')
      .between(addDays(todayIso, -1), addDays(todayIso, LOOKAHEAD_DAYS), true, true)
      .toArray();
    const micros = await db.microcycles.toArray();
    const hasPlan = (await db.macrocycles.count()) > 0;
    const tasks = await db.tasks.where('status').equals('open').toArray();
    const souls = await db.souls.orderBy('collectedAt').reverse().limit(3).toArray();
    return { sessions, micros, hasPlan, tasks, souls };
  }, [todayIso]);

  // Nur lesend: Die Auswertung selbst läuft beim App-Start und nach jedem
  // Protokoll — ein Schreibzugriff in einem LiveQuery würde die Seite abstürzen
  // lassen.
  const inReach = useLiveQuery(() => getSoulsInReach(3), [todayIso]);

  if (!ctx || !settings || !data) return <p className="text-sm text-ink-faint">Lade …</p>;

  const day = resolveShiftDay(todayIso, ctx);

  const active = (s: Session) => s.status === 'planned' || s.status === 'done';
  // An einem Doppeltag zuerst die Laufeinheit — mit frischen Beinen läuft es sich besser.
  const byRunFirst = (a: Session, b: Session) =>
    (a.discipline === 'run' ? 0 : 1) - (b.discipline === 'run' ? 0 : 1);

  const todaySessions = data.sessions.filter((s) => s.date === todayIso && active(s)).sort(byRunFirst);
  const yesterdaySessions = data.sessions.filter((s) => s.date === addDays(todayIso, -1) && active(s));
  const cancelledToday = data.sessions.filter(
    (s) => s.date === todayIso && (s.status === 'missed' || s.status === 'skipped'),
  );

  const micro = data.micros.find((m) => m.startDate <= todayIso && m.endDate >= todayIso) ?? null;
  const sessionsInCycle = micro
    ? data.sessions.filter((s) => s.microcycleId === micro.id)
    : [];

  const upcoming = data.sessions
    .filter((s) => s.date > todayIso && active(s))
    .sort((a, b) => a.date.localeCompare(b.date) || byRunFirst(a, b));

  const nextSession = upcoming[0] ?? null;

  /**
   * Passt die Einheit noch zu dem, was der Tag hergibt?
   *
   * Trägt man eine Schicht nachträglich ein — Tausch, Krankheit —, steht die
   * geplante Einheit plötzlich an einem Tag, der sie nicht mehr trägt. Ohne
   * diese Prüfung bliebe sie stumm stehen und man müsste selbst merken, dass
   * der Plan nicht mehr stimmt.
   */
  function fits(session: Session): boolean {
    return capacityAllows(day.capacity, session.type);
  }

  async function handleMissed(session: Session) {
    if (!ctx || !settings) return;
    const p = await buildRescheduleProposal(session, ctx, settings);
    if (settings.confirmRescheduleProposals) {
      setProposal(p);
    } else {
      await applyRescheduleProposal(p);
      setMessage(p.summary);
    }
  }

  const rest = explainRestDay(
    day,
    nextSession ? { session: nextSession, date: nextSession.date } : null,
    cancelledToday,
  );

  const budget = taskEnergyBudget(day, todaySessions);
  const todayAppointments: Task[] = appointmentsOn(data.tasks, todayIso);
  const suggested = suggestTasks(data.tasks, budget, todayIso);
  const blocked = tasksBlockedByEnergy(data.tasks, budget, todayIso);

  const status =
    micro && settings
      ? blockStatus(micro, sessionsInCycle, settings.mesoLoadCycles, settings.mesoDeloadCycles)
      : null;

  return (
    <>
      {/* 1 — Der Tag und was heute ansteht */}
      <section className="mb-8">
        {/* Datum, Schicht und Kapazität in einer Zeile: die eigene Karte dafür
            hat nur Platz gekostet, ohne mehr zu sagen. */}
        <Link
          href="/schicht"
          className="mb-4 flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-surface"
        >
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded text-xs font-bold text-void"
            style={{ backgroundColor: day.shiftType.color }}
          >
            {day.shiftType.short}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">
              {formatShort(todayIso)} · {day.shiftType.name}
            </span>
            <span className="block truncate text-[11px] text-ink-faint tabular">
              {/* An freien Tagen sagt das Zeitfenster dasselbe wie die Zeitangabe —
                  dann bleibt es weg. */}
              {day.shiftType.startTime && day.shiftType.endTime
                ? `${day.shiftType.startTime}–${day.shiftType.endTime}${
                    day.shiftType.trainingWindow ? ` · ${day.shiftType.trainingWindow}` : ''
                  }`
                : 'ganzer Tag frei'}
            </span>
          </span>
          <CapacityBadge capacity={day.capacity} label={CAPACITY_LABEL[day.capacity]} />
        </Link>

        {message ? (
          <div className="mb-3">
            <Notice tone="ok">{message}</Notice>
          </div>
        ) : null}

        {proposal ? (
          <div className="mb-3">
            <Card className="border-ember-dim">
              <p className="mb-1 text-[11px] uppercase tracking-widest text-ember">Vorschlag</p>
              <p className="mb-3 text-sm leading-relaxed text-ink">{proposal.summary}</p>
              <ul className="mb-4 space-y-1 text-xs text-ink-muted">
                {proposal.moves.map((m) => (
                  <li key={m.sessionId}>
                    {m.title}: {formatShort(m.fromDate)} → {formatShort(m.toDate)}
                    {m.newTitle ? ` (als ${m.newTitle})` : ''}
                  </li>
                ))}
                {proposal.drops.map((d) => (
                  <li key={d.sessionId} className="text-ink-faint">
                    {d.title} am {formatShort(d.date)} entfällt
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={async () => {
                    await applyRescheduleProposal(proposal);
                    setMessage(proposal.summary);
                    setProposal(null);
                  }}
                >
                  Übernehmen
                </Button>
                <Button
                  onClick={async () => {
                    await markSessionMissed(proposal.trigger.sessionId);
                    setProposal(null);
                    setMessage('Als verpasst markiert, Plan unverändert.');
                  }}
                >
                  Nur als verpasst markieren
                </Button>
                <Button onClick={() => setProposal(null)}>Abbrechen</Button>
              </div>
            </Card>
          </div>
        ) : null}

        {todaySessions.length > 0 ? (
          <div className="space-y-3">
            {todaySessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                explanation={explainSession(session, day, ctx, {
                  microcycle: micro,
                  sameDay: todaySessions,
                  previousDay: yesterdaySessions,
                })}
                onMissed={(s) => void handleMissed(s)}
                conflict={
                  fits(session)
                    ? null
                    : {
                        reason: `${day.shiftType.name} lässt das heute nicht mehr zu.`,
                        onReplan: () => void handleMissed(session),
                      }
                }
              />
            ))}
          </div>
        ) : data.hasPlan ? (
          <div className="rounded-xl border border-line bg-surface px-4 py-5">
            <p className="text-[10px] uppercase tracking-widest text-ink-faint">Heute</p>
            <p className="mt-1 text-2xl font-semibold text-ink">Ruhetag</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{rest.reason}</p>
            {rest.notes.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {rest.notes.map((note, i) => (
                  <li key={i} className="text-xs leading-relaxed text-ink-faint">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <Notice tone="warn">
            Noch kein Trainingsplan.{' '}
            <Link href="/plan" className="text-ember underline">
              Plan erzeugen
            </Link>{' '}
            — die App baut ihn aus deiner Schichtrotation.
          </Notice>
        )}

        {todaySessions.length === 0 && data.hasPlan ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            {capacityExplanation(day)}
          </p>
        ) : null}
      </section>

      {/* 2 — Aufgaben, passend zur Energie des Tages */}
      <Section title="Heute sinnvoll" hint={budget.reason}>
        {todayAppointments.length > 0 ? (
          <div className="mb-3 space-y-1.5">
            {todayAppointments.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded border border-ember-dim bg-ember/5 px-3 py-2.5"
              >
                <span className="w-12 shrink-0 text-xs text-ember tabular">
                  {task.time ?? 'Termin'}
                </span>
                <span className="flex-1 truncate text-sm text-ink">{task.title}</span>
                <button
                  onClick={() => void completeTask(task)}
                  aria-label="Abhaken"
                  className="size-5 shrink-0 rounded border border-line-strong hover:border-ember"
                />
              </div>
            ))}
          </div>
        ) : null}

        {suggested.length > 0 ? (
          <div className="space-y-1.5">
            {suggested.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded border border-line bg-surface px-3 py-2.5"
              >
                <button
                  onClick={() => void completeTask(task)}
                  aria-label="Abhaken"
                  className="size-5 shrink-0 rounded border border-line-strong transition-colors hover:border-ember"
                />
                <span className="flex-1 truncate text-sm text-ink">{task.title}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {TASK_ENERGY_LABEL[task.energy]}
                </span>
              </div>
            ))}
          </div>
        ) : data.tasks.length === 0 ? (
          <Notice tone="info">
            Noch keine Aufgaben.{' '}
            <Link href="/aufgaben" className="text-ember underline">
              Anlegen
            </Link>{' '}
            — die App schlägt dann nur vor, was zum Tag passt.
          </Notice>
        ) : (
          <Notice tone="info">
            Nichts, was heute sinnvoll wäre. Alles Offene braucht mehr Energie, als der Tag hergibt.
          </Notice>
        )}

        {blocked.length > 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            {blocked.length === 1
              ? `${blocked.length} Aufgabe wartet auf einen Tag mit mehr Luft.`
              : `${blocked.length} Aufgaben warten auf einen Tag mit mehr Luft.`}{' '}
            <Link href="/aufgaben" className="underline">
              Alle ansehen
            </Link>
          </p>
        ) : null}
      </Section>

      {/* 3 — Wo stehe ich im Block */}
      {status ? (
        <Section title="Stand im Block">
          <Card>
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-sm text-ink">
                Zyklus {status.cycleIndex} von {status.cyclesPerMeso}
                {status.isDeload ? ' · Deload' : ''}
              </p>
              <p className="text-xs text-ink-faint tabular">
                {status.doneInCycle} von {status.plannedInCycle} erledigt
              </p>
            </div>

            <div className="mb-3 flex gap-1">
              {Array.from({ length: status.cyclesPerMeso }, (_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i + 1 < status.cycleIndex
                      ? 'bg-ember-dim'
                      : i + 1 === status.cycleIndex
                        ? 'bg-ember'
                        : 'bg-line'
                  }`}
                />
              ))}
            </div>

            <p className="text-xs leading-relaxed text-ink-faint">{status.summary}</p>
          </Card>
        </Section>
      ) : null}

      {/* 4 — Was als Nächstes kommt */}
      {data.hasPlan ? (
        <Section title="Als Nächstes">
          <div className="space-y-1.5">
            {resolveShiftRange(addDays(todayIso, 1), addDays(todayIso, LOOKAHEAD_DAYS), ctx).map(
              (d) => {
                const onDay = upcoming.filter((s) => s.date === d.date);
                return (
                  <div
                    key={d.date}
                    className="flex items-center gap-3 rounded border border-line bg-surface px-3 py-2"
                  >
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-void"
                      style={{ backgroundColor: d.shiftType.color }}
                    >
                      {d.shiftType.short}
                    </span>
                    <span className="w-10 shrink-0 text-xs text-ink-muted tabular">
                      {weekdayShort(d.date)}
                    </span>
                    {/* An einem Doppeltag stehen zwei Titel in der Zeile — die
                        darf dann umbrechen statt abzuschneiden. */}
                    <span className="flex-1 text-sm leading-snug text-ink-muted">
                      {onDay.length > 0 ? onDay.map((s) => s.title).join(' + ') : 'Ruhetag'}
                    </span>
                    {onDay.some((s) => s.isKey) ? (
                      <Mark variant="solid" className="text-ember" />
                    ) : null}
                  </div>
                );
              },
            )}
          </div>
        </Section>
      ) : null}

      {/* 5 — Seelen: was gerade greifbar ist */}
      <Section title="Seelen in Reichweite">
        {inReach && inReach.length > 0 ? (
          <div className="space-y-2">
            {inReach.map((progress) => (
              <Link
                key={progress.definition.key}
                href="/seelen"
                className="block rounded border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong"
              >
                <div className="mb-1 flex items-baseline gap-2">
                  <Mark
                    variant={
                      progress.definition.rarity === 'legendary'
                        ? 'solid'
                        : progress.definition.rarity === 'rare'
                          ? 'half'
                          : 'outline'
                    }
                    className="text-ember-dim"
                  />
                  <span className="flex-1 truncate text-sm text-ink">{progress.definition.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint tabular">
                    {progress.current} / {progress.target} {progress.unit}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-ember-dim"
                    style={{ width: `${Math.min(100, progress.ratio * 100)}%` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        ) : data.souls.length > 0 ? (
          <div className="space-y-1.5">
            {data.souls.map((soul) => (
              <div
                key={soul.id}
                className="flex items-center gap-2 rounded border border-line bg-surface px-3 py-2"
              >
                <Mark
                  variant={
                    soul.rarity === 'legendary' ? 'solid' : soul.rarity === 'rare' ? 'half' : 'outline'
                  }
                  className="text-ember"
                />
                <span className="flex-1 truncate text-sm text-ink">{soul.name}</span>
                <span className="shrink-0 text-[11px] text-ink-faint tabular">
                  {formatShort(soul.collectedAt.slice(0, 10))}
                </span>
              </div>
            ))}
            <p className="pt-1 text-xs text-ink-faint">
              <Link href="/seelen" className="underline">
                Zum Soul Vault
              </Link>
            </p>
          </div>
        ) : (
          <Notice tone="info">
            Die erste Seele kommt mit der ersten protokollierten Einheit.{' '}
            <Link href="/seelen" className="text-ember underline">
              Ansehen, was es zu holen gibt
            </Link>
          </Notice>
        )}
      </Section>
    </>
  );
}
