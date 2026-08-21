'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort, today, weekdayShort } from '@/lib/dates';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { resolveShiftDay } from '@/lib/shifts';
import {
  applyRescheduleProposal,
  buildRescheduleProposal,
  clearActivePlan,
  createAndSavePlan,
  markSessionDone,
  markSessionMissed,
  resetSessionStatus,
  toggleSessionLock,
} from '@/lib/plan-store';
import type { ReschedulePlan } from '@/lib/replan';
import { SESSION_STATUS_LABEL, type Session } from '@/lib/types';
import { Button, Card, Notice, Section } from '@/components/ui';

const MESOCYCLE_COUNT = 3;

export default function PlanPage() {
  const ctx = useShiftContext();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ReschedulePlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const plan = useLiveQuery(async () => {
    const macro = (await db.macrocycles.toArray()).find((m) => m.active);
    if (!macro) return null;
    const mesos = await db.mesocycles.where('macrocycleId').equals(macro.id).toArray();
    const micros = await db.microcycles.toArray();
    const sessions = await db.sessions.toArray();
    return {
      macro,
      mesos: mesos.sort((a, b) => a.index - b.index),
      micros: micros.sort((a, b) => a.startDate.localeCompare(b.startDate)),
      sessions,
    };
  }, []);

  if (!ctx || !settings || plan === undefined) {
    return <p className="text-sm text-ink-faint">Lade …</p>;
  }

  async function generate() {
    if (!ctx || !settings) return;
    setBusy(true);
    try {
      const result = await createAndSavePlan({
        startDate: today(),
        ctx,
        settings,
        mesocycleCount: MESOCYCLE_COUNT,
      });
      const parts = [
        `Plan erzeugt: ${result.sessions.length} Einheiten über ${result.microcycles.length} Zyklen.`,
      ];
      if (result.doubleDays.length > 0) {
        const n = result.doubleDays.length;
        parts.push(
          `${n} ${n === 1 ? 'Doppeltag' : 'Doppeltage'} nötig — dort liegen Laufen und Kraft am selben freien Tag.`,
        );
      }
      if (result.unplaced.length > 0) {
        const n = result.unplaced.length;
        parts.push(
          n === 1
            ? 'Eine Einheit fand keinen Tag; die Rotation gibt in diesem Zyklus nicht mehr her.'
            : `${n} Einheiten fanden keinen Tag; die Rotation gibt in diesen Zyklen nicht mehr her.`,
        );
      }
      setMessage(parts.join(' '));
    } finally {
      setBusy(false);
    }
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
    setOpenId(null);
  }

  if (!plan) {
    return (
      <>
        {message ? (
          <div className="mb-6">
            <Notice tone="ok">{message}</Notice>
          </div>
        ) : null}
        <Section
          title="Noch kein Plan"
          hint="Cllctr baut den Plan aus deiner Schichtrotation. Ein Mikrozyklus ist ein voller Rotationsdurchlauf, kein Kalenderwoche — nur so ist jeder Zyklus gleich aufgebaut."
        >
          <Card>
            <p className="mb-4 text-sm leading-relaxed text-ink-muted">
              Erzeugt {MESOCYCLE_COUNT} Blöcke à {settings.mesoLoadCycles} Belastungs- und{' '}
              {settings.mesoDeloadCycles} Deload-Zyklus, beginnend heute.
            </p>
            <Button variant="primary" onClick={() => void generate()} disabled={busy}>
              {busy ? 'Erzeuge …' : 'Plan erzeugen'}
            </Button>
          </Card>
        </Section>
      </>
    );
  }

  const sessionsByMicro = new Map<string, Session[]>();
  for (const s of plan.sessions) {
    const list = sessionsByMicro.get(s.microcycleId) ?? [];
    list.push(s);
    sessionsByMicro.set(s.microcycleId, list);
  }

  const todayIso = today();
  const activeMicroIndex = plan.micros.findIndex(
    (m) => m.startDate <= todayIso && m.endDate >= todayIso,
  );
  const activeMicro = activeMicroIndex >= 0 ? plan.micros[activeMicroIndex] : null;
  const cyclesPerMeso = settings.mesoLoadCycles + settings.mesoDeloadCycles;
  const cyclesToDeload = activeMicro
    ? settings.mesoLoadCycles - activeMicro.index + (activeMicro.isDeload ? cyclesPerMeso : 0)
    : 0;

  return (
    <>
      {message ? (
        <div className="mb-6">
          <Notice tone="ok">{message}</Notice>
        </div>
      ) : null}

      {proposal ? (
        <div className="mb-6">
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

      {activeMicro ? (
        <Section title="Stand im Block">
          <Card>
            <p className="text-sm text-ink">
              Zyklus {activeMicro.index} von {cyclesPerMeso}
              {activeMicro.isDeload ? ' — Deload läuft' : ''}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">
              {activeMicro.lengthDays} Tage, geplante Last {activeMicro.plannedLoad}.{' '}
              {activeMicro.isDeload
                ? 'Danach beginnt der nächste Block.'
                : `Deload in ${Math.max(0, cyclesToDeload)} ${cyclesToDeload === 1 ? 'Zyklus' : 'Zyklen'}.`}
            </p>
          </Card>
        </Section>
      ) : null}

      <Section
        title="Plan"
        hint="Ein Zyklus ist ein Durchlauf deiner Rotation. Tippe eine Einheit an für Inhalt und Aktionen."
      >
        <div className="space-y-5">
          {plan.micros.map((micro, i) => {
            // An einem Doppeltag steht die Laufeinheit oben: mit frischen Beinen
            // läuft es sich besser.
            const list = (sessionsByMicro.get(micro.id) ?? []).sort(
              (a, b) =>
                a.date.localeCompare(b.date) ||
                (a.discipline === 'run' ? 0 : 1) - (b.discipline === 'run' ? 0 : 1),
            );
            const doubleDates = new Set(
              list
                .map((s) => s.date)
                .filter((d, i, all) => all.indexOf(d) !== i),
            );
            const isActive = micro.id === activeMicro?.id;

            return (
              <div key={micro.id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className={`text-sm font-medium ${isActive ? 'text-ember' : 'text-ink'}`}>
                    Zyklus {i + 1}
                    {micro.isDeload ? ' · Deload' : ''}
                  </h3>
                  <span className="text-[11px] text-ink-faint tabular">
                    {formatShort(micro.startDate)} – {formatShort(micro.endDate)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {list.length === 0 ? (
                    <p className="text-xs text-ink-faint">Keine Einheiten in diesem Zyklus.</p>
                  ) : null}

                  {list.map((session, si) => {
                    const day = resolveShiftDay(session.date, ctx);
                    const open = openId === session.id;
                    const dimmed = session.status === 'skipped' || session.status === 'missed';
                    const isDouble = doubleDates.has(session.date);
                    const isSecond = si > 0 && list[si - 1].date === session.date;

                    return (
                      <div key={session.id}>
                        <button
                          onClick={() => setOpenId(open ? null : session.id)}
                          className={`flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left transition-colors ${
                            session.date === todayIso
                              ? 'border-ember bg-surface'
                              : 'border-line bg-surface hover:border-line-strong'
                          } ${dimmed ? 'opacity-45' : ''}`}
                        >
                          <span
                            className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-void"
                            style={{ backgroundColor: day.shiftType.color }}
                          >
                            {day.shiftType.short}
                          </span>
                          <span className="w-16 shrink-0 text-xs text-ink-muted tabular">
                            {isSecond ? (
                              <span className="text-ember">↳ dazu</span>
                            ) : (
                              <>
                                {weekdayShort(session.date)} {session.date.slice(8)}.
                                {session.date.slice(5, 7)}.
                              </>
                            )}
                          </span>
                          <span className="flex-1 truncate text-sm text-ink">
                            {session.title}
                            {session.isKey ? <span className="text-ember"> ▪</span> : null}
                            {isDouble && !isSecond ? (
                              <span className="ml-1 text-[10px] uppercase tracking-wider text-ember">
                                Doppeltag
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-faint tabular">
                            {session.plannedDurationMin} Min
                          </span>
                        </button>

                        {open ? (
                          <div className="mt-1 rounded border border-line-strong bg-surface-2 p-3">
                            <p className="mb-2 text-xs text-ink-faint">
                              {day.shiftType.name}
                              {day.shiftType.trainingWindow ? ` · ${day.shiftType.trainingWindow}` : ''}
                              {session.zone ? ` · Zone ${session.zone}` : ''}
                              {session.targetRpe ? ` · RPE ${session.targetRpe}` : ''} ·{' '}
                              {SESSION_STATUS_LABEL[session.status]}
                            </p>

                            <ul className="mb-3 space-y-1">
                              {session.content.map((block, bi) => (
                                <li key={bi} className="text-sm leading-relaxed text-ink">
                                  <span className="text-ink-muted">{block.label}:</span> {block.detail}
                                </li>
                              ))}
                            </ul>

                            {session.rescheduleReason ? (
                              <p className="mb-3 rounded border border-line bg-surface p-2 text-xs leading-relaxed text-ink-muted">
                                {session.rescheduleReason}
                              </p>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                              {session.status === 'planned' ? (
                                <>
                                  <Button variant="primary" onClick={() => void markSessionDone(session.id)}>
                                    Erledigt
                                  </Button>
                                  <Button onClick={() => void handleMissed(session)}>Verpasst</Button>
                                </>
                              ) : (
                                <Button onClick={() => void resetSessionStatus(session.id)}>
                                  Zurück auf geplant
                                </Button>
                              )}
                              <Button
                                onClick={() => void toggleSessionLock(session.id, !session.locked)}
                              >
                                {session.locked ? 'Fixierung lösen' : 'Fixieren'}
                              </Button>
                            </div>

                            {session.locked ? (
                              <p className="mt-2 text-xs text-ember">
                                Fixiert — der Umplaner verschiebt diese Einheit nicht.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Plan verwerfen" hint="Löscht alle geplanten Einheiten. Protokollierte bleiben erhalten.">
        <Card>
          <Button
            variant="danger"
            onClick={async () => {
              await clearActivePlan();
              setMessage('Plan gelöscht.');
            }}
          >
            Plan löschen
          </Button>
        </Card>
      </Section>
    </>
  );
}
