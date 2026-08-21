/**
 * IndexedDB via Dexie. Eine Datenbank, alles lokal im Browser.
 *
 * Wichtig: Dexie-Indizes enthalten nur die Felder, nach denen wir suchen oder
 * sortieren. Alle anderen Felder werden trotzdem gespeichert.
 */

import Dexie, { type Table } from 'dexie';
import type {
  AppMeta,
  Exercise,
  Macrocycle,
  Mesocycle,
  Microcycle,
  PersonalRecord,
  Session,
  SessionLog,
  SetEntry,
  Settings,
  ShiftOverride,
  ShiftPattern,
  ShiftType,
  Soul,
  Task,
} from './types';

export class CllctrDb extends Dexie {
  shiftTypes!: Table<ShiftType, string>;
  shiftPatterns!: Table<ShiftPattern, string>;
  shiftOverrides!: Table<ShiftOverride, string>;
  macrocycles!: Table<Macrocycle, string>;
  mesocycles!: Table<Mesocycle, string>;
  microcycles!: Table<Microcycle, string>;
  sessions!: Table<Session, string>;
  sessionLogs!: Table<SessionLog, string>;
  exercises!: Table<Exercise, string>;
  setEntries!: Table<SetEntry, string>;
  personalRecords!: Table<PersonalRecord, string>;
  tasks!: Table<Task, string>;
  souls!: Table<Soul, string>;
  settings!: Table<Settings, string>;
  meta!: Table<AppMeta, string>;

  constructor() {
    super('cllctr');

    this.version(1).stores({
      shiftTypes: 'id, sortOrder',
      shiftPatterns: 'id, active',
      shiftOverrides: 'date',
      macrocycles: 'id, active, startDate',
      mesocycles: 'id, macrocycleId, index, startDate, status',
      microcycles: 'id, mesocycleId, index, startDate',
      sessions: 'id, microcycleId, date, status, discipline, type, [date+status]',
      sessionLogs: 'id, sessionId, date',
      exercises: 'id, discipline, archived',
      setEntries: 'id, sessionLogId, exerciseId, date, [exerciseId+date]',
      personalRecords: 'id, exerciseId, date, [exerciseId+kind]',
      tasks: 'id, status, dueDate, energy, priority, templateTaskId, [status+dueDate]',
      souls: 'id, key, collectedAt, rarity, sourceKind',
      settings: 'id',
      meta: 'key',
    });
  }
}

/**
 * Eine einzige Instanz für die ganze App. Wird beim ersten Import angelegt.
 * Auf dem Server (Build-Zeit) gibt es kein indexedDB — dort bleibt db ungenutzt,
 * weil alle Zugriffe in Client-Komponenten stattfinden.
 */
export const db = new CllctrDb();

/** Reihenfolge zählt: beim Import werden Tabellen in dieser Folge geschrieben. */
export const TABLE_NAMES = [
  'settings',
  'shiftTypes',
  'shiftPatterns',
  'shiftOverrides',
  'macrocycles',
  'mesocycles',
  'microcycles',
  'sessions',
  'sessionLogs',
  'exercises',
  'setEntries',
  'personalRecords',
  'tasks',
  'souls',
  'meta',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
