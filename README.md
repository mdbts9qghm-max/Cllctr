# Cllctr

Persönliches Betriebssystem als Hybrid-Athlet: Trainingsplanung, Alltag und Fortschritt
in einer App. Der Name steht für *Soul Collector* — jeder erreichte Meilenstein ist eine
Seele, die eingesammelt wird.

**Alle Daten bleiben auf dem Gerät.** Kein Konto, kein Server, keine Telemetrie.
Speicherort ist IndexedDB im Browser; die einzige Sicherung ist der JSON-Export unter
*Daten*.

Datenmodell, Architekturentscheidungen und der Stand der Phasen stehen in
[`PROJECT.md`](./PROJECT.md).

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # statischer Export nach out/
npm run typecheck
```

## Deployment auf Vercel

Das Projekt ist ein reiner statischer Export (`output: 'export'` in
`next.config.mjs`) — es läuft ohne Server-Laufzeit.

1. Auf [vercel.com](https://vercel.com) anmelden und **Add New → Project** wählen.
2. Dieses GitHub-Repository importieren.
3. Vercel erkennt Next.js selbst. Die Voreinstellungen passen:
   - Framework Preset: **Next.js**
   - Build Command: `npm run build`
   - Output Directory: leer lassen
   - Environment Variables: **keine** — die App braucht keine.
4. **Deploy** drücken.

Jeder Push auf den Branch löst ein neues Deployment aus.

### Nach dem ersten Deployment

Die Seite auf dem iPhone in **Safari** öffnen, Teilen-Symbol antippen und *Zum
Home-Bildschirm* wählen. Erst dann startet Cllctr ohne Browser-Leisten und funktioniert
offline. Dieselbe Anleitung steht in der App unter *Einstellungen*.

## Aufbau

```
src/
  app/            Screens: Heute, Plan, Aufgaben, Statistik, Seelen, Schicht, Setup, Daten
  components/     Rahmen, Bausteine, Diagramme
  lib/
    types.ts      Datenmodell — die einzige Wahrheit über die Struktur
    db.ts         Dexie-Schema (IndexedDB)
    shifts.ts     Schichtrotation → Trainingskapazität je Tag
    planner.ts    Generator: Wochenziele → Einheiten auf konkrete Tage
    replan.ts     Adaptives Umplanen bei verpassten Einheiten
    explain.ts    Begründungen für den Heute-Screen
    tasks.ts      Energiebudget des Tages, Wiederholungen
    stats.ts      Auswertung und Deload-Erkennung
    pr.ts         Bestwert-Erkennung
    souls.ts      Der Seelen-Katalog
    backup.ts     Export und Import
public/
  sw.js           Service Worker (Offline-Fähigkeit)
  manifest.json   PWA-Manifest
```

## Sicherung

Der Browser kann seinen Speicher jederzeit leeren — dann sind alle Daten weg. Unter
*Daten* lässt sich der komplette Stand als JSON exportieren und wieder einspielen
(*Ersetzen* stellt den Stand der Datei her, *Zusammenführen* behält Vorhandenes).
Regelmäßig machen.
