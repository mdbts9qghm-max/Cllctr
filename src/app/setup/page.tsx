'use client';

import { db } from '@/lib/db';
import { now } from '@/lib/ids';
import { useSettings, useShiftContext } from '@/lib/hooks';
import {
  CAPACITY_LABEL,
  type HrZone,
  type HrZoneNumber,
  type TrainingCapacity,
} from '@/lib/types';
import { Card, Field, inputClass, Notice, Section } from '@/components/ui';

const CAPACITIES: TrainingCapacity[] = ['none', 'light', 'moderate', 'full'];

export default function SetupPage() {
  const settings = useSettings();
  const ctx = useShiftContext();

  if (!settings || !ctx) return <p className="text-sm text-ink-faint">Lade …</p>;

  async function saveZone(zone: HrZoneNumber, patch: Partial<HrZone>) {
    if (!settings) return;
    const next = settings.hrZones.map((z) => (z.zone === zone ? { ...z, ...patch } : z));
    await db.settings.update('singleton', { hrZones: next, updatedAt: now() });
  }

  const zonesIncomplete = settings.hrZones.some((z) => z.maxBpm === 0);

  return (
    <>
      <Section
        title="Herzfrequenz-Zonen"
        hint="Deine eigenen Werte. Die App rechnet nichts aus — sie übernimmt, was hier steht, und schreibt es in die geplanten Laufeinheiten."
      >
        {zonesIncomplete ? (
          <div className="mb-3">
            <Notice tone="warn">
              Noch keine Zonen eingetragen. Bis das erledigt ist, plant die App Laufeinheiten ohne
              Herzfrequenz-Vorgabe.
            </Notice>
          </div>
        ) : null}

        <Card>
          <div className="mb-4 grid grid-cols-2 gap-3 border-b border-line pb-4">
            <Field label="Ruhe-HF">
              <input
                type="number"
                inputMode="numeric"
                value={settings.restHr ?? ''}
                onChange={(e) =>
                  void db.settings.update('singleton', {
                    restHr: Number(e.target.value) || null,
                    updatedAt: now(),
                  })
                }
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Maximale HF">
              <input
                type="number"
                inputMode="numeric"
                value={settings.maxHr ?? ''}
                onChange={(e) =>
                  void db.settings.update('singleton', {
                    maxHr: Number(e.target.value) || null,
                    updatedAt: now(),
                  })
                }
                className={`${inputClass} tabular`}
              />
            </Field>
          </div>

          <div className="space-y-3">
            {settings.hrZones.map((z) => (
              <div key={z.zone} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-sm font-semibold text-ember tabular">Z{z.zone}</span>
                <input
                  value={z.label}
                  onChange={(e) => void saveZone(z.zone, { label: e.target.value })}
                  className={`${inputClass} flex-1`}
                  placeholder="Name"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  value={z.minBpm || ''}
                  onChange={(e) => void saveZone(z.zone, { minBpm: Number(e.target.value) || 0 })}
                  className={`${inputClass} w-20 tabular`}
                  placeholder="von"
                />
                <span className="text-ink-faint">–</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={z.maxBpm || ''}
                  onChange={(e) => void saveZone(z.zone, { maxBpm: Number(e.target.value) || 0 })}
                  className={`${inputClass} w-20 tabular`}
                  placeholder="bis"
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-faint">Angaben in Schlägen pro Minute.</p>
        </Card>
      </Section>

      <Section
        title="Wochenziele"
        hint="Anzahl Einheiten pro Woche — bewusst keine Wochentage. Wohin sie fallen, entscheidet der Schichtplan."
      >
        <Card>
          <div className="grid grid-cols-3 gap-3">
            {(['strength', 'run', 'optional'] as const).map((key) => (
              <Field
                key={key}
                label={key === 'strength' ? 'Kraft' : key === 'run' ? 'Laufen' : 'Optional'}
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={7}
                  value={settings.weeklyTargets[key]}
                  onChange={(e) =>
                    void db.settings.update('singleton', {
                      weeklyTargets: {
                        ...settings.weeklyTargets,
                        [key]: Math.max(0, Math.min(7, Number(e.target.value) || 0)),
                      },
                      updatedAt: now(),
                    })
                  }
                  className={`${inputClass} tabular`}
                />
              </Field>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            &quot;Optional&quot; ist der Puffer: diese Einheit fällt beim Umplanen als Erstes weg.
          </p>
        </Card>
      </Section>

      <Section
        title="Umplanen"
        hint="Wie die App reagiert, wenn eine Einheit ausfällt."
      >
        <Card>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={settings.confirmRescheduleProposals}
              onChange={(e) =>
                void db.settings.update('singleton', {
                  confirmRescheduleProposals: e.target.checked,
                  updatedAt: now(),
                })
              }
              className="mt-1 size-4 accent-[#e0a43c]"
            />
            <span className="text-sm leading-relaxed text-ink">
              Vorschlag zeigen und bestätigen lassen
              <span className="mt-0.5 block text-xs text-ink-faint">
                Aus: die App plant sofort um und begründet es nur.
              </span>
            </span>
          </label>

          <div className="mt-4">
            <Field
              label="Suchfenster in Tagen"
              hint="Wie weit die App nach vorne schauen darf, um einen Ersatztag zu finden."
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={21}
                value={settings.rescheduleWindowDays}
                onChange={(e) =>
                  void db.settings.update('singleton', {
                    rescheduleWindowDays: Math.max(1, Math.min(21, Number(e.target.value) || 7)),
                    updatedAt: now(),
                  })
                }
                className={`${inputClass} w-24 tabular`}
              />
            </Field>
          </div>
        </Card>
      </Section>

      <Section
        title="Schichtarten"
        hint="Was an welcher Schichtart trainierbar ist. Diese Einstufung steuert die gesamte Planung — hier lohnt es sich, ehrlich zu sein."
      >
        <div className="space-y-2">
          {ctx.shiftTypes.map((t) => (
            <Card key={t.id}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="flex size-6 items-center justify-center rounded text-xs font-bold text-void"
                  style={{ backgroundColor: t.color }}
                >
                  {t.short}
                </span>
                <span className="font-medium text-ink">{t.name}</span>
                <span className="text-xs text-ink-faint tabular">
                  {t.startTime && t.endTime ? `${t.startTime}–${t.endTime}` : 'ganzer Tag'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Kapazität">
                  <select
                    value={t.capacity}
                    onChange={(e) =>
                      void db.shiftTypes.update(t.id, {
                        capacity: e.target.value as TrainingCapacity,
                      })
                    }
                    className={inputClass}
                  >
                    {CAPACITIES.map((c) => (
                      <option key={c} value={c}>
                        {CAPACITY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Zeitfenster">
                  <input
                    value={t.trainingWindow ?? ''}
                    onChange={(e) =>
                      void db.shiftTypes.update(t.id, { trainingWindow: e.target.value || null })
                    }
                    className={inputClass}
                    placeholder="z.B. ab 15:00"
                  />
                </Field>
              </div>

              {t.note ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-faint">{t.note}</p>
              ) : null}
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
