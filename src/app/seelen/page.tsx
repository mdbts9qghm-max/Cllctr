'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { formatShort } from '@/lib/dates';
import { getSoulsInReach } from '@/lib/soul-store';
import { RARITY_ORDER, SOUL_CATALOG } from '@/lib/souls';
import { RARITY_LABEL, type Soul, type SoulRarity } from '@/lib/types';
import { Section } from '@/components/ui';

/**
 * Seltenheit über eine einzige Akzentfarbe abgestuft, nicht über einen
 * Regenbogen. Ein Artefakt-Inventar, kein Belohnungsheft.
 */
const RARITY_STYLE: Record<SoulRarity, { border: string; mark: string; glow: string }> = {
  legendary: {
    border: 'border-ember',
    mark: 'text-ember',
    glow: 'shadow-[0_0_24px_-6px_rgba(224,164,60,0.45)]',
  },
  rare: { border: 'border-ember-dim', mark: 'text-ember-dim', glow: '' },
  common: { border: 'border-line-strong', mark: 'text-ink-faint', glow: '' },
};

const RARITY_MARK: Record<SoulRarity, string> = {
  legendary: '◆',
  rare: '◈',
  common: '◇',
};

export default function SeelenPage() {
  const souls = useLiveQuery(() => db.souls.toArray(), []);
  const inReach = useLiveQuery(() => getSoulsInReach(6), []);

  if (!souls || !inReach) return <p className="text-sm text-ink-faint">Lade …</p>;

  const collectedKeys = new Set(souls.map((s) => s.key));
  const byRarity = (r: SoulRarity) => souls.filter((s) => s.rarity === r).length;

  const reachByKey = new Map(inReach.map((p) => [p.definition.key, p]));

  /**
   * Mehrfach eingesammelte Seelen werden zu einem Eintrag zusammengefasst.
   * Vier gleichnamige Karten untereinander sehen aus wie ein Fehler und
   * entwerten das, was sie eigentlich feiern.
   */
  const grouped = [...souls]
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .reduce<Array<{ newest: Soul; count: number; details: string[] }>>((acc, soul) => {
      const existing = acc.find((g) => g.newest.key === soul.key);
      if (existing) {
        existing.count += 1;
        if (soul.detail) existing.details.push(soul.detail);
        return acc;
      }
      acc.push({ newest: soul, count: 1, details: soul.detail ? [soul.detail] : [] });
      return acc;
    }, [])
    .sort(
      (a, b) =>
        RARITY_ORDER[a.newest.rarity] - RARITY_ORDER[b.newest.rarity] ||
        b.newest.collectedAt.localeCompare(a.newest.collectedAt),
    );

  const openDefinitions = SOUL_CATALOG.filter((d) => !collectedKeys.has(d.key)).sort(
    (a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity],
  );

  return (
    <>
      <section className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Soul Vault
        </p>
        {/* Die große Zahl ist der Besitz, nicht der Fortschritt — deshalb die
            Gesamtzahl der Seelen, und die Vollständigkeit erst darunter. */}
        <p className="mt-2 text-4xl font-semibold text-ink tabular">{souls.length}</p>
        <p className="mt-1 text-xs text-ink-faint tabular">
          {collectedKeys.size} von {SOUL_CATALOG.length} Arten
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          {(['legendary', 'rare', 'common'] as SoulRarity[]).map((r) => (
            <span key={r} className="flex items-center gap-1.5 text-xs text-ink-muted tabular">
              <span className={RARITY_STYLE[r].mark}>{RARITY_MARK[r]}</span>
              {byRarity(r)} {RARITY_LABEL[r]}
            </span>
          ))}
        </div>
      </section>

      {grouped.length > 0 ? (
        <Section title="Eingesammelt">
          <div className="space-y-2">
            {grouped.map(({ newest, count, details }) => {
              const style = RARITY_STYLE[newest.rarity];
              return (
                <article
                  key={newest.key}
                  className={`rounded-lg border bg-surface p-4 ${style.border} ${style.glow}`}
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className={`text-sm ${style.mark}`}>{RARITY_MARK[newest.rarity]}</span>
                    <h3 className="flex-1 font-medium text-ink">
                      {newest.name}
                      {count > 1 ? (
                        <span className={`ml-2 text-xs tabular ${style.mark}`}>×{count}</span>
                      ) : null}
                    </h3>
                    <span className="shrink-0 text-[11px] text-ink-faint tabular">
                      {formatShort(newest.collectedAt.slice(0, 10))}
                    </span>
                  </div>
                  <p className="mb-2 text-sm leading-relaxed text-ink-muted">{newest.description}</p>
                  {details.length > 0 ? (
                    <div className="border-t border-line pt-2">
                      {details.slice(0, 3).map((detail, i) => (
                        <p key={i} className="text-xs text-ink-faint">
                          {detail}
                        </p>
                      ))}
                      {details.length > 3 ? (
                        <p className="text-xs text-ink-faint">
                          und {details.length - 3} weitere
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Section>
      ) : (
        <Section title="Noch leer">
          <p className="rounded border border-line bg-surface p-4 text-sm leading-relaxed text-ink-muted">
            Die erste Seele kommt mit der ersten protokollierten Einheit. Danach sammelt sich das
            hier von selbst — du musst nichts freischalten, nur trainieren.
          </p>
        </Section>
      )}

      {openDefinitions.length > 0 ? (
        <Section
          title="Noch offen"
          hint="Bewusst sichtbar: Man jagt leichter, was man kennt."
        >
          <div className="space-y-2">
            {openDefinitions.map((definition) => {
              const progress = reachByKey.get(definition.key);
              return (
                <article
                  key={definition.key}
                  className="rounded-lg border border-dashed border-line bg-surface/40 p-4"
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-sm text-ink-faint">{RARITY_MARK[definition.rarity]}</span>
                    <h3 className="flex-1 text-ink-muted">{definition.name}</h3>
                    <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-faint">
                      {RARITY_LABEL[definition.rarity]}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-ink-faint">{definition.description}</p>

                  {progress ? (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] text-ink-faint tabular">
                        <span>
                          {progress.current} von {progress.target} {progress.unit}
                        </span>
                        <span>{Math.round(progress.ratio * 100)} %</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-ember-dim"
                          style={{ width: `${Math.min(100, progress.ratio * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Section>
      ) : null}
    </>
  );
}
