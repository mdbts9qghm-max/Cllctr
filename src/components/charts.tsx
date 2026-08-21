'use client';

/**
 * Diagramme.
 *
 * Farben sind nicht nach Geschmack gewählt, sondern gegen die Chart-Fläche
 * (#131316) geprüft: die beiden Disziplinen liegen auf Blau und Orange
 * (Kontrast ≥ 3:1, Farbfehlsichtigkeits-Abstand ΔE 26.8 — deutlich über der
 * Schwelle von 8), die Zonen auf einer einhuigen, monoton helligkeitsgestuften
 * Rampe. Der Bernstein-Akzent der App fällt für Serienfarben durch das
 * Helligkeitsband und bleibt deshalb der Oberfläche vorbehalten — mit einer
 * Ausnahme: als einzelne hervorgehobene Linie im RPE-Verlauf.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RpePoint, WeekVolume, ZoneShare } from '@/lib/stats';

/** Kategorisch, in fester Reihenfolge — nie durchrotiert. */
export const SERIES_COLOR = {
  run: '#3987e5',
  strength: '#d95926',
} as const;

/** Ordinale Rampe, ein Farbton, dunkel = locker bis hell = maximal. */
export const ZONE_COLOR: Record<number, string> = {
  1: '#184f95',
  2: '#256abf',
  3: '#3987e5',
  4: '#6da7ec',
  5: '#b7d3f6',
};

const SURFACE = '#131316';
const GRID = '#2a2a31';
const INK_FAINT = '#6b6b76';
const INK_MUTED = '#a1a1aa';
const EMBER = '#e0a43c';

const axisTick = { fill: INK_FAINT, fontSize: 11 };

function TooltipShell({ title, rows }: { title: string; rows: Array<{ label: string; value: string; color?: string }> }) {
  return (
    <div className="rounded border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2 text-ink-muted tabular">
          {row.color ? (
            <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: row.color }} />
          ) : null}
          {row.label}: <span className="text-ink">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Kleine Legende — bei zwei und mehr Serien Pflicht, damit Identität nie nur an Farbe hängt. */
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="mb-2 flex flex-wrap gap-3">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Wochenvolumen je Disziplin.
 * Frage: Halte ich das Volumen konstant, oder schwankt es mit der Schicht?
 */
export function WeeklyVolumeChart({ data }: { data: WeekVolume[] }) {
  return (
    <>
      <Legend
        items={[
          { label: 'Laufen', color: SERIES_COLOR.run },
          { label: 'Kraft', color: SERIES_COLOR.strength },
        ]}
      />
      <ResponsiveContainer width="100%" height={180}>
        {/* Kein negativer linker Rand: er schiebt die Achse aus dem Zeichenbereich
            und beschneidet dreistellige Minutenwerte. */}
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: '#ffffff0a' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as WeekVolume;
              return (
                <TooltipShell
                  title={`Woche ab ${label}`}
                  rows={[
                    { label: 'Laufen', value: `${point.run} Min`, color: SERIES_COLOR.run },
                    { label: 'Kraft', value: `${point.strength} Min`, color: SERIES_COLOR.strength },
                    { label: 'Gesamt', value: `${point.total} Min` },
                  ]}
                />
              );
            }}
          />
          {/* Der 2px-Rand in Flächenfarbe erzeugt die Lücke zwischen den Segmenten. */}
          <Bar dataKey="run" stackId="v" fill={SERIES_COLOR.run} stroke={SURFACE} strokeWidth={2} />
          <Bar
            dataKey="strength"
            stackId="v"
            fill={SERIES_COLOR.strength}
            stroke={SURFACE}
            strokeWidth={2}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/**
 * Laufminuten je Zone.
 * Frage: Polarisiert — viel locker, wenig hart — oder alles Mitteltempo?
 */
export function ZoneDistributionChart({ data, zoneLabels }: { data: ZoneShare[]; zoneLabels: Record<number, string> }) {
  const max = Math.max(...data.map((d) => d.minutes), 1);

  return (
    <div className="space-y-2">
      {[...data].reverse().map((row) => (
        <div key={row.zone} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-xs text-ink-faint tabular">Z{row.zone}</span>
          <span className="w-24 shrink-0 truncate text-xs text-ink-muted">
            {zoneLabels[row.zone] ?? ''}
          </span>
          <div className="h-4 min-w-8 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.max(row.minutes > 0 ? 2 : 0, (row.minutes / max) * 100)}%`,
                backgroundColor: ZONE_COLOR[row.zone],
              }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-xs text-ink-muted tabular">
            {row.minutes} Min
          </span>
          <span className="w-8 shrink-0 text-right text-xs text-ink-faint tabular">
            {Math.round(row.share * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * RPE tatsächlich gegen geplant.
 * Frage: Fühlt sich das Training härter an, als es sein sollte?
 *
 * Hervorhebung statt zweier gleichwertiger Serien: die tatsächliche Linie
 * trägt den Akzent, die geplante liegt grau dahinter als Bezug.
 */
export function RpeTrendChart({ data }: { data: RpePoint[] }) {
  return (
    <>
      <Legend
        items={[
          { label: 'Tatsächlich', color: EMBER },
          { label: 'Geplant', color: INK_FAINT },
        ]}
      />
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
          {/* Breite reicht für zweistellige Werte — sonst wird die 10 beschnitten. */}
          <YAxis
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ stroke: GRID, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as RpePoint;
              return (
                <TooltipShell
                  title={`${point.title} · ${point.label}`}
                  rows={[
                    { label: 'Tatsächlich', value: `RPE ${point.actual}`, color: EMBER },
                    {
                      label: 'Geplant',
                      value: point.planned !== null ? `RPE ${point.planned}` : '—',
                      color: INK_FAINT,
                    },
                  ]}
                />
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="planned"
            stroke={INK_FAINT}
            strokeWidth={2}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke={EMBER}
            strokeWidth={2}
            dot={{ r: 4, fill: EMBER, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: EMBER, stroke: SURFACE, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

/** Kennzahl ohne Diagramm — für einen einzelnen Wert ist eine Kachel ehrlicher. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn';
}) {
  const valueColor =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-ember' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-[10px] uppercase tracking-widest text-ink-faint">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular ${valueColor}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/** Tabellenansicht als Rückfallebene — Identität hängt nie allein an Farbe. */
export function VolumeTable({ data }: { data: WeekVolume[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="py-1 pr-3 font-normal">Woche ab</th>
            <th className="py-1 pr-3 text-right font-normal">Laufen</th>
            <th className="py-1 pr-3 text-right font-normal">Kraft</th>
            <th className="py-1 text-right font-normal">Gesamt</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.weekStart} className="border-t border-line text-ink-muted">
              <td className="py-1 pr-3">{row.label}</td>
              <td className="py-1 pr-3 text-right">{row.run}</td>
              <td className="py-1 pr-3 text-right">{row.strength}</td>
              <td className="py-1 text-right text-ink">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
