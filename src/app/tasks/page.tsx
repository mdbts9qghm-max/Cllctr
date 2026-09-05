'use client';

/**
 * Aufgaben.
 *
 * Ein vollwertiger Task-Manager, aber mit einer Zutat, die andere nicht haben:
 * dem Aufwand. Er verbindet die Liste mit dem Training — nach einer harten
 * Einheit steht das Großprojekt nicht mehr oben.
 */

import { useState } from 'react';
import { formatShort, today } from '@/lib/dates';
import { useCheckIns, useHabits, useSessions, useShiftContext, useTasks } from '@/lib/hooks';
import { effortBudget, isOverdue, suggestTasks } from '@/lib/tasks';
import { buildBaseline, estimateRecovery } from '@/lib/recovery';
import { resolveDay } from '@/lib/shifts';
import { completeTask, deleteTask, reopenTask, saveTask } from '@/lib/store';
import { newId, now } from '@/lib/ids';
import {
  TASK_CATEGORY_LABEL,
  TASK_EFFORT_LABEL,
  TASK_PRIORITY_LABEL,
  type Habit,
  type Task,
  type TaskCategory,
  type TaskEffort,
  type TaskPriority,
} from '@/lib/types';
import {
  Button,
  Card,
  Chip,
  Dot,
  Empty,
  Field,
  Loading,
  Section,
  Segmented,
  Sheet,
  inputClass,
} from '@/components/ui';

type Filter = 'today' | 'open' | 'done';

export default function TasksPage() {
  const todayIso = today();
  const tasks = useTasks();
  const habits = useHabits();
  const sessions = useSessions();
  const checkIns = useCheckIns();
  const ctx = useShiftContext();
  const [filter, setFilter] = useState<Filter>('today');
  const [editing, setEditing] = useState<Task | null | undefined>(undefined);

  if (!tasks || !habits || !sessions || !checkIns || !ctx) return <Loading />;

  const day = resolveDay(todayIso, ctx);
  const estimate = estimateRecovery(
    checkIns.find((c) => c.date === todayIso),
    buildBaseline(checkIns, todayIso),
    { afterNightShift: day.afterNightShift },
  );
  const budget = effortBudget({
    shiftCapability: day.shift.capability,
    hadHardSession: sessions.some((s) => s.date === todayIso && s.intensity === 'hard'),
    recovery: estimate.status,
  });

  const open = tasks.filter((t) => t.status === 'open');
  const overdue = open.filter((t) => isOverdue(t, todayIso));
  const suggested = suggestTasks(open, budget.allowed, todayIso, 20);

  const visible =
    filter === 'today'
      ? suggested
      : filter === 'open'
        ? [...open].sort(
            (a, b) =>
              (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.priority - b.priority,
          )
        : tasks
            .filter((t) => t.status === 'done')
            .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
            .slice(0, 50);

  return (
    <>
      <div className="mb-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'today', label: 'Heute' },
            { value: 'open', label: `Offen ${open.length}` },
            { value: 'done', label: 'Erledigt' },
          ]}
        />
      </div>

      {filter === 'today' ? (
        <p className="mb-4 px-0.5 text-xs leading-relaxed text-ink-faint">{budget.reason}</p>
      ) : null}

      {overdue.length > 0 && filter !== 'done' ? (
        <div className="mb-4">
          <Card tone="quiet">
            <p className="text-sm text-ink">
              <span className="font-semibold text-[color:var(--color-warn)]">
                {overdue.length} überfällig
              </span>{' '}
              — {overdue.slice(0, 3).map((t) => t.title).join(', ')}
              {overdue.length > 3 ? ' …' : ''}
            </p>
          </Card>
        </div>
      ) : null}

      <Section
        title={filter === 'done' ? 'Erledigt' : 'Aufgaben'}
        action={
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            + Neu
          </Button>
        }
      >
        {visible.length === 0 ? (
          <Empty title={filter === 'done' ? 'Noch nichts erledigt' : 'Nichts offen'}>
            {filter === 'today' && open.length > 0
              ? 'Es gibt offene Aufgaben, aber keine passt zum heutigen Tag.'
              : 'Leg eine Aufgabe an.'}
          </Empty>
        ) : (
          <div className="space-y-2">
            {visible.map((task) => (
              <Card key={task.id}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() =>
                      task.status === 'done'
                        ? void reopenTask(task)
                        : void completeTask(task, todayIso)
                    }
                    aria-label={`${task.title} ${task.status === 'done' ? 'wieder öffnen' : 'erledigen'}`}
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs ${
                      task.status === 'done'
                        ? 'border-[color:var(--color-good)] bg-[color:var(--color-good)] text-black'
                        : 'border-line-strong'
                    }`}
                  >
                    {task.status === 'done' ? '✓' : ''}
                  </button>

                  <button
                    onClick={() => setEditing(task)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span
                      className={`block text-sm ${
                        task.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'
                      }`}
                    >
                      {task.title}
                    </span>
                    {task.notes ? (
                      <span className="mt-0.5 block truncate text-xs text-ink-faint">
                        {task.notes}
                      </span>
                    ) : null}
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip tone={task.priority === 1 ? 'warn' : task.priority === 2 ? 'ok' : 'good'}>
                        {TASK_PRIORITY_LABEL[task.priority]}
                      </Chip>
                      <Chip>{TASK_CATEGORY_LABEL[task.category]}</Chip>
                      <Chip>{TASK_EFFORT_LABEL[task.effort]}</Chip>
                      {task.dueDate ? (
                        <Chip tone={isOverdue(task, todayIso) ? 'warn' : 'neutral'}>
                          {formatShort(task.dueDate)}
                          {task.time ? ` ${task.time}` : ''}
                        </Chip>
                      ) : null}
                      {task.recurrence ? <Chip>wiederkehrend</Chip> : null}
                    </span>
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {editing !== undefined ? (
        <TaskSheet task={editing} habits={habits} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
}

function emptyTask(): Task {
  const ts = now();
  return {
    id: newId('task'),
    title: '',
    notes: '',
    priority: 2,
    category: 'private',
    effort: 'quick',
    dueDate: null,
    time: null,
    recurrence: null,
    status: 'open',
    habitId: null,
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

function TaskSheet({
  task,
  habits,
  onClose,
}: {
  task: Task | null;
  habits: Habit[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Task>(task ?? emptyTask());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (p: Partial<Task>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Sheet title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Titel">
          <input
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Beschreibung">
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            className={`${inputClass} resize-none`}
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Priorität
          </span>
          <Segmented
            value={String(draft.priority) as '1' | '2' | '3'}
            onChange={(v) => patch({ priority: Number(v) as TaskPriority })}
            options={[
              { value: '1', label: 'Wichtig' },
              { value: '2', label: 'Normal' },
              { value: '3', label: 'Niedrig' },
            ]}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Aufwand
          </span>
          <Segmented
            value={draft.effort}
            onChange={(effort: TaskEffort) => patch({ effort })}
            options={[
              { value: 'quick', label: 'Kurz' },
              { value: 'focus', label: 'Fokussiert' },
              { value: 'heavy', label: 'Aufwendig' },
            ]}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
            Entscheidet, ob die Aufgabe an einem Schichttag oder nach einer harten Einheit
            überhaupt vorgeschlagen wird.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fällig">
            <input
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(e) => patch({ dueDate: e.target.value || null })}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Uhrzeit">
            <input
              type="time"
              value={draft.time ?? ''}
              onChange={(e) => patch({ time: e.target.value || null })}
              className={`${inputClass} tabular`}
            />
          </Field>
        </div>

        <Field label="Kategorie">
          <select
            value={draft.category}
            onChange={(e) => patch({ category: e.target.value as TaskCategory })}
            className={inputClass}
          >
            {(Object.keys(TASK_CATEGORY_LABEL) as TaskCategory[]).map((c) => (
              <option key={c} value={c}>
                {TASK_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Wiederholung">
          <select
            value={draft.recurrence?.kind ?? ''}
            onChange={(e) =>
              patch({
                recurrence: e.target.value
                  ? {
                      kind: e.target.value as 'daily' | 'weekly' | 'monthly',
                      interval: 1,
                      weekdays: null,
                      dayOfMonth: null,
                    }
                  : null,
              })
            }
            className={inputClass}
          >
            <option value="">Keine</option>
            <option value="daily">Täglich</option>
            <option value="weekly">Wöchentlich</option>
            <option value="monthly">Monatlich</option>
          </select>
        </Field>

        {habits.length > 0 ? (
          <Field
            label="Mit Habit verknüpfen"
            hint="Abhaken erfüllt beides — zweimal dasselbe abzuhaken vergisst man ohnehin."
          >
            <select
              value={draft.habitId ?? ''}
              onChange={(e) => patch({ habitId: e.target.value || null })}
              className={inputClass}
            >
              <option value="">Keiner</option>
              {habits.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="primary"
            disabled={!draft.title.trim()}
            onClick={() => void saveTask(draft).then(onClose)}
          >
            Speichern
          </Button>
          {task ? (
            confirmDelete ? (
              <Button variant="danger" onClick={() => void deleteTask(task.id).then(onClose)}>
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
