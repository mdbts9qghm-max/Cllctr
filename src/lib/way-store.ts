/**
 * Schreibzugriffe für den Weg.
 *
 * Die Regeln stehen in way.ts und rechnen nur; hier wird angelegt, freigegeben
 * und hochgestuft. Getrennt wie bei Plan und Seelen, damit die Auswertung in
 * einem LiveQuery laufen kann, ohne zu schreiben.
 */

import { db } from './db';
import { addDays, today } from './dates';
import { newId, now } from './ids';
import { resolveShiftRange, type ShiftContext } from './shifts';
import { routineDays, routineFamily } from './tasks';
import {
  AREA_READY_DAYS,
  levelFromStreak,
  stepsOf,
  WAY_BY_KEY,
  WAY_CATALOG,
  wayStreak,
} from './way';
import type { IsoDate, Task, WayArea } from './types';

/** Legt die Bereiche an, falls noch keine existieren. Hygiene startet aktiv. */
export async function seedWayIfEmpty(): Promise<void> {
  if ((await db.wayAreas.count()) > 0) return;
  const ts = now();

  const areas: WayArea[] = WAY_CATALOG.map((template) => ({
    key: template.key,
    name: template.name,
    order: template.order,
    status: template.order === 1 ? 'active' : 'locked',
    level: 0,
    startedAt: template.order === 1 ? today() : null,
    establishedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }));

  await db.wayAreas.bulkPut(areas);
  await ensureSteps(areas[0]);
}

/**
 * Legt die Schritte an, die zur Stufe des Bereichs gehören.
 *
 * Nur bis zur erreichten Stufe: was noch nicht dran ist, existiert auch nicht
 * als Aufgabe — sonst stünde die ganze Liste von Tag eins an unter "Täglich"
 * und genau das soll der Weg verhindern.
 *
 * Einmal gelöschte Schritte kommen nicht wieder: wer etwas streicht, hat sich
 * dabei etwas gedacht.
 */
export async function ensureSteps(area: WayArea): Promise<void> {
  const template = WAY_BY_KEY.get(area.key);
  if (!template) return;

  const existing = await db.tasks.where('wayArea').equals(area.key).toArray();
  const knownOrders = new Set(existing.map((t) => t.wayOrder).filter((n) => n !== null));

  const ts = now();
  const fresh: Task[] = [];

  for (let order = 0; order <= area.level && order < template.steps.length; order++) {
    if (knownOrders.has(order)) continue;
    const step = template.steps[order];
    fresh.push({
      id: newId('task'),
      kind: 'chore',
      title: step.title,
      notes: step.notes,
      dueDate: null,
      time: null,
      priority: 2,
      energy: step.energy,
      status: 'open',
      recurrence: { kind: 'daily', interval: 1, weekdays: null, dayOfMonth: null },
      templateTaskId: null,
      wayArea: area.key,
      wayOrder: order,
      completedAt: null,
      createdAt: ts,
      updatedAt: ts,
    });
  }

  if (fresh.length > 0) await db.tasks.bulkPut(fresh);
}

/** Tage, an denen der Weg ruht — Krankheit, Urlaub. */
function pausedDays(ctx: ShiftContext, from: IsoDate, to: IsoDate): Set<IsoDate> {
  const out = new Set<IsoDate>();
  for (const day of resolveShiftRange(from, to, ctx)) {
    if (day.shiftType.pausesRoutines) out.add(day.date);
  }
  return out;
}

export interface WayState {
  area: WayArea | null;
  steps: Task[];
  streak: number;
  /** Stufe, die die Serie hergibt — kann über der gespeicherten liegen. */
  earnedLevel: number;
  /** Reicht die Serie für den nächsten Bereich? */
  readyForNext: boolean;
  daysToNext: number;
}

/**
 * Der Stand des aktiven Bereichs. Rein lesend — sicher für ein LiveQuery.
 */
export function evaluateWay(
  areas: WayArea[],
  tasks: Task[],
  ctx: ShiftContext,
  reference: IsoDate = today(),
): WayState {
  const area = areas.find((a) => a.status === 'active') ?? null;
  if (!area) {
    return { area: null, steps: [], streak: 0, earnedLevel: 0, readyForNext: false, daysToNext: 0 };
  }

  const steps = stepsOf(tasks, area.key);
  const template = WAY_BY_KEY.get(area.key);
  const stepCount = template?.steps.length ?? steps.length;

  // `since` ist der Tag, an dem der Schritt dazukam — davor konnte man ihn
  // nicht erledigen, also darf er für frühere Tage auch nicht zählen.
  const withHistory = steps.map((step) => ({
    since: step.createdAt.slice(0, 10),
    days: routineDays(tasks, routineFamily(step)),
  }));
  const paused = pausedDays(ctx, addDays(reference, -400), reference);
  const streak = steps.length === 0 ? 0 : wayStreak(withHistory, paused, reference);

  return {
    area,
    steps,
    streak,
    earnedLevel: levelFromStreak(streak, stepCount),
    readyForNext: streak >= AREA_READY_DAYS,
    daysToNext: Math.max(0, AREA_READY_DAYS - streak),
  };
}

/**
 * Schreibt eine verdiente Stufe fort und legt den neuen Schritt an.
 *
 * Die Stufe sinkt nie: reißt die Serie, fängt sie neu an — was aufgebaut wurde,
 * bleibt. Gibt zurück, ob sich etwas geändert hat.
 */
export async function advanceWayLevel(state: WayState): Promise<boolean> {
  if (!state.area || state.earnedLevel <= state.area.level) return false;

  const updated: WayArea = {
    ...state.area,
    level: state.earnedLevel,
    updatedAt: now(),
  };
  await db.wayAreas.put(updated);
  await ensureSteps(updated);
  return true;
}

/**
 * Nimmt den nächsten Bereich dazu.
 *
 * Der bisherige wird nicht abgeschlossen, sondern **established**: seine
 * Routinen laufen weiter, sie stehen nur nicht mehr im Vordergrund. Etwas
 * "fertig" zu nennen, was täglich stattfindet, wäre eine Lüge.
 */
export async function unlockNextArea(): Promise<WayArea | null> {
  const areas = await db.wayAreas.toArray();
  const current = areas.find((a) => a.status === 'active') ?? null;
  const next = areas
    .filter((a) => a.status === 'locked')
    .sort((a, b) => a.order - b.order)[0];
  if (!next) return null;

  const ts = now();
  if (current) {
    await db.wayAreas.put({
      ...current,
      status: 'established',
      establishedAt: today(),
      updatedAt: ts,
    });
  }

  const started: WayArea = {
    ...next,
    status: 'active',
    startedAt: today(),
    updatedAt: ts,
  };
  await db.wayAreas.put(started);
  await ensureSteps(started);
  return started;
}

/** Legt einen vorgeschlagenen Brocken als Aufgabe an. */
export async function addChunk(areaKey: string, title: string): Promise<void> {
  const ts = now();
  await db.tasks.put({
    id: newId('task'),
    kind: 'chore',
    title,
    notes: '',
    dueDate: null,
    time: null,
    priority: 2,
    energy: 'focus',
    status: 'open',
    recurrence: null,
    templateTaskId: null,
    wayArea: areaKey,
    wayOrder: null,
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
  });
}
