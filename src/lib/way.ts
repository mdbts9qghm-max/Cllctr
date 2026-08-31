/**
 * Der Weg — von null zurück in einen Alltag, der trägt.
 *
 * Kein zweites Aufgabensystem, sondern eine Ordnung über dem, das es schon
 * gibt: Ein Bereich ist an der Reihe, seine Schritte sind ganz normale tägliche
 * Aufgaben, und sie stehen dort, wo alle täglichen Aufgaben stehen.
 *
 * Vier Regeln tragen das Ganze:
 *
 *   1. **Einer nach dem anderen.** Nur ein Bereich ist aktiv. Der nächste kommt
 *      erst dazu, wenn der aktuelle steht — mehr Fronten gleichzeitig ist genau
 *      der Grund, warum es vorher nicht geklappt hat.
 *   2. **Stufe 0 ist lächerlich klein.** Ein einziger Schritt. Wer bei null
 *      anfängt, scheitert an jedem ambitionierten Startpaket.
 *   3. **Die Stufe wird verdient und sinkt nie.** Serie hält sie hoch; reißt
 *      sie, fängt die Serie neu an — die Stufe bleibt.
 *   4. **Krank und Urlaub brechen nichts.** Solche Tage werden übersprungen,
 *      nicht als Lücke gewertet.
 */

import { addDays, today } from './dates';
import type { IsoDate, Task, TaskEnergy, WayArea } from './types';

/** Tage Serie, bis eine Stufe steigt — also ein Schritt dazukommt. */
export const LEVEL_STEP_DAYS = 3;

/** Tage Serie, bis die App den nächsten Bereich vorschlägt. */
export const AREA_READY_DAYS = 14;

export interface WayStepTemplate {
  title: string;
  notes: string;
  energy: TaskEnergy;
}

export interface WayAreaTemplate {
  key: string;
  name: string;
  /** Ein Satz, warum dieser Bereich an dieser Stelle steht. */
  why: string;
  order: number;
  /** In dieser Reihenfolge kommen die Schritte dazu. Der erste ist Stufe 0. */
  steps: WayStepTemplate[];
  /** Typischer Rückstand, der in diesem Bereich liegen bleibt. */
  chunks: string[];
}

/**
 * Die Reihenfolge der Bereiche.
 *
 * Hygiene zuerst: der Bereich, der am schnellsten wieder ein Gefühl von
 * Normalität gibt und von niemandem außer dir abhängt. Dann Schlaf, weil bei
 * Wechselschicht alles andere daran hängt. Ernährung als Brücke zum Training,
 * das ohnehin läuft. Haushalt zuletzt — der größte Brocken, und der, der am
 * ehesten wartet.
 */
export const WAY_CATALOG: WayAreaTemplate[] = [
  {
    key: 'hygiene',
    name: 'Hygiene und Körper',
    why: 'Hängt von niemandem ab außer dir und wirkt sofort. Der kürzeste Weg zurück zu einem Tag, der sich normal anfühlt.',
    order: 1,
    steps: [
      { title: 'Zähne putzen, morgens und abends', notes: 'Der eine Schritt, mit dem alles anfängt. Mehr nicht.', energy: 'light' },
      { title: 'Duschen', notes: 'An Schichttagen danach, an freien Tagen wann es passt.', energy: 'light' },
      { title: 'Frische Kleidung anziehen', notes: 'Getragenes kommt in den Wäschekorb, nicht auf den Stuhl.', energy: 'light' },
      { title: 'Rasieren oder Bart trimmen', notes: '', energy: 'light' },
      { title: 'Gesicht und Hände pflegen', notes: 'Creme nach der Schicht — trockene Luft zwölf Stunden lang.', energy: 'light' },
    ],
    chunks: [
      'Wäscheberg abarbeiten',
      'Handtücher wechseln',
      'Bad putzen',
      'Zahnarzttermin machen',
      'Pflegesachen auffüllen',
    ],
  },
  {
    key: 'sleep',
    name: 'Schlaf und Erholung',
    why: 'Bei zwölf Stunden im Wechsel entscheidet der Schlaf über alles andere — Training, Laune, Appetit.',
    order: 2,
    steps: [
      { title: 'Schlafzimmer abdunkeln und lüften', notes: 'Vor dem Hinlegen, auch tagsüber nach der Nachtschicht.', energy: 'light' },
      { title: 'Handy 30 Minuten vor dem Schlafen weglegen', notes: 'Nicht ins Schlafzimmer mitnehmen.', energy: 'light' },
      { title: 'Nach der Nachtschicht: Schlaf schützen', notes: 'Rollo runter, Ohrstöpsel rein, Tür zu, Klingel aus.', energy: 'light' },
      { title: 'Kein Koffein in den letzten 8 Stunden', notes: 'Auf der Nachtschicht heißt das: die letzte Tasse vor 03:00.', energy: 'light' },
      { title: 'Feste Schlafenszeit an freien Tagen', notes: 'Die Rotation lässt nur an freien Tagen einen festen Rhythmus zu — dort dann aber wirklich.', energy: 'light' },
    ],
    chunks: [
      'Verdunklungsrollo besorgen',
      'Ohrstöpsel kaufen',
      'Matratze und Kissen prüfen',
      'Schlafzimmer aufräumen',
      'Wecker aus dem Blickfeld stellen',
    ],
  },
  {
    key: 'food',
    name: 'Ernährung und Einkauf',
    why: 'Der kleinste Sprung von dort, wo du schon bist — das Training läuft, das Essen entscheidet, was es bringt.',
    order: 3,
    steps: [
      { title: 'Erste Mahlzeit nicht auslassen', notes: 'Egal wann der Tag anfängt.', energy: 'light' },
      { title: 'Essen für den Schichttag vorbereiten', notes: 'Am Abend vorher einpacken, nicht morgens improvisieren.', energy: 'light' },
      { title: 'Einmal am Tag selbst kochen', notes: 'An Tagschichttagen reicht aufwärmen, was vorbereitet ist.', energy: 'focus' },
      { title: 'Obst oder Gemüse zu jeder Hauptmahlzeit', notes: '', energy: 'light' },
      { title: 'Einkaufszettel vor dem Einkauf', notes: 'Was auf dem Zettel steht, kommt in den Wagen — der Rest nicht.', energy: 'light' },
    ],
    chunks: [
      'Kühlschrank ausräumen und putzen',
      'Abgelaufenes entsorgen',
      'Vorratsschrank sortieren',
      'Grundvorrat anlegen',
      'Dosen für Schichtessen besorgen',
    ],
  },
  {
    key: 'home',
    name: 'Haushalt und Ordnung',
    why: 'Der größte Brocken, deshalb zuletzt. Mit stehendem Alltag ist er Arbeit — ohne wäre er eine Wand.',
    order: 4,
    steps: [
      { title: 'Küche abends leer machen', notes: 'Spüle frei, Arbeitsfläche frei. Der Tag ist damit zu.', energy: 'light' },
      { title: 'Bett machen', notes: '', energy: 'light' },
      { title: '10 Minuten aufräumen', notes: 'Wecker stellen. Was in zehn Minuten geht, geht — der Rest morgen.', energy: 'light' },
      { title: 'Wäsche: waschen, trocknen, wegräumen', notes: 'Wegräumen gehört dazu, sonst steht der Korb nur woanders.', energy: 'focus' },
      { title: 'Müll rechtzeitig rausbringen', notes: 'Am Abend vor der Abholung, nicht am Morgen danach.', energy: 'light' },
    ],
    chunks: [
      'Schreibtisch leerräumen',
      'Kleiderschrank ausmisten',
      'Keller oder Abstellraum',
      'Fenster putzen',
      'Auto ausräumen',
    ],
  },
];

export const WAY_BY_KEY = new Map(WAY_CATALOG.map((a) => [a.key, a]));

/* ------------------------------------------------------------------ */
/* Serie                                                               */
/* ------------------------------------------------------------------ */

/**
 * Wie viele Tage in Folge alle Schritte eines Bereichs erledigt waren.
 *
 * `pausedDays` sind Tage, an denen der Weg ruht — krank, Urlaub. Sie werden
 * übersprungen: sie zählen nicht mit, brechen aber auch nicht. Ein grippiger
 * Dienstag darf zwei Wochen Arbeit nicht zunichtemachen.
 *
 * Der heutige Tag bricht nichts, solange er läuft — er ist erst dann eine
 * Lücke, wenn er vorbei ist.
 */
export function wayStreak(
  steps: Array<{ since: IsoDate; days: Set<IsoDate> }>,
  pausedDays: Set<IsoDate>,
  reference: IsoDate = today(),
  maxLookback = 400,
): number {
  if (steps.length === 0) return 0;

  /**
   * Ein Tag zählt, wenn alles erledigt wurde, was es an dem Tag **schon gab**.
   *
   * Ohne diese Einschränkung würde jede neue Stufe die Serie auf null setzen:
   * der frisch dazugekommene Schritt hat für gestern nichts vorzuweisen und
   * könnte es auch nicht. Man käme nie über drei Tage hinaus.
   */
  const complete = (date: IsoDate) => {
    const existed = steps.filter((s) => s.since <= date);
    // Ein Tag vor dem ersten Schritt ist kein geschaffter Tag, sondern gar
    // keiner — sonst zählte die gesamte Vergangenheit als Serie mit.
    return existed.length > 0 && existed.every((s) => s.days.has(date));
  };

  let streak = 0;
  let cursor = complete(reference) ? reference : addDays(reference, -1);

  for (let i = 0; i < maxLookback; i++) {
    if (pausedDays.has(cursor) && !complete(cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!complete(cursor)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Stufe, die diese Serie rechtfertigt — begrenzt durch die Zahl der Schritte. */
export function levelFromStreak(streak: number, stepCount: number): number {
  return Math.min(Math.max(0, stepCount - 1), Math.floor(streak / LEVEL_STEP_DAYS));
}

/* ------------------------------------------------------------------ */
/* Aufgaben eines Bereichs                                             */
/* ------------------------------------------------------------------ */

/** Die täglichen Schritte eines Bereichs, in ihrer Reihenfolge. */
export function stepsOf(tasks: Task[], areaKey: string): Task[] {
  // Nur die offene Instanz je Schritt: beim Abhaken bleibt die erledigte als
  // Verlauf stehen und trägt dieselben Weg-Felder. Ohne diesen Filter stünde
  // jeder Schritt so oft in der Liste, wie er je erledigt wurde.
  return tasks
    .filter(
      (t) =>
        t.wayArea === areaKey &&
        t.wayOrder !== null &&
        t.recurrence !== null &&
        t.status === 'open',
    )
    .sort((a, b) => (a.wayOrder ?? 0) - (b.wayOrder ?? 0));
}

/** Die Brocken eines Bereichs — einmalige Aufgaben ohne Wiederholung. */
export function chunksOf(tasks: Task[], areaKey: string): Task[] {
  return tasks
    .filter((t) => t.wayArea === areaKey && t.wayOrder === null && t.recurrence === null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Der Bereich, an dem gerade gearbeitet wird. */
export function activeArea(areas: WayArea[]): WayArea | null {
  return areas.find((a) => a.status === 'active') ?? null;
}

/** Der nächste Bereich, der freigeschaltet werden könnte. */
export function nextLockedArea(areas: WayArea[]): WayArea | null {
  return (
    [...areas]
      .filter((a) => a.status === 'locked')
      .sort((a, b) => a.order - b.order)[0] ?? null
  );
}
