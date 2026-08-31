'use client';

import { useEffect, useState } from 'react';
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
import { AREA_READY_DAYS, buildPath, chunksOf, pathWindow, WAY_BY_KEY } from '@/lib/way';
import { WayPath } from '@/components/WayPath';
import Link from 'next/link';
import { addChunk, advanceWayLevel, evaluateWay, unlockNextArea } from '@/lib/way-store';

const ENERGIES: TaskEnergy[] = ['light', 'focus', 'hard'];
const PRIORITIES: TaskPriority[] = [1, 2, 3];

type View = 'weg' | 'routinen' | 'aufgaben';

const ROUTINE_GROUPS: Array<{ key: 'way' | 'own'; label: string }> = [
  { key: 'way', label: 'Aus dem Weg' },
  { key: 'own', label: 'Eigene Routinen' },
];

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'weg', label: 'Weg' },
  { key: 'routinen', label: 'Routinen' },
  { key: 'aufgaben', label: 'Aufgaben' },
];

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
  const [view, setView] = useState<View>('weg');
  const [showChunkPicker, setShowChunkPicker] = useState(false);
  const [wayMessage, setWayMessage] = useState<string | null>(null);

  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const areas = useLiveQuery(() => db.wayAreas.orderBy('order').toArray(), []);
  const todaySessions = useLiveQuery(
    () => db.sessions.where('date').equals(today()).toArray(),
    [],
  );

  if (!ctx || !tasks || !todaySessions || !areas) {
    return <p className="text-sm text-ink-faint">Lade …</p>;
  }

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

  const way = evaluateWay(areas, tasks, ctx, todayIso);
  const wayTemplate = way.area ? WAY_BY_KEY.get(way.area.key) : undefined;
  const wayChunks = way.area ? chunksOf(tasks, way.area.key) : [];
  const openChunks = wayChunks.filter((t) => t.status === 'open');
  const doneChunks = wayChunks.length - openChunks.length;
  const suggestedChunks = (wayTemplate?.chunks ?? []).filter(
    (title) => !wayChunks.some((t) => t.title === title),
  );
  const wayDoneToday = way.steps.filter((step) =>
    dailyState.some((d) => d.task.id === step.id && d.doneToday),
  ).length;
  const path = buildPath(areas, way.streak, way.readyForNext);
  const pathExcerpt = pathWindow(path, 1, 3);
  const pathDone = path.filter((n) => n.state === 'done').length;
  const upcomingAreas = areas.filter((a) => a.status === 'locked');

  const establishedAreas = areas.filter((a) => a.status === 'established');
  const allStreak = allRoutinesStreak(tasks, dailies.map(routineFamily), todayIso);

  const chores = open
    .filter((t) => t.kind === 'chore' && !isDaily(t))
    .sort((a, b) => {
      const rank = (t: Task) => (isOverdue(t, todayIso) ? 0 : t.dueDate ? 1 : 2);
      return rank(a) - rank(b) || a.priority - b.priority || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    });

  /**
   * Die Zahlen neben den Ansichten: was dort offen ist.
   *
   * Am Weg gibt es nichts abzuhaken — dort steht die Etappe, nicht ein Rest.
   * Deshalb bleibt er ohne Zahl statt eine zu erfinden. Eine Null wird ebenso
   * weggelassen: „Aufgaben 0" ist keine Information, sondern Rauschen.
   */
  const counts: Record<View, number | null> = {
    weg: null,
    routinen: dailies.length - doneToday,
    aufgaben: appointments.length + chores.length,
  };

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
      <WayLevelWatcher
        areaKey={way.area?.key ?? null}
        level={way.area?.level ?? 0}
        earned={way.earnedLevel}
        onAdvance={() => void advanceWayLevel(way)}
      />

      {wayMessage ? (
        <div className="mb-6">
          <Notice tone="ok">{wayMessage}</Notice>
        </div>
      ) : null}

      {/* Drei Aufgaben, drei Ansichten.
          Der Tab hatte sieben Abschnitte in einem Scroll: Weg, Energie, Neu,
          Termine, Routinen, Haushalt, Erledigt — alle gleich laut, alle
          gleichzeitig. Sie gehören zu drei verschiedenen Anlässen, also stehen
          sie jetzt auch getrennt. */}
      <div className="mb-6 flex gap-1 rounded-lg border border-line bg-surface p-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            aria-pressed={view === v.key}
            className={`flex-1 rounded px-2 py-2 text-xs transition-colors ${
              view === v.key
                ? 'bg-surface-2 font-medium text-ink'
                : 'text-ink-faint hover:text-ink-muted'
            }`}
          >
            {v.label}
            {counts[v.key] ? (
              <span className={view === v.key ? 'text-ember' : 'text-ink-faint'}>
                {' '}
                {counts[v.key]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {view === 'weg' ? (
        <>
      {way.area ? (
        <Section
          title="Aktuelle Etappe"
          hint="Ein Bereich nach dem anderen. Abgehakt wird unter Routinen — hier siehst du, wo du stehst."
        >
          <Card>
            <p className="text-[11px] uppercase tracking-widest text-ember">
              Etappe {way.area.order} von {areas.length}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-ink">{way.area.name}</h3>
            {wayTemplate ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">{wayTemplate.why}</p>
            ) : null}

            <div className="mt-4 flex items-baseline justify-between gap-3">
              <span className="text-2xl font-semibold text-ink tabular">
                {wayDoneToday}
                <span className="text-base font-normal text-ink-faint"> / {way.steps.length}</span>
              </span>
              <span
                className={`text-xs tabular ${way.streak >= 2 ? 'text-ember' : 'text-ink-faint'}`}
              >
                {way.streak === 0
                  ? 'Serie beginnt heute'
                  : `${way.streak} ${way.streak === 1 ? 'Tag' : 'Tage'} in Folge`}
              </span>
            </div>

            {/* Der Balken zeigt den Weg zur nächsten Etappe, nicht den Tag —
                der Tag steht schon als Zahl darüber. */}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-strong">
              <div
                className="h-full rounded-full bg-ember transition-all"
                style={{
                  width: `${Math.min(100, (way.streak / AREA_READY_DAYS) * 100)}%`,
                }}
              />
            </div>

            {/* Der Pfad: der Ausschnitt um die Stelle, an der du stehst. Der
                ganze Weg ist über zwanzig Knoten lang — der gehört auf eine
                eigene Seite, nicht an den Anfang des Tages. */}
            <div className="mt-4 border-t border-line pt-4">
              <WayPath nodes={pathExcerpt} />
            </div>

            <Link
              href="/weg"
              className="mt-1 block text-center text-xs text-ember underline underline-offset-2"
            >
              Den ganzen Weg ansehen ({pathDone} von {path.length})
            </Link>

            {way.readyForNext && upcomingAreas.length > 0 ? (
              <div className="mt-4 rounded border border-ember-dim bg-ember/10 p-3">
                <p className="text-sm leading-relaxed text-ink">
                  {AREA_READY_DAYS} Tage in Folge — {way.area.name} steht.{' '}
                  {openChunks.length > 0
                    ? `${openChunks.length} ${openChunks.length === 1 ? 'Brocken liegt' : 'Brocken liegen'} noch, das muss aber nicht warten.`
                    : ''}
                </p>
                <div className="mt-2">
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const next = await unlockNextArea();
                      setWayMessage(
                        next
                          ? `${next.name} ist dazugekommen. ${way.area?.name} läuft weiter.`
                          : null,
                      );
                    }}
                  >
                    {upcomingAreas[0].name} dazunehmen
                  </Button>
                </div>
              </div>
            ) : way.streak > 0 ? (
              <p className="mt-3 text-xs text-ink-faint">
                Noch {way.daysToNext} {way.daysToNext === 1 ? 'Tag' : 'Tage'}, bis der nächste
                Bereich dazukommen kann.
              </p>
            ) : null}
          </Card>

          {/* Brocken: der Rückstand, der in diesem Bereich liegt. */}
          <div className="mt-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-sm font-medium text-ink">Brocken</h4>
              <span className="text-[11px] text-ink-faint tabular">
                {doneChunks} von {wayChunks.length} abgearbeitet
              </span>
            </div>

            <div className="space-y-1.5">
              {openChunks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
              {wayChunks.length === 0 ? (
                <p className="text-xs leading-relaxed text-ink-faint">
                  Noch nichts eingetragen. Brocken sind der Rückstand, der in diesem Bereich
                  liegt — sie gehören nicht in die tägliche Serie, sie schrumpfen nur.
                </p>
              ) : null}
            </div>

            {showChunkPicker ? (
              <div className="mt-2 rounded border border-line bg-surface-2 p-3">
                <p className="mb-2 text-xs text-ink-faint">
                  Typisch für diesen Bereich. Eigene legst du unter „Neu" an.
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestedChunks.map((title) => (
                    <button
                      key={title}
                      onClick={() => void addChunk(way.area!.key, title)}
                      className="rounded border border-line-strong px-2.5 py-1 text-xs text-ink hover:border-ember"
                    >
                      + {title}
                    </button>
                  ))}
                  {suggestedChunks.length === 0 ? (
                    <span className="text-xs text-ink-faint">Alle Vorschläge übernommen.</span>
                  ) : null}
                </div>
                <button
                  onClick={() => setShowChunkPicker(false)}
                  className="mt-3 text-xs text-ink-faint underline underline-offset-2"
                >
                  Schließen
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowChunkPicker(true)}
                className="mt-2 text-xs text-ember underline underline-offset-2"
              >
                Brocken aus dem Katalog wählen
              </button>
            )}
          </div>

          {/* Was noch kommt und was schon läuft — schmal, damit es nicht ablenkt. */}
          {(establishedAreas.length > 0 || upcomingAreas.length > 0) && (
            <div className="mt-5 space-y-1">
              {establishedAreas.map((a) => (
                <div key={a.key} className="flex items-center gap-3 py-1.5 text-xs">
                  <span className="text-ok">✓</span>
                  <span className="flex-1 text-ink-muted">{a.name}</span>
                  <span className="text-ink-faint">läuft</span>
                </div>
              ))}
              {upcomingAreas.map((a) => (
                <div key={a.key} className="flex items-center gap-3 py-1.5 text-xs">
                  <span className="text-ink-faint">·</span>
                  <span className="flex-1 text-ink-faint">{a.name}</span>
                  <span className="text-ink-faint">später</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}
        </>
      ) : null}

      {view === 'routinen' ? (
        <>
      {dailies.length > 0 ? (
        <Section
          title="Jeden Tag"
          hint="Erscheinen jeden Tag auf dem Heute-Screen, unabhängig von der Tagesenergie. Schritte aus dem Weg stehen mit drin — eine Liste, ein Ort zum Abhaken."
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

          {ROUTINE_GROUPS.map((group) => {
            const rows = dailyState.filter((d) =>
              group.key === 'way' ? d.task.wayArea !== null : d.task.wayArea === null,
            );
            if (rows.length === 0) return null;
            return (
              <div key={group.key} className="mb-5">
                {/* Woher eine Routine kommt, entscheidet, ob man sie streichen
                    darf: ein Weg-Schritt gehört zur Etappe, eine eigene nicht. */}
                <div className="mb-2 flex items-baseline justify-between">
                  <h4 className="text-xs uppercase tracking-widest text-ink-faint">
                    {group.label}
                  </h4>
                  <span className="text-[11px] text-ink-faint tabular">
                    {rows.filter((d) => d.doneToday).length} / {rows.length}
                  </span>
                </div>

          <div className="space-y-1.5">
            {rows.map(({ task: t, streak, grid }) => (
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
              </div>
            );
          })}
        </Section>
      ) : null}
        </>
      ) : null}

      {view === 'aufgaben' ? (
        <>
      {/* Was der Tag hergibt — eine Zeile, keine eigene Sektion. Es ist der
          Rahmen für die Liste darunter, nicht selbst ein Thema. */}
      <div className="mb-6">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ENERGIES.map((e) => (
            <span
              key={e}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                budget.allowed.includes(e)
                  ? 'border-ok/50 text-ok'
                  : 'border-line text-ink-faint line-through'
              }`}
            >
              {TASK_ENERGY_LABEL[e]}
            </span>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-ink-faint">{budget.reason}</p>
      </div>

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

      <Section title={chores.length > 0 ? `Haushalt (${chores.length})` : 'Haushalt'}>
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
      ) : null}
    </>
  );
}

/**
 * Schreibt eine verdiente Stufe fort.
 *
 * Eine eigene Komponente, weil der Effekt nur laufen darf, wenn sich die Stufe
 * wirklich bewegt hat — und weil ein Schreibzugriff niemals im LiveQuery selbst
 * stehen darf, sonst stürzt die Seite ab.
 */
function WayLevelWatcher({
  areaKey,
  level,
  earned,
  onAdvance,
}: {
  areaKey: string | null;
  level: number;
  earned: number;
  onAdvance: () => void;
}) {
  useEffect(() => {
    if (areaKey && earned > level) onAdvance();
    // onAdvance schließt den aktuellen Zustand ein; als Abhängigkeit würde es
    // bei jedem Rendern neu feuern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, level, earned]);
  return null;
}
