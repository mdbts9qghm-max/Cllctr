'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort, today, weekdayShort } from '@/lib/dates';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { capacityAllows, capacityExplanation, resolveShiftDay, resolveShiftRange } from '@/lib/shifts';
import {
  applyRescheduleProposal,
  buildRescheduleProposal,
  cancelSession,
  clearActivePlan,
  currentProgressionLevels,
  deleteSession,
  MESOCYCLE_COUNT,
  setProgressionLevel,
  createAndSavePlan,
  markSessionMissed,
  resetSessionStatus,
  toggleSessionLock,
} from '@/lib/plan-store';
import { levelOf, PROGRESSING_TYPES, progresses, sessionForm } from '@/lib/progression';
import type { ReschedulePlan } from '@/lib/replan';
import { SESSION_STATUS_LABEL, SESSION_TYPES, type Session, type Soul } from '@/lib/types';
import { ShiftPicker } from '@/components/ShiftPicker';
import { Button, Card, Mark, Notice, Section } from '@/components/ui';
import { NewRecordsNotice, SessionLogForm } from '@/components/SessionLogForm';

export default function PlanPage() {
  const ctx = useShiftContext();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Ruhetage klappen für sich auf; Trainingstage zeigen den Schichtwechsel im
  // Detail der Einheit.
  const [openRestDay, setOpenRestDay] = useState<string | null>(null);
  const [shiftEditFor, setShiftEditFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openLevel, setOpenLevel] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [newRecords, setNewRecords] = useState<string[]>([]);
  const [newSouls, setNewSouls] = useState<Soul[]>([]);
  const [proposal, setProposal] = useState<ReschedulePlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const progressionLevels = useLiveQuery(() => currentProgressionLevels(), []);

  // Absichtlich nicht am aktiven Makrozyklus aufgehängt: nach dem Löschen des
  // Plans gibt es keinen mehr, der Verlauf soll aber sichtbar bleiben.
  const plan = useLiveQuery(async () => {
    const micros = await db.microcycles.toArray();
    const sessions = await db.sessions.toArray();
    if (micros.length === 0 && sessions.length === 0) return null;
    return {
      micros: micros.sort((a, b) => a.startDate.localeCompare(b.startDate)),
      sessions,
    };
  }, []);

  if (!ctx || !settings || plan === undefined || progressionLevels === undefined) {
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
      const resumed = Object.values(result.progressionBase).filter((n) => n > 0).length;
      const parts = [
        `Plan erzeugt: ${result.sessions.length} Einheiten über ${result.microcycles.length} Zyklen.`,
        resumed === 0
          ? 'Die Steigerung startet bei Stufe 0.'
          : `Die Steigerung setzt auf deinen erledigten Einheiten auf — ${resumed} ${
              resumed === 1 ? 'Einheitsart steht' : 'Einheitsarten stehen'
            } bereits höher.`,
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
      setConfirmRegenerate(false);
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
            <p className="mb-4 text-sm leading-relaxed text-ink-muted">
              Jede Einheitsart startet auf Stufe 0 und steigert sich mit jedem Mal — der lange
              Lauf beginnt bei 45 Minuten, Intervalle bei 4× 400 m, die Kniebeuge bei 4× 5 mit
              einem Gewicht, bei dem 10 Wiederholungen drin wären.
            </p>
            <Button variant="primary" onClick={() => void generate()} disabled={busy}>
              {busy ? 'Erzeuge …' : 'Plan erzeugen'}
            </Button>
          </Card>
        </Section>
      </>
    );
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

  // Abgeschlossene Zyklen bleiben beim Neuerzeugen stehen — sie sind der
  // Verlauf. Standardmäßig ausgeblendet, damit der Plan nicht mit jedem Monat
  // länger scrollt.
  const doneCount = plan.sessions.filter((x) => x.status === 'done').length;

  /** Steht überhaupt noch etwas an? Sonst gibt es nur Verlauf. */
  const hasFuturePlan = plan.micros.some((m) => m.endDate >= todayIso);

  // Erledigte Einheiten, deren Zyklus nicht mehr existiert. Ohne eigene Liste
  // wären sie unsichtbar, obwohl sie in der Datenbank stehen — und genau das
  // fühlt sich an, als wäre etwas verloren gegangen.
  const orphans = plan.sessions
    .filter(
      (x) =>
        x.status === 'done' &&
        !plan.micros.some((m) => x.date >= m.startDate && x.date <= m.endDate),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const pastMicros = hasFuturePlan ? plan.micros.filter((m) => m.endDate < todayIso) : [];
  const visibleMicros =
    showPast || !hasFuturePlan ? plan.micros : plan.micros.filter((m) => m.endDate >= todayIso);

  // Der Stand wird gezählt, nicht aus dem Plan gelesen: so steht er auch da,
  // wenn von einer Art gerade nichts geplant ist.
  const levels = PROGRESSING_TYPES.map((type) => {
    const step = levelOf(progressionLevels ?? {}, type);
    const form = sessionForm(type, settings.hrZones, step, false);
    const main =
      form.content.find((bl) => /Hauptteil|Dauerlauf|Kniebeuge|Bankdrücken/i.test(bl.label)) ??
      form.content[0];
    return {
      type,
      label: SESSION_TYPES[type].label,
      step,
      detail: (main?.detail ?? '').replace(/\s*·\s*\d+–\d+\s*bpm/g, ''),
    };
  });

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

      {!hasFuturePlan ? (
        <Section
          title="Kein aktueller Plan"
          hint="Was du bereits erledigt hast, steht weiter unten — es bleibt erhalten, auch ohne Plan."
        >
          <Card>
            <p className="mb-4 text-sm leading-relaxed text-ink-muted">
              Erzeugt {MESOCYCLE_COUNT} Blöcke à {settings.mesoLoadCycles} Belastungs- und{' '}
              {settings.mesoDeloadCycles} Deload-Zyklus, beginnend heute. Die Steigerung setzt auf
              deinen erledigten Einheiten auf.
            </p>
            <Button variant="primary" onClick={() => void generate()} disabled={busy}>
              {busy ? 'Erzeuge …' : 'Plan erzeugen'}
            </Button>
          </Card>
        </Section>
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

      {/* Der Plan zeigt, was ansteht; das Logbuch, was war. Der Weg dorthin
          gehört hierher — man sucht den Verlauf dort, wo der Plan steht. */}
      <Link
        href="/logbuch"
        className="mb-8 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded text-ink-faint"
          aria-hidden="true"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" strokeWidth="1.6" stroke="currentColor">
            <path d="M4.5 3.5h9a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2h-9z" />
            <path d="M4.5 3.5a1.5 1.5 0 0 0 0 3" strokeLinecap="round" />
            <path d="M7.5 8h5M7.5 11h3" strokeLinecap="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">Logbuch</span>
          <span className="block text-xs text-ink-faint">
            {doneCount === 0
              ? 'Noch nichts erledigt — hier landet, was du abhakst.'
              : `${doneCount} erledigte ${doneCount === 1 ? 'Einheit' : 'Einheiten'} — bearbeiten, korrigieren, löschen`}
          </span>
        </span>
        <span className="text-ink-faint">›</span>
      </Link>

      {levels.length > 0 ? (
        <Section
          title="Steigerung"
          hint="Jede Einheitsart hat ihre eigene Stufe: so viele erledigte Einheiten dieser Art, wie es gibt. Nimmst du eine zurück, zählt sie zurück. Ein Deload lässt die Stufe stehen. Tippe eine Zeile an, um zu korrigieren."
        >
          <Card>
            <ul className="space-y-1">
              {levels.map((l) => (
                <li key={l.type}>
                  <button
                    onClick={() => setOpenLevel(openLevel === l.type ? null : l.type)}
                    className="flex w-full items-baseline justify-between gap-3 rounded py-1.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{l.label}</span>
                      <span className="block truncate text-xs text-ink-faint">{l.detail}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted tabular">Stufe {l.step}</span>
                  </button>

                  {openLevel === l.type ? (
                    <div className="mb-1 mt-1 rounded border border-line bg-surface-2 p-3">
                      <p className="mb-2 text-xs leading-relaxed text-ink-faint">
                        Die Stufe zählt deine erledigten Einheiten. Hier lässt sie sich
                        korrigieren — nach einem Fehleintrag oder wenn du höher einsteigen
                        willst.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          onClick={() => void setProgressionLevel(l.type, l.step - 1)}
                          disabled={l.step === 0}
                        >
                          − 1
                        </Button>
                        <Button onClick={() => void setProgressionLevel(l.type, l.step + 1)}>
                          + 1
                        </Button>
                        <Button
                          onClick={() => void setProgressionLevel(l.type, 0)}
                          disabled={l.step === 0}
                        >
                          Auf Stufe 0
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <Section
        title="Plan"
        hint="Ein Zyklus ist ein Durchlauf deiner Rotation. Jeder Tag steht in der Liste, auch die Ruhetage. Tippe einen Tag an — dort kannst du auch die Schicht ändern."
      >
        {pastMicros.length > 0 ? (
          <button
            onClick={() => setShowPast(!showPast)}
            className="mb-4 text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
          >
            {showPast
              ? 'Frühere Zyklen ausblenden'
              : pastMicros.length === 1
                ? 'Einen früheren Zyklus zeigen'
                : `${pastMicros.length} frühere Zyklen zeigen`}
          </button>
        ) : null}

        <div className="space-y-5">
          {visibleMicros.map((micro) => {
            // Nach Datum statt nach Zyklus-Id: protokollierte Einheiten aus einem
            // ersetzten Plan hängen an keinem Zyklus mehr, gehören aber sichtbar
            // auf ihren Tag — sonst stünde dort "Ruhetag", obwohl trainiert wurde.
            const list = plan.sessions
              .filter((s) => s.date >= micro.startDate && s.date <= micro.endDate)
              .sort(
              (a, b) =>
                a.date.localeCompare(b.date) ||
                (a.discipline === 'run' ? 0 : 1) - (b.discipline === 'run' ? 0 : 1),
            );
            const isActive = micro.id === activeMicro?.id;
            const cycleDays = resolveShiftRange(micro.startDate, micro.endDate, ctx);

            return (
              <div key={micro.id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className={`text-sm font-medium ${isActive ? 'text-ember' : 'text-ink'}`}>
                    Zyklus {plan.micros.indexOf(micro) + 1}
                    {micro.isDeload ? ' · Deload' : ''}
                  </h3>
                  <span className="text-[11px] text-ink-faint tabular">
                    {formatShort(micro.startDate)} – {formatShort(micro.endDate)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {cycleDays.map((cycleDay) => {
                    const daySessions = list.filter((x) => x.date === cycleDay.date);

                    // Ein Tag ohne Einheit ist kein Loch im Plan, sondern eine
                    // Entscheidung. Ihn wegzulassen ließ den Plan lückenhaft
                    // aussehen und verschwieg, warum an dem Tag nichts geht.
                    if (daySessions.length === 0) {
                      const openRest = openRestDay === cycleDay.date;
                      return (
                        <div key={cycleDay.date}>
                          <button
                            onClick={() => setOpenRestDay(openRest ? null : cycleDay.date)}
                            className={`flex w-full items-center gap-3 rounded border border-dashed px-3 py-2 text-left transition-colors ${
                              cycleDay.date === todayIso
                                ? 'border-ember/60 bg-surface'
                                : 'border-line bg-transparent hover:border-line-strong'
                            }`}
                          >
                            <span
                              className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-void opacity-60"
                              style={{ backgroundColor: cycleDay.shiftType.color }}
                            >
                              {cycleDay.shiftType.short}
                            </span>
                            <span className="w-16 shrink-0 text-xs text-ink-faint tabular">
                              {weekdayShort(cycleDay.date)} {cycleDay.date.slice(8)}.
                              {cycleDay.date.slice(5, 7)}.
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-ink-faint">
                              {cycleDay.capacity === 'none' ? 'Kein Training' : 'Ruhetag'}
                            </span>
                            <span className="max-w-[40%] shrink-0 truncate text-[11px] text-ink-faint">
                              {cycleDay.shiftType.name}
                              {cycleDay.isOverride ? ' ∗' : ''}
                            </span>
                          </button>

                          {openRest ? (
                            <div className="mt-1 rounded border border-line-strong bg-surface-2 p-3">
                              <p className="mb-3 text-sm leading-relaxed text-ink-muted">
                                {capacityExplanation(cycleDay)}
                              </p>
                              <ShiftPicker
                                day={cycleDay}
                                shiftTypes={ctx.shiftTypes}
                                onDone={() => setOpenRestDay(null)}
                                label="Schicht an diesem Tag"
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    return daySessions.map((session, si) => {
                    const day = cycleDay;
                    const open = openId === session.id;
                    const dimmed = session.status === 'skipped' || session.status === 'missed';
                    // „↳ dazu" heißt Doppeltag — zwei Einheiten, die beide noch
                    // anstehen. Eine verpasste oder gestrichene zählt dafür
                    // nicht mit: sonst sieht ein Tag, auf den nach einer
                    // Umplanung eine einzelne Einheit gerückt ist, aus wie ein
                    // Doppeltag. Das Datum trägt deshalb die erste Einheit, die
                    // wirklich noch ansteht.
                    const active = (x: Session) => x.status !== 'skipped' && x.status !== 'missed';
                    const firstActive = daySessions.findIndex(active);
                    const showsDate = si === (firstActive >= 0 ? firstActive : 0);
                    const isSecond =
                      active(session) && daySessions.slice(0, si).some(active) && !showsDate;
                    // Nach einer nachträglich geänderten Schicht kann eine
                    // geplante Einheit an einem Tag stehen, der sie nicht trägt.
                    const conflict =
                      session.status === 'planned' && !capacityAllows(day.capacity, session.type);

                    return (
                      <div key={session.id}>
                        <button
                          onClick={() => setOpenId(open ? null : session.id)}
                          className={`flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left transition-colors ${
                            conflict
                              ? 'border-ember-dim bg-ember/5'
                              : session.date === todayIso
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
                            {showsDate ? (
                              <>
                                {weekdayShort(session.date)} {session.date.slice(8)}.
                                {session.date.slice(5, 7)}.
                              </>
                            ) : isSecond ? (
                              <span className="text-ember">↳ dazu</span>
                            ) : null}
                          </span>
                          {/* Kein "Doppeltag"-Etikett: die zweite Zeile sagt mit
                              "↳ dazu" ohnehin, was los ist, und das Wort drückt
                              den Titel zusammen. */}
                          <span
                            className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm ${
                              session.status === 'done' ? 'text-ink-muted' : 'text-ink'
                            }`}
                          >
                            <span className="min-w-0 truncate">{session.title}</span>
                            {session.isKey ? <Mark variant="solid" className="text-ember" /> : null}
                          </span>
                          {/* Eine erledigte Einheit sah aus wie eine geplante —
                              zwei gleiche Zeilen an einem Tag ließen sich dann
                              nicht auseinanderhalten. */}
                          <span
                            className={`shrink-0 text-[11px] tabular ${
                              conflict
                                ? 'text-ember'
                                : session.status === 'done'
                                  ? 'text-ok'
                                  : 'text-ink-faint'
                            }`}
                          >
                            {conflict
                              ? 'passt nicht'
                              : session.status === 'done'
                                ? 'erledigt'
                                : `${session.plannedDurationMin} Min`}
                          </span>
                        </button>

                        {open ? (
                          <div className="mt-1 rounded border border-line-strong bg-surface-2 p-3">
                            <p className="mb-2 text-xs text-ink-faint">
                              {day.shiftType.name}
                              {day.shiftType.trainingWindow ? ` · ${day.shiftType.trainingWindow}` : ''}
                              {session.zone ? ` · Zone ${session.zone}` : ''}
                              {session.targetRpe ? ` · RPE ${session.targetRpe}` : ''}
                              {session.progressionStep !== undefined && progresses(session.type)
                                ? ` · Stufe ${session.progressionStep}`
                                : ''}{' '}
                              · {SESSION_STATUS_LABEL[session.status]}
                            </p>

                            {session.progressionNote ? (
                              <p className="mb-2 text-xs leading-relaxed text-ink-muted">
                                {session.progressionNote}
                              </p>
                            ) : null}

                            <ul className="mb-3 space-y-1">
                              {session.content.map((block, bi) => (
                                <li key={bi} className="text-sm leading-relaxed text-ink">
                                  <span className="text-ink-muted">{block.label}:</span> {block.detail}
                                </li>
                              ))}
                            </ul>

                            {conflict ? (
                              <div className="mb-3 rounded border border-ember-dim bg-ember/10 p-3">
                                <p className="text-[10px] uppercase tracking-widest text-ember">
                                  Passt nicht mehr
                                </p>
                                <p className="mt-1 text-sm leading-relaxed text-ink">
                                  {day.shiftType.cancelsPlanned
                                    ? `${day.shiftType.name} an diesem Tag — nachholen wäre hier die falsche Reaktion.`
                                    : `${day.shiftType.name} an diesem Tag trägt ${session.title} nicht.`}
                                </p>
                                <div className="mt-2">
                                  {day.shiftType.cancelsPlanned ? (
                                    <Button
                                      variant="primary"
                                      onClick={() =>
                                        void cancelSession(
                                          session.id,
                                          `${day.shiftType.name} — die Einheit entfällt ersatzlos.`,
                                        )
                                      }
                                    >
                                      Einheit streichen
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="primary"
                                      onClick={() => void handleMissed(session)}
                                    >
                                      Umplanen
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ) : null}

                            {session.rescheduleReason ? (
                              <p className="mb-3 rounded border border-line bg-surface p-2 text-xs leading-relaxed text-ink-muted">
                                {session.rescheduleReason}
                              </p>
                            ) : null}

                            {/* Die Schicht gehört zum Tag, nicht zur Einheit —
                                aber genau hier fällt auf, dass sie nicht stimmt.
                                Deshalb eingeklappt statt auf einem zweiten Screen. */}
                            {shiftEditFor === session.date ? (
                              <div className="mb-3 rounded border border-line bg-surface p-3">
                                <ShiftPicker
                                  day={day}
                                  shiftTypes={ctx.shiftTypes}
                                  onDone={() => setShiftEditFor(null)}
                                  label="Schicht an diesem Tag"
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => setShiftEditFor(session.date)}
                                className="mb-3 text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
                              >
                                Schicht ändern
                              </button>
                            )}

                            {loggingId === session.id ? (
                              <SessionLogForm
                                session={session}
                                onSaved={(records, souls) => {
                                  setNewRecords(records);
                                  setNewSouls(souls);
                                  setLoggingId(null);
                                }}
                                onCancel={() => setLoggingId(null)}
                              />
                            ) : (
                              <>
                                <NewRecordsNotice records={newRecords} souls={newSouls} />
                                <div className="flex flex-wrap gap-2">
                                  {session.status === 'planned' ? (
                                    <>
                                      <Button variant="primary" onClick={() => setLoggingId(session.id)}>
                                        Erledigt
                                      </Button>
                                      <Button onClick={() => void handleMissed(session)}>Verpasst</Button>
                                    </>
                                  ) : (
                                    <>
                                      {session.status === 'done' ? (
                                        <Button onClick={() => setLoggingId(session.id)}>
                                          Protokoll bearbeiten
                                        </Button>
                                      ) : null}
                                      <Button onClick={() => void resetSessionStatus(session.id)}>
                                        Zurück auf geplant
                                      </Button>
                                    </>
                                  )}
                                  <Button
                                    onClick={() => void toggleSessionLock(session.id, !session.locked)}
                                  >
                                    {session.locked ? 'Fixierung lösen' : 'Fixieren'}
                                  </Button>
                                </div>

                                {session.status === 'done' ? (
                                  <div className="mt-3 border-t border-line pt-3">
                                    {confirmDeleteId === session.id ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs text-ink">
                                          Einheit und Protokoll werden gelöscht.
                                        </span>
                                        <Button
                                          variant="danger"
                                          onClick={async () => {
                                            await deleteSession(session.id);
                                            setConfirmDeleteId(null);
                                            setOpenId(null);
                                          }}
                                        >
                                          Endgültig löschen
                                        </Button>
                                        <Button onClick={() => setConfirmDeleteId(null)}>
                                          Abbrechen
                                        </Button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setConfirmDeleteId(session.id)}
                                        className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger"
                                      >
                                        Einheit löschen
                                      </button>
                                    )}
                                  </div>
                                ) : null}
                              </>
                            )}

                            {session.locked ? (
                              <p className="mt-2 text-xs text-ember">
                                Fixiert — der Umplaner verschiebt diese Einheit nicht.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                    });
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {orphans.length > 0 ? (
          <p className="mt-5 text-xs leading-relaxed text-ink-faint">
            {orphans.length === 1
              ? 'Eine erledigte Einheit gehört zu keinem Zyklus mehr — sie steht im '
              : `${orphans.length} erledigte Einheiten gehören zu keinem Zyklus mehr — sie stehen im `}
            <Link href="/logbuch" className="text-ember underline">
              Logbuch
            </Link>
            .
          </p>
        ) : null}
      </Section>

      {hasFuturePlan ? (
      <Section
        title="Plan neu erzeugen"
        hint="Normalerweise nicht nötig — der Plan passt sich bei Änderungen von selbst an. Hier nur, wenn du bewusst neu würfeln willst. Ersetzt wird nur, was ab heute geplant ist; abgeschlossene Zyklen, Erledigtes und Fixiertes bleiben unangetastet."
      >
        <Card>
          {confirmRegenerate ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink">
                Alles ab heute wird neu geplant. Erledigtes bleibt.
              </span>
              <Button variant="primary" onClick={() => void generate()} disabled={busy}>
                {busy ? 'Erzeuge …' : 'Ja, neu erzeugen'}
              </Button>
              <Button onClick={() => setConfirmRegenerate(false)}>Abbrechen</Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setConfirmRegenerate(true)}>
              Plan neu erzeugen
            </Button>
          )}

          <div className="mt-4 border-t border-line pt-4">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink">
                  Alles ab heute wird gelöscht. Erledigtes bleibt.
                </span>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await clearActivePlan();
                    setConfirmDelete(false);
                    setMessage('Plan ab heute gelöscht. Der Verlauf ist geblieben.');
                  }}
                >
                  Ja, löschen
                </Button>
                <Button onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Plan löschen
              </Button>
            )}
          </div>
        </Card>
      </Section>
      ) : null}
    </>
  );
}
