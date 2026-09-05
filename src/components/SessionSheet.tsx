'use client';

/**
 * Eine Einheit anlegen, bearbeiten oder abhaken.
 *
 * Geplant und tatsächlich stehen nebeneinander — dasselbe Formular für beides.
 * Ein getrenntes „Protokoll"-Formular hätte bedeutet, dieselben Felder zweimal
 * zu pflegen und zweimal zu erklären.
 */

import { useState } from 'react';
import {
  SPORT_ICON,
  SPORT_LABEL,
  INTENSITY_LABEL,
  type Exercise,
  type HrZoneNumber,
  type Intensity,
  type IsoDate,
  type Sport,
  type TrainingSession,
} from '@/lib/types';
import {
  addSession,
  completeSession,
  deleteSession,
  saveStrengthSets,
  updateSession,
} from '@/lib/store';
import { Button, Field, Segmented, Sheet, inputClass } from './ui';

const SPORTS: Sport[] = ['run', 'bike', 'swim', 'strength', 'mobility', 'recovery', 'hike'];

export function SessionSheet({
  date,
  session,
  exercises,
  onClose,
}: {
  date: IsoDate;
  /** Null legt eine neue Einheit an. */
  session: TrainingSession | null;
  exercises: Exercise[];
  onClose: () => void;
}) {
  const [sport, setSport] = useState<Sport>(session?.sport ?? 'run');
  const [title, setTitle] = useState(session?.title ?? '');
  const [intensity, setIntensity] = useState<Intensity>(session?.intensity ?? 'easy');
  const [zone, setZone] = useState<string>(session?.zone ? String(session.zone) : '');
  const [plannedMin, setPlannedMin] = useState(session?.plannedMinutes?.toString() ?? '');
  const [plannedKm, setPlannedKm] = useState(session?.plannedDistanceKm?.toString() ?? '');
  const [actualMin, setActualMin] = useState(session?.actualMinutes?.toString() ?? '');
  const [actualKm, setActualKm] = useState(session?.actualDistanceKm?.toString() ?? '');
  const [rpe, setRpe] = useState(session?.rpe?.toString() ?? '');
  const [avgHr, setAvgHr] = useState(session?.avgHr?.toString() ?? '');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const [sets, setSets] = useState<
    Array<{ exerciseId: string; reps: string; weightKg: string }>
  >([{ exerciseId: exercises[0]?.id ?? '', reps: '', weightKg: '' }]);

  const numeric = (v: string): number | null => {
    const t = v.trim().replace(',', '.');
    return t === '' ? null : Number(t);
  };

  async function save(markDone: boolean) {
    setBusy(true);
    try {
      const name = title.trim() || `${SPORT_LABEL[sport]} ${INTENSITY_LABEL[intensity]}`;
      const base = {
        sport,
        title: name,
        intensity,
        zone: zone === '' ? null : (Number(zone) as HrZoneNumber),
        plannedMinutes: numeric(plannedMin),
        plannedDistanceKm: numeric(plannedKm),
      };

      let id = session?.id;
      if (!id) {
        const created = await addSession({ date, ...base });
        id = created.id;
      } else {
        await updateSession(id, base);
      }

      if (markDone) {
        await completeSession(id, {
          // Ohne Ist-Wert gilt der Plan als erfüllt: Wer abhakt, ohne etwas zu
          // ändern, hat genau das gemacht, was dastand.
          minutes: numeric(actualMin) ?? numeric(plannedMin),
          distanceKm: numeric(actualKm) ?? numeric(plannedKm),
          rpe: numeric(rpe),
          avgHr: numeric(avgHr),
          maxHr: session?.maxHr ?? null,
          notes,
        });
      } else if (session) {
        await updateSession(id, {
          actualMinutes: numeric(actualMin),
          actualDistanceKm: numeric(actualKm),
          rpe: numeric(rpe),
          avgHr: numeric(avgHr),
          notes,
        });
      }

      if (sport === 'strength') {
        const filled = sets
          .filter((s) => s.exerciseId && (s.reps || s.weightKg))
          .map((s) => ({
            exerciseId: s.exerciseId,
            reps: numeric(s.reps),
            weightKg: numeric(s.weightKg),
            timeSec: null,
          }));
        if (filled.length > 0) await saveStrengthSets(id, date, filled);
      }

      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={session ? 'Einheit bearbeiten' : 'Einheit planen'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Sportart
          </span>
          <div className="flex flex-wrap gap-1.5">
            {SPORTS.map((s) => (
              <button
                key={s}
                onClick={() => setSport(s)}
                aria-pressed={sport === s}
                className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                  sport === s
                    ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                    : 'border-line-strong text-ink-muted'
                }`}
              >
                <span aria-hidden="true">{SPORT_ICON[s]}</span> {SPORT_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <Field label="Titel" hint="Leer lassen — dann setzt die App einen ein.">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`${SPORT_LABEL[sport]} ${INTENSITY_LABEL[intensity]}`}
            className={inputClass}
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Intensität
          </span>
          <Segmented
            value={intensity}
            onChange={setIntensity}
            options={[
              { value: 'easy', label: 'Locker' },
              { value: 'moderate', label: 'Moderat' },
              { value: 'hard', label: 'Hart' },
            ]}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Geplant (min)">
            <input
              type="number"
              inputMode="numeric"
              value={plannedMin}
              onChange={(e) => setPlannedMin(e.target.value)}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Geplant (km)">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={plannedKm}
              onChange={(e) => setPlannedKm(e.target.value)}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Zone">
            <select value={zone} onChange={(e) => setZone(e.target.value)} className={inputClass}>
              <option value="">–</option>
              {[1, 2, 3, 4, 5].map((z) => (
                <option key={z} value={z}>
                  Zone {z}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Tatsächlich
          </p>
          <div className="grid grid-cols-4 gap-2">
            <Field label="min">
              <input
                type="number"
                inputMode="numeric"
                value={actualMin}
                onChange={(e) => setActualMin(e.target.value)}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="km">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={actualKm}
                onChange={(e) => setActualKm(e.target.value)}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="RPE">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                value={rpe}
                onChange={(e) => setRpe(e.target.value)}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Ø HF">
              <input
                type="number"
                inputMode="numeric"
                value={avgHr}
                onChange={(e) => setAvgHr(e.target.value)}
                className={`${inputClass} tabular`}
              />
            </Field>
          </div>
        </div>

        {sport === 'strength' && exercises.length > 0 ? (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Sätze
            </p>
            <div className="space-y-2">
              {sets.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_4rem_4rem] gap-2">
                  <select
                    value={row.exerciseId}
                    onChange={(e) =>
                      setSets((prev) =>
                        prev.map((r, j) => (i === j ? { ...r, exerciseId: e.target.value } : r)),
                      )
                    }
                    className={inputClass}
                  >
                    {exercises.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Wdh"
                    value={row.reps}
                    onChange={(e) =>
                      setSets((prev) =>
                        prev.map((r, j) => (i === j ? { ...r, reps: e.target.value } : r)),
                      )
                    }
                    className={`${inputClass} tabular`}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="kg"
                    value={row.weightKg}
                    onChange={(e) =>
                      setSets((prev) =>
                        prev.map((r, j) => (i === j ? { ...r, weightKg: e.target.value } : r)),
                      )
                    }
                    className={`${inputClass} tabular`}
                  />
                </div>
              ))}
            </div>
            <Button
              size="sm"
              className="mt-2"
              onClick={() =>
                setSets((prev) => [
                  ...prev,
                  { exerciseId: prev[prev.length - 1]?.exerciseId ?? exercises[0].id, reps: '', weightKg: '' },
                ])
              }
            >
              Satz hinzufügen
            </Button>
          </div>
        ) : null}

        <Field label="Notiz">
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inputClass} resize-none`}
          />
        </Field>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" disabled={busy} onClick={() => void save(true)}>
            Erledigt
          </Button>
          <Button disabled={busy} onClick={() => void save(false)}>
            {session ? 'Speichern' : 'Planen'}
          </Button>
          {session ? (
            confirmDelete ? (
              <Button
                variant="danger"
                onClick={() => {
                  void deleteSession(session.id).then(onClose);
                }}
              >
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
