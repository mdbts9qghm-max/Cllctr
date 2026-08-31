/**
 * Soul Collector.
 *
 * Jeder erreichte Meilenstein ist eine Seele, die eingesammelt wird. Das ist
 * kein aufgesetztes Abzeichen-System, sondern die Grundmetapher der App: Was
 * hier steht, besitzt man — es ist der Gegenwert für alles, was vorher an
 * Schichten, Umplanungen und durchgezogenen Einheiten lag.
 *
 * Zwei Grundsätze:
 *
 *   1. **Nichts wird verschenkt.** Jede Seele hängt an einer nachprüfbaren
 *      Bedingung aus den echten Daten.
 *   2. **Nichts bestraft.** Eine verpasste Einheit bricht keinen Streak, solange
 *      sie regelkonform umgeplant wurde. Wer ein Leben hat, verliert hier nichts.
 */

import { daysBetween } from './dates';
import { PROGRESSING_TYPES, progresses } from './progression';
import { resolveShiftDay, type ShiftContext } from './shifts';
import { isDaily, routineDays, routineFamily } from './tasks';
import {
  SESSION_TYPES,
  type IsoDate,
  type Mesocycle,
  type Microcycle,
  type PersonalRecord,
  type Session,
  type SessionLog,
  type Task,
  type WayArea,
  type SessionTypeKey,
  type SoulRarity,
  type SoulSourceKind,
} from './types';

export interface SoulContext {
  sessions: Session[];
  logs: SessionLog[];
  microcycles: Microcycle[];
  mesocycles: Mesocycle[];
  records: PersonalRecord[];
  tasks: Task[];
  wayAreas: WayArea[];
  shiftContext: ShiftContext;
  today: IsoDate;
}

/** Was eingesammelt werden kann, bevor es eingesammelt wurde. */
export interface SoulDefinition {
  key: string;
  name: string;
  description: string;
  rarity: SoulRarity;
  sourceKind: SoulSourceKind;
  /**
   * Findet alle Gelegenheiten, bei denen diese Seele verdient wurde.
   * Mehrfach einsammelbare Seelen liefern je Gelegenheit eine eigene sourceId.
   */
  earned: (ctx: SoulContext) => Array<{ sourceId: string | null; detail: string; date: IsoDate }>;
  /** Fortschritt für "in Reichweite", falls messbar. */
  progress?: (ctx: SoulContext) => { current: number; target: number; unit: string } | null;
}

/* ------------------------------------------------------------------ */
/* Hilfsgrößen                                                         */
/* ------------------------------------------------------------------ */

function completedLogs(ctx: SoulContext): Array<{ session: Session; log: SessionLog }> {
  const byId = new Map(ctx.sessions.map((s) => [s.id, s]));
  return ctx.logs
    .filter((l) => l.completed)
    .map((log) => ({ session: byId.get(log.sessionId), log }))
    .filter((x): x is { session: Session; log: SessionLog } => x.session !== undefined)
    .sort((a, b) => a.log.date.localeCompare(b.log.date));
}

function totalDistanceKm(ctx: SoulContext): number {
  return completedLogs(ctx).reduce((sum, x) => sum + (x.log.distanceKm ?? 0), 0);
}

/**
 * Erreichte Stufe je Einheitsart — allein aus erledigten Einheiten.
 *
 * Bewusst ohne die manuelle Korrektur aus den Einstellungen: eine Stufe, die
 * man sich selbst eingetragen hat, ist keine verdiente Seele.
 */
function earnedLevels(ctx: SoulContext): Partial<Record<SessionTypeKey, number>> {
  const out: Partial<Record<SessionTypeKey, number>> = {};
  for (const session of ctx.sessions) {
    if (session.status !== 'done' || !progresses(session.type)) continue;
    if (session.countsForProgression === false) continue;
    out[session.type] = (out[session.type] ?? 0) + 1;
  }
  return out;
}

/** Schichtarten, an denen überhaupt trainiert werden kann — echte Schichten. */
function trainableShifts(ctx: SoulContext) {
  return ctx.shiftContext.shiftTypes.filter(
    (t) => t.capacity !== 'none' && !t.cancelsPlanned && t.startTime !== null,
  );
}

function totalMinutes(ctx: SoulContext): number {
  return completedLogs(ctx).reduce((sum, x) => sum + (x.log.durationMin ?? 0), 0);
}

export type CycleVerdict = 'clean' | 'broken' | 'running' | 'paused';

/**
 * War dieser Zyklus sauber?
 *
 * Sauber heißt: jede geplante Einheit wurde entweder erledigt oder regelkonform
 * umgeplant. Der Unterschied liegt im Status — `skipped` mit Begründung ist eine
 * Entscheidung der App, `missed` ist eine, die offen geblieben ist. Nur letztere
 * bricht die Serie.
 */
export function cycleVerdict(micro: Microcycle, sessions: Session[], today: IsoDate): CycleVerdict {
  if (micro.endDate >= today) return 'running';

  const own = sessions.filter((s) => s.microcycleId === micro.id);
  if (own.length === 0) return 'running';

  // Ist in diesem Zyklus alles gestrichen worden — Krankheit, Abwesenheit —,
  // dann gab es nichts zu halten. Ein solcher Zyklus verdient keine Seele, darf
  // die Serie aber auch nicht brechen: eine Grippe ist kein Versäumnis.
  if (own.every((s) => s.status === 'skipped')) return 'paused';

  const done = own.filter((s) => s.status === 'done');
  if (done.length === 0) return 'broken';

  const unresolved = own.filter(
    (s) => s.status === 'missed' || (s.status === 'planned' && s.date < today),
  );
  if (unresolved.length > 0) return 'broken';

  return 'clean';
}

/** Wie viele abgeschlossene Zyklen in Folge sauber waren, bis heute zurück. */
export function currentStreak(ctx: SoulContext): number {
  const finished = ctx.microcycles
    .filter((m) => m.endDate < ctx.today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  let streak = 0;
  for (let i = finished.length - 1; i >= 0; i--) {
    const verdict = cycleVerdict(finished[i], ctx.sessions, ctx.today);
    // Ein ausgesetzter Zyklus zählt nicht mit, unterbricht die Serie aber auch
    // nicht — sie läuft dahinter weiter.
    if (verdict === 'paused') continue;
    if (verdict === 'clean') streak++;
    else break;
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* Der Katalog                                                         */
/* ------------------------------------------------------------------ */

function volumeSoul(
  key: string,
  name: string,
  description: string,
  rarity: SoulRarity,
  threshold: number,
): SoulDefinition {
  return {
    key,
    name,
    description,
    rarity,
    sourceKind: 'volume',
    earned: (ctx) => {
      const logs = completedLogs(ctx);
      let running = 0;
      for (const { log } of logs) {
        running += log.durationMin ?? 0;
        if (running >= threshold) {
          return [{ sourceId: null, detail: `${threshold} Minuten Training`, date: log.date }];
        }
      }
      return [];
    },
    progress: (ctx) => {
      const current = totalMinutes(ctx);
      return current >= threshold ? null : { current, target: threshold, unit: 'Min' };
    },
  };
}

function streakSoul(
  key: string,
  name: string,
  description: string,
  rarity: SoulRarity,
  target: number,
): SoulDefinition {
  return {
    key,
    name,
    description,
    rarity,
    sourceKind: 'streak',
    earned: (ctx) => {
      // Auch eine frühere, längst gebrochene Serie zählt — einmal verdient
      // bleibt verdient.
      const finished = ctx.microcycles
        .filter((m) => m.endDate < ctx.today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      let run = 0;
      for (const micro of finished) {
        if (cycleVerdict(micro, ctx.sessions, ctx.today) === 'clean') {
          run++;
          if (run >= target) {
            return [{ sourceId: null, detail: `${target} Zyklen in Folge`, date: micro.endDate }];
          }
        } else {
          run = 0;
        }
      }
      return [];
    },
    progress: (ctx) => {
      const streak = currentStreak(ctx);
      return streak >= target ? null : { current: streak, target, unit: 'Zyklen' };
    },
  };
}

/**
 * Tage, an denen **jede** tägliche Routine erledigt war, chronologisch.
 *
 * Eine einzelne Routine hält man leicht durch; alle zusammen ist der Maßstab,
 * der etwas aussagt.
 */
function fullRoutineDays(ctx: SoulContext): IsoDate[] {
  const families = [
    ...new Set(
      ctx.tasks
        .filter((t) => t.kind === 'chore' && isDaily(t))
        .map(routineFamily),
    ),
  ];
  if (families.length === 0) return [];

  const sets = families.map((f) => routineDays(ctx.tasks, f));
  const all = [...new Set(sets.flatMap((x) => [...x]))].sort();
  return all.filter((date) => sets.every((set) => set.has(date)));
}

/** Seele auf eine Serie voller Routine-Tage. */
function routineSoul(
  key: string,
  name: string,
  description: string,
  rarity: SoulRarity,
  target: number,
): SoulDefinition {
  const bestRun = (days: IsoDate[]) => {
    let run = 0;
    let best = 0;
    let hit: IsoDate | null = null;
    let previous: IsoDate | null = null;
    for (const date of days) {
      run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
      previous = date;
      if (run > best) best = run;
      if (run >= target && hit === null) hit = date;
    }
    return { best, hit };
  };

  return {
    key,
    name,
    description,
    rarity,
    sourceKind: 'streak',
    earned: (ctx) => {
      const { hit } = bestRun(fullRoutineDays(ctx));
      return hit ? [{ sourceId: null, detail: `${target} Tage in Folge`, date: hit }] : [];
    },
    progress: (ctx) => {
      const { best } = bestRun(fullRoutineDays(ctx));
      return best >= target ? null : { current: best, target, unit: 'Tage' };
    },
  };
}

/** Seele auf eine Anzahl protokollierter Einheiten. */
function countSoul(
  key: string,
  name: string,
  description: string,
  rarity: SoulRarity,
  target: number,
): SoulDefinition {
  return {
    key,
    name,
    description,
    rarity,
    sourceKind: 'volume',
    earned: (ctx) => {
      const logs = completedLogs(ctx);
      return logs.length >= target
        ? [{ sourceId: null, detail: `${target} Einheiten protokolliert`, date: logs[target - 1].log.date }]
        : [];
    },
    progress: (ctx) => {
      const current = completedLogs(ctx).length;
      return current >= target ? null : { current, target, unit: 'Einheiten' };
    },
  };
}

/** Seele auf gelaufene Kilometer. */
function distanceSoul(
  key: string,
  name: string,
  description: string,
  rarity: SoulRarity,
  target: number,
): SoulDefinition {
  return {
    key,
    name,
    description,
    rarity,
    sourceKind: 'volume',
    earned: (ctx) => {
      let running = 0;
      for (const { log } of completedLogs(ctx)) {
        running += log.distanceKm ?? 0;
        if (running >= target) {
          return [{ sourceId: null, detail: `${target} km gelaufen`, date: log.date }];
        }
      }
      return [];
    },
    progress: (ctx) => {
      const current = Math.round(totalDistanceKm(ctx));
      return current >= target ? null : { current, target, unit: 'km' };
    },
  };
}

/** Seele darauf, eine Einheitsart bis auf eine Stufe hochgearbeitet zu haben. */
function levelSoul(
  key: string,
  name: string,
  description: string,
  rarity: SoulRarity,
  target: number,
): SoulDefinition {
  return {
    key,
    name,
    description,
    rarity,
    sourceKind: 'streak',
    earned: (ctx) => {
      const levels = earnedLevels(ctx);
      const reached = PROGRESSING_TYPES.filter((t) => (levels[t] ?? 0) >= target);
      if (reached.length === 0) return [];

      // Datum der Einheit, mit der die Stufe erreicht wurde.
      const type = reached[0];
      const own = completedLogs(ctx)
        .filter((x) => x.session.type === type && x.session.countsForProgression !== false)
        .map((x) => x.log.date);
      return [
        {
          sourceId: null,
          detail: `${SESSION_TYPES[type].label} auf Stufe ${target}`,
          date: own[target - 1] ?? own[own.length - 1] ?? ctx.today,
        },
      ];
    },
    progress: (ctx) => {
      const levels = earnedLevels(ctx);
      const best = Math.max(0, ...PROGRESSING_TYPES.map((t) => levels[t] ?? 0));
      return best >= target ? null : { current: best, target, unit: 'Stufen' };
    },
  };
}

export const SOUL_CATALOG: SoulDefinition[] = [
  {
    key: 'first_session',
    name: 'Der erste Schritt',
    description: 'Die erste Einheit, die du protokolliert hast. Alles Weitere baut darauf auf.',
    rarity: 'common',
    sourceKind: 'manual',
    earned: (ctx) => {
      const first = completedLogs(ctx)[0];
      return first ? [{ sourceId: null, detail: first.session.title, date: first.log.date }] : [];
    },
  },

  {
    key: 'shift_session',
    name: 'Nach zwölf Stunden',
    description:
      'Eine Einheit an einem vollen Schichttag. Die zählt doppelt, auch wenn sie im Plan nur einmal steht.',
    rarity: 'common',
    sourceKind: 'manual',
    earned: (ctx) => {
      for (const { session, log } of completedLogs(ctx)) {
        const day = resolveShiftDay(log.date, ctx.shiftContext);
        if (day.capacity === 'light') {
          return [{ sourceId: null, detail: `${session.title} an ${day.shiftType.name}`, date: log.date }];
        }
      }
      return [];
    },
  },

  {
    key: 'night_before',
    name: 'Vor der Nacht',
    description:
      'Trainiert am Vormittag vor der Nachtschicht — die Einheit, die am leichtesten ausfällt.',
    rarity: 'common',
    sourceKind: 'manual',
    earned: (ctx) => {
      for (const { session, log } of completedLogs(ctx)) {
        const day = resolveShiftDay(log.date, ctx.shiftContext);
        if (day.shiftType.crossesMidnight) {
          return [{ sourceId: null, detail: session.title, date: log.date }];
        }
      }
      return [];
    },
  },

  {
    key: 'cycle_clean',
    name: 'Zyklus geschlossen',
    description:
      'Ein voller Rotationsdurchlauf ohne offene Einheit. Umgeplant zählt — nur Liegengelassenes nicht.',
    rarity: 'common',
    sourceKind: 'microcycle',
    earned: (ctx) =>
      ctx.microcycles
        .filter((m) => cycleVerdict(m, ctx.sessions, ctx.today) === 'clean')
        .map((m) => ({
          sourceId: m.id,
          detail: `${m.lengthDays} Tage, Last ${m.plannedLoad}`,
          date: m.endDate,
        })),
    progress: (ctx) => {
      const running = ctx.microcycles.find((m) => m.startDate <= ctx.today && m.endDate >= ctx.today);
      if (!running) return null;
      const own = ctx.sessions.filter((s) => s.microcycleId === running.id && s.status !== 'skipped');
      const done = own.filter((s) => s.status === 'done').length;
      return own.length > 0 ? { current: done, target: own.length, unit: 'Einheiten' } : null;
    },
  },

  {
    key: 'deload_held',
    name: 'Die Kunst des Weniger',
    description:
      'Eine Entlastungswoche wirklich locker gehalten. Schwerer als es klingt, und mehr wert als eine harte.',
    rarity: 'common',
    sourceKind: 'microcycle',
    earned: (ctx) =>
      ctx.microcycles
        .filter((m) => m.isDeload && cycleVerdict(m, ctx.sessions, ctx.today) === 'clean')
        .map((m) => ({ sourceId: m.id, detail: 'Deload durchgehalten', date: m.endDate })),
  },

  volumeSoul(
    'volume_500',
    'Fundament',
    '500 Minuten Training gesammelt. Der Anfang, den die meisten nicht schaffen.',
    'common',
    500,
  ),

  {
    key: 'double_day',
    name: 'Doppelt genommen',
    description: 'Laufen und Kraft an einem Tag — beides erledigt, nicht nur geplant.',
    rarity: 'rare',
    sourceKind: 'manual',
    earned: (ctx) => {
      const byDate = new Map<IsoDate, Session[]>();
      for (const { session } of completedLogs(ctx)) {
        const list = byDate.get(session.date) ?? [];
        list.push(session);
        byDate.set(session.date, list);
      }
      return [...byDate.entries()]
        .filter(([, list]) => list.length >= 2 && new Set(list.map((s) => s.discipline)).size >= 2)
        .map(([date, list]) => ({
          sourceId: date,
          detail: list.map((s) => s.title).join(' + '),
          date,
        }));
    },
  },

  {
    key: 'new_record',
    name: 'Neue Bestmarke',
    description: 'Ein Wert, den es vorher nicht gab. Die einzige Zahl, die wirklich etwas beweist.',
    rarity: 'rare',
    sourceKind: 'pr',
    earned: (ctx) =>
      ctx.records
        // Nur echte Verbesserungen, nicht der allererste eingetragene Wert.
        .filter((r) => r.previousValue !== null)
        // Das geschätzte 1RM ist abgeleitet, kein eigener Erfolg — sonst gäbe
        // es für einen schweren Satz gleich zwei Seelen.
        .filter((r) => r.kind !== 'estimated1rm')
        .map((r) => ({
          sourceId: r.id,
          detail: `${r.value} ${r.unit} statt ${r.previousValue} ${r.unit}`,
          date: r.date,
        })),
  },

  streakSoul(
    'streak_3',
    'Drei am Stück',
    'Drei Zyklen in Folge geschlossen. Ab hier ist es Gewohnheit, nicht mehr Motivation.',
    'rare',
    3,
  ),

  volumeSoul(
    'volume_2000',
    'Ausdauer',
    '2000 Minuten gesammelt. Mehr als 33 Stunden, die niemand außer dir gesehen hat.',
    'rare',
    2000,
  ),

  {
    key: 'meso_complete',
    name: 'Block vollendet',
    description:
      'Ein ganzer Trainingsblock von der ersten Belastung bis zum letzten Deload-Tag.',
    rarity: 'rare',
    sourceKind: 'mesocycle',
    earned: (ctx) =>
      ctx.mesocycles
        .filter((meso) => {
          if (meso.endDate >= ctx.today) return false;
          const own = ctx.microcycles.filter((m) => m.mesocycleId === meso.id);
          if (own.length === 0) return false;
          const clean = own.filter((m) => cycleVerdict(m, ctx.sessions, ctx.today) === 'clean');
          return clean.length / own.length >= 0.8;
        })
        .map((meso) => ({ sourceId: meso.id, detail: meso.name, date: meso.endDate })),
    progress: (ctx) => {
      const running = ctx.mesocycles.find((m) => m.startDate <= ctx.today && m.endDate >= ctx.today);
      if (!running) return null;
      const own = ctx.microcycles.filter((m) => m.mesocycleId === running.id);
      const done = own.filter((m) => m.endDate < ctx.today).length;
      return { current: done, target: own.length, unit: 'Zyklen' };
    },
  },

  {
    key: 'comeback',
    name: 'Wiederkehr',
    description:
      'Nach zwei Wochen Pause zurück auf die Bahn. Der schwerste Schritt im ganzen Sport.',
    rarity: 'legendary',
    sourceKind: 'comeback',
    earned: (ctx) => {
      const logs = completedLogs(ctx);
      const out: Array<{ sourceId: string; detail: string; date: IsoDate }> = [];
      for (let i = 1; i < logs.length; i++) {
        const gap = daysBetween(logs[i - 1].log.date, logs[i].log.date);
        if (gap >= 14) {
          out.push({
            sourceId: logs[i].log.date,
            detail: `${gap} Tage Pause, dann ${logs[i].session.title}`,
            date: logs[i].log.date,
          });
        }
      }
      return out;
    },
  },

  streakSoul(
    'streak_12',
    'Unbeirrbar',
    'Zwölf Zyklen in Folge. Zwei Monate, in denen die Schicht dich nicht aufgehalten hat.',
    'legendary',
    12,
  ),

  volumeSoul(
    'volume_10000',
    'Zehntausend',
    '10 000 Minuten. Das ist keine Phase mehr, das ist wer du bist.',
    'legendary',
    10000,
  ),

  /* ---------------------------------------------------------------- */
  /* Was der Tag hergab                                                */
  /* ---------------------------------------------------------------- */

  {
    key: 'bad_but_done',
    name: 'Trotzdem',
    description:
      'Eine Einheit, die sich schlecht angefühlt hat — und die du zu Ende gebracht hast. Die zählt mehr als drei gute.',
    rarity: 'common',
    sourceKind: 'manual',
    earned: (ctx) => {
      const hit = completedLogs(ctx).find((x) => x.log.feeling === 'bad');
      return hit ? [{ sourceId: null, detail: hit.session.title, date: hit.log.date }] : [];
    },
  },

  {
    key: 'easy_stayed_easy',
    name: 'Im Zaum gehalten',
    description:
      'Einen lockeren Lauf wirklich locker gelaufen — RPE 4 oder darunter. Der häufigste Fehler im Ausdauersport, hier vermieden.',
    rarity: 'common',
    sourceKind: 'manual',
    earned: (ctx) => {
      const hit = completedLogs(ctx).find(
        (x) =>
          (x.session.type === 'run_easy' ||
            x.session.type === 'run_long' ||
            x.session.type === 'run_recovery') &&
          x.log.rpe !== null &&
          x.log.rpe <= 4,
      );
      return hit
        ? [{ sourceId: null, detail: `${hit.session.title} bei RPE ${hit.log.rpe}`, date: hit.log.date }]
        : [];
    },
  },

  {
    key: 'first_level',
    name: 'Eine Stufe höher',
    description:
      'Zum ersten Mal dieselbe Einheitsart ein zweites Mal absolviert — ab hier steigert sich der Plan.',
    rarity: 'common',
    sourceKind: 'streak',
    earned: (ctx) => {
      const levels = earnedLevels(ctx);
      const type = PROGRESSING_TYPES.find((t) => (levels[t] ?? 0) >= 2);
      if (!type) return [];
      const own = completedLogs(ctx).filter((x) => x.session.type === type);
      return [
        {
          sourceId: null,
          detail: `${SESSION_TYPES[type].label} auf Stufe 2`,
          date: own[1]?.log.date ?? ctx.today,
        },
      ];
    },
  },

  countSoul(
    'sessions_25',
    'Fünfundzwanzig',
    '25 protokollierte Einheiten. Genug, dass es kein Zufall mehr ist.',
    'common',
    25,
  ),

  {
    key: 'way_first_step',
    name: 'Der erste Schritt zurück',
    description:
      'Die erste Stufe im Weg erreicht — drei Tage in Folge dasselbe getan. Von hier aus geht es weiter.',
    rarity: 'common',
    sourceKind: 'streak',
    earned: (ctx) => {
      const any = ctx.wayAreas.find((a) => a.level >= 1);
      return any
        ? [{ sourceId: null, detail: any.name, date: any.startedAt ?? ctx.today }]
        : [];
    },
  },

  routineSoul(
    'routines_3',
    'Drei Tage Ordnung',
    'Drei Tage hintereinander jede tägliche Routine erledigt. Der Anfang einer Gewohnheit.',
    'common',
    3,
  ),

  /* ---------------------------------------------------------------- */
  /* Handwerk                                                          */
  /* ---------------------------------------------------------------- */

  {
    key: 'long_run_90',
    name: 'Die lange Runde',
    description:
      'Neunzig Minuten am Stück gelaufen. Ab hier geht es nicht mehr um Beine, sondern um Kopf.',
    rarity: 'rare',
    sourceKind: 'manual',
    earned: (ctx) => {
      const hit = completedLogs(ctx).find(
        (x) => x.session.discipline === 'run' && (x.log.durationMin ?? 0) >= 90,
      );
      return hit
        ? [{ sourceId: null, detail: `${hit.log.durationMin} Min am Stück`, date: hit.log.date }]
        : [];
    },
    progress: (ctx) => {
      const best = Math.max(
        0,
        ...completedLogs(ctx)
          .filter((x) => x.session.discipline === 'run')
          .map((x) => x.log.durationMin ?? 0),
      );
      return best >= 90 ? null : { current: best, target: 90, unit: 'Min' };
    },
  },

  {
    key: 'all_shifts',
    name: 'Jede Schicht bespielt',
    description:
      'An jeder Schichtart trainiert, die überhaupt etwas trägt. Der Beweis, dass die Rotation dich nicht steuert.',
    rarity: 'rare',
    sourceKind: 'manual',
    earned: (ctx) => {
      const shifts = trainableShifts(ctx);
      if (shifts.length === 0) return [];

      const seen = new Map<string, IsoDate>();
      for (const { log } of completedLogs(ctx)) {
        const day = resolveShiftDay(log.date, ctx.shiftContext);
        if (!seen.has(day.shiftType.id)) seen.set(day.shiftType.id, log.date);
      }

      const dates = shifts.map((t) => seen.get(t.id));
      if (dates.some((d) => d === undefined)) return [];
      const last = (dates as IsoDate[]).sort().slice(-1)[0];
      return [{ sourceId: null, detail: shifts.map((t) => t.name).join(', '), date: last }];
    },
    progress: (ctx) => {
      const shifts = trainableShifts(ctx);
      if (shifts.length === 0) return null;
      const seen = new Set(
        completedLogs(ctx).map((x) => resolveShiftDay(x.log.date, ctx.shiftContext).shiftType.id),
      );
      const current = shifts.filter((t) => seen.has(t.id)).length;
      return current >= shifts.length
        ? null
        : { current, target: shifts.length, unit: 'Schichtarten' };
    },
  },

  levelSoul(
    'level_5',
    'Fünfte Stufe',
    'Eine Einheitsart fünfmal absolviert und damit fünf Stufen hochgearbeitet. Steigerung, die du dir verdient hast.',
    'rare',
    5,
  ),

  distanceSoul(
    'distance_100',
    'Hundert Kilometer',
    '100 km gelaufen, Meter für Meter selbst eingetragen.',
    'rare',
    100,
  ),

  countSoul(
    'sessions_100',
    'Hundert Einheiten',
    'Hundertmal angefangen, hundertmal fertig geworden.',
    'rare',
    100,
  ),

  volumeSoul(
    'volume_5000',
    'Fünftausend',
    '5000 Minuten. Über 80 Stunden, verteilt auf Früh-, Spät- und Nachtschichten.',
    'rare',
    5000,
  ),

  {
    key: 'way_area',
    name: 'Etappe steht',
    description:
      'Ein ganzer Bereich des Wegs läuft von selbst — vierzehn Tage in Folge, durch Nachtschichten hindurch.',
    rarity: 'rare',
    sourceKind: 'streak',
    earned: (ctx) =>
      ctx.wayAreas
        .filter((a) => a.status === 'established')
        .map((a) => ({
          sourceId: a.key,
          detail: a.name,
          date: a.establishedAt ?? ctx.today,
        })),
    progress: (ctx) => {
      const established = ctx.wayAreas.filter((a) => a.status === 'established').length;
      return ctx.wayAreas.length === 0 || established >= ctx.wayAreas.length
        ? null
        : { current: established, target: ctx.wayAreas.length, unit: 'Bereiche' };
    },
  },

  routineSoul(
    'routines_14',
    'Zwei Wochen Ordnung',
    'Vierzehn Tage am Stück jede Routine abgehakt — durch Nachtschichten und Schlaftage hindurch.',
    'rare',
    14,
  ),

  streakSoul(
    'streak_6',
    'Sechs am Stück',
    'Sechs Zyklen in Folge geschlossen. Einen ganzen Monat lang keine offene Einheit.',
    'rare',
    6,
  ),

  /* ---------------------------------------------------------------- */
  /* Das lange Spiel                                                   */
  /* ---------------------------------------------------------------- */

  levelSoul(
    'level_12',
    'Zwölfte Stufe',
    'Eine Einheitsart zwölfmal gesteigert. Aus 45 Minuten sind 111 geworden, aus 4× 400 m sind 6× 800 m.',
    'legendary',
    12,
  ),

  {
    key: 'level_all_5',
    name: 'Auf breiter Front',
    description:
      'Jede steigernde Einheitsart mindestens auf Stufe 5. Kein Lieblingstraining, keine Lücke.',
    rarity: 'legendary',
    sourceKind: 'streak',
    earned: (ctx) => {
      const levels = earnedLevels(ctx);
      if (PROGRESSING_TYPES.some((t) => (levels[t] ?? 0) < 5)) return [];
      return [{ sourceId: null, detail: 'Alle Arten auf Stufe 5', date: ctx.today }];
    },
    progress: (ctx) => {
      const levels = earnedLevels(ctx);
      const current = PROGRESSING_TYPES.filter((t) => (levels[t] ?? 0) >= 5).length;
      return current >= PROGRESSING_TYPES.length
        ? null
        : { current, target: PROGRESSING_TYPES.length, unit: 'Arten' };
    },
  },

  {
    key: 'way_complete',
    name: 'Wieder im Griff',
    description:
      'Alle vier Bereiche des Wegs stehen. Hygiene, Schlaf, Ernährung, Haushalt — nichts davon kostet dich noch Überwindung.',
    rarity: 'legendary',
    sourceKind: 'streak',
    earned: (ctx) => {
      if (ctx.wayAreas.length === 0) return [];
      const open = ctx.wayAreas.filter((a) => a.status !== 'established');
      return open.length === 0
        ? [{ sourceId: null, detail: `${ctx.wayAreas.length} Bereiche`, date: ctx.today }]
        : [];
    },
  },

  routineSoul(
    'routines_60',
    'Sechzig Tage Ordnung',
    'Zwei Monate ohne einen einzigen ausgelassenen Tag. Das Drumherum entscheidet über das Training.',
    'legendary',
    60,
  ),

  distanceSoul(
    'distance_500',
    'Fünfhundert Kilometer',
    '500 km. Die Strecke von München nach Hamburg, in Einzelteilen.',
    'legendary',
    500,
  ),

  {
    key: 'year_round',
    name: 'Ganzjährig',
    description:
      'In zwölf verschiedenen Monaten trainiert. Kein Sommerform-Sport, sondern das ganze Jahr.',
    rarity: 'legendary',
    sourceKind: 'event',
    earned: (ctx) => {
      const months = new Set<string>();
      let hit: IsoDate | null = null;
      for (const { log } of completedLogs(ctx)) {
        months.add(log.date.slice(0, 7));
        if (months.size >= 12 && hit === null) hit = log.date;
      }
      return hit ? [{ sourceId: null, detail: '12 Monate mit Training', date: hit }] : [];
    },
    progress: (ctx) => {
      const months = new Set(completedLogs(ctx).map((x) => x.log.date.slice(0, 7)));
      return months.size >= 12 ? null : { current: months.size, target: 12, unit: 'Monate' };
    },
  },
];

export const SOUL_BY_KEY = new Map(SOUL_CATALOG.map((d) => [d.key, d]));

/* ------------------------------------------------------------------ */
/* Auswertung                                                          */
/* ------------------------------------------------------------------ */

export interface EarnedSoul {
  definition: SoulDefinition;
  sourceId: string | null;
  detail: string;
  date: IsoDate;
}

/** Alle Seelen, die nach dem aktuellen Datenstand verdient sind. */
export function evaluateSouls(ctx: SoulContext): EarnedSoul[] {
  const out: EarnedSoul[] = [];
  for (const definition of SOUL_CATALOG) {
    for (const hit of definition.earned(ctx)) {
      out.push({ definition, ...hit });
    }
  }
  return out;
}

export interface SoulProgress {
  definition: SoulDefinition;
  current: number;
  target: number;
  unit: string;
  /** 0–1. */
  ratio: number;
}

/**
 * Seelen in Reichweite — sortiert nach Nähe.
 * Bewusst nur die, die messbar näher rücken; ein "vielleicht irgendwann"
 * motiviert niemanden.
 */
export function soulsInReach(
  ctx: SoulContext,
  collectedKeys: Set<string>,
  limit = 3,
): SoulProgress[] {
  const out: SoulProgress[] = [];

  for (const definition of SOUL_CATALOG) {
    if (!definition.progress) continue;
    // Mehrfach einsammelbare Seelen bleiben in Reichweite, einmalige nicht.
    const repeatable = definition.key === 'cycle_clean' || definition.key === 'meso_complete';
    if (!repeatable && collectedKeys.has(definition.key)) continue;

    const progress = definition.progress(ctx);
    if (!progress || progress.target <= 0) continue;
    if (progress.current >= progress.target) continue;

    out.push({ definition, ...progress, ratio: progress.current / progress.target });
  }

  return out.sort((a, b) => b.ratio - a.ratio).slice(0, limit);
}

export const RARITY_ORDER: Record<SoulRarity, number> = {
  legendary: 0,
  rare: 1,
  common: 2,
};
