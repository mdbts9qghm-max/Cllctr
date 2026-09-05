'use client';

/**
 * Ziele.
 *
 * Ein Ziel braucht drei Zahlen: wo es losging, wo es steht, wo es hin soll.
 * Ohne den Ausgangswert wäre kein Fortschritt messbar — nur Abstand.
 */

import Link from 'next/link';
import { useState } from 'react';
import { formatClock, formatShort, num } from '@/lib/dates';
import { useGoals } from '@/lib/hooks';
import { deleteGoal, saveGoal } from '@/lib/store';
import { newId, now } from '@/lib/ids';
import { GOAL_KIND_LABEL, type Goal, type GoalKind } from '@/lib/types';
import { Bar, Button, Card, Chip, Empty, Field, Loading, Section, Sheet, inputClass } from '@/components/ui';

export default function ZielePage() {
  const goals = useGoals();
  const [editing, setEditing] = useState<Goal | null | undefined>(undefined);
  if (!goals) return <Loading />;

  return (
    <>
      <Link href="/profil" className="mb-5 inline-block text-xs text-ink-faint hover:text-ink">
        ‹ Profil
      </Link>

      <Section
        title="Ziele"
        action={
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            + Neu
          </Button>
        }
      >
        {goals.length === 0 ? (
          <Empty title="Keine Ziele">Ein Ziel ohne Zahl ist ein Wunsch.</Empty>
        ) : (
          <div className="space-y-2">
            {goals.map((goal) => {
              const span = goal.targetValue - goal.startValue;
              const moved = goal.currentValue - goal.startValue;
              const ratio = span === 0 ? 1 : Math.max(0, Math.min(1, moved / span));
              const fmt = (v: number) => (goal.unit === 's' ? formatClock(v) : `${num(v)} ${goal.unit}`);
              return (
                <Card key={goal.id}>
                  <button onClick={() => setEditing(goal)} className="w-full text-left">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink">{goal.title}</p>
                      <Chip>{GOAL_KIND_LABEL[goal.kind]}</Chip>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px] tabular text-ink-faint">
                      <span>Start {fmt(goal.startValue)}</span>
                      <span className="text-sm font-medium text-ink">{fmt(goal.currentValue)}</span>
                      <span>Ziel {fmt(goal.targetValue)}</span>
                    </div>
                    <Bar className="mt-2" ratio={ratio} tone={ratio >= 1 ? 'good' : 'accent'} />
                    <p className="mt-1.5 text-[11px] text-ink-faint">
                      {Math.round(ratio * 100)} % geschafft
                      {goal.targetDate ? ` · bis ${formatShort(goal.targetDate)}` : ''}
                      {goal.active ? '' : ' · pausiert'}
                    </p>
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {editing !== undefined ? (
        <GoalSheet goal={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
}

function GoalSheet({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const ts = now();
  const [draft, setDraft] = useState<Goal>(
    goal ?? {
      id: newId('goal'),
      title: '',
      kind: 'endurance',
      startValue: 0,
      currentValue: 0,
      targetValue: 0,
      unit: '',
      higherIsBetter: true,
      targetDate: null,
      active: true,
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    },
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (p: Partial<Goal>) => setDraft((d) => ({ ...d, ...p }));

  const numberField = (label: string, key: 'startValue' | 'currentValue' | 'targetValue') => (
    <Field label={label}>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        value={draft[key]}
        onChange={(e) => patch({ [key]: Number(e.target.value) } as Partial<Goal>)}
        className={`${inputClass} tabular`}
      />
    </Field>
  );

  return (
    <Sheet title={goal ? 'Ziel bearbeiten' : 'Neues Ziel'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Titel">
          <input
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="100 km Ultra"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Art">
            <select
              value={draft.kind}
              onChange={(e) => patch({ kind: e.target.value as GoalKind })}
              className={inputClass}
            >
              {(Object.keys(GOAL_KIND_LABEL) as GoalKind[]).map((k) => (
                <option key={k} value={k}>
                  {GOAL_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Einheit" hint="s für Zeiten — wird als mm:ss angezeigt.">
            <input
              value={draft.unit}
              onChange={(e) => patch({ unit: e.target.value })}
              placeholder="km, W, Wdh, s"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {numberField('Start', 'startValue')}
          {numberField('Aktuell', 'currentValue')}
          {numberField('Ziel', 'targetValue')}
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <input
            type="checkbox"
            checked={!draft.higherIsBetter}
            onChange={(e) => patch({ higherIsBetter: !e.target.checked })}
            className="size-4"
          />
          <span className="text-sm text-ink-muted">
            Kleiner ist besser <span className="text-ink-faint">(Zeiten, Gewicht abnehmen)</span>
          </span>
        </label>

        <Field label="Zieldatum" hint="Steuert auch die Periodisierung, wenn du rückwärts planst.">
          <input
            type="date"
            value={draft.targetDate ?? ''}
            onChange={(e) => patch({ targetDate: e.target.value || null })}
            className={`${inputClass} tabular`}
          />
        </Field>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => patch({ active: e.target.checked })}
            className="size-4"
          />
          <span className="text-sm text-ink-muted">Aktiv</span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!draft.title.trim()}
            onClick={() => void saveGoal(draft).then(onClose)}
          >
            Speichern
          </Button>
          {goal ? (
            confirmDelete ? (
              <Button variant="danger" onClick={() => void deleteGoal(goal.id).then(onClose)}>
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
