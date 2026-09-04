'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort, weekdayShort } from '@/lib/dates';
import { currentRecords, formatRecordValue, PR_KIND_LABEL } from '@/lib/pr';
import {
  deleteSession,
  findDuplicateSessions,
  removeDuplicateSessions,
  resetSessionStatus,
} from '@/lib/plan-store';
import {
  SESSION_TYPES,
  type Discipline,
  type Session,
  type SessionLog,
  type Soul,
} from '@/lib/types';
import { Button, Card, Notice, Section } from '@/components/ui';
import { NewRecordsNotice, SessionLogForm } from '@/components/SessionLogForm';

const FEELING_LABEL: Record<string, string> = {
  good: 'gut',
  ok: 'ging so',
  bad: 'schlecht',
};

const FILTERS: Array<{ key: 'all' | Discipline; label: string }> = [
  { key: 'all', label: 'Alles' },
  { key: 'run', label: 'Laufen' },
  { key: 'strength', label: 'Kraft' },
];

/** "September 2026" — Überschrift je Monatsgruppe. */
function monthLabel(iso: string): string {
  const [year, month] = iso.split('-');
  const names = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ];
  return `${names[Number(month) - 1]} ${year}`;
}

/**
 * Das Logbuch — der Verlauf als eigener Ort.
 *
 * Alles, was erledigt wurde, sammelt sich hier: unabhängig davon, ob der Plan,
 * aus dem es stammt, noch existiert. Aus diesen Einträgen rechnen Stufen,
 * Bestwerte und Seelen — wer hier etwas korrigiert, korrigiert es überall.
 *
 * Die Bestwerte stehen deshalb ebenfalls hier und nicht mehr in einem eigenen
 * Tab: Sie sind kein Diagramm, sondern die Spitze dieses Verlaufs.
 */
export default function LogbuchPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Discipline>('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newRecords, setNewRecords] = useState<string[]>([]);
  const [newSouls, setNewSouls] = useState<Soul[]>([]);

  const data = useLiveQuery(async () => {
    const [sessions, logs] = await Promise.all([db.sessions.toArray(), db.sessionLogs.toArray()]);
    const byId = new Map<string, SessionLog>(logs.map((l) => [l.sessionId, l]));
    const entries = sessions
      .filter((s) => s.status === 'done')
      .sort((a, b) => b.date.localeCompare(a.date) || a.orderInDay - b.orderInDay)
      .map((session) => ({ session, log: byId.get(session.id) ?? null }));
    return {
      entries,
      duplicates: await findDuplicateSessions(),
      records: await currentRecords(),
    };
  }, []);

  if (!data) return <p className="text-sm text-ink-faint">Lade …</p>;

  const entries = data.entries.filter(
    (e) => filter === 'all' || e.session.discipline === filter,
  );

  const totalMinutes = entries.reduce(
    (sum, e) => sum + (e.log?.durationMin ?? e.session.plannedDurationMin ?? 0),
    0,
  );
  const totalKm = entries.reduce((sum, e) => sum + (e.log?.distanceKm ?? 0), 0);

  // Nach Monat gruppieren: ein Jahr am Stück ist sonst eine einzige Wand.
  const groups: Array<{ month: string; items: typeof entries }> = [];
  for (const entry of entries) {
    const month = entry.session.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(entry);
    else groups.push({ month, items: [entry] });
  }

  return (
    <>
      {/* Das Logbuch hängt nicht in der Leiste — ohne diesen Weg zurück müsste
          man raten, wo man herkam. */}
      <Link
        href="/plan"
        className="mb-6 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <span aria-hidden="true">‹</span> Plan
      </Link>

      {message ? (
        <div className="mb-6">
          <Notice tone="ok">{message}</Notice>
        </div>
      ) : null}

      {data.duplicates.length > 0 ? (
        <div className="mb-8">
          <Notice tone="warn">
            <span className="mb-1 block font-medium text-ink">
              {data.duplicates.length === 1
                ? 'Ein Eintrag steht doppelt im Logbuch.'
                : `${data.duplicates.length} Einträge stehen doppelt im Logbuch.`}
            </span>
            <span className="block text-xs leading-relaxed">
              Gleicher Tag, gleiche Art, zweimal erledigt — das kann der Plan nicht erzeugen.
              Solche Einträge zählen überall doppelt.
            </span>
            {data.duplicates.slice(0, 4).map((d) => (
              <span key={d.keep.id} className="mt-1 block text-xs">
                · {formatShort(d.keep.date)} {d.keep.title} (×{d.drop.length + 1})
              </span>
            ))}
            <span className="mt-3 block">
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const removed = await removeDuplicateSessions();
                    setMessage(
                      `${removed} ${removed === 1 ? 'doppelter Eintrag' : 'doppelte Einträge'} entfernt.`,
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Räume auf …' : 'Doppelte entfernen'}
              </Button>
            </span>
          </Notice>
        </div>
      ) : null}

      <Section
        title="Logbuch"
        hint="Alles, was du erledigt hast — auch aus Plänen, die es nicht mehr gibt. Stufen, Bestwerte und Seelen rechnen aus diesen Einträgen. Was du hier änderst, ändert sich überall."
      >
        <Card>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-2xl font-semibold text-ink tabular">{entries.length}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">Einheiten</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink tabular">{totalMinutes}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">Minuten</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink tabular">
                {totalKm > 0 ? Math.round(totalKm) : '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-faint">Kilometer</p>
            </div>
          </div>

          <div className="mt-4 flex gap-2 border-t border-line pt-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                  filter === f.key
                    ? 'border-ember text-ember'
                    : 'border-line-strong text-ink-muted hover:border-ink-faint'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Card>
      </Section>

      {entries.length === 0 ? (
        <Notice tone="info">
          Noch nichts eingetragen.{' '}
          <Link href="/" className="text-ember underline">
            Auf dem Heute-Screen
          </Link>{' '}
          eine Einheit abhaken — dann steht sie hier.
        </Notice>
      ) : null}

      <NewRecordsNotice records={newRecords} souls={newSouls} />

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.month}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium text-ink">{monthLabel(group.month)}</h3>
              <span className="text-[11px] text-ink-faint tabular">
                {group.items.length} {group.items.length === 1 ? 'Einheit' : 'Einheiten'}
              </span>
            </div>

            <div className="space-y-1.5">
              {group.items.map(({ session, log }) => {
                const open = openId === session.id;
                const minutes = log?.durationMin ?? session.plannedDurationMin;

                return (
                  <div key={session.id}>
                    <button
                      onClick={() => {
                        setOpenId(open ? null : session.id);
                        setEditingId(null);
                        setConfirmDeleteId(null);
                      }}
                      className="flex w-full items-center gap-3 rounded border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                    >
                      {/* Kompakt statt ausgeschrieben: "So, 30. Aug" bricht in
                          der schmalen Spalte um. */}
                      <span className="w-16 shrink-0 text-xs text-ink-faint tabular">
                        {weekdayShort(session.date)} {session.date.slice(8)}.
                        {session.date.slice(5, 7)}.
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {session.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-faint tabular">
                        {minutes} Min
                      </span>
                    </button>

                    {open ? (
                      <div className="mt-1 rounded border border-line-strong bg-surface-2 p-3">
                        <p className="mb-2 text-xs text-ink-faint">
                          {SESSION_TYPES[session.type].label}
                          {log?.rpe ? ` · RPE ${log.rpe}` : ''}
                          {log?.distanceKm ? ` · ${log.distanceKm} km` : ''}
                          {log?.feeling ? ` · ${FEELING_LABEL[log.feeling]}` : ''}
                          {session.progressionStep !== undefined
                            ? ` · Stufe ${session.progressionStep}`
                            : ''}
                        </p>

                        {log?.note ? (
                          <p className="mb-3 rounded border border-line bg-surface p-2 text-sm leading-relaxed text-ink">
                            {log.note}
                          </p>
                        ) : null}

                        <ul className="mb-3 space-y-1">
                          {session.content.map((block, i) => (
                            <li key={i} className="text-xs leading-relaxed text-ink-muted">
                              <span className="text-ink-faint">{block.label}:</span> {block.detail}
                            </li>
                          ))}
                        </ul>

                        {editingId === session.id ? (
                          <SessionLogForm
                            session={session}
                            onSaved={(records, souls) => {
                              setNewRecords(records);
                              setNewSouls(souls);
                              setEditingId(null);
                            }}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="primary" onClick={() => setEditingId(session.id)}>
                              Bearbeiten
                            </Button>
                            <Button
                              onClick={async () => {
                                await resetSessionStatus(session.id);
                                setOpenId(null);
                                setMessage(
                                  'Zurück auf geplant — der Eintrag zählt nicht mehr mit.',
                                );
                              }}
                            >
                              Zurück auf geplant
                            </Button>
                          </div>
                        )}

                        {editingId !== session.id ? (
                          <div className="mt-3 border-t border-line pt-3">
                            {confirmDeleteId === session.id ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-ink">
                                  Eintrag und Protokoll werden gelöscht.
                                </span>
                                <Button
                                  variant="danger"
                                  onClick={async () => {
                                    await deleteSession(session.id);
                                    setConfirmDeleteId(null);
                                    setOpenId(null);
                                    setMessage('Eintrag gelöscht.');
                                  }}
                                >
                                  Endgültig löschen
                                </Button>
                                <Button onClick={() => setConfirmDeleteId(null)}>Abbrechen</Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(session.id)}
                                className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger"
                              >
                                Eintrag löschen
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Section
          title="Bestwerte"
          hint="Die App erkennt neue Bestwerte selbst — eingetragen wird nur, was tatsächlich geschafft wurde."
        >
          {data.records.length === 0 ? (
            <Notice tone="info">
              Noch keine Bestwerte. Trag beim Abhaken einer Krafteinheit deine schwersten Sätze
              ein, dann erkennt die App den Rest.
            </Notice>
          ) : (
            <div className="space-y-2">
              {data.records.map(({ exercise, records }) => (
                <Card key={exercise.id}>
                  <p className="mb-2 font-medium text-ink">{exercise.name}</p>
                  <div className="space-y-1">
                    {records.map((record) => (
                      <div key={record.id} className="flex items-baseline justify-between gap-3">
                        <span className="text-xs text-ink-faint">{PR_KIND_LABEL[record.kind]}</span>
                        <span className="flex-1 border-b border-dotted border-line" />
                        <span className="text-sm text-ink tabular">{formatRecordValue(record)}</span>
                        <span className="w-20 shrink-0 text-right text-[11px] text-ink-faint tabular">
                          {formatShort(record.date)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
