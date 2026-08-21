# Cllctr — Projektdokumentation

Persönliches Betriebssystem als Hybrid-Athlet: Trainingsplanung, Alltags-Tasks und
Fortschritt in einer App. Der Name steht für *Soul Collector* — jeder erreichte
Meilenstein ist eine Seele, die eingesammelt wird.

**Kernversprechen:** Die App nimmt das Nachdenken ab. Sie sagt, was heute dran ist,
und plant selbstständig um, wenn etwas ausfällt.

---

## Nutzerkontext

Diese Entscheidungen prägen das gesamte Datenmodell. Ändern sie sich, ändert sich die App.

| | |
|---|---|
| Disziplinen | Laufen + Krafttraining |
| Ziel | Kein festes Event, ganzjährig Form halten |
| Volumen | 5–6 Einheiten/Woche (3× Kraft, 2× Laufen, 1× optional) |
| Kraft-Struktur | Ober-/Unterkörper-Split |
| Intensität | RPE + selbst berechnete Herzfrequenz-Zonen |
| Umplanen | Vorschlag zeigen, Nutzer bestätigt |
| **Arbeitszeit** | **12-Stunden-Schichten in Rotation** |

### Der Schichtplan ist die wichtigste Randbedingung

| Schichtart | Zeit | Kapazität | Begründung |
|---|---|---|---|
| Tagschicht | 07:00–19:00 | `light` | 12 h Arbeit, danach höchstens kurz und locker |
| Nachtschicht | 19:00–07:00 | `light` | Vormittags Zeit, aber nichts, was den Schlaf davor frisst |
| Schlaftag | Schlaf 08:00–14:00 | `moderate` | Ab ca. 15:00 normales Volumen, keine Key-Session |
| Freischicht | ganzer Tag | `full` | Hier liegen die harten Einheiten |
| V-Schicht | 08:00–20:00 | `light` | Wie Tagschicht |

---

## Die zentrale Architekturentscheidung

**Cllctr plant auf Kapazität, nicht auf Wochentage.**

Normale Trainings-Apps verteilen Sessions auf feste Wochentage („Dienstag Intervalle").
Bei rotierenden 12-Stunden-Schichten ist der Wochentag bedeutungslos — der Dienstag ist
mal frei, mal Nachtschicht.

Deshalb:

1. Für jeden Kalendertag leitet die App aus der Rotation eine **Trainingskapazität** ab
   (`none` / `light` / `moderate` / `full`).
2. Jeder Session-Typ hat eine **Mindestkapazität** (`SESSION_TYPES` in `src/lib/types.ts`).
   Ein Long Run braucht `full`, ein Recovery Run kommt mit `light` aus.
3. Der Generator platziert die Wochenziele auf die Tage, die sie tragen können.

Folge: `WeeklyTargets` sind **Anzahl Einheiten pro Woche**, nie Wochentage.

### Kapazitätsstufen

| Stufe | Bedeutung | Erlaubte Session-Typen |
|---|---|---|
| `none` | Kein Training | — |
| `light` | Kurz und locker, ≤ 45 min | Recovery Run, Mobility |
| `moderate` | Normales Volumen, keine Key-Session | + Lockerer Lauf, Kraft Oberkörper, Kraft Ganzkörper |
| `full` | Alles möglich | + Intervalle, Tempolauf, Long Run, Kraft Unterkörper |

---

## Tech-Stack

- **Next.js 15 (App Router) + TypeScript + Tailwind CSS 4**
- **`output: 'export'`** — rein statisch, kein Server, kein Backend
- **Dexie.js über IndexedDB** — alle Daten ausschließlich lokal im Browser
- Kein Login, keine API-Keys, keine Telemetrie
- Deployment: GitHub → Vercel

Bewusst *keine* Datumsbibliothek: gerechnet wird ausschließlich mit lokalen
Kalendertagen als `"YYYY-MM-DD"`-Strings (`src/lib/dates.ts`). Das vermeidet die
klassischen Zeitzonen-Verschiebungen um einen Tag, die bei Nachtschichten besonders
teuer wären.

---

## Datenmodell

Vollständig in `src/lib/types.ts`, Dexie-Schema in `src/lib/db.ts`.

### Schicht
- `ShiftType` — Schichtart mit Zeiten, Farbe und **Kapazität**
- `ShiftPattern` — Rotation: Folge von Schichtart-Ids + `anchorDate`, wiederholt sich endlos
- `ShiftOverride` — einzelner abweichender Tag (Tausch, Urlaub, krank); Primärschlüssel ist das Datum
- `ResolvedShiftDay` — Ergebnis der Auflösung, inkl. `afterNightShift`

Auflösung (`src/lib/shifts.ts`): Abweichung schlägt Rotation schlägt Fallback „frei".

### Training
- `Macrocycle` → `Mesocycle` → `Microcycle` → `Session`
- `Session` trägt `isKey`, `load`, `locked`, `originalDate`, `rescheduleReason`
  — alles, was der Umplaner braucht
- `SessionLog` — was tatsächlich passiert ist: RPE, Dauer, Distanz, HF, Gefühl, Notiz

### Fortschritt
- `Exercise`, `SetEntry`, `PersonalRecord` — Basis der automatischen PR-Erkennung

### Alltag
- `Task` mit `energy` (`light` / `focus` / `hard`) und `Recurrence`

### Soul Collector
- `Soul` mit `rarity`, `sourceKind`, `collectedAt`

### Einstellungen
- `Settings` (genau ein Datensatz, `id: 'singleton'`), `AppMeta` als Schlüssel-Wert-Ablage

---

## Sicherung

Lokale Daten sind weg, sobald der Browser-Speicher geleert wird. Export/Import ist
deshalb bereits in Phase 1 gebaut, nicht am Ende.

- `buildBackup()` / `downloadBackup()` — vollständiger Abzug als JSON
- `parseBackup()` — validiert **vor** jedem Schreibvorgang; bricht bei fremdem Format
  oder neuerer `schemaVersion` ab
- `applyBackup(backup, mode)` — `replace` (exakter Stand der Datei) oder `merge`
  (gleiche Ids überschreiben), komplett in einer Transaktion

`SCHEMA_VERSION` in `src/lib/types.ts` bei jeder Modelländerung hochzählen.

---

## Stand der Phasen

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Setup, Datenmodell, IndexedDB, Schichtauflösung, Export/Import | **fertig** |
| 2 | Trainingsplanung: Generator + adaptives Umplanen | offen |
| 3 | Heute-Screen | offen |
| 4 | Tasks | offen |
| 5 | Statistiken (`recharts`) | offen |
| 6 | Soul Collector Layer | offen |
| 7 | PWA, Polish, Deployment | offen |

### Phase 1 — geliefert

- Projekt-Setup, statischer Export, dunkles Design-System (eine Akzentfarbe: Bernstein `#e0a43c`)
- Vollständiges Datenmodell für alle sieben Phasen
- Dexie-Schema mit 15 Tabellen und passenden Indizes
- Schichtauflösung inkl. Rotation, Abweichungen, Erkennung des Tags nach der Nachtschicht
- Machbarkeits-Prüfung: vergleicht Wochenziele mit dem, was die Rotation hergibt
- Export/Import als JSON mit Validierung, Zurücksetzen
- Screens: Heute (Platzhalter), Schicht, Setup, Daten

### Offene Punkte für Phase 2

1. **Die Wochenziele passen aktuell nicht in die Platzhalter-Rotation.** Sie liefert
   2 volle + 1 halben Tag pro Woche; 3× Kraft + 2× Laufen bräuchten mehr. Sobald die
   echte Rotation eingetragen ist, zeigt der Screen „Schicht" die reale Lage.
   Falls es auch dann nicht passt, sind die Wochenziele zu senken oder eine Schichtart
   höher einzustufen.
2. Generator: Wochenziele → konkrete Sessions auf konkrete Tage.
3. Umplaner: Key-Sessions verschieben, Filler streichen, zwei harte Tage nie
   hintereinander, Begründung ausgeben.
4. Deload-Erkennung über `Microcycle.plannedLoad` und RPE-Verlauf.

---

## Entwicklung

```
npm install
npm run dev        # http://localhost:3000
npm run build      # statischer Export nach out/
npm run typecheck
```
