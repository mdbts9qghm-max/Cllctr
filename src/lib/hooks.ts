'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { ShiftContext } from './shifts';

/** Lädt alles, was zur Auflösung der Schichttage nötig ist. */
export function useShiftContext(): ShiftContext | undefined {
  return useLiveQuery(async () => {
    const [shiftTypes, patterns, overrides] = await Promise.all([
      db.shiftTypes.orderBy('sortOrder').toArray(),
      db.shiftPatterns.toArray(),
      db.shiftOverrides.toArray(),
    ]);
    return {
      shiftTypes,
      pattern: patterns.find((p) => p.active) ?? null,
      overrides,
    };
  }, []);
}

export function useSettings() {
  return useLiveQuery(() => db.settings.get('singleton'), []);
}
