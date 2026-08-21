/**
 * Adaptives Umplanen.
 *
 * Wenn eine Einheit ausfällt, soll die App nicht einen kaputten Plan und ein
 * schlechtes Gewissen hinterlassen, sondern entscheiden: nachholen, verschieben
 * oder ersatzlos streichen.
 *
 * Die Regeln, in dieser Reihenfolge:
 *
 *   1. Filler (Recovery, lockeres Volumen, Mobility) fallen ersatzlos weg.
 *      Nachholen würde nur die folgenden Tage überladen.
 *   2. Key-Sessions suchen einen Ersatztag mit genug Kapazität. An einem
 *      12-Stunden-Tag lässt sich kein Long Run nachholen.
 *   3. Lockere Einheiten am Zieltag weichen.
 *   4. Ist kein Tag frei, greift das **Planungsprofil**: bei "Laufen hat
 *      Vorrang" darf eine Laufeinheit eine Krafteinheit verdrängen, aber nie
 *      umgekehrt. Die verdrängte Einheit sucht sich selbst einen neuen Tag.
 *   5. Erst wenn auch das scheitert, gibt es die **reduzierte Form** — ein Long
 *      Run wird zum lockeren Dauerlauf. Kleiner ist besser als gar nicht.
 *   6. Bleibt alles erfolglos, entfällt die Einheit — mit klarer Begründung,
 *      welche Tage im Weg standen.
 *
 * Fixierte Einheiten (locked) fasst der Umplaner nie an.
 */

import { addDays, formatShort } from './dates';
import { now } from './ids';
import { capacityAllows, type ShiftContext, resolveShiftRange } from './shifts';
import {
  SESSION_TYPES,
  type Discipline,
  type IsoDate,
  type PlanningProfile,
  type ResolvedShiftDay,
  type Session,
  type SessionTypeKey,
  type Settings,
} from './types';

/** Ab diesem Belastungswert gilt ein Tag als hart (siehe SessionTypeMeta.load). */
const HARD_LOAD_THRESHOLD = 7;
const MAX_CONSECUTIVE_HARD_DAYS = 2;

/**
 * Reduzierte Ersatzformen, in Rangfolge. Bekommt eine Key-Session keinen vollen
 * Tag mehr, ist eine kleinere Version besser als gar nichts.
 */
const DOWNGRADES: Partial<Record<SessionTypeKey, SessionTypeKey[]>> = {
  run_long: ['run_easy', 'run_recovery'],
  run_intervals: ['run_tempo', 'run_easy'],
  run_tempo: ['run_easy'],
  strength_lower: ['strength_upper', 'strength_short'],
  strength_upper: ['strength_short'],
  strength_full: ['strength_short'],
};

export interface RescheduleMove {
  sessionId: string;
  title: string;
  fromDate: IsoDate;
  toDate: IsoDate;
  reason: string;
  /** Gesetzt, wenn die Einheit nur in reduzierter Form untergebracht wurde. */
  newType: SessionTypeKey | null;
  newTitle: string | null;
  newDurationMin: number | null;
  newLoad: number | null;
}

export interface RescheduleDrop {
  sessionId: string;
  title: string;
  date: IsoDate;
  reason: string;
}

export interface ReschedulePlan {
  trigger: { sessionId: string; title: string; date: IsoDate };
  moves: RescheduleMove[];
  drops: RescheduleDrop[];
  /** Begründung in ein bis zwei Sätzen, direkt für die Anzeige. */
  summary: string;
}

export interface RescheduleContext {
  /** Alle Sessions im Suchfenster, inklusive der verpassten. */
  sessions: Session[];
  shiftContext: ShiftContext;
  settings: Settings;
}

/**
 * Rang der Disziplin nach Planungsprofil. Kleiner gewinnt.
 * Bei "Abwechselnd" sind alle gleich — dann verdrängt niemand niemanden.
 */
function disciplineRank(discipline: Discipline, profile: PlanningProfile): number {
  if (profile === 'runFirst') return discipline === 'run' ? 0 : 1;
  if (profile === 'strengthFirst') return discipline === 'strength' ? 0 : 1;
  return 0;
}

function isActive(session: Session): boolean {
  return session.status !== 'skipped' && session.status !== 'missed';
}

/* ------------------------------------------------------------------ */
/* Suche nach einem Ersatztag                                          */
/* ------------------------------------------------------------------ */

interface Placement {
  day: ResolvedShiftDay;
  type: SessionTypeKey;
  reduced: boolean;
  displacedFillers: Session[];
  displacedKeys: Session[];
}

interface SearchOptions {
  /** Darf diese Einheit eine Key-Session verdrängen? */
  allowDisplaceKeys: boolean;
  /** Ids, die bei der Belegungsprüfung ignoriert werden (bereits verschoben). */
  ignoreIds: Set<string>;
}

function sessionsByDate(sessions: Session[]): Map<IsoDate, Session[]> {
  const map = new Map<IsoDate, Session[]>();
  for (const s of sessions) {
    if (!isActive(s)) continue;
    const list = map.get(s.date) ?? [];
    list.push(s);
    map.set(s.date, list);
  }
  return map;
}

/** Würde eine harte Einheit an diesem Tag einen zu langen Block erzeugen? */
function hardBlockOk(
  date: IsoDate,
  type: SessionTypeKey,
  byDate: Map<IsoDate, Session[]>,
  ignoreIds: Set<string>,
): boolean {
  if (SESSION_TYPES[type].load < HARD_LOAD_THRESHOLD) return true;

  const hardOn = (d: IsoDate) =>
    (byDate.get(d) ?? []).some(
      (s) => !ignoreIds.has(s.id) && s.load >= HARD_LOAD_THRESHOLD,
    );

  let run = 1;
  for (let d = addDays(date, -1); hardOn(d); d = addDays(d, -1)) run++;
  for (let d = addDays(date, 1); hardOn(d); d = addDays(d, 1)) run++;
  return run <= MAX_CONSECUTIVE_HARD_DAYS;
}

/**
 * Sucht den besten Ersatztag. Erst die volle Form über alle Tage, dann die
 * reduzierten Formen — ein voller Long Run übermorgen schlägt einen lockeren
 * Lauf morgen.
 */
function findPlacement(
  session: Session,
  working: Session[],
  ctx: RescheduleContext,
  options: SearchOptions,
): { placement: Placement | null; keyBlockers: string[] } {
  const { settings, shiftContext } = ctx;
  const windowDays = Math.max(1, settings.rescheduleWindowDays);
  const days = resolveShiftRange(
    addDays(session.date, 1),
    addDays(session.date, windowDays),
    shiftContext,
  );
  const byDate = sessionsByDate(working);
  const ignore = new Set([session.id, ...options.ignoreIds]);
  const keyBlockers: string[] = [];

  const forms: SessionTypeKey[] = [session.type, ...(DOWNGRADES[session.type] ?? [])];

  for (let formIndex = 0; formIndex < forms.length; formIndex++) {
    const form = forms[formIndex];
    const meta = SESSION_TYPES[form];

    for (const day of days) {
      if (!capacityAllows(day.capacity, form)) continue;

      const onDay = (byDate.get(day.date) ?? []).filter((s) => !ignore.has(s.id));

      // Fixierte Einheiten sind tabu.
      if (onDay.some((s) => s.locked)) continue;

      const keys = onDay.filter((s) => s.isKey || s.load >= HARD_LOAD_THRESHOLD);
      const fillers = onDay.filter((s) => !keys.includes(s));

      if (keys.length > 0) {
        if (formIndex === 0) keyBlockers.push(`${formatShort(day.date)} ${keys[0].title}`);
        if (!options.allowDisplaceKeys) continue;

        // Verdrängen nur, wenn das Profil diese Disziplin klar vorzieht.
        const ownRank = disciplineRank(session.discipline, settings.planningProfile);
        const canDisplace = keys.every(
          (k) => disciplineRank(k.discipline, settings.planningProfile) > ownRank,
        );
        if (!canDisplace) continue;
      }

      // Eine reduzierte Form lohnt nur, wenn dort nicht ohnehin schon etwas
      // Gleichwertiges steht — sonst tauscht man Gleiches gegen Gleiches.
      if (formIndex > 0 && onDay.some((s) => s.load >= meta.load)) continue;

      // Dieselbe Einheit nicht an zwei aufeinanderfolgenden Tagen — dieselbe
      // Muskulatur bekäme sonst keine 24 Stunden Erholung.
      const sameTypeNeighbour = [addDays(day.date, -1), addDays(day.date, 1)].some((d) =>
        (byDate.get(d) ?? []).some((s) => !ignore.has(s.id) && s.type === form),
      );
      if (sameTypeNeighbour) continue;

      if (!hardBlockOk(day.date, form, byDate, ignore)) continue;

      return {
        placement: {
          day,
          type: form,
          reduced: formIndex > 0,
          displacedFillers: fillers,
          displacedKeys: keys,
        },
        keyBlockers,
      };
    }
  }

  return { placement: null, keyBlockers };
}

/* ------------------------------------------------------------------ */
/* Vorschlag                                                           */
/* ------------------------------------------------------------------ */

function moveFor(session: Session, placement: Placement, reason: string): RescheduleMove {
  const meta = SESSION_TYPES[placement.type];
  return {
    sessionId: session.id,
    title: session.title,
    fromDate: session.date,
    toDate: placement.day.date,
    reason,
    newType: placement.reduced ? placement.type : null,
    newTitle: placement.reduced ? meta.label : null,
    newDurationMin: placement.reduced ? meta.defaultDurationMin : null,
    newLoad: placement.reduced ? meta.load : null,
  };
}

function placementReason(session: Session, placement: Placement): string {
  const meta = SESSION_TYPES[placement.type];
  if (placement.reduced) {
    return (
      `${formatShort(placement.day.date)} ist ${placement.day.shiftType.name} und trägt keine volle ` +
      `${session.title} mehr — deshalb in reduzierter Form als ${meta.label}.`
    );
  }
  return (
    `${formatShort(placement.day.date)} ist ${placement.day.shiftType.name} — der nächste Tag ` +
    `im Fenster, der eine ${session.title} trägt.`
  );
}

/**
 * Erzeugt einen Umplanungs-Vorschlag für eine verpasste Einheit.
 * Schreibt nichts — das macht erst applyRescheduleToSessions.
 */
export function proposeReschedule(missed: Session, ctx: RescheduleContext): ReschedulePlan {
  const trigger = { sessionId: missed.id, title: missed.title, date: missed.date };

  // Filler werden nicht nachgeholt.
  if (!missed.isKey && missed.load < HARD_LOAD_THRESHOLD) {
    return {
      trigger,
      moves: [],
      drops: [
        {
          sessionId: missed.id,
          title: missed.title,
          date: missed.date,
          reason: 'Lockere Einheit — wird nicht nachgeholt.',
        },
      ],
      summary:
        `${missed.title} war Füllvolumen, keine Key-Session. Nachholen würde nur die nächsten Tage ` +
        `überladen, deshalb fällt sie ersatzlos weg. Am Plan ändert sich sonst nichts.`,
    };
  }

  const working = ctx.sessions.map((s) => ({ ...s }));
  const moves: RescheduleMove[] = [];
  const drops: RescheduleDrop[] = [];

  const primary = findPlacement(missed, working, ctx, {
    allowDisplaceKeys: true,
    ignoreIds: new Set(),
  });

  if (!primary.placement) {
    const blockerNote =
      primary.keyBlockers.length > 0
        ? ` Die Tage mit genug Kapazität tragen bereits eine Key-Session (${primary.keyBlockers.slice(0, 3).join(', ')}).`
        : ` In den nächsten ${ctx.settings.rescheduleWindowDays} Tagen liegt kein Tag mit genug Kapazität.`;

    return {
      trigger,
      moves: [],
      drops: [
        {
          sessionId: missed.id,
          title: missed.title,
          date: missed.date,
          reason: 'Kein Tag im Fenster kann diese Einheit aufnehmen.',
        },
      ],
      summary:
        `${missed.title} lässt sich nicht mehr unterbringen.${blockerNote} Die Einheit entfällt — ` +
        `der Rest des Plans bleibt unangetastet, der nächste Zyklus startet wie geplant.`,
    };
  }

  const place = primary.placement;
  moves.push(moveFor(missed, place, placementReason(missed, place)));

  // Die verschobene Einheit belegt ihren neuen Tag ab jetzt.
  const movedIndex = working.findIndex((s) => s.id === missed.id);
  working[movedIndex] = { ...working[movedIndex], date: place.day.date, type: place.type };

  for (const filler of place.displacedFillers) {
    drops.push({
      sessionId: filler.id,
      title: filler.title,
      date: filler.date,
      reason: `Weicht ${missed.title} am ${formatShort(place.day.date)}. Lockere Einheit, entfällt ersatzlos.`,
    });
    const i = working.findIndex((s) => s.id === filler.id);
    if (i >= 0) working[i] = { ...working[i], status: 'skipped' };
  }

  // Verdrängte Key-Sessions bekommen selbst noch eine Chance — aber sie dürfen
  // ihrerseits niemanden verdrängen, sonst schiebt sich die Kette endlos fort.
  for (const key of place.displacedKeys) {
    const sub = findPlacement(key, working, ctx, {
      allowDisplaceKeys: false,
      ignoreIds: new Set([missed.id]),
    });

    if (sub.placement) {
      moves.push(
        moveFor(
          key,
          sub.placement,
          `${placementReason(key, sub.placement)} Musste ${missed.title} am ` +
            `${formatShort(place.day.date)} weichen.`,
        ),
      );
      const i = working.findIndex((s) => s.id === key.id);
      if (i >= 0) working[i] = { ...working[i], date: sub.placement.day.date, type: sub.placement.type };

      // Auch auf dem Ausweichtag gilt: eine Einheit pro Tag. Was dort locker
      // stand, entfällt — sonst stapeln sich zwei Sessions auf demselben Datum.
      for (const filler of sub.placement.displacedFillers) {
        drops.push({
          sessionId: filler.id,
          title: filler.title,
          date: filler.date,
          reason: `Weicht ${key.title} am ${formatShort(sub.placement.day.date)}. Lockere Einheit, entfällt ersatzlos.`,
        });
        const j = working.findIndex((s) => s.id === filler.id);
        if (j >= 0) working[j] = { ...working[j], status: 'skipped' };
      }
    } else {
      drops.push({
        sessionId: key.id,
        title: key.title,
        date: key.date,
        reason: `Weicht ${missed.title} und findet selbst keinen Ersatztag im Fenster.`,
      });
      const i = working.findIndex((s) => s.id === key.id);
      if (i >= 0) working[i] = { ...working[i], status: 'skipped' };
    }
  }

  const parts: string[] = [];
  parts.push(
    place.reduced
      ? `${missed.title} ist eine Key-Session und wird nicht einfach gestrichen. Ein voller Tag ist im ` +
          `Fenster nicht frei, deshalb rückt sie als ${SESSION_TYPES[place.type].label} auf ` +
          `${formatShort(place.day.date)}.`
      : `${missed.title} ist eine Key-Session und wird nicht gestrichen, sondern auf ` +
          `${formatShort(place.day.date)} verschoben.`,
  );
  if (place.displacedKeys.length > 0) {
    const profileName =
      ctx.settings.planningProfile === 'runFirst' ? 'Laufen hat Vorrang' : 'Kraft hat Vorrang';
    parts.push(
      `${place.displacedKeys.map((k) => k.title).join(' und ')} weicht dafür — so ist es im Profil ` +
        `"${profileName}" hinterlegt.`,
    );
  }
  const allDropped = drops.filter((d) => d.sessionId !== missed.id);
  if (allDropped.length > 0) {
    parts.push(`${allDropped.map((d) => d.title).join(' und ')} entfällt.`);
  }

  return { trigger, moves, drops, summary: parts.join(' ') };
}

/** Nimmt die Änderungen an einer Session-Liste vor. Rein, ohne Datenbankzugriff. */
export function applyRescheduleToSessions(sessions: Session[], plan: ReschedulePlan): Session[] {
  const ts = now();
  const moveById = new Map(plan.moves.map((m) => [m.sessionId, m]));
  const dropById = new Map(plan.drops.map((d) => [d.sessionId, d]));

  return sessions.map((session) => {
    const move = moveById.get(session.id);
    if (move) {
      const meta = move.newType ? SESSION_TYPES[move.newType] : null;
      return {
        ...session,
        date: move.toDate,
        originalDate: session.originalDate ?? move.fromDate,
        status: 'planned' as const,
        rescheduleReason: move.reason,
        ...(meta && move.newType
          ? {
              type: move.newType,
              title: meta.label,
              discipline: meta.discipline,
              plannedDurationMin: move.newDurationMin,
              zone: meta.defaultZone,
              targetRpe: meta.defaultRpe,
              load: meta.load,
              isKey: meta.isKey,
            }
          : {}),
        updatedAt: ts,
      };
    }

    const drop = dropById.get(session.id);
    if (drop) {
      return {
        ...session,
        status: 'skipped' as const,
        rescheduleReason: drop.reason,
        updatedAt: ts,
      };
    }

    return session;
  });
}
