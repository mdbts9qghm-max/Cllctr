/**
 * Ernährungsempfehlung pro Tag.
 *
 * Bewusst **nicht** gespeichert, sondern jedes Mal aus dem Tag berechnet:
 * Verschiebt sich die Einheit oder ändert sich die Schicht, stimmt die
 * Empfehlung sonst nicht mehr — und eine falsche gespeicherte Empfehlung ist
 * schlimmer als gar keine.
 *
 * Die App kennt weder Gewicht noch Körperfett und rechnet deshalb keine
 * absoluten Kalorien aus. Was sie sagen kann, ist die *Richtung*: Überschuss,
 * Erhalt oder leichtes Defizit, und wann die Kohlenhydrate liegen sollen.
 * Genau das ist auch die Frage, die sich im Schichtdienst täglich stellt.
 */

import { shiftKindOf, type DayAllowance, type DayContext } from './rules';
import { SESSION_TYPES, type Intensity, type SessionTypeKey } from './types';

/** Grobe Richtung der Energiezufuhr. */
export type EnergyBalance = 'surplus' | 'maintenance' | 'deficit';

export const ENERGY_BALANCE_LABEL: Record<EnergyBalance, string> = {
  surplus: 'Erhalt bis leichter Überschuss',
  maintenance: 'Erhalt',
  deficit: 'Leichtes Defizit möglich',
};

export interface NutritionPlan {
  balance: EnergyBalance;
  /** Kohlenhydrate: hoch, moderat, niedrig — immer relativ zum eigenen Normalmaß. */
  carbs: 'high' | 'moderate' | 'low';
  /** Kurzfassung für die Tageszeile im Plan. */
  headline: string;
  /** Makroverteilung als Klartext, eine Zeile pro Nährstoff. */
  macros: string[];
  /** Was wann — die Zeitpunkte, auf die es an diesem Tag ankommt. */
  timing: Array<{ when: string; what: string }>;
  /** Schichtspezifische Hinweise, etwa zu Koffein oder Nachtsnacks. */
  notes: string[];
}

/**
 * Proteinziel.
 *
 * Steht auf jedem Tag gleich hoch und ist deshalb kein Regelwerk, sondern eine
 * Konstante: Bei einem Defizit hält es die Muskulatur, bei einem Überschuss
 * baut es auf, und im Schichtdienst ist es das Erste, was untergeht.
 */
const PROTEIN = 'Protein: durchgehend hoch, rund 2 g pro kg Körpergewicht, auf 3–4 Mahlzeiten verteilt.';

/**
 * Die Empfehlung für einen Tag.
 *
 * `intensity` ist die Intensität dessen, was tatsächlich geplant ist — nicht
 * das, was der Tag erlaubt hätte. Ein freier Tag ohne Einheit ist ernährungs-
 * technisch ein Ruhetag, auch wenn hart möglich gewesen wäre.
 */
export function nutritionFor(
  ctx: DayContext,
  allowance: DayAllowance,
  planned: SessionTypeKey[],
): NutritionPlan {
  const intensity = topIntensity(planned);
  const kind = shiftKindOf(ctx.shift);
  const window = allowance.window;

  const plan = baseFor(intensity, ctx);
  plan.timing = timingFor(intensity, window, kind);
  plan.notes = notesFor(kind, ctx, intensity);
  return plan;
}

function topIntensity(planned: SessionTypeKey[]): Intensity | null {
  let best: Intensity | null = null;
  for (const type of planned) {
    const i = SESSION_TYPES[type].intensity;
    if (best === null) best = i;
    else if (i === 'hard') best = 'hard';
    else if (i === 'medium' && best === 'easy') best = 'medium';
  }
  return best;
}

function baseFor(intensity: Intensity | null, ctx: DayContext): NutritionPlan {
  if (intensity === 'hard') {
    return {
      balance: 'surplus',
      carbs: 'high',
      headline: 'Harter Tag: Erhalt bis leichter Überschuss, Kohlenhydrate hoch ums Training.',
      macros: [
        'Kohlenhydrate: hoch, der Großteil davor und danach.',
        PROTEIN,
        'Fett: mittel, aber nicht direkt vor der Einheit.',
      ],
      timing: [],
      notes: [],
    };
  }

  if (intensity === 'medium') {
    return {
      balance: 'maintenance',
      carbs: 'moderate',
      headline: 'Mittlerer Tag: Erhalt oder leichtes Defizit, Kohlenhydrate gezielt ums Training.',
      macros: [
        'Kohlenhydrate: moderat, konzentriert auf die Mahlzeit vor und nach der Einheit.',
        PROTEIN,
        'Fett: mittel, außerhalb des Trainingsfensters.',
      ],
      timing: [],
      notes: [],
    };
  }

  // Locker oder Ruhetag. Ein Defizit ist möglich — aber nicht um jeden Preis.
  const hardSleep = ctx.sleepDebt === 'high' || (ctx.sleepHours !== null && ctx.sleepHours < 5);
  const afterNight = ctx.shift.afterNightShift;

  if (hardSleep || afterNight) {
    return {
      balance: 'maintenance',
      carbs: 'moderate',
      headline: afterNight
        ? 'Nach der Nachtschicht: kein aggressives Defizit, der Körper holt schon Schlaf nach.'
        : 'Bei großer Schlafschuld kein Defizit — sonst kommt zum Schlafmangel der Energiemangel.',
      macros: [
        'Kohlenhydrate: moderat, hochwertig statt schnell.',
        PROTEIN,
        'Gemüse und Mikronährstoffe: bewusst hoch, hier fällt im Schichtdienst am meisten aus.',
      ],
      timing: [],
      notes: [],
    };
  }

  return {
    balance: 'deficit',
    carbs: 'low',
    headline: 'Lockerer Tag: leichtes Defizit möglich. Protein, Gemüse, Mikronährstoffe im Vordergrund.',
    macros: [
      'Kohlenhydrate: niedriger, vor allem aus Gemüse, Obst und Vollkorn.',
      PROTEIN,
      'Fett: etwas höher, hält länger satt.',
    ],
    timing: [],
    notes: [],
  };
}

function timingFor(
  intensity: Intensity | null,
  window: string | null,
  kind: ReturnType<typeof shiftKindOf>,
): Array<{ when: string; what: string }> {
  if (intensity === null) {
    // Ohne Einheit gibt es kein Pre und kein Post — nur die Mahlzeiten des Tages.
    if (kind === 'day') {
      return [
        { when: 'Vor der Schicht', what: 'Ordentlich frühstücken, sonst trägt der Tag nicht.' },
        { when: 'Mitnehmen', what: 'Zwei feste Mahlzeiten plus Protein, damit die 12 Stunden nicht am Automaten enden.' },
        { when: 'Nach der Schicht', what: 'Leicht essen, nichts Schweres kurz vor dem Schlafen.' },
      ];
    }
    return [
      { when: 'Über den Tag', what: '3–4 Mahlzeiten, jede mit Proteinquelle.' },
      { when: 'Abends', what: 'Letzte größere Mahlzeit 2–3 Stunden vor dem Schlafen.' },
    ];
  }

  const at = window ? ` (${window})` : '';
  const pre =
    intensity === 'hard'
      ? '2–3 Stunden davor eine kohlenhydratbetonte Mahlzeit, 30–60 Min davor bei Bedarf eine kleine schnelle Portion.'
      : intensity === 'medium'
        ? '2 Stunden davor eine normale Mahlzeit mit Kohlenhydraten.'
        : 'Kein eigenes Pre-Workout nötig — die normale Mahlzeit reicht.';
  const post =
    intensity === 'hard'
      ? 'Innerhalb einer Stunde: Kohlenhydrate plus 30–40 g Protein.'
      : intensity === 'medium'
        ? 'Innerhalb von zwei Stunden eine vollständige Mahlzeit mit Protein.'
        : 'Normale nächste Mahlzeit, nichts Besonderes.';

  return [
    { when: `Vor der Einheit${at}`, what: pre },
    { when: 'Nach der Einheit', what: post },
    { when: 'Rest des Tages', what: 'Protein über die übrigen Mahlzeiten verteilen.' },
  ];
}

function notesFor(
  kind: ReturnType<typeof shiftKindOf>,
  ctx: DayContext,
  intensity: Intensity | null,
): string[] {
  const notes: string[] = [];

  switch (kind) {
    case 'night':
      notes.push('Vor der Nachtschicht 2–4 Stunden vorher eine größere Mahlzeit — die trägt durch die erste Hälfte.');
      notes.push('In der Nacht nur kleinere Snacks: Protein, Obst, nichts Schweres. Der Magen arbeitet nachts langsamer.');
      notes.push('Koffein bis maximal zur Hälfte der Schicht, danach nicht mehr — sonst geht der Schlaf am Morgen verloren.');
      break;
    case 'sleep':
      notes.push('Nach dem Hauptschlaf die erste richtige Mahlzeit: hochwertig, mit Protein und Kohlenhydraten.');
      notes.push('Kein extremes Defizit an diesem Tag — der Körper arbeitet ohnehin schon an der Erholung.');
      break;
    case 'day':
      notes.push('12 Stunden Schicht brauchen Energie: zwei feste Mahlzeiten und Snacks einpacken.');
      notes.push('Koffein nur in der ersten Hälfte der Schicht, sonst ist der Schlaf danach hin.');
      break;
    case 'variable':
      notes.push('Lange Arbeitszeit: genug essen, auch wenn nur kurz gelaufen wird.');
      notes.push('Koffein früh, damit der Schlaf nach der Schicht nicht leidet.');
      break;
    case 'free':
      if (intensity === 'hard') notes.push('Freier Tag mit harter Einheit — heute ist nicht der Tag zum Sparen.');
      break;
    case 'off':
      break;
  }

  if (ctx.sleepDebt === 'high') {
    notes.push('Bei großer Schlafschuld kein Defizit fahren: das zieht die Erholung zusätzlich nach unten.');
  }

  return notes;
}
