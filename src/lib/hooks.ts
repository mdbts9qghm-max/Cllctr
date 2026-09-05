'use client';

/**
 * Die Brücke zwischen Datenbank und Oberfläche.
 *
 * Nur lesend. Geschrieben wird ausschließlich über `store.ts` — ein
 * Schreibzugriff aus einer laufenden `liveQuery` heraus lässt die Seite
 * abstürzen.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { ShiftContext } from './shifts';

export function useProfile() {
  return useLiveQuery(() => db.profile.get('singleton'), []);
}

export function useSettings() {
  return useLiveQuery(() => db.settings.get('singleton'), []);
}

export function useShiftContext(): ShiftContext | undefined {
  return useLiveQuery(async () => {
    const [shiftTypes, patterns, assignments] = await Promise.all([
      db.shiftTypes.orderBy('sortOrder').toArray(),
      db.shiftPatterns.toArray(),
      db.shiftAssignments.toArray(),
    ]);
    return {
      shiftTypes,
      pattern: patterns.find((p) => p.active) ?? null,
      assignments,
    };
  }, []);
}

export function useSessions() {
  return useLiveQuery(() => db.sessions.toArray(), []);
}

export function usePhases() {
  return useLiveQuery(() => db.phases.orderBy('startDate').toArray(), []);
}

export function useCheckIns() {
  return useLiveQuery(() => db.checkIns.toArray(), []);
}

export function useHabits() {
  return useLiveQuery(() => db.habits.orderBy('sortOrder').toArray(), []);
}

export function useHabitEntries() {
  return useLiveQuery(() => db.habitEntries.toArray(), []);
}

export function useTasks() {
  return useLiveQuery(() => db.tasks.toArray(), []);
}

export function useGoals() {
  return useLiveQuery(() => db.goals.toArray(), []);
}

export function useExercises() {
  return useLiveQuery(() => db.exercises.filter((e) => !e.archived).toArray(), []);
}

export function useRecords() {
  return useLiveQuery(() => db.records.toArray(), []);
}
