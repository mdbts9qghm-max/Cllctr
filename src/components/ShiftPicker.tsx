'use client';

import { db } from '@/lib/db';
import { now } from '@/lib/ids';
import type { IsoDate, ResolvedShiftDay, ShiftType } from '@/lib/types';

/**
 * Einen einzelnen Tag abweichend von der Rotation setzen.
 *
 * Steht an zwei Stellen: im Schicht-Screen für die Vorschau der nächsten
 * Wochen und direkt im Plan. Der Plan ist der Ort, an dem ein Tausch auffällt
 * ("da kann ich nicht") — dort ihn auch ändern zu können, spart den Umweg über
 * einen zweiten Screen.
 */
export async function setShiftOverride(
  date: IsoDate,
  shiftTypeId: string | null,
): Promise<void> {
  if (shiftTypeId === null) {
    await db.shiftOverrides.delete(date);
  } else {
    await db.shiftOverrides.put({ date, shiftTypeId, note: '', createdAt: now() });
  }
}

export function ShiftPicker({
  day,
  shiftTypes,
  onDone,
  label = 'Abweichend setzen',
}: {
  day: ResolvedShiftDay;
  shiftTypes: ShiftType[];
  onDone?: () => void;
  label?: string;
}) {
  async function set(shiftTypeId: string | null) {
    await setShiftOverride(day.date, shiftTypeId);
    onDone?.();
  }

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-widest text-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-2">
        {shiftTypes.map((t) => {
          const current = t.id === day.shiftType.id;
          return (
            <button
              key={t.id}
              onClick={() => void set(t.id)}
              aria-pressed={current}
              className={`rounded border px-2.5 py-1 text-sm ${
                current
                  ? 'border-ember text-ember'
                  : 'border-line-strong text-ink hover:border-ember'
              }`}
            >
              {t.name}
            </button>
          );
        })}
        {day.isOverride ? (
          <button
            onClick={() => void set(null)}
            className="rounded border border-danger/50 px-2.5 py-1 text-sm text-danger"
          >
            Zurück zur Rotation
          </button>
        ) : null}
      </div>
    </div>
  );
}
