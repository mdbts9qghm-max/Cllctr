'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort, today } from '@/lib/dates';
import { useShiftContext } from '@/lib/hooks';
import { resolveShiftDay } from '@/lib/shifts';
import {
  allRoutinesStreak,
  isDaily,
  isOverdue,
  routineDays,
  routineFamily,
  routineGrid,
  routineStreak,
  taskEnergyBudget,
} from '@/lib/tasks';
import { completeTask, createTask, deleteTask, reopenTask } from '@/lib/task-store';
import {
  TASK_ENERGY_LABEL,
  TASK_KIND_LABEL,
  TASK_PRIORITY_LABEL,
  type RecurrenceKind,
  type Task,
  type TaskEnergy,
  type TaskKind,
  type TaskPriority,
} from '@/lib/types';
import { Button, Card, Field, inputClass, Notice, Section } from '@/components/ui';

const ENERGIES: TaskEnergy[] = ['light', 'focus', 'hard'];
const PRIORITIES: TaskPriority[] = [1, 2, 3];

const ENERGY_HINT: Record<TaskEnergy, string> = {
  light: 'Nebenbei erledigt — Müll, Spülmaschine, kurzer Anruf.',
  focus: 'Braucht Kopf und ein bis zwei Stunden — Papierkram, Termin vorbereiten.',
  hard: 'Zieht den Tag — Großputz, Umräumen, Reparatur.',
};

export default function AufgabenPage() {
  const ctx = useShiftContext();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<TaskKind>('chore');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [time, setTime] = useState('');
  const [energy, setEnergy] = useState<TaskEnergy>('light');
  const [priority, setPriority] = useState<TaskPriority>(2);
  const [recurrence, setRecurrence] = useState<RecurrenceKind | ''>('');
  const [showDone, setShowDone] = useState(false);

  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const todaySessions = useLiveQuery(
    () => db.sessions.where('date').equals(today()).toArray(),
    [],
  );

  if (!ctx || !tasks || !todaySessions) return <p className="text-sm text-ink-faint">Lade …</p>;

  const todayIso = today();
  const day = resolveShiftDay(todayIso, ctx);
  const budget = taskEnergyBudget(day, todaySessions);

  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 20);

  const appointments = open
    .filter((t) => t.kind === 'appointment')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const dailies = open
    .filter((t) => t.kind === 'chore' && isDaily(t))
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
  // Der Tagesstand der Routinen: erledigt heißt, es gibt für heute eine
  // abgehakte Instanz derselben Familie.
  const dailyState = dailies.map((task) => {
    const days = routineDays(tasks, routineFamily(task));
    return {
      task,
      days,
      doneToday: days.has(todayIso),
      streak: routineStreak(days, todayIso),
      grid: routineGrid(days, todayIso, 7),
    };
  });
  const doneToday = dailyState.filter((d) => d.doneToday).length;
  const allStreak = allRoutinesStreak(tasks, dailies.map(routineFamily), todayIso);

  const chores = open
    .filter((t) => t.kind === 'chore' && !isDaily(t))
    .sort((a, b) => {
      const rank = (t: Task) => (isOverdue(t, todayIso) ? 0 : t.dueDate ? 1 : 2);
      return rank(a) - rank(b) || a.priority - b.priority || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    });

  function resetForm() {
    // Auch die Art zurücksetzen: Blieb sie auf "Termin" stehen, landete die
    // nächste Aufgabe stillschweigend dort — und tauchte in "Täglich" nie auf.
    setKind('chore');
    setTitle('');
    setDueDate('');
    setTime('');
    setEnergy('light');
    setPriority(2);
    setRecurrence('');
    setAdding(false);
  }

  async function submit() {
    if (!title.trim()) return;
    await createTask({
      kind,
      title,
      dueDate: dueDate || null,
      time: time || null,
      energy,
      priority,
      recurrence: recurrence
        ? { kind: recurrence, interval: 1, weekdays: null, dayOfMonth: null }
        : null,
    });
    resetForm();
  }

  function TaskRow({ task, bare = false }: { task: Task; bare?: boolean }) {
    const overdue = isOverdue(task, todayIso);
    // Routinen laufen an der Energieprüfung vorbei — sie stehen auch an knappen
    // Tagen auf dem Heute-Screen. Das Etikett wäre hier ein Widerspruch.
    const fits =
      task.kind === 'appointment' || isDaily(task) || budget.allowed.includes(task.energy);

    return (
      <div
        className={`flex items-start gap-3 px-3 py-2.5 ${
          bare ? '' : 'rounded border border-line bg-surface'
        }`}
      >
        <button
          onClick={() => void (task.status === 'open' ? completeTask(task) : reopenTask(task.id))}
          aria-label={task.status === 'open' ? 'Abhaken' : 'Wieder öffnen'}
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs transition-colors ${
            task.status === 'done'
              ? 'border-ok bg-ok/20 text-ok'
              : 'border-line-strong hover:border-ember'
          }`}
        >
          {task.status === 'done' ? '✓' : ''}
        </button>

        <div className="min-w-0 flex-1">
          <p className={`text-sm ${task.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>
            {task.title}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint tabular">
            {task.dueDate ? formatShort(task.dueDate) : 'ohne Datum'}
            {task.time ? ` · ${task.time}` : ''}
            {task.kind === 'chore' ? ` · ${TASK_ENERGY_LABEL[task.energy]}` : ''}
            {task.priority !== 2 ? ` · ${TASK_PRIORITY_LABEL[task.priority]}` : ''}
            {task.recurrence ? ' · wiederkehrend' : ''}
            {overdue ? <span className="text-danger"> · überfällig</span> : null}
            {!fits && task.status === 'open' ? (
              <span className="text-ink-faint"> · heute nicht drin</span>
            ) : null}
          </p>
        </div>

        <button
          onClick={() => void deleteTask(task.id)}
          aria-label="Löschen"
          className="shrink-0 px-1 text-ink-faint hover:text-danger"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <>
      <Section title="Heute möglich" hint={budget.reason}>
        <Card>
          <div className="flex flex-wrap gap-2">
            {ENERGIES.map((e) => (
              <span
                key={e}
                className={`rounded border px-2.5 py-1 text-xs ${
                  budget.allowed.includes(e)
                    ? 'border-ok/50 text-ok'
                    : 'border-line text-ink-faint line-through'
                }`}
              >
                {TASK_ENERGY_LABEL[e]}
              </span>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Neu">
        {adding ? (
          <Card>
            <div className="mb-3 flex gap-2">
              {(['chore', 'appointment'] as TaskKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded border py-1.5 text-sm transition-colors ${
                    kind === k ? 'border-ember text-ember' : 'border-line-strong text-ink-muted'
                  }`}
                >
                  {TASK_KIND_LABEL[k]}
                </button>
              ))}
            </div>

            <div className="mb-3">
              <Field label="Was">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === 'appointment' ? 'Zahnarzt' : 'Wäsche'}
                  className={inputClass}
                  autoFocus
                />
              </Field>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <Field label={kind === 'appointment' ? 'Wann' : 'Fällig'}>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
              {kind === 'appointment' ? (
                <Field label="Uhrzeit">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              ) : (
                <Field label="Priorität">
                  <select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value) as TaskPriority)}
                    className={inputClass}
                  >
                    {PRIORITIES.map((pr) => (
                      <option key={pr} value={pr}>
                        {TASK_PRIORITY_LABEL[pr]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            {kind === 'chore' ? (
              <div className="mb-3">
                <p className="mb-1 text-sm text-ink-muted">Wie viel Energie</p>
                <div className="flex gap-2">
                  {ENERGIES.map((e) => (
                    <button
                      key={e}
                      onClick={() => setEnergy(e)}
                      className={`flex-1 rounded border py-1.5 text-xs transition-colors ${
                        energy === e ? 'border-ember text-ember' : 'border-line-strong text-ink-muted'
                      }`}
                    >
                      {TASK_ENERGY_LABEL[e]}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">{ENERGY_HINT[energy]}</p>
              </div>
            ) : null}

            <div className="mb-4">
              <Field label="Wiederholung">
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as RecurrenceKind | '')}
                  className={inputClass}
                >
                  <option value="">einmalig</option>
                  <option value="daily">täglich</option>
                  <option value="weekly">wöchentlich</option>
                  <option value="monthly">monatlich</option>
                </select>
              </Field>
              {recurrence === 'daily' && kind === 'chore' ? (
                <p className="mt-1 text-xs leading-relaxed text-ember">
                  Wird als Routine geführt: steht jeden Tag oben auf dem Heute-Screen, auch an
                  vollen Schichttagen.
                </p>
              ) : null}
              {recurrence === 'daily' && kind === 'appointment' ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                  Als Termin geführt, nicht als Routine. Für etwas, das du dir täglich vornimmst,
                  wähle oben „Haushalt".
                </p>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void submit()} disabled={!title.trim()}>
                Anlegen
              </Button>
              <Button onClick={resetForm}>Abbrechen</Button>
            </div>
          </Card>
        ) : (
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Aufgabe oder Termin
          </Button>
        )}
      </Section>

      {appointments.length > 0 ? (
        <Section title="Termine" hint="Liegen fest und werden immer angezeigt, egal wie der Tag aussieht.">
          <div className="space-y-1.5">
            {appointments.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        </Section>
      ) : null}

      {dailies.length > 0 ? (
        <Section
          title="Täglich"
          hint="Routinen. Erscheinen jeden Tag auf dem Heute-Screen, unabhängig von der Tagesenergie."
        >
          {/* Der Tagesstand als Kette: gefüllte Glieder sind erledigt. Kein
              Konfetti, aber sichtbar, wie weit der Tag ist. */}
          <Card className="mb-3">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="text-2xl font-semibold text-ink tabular">
                {doneToday}
                <span className="text-base font-normal text-ink-faint"> / {dailies.length}</span>
              </span>
              <span className="text-[11px] uppercase tracking-widest text-ink-faint">
                heute erledigt
              </span>
            </div>

            <div className="flex gap-1">
              {dailyState.map((d) => (
                <span
                  key={d.task.id}
                  title={d.task.title}
                  className={`h-1.5 flex-1 rounded-full ${d.doneToday ? 'bg-ember' : 'bg-line-strong'}`}
                />
              ))}
            </div>

            <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
              {allStreak === 0
                ? 'Noch kein voller Tag in Folge. Der erste zählt ab heute.'
                : `Alles erledigt an ${allStreak} ${allStreak === 1 ? 'Tag' : 'Tagen'} in Folge.`}
            </p>
          </Card>

          <div className="space-y-1.5">
            {dailyState.map(({ task: t, streak, grid }) => (
              <div key={t.id} className="rounded border border-line bg-surface">
                <TaskRow task={t} bare />
                <div className="flex items-center gap-3 border-t border-line px-3 py-2">
                  {/* Sieben Tage zurück. Eine Lücke sieht man sofort — genau
                      das ist der Antrieb, keine zu lassen. */}
                  <div className="flex gap-1" aria-label="Letzte sieben Tage">
                    {grid.map((cell) => (
                      <span
                        key={cell.date}
                        title={cell.date}
                        className={`size-2.5 rounded-sm ${
                          cell.done
                            ? 'bg-ember'
                            : cell.date === todayIso
                              ? 'border border-ember-dim'
                              : 'bg-line-strong'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="flex-1" />
                  <span
                    className={`text-[11px] tabular ${streak >= 2 ? 'text-ember' : 'text-ink-faint'}`}
                  >
                    {streak === 0 ? 'keine Serie' : `${streak} ${streak === 1 ? 'Tag' : 'Tage'} in Folge`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={`Haushalt (${chores.length})`}>
        {chores.length === 0 ? (
          <Notice tone="info">Nichts offen.</Notice>
        ) : (
          <div className="space-y-1.5">
            {chores.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        )}
      </Section>

      {done.length > 0 ? (
        <Section title="Erledigt">
          {showDone ? (
            <div className="space-y-1.5">
              {done.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <Button onClick={() => setShowDone(true)}>Letzte {done.length} anzeigen</Button>
          )}
        </Section>
      ) : null}
    </>
  );
}
