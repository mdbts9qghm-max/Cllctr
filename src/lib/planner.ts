/**
 * Trainingsgenerator.
 *
 * Plant auf **Rotationszyklen**, nicht auf Kalenderwochen: ein Mikrozyklus ist
 * ein voller Durchlauf der Schichtrotation. Nur so ist jeder Zyklus gleich
 * aufgebaut und die Belastung schwankt nicht damit, wie die Rotation gerade in
 * der Woche liegt. Die Anzeige rechnet das für den Nutzer in Wochen zurück.
 *
 * Der eigentliche Engpass sind die vollen Tage: pro Zyklus gibt es davon nur
 * zwei, und drei Session-Typen konkurrieren darum (Intervalle, Long Run, Kraft
 * Unterkörper). Welcher gewinnt, entscheidet das Planungsprofil.
 */

import { addDays, daysBetween, mod } from './dates';
import { newId, now } from './ids';
import { capacityAllows, type ShiftContext, resolveShiftRange } from './shifts';
import {
  CAPACITY_RANK,
  SESSION_TYPES,
  type HrZone,
  type IsoDate,
  type Macrocycle,
  type Mesocycle,
  type Microcycle,
  type PlanningProfile,
  type ResolvedShiftDay,
  type Session,
  type SessionBlock,
  type SessionTypeKey,
  type Settings,
  type WeeklyTargets,
} from './types';

/**
 * Keine zwei harten Tage in Folge.
 *
 * Als hart zählen nur Intervalle, Tempolauf und Long Run (siehe
 * SessionTypeMeta.countsAsHardDay) — Krafttraining nicht. Deshalb lassen sich
 * die beiden nebeneinanderliegenden freien Tage trotz dieser strengen Regel
 * beide nutzen: einer bekommt den harten Lauf, der andere Gym.
 */
const MAX_CONSECUTIVE_HARD_DAYS = 1;

/* ------------------------------------------------------------------ */
/* Inhalte                                                             */
/* ------------------------------------------------------------------ */

function zoneText(zones: HrZone[], zone: number | null): string {
  if (zone === null) return '';
  const z = zones.find((x) => x.zone === zone);
  if (!z || z.maxBpm === 0) return `Zone ${zone}`;
  return `Zone ${zone} · ${z.minBpm}–${z.maxBpm} bpm`;
}

/**
 * Konkreter Inhalt einer Session, zusammen mit der Dauer.
 *
 * Beides entsteht bewusst an einer Stelle: eine separat hochgerechnete Dauer
 * würde sonst dem Text im Inhalt widersprechen ("18 Min" über "30 Min locker").
 */
function buildSessionPlan(
  type: SessionTypeKey,
  zones: HrZone[],
  isDeload: boolean,
): { content: SessionBlock[]; durationMin: number } {
  const blocks = buildContent(type, zones, isDeload);
  return { content: blocks, durationMin: durationFor(type, isDeload) };
}

/** Dauer in Minuten, im Deload auf runde, kürzere Werte gesetzt. */
function durationFor(type: SessionTypeKey, isDeload: boolean): number {
  if (!isDeload) return SESSION_TYPES[type].defaultDurationMin;
  const deloadDurations: Record<SessionTypeKey, number> = {
    run_intervals: 40,
    run_tempo: 35,
    run_long: 60,
    run_easy: 30,
    run_recovery: 20,
    strength_lower: 40,
    strength_upper: 40,
    strength_full: 40,
    strength_short: 25,
    mobility: 20,
  };
  return deloadDurations[type];
}

function buildContent(
  type: SessionTypeKey,
  zones: HrZone[],
  isDeload: boolean,
): SessionBlock[] {
  const warmup = { label: 'Einlaufen', detail: `10–15 Min ${zoneText(zones, 1)}` };
  const cooldown = { label: 'Auslaufen', detail: `10 Min ${zoneText(zones, 1)}` };

  switch (type) {
    case 'run_intervals':
      return isDeload
        ? [warmup, { label: 'Hauptteil', detail: `4× 2 Min ${zoneText(zones, 3)}, 2 Min Trabpause` }, cooldown]
        : [
            warmup,
            { label: 'Hauptteil', detail: `6× 800 m ${zoneText(zones, 4)}, 2 Min Trabpause` },
            cooldown,
          ];
    case 'run_tempo':
      return [warmup, { label: 'Hauptteil', detail: `20 Min am Stück ${zoneText(zones, 3)}` }, cooldown];
    case 'run_long':
      return isDeload
        ? [{ label: 'Dauerlauf', detail: `60 Min ${zoneText(zones, 2)}` }]
        : [
            { label: 'Dauerlauf', detail: `90 Min ${zoneText(zones, 2)}` },
            { label: 'Schluss', detail: 'Letzte 10 Min etwas zügiger, wenn es sich gut anfühlt' },
          ];
    case 'run_easy':
      return [
        { label: 'Dauerlauf', detail: `${isDeload ? 30 : 45} Min ${zoneText(zones, 2)}` },
      ];
    case 'run_recovery':
      return [
        {
          label: 'Regenerationslauf',
          detail: `${isDeload ? 20 : 30} Min ${zoneText(zones, 1)}, bewusst langsam`,
        },
      ];
    case 'strength_lower':
      return isDeload
        ? [
            { label: 'Kniebeuge', detail: '3× 5 bei 60 % — Technik, kein Maximalversuch' },
            { label: 'Rumänisches Kreuzheben', detail: '3× 8 locker' },
            { label: 'Rumpf', detail: '3 Sätze' },
          ]
        : [
            { label: 'Kniebeuge', detail: '4× 5 schwer' },
            { label: 'Kreuzheben', detail: '3× 5' },
            { label: 'Ausfallschritte', detail: '3× 10 je Bein' },
            { label: 'Wadenheben & Rumpf', detail: 'je 3 Sätze' },
          ];
    case 'strength_upper':
      return isDeload
        ? [
            { label: 'Bankdrücken', detail: '3× 6 bei 60 %' },
            { label: 'Rudern', detail: '3× 10 locker' },
          ]
        : [
            { label: 'Bankdrücken', detail: '4× 6 schwer' },
            { label: 'Klimmzüge', detail: '4 Sätze bis 2 Wiederholungen vor dem Limit' },
            { label: 'Schulterdrücken', detail: '3× 8' },
            { label: 'Rudern', detail: '3× 10' },
          ];
    case 'strength_full':
      return [
        { label: 'Kniebeuge', detail: '3× 6' },
        { label: 'Bankdrücken', detail: '3× 6' },
        { label: 'Rudern', detail: '3× 10' },
      ];
    case 'strength_short':
      return [
        { label: 'Grundübung', detail: '3× 8 mittelschwer — was heute noch geht' },
        { label: 'Zug- oder Druckübung', detail: '3× 10' },
        { label: 'Rumpf', detail: '2 Sätze' },
      ];
    case 'mobility':
      return [
        {
          label: 'Mobility',
          detail: `${isDeload ? 20 : '20–25'} Min Hüfte, Brustwirbelsäule, Sprunggelenk`,
        },
      ];
  }
}

function sessionTitle(type: SessionTypeKey, isDeload: boolean): string {
  const base = SESSION_TYPES[type].label;
  return isDeload ? `${base} (Deload)` : base;
}

/* ------------------------------------------------------------------ */
/* Bedarf pro Zyklus                                                   */
/* ------------------------------------------------------------------ */

/**
 * Übertrag zwischen den Zyklen.
 *
 * Die Wochenziele sind auf 7 Tage bezogen, ein Zyklus dauert aber 5. Ohne
 * Übertrag würde jedes Mal abgerundet und das Volumen dauerhaft zu niedrig
 * ausfallen. Mit Übertrag kommen mal 2, mal 3 Krafteinheiten in den Zyklus —
 * im Schnitt genau die gewünschten 3 pro Woche.
 */
export interface PlanState {
  carry: { strength: number; run: number; optional: number };
  /** Welche harte Laufeinheit als Nächstes dran ist. */
  nextRunKey: 'run_intervals' | 'run_long';
  /** Welcher Kraft-Split als Nächstes dran ist. */
  nextSplit: 'strength_lower' | 'strength_upper';
}

export function initialPlanState(): PlanState {
  return {
    // Ein halber Übertrag zum Start lässt den ersten — meist angebrochenen —
    // Zyklus zur nächsten ganzen Zahl runden statt abzuschneiden. Über die
    // folgenden Zyklen gleicht sich das von selbst wieder aus.
    carry: { strength: 0.5, run: 0.5, optional: 0.5 },
    nextRunKey: 'run_intervals',
    nextSplit: 'strength_lower',
  };
}

function takeDemand(carry: number, weeklyTarget: number, lengthDays: number): [number, number] {
  const raw = carry + (weeklyTarget * lengthDays) / 7;
  const count = Math.floor(raw + 1e-9);
  return [count, raw - count];
}

/** Ein einzuplanender Wunsch mit Ausweichtyp, falls kein passender Tag frei ist. */
interface Candidate {
  primary: SessionTypeKey;
  fallbacks: SessionTypeKey[];
  /** Kleiner ist wichtiger. */
  priority: number;
}

function buildCandidates(
  state: PlanState,
  targets: WeeklyTargets,
  lengthDays: number,
  profile: PlanningProfile,
  isDeload: boolean,
  allowStrengthOnLightDays: boolean,
  cycleIndex: number,
): { candidates: Candidate[]; state: PlanState } {
  const [runCount, runCarry] = takeDemand(state.carry.run, targets.run, lengthDays);
  const [strengthCount, strengthCarry] = takeDemand(state.carry.strength, targets.strength, lengthDays);
  const [optionalCount, optionalCarry] = takeDemand(state.carry.optional, targets.optional, lengthDays);

  let nextRunKey = state.nextRunKey;
  let nextSplit = state.nextSplit;

  // Im Deload gibt es keine harten Einheiten — nur Volumen auf niedriger Intensität.
  const runs: Candidate[] = [];
  for (let i = 0; i < runCount; i++) {
    if (isDeload || i > 0) {
      runs.push({ primary: 'run_easy', fallbacks: ['run_recovery'], priority: 0 });
    } else {
      runs.push({ primary: nextRunKey, fallbacks: ['run_easy', 'run_recovery'], priority: 0 });
      nextRunKey = nextRunKey === 'run_intervals' ? 'run_long' : 'run_intervals';
    }
  }

  const strengthFallbacks = allowStrengthOnLightDays ? ['strength_short' as SessionTypeKey] : [];
  const strength: Candidate[] = [];
  for (let i = 0; i < strengthCount; i++) {
    if (isDeload) {
      strength.push({ primary: 'strength_full', fallbacks: strengthFallbacks, priority: 0 });
    } else {
      strength.push({
        primary: nextSplit,
        fallbacks: [
          // Unterkörper braucht einen vollen Tag; ist keiner frei, wird es Oberkörper.
          ...(nextSplit === 'strength_lower' ? (['strength_upper'] as SessionTypeKey[]) : []),
          'strength_full' as SessionTypeKey,
          ...strengthFallbacks,
        ],
        priority: 0,
      });
      nextSplit = nextSplit === 'strength_lower' ? 'strength_upper' : 'strength_lower';
    }
  }

  const optional: Candidate[] = [];
  for (let i = 0; i < optionalCount; i++) {
    optional.push({ primary: 'run_recovery', fallbacks: ['mobility'], priority: 2 });
  }

  // Das Profil entscheidet, wer die knappen vollen Tage zuerst bekommt.
  const runFirst =
    profile === 'runFirst' || (profile === 'balanced' && cycleIndex % 2 === 0);
  runs.forEach((c) => (c.priority = runFirst ? 0 : 1));
  strength.forEach((c) => (c.priority = runFirst ? 1 : 0));

  // Sortierung: erst der Anspruch an den Tag, dann das Profil.
  //
  // Ohne den ersten Schlüssel könnte ein lockerer Lauf den einzigen Schlaftag
  // belegen, bevor die Krafteinheit überhaupt geprüft wird — die knappen guten
  // Tage müssen zuerst an das gehen, was sie wirklich braucht.
  const candidates = [...runs, ...strength, ...optional].sort((a, b) => {
    const demand =
      CAPACITY_RANK[SESSION_TYPES[b.primary].minCapacity] -
      CAPACITY_RANK[SESSION_TYPES[a.primary].minCapacity];
    if (demand !== 0) return demand;
    return a.priority - b.priority;
  });

  return {
    candidates,
    state: {
      carry: { run: runCarry, strength: strengthCarry, optional: optionalCarry },
      nextRunKey,
      nextSplit,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Platzierung                                                         */
/* ------------------------------------------------------------------ */

/** Ein Tag kann eine Einheit tragen — an einem Doppeltag ausnahmsweise zwei. */
interface DaySlot {
  day: ResolvedShiftDay;
  assigned: SessionTypeKey[];
  /**
   * Nur Kontext, nicht belegbar. Der letzte Tag des vorherigen Zyklus wird so
   * mitgeführt, damit die Regeln über die Zyklusgrenze hinweg greifen — sonst
   * könnte direkt nach einem harten Tag am Zyklusende der nächste folgen.
   */
  readonly frozen: boolean;
}

function isHard(type: SessionTypeKey): boolean {
  return SESSION_TYPES[type].countsAsHardDay;
}

function dayIsHard(slot: DaySlot | undefined): boolean {
  return slot !== undefined && slot.assigned.some(isHard);
}

/** Würde dieser Typ an dieser Stelle einen zu langen harten Block erzeugen? */
function hardBlockOk(slots: DaySlot[], index: number, type: SessionTypeKey): boolean {
  if (!isHard(type)) return true;

  let run = 1;
  for (let i = index - 1; i >= 0 && dayIsHard(slots[i]); i--) run++;
  for (let i = index + 1; i < slots.length && dayIsHard(slots[i]); i++) run++;
  return run <= MAX_CONSECUTIVE_HARD_DAYS;
}

/**
 * Dieselbe Einheit darf nicht an zwei aufeinanderfolgenden Tagen liegen.
 *
 * Die Regel gegen harte Tage in Folge greift hier nicht: zwei schwere
 * Beineinheiten hintereinander sind auch dann falsch, wenn sie formal erlaubt
 * wären, weil dieselbe Muskulatur keine 24 Stunden Erholung bekommt.
 */
function sameTypeAdjacent(slots: DaySlot[], index: number, type: SessionTypeKey): boolean {
  return (
    (index > 0 && slots[index - 1].assigned.includes(type)) ||
    (index < slots.length - 1 && slots[index + 1].assigned.includes(type))
  );
}

/** Erster passender freier Tag für diesen Typ, nach Best-Fit sortiert. */
function findSlot(slots: DaySlot[], type: SessionTypeKey, preferHigher: boolean): number | null {
  const eligible = slots
    .map((slot, index) => ({ slot, index }))
    .filter(
      ({ slot, index }) =>
        !slot.frozen &&
        slot.assigned.length === 0 &&
        capacityAllows(slot.day.capacity, type) &&
        !sameTypeAdjacent(slots, index, type) &&
        hardBlockOk(slots, index, type),
    )
    .sort((a, b) => {
      const ra = CAPACITY_RANK[a.slot.day.capacity];
      const rb = CAPACITY_RANK[b.slot.day.capacity];
      if (ra !== rb) return preferHigher ? rb - ra : ra - rb;
      return a.slot.day.date.localeCompare(b.slot.day.date);
    });

  return eligible.length > 0 ? eligible[0].index : null;
}

/**
 * Sucht einen Doppeltag: ein freier Tag, auf dem bereits genau eine Einheit der
 * **anderen** Disziplin liegt.
 *
 * Ausdrücklich nur als Ausweg gedacht — zwei Einheiten an einem Tag sind die
 * Ausnahme, nicht der Normalfall. Deshalb höchstens einer pro Zyklus, nur an
 * Tagen voller Kapazität und nie zweimal Laufen oder zweimal Kraft.
 */
function findDoubleSlot(slots: DaySlot[], type: SessionTypeKey): number | null {
  const meta = SESSION_TYPES[type];
  if (meta.discipline === 'mobility') return null;

  const candidates = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => {
      if (slot.frozen) return false;
      if (slot.day.capacity !== 'full') return false;
      if (slot.assigned.length !== 1) return false;
      if (!capacityAllows(slot.day.capacity, type)) return false;

      const existing = SESSION_TYPES[slot.assigned[0]];
      // Eine Kraft- und eine Laufeinheit — nie zwei gleiche Disziplinen.
      if (existing.discipline === meta.discipline) return false;
      if (existing.discipline === 'mobility') return false;

      return !sameTypeAdjacent(slots, index, type) && hardBlockOk(slots, index, type);
    })
    .sort((a, b) => a.slot.day.date.localeCompare(b.slot.day.date));

  return candidates.length > 0 ? candidates[0].index : null;
}

export interface PlacementResult {
  slots: DaySlot[];
  /** Wünsche, für die kein Tag gefunden wurde. */
  unplaced: SessionTypeKey[];
  /** Datum des Doppeltags, falls einer gebraucht wurde. */
  doubleDay: IsoDate | null;
}

/** Was tatsächlich platziert wurde — nötig, um später aufwerten zu können. */
interface Assignment {
  candidate: Candidate;
  slotIndex: number;
  type: SessionTypeKey;
}

/**
 * Verteilt die Wünsche auf die Tage des Zyklus.
 *
 * Drei Durchgänge:
 *
 * 1. **Best-Fit** — unter den möglichen Tagen gewinnt der mit der niedrigsten
 *    ausreichenden Kapazität. So bleiben die vollen Tage für das frei, was sie
 *    wirklich braucht.
 * 2. **Aufwerten** — musste ein Wunsch auf einen Ersatztyp ausweichen (etwa
 *    "Kraft kurz" statt "Kraft Unterkörper") und ist danach doch noch ein
 *    besserer Tag frei geblieben, zieht die Session dorthin um und bekommt ihre
 *    volle Form zurück.
 * 3. **Doppeltag** — bleibt danach noch etwas übrig oder steckt in einer
 *    verkürzten Form fest, darf einmal pro Zyklus ein freier Tag zwei Einheiten
 *    tragen: eine Kraft- und eine Laufeinheit.
 */
export function placeCandidates(
  days: ResolvedShiftDay[],
  candidates: Candidate[],
  allowDoubleDay: boolean,
  /** Vortag mit dem, was dort liegt — nur als Kontext für die Nachbarregeln. */
  previousDay?: { day: ResolvedShiftDay; assigned: SessionTypeKey[] },
): PlacementResult {
  const slots: DaySlot[] = [
    ...(previousDay
      ? [{ day: previousDay.day, assigned: previousDay.assigned, frozen: true }]
      : []),
    ...days.map((day) => ({ day, assigned: [] as SessionTypeKey[], frozen: false })),
  ];
  const unplaced: SessionTypeKey[] = [];
  const assignments: Assignment[] = [];

  // Durchgang 1: Best-Fit in Prioritätsreihenfolge.
  for (const candidate of candidates) {
    const options = [candidate.primary, ...candidate.fallbacks];
    let placed = false;

    for (const type of options) {
      const index = findSlot(slots, type, false);
      if (index !== null) {
        slots[index].assigned.push(type);
        assignments.push({ candidate, slotIndex: index, type });
        placed = true;
        break;
      }
    }

    if (!placed) unplaced.push(candidate.primary);
  }

  // Durchgang 2: Ersatztypen aufwerten, solange bessere Tage frei sind.
  for (const assignment of assignments) {
    const options = [assignment.candidate.primary, ...assignment.candidate.fallbacks];
    const usedRank = options.indexOf(assignment.type);
    if (usedRank <= 0) continue; // Wunschtyp bekommen, nichts aufzuwerten.

    const currentCapacity = CAPACITY_RANK[slots[assignment.slotIndex].day.capacity];

    for (let rank = 0; rank < usedRank; rank++) {
      const better = options[rank];

      // Tag vorübergehend freigeben, damit die Blockprüfung nicht die eigene
      // Session mitzählt.
      const held = slots[assignment.slotIndex].assigned;
      slots[assignment.slotIndex].assigned = held.filter((t) => t !== assignment.type);
      const target = findSlot(slots, better, true);

      if (target !== null && CAPACITY_RANK[slots[target].day.capacity] > currentCapacity) {
        slots[target].assigned.push(better);
        assignment.slotIndex = target;
        assignment.type = better;
        break;
      }

      slots[assignment.slotIndex].assigned = held;
    }
  }

  // Durchgang 3: Doppeltag als letzter Ausweg.
  let doubleDay: IsoDate | null = null;
  if (allowDoubleDay) {
    // Erst das, was gar keinen Platz gefunden hat.
    for (let i = unplaced.length - 1; i >= 0 && doubleDay === null; i--) {
      const index = findDoubleSlot(slots, unplaced[i]);
      if (index !== null) {
        slots[index].assigned.push(unplaced[i]);
        doubleDay = slots[index].day.date;
        unplaced.splice(i, 1);
      }
    }

    // Dann das, was nur in verkürzter Form untergekommen ist.
    for (const assignment of assignments) {
      if (doubleDay !== null) break;
      if (assignment.type === assignment.candidate.primary) continue;

      const index = findDoubleSlot(slots, assignment.candidate.primary);
      if (index === null) continue;

      const from = slots[assignment.slotIndex];
      from.assigned = from.assigned.filter((t) => t !== assignment.type);
      slots[index].assigned.push(assignment.candidate.primary);
      assignment.slotIndex = index;
      assignment.type = assignment.candidate.primary;
      doubleDay = slots[index].day.date;
    }
  }

  return { slots: slots.filter((slot) => !slot.frozen), unplaced, doubleDay };
}

/* ------------------------------------------------------------------ */
/* Plan erzeugen                                                       */
/* ------------------------------------------------------------------ */

export interface GeneratedPlan {
  macrocycle: Macrocycle;
  mesocycles: Mesocycle[];
  microcycles: Microcycle[];
  sessions: Session[];
  /** Wünsche, die in keinem Zyklus untergebracht werden konnten. */
  unplaced: Array<{ cycleStart: IsoDate; type: SessionTypeKey }>;
  /** Tage, an denen ausnahmsweise zwei Einheiten liegen. */
  doubleDays: IsoDate[];
}

export interface PlanInput {
  startDate: IsoDate;
  ctx: ShiftContext;
  settings: Settings;
  /** Wie viele Mesozyklen im Voraus erzeugt werden. */
  mesocycleCount: number;
  name?: string;
}

/**
 * Grenzen des Rotationszyklus, in dem dieses Datum liegt.
 * Ohne aktive Rotation wird ersatzweise mit sieben Tagen gerechnet.
 */
export function cycleBoundsFor(date: IsoDate, ctx: ShiftContext): { start: IsoDate; length: number } {
  const pattern = ctx.pattern;
  if (!pattern || pattern.sequence.length === 0) {
    return { start: date, length: 7 };
  }
  const length = pattern.sequence.length;
  const offset = mod(daysBetween(pattern.anchorDate, date), length);
  return { start: addDays(date, -offset), length };
}

export function generateTrainingPlan(input: PlanInput): GeneratedPlan {
  const { startDate, ctx, settings, mesocycleCount } = input;
  const ts = now();

  const { length: cycleLength } = cycleBoundsFor(startDate, ctx);
  const cyclesPerMeso = settings.mesoLoadCycles + settings.mesoDeloadCycles;
  const totalCycles = cyclesPerMeso * mesocycleCount;

  const macrocycle: Macrocycle = {
    id: newId('macro'),
    name: input.name ?? 'Ganzjährig',
    goalKind: 'yearRound',
    startDate,
    endDate: addDays(startDate, totalCycles * cycleLength - 1),
    targetEventName: null,
    targetEventDate: null,
    active: true,
    createdAt: ts,
    updatedAt: ts,
  };

  const mesocycles: Mesocycle[] = [];
  const microcycles: Microcycle[] = [];
  const sessions: Session[] = [];
  const unplaced: GeneratedPlan['unplaced'] = [];
  const doubleDays: IsoDate[] = [];

  let state = initialPlanState();
  // Der erste Zyklus beginnt heute und ist deshalb oft angebrochen.
  let cursor = startDate;
  let globalCycle = 0;

  for (let m = 0; m < mesocycleCount; m++) {
    const mesoStart = cursor;
    const meso: Mesocycle = {
      id: newId('meso'),
      macrocycleId: macrocycle.id,
      index: m + 1,
      name: `Block ${m + 1}`,
      startDate: mesoStart,
      endDate: mesoStart,
      loadCycles: settings.mesoLoadCycles,
      deloadCycles: settings.mesoDeloadCycles,
      focus: 'maintain',
      emphasis: settings.planningProfile === 'runFirst' ? 'run' : 'balanced',
      status: m === 0 ? 'active' : 'planned',
      createdAt: ts,
      updatedAt: ts,
    };

    for (let c = 0; c < cyclesPerMeso; c++) {
      const isDeload = c >= settings.mesoLoadCycles;

      // Der allererste Zyklus beginnt heute und läuft bis zum Ende des laufenden
      // Rotationsdurchlaufs — er ist also fast immer angebrochen.
      //
      // Bleibt davon nur ein kurzer Rest, wird der nächste volle Durchlauf
      // angehängt statt einen Stummel-Zyklus anzulegen. Sonst stünde direkt nach
      // dem Erzeugen ein leerer Zyklus da und ausgerechnet heute wäre nichts
      // geplant, obwohl der Tag frei ist.
      let cycleEnd: IsoDate;
      if (globalCycle === 0) {
        const bounds = cycleBoundsFor(cursor, ctx);
        const restDays = daysBetween(cursor, addDays(bounds.start, bounds.length - 1)) + 1;
        const tooShort = restDays < Math.ceil(cycleLength / 2);
        cycleEnd = addDays(cursor, (tooShort ? restDays + cycleLength : restDays) - 1);
      } else {
        cycleEnd = addDays(cursor, cycleLength - 1);
      }
      const lengthDays = daysBetween(cursor, cycleEnd) + 1;

      const micro: Microcycle = {
        id: newId('micro'),
        mesocycleId: meso.id,
        index: c + 1,
        startDate: cursor,
        endDate: cycleEnd,
        lengthDays,
        isDeload,
        targetSessions: settings.weeklyTargets,
        plannedLoad: 0,
        createdAt: ts,
        updatedAt: ts,
      };

      const days = resolveShiftRange(cursor, cycleEnd, ctx);
      const previousDate = addDays(cursor, -1);
      const previousDay = {
        day: resolveShiftRange(previousDate, previousDate, ctx)[0],
        assigned: sessions.filter((s) => s.date === previousDate).map((s) => s.type),
      };
      const built = buildCandidates(
        state,
        settings.weeklyTargets,
        lengthDays,
        settings.planningProfile,
        isDeload,
        settings.allowStrengthOnLightDays,
        globalCycle,
      );
      state = built.state;

      const placement = placeCandidates(
        days,
        built.candidates,
        settings.allowDoubleDayPerCycle && !isDeload,
        previousDay,
      );
      for (const type of placement.unplaced) {
        unplaced.push({ cycleStart: cursor, type });
      }
      if (placement.doubleDay) doubleDays.push(placement.doubleDay);

      for (const slot of placement.slots) {
        // An einem Doppeltag zuerst die Laufeinheit, dann Kraft: mit frischen
        // Beinen läuft es sich besser, und die Kraft leidet weniger darunter.
        const ordered = [...slot.assigned].sort(
          (a, b) =>
            (SESSION_TYPES[a].discipline === 'run' ? 0 : 1) -
            (SESSION_TYPES[b].discipline === 'run' ? 0 : 1),
        );

        ordered.forEach((type, orderIndex) => {
          const meta = SESSION_TYPES[type];
          const deloadFactor = isDeload ? 0.6 : 1;
          const plan = buildSessionPlan(type, settings.hrZones, isDeload);

          sessions.push({
            id: newId('ses'),
            microcycleId: micro.id,
            date: slot.day.date,
            orderInDay: orderIndex + 1,
            discipline: meta.discipline,
            type,
            title: sessionTitle(type, isDeload),
            plannedDurationMin: plan.durationMin,
            plannedDistanceKm: null,
            zone: meta.defaultZone,
            targetRpe: isDeload ? Math.max(2, meta.defaultRpe - 2) : meta.defaultRpe,
            isKey: meta.isKey && !isDeload,
            load: Math.round(meta.load * deloadFactor * 10) / 10,
            content: plan.content,
            status: 'planned',
            originalDate: null,
            rescheduleReason: null,
            locked: false,
            manuallyEdited: false,
            createdAt: ts,
            updatedAt: ts,
          });

          micro.plannedLoad += Math.round(meta.load * deloadFactor * 10) / 10;
        });
      }

      micro.plannedLoad = Math.round(micro.plannedLoad * 10) / 10;
      microcycles.push(micro);

      cursor = addDays(cycleEnd, 1);
      globalCycle++;
    }

    meso.endDate = addDays(cursor, -1);
    mesocycles.push(meso);
  }

  macrocycle.endDate = addDays(cursor, -1);

  return { macrocycle, mesocycles, microcycles, sessions, unplaced, doubleDays };
}
