'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort, monthKey, today } from '@/lib/dates';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { capacityAllows, resolveShiftDay } from '@/lib/shifts';
import {
  applyRescheduleProposal,
  buildRescheduleProposal,
  cancelSession,
  clearActivePlan,
  currentProgressionLevels,
  PLAN_WEEKS,
  setProgressionLevel,
  createAndSavePlan,
  markSessionMissed,
  resetSessionStatus,
  toggleSessionLock,
} from '@/lib/plan-store';
import { levelOf, PROGRESSING_TYPES, progresses, sessionForm } from '@/lib/progression';
import type { ReschedulePlan } from '@/lib/replan';
import { SESSION_STATUS_LABEL, SESSION_TYPES, type Session, type Soul } from '@/lib/types';
import { MonthGrid } from '@/components/MonthGrid';
import { ShiftPicker } from '@/components/ShiftPicker';
import { DayCoach } from '@/components/DayCoach';
import { Button, Card, Mark, Notice, Section } from '@/components/ui';
import { NewRecordsNotice, SessionLogForm } from '@/components/SessionLogForm';

export default function PlanPage() {
  const ctx = useShiftContext();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openLevel, setOpenLevel] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthKey(today()));
  const [pickedDay, setPickedDay] = useState<string | null>(null);
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
        weeks: PLAN_WEEKS,
      });
      const resumed = Object.values(result.progressionBase).filter((n) => n > 0).length;
      const parts = [
        `Plan erzeugt: ${result.sessions.length} Einheiten über ${result.microcycles.length} Wochen.`,
        resumed === 0
          ? 'Die Steigerung startet bei Stufe 0.'
          : `Die Steigerung setzt auf deinen erledigten Einheiten auf — ${resumed} ${
              resumed === 1 ? 'Einheitsart steht' : 'Einheitsarten stehen'
            } bereits höher.`,
      ];
      const rest = result.restDays.length;
      if (rest > 0) {
        parts.push(
          `${rest} ${rest === 1 ? 'Ruhetag' : 'Ruhetage'} — Schicht oder Erholung ließen dort nichts zu.`,
        );
      }
      if (result.shortfalls.length > 0) {
        const n = result.shortfalls.length;
        parts.push(
          `In ${n} ${n === 1 ? 'Woche' : 'Wochen'} wurde das Wochenziel nicht voll erreicht; die Schichten gaben nicht mehr her.`,
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
          hint="Cllctr plant Tag für Tag: Erst zählt die Erholung, dann die Schicht, dann das Training. Ein Mikrozyklus ist eine Kalenderwoche."
        >
          <Card>
            <p className="mb-4 text-sm leading-relaxed text-ink-muted">
              Erzeugt {PLAN_WEEKS} Wochen ab heute — {settings.mesoLoadCycles} Belastungswochen,
              dann {settings.mesoDeloadCycles} Deload-Woche, und von vorn.
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

  // Abgeschlossene Wochen bleiben beim Neuerzeugen stehen — sie sind der
  // Verlauf. Standardmäßig ausgeblendet, damit der Plan nicht mit jedem Monat
  // länger scrollt.
  const doneCount = plan.sessions.filter((x) => x.status === 'done').length;

  /** Steht überhaupt noch etwas an? Sonst gibt es nur Verlauf. */
  const hasFuturePlan = plan.micros.some((m) => m.endDate >= todayIso);

  // Erledigte Einheiten, deren Woche nicht mehr existiert. Ohne eigene Liste
  // wären sie unsichtbar, obwohl sie in der Datenbank stehen — und genau das
  // fühlt sich an, als wäre etwas verloren gegangen.
  const orphans = plan.sessions
    .filter(
      (x) =>
        x.status === 'done' &&
        !plan.micros.some((m) => x.date >= m.startDate && x.date <= m.endDate),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

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

  const trained = levels.filter((l) => l.step > 0).length;
  const topLevel = levels.reduce((best, l) => (l.step > best.step ? l : best), levels[0]);
  const openDetail = levels.find((l) => l.type === openLevel) ?? null;

  /**
   * Ein Tag im Detail: Schicht, was ansteht, und die Griffe dazu.
   *
   * Lokal definiert, weil sie an allem hängt, was oben schon berechnet ist —
   * Kontext, Plan, die offenen Formulare. Als eigene Datei müsste ein Dutzend
   * Dinge durchgereicht werden, ohne dass irgendwo etwas gewonnen wäre.
   */
  /** Die Woche, in der dieser Tag liegt — für die Deload-Marke im Tagesdetail. */
  function microByDate(date: string) {
    return plan!.micros.find((m) => m.startDate <= date && date <= m.endDate);
  }

  function DayDetail({ date }: { date: string }) {
    const day = resolveShiftDay(date, ctx!);
    const own = plan!.sessions
      .filter((s) => s.date === date)
      .sort(
        (a, b) =>
          (a.discipline === 'run' ? 0 : 1) - (b.discipline === 'run' ? 0 : 1) ||
          a.orderInDay - b.orderInDay,
      );

    return (
      <div className="rounded-lg border border-line-strong bg-surface-2 p-3">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-ink">{formatShort(date)}</p>
          <p className="text-xs text-ink-faint">
            {day.shiftType.name}
            {day.isOverride ? ' ∗' : ''}
          </p>
        </div>

        <div className="mb-3">
          <DayCoach
            day={day}
            settings={settings!}
            sessions={own}
            allSessions={plan!.sessions}
            isDeloadWeek={microByDate(date)?.isDeload ?? false}
          />
        </div>

        <div className="space-y-3">
          {own.map((session) => {
            const conflict =
              session.status === 'planned' && !capacityAllows(day.capacity, session.type);

            return (
              <div key={session.id} className="rounded border border-line bg-surface p-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
                    <span className="truncate">{session.title}</span>
                    {session.isKey ? <Mark variant="solid" className="text-ember" /> : null}
                  </span>
                  <span
                    className={`shrink-0 text-[11px] tabular ${
                      session.status === 'done' ? 'text-ok' : 'text-ink-faint'
                    }`}
                  >
                    {session.status === 'done'
                      ? 'erledigt'
                      : `${session.plannedDurationMin} Min`}
                  </span>
                </div>

                <p className="mb-2 text-xs text-ink-faint">
                  {session.zone ? `Zone ${session.zone} · ` : ''}
                  {session.targetRpe ? `RPE ${session.targetRpe} · ` : ''}
                  {session.progressionStep !== undefined && progresses(session.type)
                    ? `Stufe ${session.progressionStep} · `
                    : ''}
                  {SESSION_STATUS_LABEL[session.status]}
                </p>

                {session.progressionNote ? (
                  <p className="mb-2 text-xs leading-relaxed text-ink-muted">
                    {session.progressionNote}
                  </p>
                ) : null}

                <ul className="mb-3 space-y-1">
                  {session.content.map((block, i) => (
                    <li key={i} className="text-sm leading-relaxed text-ink">
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
                        <Button variant="primary" onClick={() => void handleMissed(session)}>
                          Umplanen
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}

                {session.rescheduleReason ? (
                  <p className="mb-3 rounded border border-line bg-surface-2 p-2 text-xs leading-relaxed text-ink-muted">
                    {session.rescheduleReason}
                  </p>
                ) : null}

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
                  </>
                )}

                {session.locked ? (
                  <p className="mt-2 text-xs text-ember">
                    Fixiert — weder Umplaner noch Anpassung verschieben diese Einheit.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <ShiftPicker
            day={day}
            shiftTypes={ctx!.shiftTypes}
            label="Schicht an diesem Tag"
          />
        </div>
      </div>
    );
  }

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
              Erzeugt {PLAN_WEEKS} Wochen ab heute — {settings.mesoLoadCycles} Belastungswochen,
              dann {settings.mesoDeloadCycles} Deload-Woche. Die Steigerung setzt auf deinen
              erledigten Einheiten auf.
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
              Woche {activeMicro.index} von {cyclesPerMeso}
              {activeMicro.isDeload ? ' — Deload läuft' : ''}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">
              {activeMicro.lengthDays} Tage, geplante Last {activeMicro.plannedLoad}.{' '}
              {activeMicro.isDeload
                ? 'Danach beginnt der nächste Block.'
                : `Deload in ${Math.max(0, cyclesToDeload)} ${
                    ctx.pattern
                      ? cyclesToDeload === 1
                        ? 'Woche'
                        : 'Wochen'
                      : cyclesToDeload === 1
                        ? 'Woche'
                        : 'Wochen'
                  }.`}
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
          hint="Jede Einheitsart hat ihre eigene Stufe: so viele erledigte Einheiten dieser Art, wie es gibt. Nimmst du eine zurück, zählt sie zurück."
        >
          <Card>
            {/* Zwölf Arten in zwölf Zeilen waren eine halbe Bildschirmseite für
                eine Zahl, die man selten braucht. Jetzt steht der Stand als
                Kachelfeld da; die Einzelheiten kommen erst beim Antippen. */}
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <p className="text-sm text-ink">
                {trained === 0
                  ? 'Alles auf Stufe 0 — die Steigerung fängt bei der ersten erledigten Einheit an.'
                  : `${trained} von ${levels.length} Arten angefangen`}
              </p>
              {trained > 0 ? (
                <p className="shrink-0 text-xs text-ink-faint tabular">
                  höchste: {topLevel.label} {topLevel.step}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {levels.map((l) => {
                const open = openLevel === l.type;
                return (
                  <button
                    key={l.type}
                    onClick={() => setOpenLevel(open ? null : l.type)}
                    aria-pressed={open}
                    className={`flex items-baseline gap-1.5 rounded border px-2 py-1 text-xs ${
                      open
                        ? 'border-ember text-ember'
                        : l.step > 0
                          ? 'border-line-strong text-ink'
                          : 'border-line text-ink-faint'
                    }`}
                  >
                    <span className="max-w-[9rem] truncate">{l.label}</span>
                    <span className="tabular font-medium">{l.step}</span>
                  </button>
                );
              })}
            </div>

            {openDetail ? (
              <div className="mt-3 rounded border border-line bg-surface-2 p-3">
                <p className="text-sm text-ink">{openDetail.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  Stufe {openDetail.step}: {openDetail.detail}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => void setProgressionLevel(openDetail.type, openDetail.step - 1)}
                    disabled={openDetail.step === 0}
                  >
                    − 1
                  </Button>
                  <Button
                    onClick={() => void setProgressionLevel(openDetail.type, openDetail.step + 1)}
                  >
                    + 1
                  </Button>
                  <Button
                    onClick={() => void setProgressionLevel(openDetail.type, 0)}
                    disabled={openDetail.step === 0}
                  >
                    Auf Stufe 0
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                  Korrigieren ist für Fehleinträge und für den Einstieg auf einem höheren
                  Niveau. Ein Deload lässt die Stufe ohnehin stehen.
                </p>
              </div>
            ) : null}
          </Card>
        </Section>
      ) : null}
      <Section
        title="Plan"
        hint="Dein Monat: oben die Schicht, der Punkt heißt Training. Tippe einen Tag an — dort steht, was ansteht, und dort änderst du auch die Schicht."
      >
        <Card>
          <MonthGrid
            month={month}
            onMonthChange={setMonth}
            selected={pickedDay}
            onPick={(date) => setPickedDay(pickedDay === date ? null : date)}
            cellFor={(date) => {
              const d = resolveShiftDay(date, ctx);
              const own = plan.sessions.filter((x) => x.date === date);
              const open = own.filter((x) => x.status === 'planned');
              return {
                mark: d.shiftType.short,
                color: d.shiftType.id === '__unplanned' ? null : d.shiftType.color,
                dot:
                  open.length > 0
                    ? ('accent' as const)
                    : own.length > 0
                      ? ('muted' as const)
                      : null,
              };
            }}
          />
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-ink-faint">
            <span className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-ember" /> Training geplant
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-ink-faint" /> erledigt oder abgehakt
            </span>
          </div>
        </Card>

        {pickedDay ? (
          <div className="mt-3">
            <DayDetail date={pickedDay} />
          </div>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Tippe einen Tag an.
          </p>
        )}

        {orphans.length > 0 ? (
          <p className="mt-5 text-xs leading-relaxed text-ink-faint">
            {orphans.length === 1
              ? 'Eine erledigte Einheit gehört zu keiner Woche mehr — sie steht im '
              : `${orphans.length} erledigte Einheiten gehören zu keiner Woche mehr — sie stehen im `}
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
        hint="Normalerweise nicht nötig — der Plan passt sich bei Änderungen von selbst an. Hier nur, wenn du bewusst neu würfeln willst. Ersetzt wird nur, was ab heute geplant ist; abgeschlossene Wochen, Erledigtes und Fixiertes bleiben unangetastet."
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
