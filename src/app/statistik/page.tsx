'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort } from '@/lib/dates';
import { useSettings } from '@/lib/hooks';
import {
  deloadSignal,
  headline,
  joinLogs,
  rpeTrend,
  runZoneDistribution,
  weeklyVolume,
} from '@/lib/stats';
import { currentRecords, formatRecordValue, PR_KIND_LABEL } from '@/lib/pr';
import {
  RpeTrendChart,
  StatTile,
  VolumeTable,
  WeeklyVolumeChart,
  ZoneDistributionChart,
} from '@/components/charts';
import { Button, Card, Notice, Section } from '@/components/ui';

export default function StatistikPage() {
  const settings = useSettings();
  const [showTable, setShowTable] = useState(false);

  const data = useLiveQuery(async () => {
    const [sessions, logs] = await Promise.all([db.sessions.toArray(), db.sessionLogs.toArray()]);
    const records = await currentRecords();
    return { sessions, logs, records };
  }, []);

  if (!settings || !data) return <p className="text-sm text-ink-faint">Lade …</p>;

  const logged = joinLogs(data.sessions, data.logs);
  const hasLogs = logged.length > 0;

  const kpi = headline(data.sessions, logged);
  const volume = weeklyVolume(logged);
  const zones = runZoneDistribution(logged);
  const rpe = rpeTrend(logged);
  const deload = deloadSignal(logged);

  const zoneLabels = Object.fromEntries(settings.hrZones.map((z) => [z.zone, z.label]));
  const zoneMinutes = zones.reduce((sum, z) => sum + z.minutes, 0);

  if (!hasLogs) {
    return (
      <Section
        title="Noch keine Daten"
        hint="Die Auswertung entsteht aus den Protokollen. Hak auf dem Heute-Screen eine Einheit ab, dann füllt sich hier alles."
      >
        <Notice tone="info">
          Ohne mindestens eine protokollierte Einheit gäbe es hier nur leere Achsen — die zeigt die
          App bewusst nicht.
        </Notice>
      </Section>
    );
  }

  return (
    <>
      {deload.severity !== 'none' ? (
        <div className="mb-8">
          <Notice tone={deload.severity === 'recommend' ? 'warn' : 'info'}>
            <span className="mb-1 block font-medium text-ink">{deload.summary}</span>
            {deload.reasons.map((reason, i) => (
              <span key={i} className="block text-xs leading-relaxed">
                · {reason}
              </span>
            ))}
          </Notice>
        </div>
      ) : null}

      <Section title="Letzte vier Wochen">
        <div className="grid grid-cols-2 gap-2">
          <StatTile
            label="Durchgezogen"
            value={`${Math.round(kpi.completionRate * 100)} %`}
            hint={`${kpi.doneCount} von ${kpi.plannedCount} Einheiten`}
            tone={kpi.completionRate >= 0.8 ? 'ok' : 'default'}
          />
          <StatTile
            label="Diese Woche"
            value={`${kpi.minutesThisWeek}`}
            hint="Minuten Training"
          />
          <StatTile
            label="Ø RPE"
            value={kpi.avgRpe !== null ? kpi.avgRpe.toFixed(1) : '—'}
            hint="letzte 10 Einheiten"
          />
          <StatTile
            label="Gegen Plan"
            value={
              kpi.rpeDelta !== null
                ? `${kpi.rpeDelta > 0 ? '+' : ''}${kpi.rpeDelta.toFixed(1)}`
                : '—'
            }
            hint={
              kpi.rpeDelta === null
                ? 'keine Vergleichswerte'
                : kpi.rpeDelta > 0.5
                  ? 'härter als geplant'
                  : kpi.rpeDelta < -0.5
                    ? 'leichter als geplant'
                    : 'wie geplant'
            }
            tone={kpi.rpeDelta !== null && kpi.rpeDelta > 1 ? 'warn' : 'default'}
          />
        </div>
      </Section>

      <Section
        title="Wochenvolumen"
        hint="Halte ich das Volumen konstant, oder schwankt es mit der Schicht?"
      >
        <Card>
          <WeeklyVolumeChart data={volume} />
          <div className="mt-3 border-t border-line pt-3">
            {showTable ? (
              /* Führende leere Wochen sagen nichts — erst ab der ersten mit Daten. */
              <VolumeTable data={volume.slice(volume.findIndex((w) => w.total > 0))} />
            ) : (
              <button
                onClick={() => setShowTable(true)}
                className="text-xs text-ink-faint underline hover:text-ink-muted"
              >
                Als Tabelle anzeigen
              </button>
            )}
          </div>
        </Card>
      </Section>

      <Section
        title="Intensitätsverteilung"
        hint="Läuft das Training polarisiert — viel locker, wenig hart — oder versandet alles im Mitteltempo?"
      >
        <Card>
          {zoneMinutes > 0 ? (
            <>
              <ZoneDistributionChart data={zones} zoneLabels={zoneLabels} />
              <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
                {(() => {
                  const easy = zones.filter((z) => z.zone <= 2).reduce((s, z) => s + z.share, 0);
                  const middle = zones.find((z) => z.zone === 3)?.share ?? 0;
                  if (easy >= 0.75) {
                    return `${Math.round(easy * 100)} % locker — das ist die Verteilung, die man will.`;
                  }
                  if (middle >= 0.3) {
                    return `${Math.round(middle * 100)} % im Mitteltempo. Das ist der klassische Fehler: zu hart für Erholung, zu leicht für Reiz.`;
                  }
                  return `${Math.round(easy * 100)} % locker. Unter 75 % wird die Erholung knapp.`;
                })()}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              Noch keine Laufeinheiten protokolliert.
            </p>
          )}
        </Card>
      </Section>

      <Section
        title="Anstrengung gegen Plan"
        hint="Fühlt sich das Training härter an, als es sein sollte? Liegt die Linie dauerhaft über der grauen, ist das ein Ermüdungssignal."
      >
        <Card>
          {rpe.length >= 2 ? (
            <RpeTrendChart data={rpe} />
          ) : (
            <p className="text-sm text-ink-muted">
              Ab der zweiten protokollierten Einheit entsteht hier ein Verlauf.
            </p>
          )}
        </Card>
      </Section>

      <Section
        title="Bestwerte"
        hint="Die App erkennt neue Bestwerte selbst — eingetragen wird nur, was tatsächlich geschafft wurde."
      >
        {data.records.length === 0 ? (
          <Notice tone="info">
            Noch keine Bestwerte. Trag beim Abhaken einer Krafteinheit deine schwersten Sätze ein,
            dann erkennt die App den Rest.
          </Notice>
        ) : (
          <div className="space-y-2">
            {data.records.map(({ exercise, records }) => (
              <Card key={exercise.id}>
                <p className="mb-2 font-medium text-ink">{exercise.name}</p>
                <div className="space-y-1">
                  {records.map((record) => (
                    <div key={record.id} className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-ink-faint">{PR_KIND_LABEL[record.kind]}</span>
                      <span className="flex-1 border-b border-dotted border-line" />
                      <span className="text-sm text-ink tabular">{formatRecordValue(record)}</span>
                      <span className="w-20 shrink-0 text-right text-[11px] text-ink-faint tabular">
                        {formatShort(record.date)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
