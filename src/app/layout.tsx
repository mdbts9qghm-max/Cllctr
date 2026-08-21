import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Cllctr',
  description: 'Trainingsplanung, Alltag und Fortschritt — lokal auf deinem Gerät.',
  manifest: '/manifest.json',
  applicationName: 'Cllctr',
  // Damit die App vom Homescreen ohne Safari-Leisten startet und die
  // Statusleiste zum dunklen Hintergrund passt.
  appleWebApp: {
    capable: true,
    title: 'Cllctr',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
  other: {
    // Next setzt nur das moderne `mobile-web-app-capable`. Ältere iOS-Versionen
    // starten ohne die apple-Variante weiterhin mit Safari-Leisten.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
  width: 'device-width',
  initialScale: 1,
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
