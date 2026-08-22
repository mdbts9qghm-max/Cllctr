/**
 * Progressive Overload.
 *
 * Der Plan startet bei null und steigert sich — aber nicht nach Kalender,
 * sondern nach **Wiederholung**: jede Einheitsart hat eine eigene Stufe, und
 * die zählt, wie oft diese Art schon absolviert wurde. Stufe 0 ist die erste
 * Kniebeuge-Einheit überhaupt, Stufe 7 die achte.
 *
 * Warum nicht pro Zyklus hochzählen: der Long Run kommt nur jeden zweiten
 * Zyklus dran. Eine Steigerung pro Zyklus würde ihn zwischen zwei Läufen um
 * zwei Stufen springen lassen. Pro Vorkommen bleibt der Sprung immer gleich
 * groß — genau das ist der Sinn von progressiver Steigerung.
 *
 * Die Stufe wird verdient, nicht geschenkt: erhöht wird sie nur für Einheiten,
 * die als erledigt protokolliert sind (siehe plan-store.earnedProgression).
 * Ein ausgefallener Zyklus schiebt die Steigerung nach hinten statt sie zu
 * überspringen.
 */

import { SESSION_TYPES, type HrZone, type SessionBlock, type SessionTypeKey } from './types';

/** Stufenstand je Einheitsart. Fehlende Einträge bedeuten Stufe 0. */
export type ProgressionLevels = Partial<Record<SessionTypeKey, number>>;

export interface SessionForm {
  content: SessionBlock[];
  durationMin: number;
  /** Ziel-RPE dieser Stufe. */
  targetRpe: number;
  /** Ein Halbsatz für die Begründung: was sich gegenüber der letzten Stufe ändert. */
  note: string | null;
}

export function levelOf(levels: ProgressionLevels, type: SessionTypeKey): number {
  return Math.max(0, Math.floor(levels[type] ?? 0));
}

function zoneText(zones: HrZone[], zone: number | null): string {
  if (zone === null) return '';
  const z = zones.find((x) => x.zone === zone);
  if (!z || z.maxBpm === 0) return `Zone ${zone}`;
  return `Zone ${zone} · ${z.minBpm}–${z.maxBpm} bpm`;
}

/* ------------------------------------------------------------------ */
/* Laufen: Minuten                                                     */
/* ------------------------------------------------------------------ */

/**
 * Dauerläufe steigern sich in Minuten.
 *
 * `base` ist der Wert auf Stufe 0, `per` der Zuwachs pro Vorkommen, `cap` die
 * Obergrenze. Danach bleibt die Einheit stehen — ein Long Run, der ewig weiter
 * wächst, ist irgendwann kein Training mehr, sondern ein Wettkampf.
 */
const RUN_RAMP: Record<'run_long' | 'run_easy' | 'run_recovery' | 'run_tempo', {
  base: number;
  per: number;
  cap: number;
}> = {
  run_long: { base: 45, per: 6, cap: 120 },
  run_easy: { base: 25, per: 3, cap: 60 },
  run_recovery: { base: 20, per: 2, cap: 35 },
  // Beim Tempolauf zählt nur der Hauptteil; Ein- und Auslaufen kommen dazu.
  run_tempo: { base: 10, per: 2, cap: 30 },
};

function ramp(key: keyof typeof RUN_RAMP, step: number): number {
  const r = RUN_RAMP[key];
  return Math.min(r.cap, r.base + r.per * step);
}

function atCap(key: keyof typeof RUN_RAMP, step: number): boolean {
  return ramp(key, step) === RUN_RAMP[key].cap;
}

/* ------------------------------------------------------------------ */
/* Intervalle: erst Wiederholungen, dann Distanz                       */
/* ------------------------------------------------------------------ */

const INTERVAL_DISTANCES = [400, 600, 800, 1000];
const INTERVAL_REPS = [4, 5, 6];

/**
 * Doppelte Progression über zwei Achsen: innerhalb einer Distanz erst 4, 5, 6
 * Wiederholungen, dann eine Stufe länger und zurück auf 4. Oben angekommen
 * (6× 1000 m) wachsen nur noch die Wiederholungen bis 8.
 */
export function intervalAt(step: number): { reps: number; distanceM: number } {
  const perDistance = INTERVAL_REPS.length;
  const top = INTERVAL_DISTANCES.length * perDistance - 1;
  if (step >= top) {
    const extra = step - top;
    return { reps: Math.min(8, 6 + extra), distanceM: 1000 };
  }
  return {
    reps: INTERVAL_REPS[step % perDistance],
    distanceM: INTERVAL_DISTANCES[Math.floor(step / perDistance)],
  };
}

/** Grobe Dauer eines Intervallhauptteils inklusive Trabpausen. */
function intervalMainMin(reps: number, distanceM: number): number {
  const runMin = reps * (distanceM / 1000) * 4.5;
  const pauseMin = (reps - 1) * 2;
  return runMin + pauseMin;
}

/* ------------------------------------------------------------------ */
/* Kraft: doppelte Progression                                         */
/* ------------------------------------------------------------------ */

interface Lift {
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Sprung, wenn die Wiederholungsspanne oben ausgereizt ist. */
  stepKg: number;
  /** Eigengewichtsübung: gesteigert wird mit Zusatzgewicht. */
  bodyweight?: boolean;
  perLeg?: boolean;
}

const LOWER: Lift[] = [
  { name: 'Kniebeuge', sets: 4, repMin: 5, repMax: 8, stepKg: 5 },
  { name: 'Kreuzheben', sets: 3, repMin: 5, repMax: 8, stepKg: 5 },
  { name: 'Ausfallschritte', sets: 3, repMin: 8, repMax: 12, stepKg: 2.5, perLeg: true },
];

const UPPER: Lift[] = [
  { name: 'Bankdrücken', sets: 4, repMin: 5, repMax: 8, stepKg: 2.5 },
  { name: 'Klimmzüge', sets: 4, repMin: 4, repMax: 8, stepKg: 2.5, bodyweight: true },
  { name: 'Schulterdrücken', sets: 3, repMin: 6, repMax: 10, stepKg: 2.5 },
  { name: 'Rudern', sets: 3, repMin: 8, repMax: 12, stepKg: 2.5 },
];

export interface LiftTarget {
  sets: number;
  reps: number;
  /** 0 = Startgewicht. Jede weitere Stufe ist ein Gewichtssprung. */
  weightLevel: number;
  /** Auf dieser Stufe wird zum ersten Mal mit dem höheren Gewicht gearbeitet. */
  justIncreased: boolean;
}

/**
 * Doppelte Progression: erst die Wiederholungen von repMin bis repMax hoch,
 * dann Gewicht drauf und zurück auf repMin.
 *
 * Die App kennt die Gewichte nicht — sie sagt deshalb nicht "80 kg", sondern
 * *was sich ändert*: eine Wiederholung mehr oder ein Sprung nach oben.
 */
export function liftAt(lift: Lift, step: number): LiftTarget {
  const span = lift.repMax - lift.repMin + 1;
  return {
    sets: lift.sets,
    reps: lift.repMin + (step % span),
    weightLevel: Math.floor(step / span),
    justIncreased: step > 0 && step % span === 0,
  };
}

function kg(n: number): string {
  return `${n.toString().replace('.', ',')} kg`;
}

/**
 * Kurz halten: auf dem Telefon steht das in einer Zeile. Das *Warum* der Stufe
 * steht ohnehin in der Begründung, hier zählt nur, was zu tun ist.
 */
function liftDetail(lift: Lift, step: number): string {
  const t = liftAt(lift, step);
  const scheme = `${t.sets}× ${t.reps}${lift.perLeg ? ' je Bein' : ''}`;

  if (step === 0) {
    return lift.bodyweight
      ? `${scheme} mit Eigengewicht`
      : `${scheme}${lift.perLeg ? ',' : ''} leicht`;
  }
  if (t.justIncreased) {
    return lift.bodyweight
      ? `${scheme} · +${kg(lift.stepKg)} Zusatz`
      : `${scheme} · +${kg(lift.stepKg)}`;
  }
  return `${scheme} · gleiches Gewicht`;
}

/** Die Übung, an der die Steigerung dieser Einheit am deutlichsten hängt. */
function leadLift(type: 'strength_lower' | 'strength_upper'): Lift {
  return type === 'strength_lower' ? LOWER[0] : UPPER[0];
}

/* ------------------------------------------------------------------ */
/* Formen                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ziel-RPE der Stufe.
 *
 * Die ersten beiden Male einer Einheitsart laufen bewusst unter dem Zielwert:
 * Stufe 0 dient dem Kennenlernen des Gewichts bzw. der Strecke, nicht dem
 * Ausreizen. Sonst stünde über einer ausdrücklich leichten Einheit RPE 8.
 */
function rpeFor(type: SessionTypeKey, step: number, isDeload: boolean): number {
  const base = SESSION_TYPES[type].defaultRpe;
  if (isDeload) return Math.max(2, base - 2);
  if (!progresses(type)) return base;
  const easeIn = step === 0 ? 2 : step === 1 ? 1 : 0;
  return Math.max(3, base - easeIn);
}

function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

/**
 * Inhalt und Dauer einer Einheit auf ihrer aktuellen Stufe.
 *
 * Beides entsteht bewusst an einer Stelle: eine separat hochgerechnete Dauer
 * würde sonst dem Text im Inhalt widersprechen ("18 Min" über "30 Min locker").
 *
 * Im Deload wird die erreichte Stufe **nicht** zurückgesetzt, sondern nur
 * abgeschwächt gefahren. Nach dem Deload geht es dort weiter, wo der Block
 * aufgehört hat — sonst wäre die Steigerung ein Kreis.
 */
export function sessionForm(
  type: SessionTypeKey,
  zones: HrZone[],
  step: number,
  isDeload: boolean,
): SessionForm {
  return {
    ...formFor(type, zones, step, isDeload),
    targetRpe: rpeFor(type, Math.max(0, Math.floor(step)), isDeload),
  };
}

function formFor(
  type: SessionTypeKey,
  zones: HrZone[],
  step: number,
  isDeload: boolean,
): Omit<SessionForm, 'targetRpe'> {
  const warmup = { label: 'Einlaufen', detail: `10–15 Min ${zoneText(zones, 1)}` };
  const cooldown = { label: 'Auslaufen', detail: `10 Min ${zoneText(zones, 1)}` };
  const level = Math.max(0, Math.floor(step));

  switch (type) {
    case 'run_intervals': {
      const { reps, distanceM } = intervalAt(level);
      if (isDeload) {
        const easy = Math.max(3, Math.floor(reps / 2));
        return {
          content: [
            warmup,
            { label: 'Hauptteil', detail: `${easy}× ${distanceM} m ${zoneText(zones, 3)}, 2 Min Trabpause` },
            cooldown,
          ],
          durationMin: round5(intervalMainMin(easy, distanceM) + 25),
          note: 'Deload: halbe Anzahl, eine Zone lockerer — die Stufe bleibt erhalten.',
        };
      }
      const previous = level > 0 ? intervalAt(level - 1) : null;
      const note =
        level === 0
          ? 'Erste Intervalleinheit — bewusst kurz. Die Steigerung kommt über die Wiederholungen.'
          : previous && previous.distanceM !== distanceM
            ? `Stufe ${level}: von ${previous.reps}× ${previous.distanceM} m auf ${reps}× ${distanceM} m — längere Intervalle, dafür wieder weniger.`
            : `Stufe ${level}: ${reps}× ${distanceM} m, eine Wiederholung mehr als beim letzten Mal.`;
      return {
        content: [
          warmup,
          { label: 'Hauptteil', detail: `${reps}× ${distanceM} m ${zoneText(zones, 4)}, 2 Min Trabpause` },
          cooldown,
        ],
        durationMin: round5(intervalMainMin(reps, distanceM) + 25),
        note,
      };
    }

    case 'run_tempo': {
      const main = ramp('run_tempo', level);
      if (isDeload) {
        const easy = Math.max(8, Math.round(main * 0.6));
        return {
          content: [warmup, { label: 'Hauptteil', detail: `${easy} Min am Stück ${zoneText(zones, 3)}` }, cooldown],
          durationMin: round5(easy + 25),
          note: 'Deload: kürzerer Tempoblock, gleiche Zone.',
        };
      }
      return {
        content: [warmup, { label: 'Hauptteil', detail: `${main} Min am Stück ${zoneText(zones, 3)}` }, cooldown],
        durationMin: round5(main + 25),
        note:
          level === 0
            ? 'Erster Tempolauf — 10 Minuten am Stück reichen für den Anfang.'
            : atCap('run_tempo', level)
              ? `Stufe ${level}: ${main} Min — die Obergrenze für den Tempoblock ist erreicht, ab hier zählt das Tempo.`
              : `Stufe ${level}: ${main} Min am Stück, 2 Min mehr als beim letzten Mal.`,
      };
    }

    case 'run_long': {
      const mins = ramp('run_long', level);
      if (isDeload) {
        const easy = round5(mins * 0.6);
        return {
          content: [{ label: 'Dauerlauf', detail: `${easy} Min ${zoneText(zones, 2)}` }],
          durationMin: easy,
          note: 'Deload: rund 60 % der aktuellen Länge, sonst unverändert.',
        };
      }
      const content: SessionBlock[] = [
        { label: 'Dauerlauf', detail: `${mins} Min ${zoneText(zones, 2)}` },
      ];
      // Ein zügiger Schluss ist eine zusätzliche Belastung — die kommt erst,
      // wenn die reine Länge steht.
      if (level >= 4) {
        content.push({
          label: 'Schluss',
          detail: 'Letzte 10 Min etwas zügiger, wenn es sich gut anfühlt',
        });
      }
      return {
        content,
        durationMin: mins,
        note:
          level === 0
            ? 'Erster langer Lauf — 45 Minuten locker, egal wie gut es sich anfühlt.'
            : atCap('run_long', level)
              ? `Stufe ${level}: ${mins} Min — die geplante Obergrenze für den langen Lauf.`
              : `Stufe ${level}: ${mins} Min, 6 Min länger als beim letzten Mal.`,
      };
    }

    case 'run_easy': {
      const mins = isDeload ? round5(ramp('run_easy', level) * 0.6) : ramp('run_easy', level);
      return {
        content: [{ label: 'Dauerlauf', detail: `${mins} Min ${zoneText(zones, 2)}` }],
        durationMin: mins,
        note: isDeload
          ? 'Deload: verkürzt, gleiche Zone.'
          : level === 0
            ? 'Erster ruhiger Dauerlauf — 25 Minuten, mehr nicht.'
            : `Stufe ${level}: ${mins} Min, 3 Min mehr als beim letzten Mal.`,
      };
    }

    case 'run_recovery': {
      const mins = isDeload ? 20 : ramp('run_recovery', level);
      return {
        content: [
          {
            label: 'Regenerationslauf',
            detail: `${mins} Min ${zoneText(zones, 1)}, bewusst langsam`,
          },
        ],
        durationMin: mins,
        note: null,
      };
    }

    case 'strength_lower':
    case 'strength_upper': {
      const lifts = type === 'strength_lower' ? LOWER : UPPER;
      const tail =
        type === 'strength_lower'
          ? { label: 'Wadenheben & Rumpf', detail: 'je 3 Sätze' }
          : null;

      if (isDeload) {
        return {
          content: [
            ...lifts.slice(0, 2).map((l) => ({
              label: l.name,
              detail: `3× ${l.repMin} bei ca. 60 % — Technik, kein Maximalversuch`,
            })),
            { label: 'Rumpf', detail: '3 Sätze' },
          ],
          durationMin: 40,
          note: 'Deload: gleiche Übungen, deutlich weniger Gewicht. Die Stufe bleibt stehen.',
        };
      }

      const content = lifts.map((l) => ({ label: l.name, detail: liftDetail(l, level) }));
      if (tail) content.push(tail);
      // Beim ersten Mal fehlt der Bezugspunkt: ohne diesen Hinweis wählt man
      // entweder zu schwer und die Steigerung ist nach zwei Stufen zu Ende,
      // oder zu leicht und die ersten Wochen bringen nichts.
      if (level === 0) {
        content.push({
          label: 'Gewichtswahl',
          detail: `So schwer, dass ${lifts[0].repMax + 2} Wiederholungen klar drin wären — nicht schwerer.`,
        });
      }

      const lead = leadLift(type);
      const t = liftAt(lead, level);
      const note =
        level === 0
          ? 'Erste Einheit dieser Art — bewusst leicht anfangen. Gesteigert wird ab dem nächsten Mal.'
          : t.justIncreased
            ? `Stufe ${level}: Wiederholungsspanne ausgereizt — jetzt mehr Gewicht, zurück auf ${t.reps} Wiederholungen.`
            : `Stufe ${level}: gleiches Gewicht wie beim letzten Mal, ${t.reps} statt ${t.reps - 1} Wiederholungen.`;

      return { content, durationMin: SESSION_TYPES[type].defaultDurationMin, note };
    }

    case 'strength_full': {
      // Ganzkörper läuft im Deload mit; er hat deshalb keine eigene Stufe.
      return {
        content: [
          { label: 'Kniebeuge', detail: '3× 6 bei ca. 60 %' },
          { label: 'Bankdrücken', detail: '3× 6 bei ca. 60 %' },
          { label: 'Rudern', detail: '3× 10 locker' },
        ],
        durationMin: 40,
        note: 'Deload-Ganzkörper: alles einmal bewegen, nichts ausreizen.',
      };
    }

    case 'strength_short': {
      const t = liftAt(LOWER[0], level);
      return {
        content: [
          {
            label: 'Grundübung',
            detail: `3× ${Math.min(8, t.reps + 2)} mittelschwer — was heute noch geht`,
          },
          { label: 'Zug- oder Druckübung', detail: '3× 10' },
          { label: 'Rumpf', detail: '2 Sätze' },
        ],
        durationMin: isDeload ? 25 : SESSION_TYPES.strength_short.defaultDurationMin,
        note: 'Ersatzform: hält die Gewohnheit, zählt aber nicht als Steigerung.',
      };
    }

    case 'mobility':
      return {
        content: [
          {
            label: 'Mobility',
            detail: `${isDeload ? 20 : '20–25'} Min Hüfte, Brustwirbelsäule, Sprunggelenk`,
          },
        ],
        durationMin: isDeload ? 20 : SESSION_TYPES.mobility.defaultDurationMin,
        note: null,
      };
  }
}

/**
 * Arten, die eine echte Stufe führen.
 *
 * Ersatz- und Deloadformen zählen bewusst nicht mit: sie sind eine Notlösung,
 * kein Fortschritt. Sonst würde ein Zyklus voller Kurzformen die Stufe
 * hochtreiben, ohne dass je schwerer trainiert wurde.
 */
export const PROGRESSING_TYPES: SessionTypeKey[] = [
  'run_intervals',
  'run_tempo',
  'run_long',
  'run_easy',
  'strength_lower',
  'strength_upper',
];

export function progresses(type: SessionTypeKey): boolean {
  return PROGRESSING_TYPES.includes(type);
}

/** Kurzfassung des Stands, z. B. für die Planübersicht. */
export function levelSummary(
  type: SessionTypeKey,
  levels: ProgressionLevels,
  zones: HrZone[],
): { label: string; level: number; detail: string } {
  const level = levelOf(levels, type);
  const form = sessionForm(type, zones, level, false);
  const main =
    form.content.find((b) => /Hauptteil|Dauerlauf/i.test(b.label)) ?? form.content[0];
  return {
    label: SESSION_TYPES[type].label,
    level,
    detail: main.detail.replace(/\s*·\s*\d+–\d+\s*bpm/g, ''),
  };
}
