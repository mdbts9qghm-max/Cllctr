/**
 * Datenbank-Operationen für Aufgaben und Termine.
 */

import { db } from './db';
import { today } from './dates';
import { newId, now } from './ids';
import { nextOccurrence } from './tasks';
import type { Task, TaskEnergy, TaskKind, TaskPriority, Recurrence } from './types';

export interface TaskDraft {
  kind: TaskKind;
  /** Bereich des Wegs, falls die Aufgabe dorthin gehört. */
  wayArea?: string | null;
  wayOrder?: number | null;
  title: string;
  notes?: string;
  dueDate?: string | null;
  time?: string | null;
  priority?: TaskPriority;
  energy?: TaskEnergy;
  recurrence?: Recurrence | null;
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const ts = now();
  const task: Task = {
    id: newId('task'),
    kind: draft.kind,
    title: draft.title.trim(),
    notes: draft.notes?.trim() ?? '',
    dueDate: draft.dueDate ?? null,
    time: draft.kind === 'appointment' ? (draft.time ?? null) : null,
    priority: draft.priority ?? 2,
    // Termine haben keinen Energiebedarf — sie finden statt.
    energy: draft.kind === 'appointment' ? 'light' : (draft.energy ?? 'light'),
    status: 'open',
    recurrence: draft.recurrence ?? null,
    templateTaskId: null,
    wayArea: draft.wayArea ?? null,
    wayOrder: draft.wayOrder ?? null,
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.tasks.put(task);
  return task;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await db.tasks.update(id, { ...patch, updatedAt: now() });
}

export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}

/**
 * Hakt eine Aufgabe ab.
 *
 * Bei einer Wiederholung entsteht sofort die nächste Instanz. Die erledigte
 * bleibt als Verlauf stehen — sonst wäre nach einem Jahr nicht mehr
 * nachvollziehbar, wie oft etwas tatsächlich gemacht wurde.
 */
export async function completeTask(task: Task): Promise<Task | null> {
  const ts = now();
  let next: Task | null = null;

  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.update(task.id, { status: 'done', completedAt: ts, updatedAt: ts });

    if (task.recurrence) {
      const base = task.dueDate ?? today();
      next = {
        ...task,
        id: newId('task'),
        dueDate: nextOccurrence(base, task.recurrence),
        status: 'open',
        completedAt: null,
        templateTaskId: task.templateTaskId ?? task.id,
        createdAt: ts,
        updatedAt: ts,
      };
      await db.tasks.put(next);
    }
  });

  return next;
}

export async function reopenTask(id: string): Promise<void> {
  await db.tasks.update(id, { status: 'open', completedAt: null, updatedAt: now() });
}
