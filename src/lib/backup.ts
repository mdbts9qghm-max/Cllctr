/**
 * Export und Import als JSON-Datei.
 *
 * Lokale Daten sind weg, sobald der Browser-Speicher geleert wird. Das hier
 * ist die einzige Sicherung, die es gibt — deshalb schon in Phase 1 und nicht
 * am Ende.
 */

import { db, TABLE_NAMES, type TableName } from './db';
import { now } from './ids';
import { SCHEMA_VERSION } from './types';

export const BACKUP_FORMAT = 'cllctr-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  /** Anzahl Datensätze pro Tabelle — erlaubt eine Vorschau vor dem Import. */
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/** Liest die komplette Datenbank aus und baut die Backup-Struktur. */
export async function buildBackup(): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  await db.transaction('r', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      const rows = await db.table(name).toArray();
      data[name] = rows;
      counts[name] = rows.length;
    }
  });

  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    counts,
    data,
  };
}

/** Dateiname mit Datum, damit mehrere Sicherungen nebeneinander liegen können. */
export function backupFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `cllctr-backup-${y}${m}${d}-${hh}${mm}.json`;
}

/** Löst den Download der Backup-Datei aus. Nur im Browser aufrufen. */
export async function downloadBackup(): Promise<{ filename: string; totalRows: number }> {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = backupFilename();

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst nach dem Klick freigeben, sonst bricht der Download in Safari ab.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  const totalRows = Object.values(backup.counts).reduce((a, b) => a + b, 0);
  return { filename, totalRows };
}

export class BackupValidationError extends Error {}

/**
 * Prüft eine eingelesene Datei, bevor irgendetwas geschrieben wird.
 * Lieber hier abbrechen als eine halb importierte Datenbank hinterlassen.
 */
export function parseBackup(raw: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupValidationError('Die Datei ist kein gültiges JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupValidationError('Die Datei enthält kein Objekt.');
  }

  const candidate = parsed as Partial<BackupFile>;

  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupValidationError(
      'Das ist keine Cllctr-Sicherung. Erwartet wird eine Datei, die mit "cllctr-backup" beginnt.',
    );
  }

  if (typeof candidate.schemaVersion !== 'number') {
    throw new BackupValidationError('Der Sicherung fehlt die Versionsangabe.');
  }

  if (candidate.schemaVersion > SCHEMA_VERSION) {
    throw new BackupValidationError(
      `Die Sicherung stammt aus einer neueren Version (${candidate.schemaVersion}) als diese App (${SCHEMA_VERSION}). Bitte die App aktualisieren.`,
    );
  }

  if (typeof candidate.data !== 'object' || candidate.data === null) {
    throw new BackupValidationError('Der Sicherung fehlt der Datenteil.');
  }

  const data = candidate.data as Record<string, unknown>;
  const unknownTables = Object.keys(data).filter(
    (key) => !(TABLE_NAMES as readonly string[]).includes(key),
  );
  if (unknownTables.length > 0) {
    throw new BackupValidationError(
      `Unbekannte Tabellen in der Sicherung: ${unknownTables.join(', ')}.`,
    );
  }

  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(`Tabelle "${key}" ist keine Liste.`);
    }
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: candidate.schemaVersion,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : '',
    counts: (candidate.counts as Record<string, number>) ?? {},
    data: data as Record<string, unknown[]>,
  };
}

export type ImportMode =
  /** Alles löschen, dann die Sicherung einspielen. Stellt den Stand exakt wieder her. */
  | 'replace'
  /** Vorhandenes behalten, Datensätze mit gleicher Id überschreiben. */
  | 'merge';

export interface ImportResult {
  mode: ImportMode;
  written: Record<string, number>;
  totalRows: number;
}

/** Spielt eine geprüfte Sicherung ein. Läuft komplett in einer Transaktion. */
export async function applyBackup(backup: BackupFile, mode: ImportMode): Promise<ImportResult> {
  const written: Record<string, number> = {};

  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') {
      for (const name of TABLE_NAMES) {
        await db.table(name).clear();
      }
    }

    for (const name of TABLE_NAMES) {
      const rows = backup.data[name];
      if (!rows || rows.length === 0) {
        written[name] = 0;
        continue;
      }
      await db.table(name as TableName).bulkPut(rows);
      written[name] = rows.length;
    }
  });

  return {
    mode,
    written,
    totalRows: Object.values(written).reduce((a, b) => a + b, 0),
  };
}

/** Liest eine vom Nutzer gewählte Datei ein. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsText(file);
  });
}
