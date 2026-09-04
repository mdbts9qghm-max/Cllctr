'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { addDays, formatShort, today, weekdayShort } from '@/lib/dates';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { resolveShiftRange } from '@/lib/shifts';
import { explainDay, hardContextFor } from '@/lib/planner';
import { ENERGY_BALANCE_LABEL, nutritionFor, type NutritionPlan } from '@/lib/nutrition';
import {
  INTENSITY_LABEL,
  SESSION_TYPES,
  type DayReadiness,
  type Session,
} from '@/lib/types';
import { Card, Section } from '@/components/ui';

/** Wie viele Tage nach vorn die Vorschau reicht. */
const AHEAD = 6;

/**
 * Ampelfarbe der Energierichtung.
 *
 * Bewusst nur drei Töne und keine eigene Palette: Überschuss ist die Ausnahme
 * und bekommt deshalb den Akzent, Erhalt ist der Normalfall und bleibt neutral,
 * Defizit ist gedämpft. Mehr Farbe würde eine Genauigkeit vortäuschen, die die
 * Empfehlung nicht hat.
 */
const BALANCE_TONE: Record<NutritionPlan['balance'], string> = {
  surplus: 'text-ember',
  maintenance: 'text-ink',
  deficit: 'text-ink-muted',
};

export default function ErnaehrungPage() {
  const ctx = useShiftContext();
  const settings = useSettings();
  const [openDay, setOpenDay] = useState<string | null>(null);

  const todayIso = today();

  const data = useLiveQuery(async () => {
    const from = addDays(todayIso, -8);
    const to = addDays(todayIso, AHEAD);
    const sessions = await db.sessions.where('date').between(from, to, true, true).toArray();
    const readiness = await db.readiness.where('date').between(todayIso, to, true, true).toArray();
    const micros = await db.microcycles.toArray();
    return { sessions, readiness, micros };
  }, [todayIso]);

  if (!ctx || !settings || !data) return <p className="text-sm text-ink-faint">Lade …</p>;

  const readinessByDate = new Map<string, DayReadiness>(data.readiness.map((r) => [r.date, r]));
  const days = resolveShiftRange(todayIso, addDays(todayIso, AHEAD), ctx);

  /** Alles, was für einen Tag zur Empfehlung führt — an einer Stelle gebaut. */
  function planFor(date: string) {
    const day = days.find((d) => d.date === date)!;
    const own = data!.sessions.filter(
      (s) => s.date === date && s.status !== 'skipped' && s.status !== 'missed',
    );
    const micro = data!.micros.find((m) => m.startDate <= date && date <= m.endDate);
    const { ctx: dayCtx, allowance } = explainDay(
      day,
      readinessByDate.get(date),
      settings!,
      hardContextFor(date, data!.sessions),
      micro?.isDeload ?? false,
      todayIso,
    );
    return {
      day,
      sessions: own,
      nutrition: nutritionFor(dayCtx, allowance, own.map((s) => s.type)),
    };
  }

  const heute = planFor(todayIso);

  return (
    <>
      <Section
        title="Heute"
        hint="Die Empfehlung entsteht aus dem, was heute ansteht — Schicht, Erholung und die geplante Einheit. Ändert sich davon etwas, ändert sie sich mit."
      >
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="text-sm text-ink">
              {formatShort(todayIso)} · {heute.day.shiftType.name}
            </p>
            <p className={`shrink-0 text-xs ${BALANCE_TONE[heute.nutrition.balance]}`}>
              {ENERGY_BALANCE_LABEL[heute.nutrition.balance]}
            </p>
          </div>

          <p className="mb-3 text-sm leading-relaxed text-ink">{heute.nutrition.headline}</p>

          <ul className="mb-4 space-y-1">
            {heute.nutrition.macros.map((line, i) => (
              <li key={i} className="text-sm leading-relaxed text-ink-muted">
                {line}
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-line pt-3">
            {heute.nutrition.timing.map((t, i) => (
              <p key={i} className="text-sm leading-relaxed text-ink">
                <span className="text-ink-muted">{t.when}:</span> {t.what}
              </p>
            ))}
          </div>

          {heute.nutrition.notes.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-line pt-3">
              {heute.nutrition.notes.map((note, i) => (
                <li key={i} className="text-xs leading-relaxed text-ink-faint">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </Section>

      <Section
        title="Die nächsten Tage"
        hint="Was ansteht, sagt schon jetzt, wann eingekauft und vorgekocht sein muss. Tippe einen Tag an."
      >
        <Card>
          <ul className="divide-y divide-line">
            {days.slice(1).map((day) => {
              const p = planFor(day.date);
              const open = openDay === day.date;
              return (
                <li key={day.date}>
                  <button
                    onClick={() => setOpenDay(open ? null : day.date)}
                    className="flex w-full items-baseline gap-3 py-2.5 text-left"
                  >
                    <span className="w-9 shrink-0 text-xs text-ink-faint tabular">
                      {weekdayShort(day.date)}
                    </span>
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-void"
                      style={{ backgroundColor: day.shiftType.color }}
                    >
                      {day.shiftType.short}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${BALANCE_TONE[p.nutrition.balance]}`}>
                        {ENERGY_BALANCE_LABEL[p.nutrition.balance]}
                      </span>
                      <span className="block truncate text-[11px] text-ink-faint">
                        {sessionLine(p.sessions)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {CARB_LABEL[p.nutrition.carbs]}
                    </span>
                  </button>

                  {open ? (
                    <div className="pb-3 pl-12">
                      <p className="mb-2 text-sm leading-relaxed text-ink">
                        {p.nutrition.headline}
                      </p>
                      <div className="space-y-1">
                        {p.nutrition.timing.map((t, i) => (
                          <p key={i} className="text-xs leading-relaxed text-ink-muted">
                            <span className="text-ink-faint">{t.when}:</span> {t.what}
                          </p>
                        ))}
                      </div>
                      {p.nutrition.notes.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {p.nutrition.notes.map((note, i) => (
                            <li key={i} className="text-xs leading-relaxed text-ink-faint">
                              {note}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      </Section>

      <Section
        title="Die Regel dahinter"
        hint="Cllctr kennt weder dein Gewicht noch deinen Verbrauch und rechnet deshalb keine Kalorien aus. Was es sagen kann, ist die Richtung — und die ist im Schichtdienst die eigentliche Frage."
      >
        <Card>
          <ul className="space-y-3">
            {RULES.map((r) => (
              <li key={r.day}>
                <p className="text-sm font-medium text-ink">{r.day}</p>
                <p className="text-sm leading-relaxed text-ink-muted">{r.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
            Zwei Ausnahmen wiegen schwerer als die Tabelle: nach einer Nachtschicht und bei
            großer Schlafschuld kein Defizit. Zum Schlafmangel noch den Energiemangel zu legen,
            zieht die Erholung doppelt nach unten.
          </p>
        </Card>
      </Section>
    </>
  );
}

const CARB_LABEL: Record<NutritionPlan['carbs'], string> = {
  high: 'KH hoch',
  moderate: 'KH mittel',
  low: 'KH niedrig',
};

const RULES: Array<{ day: string; text: string }> = [
  {
    day: 'Harter Tag',
    text: 'Erhalt bis leichter Überschuss. Kohlenhydrate hoch, der Großteil vor und nach der Einheit. Protein durchgehend hoch.',
  },
  {
    day: 'Mittlerer Tag',
    text: 'Erhalt oder leichtes Defizit. Kohlenhydrate moderat und auf das Training konzentriert.',
  },
  {
    day: 'Lockerer Tag oder Ruhetag',
    text: 'Leichtes Defizit möglich. Protein, Gemüse und Mikronährstoffe im Vordergrund — hier fällt im Schichtdienst am meisten aus.',
  },
  {
    day: 'Vor der Nachtschicht',
    text: 'Größere Mahlzeit 2–4 Stunden vorher, in der Nacht nur kleine Snacks. Koffein höchstens bis zur Hälfte der Schicht.',
  },
  {
    day: 'Schlaftag',
    text: 'Nach dem Hauptschlaf die erste richtige Mahlzeit, hochwertig. Kein extremes Defizit — der Körper arbeitet ohnehin an der Erholung.',
  },
  {
    day: 'Tag- und V-Schicht',
    text: 'Zwölf Stunden brauchen Energie: zwei feste Mahlzeiten plus Snacks einpacken. Koffein früh, damit der Schlaf danach hält.',
  },
];

/** Was an einem Tag ansteht, in einer Zeile. */
function sessionLine(sessions: Session[]): string {
  if (sessions.length === 0) return 'Kein Training';
  return sessions
    .map((s) => `${s.title} · ${INTENSITY_LABEL[SESSION_TYPES[s.type].intensity].toLowerCase()}`)
    .join(', ');
}
