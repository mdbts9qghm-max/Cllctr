/**
 * IndexedDB via Dexie. Eine Datenbank, alles auf dem Gerät.
 *
 * Indiziert wird nur, wonach tatsächlich gesucht oder sortiert wird — alle
 * übrigen Felder werden trotzdem gespeichert. Zusammengesetzte Indizes stehen
 * dort, wo Screens zwei Kriterien gleichzeitig filtern.
 */

import Dexie, { type Table } from 'dexie';
import type {
  DailyCheckIn,
  Exercise,
  Goal,
  Habit,
  HabitEntry,
  Meta,
  PersonalRecord,
  Profile,
  Settings,
  ShiftAssignment,
  ShiftPattern,
  ShiftType,
  StrengthSet,
  Task,
  TrainingPhase,
  TrainingSession,
  WeeklyReview,
} from './types';

export class CllctrDb extends Dexie {
  profile!: Table<Profile, string>;
  settings!: Table<Settings, string>;
  shiftTypes!: Table<ShiftType, string>;
  shiftAssignments!: Table<ShiftAssignment, string>;
  shiftPatterns!: Table<ShiftPattern, string>;
  phases!: Table<TrainingPhase, string>;
  sessions!: Table<TrainingSession, string>;
  exercises!: Table<Exercise, string>;
  strengthSets!: Table<StrengthSet, string>;
  checkIns!: Table<DailyCheckIn, string>;
  habits!: Table<Habit, string>;
  habitEntries!: Table<HabitEntry, string>;
  tasks!: Table<Task, string>;
  goals!: Table<Goal, string>;
  records!: Table<PersonalRecord, string>;
  reviews!: Table<WeeklyReview, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('cllctr');

    this.version(1).stores({
      profile: 'id',
      settings: 'id',
      shiftTypes: 'id, sortOrder',
      shiftAssignments: 'date, shiftTypeId',
      shiftPatterns: 'id, active',
      phases: 'id, startDate, kind',
      sessions: 'id, date, sport, status, [date+status], [sport+date]',
      exercises: 'id, name, archived',
      strengthSets: 'id, sessionId, exerciseId, date, [exerciseId+date]',
      checkIns: 'date',
      habits: 'id, active, sortOrder, category',
      habitEntries: 'id, habitId, date, [habitId+date]',
      tasks: 'id, status, dueDate, priority, category, [status+dueDate]',
      goals: 'id, active, kind',
      records: 'id, kind, date, exerciseId, [kind+date]',
      reviews: 'weekStart',
      meta: 'key',
    });
  }
}

/**
 * Eine Instanz für die ganze App.
 *
 * Auf dem Server (Build-Zeit) gibt es kein IndexedDB. Das ist unkritisch, weil
 * jeder Zugriff aus einer Client-Komponente kommt — Dexie legt die Verbindung
 * erst beim ersten echten Aufruf an.
 */
export const db = new CllctrDb();

/** Reihenfolge zählt: Der Import schreibt die Tabellen in dieser Folge. */
export const TABLE_NAMES = [
  'profile',
  'settings',
  'shiftTypes',
  'shiftPatterns',
  'shiftAssignments',
  'phases',
  'exercises',
  'sessions',
  'strengthSets',
  'checkIns',
  'habits',
  'habitEntries',
  'tasks',
  'goals',
  'records',
  'reviews',
  'meta',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
