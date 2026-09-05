/**
 * Die Trainings-Engine — der Kern der App.
 *
 * Sie beantwortet eine Frage: *Was ist heute sinnvoll?* Und zwar begründet, mit
 * Alternativen und mit dem, was heute ausdrücklich **nicht** sinnvoll wäre.
 *
 * Vier Schritte, in dieser Reihenfolge:
 *
 *   1. **Erholung** setzt die Obergrenze — sie steht über allem.
 *   2. **Schicht** setzt Obergrenze, Zeitfenster und mögliche Sportarten.
 *   3. **Belastung** schneidet weiter: harte Tage in Folge, hartes Kontingent
 *      der Woche, zu steile Steigerung.
 *   4. **Bedarf** entscheidet, was es konkret wird: Was fehlt der Woche
 *      gegenüber Phase, Zielverteilung und den langen Einheiten?
 *
 * Was sie ausdrücklich **nicht** tut: jeden Tag mathematisch optimieren. Der
 * Plan soll das Training tragen, nicht ersetzen. Deshalb entscheidet am Ende
 * eine kurze Rangliste von Bedarfen, keine Zielfunktion.
 */

import { addDays, formatDuration, startOfWeek } from './dates';
import { hardContext, inRange, loadBalance, minutesOf, summarize, type HardContext } from './load';
import { activePhase, type ActivePhase } from './phases';
import { allows, dayAllowance, resolveRange, type DayAllowance, type ShiftContext } from './shifts';
import {
  ENDURANCE_SPORTS,
  INTENSITY_RANK,
  SPORT_LABEL,
  type Intensity,
  type IsoDate,
  type Profile,
  type Recovery,
  type ResolvedDay,
  type Settings,
  type Sport,
  type TrainingSession,
} from './types';

/* ------------------------------------------------------------------ */
/* Ergebnis                                                            */
/* ------------------------------------------------------------------ */

export type Verdict = 'recommended' | 'alternative' | 'discouraged';

export interface Suggestion {
  verdict: Verdict;
  sport: Sport;
  intensity: Intensity;
  title: string;
  minutes: number;
  /** Ziel-HF-Zone, null bei Kraft und Mobility. */
  zone: 1 | 2 | 3 | 4 | 5 | null;
  purpose: string;
  /** Warum gerade das — jeder Punkt ein ganzer Satz. */
  reasons: string[];
}

export interface DayPlan {
  date: IsoDate;
  day: ResolvedDay;
  recovery: Recovery;
  allowance: DayAllowance;
  phase: ActivePhase;
  hard: HardContext;
  /** Die Empfehlung. Null heißt: heute ist Ruhetag, und das ist die Antwort. */
  primary: Suggestion | null;
  alternatives: Suggestion[];
  discouraged: Suggestion[];
  /** Der Satz, der über allem steht. */
  headline: string;
  /** Was diese Woche noch fehlt. */
  week: WeekNeeds;
}

export interface WeekNeeds {
  start: IsoDate;
  minutesDone: number;
  minutesTarget: number;
  daysDone: number;
  daysTarget: number;
  hardDone: number;
  hardTarget: number;
  strengthDone: number;
  strengthTarget: number;
  /** Fehlende Minuten je Sportart gegenüber der Zielverteilung. */
  missingBySport: Array<{ sport: Sport; missing: number }>;
  /** Verbleibende Tage der Woche, die überhaupt Training zulassen. */
  daysLeft: number;
  hasLongSession: boolean;
}

export interface EngineInput {
  date: IsoDate;
  shiftContext: ShiftContext;
  sessions: TrainingSession[];
  settings: Settings;
  profile: Profile;
  phases: Parameters<typeof activePhase>[0];
  recovery: Recovery;
}

/* ------------------------------------------------------------------ */
/* Wochenbedarf                                                        */
/* ------------------------------------------------------------------ */

export function weekNeeds(input: EngineInput, phase: ActivePhase): WeekNeeds {
  const { date, sessions, settings, shiftContext } = input;
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const week = inRange(sessions, start, end);
  const done = summarize(week.filter((s) => s.status === 'done'));
  const planned = summarize(week);

  const target = phase.weeklyMinutesTarget;
  const missingBySport: Array<{ sport: Sport; missing: number }> = [];
  for (const [sport, share] of Object.entries(settings.sportMix) as Array<[Sport, number]>) {
    const want = Math.round((target * share) / 100);
    const have = planned.minutesBySport[sport] ?? 0;
    if (want - have > 10) missingBySport.push({ sport, missing: want - have });
  }
  missingBySport.sort((a, b) => b.missing - a.missing);

  // Nur Tage, an denen überhaupt etwas ginge — eine Woche mit drei Tagschichten
  // hat nicht sieben Trainingstage.
  const remaining = resolveRange(date, end, shiftContext).filter(
    (d) => dayAllowance(d, 'ready').cap !== null,
  ).length;

  return {
    start,
    minutesDone: done.minutes,
    minutesTarget: target,
    daysDone: done.activeDays,
    daysTarget: settings.weeklyDaysTarget,
    hardDone: planned.hardSessions,
    hardTarget: phase.hardPerWeek,
    strengthDone: week.filter((s) => s.sport === 'strength').length,
    strengthTarget: phase.strengthPerWeek,
    missingBySport,
    daysLeft: remaining,
    hasLongSession: week.some(
      (s) => ENDURANCE_SPORTS.includes(s.sport) && minutesOf(s) >= 90,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Bausteine                                                           */
/* ------------------------------------------------------------------ */

/**
 * Wie lang eine Einheit werden soll.
 *
 * Drei Grenzen, in dieser Reihenfolge: Was die Phase vorsieht, was die Schicht
 * hergibt — und bei der langen Einheit zusätzlich, was die Beine zuletzt
 * tatsächlich gemacht haben.
 */
function durationFor(
  sport: Sport,
  intensity: Intensity,
  allowance: DayAllowance,
  needs: WeekNeeds,
  phase: ActivePhase,
  isLong: boolean,
  longestRecentMin = 0,
): number {
  if (isLong) {
    const fromPhase = Math.round(needs.minutesTarget * phase.longSessionShare);

    /**
     * Höchstens 15 % über der längsten Einheit der letzten vier Wochen.
     *
     * Ohne diese Bremse schlägt die App am ersten Tag zweieinhalb Stunden vor,
     * weil das Wochenziel es rechnerisch hergibt — und ein Wochenziel ist eine
     * Absicht, kein Beleg dafür, dass die Beine dort schon waren. Ohne
     * Vorgeschichte sind 75 Minuten der Startpunkt.
     */
    const fromHistory = longestRecentMin > 0 ? Math.round(longestRecentMin * 1.15) : 75;
    return clamp(Math.min(fromPhase, fromHistory), 45, Math.min(allowance.maxMinutes, 240));
  }
  const base: Record<Sport, number> = {
    run: intensity === 'hard' ? 55 : intensity === 'moderate' ? 55 : 45,
    bike: intensity === 'hard' ? 70 : 75,
    swim: 45,
    strength: intensity === 'hard' ? 65 : 50,
    mobility: 20,
    recovery: 30,
    hike: 120,
  };
  return clamp(base[sport], 15, allowance.maxMinutes);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function zoneFor(sport: Sport, intensity: Intensity): 1 | 2 | 3 | 4 | 5 | null {
  if (sport === 'strength' || sport === 'mobility') return null;
  if (sport === 'recovery') return 1;
  if (intensity === 'hard') return 4;
  if (intensity === 'moderate') return 3;
  return 2;
}

function titleFor(sport: Sport, intensity: Intensity, isLong: boolean): string {
  if (isLong) {
    return sport === 'run' ? 'Long Run' : sport === 'bike' ? 'Long Ride' : `Lange ${SPORT_LABEL[sport]}-Einheit`;
  }
  if (sport === 'strength') {
    return intensity === 'hard' ? 'Krafttraining schwer' : 'Krafttraining';
  }
  if (sport === 'mobility') return 'Mobility';
  if (sport === 'recovery') return 'Regeneration';
  const suffix =
    intensity === 'hard' ? 'Intervalle' : intensity === 'moderate' ? 'Tempo' : 'Zone 2';
  return `${SPORT_LABEL[sport]} ${suffix}`;
}

function purposeFor(sport: Sport, intensity: Intensity, isLong: boolean): string {
  if (isLong) return 'Grundlage und Ermüdungswiderstand — die Währung für lange Distanzen.';
  if (sport === 'strength') {
    return intensity === 'hard'
      ? 'Maximalkraft und Struktur. Hält die Muskulatur, während der Umfang steigt.'
      : 'Kraftausdauer und Stabilität, ohne den nächsten Lauftag zu kosten.';
  }
  if (sport === 'mobility') return 'Beweglichkeit halten. Kostet nichts und verhindert viel.';
  if (sport === 'recovery') return 'Aktive Erholung. Blut in Bewegung, kein Reiz.';
  if (intensity === 'hard') return 'Spritzigkeit und Schwelle. Der einzige Reiz, der Tempo bringt.';
  if (intensity === 'moderate') return 'Tempohärte im mittleren Bereich.';
  return 'Aerobe Grundlage. Das Fundament, auf dem alles andere steht.';
}

function build(
  verdict: Verdict,
  sport: Sport,
  intensity: Intensity,
  allowance: DayAllowance,
  needs: WeekNeeds,
  phase: ActivePhase,
  reasons: string[],
  isLong = false,
  longestRecentMin = 0,
): Suggestion {
  return {
    verdict,
    sport,
    intensity,
    title: titleFor(sport, intensity, isLong),
    minutes: durationFor(sport, intensity, allowance, needs, phase, isLong, longestRecentMin),
    zone: zoneFor(sport, intensity),
    purpose: purposeFor(sport, intensity, isLong),
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* Die Entscheidung                                                    */
/* ------------------------------------------------------------------ */

export function planDay(input: EngineInput): DayPlan {
  const { date, shiftContext, sessions, settings, recovery, phases } = input;

  const day = resolveRange(date, date, shiftContext)[0];
  const phase = activePhase(phases, settings, date);
  const allowance = dayAllowance(day, recovery);
  const hard = hardContext(sessions, date);
  const needs = weekNeeds(input, phase);
  const balance = loadBalance(sessions, date, settings.rampWarnPct);

  /* --- Obergrenze: was Belastung und Regeln noch zulassen --------- */
  let cap = allowance.cap;
  const limits: string[] = [];

  if (cap === 'hard' && hard.streakBefore >= settings.maxConsecutiveHardDays) {
    cap = 'moderate';
    limits.push(
      `${hard.streakBefore} harte Tage in Folge — der nächste wird leichter.`,
    );
  }
  if (cap === 'hard' && needs.hardDone >= needs.hardTarget) {
    cap = 'moderate';
    limits.push(
      `${needs.hardDone} harte Einheiten stehen diese Woche schon — in der ${phase.kind === 'base' ? 'Base' : 'aktuellen'}-Phase sind ${needs.hardTarget} vorgesehen.`,
    );
  }
  if (cap === 'hard' && hard.last7 >= settings.maxHardPerWeek) {
    cap = 'moderate';
    limits.push(`${hard.last7} harte Tage in den letzten sieben — das reicht.`);
  }
  if (cap === 'hard' && balance.rising) {
    cap = 'moderate';
    limits.push(
      `Die Belastung liegt ${balance.rampPct} % über dem Schnitt der letzten Wochen. Heute nichts obendrauf.`,
    );
  }

  /* --- Ruhetag ---------------------------------------------------- */
  if (cap === null) {
    const restReason = day.isUnknown
      ? 'Trag die Schicht ein, dann schlägt die App etwas vor.'
      : restAdvice(day, recovery);
    return {
      date,
      day,
      recovery,
      allowance,
      phase,
      hard,
      primary: null,
      alternatives: allowance.sports.includes('mobility')
        ? [
            build(
              'alternative',
              'mobility',
              'easy',
              allowance,
              needs,
              phase,
              ['Zwanzig Minuten Mobility kosten nichts und halten die Beweglichkeit.'],
            ),
          ]
        : [],
      discouraged: [],
      headline: allowance.reason,
      week: needs,
    };
  }

  /* --- Bedarf: was fehlt der Woche am meisten? -------------------- */
  const candidates: Suggestion[] = [];
  const possible = (sport: Sport) => allowance.sports.includes(sport);
  const daysSince = (sport: Sport) => hard.daysSince[sport] ?? 99;

  // 1. Die lange Einheit — das Rückgrat eines Ultra-Ziels. Nur an Tagen, die
  //    sie tragen, und nur einmal pro Woche.
  const longFits = allowance.maxMinutes >= 90 && !needs.hasLongSession;
  if (longFits && possible('run') && INTENSITY_RANK[cap] >= INTENSITY_RANK.moderate) {
    const reasons = [
      'Diese Woche fehlt noch die lange Einheit — sie ist bei einem Ultra-Ziel die wichtigste der Woche.',
      `${day.shift.name}: ${allowance.window ?? 'ganzer Tag'} reicht dafür.`,
    ];
    if (hard.daysSinceLong !== null) {
      reasons.push(`Die letzte lange Einheit ist ${hard.daysSinceLong} Tage her.`);
    }
    if (hard.longestRecentMin > 0) {
      reasons.push(
        `Höchstens 15 % über deiner längsten Einheit der letzten vier Wochen (${formatDuration(hard.longestRecentMin)}).`,
      );
    } else {
      reasons.push('Noch keine lange Einheit in den Daten — deshalb vorsichtig mit 75 Minuten.');
    }
    candidates.push(
      build('recommended', 'run', 'easy', allowance, needs, phase, reasons, true, hard.longestRecentMin),
    );
  }

  // 2. Harte Ausdauer, wenn die Woche sie noch hergibt.
  if (cap === 'hard' && possible('run') && needs.hardDone < needs.hardTarget) {
    candidates.push(
      build('recommended', 'run', 'hard', allowance, needs, phase, [
        `Erholung ${recovery === 'ready' ? 'gut' : 'ausreichend'} und ${day.shift.name} — der Tag trägt einen harten Reiz.`,
        `Harte Einheit ${needs.hardDone + 1} von ${needs.hardTarget} dieser Woche.`,
        daysSince('run') < 99
          ? `Letzte Laufeinheit vor ${daysSince('run')} Tagen.`
          : 'Noch keine Laufeinheit in den Daten.',
      ]),
    );
  }

  // 3. Kraft, wenn das Wochenpensum offen ist und die Beine nicht frisch
  //    belastet wurden.
  if (possible('strength') && needs.strengthDone < needs.strengthTarget && daysSince('strength') >= 2) {
    const heavy = cap === 'hard' && needs.hardDone < needs.hardTarget;
    candidates.push(
      build('recommended', 'strength', heavy ? 'hard' : 'moderate', allowance, needs, phase, [
        `Krafteinheit ${needs.strengthDone + 1} von ${needs.strengthTarget} dieser Woche.`,
        daysSince('strength') < 99
          ? `Letztes Krafttraining vor ${daysSince('strength')} Tagen.`
          : 'Noch kein Krafttraining in den Daten.',
        'Kraft hält die Struktur zusammen, während der Laufumfang steigt.',
      ]),
    );
  }

  // 4. Die Sportart, die gegenüber der Zielverteilung am weitesten zurückliegt.
  for (const { sport, missing } of needs.missingBySport) {
    if (!possible(sport) || sport === 'mobility') continue;
    if (candidates.some((c) => c.sport === sport)) continue;
    const intensity: Intensity = INTENSITY_RANK[cap] >= INTENSITY_RANK.moderate ? 'moderate' : 'easy';
    candidates.push(
      build('recommended', sport, intensity, allowance, needs, phase, [
        `${SPORT_LABEL[sport]} liegt diese Woche ${formatDuration(missing)} unter der Zielverteilung.`,
        daysSince(sport) < 99 ? `Zuletzt vor ${daysSince(sport)} Tagen.` : 'Diese Woche noch nicht dran gewesen.',
      ]),
    );
  }

  // 5. Rückfall: lockere Ausdauer, sonst Mobility.
  if (candidates.length === 0) {
    if (possible('run')) {
      candidates.push(
        build('recommended', 'run', 'easy', allowance, needs, phase, [
          'Lockere Grundlage passt heute immer — sie kostet wenig und zahlt auf alles ein.',
        ]),
      );
    } else if (possible('mobility')) {
      candidates.push(
        build('recommended', 'mobility', 'easy', allowance, needs, phase, [
          'Mehr gibt der Tag nicht her, und das ist in Ordnung.',
        ]),
      );
    }
  }

  // Die erlaubte Intensität nach unten deckeln — Kandidaten wurden nach Bedarf
  // gebaut, nicht nach Erlaubnis.
  for (const c of candidates) {
    if (!allows(allowance, c.intensity)) {
      c.intensity = cap;
      c.zone = zoneFor(c.sport, cap);
      c.title = titleFor(c.sport, cap, c.minutes >= 90);
      c.purpose = purposeFor(c.sport, cap, c.minutes >= 90);
    }
  }

  const primary = candidates[0] ?? null;
  const alternatives = candidates.slice(1, 3).map((c) => ({ ...c, verdict: 'alternative' as const }));

  if (primary) primary.reasons.push(...limits);

  /* --- Was heute nicht sinnvoll ist ------------------------------- */
  const discouraged: Suggestion[] = [];
  if (cap !== 'hard' && allowance.cap === 'hard') {
    discouraged.push(
      build('discouraged', 'run', 'hard', allowance, needs, phase, limits.length > 0 ? limits : [
        'Die Belastung der letzten Tage lässt heute keinen weiteren harten Reiz zu.',
      ]),
    );
  } else if (allowance.cap !== null && INTENSITY_RANK[allowance.cap] < INTENSITY_RANK.hard) {
    discouraged.push(
      build('discouraged', 'run', 'hard', allowance, needs, phase, [
        allowance.reason,
        'Ein harter Reiz braucht einen Tag, der ihn auch verdauen lässt.',
      ]),
    );
  }

  return {
    date,
    day,
    recovery,
    allowance,
    phase,
    hard,
    primary,
    alternatives,
    discouraged,
    headline: primary
      ? `${primary.title} · ${formatDuration(primary.minutes)}`
      : allowance.reason,
    week: needs,
  };
}

/** Was an einem Tag ohne Training trotzdem richtig ist. */
function restAdvice(day: ResolvedDay, recovery: Recovery): string {
  if (day.shift.cancelsPlanned) return 'Erholen. Kein Training, auch kein leichtes.';
  if (recovery === 'low') {
    return 'Die Erholung gibt heute nichts her. Schlaf, essen, spazieren — das ist der Trainingsreiz.';
  }
  if (day.shift.capability === 'none') {
    return `${day.shift.name}: zwölf Stunden. Höchstens Mobility, sonst Regeneration.`;
  }
  return 'Ruhetag. Bewegung ja, Training nein.';
}
