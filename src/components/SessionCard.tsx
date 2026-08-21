'use client';

import { useState } from 'react';
import type { SessionExplanation } from '@/lib/explain';
import { logSession, type QuickLog } from '@/lib/plan-store';
import type { Session, SessionFeeling } from '@/lib/types';
import { Button, inputClass } from './ui';

const FEELINGS: Array<{ key: SessionFeeling; label: string }> = [
  { key: 'good', label: 'Gut' },
  { key: 'ok', label: 'Ging so' },
  { key: 'bad', label: 'Schlecht' },
];

/**
 * Eine Einheit auf dem Heute-Screen: Inhalt, Begründung, Aktionen.
 * Beim Abhaken öffnet sich direkt das kurze Protokoll — ein "erledigt" ohne
 * RPE verliert die Information, aus der später die Statistiken entstehen.
 */
export function SessionCard({
  session,
  explanation,
  onMissed,
}: {
  session: Session;
  explanation: SessionExplanation;
  onMissed: (session: Session) => void;
}) {
  const [logging, setLogging] = useState(false);
  const [rpe, setRpe] = useState<number | null>(session.targetRpe);
  const [duration, setDuration] = useState<string>(String(session.plannedDurationMin ?? ''));
  const [distance, setDistance] = useState('');
  const [feeling, setFeeling] = useState<SessionFeeling | null>(null);
  const [note, setNote] = useState('');

  const done = session.status === 'done';

  async function save() {
    const entry: QuickLog = {
      rpe,
      durationMin: duration ? Number(duration) : null,
      distanceKm: distance ? Number(distance.replace(',', '.')) : null,
      feeling,
      note: note.trim(),
    };
    await logSession(session, entry);
    setLogging(false);
  }

  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <header className="mb-3">
        <h2 className="text-xl font-semibold leading-tight text-ink">
          {session.title}
          {session.isKey ? <span className="text-ember"> ▪</span> : null}
        </h2>
        <p className="mt-1 text-xs text-ink-faint tabular">
          {session.plannedDurationMin} Min
          {session.zone ? ` · Zone ${session.zone}` : ''}
          {session.targetRpe ? ` · RPE ${session.targetRpe}` : ''}
          {done ? ' · erledigt' : ''}
        </p>
      </header>

      <ul className="mb-4 space-y-1">
        {session.content.map((block, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink">
            <span className="text-ink-faint">{block.label}:</span> {block.detail}
          </li>
        ))}
      </ul>

      <div className="mb-4 rounded border border-line bg-surface-2 p-3">
        <p className="mb-1 text-[11px] uppercase tracking-widest text-ink-faint">Warum heute</p>
        <p className="text-sm leading-relaxed text-ink-muted">{explanation.reason}</p>
        {explanation.notes.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {explanation.notes.map((note, i) => (
              <li key={i} className="text-xs leading-relaxed text-ink-faint">
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {logging ? (
        <div className="rounded border border-ember-dim bg-ember/5 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-widest text-ember">Kurz protokollieren</p>

          <p className="mb-1 text-xs text-ink-muted">Wie hart war es? (RPE)</p>
          <div className="mb-3 grid grid-cols-10 gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
              <button
                key={value}
                onClick={() => setRpe(value)}
                className={`rounded py-1.5 text-xs tabular transition-colors ${
                  rpe === value
                    ? 'bg-ember font-semibold text-void'
                    : 'border border-line-strong text-ink-muted hover:border-ink-faint'
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-muted">Dauer (Min)</span>
              <input
                type="number"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={`${inputClass} tabular`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-muted">Distanz (km)</span>
              <input
                type="text"
                inputMode="decimal"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="optional"
                className={`${inputClass} tabular`}
              />
            </label>
          </div>

          <div className="mb-3 flex gap-2">
            {FEELINGS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFeeling(feeling === f.key ? null : f.key)}
                className={`flex-1 rounded border py-1.5 text-xs transition-colors ${
                  feeling === f.key
                    ? 'border-ember text-ember'
                    : 'border-line-strong text-ink-muted hover:border-ink-faint'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Notiz (optional)"
            className={`${inputClass} mb-3`}
          />

          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void save()}>
              Speichern
            </Button>
            <Button onClick={() => setLogging(false)}>Abbrechen</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {done ? (
            <Button onClick={() => setLogging(true)}>Protokoll bearbeiten</Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => setLogging(true)}>
                Erledigt
              </Button>
              <Button onClick={() => onMissed(session)}>Verpasst</Button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
