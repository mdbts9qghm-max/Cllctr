/**
 * Periodisierung: welche Phase gerade läuft und was sie bedeutet.
 *
 * Phasen sind Zeiträume mit einem Schwerpunkt, keine Formel. Sie verschieben
 * das Verhältnis von Umfang zu Intensität und sagen dem Generator, wie viele
 * harte Einheiten eine Woche verträgt.
 */

import { addDays, daysBetween, startOfWeek } from './dates';
import {
  PHASE_PROFILE,
  type IsoDate,
  type PhaseKind,
  type Settings,
  type TrainingPhase,
} from './types';

export interface ActivePhase {
  phase: TrainingPhase | null;
  /** Die wievielte Woche der Phase, 1-basiert. Null ohne Phase. */
  week: number | null;
  /** Wie viele Wochen die Phase insgesamt umfasst. */
  totalWeeks: number | null;
  kind: PhaseKind;
  hardPerWeek: number;
  strengthPerWeek: number;
  longSessionShare: number;
  weeklyMinutesTarget: number;
}

/**
 * Die Phase eines Tages.
 *
 * Ohne passende Phase gilt Base: die vorsichtigste Annahme. Wer keine
 * Periodisierung gepflegt hat, soll nicht versehentlich in einem Peak-Block
 * landen.
 */
export function activePhase(
  phases: TrainingPhase[],
  settings: Settings,
  date: IsoDate,
): ActivePhase {
  const phase = phases.find((p) => p.startDate <= date && date <= p.endDate) ?? null;
  const kind: PhaseKind = phase?.kind ?? 'base';
  const profile = PHASE_PROFILE[kind];

  const week = phase
    ? Math.floor(daysBetween(startOfWeek(phase.startDate), startOfWeek(date)) / 7) + 1
    : null;
  const totalWeeks = phase
    ? Math.ceil((daysBetween(phase.startDate, phase.endDate) + 1) / 7)
    : null;

  return {
    phase,
    week,
    totalWeeks,
    kind,
    hardPerWeek: Math.min(profile.hardPerWeek, settings.maxHardPerWeek),
    strengthPerWeek: profile.strengthPerWeek,
    longSessionShare: profile.longSessionShare,
    weeklyMinutesTarget: phase?.weeklyMinutesTarget ?? settings.weeklyMinutesTarget,
  };
}

/** Legt eine Folge von Phasen an — Base, Build, Peak, Taper hintereinander. */
export function buildPhaseSequence(
  start: IsoDate,
  weeks: { base: number; build: number; peak: number; taper: number },
): Array<{ kind: PhaseKind; startDate: IsoDate; endDate: IsoDate }> {
  const order: PhaseKind[] = ['base', 'build', 'peak', 'taper'];
  const out: Array<{ kind: PhaseKind; startDate: IsoDate; endDate: IsoDate }> = [];
  let cursor = startOfWeek(start);

  for (const kind of order) {
    const n = weeks[kind];
    if (n <= 0) continue;
    const end = addDays(cursor, n * 7 - 1);
    out.push({ kind, startDate: cursor, endDate: end });
    cursor = addDays(end, 1);
  }
  return out;
}

/**
 * Rückwärts von einem Zieldatum planen.
 *
 * Wer ein Wettkampfdatum hat, braucht keine Phasen ab heute, sondern Phasen,
 * die **am Ziel enden**. Taper zuletzt, davor Peak, Build, Base — der Rest der
 * Zeit gehört der Grundlage.
 */
export function phasesForTarget(
  from: IsoDate,
  targetDate: IsoDate,
): Array<{ kind: PhaseKind; startDate: IsoDate; endDate: IsoDate }> {
  const totalWeeks = Math.floor(daysBetween(startOfWeek(from), startOfWeek(targetDate)) / 7);
  if (totalWeeks < 4) return [];

  const taper = Math.min(2, Math.max(1, Math.round(totalWeeks * 0.08)));
  const peak = Math.min(4, Math.max(1, Math.round(totalWeeks * 0.15)));
  const build = Math.max(1, Math.round(totalWeeks * 0.35));
  const base = Math.max(1, totalWeeks - taper - peak - build);

  return buildPhaseSequence(from, { base, build, peak, taper });
}
