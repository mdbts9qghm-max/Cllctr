'use client';

import { useState } from 'react';
import type { SessionExplanation } from '@/lib/explain';
import type { Session, Soul } from '@/lib/types';
import { Button, Chip, Mark } from './ui';
import { NewRecordsNotice, SessionLogForm } from './SessionLogForm';

/**
 * Der Kern der Einheit in einem Satz.
 *
 * Auf dem Startbildschirm zählt, was heute wirklich zu tun ist — Ein- und
 * Auslaufen kennt man. Deshalb bevorzugt der Hauptteil, sonst der erste Block.
 */
function essence(session: Session): { line: string; more: number } {
  const content = session.content;
  if (content.length === 0) return { line: '', more: 0 };

  const mainIndex = content.findIndex((b) =>
    /Hauptteil|Dauerlauf|Regenerationslauf|Mobility/i.test(b.label),
  );
  const index = mainIndex >= 0 ? mainIndex : 0;
  const block = content[index];
  const raw = mainIndex >= 0 ? block.detail : `${block.label}: ${block.detail}`;

  // Der Herzfrequenzbereich steht im aufgeklappten Ablauf; in der Kurzfassung
  // treibt er die Zeile über zwei Zeilen, ohne etwas hinzuzufügen.
  const line = raw.replace(/\s*·\s*\d+–\d+\s*bpm/g, '');

  return { line, more: content.length - 1 };
}

/**
 * Eine Einheit auf dem Heute-Screen.
 *
 * Standardmäßig knapp: Titel, die drei Eckdaten, der Hauptteil in einer Zeile.
 * Der vollständige Ablauf und die Begründung erscheinen erst beim Antippen —
 * morgens will man nicht lesen, sondern wissen, was ansteht.
 */
export function SessionCard({
  session,
  explanation,
  onMissed,
  defaultExpanded = false,
}: {
  session: Session;
  explanation: SessionExplanation;
  onMissed: (session: Session) => void;
  defaultExpanded?: boolean;
}) {
  const [logging, setLogging] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [newRecords, setNewRecords] = useState<string[]>([]);
  const [newSouls, setNewSouls] = useState<Soul[]>([]);

  const done = session.status === 'done';
  const { line, more } = essence(session);

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-surface ${
        done ? 'border-line' : 'border-line-strong'
      }`}
    >
      {/* Kopf: antippbar, klappt die Details auf. */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-4 pb-3 pt-4 text-left"
      >
        <div className="mb-2 flex items-center gap-2">
          {session.isKey ? (
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-ember">
              <Mark variant="solid" />
              Key-Session
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-widest text-ink-faint">Einheit</span>
          )}
          {done ? (
            <span className="text-[10px] uppercase tracking-widest text-ok">erledigt</span>
          ) : null}
          <span className="flex-1" />
          <span
            className={`text-ink-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            ›
          </span>
        </div>

        <h2
          className={`text-2xl font-semibold leading-tight ${done ? 'text-ink-muted' : 'text-ink'}`}
        >
          {session.title}
        </h2>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip>{session.plannedDurationMin} Min</Chip>
          {session.zone ? <Chip>Zone {session.zone}</Chip> : null}
          {session.targetRpe ? <Chip>RPE {session.targetRpe}</Chip> : null}
        </div>

        {line && !expanded ? (
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            {line}
            {more > 0 ? (
              <span className="text-ink-faint">
                {' '}
                · +{more} {more === 1 ? 'Block' : 'Blöcke'}
              </span>
            ) : null}
          </p>
        ) : null}
      </button>

      {/* Ausführlich erst hier. */}
      {expanded ? (
        <div className="px-4 pb-3">
          <ul className="mb-3 space-y-1.5 border-t border-line pt-3">
            {session.content.map((block, i) => (
              <li key={i} className="text-sm leading-relaxed text-ink">
                <span className="text-ink-faint">{block.label}:</span> {block.detail}
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">Warum heute</p>
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
        </div>
      ) : null}

      <div className="border-t border-line px-4 py-3">
        {logging ? (
          <SessionLogForm
            session={session}
            onSaved={(records, souls) => {
              setNewRecords(records);
              setNewSouls(souls);
              setLogging(false);
            }}
            onCancel={() => setLogging(false)}
          />
        ) : (
          <>
            <NewRecordsNotice records={newRecords} souls={newSouls} />
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
          </>
        )}
      </div>
    </article>
  );
}
