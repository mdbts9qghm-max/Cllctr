'use client';

import { useState } from 'react';
import type { WayNode } from '@/lib/way';
import { Mark } from './ui';

/**
 * Der Weg als Pfad.
 *
 * Die Idee kommt von Sprach-Apps: eine Kette von Knoten, an der man sich
 * entlangarbeitet. Die Umsetzung bleibt aber in der Sprache dieser App —
 * eine Akzentfarbe, kein Konfetti, keine Maskottchen. Was erledigt ist, ist
 * gefüllt; was ansteht, trägt einen Ring; was kommt, steht blass da, aber
 * lesbar. Man soll sehen können, was auf einen zukommt.
 */

/** Seitlicher Versatz je Knoten — der Schlangenlauf, der einen Pfad ausmacht. */
const OFFSETS = [0, 46, 64, 46, 0, -46, -64, -46];

/**
 * Abstand zweier Knoten in Pixeln.
 *
 * Muss Kreis (56), Abstand (6) und zwei Zeilen Beschriftung (~30) tragen und
 * darüber hinaus noch Platz für die Spur lassen — sonst läuft der Text in die
 * Punkte des nächsten Knotens.
 */
const ROW = 124;

/** Wo die Beschriftung endet — ab hier ist Platz für die Spur. */
const LABEL_BOTTOM = 92;

function offsetAt(index: number): number {
  return OFFSETS[index % OFFSETS.length];
}

/** Der Fortschrittsring um den aktuellen Knoten. */
function ProgressRing({ ratio }: { ratio: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 68 68" className="pointer-events-none absolute -inset-1.5 size-[68px]">
      <circle cx="34" cy="34" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-line-strong" />
      <circle
        cx="34"
        cy="34"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-ember"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, ratio)))}
        transform="rotate(-90 34 34)"
      />
    </svg>
  );
}

export function WayPath({
  nodes,
  onPick,
  selectedId = null,
}: {
  nodes: WayNode[];
  onPick?: (node: WayNode) => void;
  selectedId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = selectedId ?? openId;
  const detail = nodes.find((n) => n.id === active) ?? null;

  return (
    <div>
      <div className="relative mx-auto" style={{ height: nodes.length * ROW }}>
        {nodes.map((node, i) => {
          const x = offsetAt(i);
          const next = i + 1 < nodes.length ? offsetAt(i + 1) : null;
          const done = node.state === 'done';
          const current = node.state === 'current';

          return (
            <div key={node.id}>
              {/* Die Spur zwischen zwei Knoten: drei Punkte auf der Linie.
                  Eine durchgezogene Kurve bräuchte SVG-Koordinaten, die sich
                  mit der Bildschirmbreite ändern — Punkte tun es genauso. */}
              {next !== null
                ? [0.34, 0.68].map((t) => (
                    <span
                      key={t}
                      aria-hidden="true"
                      className={`absolute size-1.5 rounded-full ${
                        done ? 'bg-ember/40' : 'bg-line-strong'
                      }`}
                      style={{
                        top: i * ROW + LABEL_BOTTOM + t * (ROW - LABEL_BOTTOM),
                        left: '50%',
                        transform: `translateX(calc(-50% + ${x + (next - x) * t}px))`,
                      }}
                    />
                  ))
                : null}

              <button
                onClick={() => {
                  setOpenId(active === node.id ? null : node.id);
                  onPick?.(node);
                }}
                aria-current={current ? 'step' : undefined}
                className="absolute flex w-28 flex-col items-center gap-1.5"
                style={{ top: i * ROW, left: '50%', transform: `translateX(calc(-50% + ${x}px))` }}
              >
                <span className="relative flex size-14 items-center justify-center">
                  {current && node.progress ? (
                    <ProgressRing ratio={node.progress.current / node.progress.target} />
                  ) : null}

                  <span
                    className={`flex size-14 items-center justify-center rounded-full border-2 transition-colors ${
                      done
                        ? 'border-ember bg-ember text-void'
                        : current
                          ? 'border-ember/40 bg-surface text-ember'
                          : 'border-line-strong bg-surface text-ink-faint'
                    }`}
                  >
                    {node.kind === 'milestone' ? (
                      <Mark variant={done ? 'solid' : 'outline'} className="size-5" />
                    ) : done ? (
                      <svg viewBox="0 0 20 20" className="size-6" fill="none" strokeWidth="2.4" stroke="currentColor" strokeLinecap="round">
                        <path d="M5 10.5l3.4 3.4L15 7" />
                      </svg>
                    ) : (
                      <span className="text-sm font-semibold tabular">{node.index + 1}</span>
                    )}
                  </span>
                </span>

                <span
                  className={`line-clamp-2 text-center text-[11px] leading-tight ${
                    current ? 'text-ink' : done ? 'text-ink-muted' : 'text-ink-faint'
                  }`}
                >
                  {node.title}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {detail ? (
        <div className="mt-2 rounded-lg border border-line-strong bg-surface-2 p-3">
          <p className="text-[10px] uppercase tracking-widest text-ink-faint">
            {detail.areaName}
            {detail.kind === 'milestone' ? ' · Etappenziel' : ` · Stufe ${detail.index}`}
          </p>
          <p className="mt-1 text-sm font-medium text-ink">{detail.title}</p>
          {detail.notes ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">{detail.notes}</p>
          ) : null}
          {detail.state === 'locked' ? (
            <p className="mt-2 text-xs text-ink-faint">
              Kommt später. Erst muss halten, was davor steht.
            </p>
          ) : null}
          {detail.state === 'current' && detail.progress ? (
            <p className="mt-2 text-xs text-ember tabular">
              {detail.progress.current} von {detail.progress.target} Tagen
            </p>
          ) : null}
          {detail.state === 'current' && detail.kind === 'step' ? (
            <p className="mt-1 text-xs text-ink-faint">
              Abgehakt wird unter „Täglich" — dort stehen alle Routinen zusammen.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
