/**
 * Das Regelwerk.
 *
 * Hier steht, was an einem Tag erlaubt ist — und sonst nirgends. Der Generator
 * (planner.ts) entscheidet nur noch, *welche* Einheit es wird; *ob* und *wie
 * hart* überhaupt trainiert wird, beantwortet allein dieses File.
 *
 * Die Rangfolge ist fest und wird von oben nach unten abgearbeitet:
 *
 *   1. Schlaf und Erholung
 *   2. Schicht
 *   3. Training
 *
 * Das ist keine Formulierung, sondern die tatsächliche Reihenfolge der Prüfungen
 * unten in `dayAllowance()`: Erst schneidet die Erholung ab, was der Körper nicht
 * hergibt, dann die Schicht, was der Tag nicht hergibt. Was danach übrig ist,
 * darf das Training haben.
 */

import { addDays } from './dates';
import {
  INTENSITY_RANK,
  SESSION_TYPES,
  type Discipline,
  type Intensity,
  type IsoDate,
  type Recovery,
  type ResolvedShiftDay,
  type SessionTypeKey,
  type ShiftKind,
  type SleepDebt,
  type WeeklyTargets,
} from './types';

/* ------------------------------------------------------------------ */
/* 1. Schicht × Erholung                                               */
/* ------------------------------------------------------------------ */

/**
 * Was eine Schicht bei einer bestimmten Erholung hergibt.
 *
 * `cap` ist die höchste erlaubte Intensität, `null` heißt Ruhetag. `optional`
 * markiert Tage, an denen Training möglich, aber nicht nötig ist — dort steht
 * im Plan "oder frei", statt etwas zu erzwingen.
 */
export interface ShiftAllowance {
  cap: Intensity | null;
  /** Welche Disziplinen an diesem Tag überhaupt gehen. */
  disciplines: Discipline[];
  /** Zeitfenster als Klartext, z.B. "15:30–18:00". */
  window: string | null;
  /** Training möglich, aber ausdrücklich freiwillig. */
  optional: boolean;
  /** Ein Satz, warum der Tag so aussieht. */
  reason: string;
}

const ALL: Discipline[] = ['run', 'strength', 'mobility'];
const RUN_ONLY: Discipline[] = ['run', 'mobility'];
const REST_ONLY: Discipline[] = ['mobility'];

/**
 * Die Kernmatrix: fünf Schichtarten × drei Erholungsstufen.
 *
 * Direkt aus den Regeln übernommen und bewusst als Tabelle geschrieben statt
 * als verschachtelte Bedingungen — so ist auf einen Blick prüfbar, ob sie
 * stimmt, und eine Änderung an einer Zelle ändert nichts an den anderen.
 */
const SHIFT_MATRIX: Record<ShiftKind, Record<Recovery, ShiftAllowance>> = {
  /* Tagschicht 07:00–19:00 — 12 Stunden. Danach ist nichts mehr drin. */
  day: {
    high: {
      cap: null,
      disciplines: REST_ONLY,
      window: null,
      optional: true,
      reason: 'Tagschicht: kein Training. Schlaf, Regeneration, höchstens leichte Bewegung.',
    },
    mid: {
      cap: null,
      disciplines: REST_ONLY,
      window: null,
      optional: true,
      reason: 'Tagschicht: kein Training. Schlaf, Regeneration, höchstens leichte Bewegung.',
    },
    low: {
      cap: null,
      disciplines: REST_ONLY,
      window: null,
      optional: true,
      reason: 'Tagschicht bei niedriger Erholung: Ruhetag, nichts weiter.',
    },
  },

  /* Nachtschicht 19:00–07:00 — Fenster davor, danach nichts mehr. */
  night: {
    high: {
      cap: 'hard',
      disciplines: ALL,
      window: '15:30–18:00',
      optional: false,
      reason: 'Nachtschicht bei hoher Erholung: hart oder mittel möglich, im Fenster vor der Schicht.',
    },
    mid: {
      cap: 'medium',
      disciplines: ALL,
      window: '15:30–18:00',
      optional: false,
      reason: 'Nachtschicht bei mittlerer Erholung: mittel oder locker, nichts Hartes.',
    },
    low: {
      cap: 'easy',
      disciplines: ALL,
      window: '15:30–18:00',
      optional: true,
      reason: 'Nachtschicht bei niedriger Erholung: höchstens locker — oder ganz frei.',
    },
  },

  /* Schlaftag: Hauptschlaf 08:00–14:00, in erster Linie Regenerationstag. */
  sleep: {
    high: {
      cap: 'medium',
      disciplines: ALL,
      window: '16:00–19:30',
      optional: false,
      reason: 'Schlaftag bei hoher Erholung: mittel geht — längerer lockerer Lauf oder solide Kraft.',
    },
    mid: {
      cap: 'easy',
      disciplines: ALL,
      window: '16:00–19:30',
      optional: false,
      reason: 'Schlaftag bei mittlerer Erholung: eher locker. Der Tag dient vor allem dem Nachschlaf.',
    },
    low: {
      cap: null,
      disciplines: REST_ONLY,
      window: null,
      optional: true,
      reason: 'Schlaftag bei niedriger Erholung: Ruhetag. Höchstens spazieren gehen.',
    },
  },

  /* Freischicht: der Tag für die Key-Sessions. */
  free: {
    high: {
      cap: 'hard',
      disciplines: ALL,
      window: 'ganzer Tag',
      optional: false,
      reason: 'Freischicht bei hoher Erholung: der Tag für die harte Einheit — Lauf oder Kraft.',
    },
    mid: {
      cap: 'medium',
      disciplines: ALL,
      window: 'ganzer Tag',
      optional: false,
      reason: 'Freischicht bei mittlerer Erholung: mittlere Einheit statt harter.',
    },
    low: {
      cap: 'easy',
      disciplines: ALL,
      window: 'ganzer Tag',
      optional: true,
      reason: 'Freischicht bei niedriger Erholung: locker oder frei — der freie Tag ist kein Grund, hart zu trainieren.',
    },
  },

  /* V-Schicht 08:00–20:00 — Laufen geht, ins Gym kommt man nicht. */
  variable: {
    high: {
      cap: 'medium',
      disciplines: RUN_ONLY,
      window: '06:30–07:30 oder abends',
      optional: false,
      reason: 'V-Schicht bei hoher Erholung: lockerer bis mittlerer Lauf, 30–45 Min. Nur Laufen, kein Krafttraining.',
    },
    mid: {
      cap: 'easy',
      disciplines: RUN_ONLY,
      window: '06:30–07:30',
      optional: true,
      reason: 'V-Schicht bei mittlerer Erholung: sehr kurzer lockerer Lauf — oder frei.',
    },
    low: {
      cap: null,
      disciplines: REST_ONLY,
      window: null,
      optional: true,
      reason: 'V-Schicht bei niedriger Erholung: nicht laufen. Höchstens spazieren gehen.',
    },
  },

  /* Krank, und alles andere ohne Kapazität. */
  off: {
    high: { cap: null, disciplines: [], window: null, optional: false, reason: 'Kein Trainingstag.' },
    mid: { cap: null, disciplines: [], window: null, optional: false, reason: 'Kein Trainingstag.' },
    low: { cap: null, disciplines: [], window: null, optional: false, reason: 'Kein Trainingstag.' },
  },
};

/** Was diese Schichtart bei dieser Erholung grundsätzlich hergibt. */
export function shiftAllowance(kind: ShiftKind, recovery: Recovery): ShiftAllowance {
  return SHIFT_MATRIX[kind][recovery];
}

/** Die Schichtart eines Tages, mit Rückfall auf die Kapazität. */
export function shiftKindOf(day: ResolvedShiftDay): ShiftKind {
  const kind = day.shiftType.kind;
  if (kind) return kind;
  // Schichtarten aus einer Installation von vor dieser Marke: aus der Kapazität
  // ableiten. Grob, aber besser als sie als Ruhetag zu behandeln.
  if (day.shiftType.capacity === 'none') return 'off';
  if (day.shiftType.capacity === 'full') return 'free';
  if (day.shiftType.capacity === 'light') return 'variable';
  return 'sleep';
}

/* ------------------------------------------------------------------ */
/* 2. Globale Regeln                                                   */
/* ------------------------------------------------------------------ */

/** Alles, was der Generator über einen Tag wissen muss. */
export interface DayContext {
  date: IsoDate;
  shift: ResolvedShiftDay;
  recovery: Recovery;
  sleepHours: number | null;
  sleepDebt: SleepDebt;
  /** Harte Einheiten in den letzten sieben Tagen, diesen Tag nicht mitgezählt. */
  hardLast7: number;
  /** Wie viele harte Tage unmittelbar vor diesem Tag liegen. */
  hardStreakBefore: number;
  /** Harte Einheiten, die in dieser Kalenderwoche schon stehen. */
  hardThisWeek: number;
  /** Deload-Woche: Volumen und Intensität bewusst herunter. */
  isDeloadWeek: boolean;
}

/** Was an einem Tag herauskommt, nachdem alle Regeln angewandt wurden. */
export interface DayAllowance {
  /** Höchste erlaubte Intensität, null heißt Ruhetag. */
  cap: Intensity | null;
  disciplines: Discipline[];
  window: string | null;
  optional: boolean;
  /** Die Begründung der Schicht-Erholungs-Matrix. */
  reason: string;
  /**
   * Zusätzliche Regeln, die an diesem Tag gegriffen haben — jede in einem
   * Satz. Steht im Plan unter der Einheit, damit nachvollziehbar ist, warum
   * ausgerechnet heute nichts Hartes geplant ist.
   */
  limits: string[];
}

function down(cap: Intensity | null, to: Intensity): Intensity | null {
  if (cap === null) return null;
  return INTENSITY_RANK[cap] > INTENSITY_RANK[to] ? to : cap;
}

/**
 * Die vollständige Entscheidung für einen Tag.
 *
 * Reihenfolge ist die Rangfolge: Schicht setzt die Obergrenze, dann schneiden
 * Erholung, Schlafschuld und die Wochenregeln nach unten. Nach oben korrigiert
 * hier nichts — keine Regel kann einen Tag härter machen, als die Schicht ihn
 * zulässt.
 */
export function dayAllowance(ctx: DayContext, targets: WeeklyTargets, maxStreak: number): DayAllowance {
  const kind = shiftKindOf(ctx.shift);
  const base = SHIFT_MATRIX[kind][ctx.recovery];

  // Abwesenheit schlägt alles: an einem Krankheitstag wird nichts geplant.
  if (ctx.shift.shiftType.cancelsPlanned) {
    return {
      cap: null,
      disciplines: [],
      window: null,
      optional: false,
      reason: `${ctx.shift.shiftType.name}: kein Training.`,
      limits: [],
    };
  }

  let cap = base.cap;
  let optional = base.optional;
  const limits: string[] = [];

  // Regel 3: keine harte Einheit bei großer Schlafschuld.
  if (ctx.sleepDebt === 'high' && cap !== null && INTENSITY_RANK[cap] > INTENSITY_RANK.easy) {
    cap = down(cap, 'easy');
    limits.push('Große Schlafschuld: nur locker oder frei — Schlaf steht über dem Training.');
  } else if (ctx.sleepDebt === 'some' && cap === 'hard') {
    cap = 'medium';
    limits.push('Etwas Schlafschuld: heute nichts Hartes.');
  }

  // Kurze Nacht wirkt wie Schlafschuld, auch wenn die Erholung noch gut aussieht.
  if (ctx.sleepHours !== null && ctx.sleepHours < 5 && cap !== null && INTENSITY_RANK[cap] > INTENSITY_RANK.easy) {
    cap = down(cap, 'easy');
    optional = true;
    limits.push(`Nur ${fmtHours(ctx.sleepHours)} Schlaf: höchstens locker.`);
  } else if (ctx.sleepHours !== null && ctx.sleepHours < 6.5 && cap === 'hard') {
    cap = 'medium';
    limits.push(`${fmtHours(ctx.sleepHours)} Schlaf: für eine harte Einheit zu wenig.`);
  }

  // Regel 2a: höchstens drei harte Einheiten pro Woche.
  if (cap === 'hard' && ctx.hardThisWeek >= targets.maxHardPerWeek) {
    cap = 'medium';
    limits.push(
      `Schon ${ctx.hardThisWeek} harte Einheiten diese Woche — mehr als ${targets.maxHardPerWeek} werden nicht geplant.`,
    );
  }
  // Dasselbe rollierend über sieben Tage: sonst ließe sich die Grenze am
  // Wochenwechsel umgehen und man käme auf sechs harte Tage in acht.
  if (cap === 'hard' && ctx.hardLast7 >= targets.maxHardPerWeek) {
    cap = 'medium';
    limits.push(`${ctx.hardLast7} harte Einheiten in den letzten 7 Tagen — das reicht.`);
  }

  // Regel 2b: nie mehr als zwei harte Tage hintereinander.
  if (cap === 'hard' && ctx.hardStreakBefore >= maxStreak) {
    cap = 'medium';
    limits.push(`${ctx.hardStreakBefore} harte Tage in Folge — der nächste wird leichter.`);
  }

  // Deload: die ganze Woche eine Stufe tiefer, nichts Hartes.
  if (ctx.isDeloadWeek && cap === 'hard') {
    cap = 'medium';
    limits.push('Deload-Woche: Volumen und Intensität bewusst herunter.');
  }

  return { cap, disciplines: base.disciplines, window: base.window, optional, reason: base.reason, limits };
}

function fmtHours(h: number): string {
  return `${h.toString().replace('.', ',')} h`;
}

/* ------------------------------------------------------------------ */
/* 3. Auswahl der Einheit                                              */
/* ------------------------------------------------------------------ */

/** Was in dieser Woche schon steht. Der Generator führt das Tag für Tag mit. */
export interface WeekLedger {
  hardRun: number;
  hardStrength: number;
  mediumStrength: number;
  easyRun: number;
  /** Alle Einheiten der Woche mit Datum — für die Abstandsregeln. */
  placed: Array<{ date: IsoDate; type: SessionTypeKey }>;
}

export function emptyLedger(): WeekLedger {
  return { hardRun: 0, hardStrength: 0, mediumStrength: 0, easyRun: 0, placed: [] };
}

export function addToLedger(ledger: WeekLedger, date: IsoDate, type: SessionTypeKey): WeekLedger {
  const meta = SESSION_TYPES[type];
  return {
    hardRun: ledger.hardRun + (meta.discipline === 'run' && meta.intensity === 'hard' ? 1 : 0),
    hardStrength: ledger.hardStrength + (meta.discipline === 'strength' && meta.intensity === 'hard' ? 1 : 0),
    mediumStrength:
      ledger.mediumStrength + (meta.discipline === 'strength' && meta.intensity === 'medium' ? 1 : 0),
    easyRun: ledger.easyRun + (meta.discipline === 'run' && meta.intensity === 'easy' ? 1 : 0),
    placed: [...ledger.placed, { date, type }],
  };
}

/**
 * Wie dringend eine Einheit dieser Art diese Woche noch fehlt.
 *
 * Der Generator läuft die Tage von vorn nach hinten durch und nimmt an jedem
 * Tag das, was am meisten fehlt. So verteilt sich das Wochenziel von selbst auf
 * die Tage, die es tragen können, ohne dass irgendwo eine feste Wochenstruktur
 * stünde — die gäbe es bei dieser Rotation ohnehin nicht.
 */
function need(ledger: WeekLedger, targets: WeeklyTargets, slot: 'hardRun' | 'hardStrength' | 'mediumStrength' | 'easyRun'): number {
  switch (slot) {
    case 'hardRun':
      return targets.run - ledger.hardRun;
    case 'hardStrength':
      return targets.strengthHard - ledger.hardStrength;
    case 'mediumStrength':
      return targets.strength - targets.strengthHard - ledger.mediumStrength;
    case 'easyRun':
      return targets.optional - ledger.easyRun;
  }
}

/**
 * Wie viele Tage seit der letzten Einheit derselben Disziplin vergangen sind.
 * `null`, wenn diese Woche noch keine lag.
 */
function daysSince(ledger: WeekLedger, date: IsoDate, discipline: Discipline): number | null {
  const own = ledger.placed.filter((p) => SESSION_TYPES[p.type].discipline === discipline);
  if (own.length === 0) return null;
  const last = own[own.length - 1].date;
  let days = 0;
  let cursor = last;
  while (cursor < date) {
    cursor = addDays(cursor, 1);
    days++;
  }
  return days;
}

export interface Choice {
  type: SessionTypeKey;
  /** Warum gerade diese Einheit — ergänzt die Begründung des Tages. */
  why: string;
}

/**
 * Wählt die Einheit für einen Tag.
 *
 * Erst wird nach Bedarf entschieden, welchen Platz im Wochenziel dieser Tag
 * füllt, dann welche konkrete Art das ist. Die Auswahl innerhalb einer Art
 * rotiert (Intervalle → Long Run → Schwelle → Tempo), damit nicht wochenlang
 * dieselbe harte Einheit läuft.
 */
export function chooseSession(
  allowance: DayAllowance,
  ledger: WeekLedger,
  targets: WeeklyTargets,
  ctx: DayContext,
  /**
   * Zeiger in die Rotation der harten Läufe. Kommt aus der Kalenderwoche, nicht
   * aus einem laufenden Zähler — dieselbe Woche bekommt bei jeder Neuplanung
   * dieselbe Einheit.
   */
  hardRunRotation: number,
): Choice | null {
  if (allowance.cap === null) return null;

  const canRun = allowance.disciplines.includes('run');
  const canLift = allowance.disciplines.includes('strength');
  const cap = INTENSITY_RANK[allowance.cap];

  // --- harter Tag -------------------------------------------------------
  if (cap >= INTENSITY_RANK.hard) {
    const runNeed = need(ledger, targets, 'hardRun');
    const liftNeed = need(ledger, targets, 'hardStrength');

    // Nicht zweimal dieselbe Disziplin hart hintereinander: wer gestern schwer
    // Beine hatte, läuft heute keine Intervalle.
    const runRecent = (daysSince(ledger, ctx.date, 'run') ?? 9) < 2;
    const liftRecent = (daysSince(ledger, ctx.date, 'strength') ?? 9) < 2;

    if (canRun && runNeed > 0 && (!runRecent || liftNeed <= 0)) {
      const type = HARD_RUN_ROTATION[hardRunRotation % HARD_RUN_ROTATION.length];
      return { type, why: `Harte Ausdauereinheit ${ledger.hardRun + 1} von ${targets.run} dieser Woche.` };
    }
    if (canLift && liftNeed > 0 && !liftRecent) {
      return { type: 'strength_heavy', why: 'Der schwere Krafttag der Woche.' };
    }
    if (canRun && runNeed > 0) {
      const type = HARD_RUN_ROTATION[hardRunRotation % HARD_RUN_ROTATION.length];
      return { type, why: `Harte Ausdauereinheit ${ledger.hardRun + 1} von ${targets.run} dieser Woche.` };
    }
    // Harter Tag, aber das harte Kontingent ist voll: eine Stufe tiefer.
  }

  // --- mittlerer Tag ----------------------------------------------------
  if (cap >= INTENSITY_RANK.medium) {
    const liftNeed = need(ledger, targets, 'mediumStrength') + Math.max(0, need(ledger, targets, 'hardStrength'));
    const liftRecent = (daysSince(ledger, ctx.date, 'strength') ?? 9) < 2;
    const runRecent = (daysSince(ledger, ctx.date, 'run') ?? 9) < 1;

    if (canLift && liftNeed > 0 && !liftRecent) {
      return {
        type: 'strength_hypertrophy',
        why: 'Die mittlere Krafteinheit der Woche — Volumen statt Maximalgewicht.',
      };
    }
    if (canRun && !runRecent) {
      // Der lange Lauf kommt nur, wenn er als harte Einheit nicht möglich war
      // und die Woche noch keinen hat.
      const hasLong = ledger.placed.some((p) => p.type === 'run_long' || p.type === 'run_long_easy');
      if (!hasLong && need(ledger, targets, 'hardRun') > 0) {
        return { type: 'run_long_easy', why: 'Langer Lauf, aber komplett ruhig — der harte Reiz fällt heute aus.' };
      }
      return { type: 'run_steady', why: 'Zügiger Dauerlauf im mittleren Bereich.' };
    }
    if (canLift && !liftRecent) {
      return { type: 'strength_upper', why: 'Oberkörper — schont die Beine für den nächsten Lauftag.' };
    }
  }

  // --- lockerer Tag -----------------------------------------------------
  const easyRunNeed = need(ledger, targets, 'easyRun');
  const runYesterday = (daysSince(ledger, ctx.date, 'run') ?? 9) < 1;

  if (canRun && easyRunNeed > 0 && !runYesterday) {
    return {
      type: ctx.hardStreakBefore > 0 ? 'run_recovery' : 'run_easy',
      why:
        ctx.hardStreakBefore > 0
          ? 'Nach einem harten Tag: bewusst langsam, nur um in Bewegung zu bleiben.'
          : `Lockerer Lauf ${ledger.easyRun + 1} von ${targets.optional} dieser Woche.`,
    };
  }
  if (canLift && need(ledger, targets, 'mediumStrength') > 0) {
    return { type: 'strength_short', why: 'Kurze Krafteinheit — hält die Gewohnheit, ohne den Tag zu belasten.' };
  }

  // Sind die Wochenziele erfüllt, bleibt der Tag frei. Nur direkt nach einem
  // harten Tag steht noch Mobility — das ist aktive Erholung und beschleunigt
  // sie, alles andere wäre bloß Beschäftigung.
  //
  // Ohne diese Grenze bekäme jeder Tag, an dem irgendetwas erlaubt ist, auch
  // irgendetwas zugewiesen. Der Plan wäre voll und die Regel "Erholung steht
  // über dem Training" stünde nur im Text.
  if (ctx.hardStreakBefore > 0 && allowance.disciplines.includes('mobility')) {
    return { type: 'mobility', why: 'Nach einem harten Tag: Mobility als aktive Erholung.' };
  }
  return null;
}

/**
 * Die harten Läufe im Wechsel.
 *
 * Vier Arten, damit über einen Monat jede zweimal drankommt: Intervalle für
 * die Spritzigkeit, Schwelle und Tempo für die Dauerleistung, der lange Lauf
 * mit forciertem Ende für die Grundlage.
 */
const HARD_RUN_ROTATION: SessionTypeKey[] = ['run_intervals', 'run_long', 'run_threshold', 'run_tempo'];

/**
 * Was an einem Tag ohne geplante Einheit trotzdem sinnvoll ist.
 *
 * Kein Trainingsvorschlag, sondern der Hinweis, dass Ruhe die Absicht ist —
 * ohne ihn sieht ein leerer Tag im Plan wie ein Fehler aus.
 */
export function restAdvice(ctx: DayContext, allowance: DayAllowance): string {
  if (ctx.shift.shiftType.cancelsPlanned) return 'Erholen. Kein Training, auch kein leichtes.';
  const kind = shiftKindOf(ctx.shift);
  if (kind === 'day') return 'Schlaf nachholen, essen, spätestens nach der Schicht runterkommen. Ein Spaziergang reicht.';
  if (kind === 'sleep') return 'Regenerationstag. Hauptschlaf 08:00–14:00, danach höchstens spazieren gehen.';
  if (allowance.cap === null) return 'Ruhetag. Bewegung ja, Training nein.';
  return 'Freiwillig — wenn der Tag es nicht hergibt, ist nichts verloren.';
}
