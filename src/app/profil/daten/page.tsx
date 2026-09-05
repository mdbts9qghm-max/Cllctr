'use client';

/**
 * Daten: Export, Import, Zurücksetzen.
 *
 * Die Exportdatei ist die einzige Kopie, die es gibt. Deshalb steht sie hier
 * ganz oben und nicht am Ende einer Einstellungsliste.
 */

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { today } from '@/lib/dates';
import {
  applyBackup,
  backupFilename,
  countAll,
  createBackup,
  downloadCsv,
  downloadJson,
  parseBackup,
  sessionsToCsv,
  type ImportMode,
} from '@/lib/backup';
import { resetAll } from '@/lib/seed';
import { Button, Card, Loading, Notice, Section } from '@/components/ui';

export default function DatenPage() {
  const total = useLiveQuery(() => countAll(), []);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; count: number } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (total === undefined) return <Loading />;

  async function exportJson() {
    const backup = await createBackup();
    downloadJson(backup, backupFilename());
    setMessage(`${Object.values(backup.counts).reduce((a, b) => a + b, 0)} Datensätze exportiert.`);
  }

  async function exportCsv() {
    const sessions = await db.sessions.toArray();
    downloadCsv(sessionsToCsv(sessions), `cllctr-training-${today()}.csv`);
    setMessage(`${sessions.length} Einheiten als CSV exportiert.`);
  }

  function pick(file: File) {
    setError(null);
    setMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = parseBackup(String(reader.result));
        setPending({
          text: String(reader.result),
          count: Object.values(backup.counts).reduce((a, b) => a + b, 0),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    reader.readAsText(file);
  }

  async function runImport(mode: ImportMode) {
    if (!pending) return;
    try {
      const result = await applyBackup(parseBackup(pending.text), mode);
      setMessage(
        `${result.total} Datensätze ${mode === 'replace' ? 'wiederhergestellt' : 'zusammengeführt'}.`,
      );
      setPending(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Link href="/profil" className="mb-5 inline-block text-xs text-ink-faint hover:text-ink">
        ‹ Profil
      </Link>

      {message ? (
        <div className="mb-4">
          <Notice tone="good">{message}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mb-4">
          <Notice tone="warn">{error}</Notice>
        </div>
      ) : null}

      <Section
        title="Sicherung"
        hint="Deine Daten liegen nur in diesem Browser. Wird sein Speicher geleert, sind sie weg."
      >
        <Card>
          <p className="text-sm text-ink">
            Aktuell gespeichert: <span className="font-semibold tabular">{total}</span> Datensätze
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void exportJson()}>
              Als JSON exportieren
            </Button>
            <Button onClick={() => void exportCsv()}>Training als CSV</Button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            JSON ist die vollständige Sicherung und lässt sich wieder einspielen. CSV ist für
            Tabellenkalkulation — Semikolon getrennt, damit ein deutsches Excel es ohne
            Importdialog öffnet.
          </p>
        </Card>
      </Section>

      <Section title="Wiederherstellen">
        <Card>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pick(file);
            }}
            className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-ink"
          />

          {pending ? (
            <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-sm text-ink">
                {pending.count} Datensätze in der Datei. Wie einspielen?
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void runImport('replace')}>
                  Alles ersetzen
                </Button>
                <Button onClick={() => void runImport('merge')}>Zusammenführen</Button>
                <Button variant="ghost" onClick={() => setPending(null)}>
                  Abbrechen
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                <span className="text-ink">Ersetzen</span> löscht alles Vorhandene und stellt den
                Stand der Datei her. <span className="text-ink">Zusammenführen</span> behält, was
                da ist, und überschreibt nur Datensätze mit gleicher Id.
              </p>
            </div>
          ) : null}
        </Card>
      </Section>

      <Section title="Zurücksetzen">
        <Card>
          <p className="text-sm leading-relaxed text-ink-muted">
            Löscht alles auf diesem Gerät und legt die Startdaten neu an. Vorher exportieren.
          </p>
          <div className="mt-3">
            {confirmReset ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  onClick={() =>
                    void resetAll().then(() => {
                      setConfirmReset(false);
                      setMessage('Alles zurückgesetzt.');
                    })
                  }
                >
                  Ja, alles löschen
                </Button>
                <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                  Abbrechen
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmReset(true)}>
                Alle Daten löschen
              </Button>
            )}
          </div>
        </Card>
      </Section>

      <Section title="Spätere Anbindungen">
        <Card tone="quiet">
          <p className="text-sm leading-relaxed text-ink-muted">
            Garmin, WHOOP, Polar, Apple Health und Kalender sind <span className="text-ink">nicht</span>{' '}
            angebunden. Sie brauchen OAuth und damit einen Server — und den hat diese App bewusst
            nicht.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Vorbereitet ist es trotzdem: Jede Einheit trägt Herkunft und eine Fremd-Id, und
            geplante und tatsächliche Werte stehen getrennt. Ein Import füllt später die Ist-Seite,
            ohne den Plan anzufassen.
          </p>
        </Card>
      </Section>
    </>
  );
}
