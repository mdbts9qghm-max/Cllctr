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
| Intensität | RPE + eigene Herzfrequenz-Zonen (Ruhe-HF 49, max. HF 205) |
| Umplanen | Vorschlag zeigen, Nutzer bestätigt |
| **Arbeitszeit** | **12-Stunden-Schichten in Rotation** |

### Der Schichtplan ist die wichtigste Randbedingung

| Schichtart | Zeit | Kapazität | Begründung |
|---|---|---|---|
| Tagschicht | 07:00–19:00 | `light` | 12 h Arbeit, danach höchstens kurz und locker |
| Nachtschicht | 19:00–07:00 | `light` | Vormittags Zeit, aber nichts, was den Schlaf davor frisst |
| Schlaftag | Schlaf 08:00–14:00 | `moderate` | Ab ca. 15:00 normales Volumen, keine Key-Session |
| Freischicht | ganzer Tag | `full` | Hier liegen die harten Einheiten |
| V-Schicht | 08:00–20:00 | `light` | Kommt kurzfristig vor einer Tagschicht — **nicht** Teil der Rotation, wird als Abweichung gesetzt |

**Rotation:** `Tagschicht → Nachtschicht → Schlaftag → frei → frei` (5 Tage)

**Herzfrequenz-Zonen** (Herzfrequenzreserve, selbst berechnet):

| Zone | Bereich |
|---|---|
| 1 Regeneration | 114–138 |
| 2 Grundlage | 139–160 |
| 3 Tempo | 161–175 |
| 4 Schwelle | 176–190 |
| 5 Maximal | 191–205 |

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

### Die Rotation läuft quer zur Kalenderwoche

Die Rotation ist 5 Tage lang, die Woche 7. Beide decken sich erst nach 35 Tagen wieder.
Konkret heißt das: eine Kalenderwoche enthält **2, 3 oder 4 freie Tage** — im Schnitt 2,8.

Ein starres Wochenprogramm kann es deshalb nicht geben. Und weil pro 5-Tage-Zyklus nur
**zwei volle Tage** zur Verfügung stehen, konkurrieren dort drei Session-Typen um Platz
(Intervalle, Long Run, Kraft Unterkörper — alle brauchen `full`). Der Generator muss sie
über mehrere Zyklen rotieren lassen, statt sie jede Woche unterbringen zu wollen.

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
- Machbarkeits-Prüfung mit drei Urteilen (`fits` / `tight` / `impossible`): vergleicht
  Wochenziele mit dem, was die Rotation an Tageskapazität hergibt, und weist die
  Schwankung der freien Tage je Woche aus
- Export/Import als JSON mit Validierung, Zurücksetzen
- Screens: Heute (Platzhalter), Schicht, Setup, Daten

### Befund der Machbarkeits-Prüfung

Mit der echten Rotation und den Zielen 3× Kraft, 2× Laufen, 1× optional:

| | |
|---|---|
| Volle Tage pro Woche | 2,8 im Schnitt, schwankend zwischen 2 und 4 |
| Normale Tage (Schlaftag) | 1,4 |
| Lockere Tage (Tag-/Nachtschicht) | 2,8 |
| Urteil | **knapp** — in schwachen Wochen fehlt ein harter Tag |

Das ist lösbar, aber nur über mehrere Zyklen hinweg: pro 5-Tage-Zyklus passen zwei
Key-Sessions auf die freien Tage, Kraft Oberkörper auf den Schlaftag, ein Recovery-Lauf
auf die Tagschicht. Welche zwei der drei harten Einheiten die freien Tage bekommen,
muss der Generator rotieren.

### Offene Punkte für Phase 2

1. **Offene Entscheidung:** Ist der Planungszyklus die Kalenderwoche (Mo–So) oder der
   5-Tage-Rotationszyklus? Betrifft `Microcycle` und die gesamte Fortschrittsanzeige.
2. Generator: Wochenziele → konkrete Sessions auf konkrete Tage, mit Rotation der
   Key-Sessions über die knappen vollen Tage.
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
