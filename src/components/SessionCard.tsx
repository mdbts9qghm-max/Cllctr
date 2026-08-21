'use client';

import { useState } from 'react';
import type { SessionExplanation } from '@/lib/explain';
import type { Session } from '@/lib/types';
import { Button } from './ui';
import { NewRecordsNotice, SessionLogForm } from './SessionLogForm';

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
  const [newRecords, setNewRecords] = useState<string[]>([]);

  const done = session.status === 'done';

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
        <SessionLogForm
          session={session}
          onSaved={(records) => {
            setNewRecords(records);
            setLogging(false);
          }}
          onCancel={() => setLogging(false)}
        />
      ) : (
        <div>
          <NewRecordsNotice records={newRecords} />
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
        </div>
      )}
    </article>
  );
}
