'use client';

import { monthGridDays, monthKey, monthLabel, shiftMonth, today } from '@/lib/dates';
import type { IsoDate } from '@/lib/types';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export interface MonthCell {
  /** Kürzel im Feld, z. B. das Schichtkürzel. */
  mark: string;
  /** Hintergrundfarbe des Kürzels. Leer lassen für einen stillen Tag. */
  color: string | null;
  /** Ein Punkt unter dem Tag — dort steht etwas an. */
  dot?: 'accent' | 'muted' | null;
  /** Zweite Zeile, sehr klein. */
  caption?: string | null;
}

/**
 * Ein Monat als Raster.
 *
 * Der Schichtplan kommt vom Arbeitgeber als Monatsblatt, und so denkt man auch
 * darüber. Eine Liste der nächsten 21 Tage kann man abarbeiten, aber nicht
 * überblicken — und genau der Überblick ist der Grund, warum man draufschaut.
 *
 * Die Komponente kennt keine Schichten und kein Training: sie bekommt je Tag
 * ein Kürzel und eine Farbe. Dadurch tragen Schicht- und Plan-Screen dasselbe
 * Raster, ohne voneinander zu wissen.
 */
export function MonthGrid({
  month,
  onMonthChange,
  cellFor,
  onPick,
  selected = null,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  cellFor: (date: IsoDate) => MonthCell;
  onPick?: (date: IsoDate) => void;
  selected?: IsoDate | null;
}) {
  const days = monthGridDays(month);
  const todayIso = today();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          aria-label="Vorheriger Monat"
          className="rounded px-2 py-1 text-ink-faint hover:text-ink"
        >
          ‹
        </button>
        <span className="text-sm font-medium text-ink">{monthLabel(month)}</span>
        <button
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          aria-label="Nächster Monat"
          className="rounded px-2 py-1 text-ink-faint hover:text-ink"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <span key={d} className="text-center text-[10px] uppercase tracking-wider text-ink-faint">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const outside = monthKey(date) !== month;
          const cell = cellFor(date);
          const isToday = date === todayIso;
          const isSelected = date === selected;

          return (
            <button
              key={date}
              onClick={() => onPick?.(date)}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded border transition-colors ${
                isSelected
                  ? 'border-ember bg-surface-2'
                  : isToday
                    ? 'border-ember/50 bg-surface'
                    : 'border-line bg-surface hover:border-line-strong'
              } ${outside ? 'opacity-35' : ''}`}
            >
              <span className="text-[10px] leading-none text-ink-faint tabular">
                {Number(date.slice(8))}
              </span>

              <span
                className="flex size-5 items-center justify-center rounded text-[10px] font-bold leading-none"
                style={
                  cell.color
                    ? { backgroundColor: cell.color, color: '#0a0a0b' }
                    : { color: 'var(--color-ink-faint, #71717a)' }
                }
              >
                {cell.mark}
              </span>

              {cell.dot ? (
                <span
                  className={`size-1 rounded-full ${
                    cell.dot === 'accent' ? 'bg-ember' : 'bg-ink-faint'
                  }`}
                />
              ) : (
                <span className="size-1" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
