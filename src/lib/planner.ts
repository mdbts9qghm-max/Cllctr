/**
 * Trainingsgenerator.
 *
 * Läuft **Tag für Tag** durch den Kalender. Für jeden Tag steht die Frage in
 * derselben Reihenfolge wie im Regelwerk:
 *
 *   1. Was gibt die Erholung her?   (readiness)
 *   2. Was gibt die Schicht her?    (rules.dayAllowance)
 *   3. Was fehlt der Woche noch?    (rules.chooseSession)
 *
 * Vorher wurde auf Rotationszyklen geplant und die Einheiten wurden per
 * Best-Fit auf die Tage verteilt. Das konnte die neuen Regeln nicht abbilden:
 * Sie hängen an der Erholung des einzelnen Tages und an Wochengrenzen —
 * höchstens drei harte Einheiten pro Woche, nie mehr als zwei harte Tage in
 * Folge, Volumensteigerung von Woche zu Woche. Ein Verfahren, das erst alle
 * Wünsche sammelt und dann verteilt, kann keine davon zuverlässig einhalten.
 *
 * Ein Mikrozyklus ist deshalb jetzt eine Kalenderwoche.
 */

import { addDays, dateRange, daysBetween, startOfWeek, today } from './dates';
import { newId, now } from './ids';
import { type ShiftContext, resolveShiftRange } from './shifts';
import { plannedRecovery, sleepDebtOf } from './readiness';
import {
  addToLedger,
  chooseSession,
  dayAllowance,
  emptyLedger,
  restAdvice,
  type DayAllowance,
  type DayContext,
  type WeekLedger,
} from './rules';
import { levelOf, progresses, sessionForm, type ProgressionLevels } from './progression';
import {
  SESSION_TYPES,
  type DayReadiness,
  type IsoDate,
  type Macrocycle,
  type Mesocycle,
  type Microcycle,
  type ResolvedShiftDay,
  type Session,
  type SessionTypeKey,
  type Settings,
} from './types';

/** Untergrenze, unter die keine Einheit gekürzt wird — darunter lohnt sie nicht. */
const MIN_SESSION_MIN = 20;

/* ------------------------------------------------------------------ */
/* Eingaben                                                            */
/* ------------------------------------------------------------------ */

export interface PlanInput {
  startDate: IsoDate;
  ctx: ShiftContext;
  settings: Settings;
  /** Wie viele Kalenderwochen im Voraus geplant werden. */
  weeks: number;
  name?: string;
  /** Bereits erreichte Stufen. Ohne Angabe startet jede Einheitsart bei 0. */
  progressionBase?: ProgressionLevels;
  /**
   * Was an welchem Tag schon erledigt oder fixiert ist. Diese Tage bekommen
   * nichts Neues, zählen aber für alle Regeln mit — wer gestern hart gelaufen
   * ist, bekommt heute nichts Hartes, auch wenn der alte Plan ersetzt wurde.
   */
  completed?: Array<{ date: IsoDate; type: SessionTypeKey }>;
  /** Schlaf und Erholung je Tag. Fehlende Tage: siehe readiness.plannedRecovery. */
  readiness?: Map<IsoDate, DayReadiness>;
  /** Der heutige Tag. Trennt "noch planbar" von "war so". Nur für Tests gesetzt. */
  todayIso?: IsoDate;
  /** Letzter Tag, für den überhaupt geplant wird. */
  until?: IsoDate;
  /**
   * Harte Einheiten **vor** dem Startdatum. Ohne sie fiele der erste geplante
   * Tag unter Umständen direkt hinter zwei harte Tage — die Regel gegen drei
   * harte Tage in Folge muss über die Plangrenze hinweg greifen.
   */
  history?: Array<{ date: IsoDate; type: SessionTypeKey }>;
}

export interface GeneratedPlan {
  macrocycle: Macrocycle;
  mesocycles: Mesocycle[];
  microcycles: Microcycle[];
  sessions: Session[];
  /** Tage, an denen die Regeln nichts zugelassen haben, mit Begründung. */
  restDays: Array<{ date: IsoDate; reason: string }>;
  /** Wochenziele, die nicht erreicht wurden — die Schicht gab sie nicht her. */
  shortfalls: Array<{ weekStart: IsoDate; missing: string }>;
  progressionBase: ProgressionLevels;
}

/* ------------------------------------------------------------------ */
/* Fingerabdruck                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fingerabdruck aller Eingaben, aus denen ein Plan entsteht.
 *
 * Ändert sich davon etwas — eine Schicht, ein Erholungseintrag, ein Ziel —,
 * dann beschreibt der bestehende Plan einen Tag, den es nicht mehr gibt, und
 * die App passt ihn selbst an. Bewusst nur die **Eingaben**: Was man abhakt
 * oder verschiebt, ist keine Änderung der Grundlage.
 */
export function planFingerprint(
  ctx: ShiftContext,
  settings: Settings,
  from: IsoDate,
  readiness?: Map<IsoDate, DayReadiness>,
): string {
  const rotation = ctx.pattern
    ? `${ctx.pattern.anchorDate}|${ctx.pattern.sequence.join(',')}`
    : 'keine';

  // Art und Abwesenheitsmarke entscheiden über die Planung; Name und Farbe
  // nicht — eine Umbenennung soll den Plan nicht anfassen.
  const types = [...ctx.shiftTypes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `${t.id}:${t.kind ?? t.capacity}:${t.cancelsPlanned ? 'x' : '-'}`)
    .join(',');

  const overrides = ctx.overrides
    .filter((o) => o.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((o) => `${o.date}:${o.shiftTypeId}`)
    .join(',');

  // Die Erholung gehört genauso dazu: Trägt man für morgen "niedrig" ein, darf
  // dort morgen keine harte Einheit mehr stehen, ohne dass man etwas drückt.
  const rest = readiness
    ? [...readiness.values()]
        .filter((r) => r.date >= from)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => `${r.date}:${r.recovery}:${r.sleepDebt}:${r.sleepHours ?? '-'}`)
        .join(',')
    : '';

  const zones = settings.hrZones.map((z) => `${z.zone}:${z.minBpm}-${z.maxBpm}`).join(',');

  const t = settings.weeklyTargets;
  const rules = [
    t.strength,
    t.run,
    t.optional,
    t.maxHardPerWeek,
    t.strengthHard,
    settings.maxConsecutiveHardDays,
    settings.weeklyVolumeGrowthPct,
    settings.mesoLoadCycles,
    settings.mesoDeloadCycles,
  ].join('|');

  return `2;${rotation};${types};${overrides};${rest};${rules};${zones}`;
}

/* ------------------------------------------------------------------ */
/* Historie: harte Tage                                                */
/* ------------------------------------------------------------------ */

/** Führt mit, an welchen Tagen hart trainiert wurde — geplant wie erledigt. */
class HardDays {
  private readonly days = new Set<IsoDate>();

  constructor(entries: Array<{ date: IsoDate; type: SessionTypeKey }> = []) {
    for (const e of entries) this.add(e.date, e.type);
  }

  add(date: IsoDate, type: SessionTypeKey): void {
    if (SESSION_TYPES[type]?.countsAsHardDay) this.days.add(date);
  }

  /** Harte Tage in den sieben Tagen vor diesem Datum. */
  last7(date: IsoDate): number {
    let count = 0;
    for (let i = 1; i <= 7; i++) if (this.days.has(addDays(date, -i))) count++;
    return count;
  }

  /** Wie viele harte Tage unmittelbar vor diesem Datum liegen. */
  streakBefore(date: IsoDate): number {
    let count = 0;
    let cursor = addDays(date, -1);
    while (this.days.has(cursor)) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }
}

/* ------------------------------------------------------------------ */
/* Wochen                                                              */
/* ------------------------------------------------------------------ */

interface WeekSpan {
  start: IsoDate;
  end: IsoDate;
  /** Fortlaufender Index über den ganzen Plan, 0-basiert. */
  index: number;
  isDeload: boolean;
  /** Index des Mesozyklus, 0-basiert. */
  mesoIndex: number;
}

/**
 * Zerlegt den Zeitraum in Kalenderwochen.
 *
 * Die erste Woche ist fast immer angebrochen — geplant wird ab heute, nicht ab
 * dem letzten Montag. Sie bekommt trotzdem die vollen Wochenziele anteilig,
 * sonst hätte jeder neue Plan eine leere Anfangswoche.
 */
function weekSpans(from: IsoDate, to: IsoDate, settings: Settings): WeekSpan[] {
  const perMeso = Math.max(1, settings.mesoLoadCycles + settings.mesoDeloadCycles);
  const spans: WeekSpan[] = [];
  let cursor = from;
  let index = 0;

  while (cursor <= to) {
    const end = minDate(addDays(startOfWeek(cursor), 6), to);
    const inMeso = index % perMeso;
    spans.push({
      start: cursor,
      end,
      index,
      isDeload: inMeso >= settings.mesoLoadCycles,
      mesoIndex: Math.floor(index / perMeso),
    });
    cursor = addDays(end, 1);
    index++;
  }
  return spans;
}

function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

/**
 * Anteilige Wochenziele für eine angebrochene Woche.
 *
 * Eine Woche, die am Freitag beginnt, kann keine drei Krafteinheiten tragen.
 * Ohne diese Kürzung stünde in der ersten Woche jedes neuen Plans ein Ziel,
 * das nie erreichbar war — und die App meldete jede Woche ein Defizit, das
 * keines ist.
 */
function scaledTargets(settings: Settings, days: number): Settings['weeklyTargets'] {
  const t = settings.weeklyTargets;
  if (days >= 7) return t;
  const f = days / 7;
  const scale = (n: number) => Math.max(0, Math.round(n * f));
  return {
    strength: scale(t.strength),
    run: scale(t.run),
    optional: scale(t.optional),
    // Die Obergrenze wird ebenfalls anteilig gezogen, sonst passten in drei
    // Resttage drei harte Einheiten.
    maxHardPerWeek: Math.max(1, scale(t.maxHardPerWeek)),
    strengthHard: scale(t.strengthHard),
  };
}

/* ------------------------------------------------------------------ */
/* Plan erzeugen                                                       */
/* ------------------------------------------------------------------ */

export function generateTrainingPlan(input: PlanInput): GeneratedPlan {
  const { startDate, ctx, settings } = input;
  const ts = now();
  const readiness = input.readiness ?? new Map<IsoDate, DayReadiness>();
  const maxStreak = Math.max(1, settings.maxConsecutiveHardDays ?? 2);
  const todayIso = input.todayIso ?? today();

  const lastDay = input.until ?? addDays(startDate, Math.max(1, input.weeks) * 7 - 1);
  const spans = lastDay >= startDate ? weekSpans(startDate, lastDay, settings) : [];

  // Was an welchem Tag schon liegt — bleibt stehen, zählt aber für alle Regeln.
  const occupied = new Map<IsoDate, SessionTypeKey[]>();
  for (const done of input.completed ?? []) {
    occupied.set(done.date, [...(occupied.get(done.date) ?? []), done.type]);
  }

  const hard = new HardDays([...(input.history ?? []), ...(input.completed ?? [])]);

  const macrocycle: Macrocycle = {
    id: newId('macro'),
    name: input.name ?? 'Ganzjährig',
    goalKind: 'yearRound',
    startDate,
    endDate: spans.length > 0 ? spans[spans.length - 1].end : startDate,
    targetEventName: null,
    targetEventDate: null,
    active: true,
    inputFingerprint: planFingerprint(ctx, settings, startDate, readiness),
    createdAt: ts,
    updatedAt: ts,
  };

  const mesocycles: Mesocycle[] = [];
  const microcycles: Microcycle[] = [];
  const sessions: Session[] = [];
  const restDays: GeneratedPlan['restDays'] = [];
  const shortfalls: GeneratedPlan['shortfalls'] = [];

  let levels: ProgressionLevels = { ...(input.progressionBase ?? {}) };
  // Wechselt die harten Läufe durch. Startet dort, wo der Verlauf aufgehört hat.
  let hardRunRotation = (input.history ?? []).filter(
    (h) => SESSION_TYPES[h.type]?.discipline === 'run' && SESSION_TYPES[h.type]?.countsAsHardDay,
  ).length;
  // Bezugspunkt für die Steigerung: die letzte **volle Belastungswoche**.
  // Eine angebrochene erste Woche oder eine Deload-Woche taugt nicht dafür —
  // gegen sie gemessen sähe jede normale Woche wie ein Sprung aus.
  let referenceMinutes = 0;

  const mesoById = new Map<number, Mesocycle>();

  for (const span of spans) {
    const days = resolveShiftRange(span.start, span.end, ctx);
    const lengthDays = days.length;
    const targets = scaledTargets(settings, lengthDays);
    let ledger: WeekLedger = emptyLedger();
    const weekSessions: Session[] = [];
    const lowRecoveryDays: IsoDate[] = [];

    for (const day of days) {
      const row = readiness.get(day.date);
      const recovery = plannedRecovery(day.date, row, todayIso);
      if (recovery === 'low') lowRecoveryDays.push(day.date);

      const dayCtx: DayContext = {
        date: day.date,
        shift: day,
        recovery,
        sleepHours: row?.sleepHours ?? null,
        sleepDebt: sleepDebtOf(row),
        hardLast7: hard.last7(day.date),
        hardStreakBefore: hard.streakBefore(day.date),
        hardThisWeek: ledger.hardRun + ledger.hardStrength,
        isDeloadWeek: span.isDeload,
      };

      const allowance = dayAllowance(dayCtx, targets, maxStreak);

      // Tage mit Erledigtem bekommen nichts Neues — sie zählen nur mit.
      const already = occupied.get(day.date);
      if (already && already.length > 0) {
        for (const type of already) {
          ledger = addToLedger(ledger, day.date, type);
          hard.add(day.date, type);
        }
        continue;
      }

      const choice = chooseSession(allowance, ledger, targets, dayCtx, hardRunRotation);
      if (!choice) {
        restDays.push({ date: day.date, reason: restAdvice(dayCtx, allowance) });
        continue;
      }

      const meta = SESSION_TYPES[choice.type];
      const step = levelOf(levels, choice.type);
      const form = sessionForm(choice.type, settings.hrZones, step, span.isDeload);

      weekSessions.push({
        id: newId('ses'),
        microcycleId: '',
        date: day.date,
        orderInDay: 1,
        discipline: meta.discipline,
        type: choice.type,
        intensity: meta.intensity,
        title: meta.label,
        plannedDurationMin: form.durationMin,
        plannedDistanceKm: null,
        zone: meta.defaultZone,
        targetRpe: form.targetRpe,
        isKey: meta.isKey && !span.isDeload,
        load: Math.round(meta.load * (span.isDeload ? 0.6 : 1) * 10) / 10,
        progressionStep: step,
        progressionNote: form.note,
        countsForProgression: !span.isDeload && progresses(choice.type),
        content: form.content,
        status: 'planned',
        originalDate: null,
        rescheduleReason: null,
        planReason: reasonText(allowance, choice.why),
        locked: false,
        manuallyEdited: false,
        createdAt: ts,
        updatedAt: ts,
      });

      ledger = addToLedger(ledger, day.date, choice.type);
      hard.add(day.date, choice.type);
      if (meta.discipline === 'run' && meta.countsAsHardDay) hardRunRotation++;
      // Die Stufe steigt nur außerhalb des Deloads: dort wird bewusst unter
      // dem erreichten Stand trainiert, das ist kein Fortschritt.
      if (!span.isDeload && progresses(choice.type)) {
        levels = { ...levels, [choice.type]: step + 1 };
      }
    }

    // Volumensteigerung begrenzen: höchstens der eingestellte Prozentsatz mehr
    // als in der Vorwoche, und bei schlechter Erholung gar keine Steigerung.
    const grown = capWeeklyVolume(
      weekSessions,
      referenceMinutes,
      settings.weeklyVolumeGrowthPct ?? 8,
      span.isDeload,
      lowRecoveryDays.length >= 2,
    );

    const meso = mesoById.get(span.mesoIndex) ?? {
      id: newId('meso'),
      macrocycleId: macrocycle.id,
      index: span.mesoIndex + 1,
      name: `Block ${span.mesoIndex + 1}`,
      startDate: span.start,
      endDate: span.end,
      loadCycles: settings.mesoLoadCycles,
      deloadCycles: settings.mesoDeloadCycles,
      focus: 'maintain' as const,
      emphasis: 'balanced' as const,
      status: span.mesoIndex === 0 ? ('active' as const) : ('planned' as const),
      createdAt: ts,
      updatedAt: ts,
    };
    meso.endDate = span.end;
    if (!mesoById.has(span.mesoIndex)) {
      mesoById.set(span.mesoIndex, meso);
      mesocycles.push(meso);
    }

    const micro: Microcycle = {
      id: newId('micro'),
      mesocycleId: meso.id,
      index: span.index + 1,
      startDate: span.start,
      endDate: span.end,
      lengthDays,
      plannedHard: ledger.hardRun + ledger.hardStrength,
      plannedMinutes: grown.minutes,
      isDeload: span.isDeload,
      targetSessions: targets,
      plannedLoad: Math.round(weekSessions.reduce((sum, s) => sum + s.load, 0) * 10) / 10,
      progression: { ...levels },
      createdAt: ts,
      updatedAt: ts,
    };

    for (const session of weekSessions) session.microcycleId = micro.id;
    microcycles.push(micro);
    sessions.push(...weekSessions);
    if (!span.isDeload && lengthDays >= 7) referenceMinutes = grown.minutes;

    const missing = describeShortfall(ledger, targets);
    if (missing) shortfalls.push({ weekStart: span.start, missing });
  }

  return {
    macrocycle,
    mesocycles,
    microcycles,
    sessions,
    restDays,
    shortfalls,
    progressionBase: input.progressionBase ?? {},
  };
}

function reasonText(allowance: DayAllowance, why: string): string {
  return [allowance.reason, why, ...allowance.limits].join(' ');
}

/**
 * Hält die Wochensteigerung im Rahmen.
 *
 * Die Einheiten wachsen einzeln, jede nach ihrer eigenen Stufe. In Summe kann
 * eine Woche dadurch einen Sprung machen, den keine der Einheiten für sich
 * gerechtfertigt hätte — und genau daran gehen Läufer kaputt. Deshalb wird das
 * Wochenvolumen gegen die Vorwoche geprüft und, wenn nötig, gekürzt.
 *
 * Gekürzt werden ausschließlich die **lockeren** Einheiten: Der harte Reiz ist
 * der Sinn der Woche, das lockere Volumen ist die Stellschraube.
 */
function capWeeklyVolume(
  weekSessions: Session[],
  previousMinutes: number,
  growthPct: number,
  isDeload: boolean,
  poorRecovery: boolean,
): { minutes: number } {
  const total = () => weekSessions.reduce((sum, s) => sum + (s.plannedDurationMin ?? 0), 0);
  let minutes = total();

  if (previousMinutes <= 0) return { minutes };

  // Im Deload ist weniger die Absicht, nicht das Problem — nichts zu begrenzen.
  if (isDeload) return { minutes };

  // Bei schlechter Erholung wird das Volumen gehalten, nicht gesteigert.
  const factor = poorRecovery ? 1 : 1 + Math.max(0, growthPct) / 100;
  const ceiling = Math.round(previousMinutes * factor);
  if (minutes <= ceiling) return { minutes };

  // Erst die lockeren Einheiten kürzen, dann die mittleren. Harte nie: Sie sind
  // der Reiz, um den die Woche gebaut ist — sie zu beschneiden hieße, das
  // Training zu opfern statt das Volumen.
  for (const level of ['easy', 'medium'] as const) {
    const trimmable = weekSessions
      .filter((s) => s.intensity === level && (s.plannedDurationMin ?? 0) > MIN_SESSION_MIN)
      .sort((a, b) => (b.plannedDurationMin ?? 0) - (a.plannedDurationMin ?? 0));

    for (const session of trimmable) {
      if (minutes <= ceiling) break;
      const current = session.plannedDurationMin ?? 0;
      const cut = Math.min(current - MIN_SESSION_MIN, minutes - ceiling);
      if (cut <= 0) continue;
      session.plannedDurationMin = current - cut;
      session.progressionNote =
        `${session.progressionNote ?? ''} Gekürzt, damit die Woche nicht mehr als ${growthPct} % über der letzten Belastungswoche liegt.`.trim();
      minutes -= cut;
    }
    if (minutes <= ceiling) break;
  }

  return { minutes: total() };
}

/** Ein Satz darüber, was der Woche zum Ziel fehlt — oder null, wenn nichts fehlt. */
function describeShortfall(ledger: WeekLedger, targets: Settings['weeklyTargets']): string | null {
  const parts: string[] = [];
  const hardRunMissing = targets.run - ledger.hardRun;
  const strengthMissing = targets.strength - ledger.hardStrength - ledger.mediumStrength;
  if (hardRunMissing > 0) parts.push(`${hardRunMissing}× harte Ausdauer`);
  if (strengthMissing > 0) parts.push(`${strengthMissing}× Kraft`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Grenzen der Kalenderwoche, in der dieses Datum liegt.
 *
 * Ersetzt das frühere `cycleBoundsFor`, das die Rotation abfragte. Es gibt
 * keinen Rotationszyklus mehr, an dem etwas hinge — der Plan rechnet in Wochen.
 */
export function weekBoundsFor(date: IsoDate): { start: IsoDate; length: number } {
  return { start: startOfWeek(date), length: 7 };
}

/**
 * Was an einem einzelnen Tag gilt, ohne den ganzen Plan zu erzeugen.
 *
 * Für den Plan-Screen: Dort soll auch an einem Ruhetag stehen, *warum* er einer
 * ist. Diese Antwort kommt aus demselben Regelwerk wie der Plan selbst — es
 * gibt bewusst keine zweite, vereinfachte Erklärung daneben.
 */
export function explainDay(
  day: ResolvedShiftDay,
  readiness: DayReadiness | undefined,
  settings: Settings,
  hardBefore: { last7: number; streak: number; thisWeek: number },
  isDeloadWeek: boolean,
  todayIso: IsoDate = today(),
): { ctx: DayContext; allowance: DayAllowance } {
  const ctx: DayContext = {
    date: day.date,
    shift: day,
    recovery: plannedRecovery(day.date, readiness, todayIso),
    sleepHours: readiness?.sleepHours ?? null,
    sleepDebt: sleepDebtOf(readiness),
    hardLast7: hardBefore.last7,
    hardStreakBefore: hardBefore.streak,
    hardThisWeek: hardBefore.thisWeek,
    isDeloadWeek,
  };
  return {
    ctx,
    allowance: dayAllowance(ctx, settings.weeklyTargets, Math.max(1, settings.maxConsecutiveHardDays ?? 2)),
  };
}

/** Zählt harte Tage rund um ein Datum aus einer Liste von Einheiten. */
export function hardContextFor(
  date: IsoDate,
  sessions: Array<{ date: IsoDate; type: SessionTypeKey; status: string }>,
): { last7: number; streak: number; thisWeek: number } {
  const days = new Set<IsoDate>();
  for (const s of sessions) {
    if (s.status === 'skipped' || s.status === 'missed') continue;
    if (SESSION_TYPES[s.type]?.countsAsHardDay) days.add(s.date);
  }

  let last7 = 0;
  for (let i = 1; i <= 7; i++) if (days.has(addDays(date, -i))) last7++;

  let streak = 0;
  let cursor = addDays(date, -1);
  while (days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const weekStart = startOfWeek(date);
  const thisWeek = dateRange(weekStart, addDays(date, -1)).filter((d) => days.has(d)).length;

  return { last7, streak, thisWeek };
}

/** Wie viele Tage der Plan noch abdeckt. Für die Anzeige "geplant bis …". */
export function planReach(macro: Macrocycle | undefined, from: IsoDate): number {
  if (!macro?.endDate) return 0;
  return Math.max(0, daysBetween(from, macro.endDate) + 1);
}
