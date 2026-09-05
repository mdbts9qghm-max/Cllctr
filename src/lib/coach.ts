/**
 * Der Coach.
 *
 * **Kein Sprachmodell.** Cllctr hat keinen Server und keine API-Schlüssel — das
 * ist der Kern des Projekts, nicht eine fehlende Funktion. Der Coach beantwortet
 * deshalb eine feste Menge Fragen, aber die beantwortet er **richtig**: mit den
 * echten Daten, nachvollziehbar und ohne Floskeln.
 *
 * Das ist ehrlicher als ein Chatfenster, das erfindet, was es nicht weiß.
 */

import { addDays, formatDuration, formatShort, num, startOfWeek } from './dates';
import { hardContext, inRange, loadBalance, minutesOf, summarize } from './load';
import { activePhase } from './phases';
import { planDay, type EngineInput } from './engine';
import { hybridScore, type ScoreInput } from './score';
import { reviewWeek, type ReviewInput } from './review';
import {
  ENDURANCE_SPORTS,
  SPORT_LABEL,
  type Goal,
  type IsoDate,
  type Sport,
} from './types';

export interface CoachQuestion {
  id: string;
  question: string;
}

export interface CoachAnswer {
  question: string;
  /** Die Antwort in einem Satz. */
  headline: string;
  /** Belege — jeder Punkt eine nachprüfbare Zahl. */
  details: string[];
}

export const COACH_QUESTIONS: CoachQuestion[] = [
  { id: 'today', question: 'Was soll ich heute trainieren?' },
  { id: 'lastWeek', question: 'Wie war meine letzte Woche?' },
  { id: 'score', question: 'Warum steht mein Hybrid Score da, wo er steht?' },
  { id: 'runVolume', question: 'Wie viel bin ich diesen Monat gelaufen?' },
  { id: 'load', question: 'Steigere ich zu schnell?' },
  { id: 'ultra', question: 'Wie entwickle ich mich Richtung 100-km-Ultra?' },
  { id: 'strengthVsRun', question: 'Soll ich heute laufen oder Kraft machen?' },
  { id: 'gaps', question: 'Was vernachlässige ich gerade?' },
];

export interface CoachInput {
  engine: EngineInput;
  score: ScoreInput;
  review: ReviewInput;
  goals: Goal[];
}

export function answer(id: string, input: CoachInput): CoachAnswer {
  const question = COACH_QUESTIONS.find((q) => q.id === id)?.question ?? '';
  const today = input.engine.date;

  switch (id) {
    case 'today': {
      const plan = planDay(input.engine);
      if (!plan.primary) {
        return {
          question,
          headline: plan.headline,
          details: [plan.allowance.reason, ...(plan.alternatives[0]?.reasons ?? [])],
        };
      }
      return {
        question,
        headline: `${plan.primary.title}, ${formatDuration(plan.primary.minutes)}.`,
        details: [...plan.primary.reasons, plan.primary.purpose],
      };
    }

    case 'lastWeek': {
      const r = reviewWeek({ ...input.review, anyDayOfWeek: addDays(startOfWeek(today), -1) });
      return {
        question,
        headline: `${formatDuration(r.numbers.totalMinutes)} in ${r.numbers.sessions} Einheiten an ${r.numbers.activeDays} Tagen.`,
        details: [...r.text.wentWell, ...r.text.improve],
      };
    }

    case 'score': {
      const s = hybridScore(input.score);
      const sorted = [...s.parts].sort((a, b) => a.value - b.value);
      const worst = sorted[0];
      const best = sorted[sorted.length - 1];

      // Wenn alles auf null steht, ist „am stärksten" eine Beleidigung. Dann ist
      // die richtige Antwort, dass noch nichts drinsteht.
      if (best.value === 0) {
        return {
          question,
          headline: 'Noch bei null — es ist nichts protokolliert, woraus sich ein Wert ergäbe.',
          details: [
            'Der Score entsteht aus erledigten Einheiten, Check-ins und Habits der letzten vier Wochen.',
            'Hak eine Einheit ab und trag ein paar Habits ein, dann füllt er sich von selbst.',
          ],
        };
      }
      const direction =
        s.previous === null
          ? ''
          : s.total > s.previous
            ? ` Vor einer Woche waren es ${s.previous} — es geht aufwärts.`
            : s.total < s.previous
              ? ` Vor einer Woche waren es ${s.previous} — es geht abwärts.`
              : ' Unverändert gegenüber der Vorwoche.';
      return {
        question,
        headline: `${s.total} von 100.${direction}`,
        details: [
          `Am stärksten: ${best.label} mit ${best.value}. ${best.reasons[0]}`,
          `Am schwächsten: ${worst.label} mit ${worst.value}. ${worst.reasons[0]}`,
          ...worst.reasons.slice(1),
        ],
      };
    }

    case 'runVolume': {
      const monthStart = `${today.slice(0, 7)}-01`;
      const month = summarize(
        inRange(input.engine.sessions, monthStart, today).filter((s) => s.status === 'done'),
      );
      const previousStart = shiftMonthStart(monthStart, -1);
      const previous = summarize(
        inRange(input.engine.sessions, previousStart, addDays(monthStart, -1)).filter(
          (s) => s.status === 'done',
        ),
      );
      const km = month.km.run ?? 0;
      const previousKm = previous.km.run ?? 0;
      return {
        question,
        headline: `${num(km)} km seit dem 1. — in ${month.minutesBySport.run ? formatDuration(month.minutesBySport.run) : '0 min'}.`,
        details: [
          previousKm > 0
            ? `Im Vormonat waren es ${num(previousKm)} km.`
            : 'Für den Vormonat liegen keine Laufdaten vor.',
          `Gesamtumfang diesen Monat: ${formatDuration(month.minutes)} über alle Sportarten.`,
        ],
      };
    }

    case 'load': {
      const b = loadBalance(input.engine.sessions, today, input.engine.settings.rampWarnPct);
      if (b.rampPct === null) {
        return {
          question,
          headline: 'Dafür reichen die Daten noch nicht.',
          details: [
            'Für einen Vergleich braucht es mindestens ein paar Wochen Vorgeschichte.',
            `Belastung der letzten sieben Tage: ${b.acute}.`,
          ],
        };
      }
      return {
        question,
        headline: b.rising
          ? `Ja — ${b.rampPct} % über dem Schnitt der letzten vier Wochen.`
          : `Nein — ${b.rampPct >= 0 ? '+' : ''}${b.rampPct} % gegenüber dem Schnitt.`,
        details: [
          `Letzte sieben Tage: Belastung ${b.acute}.`,
          `Schnitt der vier Wochen davor: ${b.chronic} pro Woche.`,
          b.rising
            ? `Über ${input.engine.settings.rampWarnPct} % wird es riskant. Halten statt steigern.`
            : 'Im Rahmen. Steigern ist möglich, wenn die Erholung mitspielt.',
        ],
      };
    }

    case 'ultra': {
      const ultra = input.goals.find((g) => /ultra|100/i.test(g.title));
      const longest = input.engine.sessions
        .filter((s) => s.status === 'done' && ENDURANCE_SPORTS.includes(s.sport))
        .reduce((max, s) => Math.max(max, s.actualDistanceKm ?? s.plannedDistanceKm ?? 0), 0);
      const phase = activePhase(input.engine.phases, input.engine.settings, today);
      const last28 = summarize(
        inRange(input.engine.sessions, addDays(today, -27), today).filter((s) => s.status === 'done'),
      );
      const monthlyRun = last28.km.run ?? 0;

      const details = [
        `Längste Einheit bisher: ${num(longest)} km.`,
        `Laufumfang der letzten vier Wochen: ${num(monthlyRun)} km.`,
        `Aktuelle Phase: ${phase.kind === 'base' ? 'Base' : phase.kind}${phase.week ? `, Woche ${phase.week}${phase.totalWeeks ? ` von ${phase.totalWeeks}` : ''}` : ''}.`,
      ];
      if (ultra?.targetDate) details.push(`Zieldatum: ${formatShort(ultra.targetDate)}.`);
      else details.push('Kein Zieldatum hinterlegt — trag eins ein, dann richtet sich die Periodisierung danach.');

      // Faustregel aus der Ultrapraxis: rund das Doppelte des längsten Laufs im
      // Wettkampf ist machbar, der Monatsumfang muss ungefähr der Distanz
      // entsprechen. Bewusst als Richtwert benannt, nicht als Gesetz.
      const readiness =
        monthlyRun >= 250 && longest >= 45
          ? 'Die Basis trägt bereits in Richtung Ultra.'
          : monthlyRun >= 120
            ? 'Die Grundlage wächst, aber Monatsumfang und längster Lauf müssen noch deutlich hoch.'
            : 'Noch am Anfang: Erst Umfang aufbauen, dann Distanz.';
      return { question, headline: readiness, details };
    }

    case 'strengthVsRun': {
      const plan = planDay(input.engine);
      const hard = hardContext(input.engine.sessions, today);
      const sinceRun = hard.daysSince.run ?? 99;
      const sinceLift = hard.daysSince.strength ?? 99;
      if (!plan.primary) {
        return { question, headline: 'Heute weder noch.', details: [plan.headline] };
      }
      return {
        question,
        headline: `${SPORT_LABEL[plan.primary.sport]} — ${plan.primary.title}.`,
        details: [
          sinceRun < 99 ? `Letzter Lauf vor ${sinceRun} Tagen.` : 'Noch kein Lauf in den Daten.',
          sinceLift < 99
            ? `Letztes Krafttraining vor ${sinceLift} Tagen.`
            : 'Noch kein Krafttraining in den Daten.',
          ...plan.primary.reasons.slice(0, 2),
        ],
      };
    }

    case 'gaps': {
      const s = hybridScore(input.score);
      const weak = s.parts.filter((p) => p.value < 60).sort((a, b) => a.value - b.value);
      const hard = hardContext(input.engine.sessions, today);
      const stale = (Object.entries(hard.daysSince) as Array<[Sport, number]>)
        .filter(([, days]) => days >= 10)
        .map(([sport, days]) => `${SPORT_LABEL[sport]}: seit ${days} Tagen nicht.`);

      if (weak.length === 0 && stale.length === 0) {
        return {
          question,
          headline: 'Nichts Auffälliges. Alle Bereiche über 60.',
          details: s.parts.map((p) => `${p.label}: ${p.value}.`),
        };
      }
      return {
        question,
        headline:
          weak.length > 0
            ? `${weak.map((p) => p.label).join(' und ')} ${weak.length === 1 ? 'liegt' : 'liegen'} zurück.`
            : 'Der Score passt, aber einiges liegt lange zurück.',
        details: [...weak.flatMap((p) => [`${p.label} ${p.value}: ${p.reasons[0]}`]), ...stale],
      };
    }

    default:
      return {
        question,
        headline: 'Diese Frage kenne ich nicht.',
        details: ['Der Coach beantwortet die Fragen aus der Liste — aus deinen Daten, ohne zu raten.'],
      };
  }
}

function shiftMonthStart(monthStart: IsoDate, delta: number): IsoDate {
  const [y, m] = monthStart.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-01`;
}
