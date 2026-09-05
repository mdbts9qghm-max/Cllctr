'use client';

/**
 * Der Rahmen: Kopfzeile, Reiterleiste, Startvorgang.
 *
 * Fünf Reiter statt sieben. *Home* und *Today* aus der Anforderung beschreiben
 * denselben Bildschirm — zwei Reiter dafür hätten den Nutzer bei jedem Start
 * vor die Wahl gestellt, welcher gemeint ist. *Profil* ist kein Reiter, sondern
 * das Zahnrad: Man öffnet es selten, und ein seltener Reiter kostet Daumenweg
 * für die täglichen.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { seedIfEmpty } from '@/lib/seed';
import { useSettings } from '@/lib/hooks';

const TABS = [
  { href: '/', label: 'Heute', icon: IconToday },
  { href: '/training', label: 'Training', icon: IconTraining },
  { href: '/habits', label: 'Habits', icon: IconHabits },
  { href: '/tasks', label: 'Tasks', icon: IconTasks },
  { href: '/analyse', label: 'Analyse', icon: IconAnalytics },
];

/** Der statische Export liefert `/training.html` — der Pfad muss zurückgerechnet werden. */
function normalize(pathname: string): string {
  return pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = normalize(usePathname());
  const settings = useSettings();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seedIfEmpty()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /* Theme auf das Wurzelelement schreiben — CSS erledigt den Rest. */
  useEffect(() => {
    const root = document.documentElement;
    if (!settings || settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline-Fähigkeit ist eine Zugabe. Scheitert die Registrierung — etwa
      // im privaten Modus —, funktioniert die App trotzdem.
    });
  }, []);

  const inProfile = pathname.startsWith('/profil') || pathname.startsWith('/coach');

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-void/90 px-4 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-[13px] font-bold tracking-[0.22em] text-ink">CLLCTR</span>
          <span className="hidden text-[11px] text-ink-faint sm:inline">Hybrid Athlete OS</span>
        </Link>
        <Link
          href="/profil"
          aria-label="Profil und Einstellungen"
          aria-current={inProfile ? 'page' : undefined}
          className={`rounded-lg p-2 transition-colors ${
            inProfile ? 'text-[color:var(--color-accent)]' : 'text-ink-faint hover:text-ink'
          }`}
        >
          <IconGear />
        </Link>
      </header>

      <main className="flex-1 px-4 pb-28 pt-5">
        {error ? (
          <div className="rounded-lg border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 p-3 text-sm text-ink">
            Die Datenbank ließ sich nicht öffnen: {error}
          </div>
        ) : ready ? (
          children
        ) : (
          <p className="text-sm text-ink-faint">Lade …</p>
        )}
      </main>

      <nav
        aria-label="Hauptnavigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-void/95 backdrop-blur"
      >
        <div className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] text-[10px] font-medium transition-colors ${
                  active ? 'text-[color:var(--color-accent)]' : 'text-ink-faint'
                }`}
              >
                <Icon active={active} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Symbole — als Pfade statt Emoji: nur so sehen sie überall gleich aus. */
/* ------------------------------------------------------------------ */

const svg = 'size-[22px]';

function IconToday({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="8.5" />
      {active ? <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

function IconTraining({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 15.5 8 6l3.5 7L14 9l3.5 6.5" />
      {active ? <circle cx="19.5" cy="7" r="2" fill="currentColor" stroke="none" /> : null}
      <path d="M3 19.5h18" />
    </svg>
  );
}

function IconHabits({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9.5 16.5 4.5 11.5" />
      {active ? <path d="M20 12.5 9.5 23 4.5 18" opacity=".45" /> : null}
    </svg>
  );
}

function IconTasks({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <path d="M9 7h11M9 12h11M9 17h7" />
      <path d="M4 7h.01M4 12h.01M4 17h.01" strokeWidth={active ? '3.2' : '2.2'} />
    </svg>
  );
}

function IconAnalytics({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <path d="M4 20h16" />
      <path
        d={active ? 'M7 15v3M12 8v10M17 12v6' : 'M7 16v2M12 10v8M17 13v5'}
        strokeWidth="2.6"
      />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
