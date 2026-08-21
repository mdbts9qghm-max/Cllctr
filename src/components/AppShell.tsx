'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { seedIfEmpty } from '@/lib/seed';

const NAV = [
  { href: '/', label: 'Heute' },
  { href: '/plan', label: 'Plan' },
  { href: '/aufgaben', label: 'Aufgaben' },
  { href: '/statistik', label: 'Statistik' },
  { href: '/schicht', label: 'Schicht' },
  { href: '/setup', label: 'Setup' },
  { href: '/daten', label: 'Daten' },
];

/**
 * Rahmen um alle Screens. Sorgt außerdem dafür, dass die lokale Datenbank
 * beim ersten Oeffnen angelegt und befüllt wird.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seedIfEmpty()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="flex items-baseline justify-between border-b border-line px-5 pb-4 pt-6">
        <Link href="/" className="text-lg font-semibold tracking-[0.2em] text-ink">
          CLLCTR
        </Link>
        <span className="text-[11px] uppercase tracking-widest text-ink-faint">Phase 5</span>
      </header>

      {/* Sechs Einträge passen nicht nebeneinander auf ein Telefon — deshalb
          kompakt und horizontal scrollbar, mit ausgeblendeter Scrollleiste. */}
      <nav className="flex gap-0.5 overflow-x-auto border-b border-line px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors ${
                active
                  ? 'bg-surface-2 text-ember'
                  : 'text-ink-muted hover:bg-surface hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="flex-1 px-5 py-6">
        {error ? (
          <p className="rounded border border-danger/40 bg-danger/10 p-4 text-sm text-ink">
            Die lokale Datenbank konnte nicht geöffnet werden: {error}
          </p>
        ) : ready ? (
          children
        ) : (
          <p className="text-sm text-ink-faint">Lade lokale Daten …</p>
        )}
      </main>

      <footer className="border-t border-line px-5 py-4 text-[11px] leading-relaxed text-ink-faint">
        Alle Daten liegen ausschließlich auf diesem Gerät. Kein Konto, kein Server.
      </footer>
    </div>
  );
}
