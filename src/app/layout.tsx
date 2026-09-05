import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Cllctr — Hybrid Athlete OS',
  description:
    'Training, Habits und Alltag für Hybrid-Athleten im Schichtdienst. Alle Daten bleiben auf dem Gerät.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Cllctr' },
};

export const viewport: Viewport = {
  themeColor: '#08090c',
  width: 'device-width',
  initialScale: 1,
  // Kein maximumScale: Zoom zu verbieten sperrt Menschen aus, die ihn brauchen.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
