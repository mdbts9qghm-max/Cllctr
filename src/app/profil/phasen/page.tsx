'use client';

/**
 * Trainingsphasen.
 *
 * Entweder von Hand oder rückwärts von einem Zieldatum. Rückwärts ist die
 * ehrlichere Variante: Wer einen Wettkampf hat, braucht keine Phasen ab heute,
 * sondern Phasen, die am Ziel enden.
 */

import Link from 'next/link';
import { useState } from 'react';
import { addDays, daysBetween, formatDuration, formatShort, startOfWeek, today } from '@/lib/dates';
import { usePhases, useSettings } from '@/lib/hooks';
import { buildPhaseSequence, phasesForTarget } from '@/lib/phases';
import { deletePhase, replacePhases, savePhase } from '@/lib/store';
import { PHASE_LABEL, PHASE_PROFILE, PHASE_PURPOSE, type PhaseKind, type TrainingPhase } from '@/lib/types';
import { Button, Card, Chip, Empty, Field, Loading, Section, Sheet, inputClass } from '@/components/ui';

export default function PhasenPage() {
  const todayIso = today();
  const phases = usePhases();
  const settings = useSettings();
  const [editing, setEditing] = useState<TrainingPhase | null | undefined>(undefined);
  const [targetDate, setTargetDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  if (!phases || !settings) return <Loading />;

  const preview = targetDate ? phasesForTarget(todayIso, targetDate) : [];

  return (
    <>
      <Link href="/profil" className="mb-5 inline-block text-xs text-ink-faint hover:text-ink">
        ‹ Profil
      </Link>

      {message ? (
        <div className="mb-4 rounded-lg border border-[color:var(--color-good)]/40 bg-[color:var(--color-good)]/10 p-3 text-sm text-ink">
          {message}
        </div>
      ) : null}

      <Section
        title="Phasen"
        action={
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            + Neu
          </Button>
        }
      >
        {phases.length === 0 ? (
          <Empty title="Keine Phasen">Ohne Phase rechnet die App mit Base — der vorsichtigsten Annahme.</Empty>
        ) : (
          <div className="space-y-2">
            {phases.map((p) => {
              const current = p.startDate <= todayIso && todayIso <= p.endDate;
              const weeks = Math.ceil((daysBetween(p.startDate, p.endDate) + 1) / 7);
              const profile = PHASE_PROFILE[p.kind];
              return (
                <Card key={p.id} tone={current ? 'accent' : 'default'}>
                  <button onClick={() => setEditing(p)} className="w-full text-left">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {PHASE_LABEL[p.kind]}
                        {current ? <span className="ml-2 text-[11px] font-normal text-[color:var(--color-accent)]">läuft</span> : null}
                      </p>
                      <span className="shrink-0 text-[11px] tabular text-ink-faint">
                        {formatShort(p.startDate)} – {formatShort(p.endDate)} · {weeks} W
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      {p.focus || PHASE_PURPOSE[p.kind]}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip>{profile.hardPerWeek}× hart</Chip>
                      <Chip>{profile.strengthPerWeek}× Kraft</Chip>
                      <Chip>
                        {formatDuration(p.weeklyMinutesTarget ?? settings.weeklyMinutesTarget)} / Woche
                      </Chip>
                    </div>
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Rückwärts vom Ziel planen"
        hint="Taper zuletzt, davor Peak und Build — der Rest gehört der Grundlage."
      >
        <Card>
          <Field label="Zieldatum">
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className={`${inputClass} tabular`}
            />
          </Field>

          {preview.length > 0 ? (
            <>
              <div className="mt-3 space-y-1.5">
                {preview.map((p) => (
                  <div key={p.kind} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-ink">{PHASE_LABEL[p.kind]}</span>
                    <span className="tabular text-ink-faint">
                      {formatShort(p.startDate)} – {formatShort(p.endDate)} ·{' '}
                      {Math.ceil((daysBetween(p.startDate, p.endDate) + 1) / 7)} Wochen
                    </span>
                  </div>
                ))}
              </div>
              <Button
                variant="primary"
                className="mt-3"
                onClick={() =>
                  void replacePhases(preview).then(() => {
                    setMessage(`${preview.length} Phasen angelegt, Ziel ${formatShort(targetDate)}.`);
                    setTargetDate('');
                  })
                }
              >
                Phasen ersetzen
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                Ersetzt alle bestehenden Phasen. Trainingseinheiten und Verlauf bleiben unberührt.
              </p>
            </>
          ) : targetDate ? (
            <p className="mt-3 text-sm text-ink-muted">
              Bis dahin sind es weniger als vier Wochen — dafür lohnt keine Periodisierung.
            </p>
          ) : null}
        </Card>
      </Section>

      {editing !== undefined ? (
        <PhaseSheet phase={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
}

function PhaseSheet({ phase, onClose }: { phase: TrainingPhase | null; onClose: () => void }) {
  const start = startOfWeek(today());
  const [draft, setDraft] = useState<TrainingPhase>(
    phase ?? {
      id: `phase_${Date.now()}`,
      kind: 'base',
      name: 'Base',
      startDate: start,
      endDate: addDays(start, 8 * 7 - 1),
      weeklyMinutesTarget: null,
      focus: '',
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (p: Partial<TrainingPhase>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Sheet title={phase ? 'Phase bearbeiten' : 'Neue Phase'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Art
          </span>
          <div className="flex gap-1.5">
            {(['base', 'build', 'peak', 'taper'] as PhaseKind[]).map((k) => (
              <button
                key={k}
                onClick={() => patch({ kind: k, name: PHASE_LABEL[k] })}
                aria-pressed={draft.kind === k}
                className={`flex-1 rounded-lg border py-2 text-xs transition-colors ${
                  draft.kind === k
                    ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                    : 'border-line-strong text-ink-muted'
                }`}
              >
                {PHASE_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {PHASE_PURPOSE[draft.kind]}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Von">
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => patch({ startDate: e.target.value })}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Bis">
            <input
              type="date"
              value={draft.endDate}
              onChange={(e) => patch({ endDate: e.target.value })}
              className={`${inputClass} tabular`}
            />
          </Field>
        </div>

        <Field label="Wochenziel (h)" hint="Leer lassen — dann gilt das Ziel aus dem Profil.">
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            value={draft.weeklyMinutesTarget ? draft.weeklyMinutesTarget / 60 : ''}
            onChange={(e) =>
              patch({
                weeklyMinutesTarget: e.target.value === '' ? null : Math.round(Number(e.target.value) * 60),
              })
            }
            className={`${inputClass} tabular`}
          />
        </Field>

        <Field label="Schwerpunkt">
          <textarea
            rows={2}
            value={draft.focus}
            onChange={(e) => patch({ focus: e.target.value })}
            placeholder={PHASE_PURPOSE[draft.kind]}
            className={`${inputClass} resize-none`}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void savePhase(draft).then(onClose)}>
            Speichern
          </Button>
          {phase ? (
            confirmDelete ? (
              <Button variant="danger" onClick={() => void deletePhase(phase.id).then(onClose)}>
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
