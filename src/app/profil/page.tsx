'use client';

/**
 * Profil: Stammdaten, Leistungswerte, Wochenziele, Darstellung.
 *
 * Alles, was die Engine benutzt, muss hier änderbar sein — sonst müsste man für
 * ein neues Gewicht den Code anfassen.
 */

import Link from 'next/link';
import { formatClock, num } from '@/lib/dates';
import { useProfile, useSettings } from '@/lib/hooks';
import { updateProfile, updateSettings } from '@/lib/store';
import { SPORT_LABEL, type Sport, type ThemeChoice } from '@/lib/types';
import { Button, Card, Field, Loading, Section, Segmented, inputClass } from '@/components/ui';

const LINKS = [
  { href: '/profil/schichten', title: 'Schichten und Regeln', hint: 'Dienstplan, Schichtarten, was jede erlaubt' },
  { href: '/profil/phasen', title: 'Trainingsphasen', hint: 'Base, Build, Peak, Taper' },
  { href: '/profil/ziele', title: 'Ziele', hint: 'Langfristige Ziele und Fortschritt' },
  { href: '/coach', title: 'Coach', hint: 'Fragen zu deinen Daten' },
  { href: '/profil/daten', title: 'Daten', hint: 'Export, Import, Zurücksetzen' },
];

export default function ProfilPage() {
  const profile = useProfile();
  const settings = useSettings();
  if (!profile || !settings) return <Loading />;

  const numberField = (
    label: string,
    value: number | null,
    onChange: (v: number | null) => void,
    step = '1',
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`${inputClass} tabular`}
      />
    </Field>
  );

  return (
    <>
      <Section title="Bereiche">
        <div className="space-y-2">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              <Card className="transition-colors hover:border-line-strong">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{l.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-faint">{l.hint}</p>
                  </div>
                  <span className="shrink-0 text-ink-faint">›</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Körper">
        <Card>
          <div className="grid grid-cols-2 gap-4">
            {numberField('Größe (cm)', profile.heightCm, (v) => void updateProfile({ heightCm: v }))}
            {numberField('Gewicht (kg)', profile.weightKg, (v) => void updateProfile({ weightKg: v }), '0.1')}
            {numberField('Ruhepuls', profile.restingHr, (v) => void updateProfile({ restingHr: v }))}
            {numberField('Maximalpuls', profile.maxHr, (v) => void updateProfile({ maxHr: v }))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Ruhe- und Maximalpuls bestimmen die Zonen. Änderst du einen davon, rechnet die App
            alle fünf neu — eine Zone, die nicht mehr zu dir gehört, wäre schlimmer als keine.
          </p>
        </Card>
      </Section>

      <Section title="Herzfrequenzzonen">
        <Card>
          <div className="space-y-1.5">
            {profile.hrZones.map((z) => (
              <div key={z.zone} className="flex items-baseline gap-3">
                <span className="w-6 shrink-0 text-sm font-medium tabular text-ink">Z{z.zone}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{z.label}</span>
                <span className="shrink-0 text-sm tabular text-ink">
                  {z.minBpm}–{z.maxBpm}
                  <span className="ml-1 text-[11px] text-ink-faint">bpm</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Leistungswerte" hint="Die App vergleicht Fortschritt dagegen.">
        <Card>
          <div className="grid grid-cols-2 gap-4">
            {numberField(
              'Zone-2-Pace (s/km)',
              profile.zone2PaceSec,
              (v) => void updateProfile({ zone2PaceSec: v }),
              '1',
              profile.zone2PaceSec ? formatClock(profile.zone2PaceSec) + ' /km' : undefined,
            )}
            {numberField(
              '5 km (s)',
              profile.best5kSec,
              (v) => void updateProfile({ best5kSec: v }),
              '1',
              profile.best5kSec ? formatClock(profile.best5kSec) : undefined,
            )}
            {numberField('FTP (W)', profile.ftpWatts, (v) => void updateProfile({ ftpWatts: v }))}
            {numberField(
              'Schwimmen (s/100 m)',
              profile.swimPace100Sec,
              (v) => void updateProfile({ swimPace100Sec: v }),
              '1',
              profile.swimPace100Sec ? formatClock(profile.swimPace100Sec) + ' /100 m' : undefined,
            )}
            {numberField('Pull-ups', profile.pullUps, (v) => void updateProfile({ pullUps: v }))}
            {numberField('Push-ups', profile.pushUps, (v) => void updateProfile({ pushUps: v }))}
          </div>
        </Card>
      </Section>

      <Section title="Wochenziele">
        <Card>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stunden pro Woche">
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                value={settings.weeklyMinutesTarget / 60}
                onChange={(e) =>
                  void updateSettings({
                    weeklyMinutesTarget: Math.round(Number(e.target.value) * 60),
                  })
                }
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Trainingstage">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={7}
                value={settings.weeklyDaysTarget}
                onChange={(e) => void updateSettings({ weeklyDaysTarget: Number(e.target.value) })}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Harte Einheiten max.">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={5}
                value={settings.maxHardPerWeek}
                onChange={(e) => void updateSettings({ maxHardPerWeek: Number(e.target.value) })}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Harte Tage in Folge max.">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={3}
                value={settings.maxConsecutiveHardDays}
                onChange={(e) =>
                  void updateSettings({ maxConsecutiveHardDays: Number(e.target.value) })
                }
                className={`${inputClass} tabular`}
              />
            </Field>
          </div>

          <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Verteilung der Wochenminuten
          </p>
          <div className="mt-2 space-y-2">
            {(Object.keys(SPORT_LABEL) as Sport[])
              .filter((s) => s !== 'recovery' && s !== 'hike')
              .map((sport) => (
                <div key={sport} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-ink-muted">{SPORT_LABEL[sport]}</span>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={settings.sportMix[sport] ?? 0}
                    onChange={(e) =>
                      void updateSettings({
                        sportMix: { ...settings.sportMix, [sport]: Number(e.target.value) },
                      })
                    }
                    className="flex-1 accent-[color:var(--color-accent)]"
                  />
                  <span className="w-10 shrink-0 text-right text-xs tabular text-ink">
                    {settings.sportMix[sport] ?? 0} %
                  </span>
                </div>
              ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">
            Summe {Object.values(settings.sportMix).reduce((a, b) => a + (b ?? 0), 0)} %. Muss nicht
            exakt 100 ergeben — die Werte sagen, was der Woche am meisten fehlt, nicht was sie
            ausfüllt.
          </p>
        </Card>
      </Section>

      <Section title="Darstellung">
        <Card>
          <Segmented
            value={settings.theme}
            onChange={(theme: ThemeChoice) => void updateSettings({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dunkel' },
              { value: 'light', label: 'Hell' },
            ]}
          />
        </Card>
      </Section>

      <Section title="Auf den Homescreen">
        <Card tone="quiet">
          <ol className="ml-4 list-decimal space-y-1 text-sm leading-relaxed text-ink-muted">
            <li>In Safari öffnen — andere Browser bieten die Funktion auf iOS nicht an.</li>
            <li>Teilen antippen, dann <span className="text-ink">Zum Home-Bildschirm</span>.</li>
            <li>Ab dann startet Cllctr wie eine App und läuft auch ohne Empfang.</li>
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Die Daten liegen nur in diesem Browser. Löschst du seine Website-Daten, sind sie weg —
            deshalb regelmäßig unter Daten exportieren.
          </p>
        </Card>
      </Section>
    </>
  );
}
