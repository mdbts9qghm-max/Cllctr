'use client';

import Link from 'next/link';
import { formatShort, today } from '@/lib/dates';
import { capacityExplanation, allowedSessionTypes, resolveShiftDay } from '@/lib/shifts';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { CAPACITY_LABEL, SESSION_TYPES } from '@/lib/types';
import { CapacityBadge, Card, Notice, Section } from '@/components/ui';
import { PLACEHOLDER_SEQUENCE } from '@/lib/seed';

export default function HeutePage() {
  const ctx = useShiftContext();
  const settings = useSettings();

  if (!ctx || !settings) return <p className="text-sm text-ink-faint">Lade …</p>;

  const day = resolveShiftDay(today(), ctx);
  const possible = allowedSessionTypes(day.capacity);

  const patternIsPlaceholder =
    ctx.pattern !== null &&
    ctx.pattern.sequence.join(',') === PLACEHOLDER_SEQUENCE.join(',');
  const zonesMissing = settings.hrZones.every((z) => z.maxBpm === 0);

  return (
    <>
      <Section title={formatShort(day.date)}>
        <Card>
          <div className="mb-3 flex items-center gap-3">
            <span
              className="flex size-9 items-center justify-center rounded text-sm font-bold text-void"
              style={{ backgroundColor: day.shiftType.color }}
            >
              {day.shiftType.short}
            </span>
            <div className="flex-1">
              <p className="font-medium text-ink">{day.shiftType.name}</p>
              <p className="text-xs text-ink-faint tabular">
                {day.shiftType.startTime && day.shiftType.endTime
                  ? `${day.shiftType.startTime}–${day.shiftType.endTime}`
                  : 'ganzer Tag frei'}
              </p>
            </div>
            <CapacityBadge capacity={day.capacity} label={CAPACITY_LABEL[day.capacity]} />
          </div>

          <p className="text-sm leading-relaxed text-ink-muted">{capacityExplanation(day)}</p>

          {possible.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-faint">
                Heute möglich
              </p>
              <p className="text-sm text-ink-muted">
                {possible.map((k) => SESSION_TYPES[k].label).join(' · ')}
              </p>
            </div>
          ) : null}
        </Card>
      </Section>

      <Section title="Stand">
        <div className="space-y-3">
          <Notice tone="info">
            Phase 1 steht: Datenmodell, lokale Datenbank, Schichtauflösung und Sicherung. Der
            Trainingsplan selbst kommt in Phase 2 — deshalb steht hier noch keine Session.
          </Notice>

          {patternIsPlaceholder ? (
            <Notice tone="warn">
              Die Rotation ist noch der Platzhalter (2 Tag, 2 Nacht, Schlaftag, 2 frei). Setz sie
              unter <Link href="/schicht" className="text-ember underline">Schicht</Link> auf deinen
              echten Rhythmus — daran hängt die gesamte Planung.
            </Notice>
          ) : null}

          {zonesMissing ? (
            <Notice tone="warn">
              Deine Herzfrequenz-Zonen fehlen noch. Eintragen unter{' '}
              <Link href="/setup" className="text-ember underline">Setup</Link>.
            </Notice>
          ) : null}
        </div>
      </Section>
    </>
  );
}
