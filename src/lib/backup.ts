/**
 * Export und Import.
 *
 * Die Daten liegen nur auf diesem Gerät. Die Exportdatei ist die einzige Kopie,
 * die es gibt — deshalb ist sie vollständig, lesbar und versioniert. Kein
 * Binärformat: Wer sie in fünf Jahren öffnet, soll sie auch ohne diese App noch
 * verstehen.
 */

import { db, TABLE_NAMES, type TableName } from './db';
import { today } from './dates';
import { minutesOf, distanceOf, loadOf } from './load';
import { SCHEMA_VERSION, SPORT_LABEL, type TrainingSession } from './types';

const FORMAT = 'cllctr-backup';

export interface BackupFile {
  format: typeof FORMAT;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

export class BackupError extends Error {}

export async function createBackup(): Promise<BackupFile> {
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
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    data,
  };
}

export function backupFilename(): string {
  return `cllctr-${today()}.json`;
}

/** Löst den Download aus. Nur im Browser aufrufbar. */
export function downloadJson(content: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(content, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst freigeben, wenn der Klick verarbeitet ist — sofort widerrufen bricht
  // den Download in manchen Browsern ab.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Trainingseinheiten als CSV.
 *
 * Semikolon als Trenner und Komma als Dezimalzeichen: So öffnet die Datei in
 * einem deutschen Excel ohne Importdialog. Ein Komma-getrenntes CSV landet dort
 * komplett in Spalte A.
 */
export function sessionsToCsv(sessions: TrainingSession[]): string {
  const head = [
    'Datum',
    'Sportart',
    'Titel',
    'Intensität',
    'Zone',
    'Status',
    'Minuten geplant',
    'Minuten tatsächlich',
    'km geplant',
    'km tatsächlich',
    'RPE',
    'Ø HF',
    'Max HF',
    'Belastung',
    'Notiz',
  ];

  const rows = [...sessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) =>
      [
        s.date,
        SPORT_LABEL[s.sport],
        s.title,
        s.intensity,
        s.zone ?? '',
        s.status,
        s.plannedMinutes ?? '',
        s.actualMinutes ?? '',
        de(s.plannedDistanceKm),
        de(s.actualDistanceKm),
        s.rpe ?? '',
        s.avgHr ?? '',
        s.maxHr ?? '',
        loadOf(s),
        s.notes,
      ].map(csvCell).join(';'),
    );

  return [head.join(';'), ...rows].join('\n');
}

function de(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export function downloadCsv(content: string, filename: string): void {
  // BOM voran, sonst zeigt Excel Umlaute als Kauderwelsch.
  triggerDownload(new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' }), filename);
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('Die Datei ist kein gültiges JSON.');
  }

  const candidate = parsed as Partial<BackupFile>;
  if (candidate.format !== FORMAT) {
    throw new BackupError('Das ist keine Cllctr-Sicherung.');
  }
  if (typeof candidate.schemaVersion !== 'number') {
    throw new BackupError('Der Sicherung fehlt die Versionsangabe.');
  }
  if (candidate.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      `Die Sicherung stammt aus einer neueren Version (${candidate.schemaVersion}) als diese App (${SCHEMA_VERSION}).`,
    );
  }
  if (typeof candidate.data !== 'object' || candidate.data === null) {
    throw new BackupError('Der Sicherung fehlt der Datenteil.');
  }

  const data = candidate.data as Record<string, unknown>;
  const unknown = Object.keys(data).filter(
    (k) => !(TABLE_NAMES as readonly string[]).includes(k),
  );
  if (unknown.length > 0) {
    throw new BackupError(`Unbekannte Tabellen in der Sicherung: ${unknown.join(', ')}.`);
  }
  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) throw new BackupError(`Tabelle "${key}" ist keine Liste.`);
  }

  return {
    format: FORMAT,
    schemaVersion: candidate.schemaVersion,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : '',
    counts: (candidate.counts as Record<string, number>) ?? {},
    data: data as Record<string, unknown[]>,
  };
}

export type ImportMode = 'replace' | 'merge';

export async function applyBackup(
  backup: BackupFile,
  mode: ImportMode,
): Promise<{ written: Record<string, number>; total: number }> {
  const written: Record<string, number> = {};

  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') {
      for (const name of TABLE_NAMES) await db.table(name).clear();
    }
    for (const name of TABLE_NAMES) {
      const rows = backup.data[name];
      written[name] = rows?.length ?? 0;
      if (rows && rows.length > 0) await db.table(name as TableName).bulkPut(rows);
    }
  });

  return { written, total: Object.values(written).reduce((a, b) => a + b, 0) };
}

/** Wie viele Datensätze insgesamt gespeichert sind — für die Datenseite. */
export async function countAll(): Promise<number> {
  const counts = await Promise.all(TABLE_NAMES.map((n) => db.table(n).count()));
  return counts.reduce((a, b) => a + b, 0);
}

/** Kennzahlen einer Einheit für Listen und Export. */
export function sessionSummary(s: TrainingSession): string {
  const parts: string[] = [];
  const m = minutesOf(s);
  const km = distanceOf(s);
  if (m > 0) parts.push(`${m} min`);
  if (km > 0) parts.push(`${String(km).replace('.', ',')} km`);
  return parts.join(' · ');
}
