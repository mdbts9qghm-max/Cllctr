'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort, today } from '@/lib/dates';
import { capacityExplanation, allowedSessionTypes, resolveShiftDay } from '@/lib/shifts';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { CAPACITY_LABEL, SESSION_TYPES } from '@/lib/types';
import { CapacityBadge, Card, Notice, Section } from '@/components/ui';

export default function HeutePage() {
  const ctx = useShiftContext();
  const settings = useSettings();

  const todaySessions = useLiveQuery(() => db.sessions.where('date').equals(today()).toArray(), []);
  const hasPlan = useLiveQuery(async () => (await db.macrocycles.count()) > 0, []);

  if (!ctx || !settings || todaySessions === undefined) {
    return <p className="text-sm text-ink-faint">Lade …</p>;
  }

  const session =
    todaySessions.find((s) => s.status === 'planned') ??
    todaySessions.find((s) => s.status === 'done') ??
    null;

  const day = resolveShiftDay(today(), ctx);
  const possible = allowedSessionTypes(day.capacity);

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

          {session ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-widest text-ember">
                Heute dran{session.status === 'done' ? ' · erledigt' : ''}
              </p>
              <p className="text-base font-medium text-ink">
                {session.title}
                {session.isKey ? <span className="text-ember"> ▪</span> : null}
              </p>
              <p className="mb-2 text-xs text-ink-faint tabular">
                {session.plannedDurationMin} Min
                {session.zone ? ` · Zone ${session.zone}` : ''}
                {session.targetRpe ? ` · RPE ${session.targetRpe}` : ''}
              </p>
              <ul className="space-y-0.5">
                {session.content.map((block, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-muted">
                    <span className="text-ink-faint">{block.label}:</span> {block.detail}
                  </li>
                ))}
              </ul>
              {session.rescheduleReason ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                  {session.rescheduleReason}
                </p>
              ) : null}
              <p className="mt-3">
                <Link href="/plan" className="text-sm text-ember underline">
                  Im Plan öffnen
                </Link>
              </p>
            </div>
          ) : hasPlan ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-sm text-ink-muted">
                Heute ist keine Einheit geplant — Ruhetag.
              </p>
            </div>
          ) : possible.length > 0 ? (
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
          {hasPlan ? (
            <Notice tone="info">
              Phase 2 steht: Generator und adaptives Umplanen. Dieser Screen bekommt in Phase 3
              seine endgültige Form mit Tasks und Seelen in Reichweite.
            </Notice>
          ) : (
            <Notice tone="warn">
              Noch kein Trainingsplan.{' '}
              <Link href="/plan" className="text-ember underline">
                Plan erzeugen
              </Link>{' '}
              — die App baut ihn aus deiner Schichtrotation.
            </Notice>
          )}

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
