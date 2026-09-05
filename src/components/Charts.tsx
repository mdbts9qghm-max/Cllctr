'use client';

/**
 * Diagramme.
 *
 * Nur dort, wo ein Bild mehr sagt als eine Zahl: Verläufe über Wochen. Für
 * einen einzelnen Wert ist eine große Ziffer immer besser als ein Kreisdiagramm
 * mit einem Segment.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const AXIS = { stroke: 'var(--ink-faint)', fontSize: 10 };
const GRID = 'var(--line)';

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line-strong)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--ink)',
};

export function WeeklyVolumeChart({
  data,
}: {
  data: Array<{ label: string; minutes: number; target: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: 'var(--surface-2)' }}
          formatter={(value) => [`${value ?? 0} min`, 'Umfang'] as [string, string]}
        />
        <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            // Wochen über Ziel bekommen die Akzentfarbe, darunter gedämpft —
            // eine Legende dafür wäre eine Zeile, die niemand liest.
            <Cell
              key={i}
              fill={d.minutes >= d.target ? 'var(--color-accent)' : 'var(--color-accent-dim)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({
  data,
  unit = '',
}: {
  data: Array<{ label: string; value: number }>;
  unit?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -22 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [`${value ?? 0}${unit}`, ''] as [string, string]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="url(#trendFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Der Hybrid Score als Balkenreihe statt als Netzdiagramm.
 *
 * Ein Radar sieht beeindruckender aus, aber man kann Werte darin nicht
 * vergleichen — Flächen täuschen, Längen nicht.
 */
export function ScoreBars({
  parts,
}: {
  parts: Array<{ label: string; value: number }>;
}) {
  return (
    <div className="space-y-2.5">
      {parts.map((p) => (
        <div key={p.label} className="flex items-center gap-3">
          <span className="w-[5.5rem] shrink-0 text-xs text-ink-muted">{p.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full transition-[width] duration-700"
              style={{
                width: `${Math.max(0, Math.min(100, p.value))}%`,
                background:
                  p.value >= 75
                    ? 'var(--color-good)'
                    : p.value >= 50
                      ? 'var(--color-ok)'
                      : 'var(--color-warn)',
              }}
            />
          </span>
          <span className="w-7 shrink-0 text-right text-xs tabular text-ink">{p.value}</span>
        </div>
      ))}
    </div>
  );
}
