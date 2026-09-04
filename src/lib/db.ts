/**
 * IndexedDB via Dexie. Eine Datenbank, alles lokal im Browser.
 *
 * Wichtig: Dexie-Indizes enthalten nur die Felder, nach denen wir suchen oder
 * sortieren. Alle anderen Felder werden trotzdem gespeichert.
 */

import Dexie, { type Table } from 'dexie';
import type {
  AppMeta,
  DayReadiness,
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
  WayArea,
} from './types';

export class CllctrDb extends Dexie {
  shiftTypes!: Table<ShiftType, string>;
  shiftPatterns!: Table<ShiftPattern, string>;
  shiftOverrides!: Table<ShiftOverride, string>;
  readiness!: Table<DayReadiness, string>;
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
  wayAreas!: Table<WayArea, string>;
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
      tasks: 'id, status, dueDate, energy, priority, templateTaskId, wayArea, [status+dueDate]',
      souls: 'id, key, collectedAt, rarity, sourceKind',
      wayAreas: 'key, order, status',
      settings: 'id',
      meta: 'key',
    });

    // Version 2: Tabelle `readiness` — Schlaf und Erholung pro Tag.
    //
    // Als eigene Version und nicht als stille Ergänzung von Version 1: Eine
    // bestehende Datenbank steht auf IndexedDB-Version 1 und bekommt ohne
    // erhöhte Nummer kein `onupgradeneeded` — die neue Tabelle würde schlicht
    // fehlen. Die volle Schemabeschreibung wird wiederholt, weil Dexie sie als
    // Endzustand liest, nicht als Differenz.
    this.version(2).stores({
      shiftTypes: 'id, sortOrder',
      shiftPatterns: 'id, active',
      shiftOverrides: 'date',
      readiness: 'date, recovery',
      macrocycles: 'id, active, startDate',
      mesocycles: 'id, macrocycleId, index, startDate, status',
      microcycles: 'id, mesocycleId, index, startDate',
      sessions: 'id, microcycleId, date, status, discipline, type, [date+status]',
      sessionLogs: 'id, sessionId, date',
      exercises: 'id, discipline, archived',
      setEntries: 'id, sessionLogId, exerciseId, date, [exerciseId+date]',
      personalRecords: 'id, exerciseId, date, [exerciseId+kind]',
      tasks: 'id, status, dueDate, energy, priority, templateTaskId, wayArea, [status+dueDate]',
      souls: 'id, key, collectedAt, rarity, sourceKind',
      wayAreas: 'key, order, status',
      settings: 'id',
      meta: 'key',
    });

    // Version 3: `readiness` verliert den Index auf `recovery` — das Feld gibt
    // es nicht mehr. Die Erholungsstufe wird geschätzt (`recovery.ts`) und
    // nicht gespeichert; ein Index auf eine Zahl, die niemand mehr schreibt,
    // wäre nur eine Fußangel für die nächste Abfrage.
    this.version(3)
      .stores({ readiness: 'date' })
      .upgrade(async (tx) => {
        // Bestehende Einträge auf die flache Form bringen: Die Messwerte lagen
        // eine Version lang in einem `whoop`-Objekt, und `recovery`/`sleepDebt`
        // waren eingetragene Stufen. Beides wandert bzw. entfällt.
        const rows = await tx.table('readiness').toArray();
        for (const row of rows) {
          const whoop = row.whoop ?? {};
          await tx.table('readiness').put({
            date: row.date,
            sleepHours: whoop.sleepHours ?? row.sleepHours ?? null,
            recoveryPct: whoop.recoveryPct ?? null,
            sleepDebtHours: whoop.sleepDebtHours ?? null,
            strain: whoop.strain ?? null,
            hrvMs: whoop.hrvMs ?? null,
            restingHr: whoop.restingHr ?? null,
            note: row.note ?? '',
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          });
        }
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
  'readiness',
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
  'wayAreas',
  'meta',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
