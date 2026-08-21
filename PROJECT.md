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
| Planungsprofil | Laufen hat Vorrang (umschaltbar im Setup) |
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
| 2 | Trainingsplanung: Generator + adaptives Umplanen | **fertig** |
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

Der Generator löst das über mehrere Zyklen hinweg. Tatsächlich erzeugtes Volumen:
**3,0× Kraft und 3,0× Laufen pro Woche** — beide Ziele erreicht.

---

## Phase 2 — Generator und Umplaner

### Planungstakt: Rotationszyklus, angezeigt in Wochen

Ein **Mikrozyklus ist ein Durchlauf der Schichtrotation** (5 Tage), keine Kalenderwoche.
Nur so ist jeder Zyklus gleich aufgebaut. Ein Mesozyklus besteht aus 4 Belastungs- und
1 Deload-Zyklus (25 Tage, konfigurierbar).

Die Wochenziele sind auf 7 Tage bezogen, ein Zyklus dauert 5. Der Generator führt deshalb
einen **Übertrag** zwischen den Zyklen mit: mal kommen 2, mal 3 Krafteinheiten in den
Zyklus — im Schnitt genau 3 pro Woche. Ohne Übertrag würde jedes Mal abgerundet und das
Volumen dauerhaft zu niedrig ausfallen.

### Der Engpass: zwei volle Tage, drei harte Einheiten

Pro Zyklus lassen nur zwei Tage volle Belastung zu, aber Intervalle, Long Run und Kraft
Unterkörper wollen alle dorthin. Das **Planungsprofil** entscheidet:

| Profil | Wirkung |
|---|---|
| `runFirst` | Laufen bekommt die freien Tage zuerst und darf beim Umplanen Kraft verdrängen |
| `strengthFirst` | umgekehrt |
| `balanced` | wechselt je Zyklus; beim Umplanen verdrängt niemand jemanden |

Dazu kommt `allowStrengthOnLightDays`: eine kurze Krafteinheit (35 Min) an Schichttagen.
**Ohne diese Option sinkt das Kraftvolumen von 3,1 auf 1,5 Einheiten pro Woche** — die
Rotation gibt sonst nicht mehr her.

### Platzierung in zwei Durchgängen

1. **Best-Fit** — unter den möglichen Tagen gewinnt der mit der *niedrigsten* ausreichenden
   Kapazität, damit volle Tage für das frei bleiben, was sie wirklich braucht. Sortiert wird
   zuerst nach Kapazitätsanspruch, dann nach Profil: sonst belegt ein lockerer Lauf den
   einzigen Schlaftag, bevor die Krafteinheit überhaupt geprüft wird.
2. **Aufwerten** — musste ein Wunsch auf einen Ersatztyp ausweichen und ist danach doch ein
   besserer Tag frei geblieben, zieht die Session dorthin um und bekommt ihre volle Form
   zurück. Ohne diesen Durchgang läge eine abgespeckte Einheit am 12-Stunden-Tag, während
   der freie Tag ungenutzt bleibt.

### Belastungsregeln

- **Hart ist nur Laufen.** `countsAsHardDay` ist bewusst von `load` getrennt: Krafttraining
  ist anstrengend, blockiert den Folgetag aber nicht wie eine harte Laufeinheit. Nur
  Intervalle, Tempolauf und Long Run zählen.
- **Nie zwei harte Tage in Folge.** Weil Gym nicht zählt, lassen sich die beiden
  nebeneinanderliegenden freien Tage trotzdem beide nutzen: einer bekommt den harten Lauf,
  der andere Gym.
- **Dieselbe Einheit nie an zwei aufeinanderfolgenden Tagen** — dieselbe Muskulatur bekäme
  sonst keine 24 Stunden Erholung. Die Prüfung läuft über Zyklusgrenzen hinweg: der letzte
  Tag des vorherigen Zyklus wird als eingefrorener Kontext-Slot mitgeführt.
- **Eine Einheit pro Tag** — Ausnahme ist der Doppeltag.

### Doppeltag

Höchstens **einer pro Zyklus**, nur an einem Tag voller Kapazität, immer **eine Lauf- und
eine Krafteinheit**, Laufen zuerst (mit frischen Beinen läuft es sich besser). Nie zweimal
dieselbe Disziplin, nie im Deload.

Bewusst ein Ausweg, kein Normalfall: Der Generator greift erst im dritten Durchgang darauf
zu — für Einheiten, die sonst ganz ausfallen oder in verkürzter Form feststecken würden.
Abschaltbar über `allowDoubleDayPerCycle`.

### Adaptives Umplanen (`replan.ts`)

Bei einer verpassten Einheit, in dieser Reihenfolge:

1. Filler (Recovery, lockeres Volumen, Mobility) fallen ersatzlos weg.
2. Key-Sessions suchen einen Ersatztag mit genug Kapazität.
3. Lockere Einheiten am Zieltag weichen.
4. **Doppeltag** — passt die Einheit als zweite an einen freien Tag mit einer Einheit der
   anderen Disziplin, geht nichts verloren. Kommt vor dem Verdrängen, weil es billiger ist.
5. Ist kein Tag frei, greift das **Planungsprofil**: eine Laufeinheit darf eine Krafteinheit
   verdrängen, aber nie umgekehrt. Die verdrängte Einheit sucht sich selbst einen neuen Tag
   (eine Kaskadenstufe, danach entfällt sie).
6. Erst dann die **reduzierte Form** — ein Long Run wird zum lockeren Dauerlauf. Kleiner ist
   besser als gar nicht.
7. Bleibt alles erfolglos, entfällt die Einheit — mit Begründung, welche Tage im Weg standen.

Fixierte Einheiten (`locked`) fasst der Umplaner nie an. Jeder Vorschlag wird erklärt und
erst nach Bestätigung angewendet.

### Geprüft

Automatisierte Durchläufe (nicht im Repo, in der Sitzung ausgeführt):

- Generator über 3 Startdaten × 3 Profile: keine Regelverletzung, Doppeltage immer
  Kraft + Laufen, nie mehr als zwei Einheiten pro Tag
- 40 aufeinanderfolgende Umplanungen: alle Regeln halten
- Ende-zu-Ende gegen den statischen Export: Plan erzeugen, Einheit verpassen, Vorschlag
  übernehmen, Doppeltag in Plan- und Heute-Screen

### Offene Punkte

1. **Deload-Erkennung** über RPE-Verlauf und `plannedLoad` ist noch nicht gebaut — bisher
   ist der Deload nur fest im Zyklusraster. Kommt mit den Logs in Phase 5.
2. Sessions lassen sich noch nicht frei bearbeiten (Typ, Dauer, Inhalt), nur fixieren,
   abhaken, verpassen.
3. Vereinzelt findet eine Einheit in einem Zyklus keinen Tag. Der Plan-Screen meldet das,
   still verschluckt wird es nicht.

---

## Entwicklung

```
npm install
npm run dev        # http://localhost:3000
npm run build      # statischer Export nach out/
npm run typecheck
```
