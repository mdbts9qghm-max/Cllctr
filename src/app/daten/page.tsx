'use client';

import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, TABLE_NAMES } from '@/lib/db';
import {
  applyBackup,
  BackupValidationError,
  downloadBackup,
  parseBackup,
  readFileAsText,
  type BackupFile,
  type ImportMode,
} from '@/lib/backup';
import { resetAll } from '@/lib/seed';
import { Button, Card, Notice, Section } from '@/components/ui';

export default function DatenPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const counts = useLiveQuery(async () => {
    const entries = await Promise.all(
      TABLE_NAMES.map(async (name) => [name, await db.table(name).count()] as const),
    );
    return Object.fromEntries(entries) as Record<string, number>;
  }, []);

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  async function handleExport() {
    try {
      const { filename, totalRows } = await downloadBackup();
      setMessage({ tone: 'ok', text: `${totalRows} Datensätze gesichert als ${filename}.` });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleFile(file: File) {
    setMessage(null);
    try {
      const backup = parseBackup(await readFileAsText(file));
      setPending(backup);
    } catch (e) {
      setPending(null);
      setMessage({
        tone: 'error',
        text: e instanceof BackupValidationError ? e.message : `Import fehlgeschlagen: ${e}`,
      });
    }
  }

  async function handleImport(mode: ImportMode) {
    if (!pending) return;
    try {
      const result = await applyBackup(pending, mode);
      setPending(null);
      if (fileInput.current) fileInput.current.value = '';
      setMessage({
        tone: 'ok',
        text: `${result.totalRows} Datensätze eingespielt (${
          mode === 'replace' ? 'ersetzt' : 'zusammengeführt'
        }).`,
      });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleReset() {
    await resetAll();
    setConfirmReset(false);
    setMessage({ tone: 'warn', text: 'Alle lokalen Daten gelöscht und neu angelegt.' });
  }

  return (
    <>
      {message ? (
        <div className="mb-6">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      ) : null}

      <Section
        title="Sicherung"
        hint="Deine Daten liegen nur in diesem Browser. Wird der Speicher geleert, sind sie weg. Die Exportdatei ist die einzige Kopie, die es gibt."
      >
        <Card>
          <p className="mb-3 text-sm text-ink-muted tabular">
            Aktuell gespeichert: <span className="text-ink">{total}</span> Datensätze
          </p>
          <Button variant="primary" onClick={() => void handleExport()}>
            Als JSON exportieren
          </Button>
        </Card>
      </Section>

      <Section title="Wiederherstellen" hint="Eine zuvor exportierte Datei einlesen.">
        <Card>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="block w-full text-sm text-ink-muted file:mr-3 file:rounded file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-ink"
          />

          {pending ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-sm text-ink">
                Datei gelesen
                {pending.exportedAt
                  ? ` — Stand ${new Date(pending.exportedAt).toLocaleString('de-DE')}`
                  : ''}
                .
              </p>
              <ul className="mb-4 grid grid-cols-2 gap-x-4 text-xs text-ink-faint tabular">
                {Object.entries(pending.data)
                  .filter(([, rows]) => rows.length > 0)
                  .map(([name, rows]) => (
                    <li key={name}>
                      {name}: {rows.length}
                    </li>
                  ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void handleImport('replace')}>
                  Ersetzen
                </Button>
                <Button onClick={() => void handleImport('merge')}>Zusammenführen</Button>
                <Button onClick={() => setPending(null)}>Abbrechen</Button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                <strong className="text-ink-muted">Ersetzen</strong> löscht alles Vorhandene und
                stellt genau den Stand der Datei her.{' '}
                <strong className="text-ink-muted">Zusammenführen</strong> behält Vorhandenes und
                überschreibt nur Datensätze mit gleicher Kennung.
              </p>
            </div>
          ) : null}
        </Card>
      </Section>

      <Section title="Zurücksetzen" hint="Löscht alles auf diesem Gerät. Vorher exportieren.">
        <Card>
          {confirmReset ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink">Wirklich alles löschen?</span>
              <Button variant="danger" onClick={() => void handleReset()}>
                Ja, löschen
              </Button>
              <Button onClick={() => setConfirmReset(false)}>Abbrechen</Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              Alle Daten löschen
            </Button>
          )}
        </Card>
      </Section>
    </>
  );
}
