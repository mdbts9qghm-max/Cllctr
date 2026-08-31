'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { today } from '@/lib/dates';
import { useShiftContext } from '@/lib/hooks';
import { AREA_READY_DAYS, buildPath, LEVEL_STEP_DAYS, WAY_BY_KEY } from '@/lib/way';
import { evaluateWay } from '@/lib/way-store';
import { WayPath } from '@/components/WayPath';
import { Card, Notice, Section } from '@/components/ui';

/**
 * Der ganze Weg auf einer Seite.
 *
 * Der Aufgaben-Tab zeigt nur den Ausschnitt um die aktuelle Stelle — hier steht
 * alles: was hinter dir liegt, wo du bist, was noch kommt. Nichts ist versteckt.
 * Ein Weg, dessen Ende man nicht sieht, ist kein Weg, sondern ein Laufband.
 */
export default function WegPage() {
  const ctx = useShiftContext();
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const areas = useLiveQuery(() => db.wayAreas.orderBy('order').toArray(), []);

  if (!ctx || !tasks || !areas) return <p className="text-sm text-ink-faint">Lade …</p>;

  const way = evaluateWay(areas, tasks, ctx, today());
  const path = buildPath(areas, way.streak, way.readyForNext);
  const done = path.filter((n) => n.state === 'done').length;

  // Nach Bereichen gruppieren: der Pfad läuft durch, die Überschriften geben ihm
  // Abschnitte — sonst sind es zwanzig gleich aussehende Knoten.
  const groups: Array<{ key: string; name: string; nodes: typeof path }> = [];
  for (const node of path) {
    const last = groups[groups.length - 1];
    if (last && last.key === node.areaKey) last.nodes.push(node);
    else groups.push({ key: node.areaKey, name: node.areaName, nodes: [node] });
  }

  return (
    <>
      <Link
        href="/aufgaben"
        className="mb-6 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <span aria-hidden="true">‹</span> Aufgaben
      </Link>

      <Section
        title="Der Weg"
        hint={`Vier Bereiche, einer nach dem anderen. Alle ${LEVEL_STEP_DAYS} Tage in Folge kommt ein Schritt dazu; nach ${AREA_READY_DAYS} Tagen der nächste Bereich.`}
      >
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xl font-semibold text-ink tabular">
              {done}
              <span className="text-base font-normal text-ink-faint"> / {path.length}</span>
            </span>
            <span className="text-[11px] uppercase tracking-widest text-ink-faint">
              Knoten erreicht
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-strong">
            <div
              className="h-full rounded-full bg-ember transition-all"
              style={{ width: `${(done / Math.max(1, path.length)) * 100}%` }}
            />
          </div>
        </Card>
      </Section>

      {areas.length === 0 ? <Notice tone="info">Der Weg ist noch nicht angelegt.</Notice> : null}

      <div className="space-y-8">
        {groups.map((group) => {
          const area = areas.find((a) => a.key === group.key);
          const template = WAY_BY_KEY.get(group.key);
          const reached = group.nodes.filter((n) => n.state === 'done').length;

          return (
            <div key={group.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <h3
                  className={`text-sm font-medium ${
                    area?.status === 'active' ? 'text-ember' : 'text-ink'
                  }`}
                >
                  Etappe {area?.order ?? '?'} · {group.name}
                </h3>
                <span className="shrink-0 text-[11px] text-ink-faint tabular">
                  {reached} / {group.nodes.length}
                </span>
              </div>
              {template ? (
                <p className="mb-3 text-xs leading-relaxed text-ink-faint">{template.why}</p>
              ) : null}

              <WayPath nodes={group.nodes} />
            </div>
          );
        })}
      </div>
    </>
  );
}
