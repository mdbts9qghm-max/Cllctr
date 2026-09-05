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
import type { IsoDate, Soul } from './types';

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

/**
 * Schlüssel für den Stichtag, ab dem die Sammlung zählt.
 *
 * Liegt in `meta`, weil er nichts über den Nutzer aussagt, sondern über den
 * Zustand der App — genau wie der Hinweis, dass die Routinen schon einmal
 * angelegt wurden.
 */
const SOULS_RESET_KEY = 'souls.resetAt';

/** Ab wann die Sammlung zählt. Null heißt: seit dem Anfang. */
export async function soulsResetAt(): Promise<IsoDate | null> {
  const row = await db.meta.get(SOULS_RESET_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * Setzt die Sammlung zurück.
 *
 * Zwei Dinge passieren: Alles Eingesammelte wird gelöscht, und für die Seelen
 * zählt fortan nur noch, was **nach** dem heutigen Tag passiert. Ohne den
 * zweiten Teil wäre es kein Zurücksetzen, sondern ein Neuaufbau — die
 * Auswertung ist absichtlich idempotent und legte beim nächsten Durchlauf alles
 * wieder an.
 *
 * Der Schnitt liegt bewusst am **Tagesende** und nicht am Tagesanfang. Sonst
 * käme eine Seele, die man heute schon verdient hat, im selben Moment wieder
 * herein — und das Zurücksetzen sähe aus, als hätte es nicht funktioniert. Eine
 * Regel, ohne Ausnahme: Morgen fängt die Sammlung an.
 */
export async function resetSouls(): Promise<{ removed: number; resetAt: IsoDate }> {
  const resetAt = today();
  const removed = await db.souls.count();
  await db.transaction('rw', [db.souls, db.meta], async () => {
    await db.souls.clear();
    await db.meta.put({ key: SOULS_RESET_KEY, value: resetAt, updatedAt: now() });
  });
  return { removed, resetAt };
}

/** Hebt den Stichtag wieder auf — die ganze Vergangenheit zählt dann erneut. */
export async function clearSoulsReset(): Promise<void> {
  await db.meta.delete(SOULS_RESET_KEY);
}

async function buildContext(): Promise<SoulContext> {
  const shiftContext = await loadShiftContext();
  const [sessions, logs, microcycles, mesocycles, records, tasks, readiness] = await Promise.all([
    db.sessions.toArray(),
    db.sessionLogs.toArray(),
    db.microcycles.toArray(),
    db.mesocycles.toArray(),
    db.personalRecords.toArray(),
    db.tasks.toArray(),
    db.readiness.toArray(),
  ]);
  const wayAreas = await db.wayAreas.toArray();
  const from = await soulsResetAt();

  /**
   * Nach einem Zurücksetzen sieht die Auswertung nur noch die Zeit danach.
   *
   * Beschnitten wird der **Kontext**, nicht das Ergebnis: Sonst zeigte der
   * Fortschritt "12 von 14 Tagen" für eine Seele, die aus lauter alten Tagen
   * besteht und deshalb nie vergeben würde. Wer zurücksetzt, soll denselben
   * Ausschnitt sehen, aus dem die App auch entscheidet.
   *
   * Aufgaben und Wegbereiche bleiben ungefiltert: Sie tragen keinen Zeitpunkt,
   * sondern einen Zustand. Ein Bereich, der steht, steht auch nach dem
   * Zurücksetzen — er wird nur erst wieder zu einer Seele, wenn der Stichtag
   * vorbei ist.
   */
  const since = <T>(rows: T[], dateOf: (row: T) => IsoDate | null): T[] =>
    from === null ? rows : rows.filter((r) => (dateOf(r) ?? '9999') > from);

  return {
    sessions: since(sessions, (s) => s.date),
    logs: since(logs, (l) => l.date),
    readiness: since(readiness, (r) => r.date),
    microcycles: since(microcycles, (m) => m.endDate),
    mesocycles: since(mesocycles, (m) => m.endDate),
    records: since(records, (r) => r.date),
    tasks,
    wayAreas,
    shiftContext,
    today: today(),
  };
}

/**
 * Prüft alle Regeln und legt neu verdiente Seelen an.
 * Gibt zurück, was tatsächlich neu ist — für die Rückmeldung an den Nutzer.
 */
export async function syncSouls(): Promise<Soul[]> {
  const ctx = await buildContext();
  const from = await soulsResetAt();
  // Seelen, die einen Zustand beschreiben, tragen als Datum den heutigen Tag.
  // Am Stichtag selbst dürfen auch sie nicht anfallen, sonst stünde die Hälfte
  // der Sammlung eine Sekunde nach dem Zurücksetzen wieder da.
  const earned = evaluateSouls(ctx).filter((hit) => from === null || hit.date > from);

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
