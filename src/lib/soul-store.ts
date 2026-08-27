/**
 * Einsammeln und Abfragen der Seelen.
 *
 * Die Auswertung ist bewusst idempotent: Sie darf jederzeit laufen und legt nur
 * an, was noch fehlt. So gehen auch Seelen nicht verloren, die im Hintergrund
 * verdient wurden — etwa ein Zyklus, der zu Ende ging, während die App zu war.
 */

import { db } from './db';
import { today } from './dates';
import { newId, now } from './ids';
import { evaluateSouls, soulsInReach, type SoulContext, type SoulProgress } from './souls';
import type { ShiftContext } from './shifts';
import type { Soul } from './types';

/**
 * Der Schichtkontext wird hier selbst geladen statt durchgereicht.
 *
 * Grund: Die Auswertung darf **nicht** innerhalb eines Dexie-LiveQuery laufen —
 * sie schreibt, und Schreibzugriffe in einer laufenden Beobachtung lassen die
 * Seite abstürzen. Ohne Parameter lässt sich syncSouls sauber aus einem Effekt
 * heraus aufrufen, getrennt von der Anzeige.
 */
async function loadShiftContext(): Promise<ShiftContext> {
  const [shiftTypes, patterns, overrides] = await Promise.all([
    db.shiftTypes.orderBy('sortOrder').toArray(),
    db.shiftPatterns.toArray(),
    db.shiftOverrides.toArray(),
  ]);
  return { shiftTypes, pattern: patterns.find((p) => p.active) ?? null, overrides };
}

/** Eindeutig ist eine Seele über Definition plus Anlass. */
function soulKey(key: string, sourceId: string | null): string {
  return `${key}::${sourceId ?? '-'}`;
}

async function buildContext(): Promise<SoulContext> {
  const shiftContext = await loadShiftContext();
  const [sessions, logs, microcycles, mesocycles, records, tasks] = await Promise.all([
    db.sessions.toArray(),
    db.sessionLogs.toArray(),
    db.microcycles.toArray(),
    db.mesocycles.toArray(),
    db.personalRecords.toArray(),
    db.tasks.toArray(),
  ]);
  return { sessions, logs, microcycles, mesocycles, records, tasks, shiftContext, today: today() };
}

/**
 * Prüft alle Regeln und legt neu verdiente Seelen an.
 * Gibt zurück, was tatsächlich neu ist — für die Rückmeldung an den Nutzer.
 */
export async function syncSouls(): Promise<Soul[]> {
  const ctx = await buildContext();
  const earned = evaluateSouls(ctx);

  const existing = await db.souls.toArray();
  const known = new Set(existing.map((s) => soulKey(s.key, s.sourceId)));

  const fresh: Soul[] = [];
  const ts = now();

  for (const hit of earned) {
    const id = soulKey(hit.definition.key, hit.sourceId);
    if (known.has(id)) continue;
    known.add(id);

    fresh.push({
      id: newId('soul'),
      key: hit.definition.key,
      name: hit.definition.name,
      description: hit.definition.description,
      rarity: hit.definition.rarity,
      // Das Datum des Anlasses, nicht der Auswertung — sonst hätten alle Seelen
      // denselben Tag, wenn die App länger zu war.
      collectedAt: `${hit.date}T12:00:00.000Z`,
      sourceKind: hit.definition.sourceKind,
      sourceId: hit.sourceId,
      detail: hit.detail,
    });
  }

  if (fresh.length > 0) await db.souls.bulkPut(fresh);
  return fresh;
}

/** Seelen, die gerade greifbar sind — für den Heute-Screen. */
/** Nur lesend — darf deshalb in einem LiveQuery laufen. */
export async function getSoulsInReach(limit = 3): Promise<SoulProgress[]> {
  const ctx = await buildContext();
  const collected = new Set((await db.souls.toArray()).map((s) => s.key));
  return soulsInReach(ctx, collected, limit);
}
