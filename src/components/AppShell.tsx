'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { today } from '@/lib/dates';
import { useSettings, useShiftContext } from '@/lib/hooks';
import { planFingerprint } from '@/lib/planner';
import { syncPlan } from '@/lib/plan-store';
import { seedIfEmpty } from '@/lib/seed';
import { seedWayIfEmpty } from '@/lib/way-store';
import { syncSouls } from '@/lib/soul-store';

/**
 * Die fünf Screens, die im Alltag zählen. Schicht, Setup und Daten hängen
 * hinter dem Zahnrad — sie werden selten geöffnet, und acht Einträge in einer
 * Leiste sind auf einem Telefon nicht mehr lesbar.
 */
const TABS = [
  { href: '/', label: 'Heute', icon: IconToday },
  { href: '/plan', label: 'Plan', icon: IconPlan },
  { href: '/aufgaben', label: 'Aufgaben', icon: IconTasks },
  { href: '/statistik', label: 'Statistik', icon: IconStats },
  { href: '/seelen', label: 'Seelen', icon: IconSoul },
];

function IconToday({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" strokeWidth="1.6" stroke="currentColor">
      <circle cx="10" cy="10" r="7" />
      {active ? <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

function IconPlan({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" strokeWidth="1.6" stroke="currentColor">
      <rect x="3" y="4.5" width="14" height="12" rx="2" />
      <path d="M3 8h14M7 3v3M13 3v3" />
      {active ? <rect x="6" y="10.5" width="4" height="3" rx="1" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

function IconTasks({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" strokeWidth="1.6" stroke="currentColor">
      <rect x="3.5" y="3.5" width="13" height="13" rx="3" />
      {active ? <path d="M6.8 10.2l2.3 2.3 4.1-4.6" strokeWidth="2" strokeLinecap="round" /> : null}
    </svg>
  );
}

function IconStats({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" strokeWidth="1.6" stroke="currentColor" strokeLinecap="round">
      <path d="M3 16.5h14" />
      <path d={active ? 'M6 12v3M10 6.5v8.5M14 9.5v5.5' : 'M6 12.5v2.5M10 8.5v6.5M14 11v4'} strokeWidth="2.2" />
    </svg>
  );
}

function IconSoul({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" strokeWidth="1.6" stroke="currentColor">
      <path d="M10 3l7 7-7 7-7-7z" strokeLinejoin="round" />
      {active ? <path d="M10 6.8L13.2 10 10 13.2 6.8 10z" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

/**
 * Rahmen um alle Screens. Sorgt außerdem dafür, dass die lokale Datenbank beim
 * ersten Öffnen angelegt wird, dass fällige Seelen ankommen und dass der
 * Service Worker registriert ist.
 */
/**
 * Vergleichbarer Pfad.
 *
 * Beim Vorrendern heißt die Seite `/plan`, beim direkten Aufruf der
 * exportierten Datei `/plan.html`. Ohne Angleichung wäre der aktive Reiter
 * unterschiedlich und React bricht die Hydration mit einem Fehler ab.
 */
function normalizePath(pathname: string): string {
  return pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = normalizePath(usePathname());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);

  const ctx = useShiftContext();
  const settings = useSettings();

  /**
   * Der Fingerabdruck der Planungsgrundlage, rein lesend.
   *
   * Bewusst getrennt vom Anpassen: ein Schreibzugriff in einem laufenden
   * LiveQuery lässt die Seite abstürzen. Hier wird nur beobachtet, gehandelt
   * wird im Effekt darunter.
   */
  const fingerprint = useLiveQuery(async () => {
    if (!ctx || !settings) return undefined;
    const macro = (await db.macrocycles.toArray()).find((m) => m.active);
    if (!macro) return null;
    return planFingerprint(ctx, settings, today());
  }, [ctx, settings]);

  useEffect(() => {
    seedIfEmpty()
      .then(() => seedWayIfEmpty())
      .then(() => setReady(true))
      // Seelen können auch ohne Zutun fällig werden — etwa wenn eine Woche zu
      // Ende ging, während die App zu war. Einmal pro Start nachrechnen.
      .then(() => syncSouls())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /**
   * Hat sich an Schichten, Rotation oder Zielen etwas geändert, zieht der Plan
   * nach. Läuft nur, wenn der Fingerabdruck sich tatsächlich bewegt hat — sonst
   * würde jede Navigation den Plan neu bauen.
   */
  useEffect(() => {
    if (!ready || !ctx || !settings || !fingerprint) return;
    let cancelled = false;
    syncPlan(ctx, settings)
      .then((result) => {
        if (cancelled || !result) return;
        setPlanNotice(
          result.changed === 0
            ? 'Plan an deine Schichten angepasst — es blieb alles, wie es war.'
            : `Plan angepasst: an ${result.changed} ${
                result.changed === 1 ? 'Tag' : 'Tagen'
              } liegt jetzt etwas anderes.`,
        );
        void syncSouls();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [ready, fingerprint, ctx, settings]);

  useEffect(() => {
    // Offline-Fähigkeit: ohne die Hülle im Cache nützen die lokalen Daten nichts.
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  const settingsActive = ['/setup', '/schicht', '/daten'].includes(pathname);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      {/* Der Statusleisten-Stil "black-translucent" lässt den Inhalt unter die
          Uhr und die Batterieanzeige laufen. Ohne diesen Abstand klebt die
          Überschrift dort fest. */}
      <header className="relative z-20 flex items-center justify-between border-b border-line bg-void px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <Link href="/" className="text-lg font-semibold tracking-[0.2em] text-ink">
          CLLCTR
        </Link>
        <Link
          href="/setup"
          aria-label="Einstellungen"
          className={`rounded p-1.5 transition-colors ${
            settingsActive ? 'text-ember' : 'text-ink-faint hover:text-ink-muted'
          }`}
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" strokeWidth="1.6" stroke="currentColor">
            <circle cx="10" cy="10" r="2.8" />
            <path d="M10 2.2v1.6M10 16.2v1.6M17.8 10h-1.6M3.8 10H2.2M15.5 4.5l-1.1 1.1M5.6 14.4l-1.1 1.1M15.5 15.5l-1.1-1.1M5.6 5.6L4.5 4.5" strokeLinecap="round" />
          </svg>
        </Link>
      </header>

      {/* Platz unten für die Leiste plus die Home-Anzeige des iPhones. */}
      <main className="flex-1 px-5 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {error ? (
          <p className="rounded border border-danger/40 bg-danger/10 p-4 text-sm text-ink">
            Die lokale Datenbank konnte nicht geöffnet werden: {error}
          </p>
        ) : ready ? (
          <>
            {planNotice ? (
              <div className="mb-6 rounded-lg border border-ember-dim bg-ember/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <p className="flex-1 text-sm leading-relaxed text-ink">{planNotice}</p>
                  <button
                    onClick={() => setPlanNotice(null)}
                    aria-label="Hinweis schließen"
                    className="-mr-1 -mt-1 px-2 py-1 text-ink-faint hover:text-ink"
                  >
                    ×
                  </button>
                </div>
              </div>
            ) : null}
            {children}
          </>
        ) : (
          <p className="text-sm text-ink-faint">Lade lokale Daten …</p>
        )}
      </main>

      {/* Deckend statt durchscheinend: backdrop-blur auf einem fixierten Element
          kostet auf dem Telefon Leistung und lässt den Inhalt durchschimmern. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-void pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-2xl">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors ${
                  active ? 'text-ember' : 'text-ink-faint hover:text-ink-muted'
                }`}
              >
                <Icon active={active} />
                <span className="w-full truncate text-center">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
