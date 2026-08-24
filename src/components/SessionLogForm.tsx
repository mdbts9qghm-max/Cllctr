'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getSessionLog, logSession, type QuickLog } from '@/lib/plan-store';
import { formatRecordValue, PR_KIND_LABEL, recordSets, type SetInput } from '@/lib/pr';
import { syncSouls } from '@/lib/soul-store';
import type { Exercise, Session, SessionFeeling, Soul } from '@/lib/types';
import { Button, inputClass, Mark } from './ui';

const FEELINGS: Array<{ key: SessionFeeling; label: string }> = [
  { key: 'good', label: 'Gut' },
  { key: 'ok', label: 'Ging so' },
  { key: 'bad', label: 'Schlecht' },
];

interface SetRow {
  exerciseId: string;
  a: string;
  b: string;
}

/**
 * Das kurze Protokoll nach einer Einheit.
 *
 * Bewusst eine eigene Komponente, damit es überall verfügbar ist, wo eine
 * Einheit abgehakt wird — auf dem Heute-Screen wie im Plan. Bei Schichtarbeit
 * kommt man nicht immer am selben Tag dazu, und ein Protokoll, das nur "heute"
 * geht, wäre nach der ersten Nachtschicht wertlos.
 */
export function SessionLogForm({
  session,
  onSaved,
  onCancel,
}: {
  session: Session;
  onSaved: (newRecords: string[], newSouls: Soul[]) => void;
  onCancel: () => void;
}) {
  const [rpe, setRpe] = useState<number | null>(session.targetRpe);
  const [duration, setDuration] = useState<string>(String(session.plannedDurationMin ?? ''));
  const [distance, setDistance] = useState('');
  const [feeling, setFeeling] = useState<SessionFeeling | null>(null);
  const [note, setNote] = useState('');
  const [sets, setSets] = useState<SetRow[]>([]);

  /**
   * Was bereits protokolliert wurde.
   *
   * Ohne das startet "Protokoll bearbeiten" wieder bei den Planwerten — es
   * sieht dann so aus, als wäre nichts gespeichert worden, und beim Speichern
   * überschreibt man seine eigenen Zahlen mit den Vorgaben.
   */
  const saved = useLiveQuery(async () => {
    const log = await getSessionLog(session.id);
    const entries = log
      ? await db.setEntries.where('sessionLogId').equals(log.id).toArray()
      : [];
    return { log: log ?? null, entries };
  }, [session.id]);

  // Nur einmal übernehmen: sonst würde jede Änderung im Formular beim nächsten
  // Lauf des LiveQuery wieder zurückgesetzt.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !saved) return;
    seeded.current = true;
    if (!saved.log) return;

    setRpe(saved.log.rpe);
    setDuration(saved.log.durationMin === null ? '' : String(saved.log.durationMin));
    setDistance(saved.log.distanceKm === null ? '' : String(saved.log.distanceKm).replace('.', ','));
    setFeeling(saved.log.feeling);
    setNote(saved.log.note);
    setSets(
      saved.entries.map((e) => ({
        exerciseId: e.exerciseId,
        a: String(e.weightKg ?? e.reps ?? (e.timeSec !== null ? Math.floor(e.timeSec / 60) : null) ?? e.distanceM ?? ''),
        b: String(e.weightKg !== null ? (e.reps ?? '') : e.timeSec !== null ? e.timeSec % 60 : ''),
      })),
    );
  }, [saved]);

  // Passende Übungen: bei Kraft die Kraftübungen, beim Laufen die Distanzen.
  const exercises = useLiveQuery(
    async () =>
      (await db.exercises.toArray()).filter(
        (e) => !e.archived && e.discipline === session.discipline,
      ),
    [session.discipline],
  );

  /** Beschriftung der Eingabefelder, je nachdem was die Übung misst. */
  function fieldsFor(exercise: Exercise | undefined): { a: string; b: string | null } {
    if (!exercise) return { a: 'Wert', b: null };
    if (exercise.metric === 'weight') return { a: 'kg', b: 'Wdh.' };
    if (exercise.metric === 'reps') return { a: 'Wdh.', b: null };
    if (exercise.metric === 'time') return { a: 'Min', b: 'Sek' };
    return { a: 'Meter', b: null };
  }

  function toInput(row: SetRow, exercise: Exercise | undefined): SetInput | null {
    if (!exercise) return null;
    const a = Number(row.a.replace(',', '.'));
    const b = Number(row.b.replace(',', '.'));
    if (!a) return null;

    if (exercise.metric === 'weight') return { exerciseId: exercise.id, weightKg: a, reps: b || null };
    if (exercise.metric === 'reps') return { exerciseId: exercise.id, reps: a };
    if (exercise.metric === 'time') return { exerciseId: exercise.id, timeSec: a * 60 + (b || 0) };
    return { exerciseId: exercise.id, distanceM: a };
  }

  async function save() {
    const entry: QuickLog = {
      rpe,
      durationMin: duration ? Number(duration) : null,
      distanceKm: distance ? Number(distance.replace(',', '.')) : null,
      feeling,
      note: note.trim(),
    };
    await logSession(session, entry);

    const inputs = sets
      .map((row) => toInput(row, exercises?.find((e) => e.id === row.exerciseId)))
      .filter((x): x is SetInput => x !== null);

    // Beim Bearbeiten ersetzen, nicht anhängen: sonst stünde jeder Satz nach
    // dem zweiten Speichern doppelt im Verlauf und im Volumen.
    const log = await getSessionLog(session.id);
    if (log) {
      const old = await db.setEntries.where('sessionLogId').equals(log.id).toArray();
      if (old.length > 0) await db.setEntries.bulkDelete(old.map((e) => e.id));
    }

    let lines: string[] = [];
    if (inputs.length > 0) {
      const found = await recordSets(log?.id ?? null, session.date, inputs);
      lines = found.map(
        (r) =>
          `${r.exercise.name}: ${PR_KIND_LABEL[r.record.kind]} ${formatRecordValue(r.record)}` +
          (r.improvement !== null ? ` (+${r.improvement})` : ''),
      );
    }

    // Erst nach dem Schreiben auswerten — sonst sieht die Prüfung die neue
    // Einheit noch nicht.
    const souls = await syncSouls();
    onSaved(lines, souls);
  }

  return (
    <div className="rounded border border-ember-dim bg-ember/5 p-3">
      <p className="mb-2 text-[11px] uppercase tracking-widest text-ember">
        {saved?.log ? 'Protokoll bearbeiten' : 'Kurz protokollieren'}
      </p>

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

      {exercises && exercises.length > 0 ? (
        <div className="mb-3 border-t border-line pt-3">
          <p className="mb-1 text-xs text-ink-muted">
            Leistung eintragen — nur wenn etwas Erwähnenswertes dabei war
          </p>
          {sets.map((row, i) => {
            const exercise = exercises.find((e) => e.id === row.exerciseId);
            const fields = fieldsFor(exercise);
            return (
              <div key={i} className="mb-2 flex items-end gap-2">
                <select
                  value={row.exerciseId}
                  onChange={(e) => {
                    const next = [...sets];
                    next[i] = { ...row, exerciseId: e.target.value };
                    setSets(next);
                  }}
                  className={`${inputClass} flex-1`}
                >
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  value={row.a}
                  onChange={(e) => {
                    const next = [...sets];
                    next[i] = { ...row, a: e.target.value };
                    setSets(next);
                  }}
                  placeholder={fields.a}
                  aria-label={fields.a}
                  className={`${inputClass} w-16 tabular`}
                />
                {fields.b ? (
                  <input
                    type="number"
                    inputMode="numeric"
                    value={row.b}
                    onChange={(e) => {
                      const next = [...sets];
                      next[i] = { ...row, b: e.target.value };
                      setSets(next);
                    }}
                    placeholder={fields.b}
                    aria-label={fields.b}
                    className={`${inputClass} w-16 tabular`}
                  />
                ) : null}
                <button
                  onClick={() => setSets(sets.filter((_, j) => j !== i))}
                  aria-label="Zeile entfernen"
                  className="px-1 pb-2 text-ink-faint hover:text-danger"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            onClick={() => setSets([...sets, { exerciseId: exercises[0].id, a: '', b: '' }])}
            className="text-xs text-ember underline"
          >
            + Satz oder Zeit
          </button>
        </div>
      ) : null}

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
        <Button onClick={onCancel}>Abbrechen</Button>
      </div>
    </div>
  );
}

/** Meldung über neu erkannte Bestwerte und eingesammelte Seelen. */
export function NewRecordsNotice({ records, souls = [] }: { records: string[]; souls?: Soul[] }) {
  if (records.length === 0 && souls.length === 0) return null;
  return (
    <div className="mb-3 space-y-3">
      {records.length > 0 ? (
        <div className="rounded border border-ember bg-ember/10 p-3">
          <p className="mb-1 text-[11px] uppercase tracking-widest text-ember">
            {records.length === 1 ? 'Neuer Bestwert' : 'Neue Bestwerte'}
          </p>
          {records.map((line, i) => (
            <p key={i} className="text-sm text-ink">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {souls.length > 0 ? (
        <div className="rounded border border-ember bg-ember/10 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-widest text-ember">
            {souls.length === 1 ? 'Seele eingesammelt' : `${souls.length} Seelen eingesammelt`}
          </p>
          {souls.map((soul) => (
            <div key={soul.id} className="mb-2 last:mb-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <Mark
                  variant={
                    soul.rarity === 'legendary' ? 'solid' : soul.rarity === 'rare' ? 'half' : 'outline'
                  }
                  className="text-ember"
                />
                {soul.name}
              </p>
              <p className="text-xs leading-relaxed text-ink-muted">{soul.description}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
