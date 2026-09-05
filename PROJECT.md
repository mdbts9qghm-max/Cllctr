# Cllctr — Hybrid Athlete OS

Persönliche App für Training, Alltag und Entwicklung eines Hybrid-Athleten im
12-Stunden-Schichtdienst. Kein Tracker, der dokumentiert, was war — ein System,
das jeden Morgen die eine Frage beantwortet:

> **Was ist heute die sinnvollste Entscheidung, um langfristig ein
> leistungsfähiger Hybrid-Athlet zu werden, ohne Regeneration und
> Alltagstauglichkeit zu zerstören?**

---

## 1 Produktidee in drei Sätzen

Die App kennt drei Dinge, die sonst nirgends zusammenkommen: **den Dienstplan**,
**den Erholungszustand** und **die Trainingshistorie**. Aus ihnen leitet sie
täglich eine begründete Empfehlung ab — mit Alternativen und mit dem, was heute
ausdrücklich nicht sinnvoll wäre.

Daneben laufen Habits und Aufgaben, weil ein Trainingsplan im Schichtdienst
scheitert, wenn der Alltag nicht trägt. Alles zusammen ergibt einen
**Hybrid Score**, der jederzeit erklärt, woraus er entstanden ist.

---

## 2 Ausgangslage

| | |
|---|---|
| Alter / Größe | 24, 184–185 cm |
| Gewicht | 70–80 kg |
| Trainingszeit | 10–12 h/Woche, realistisch 4–5 Tage |
| Ziel kurzfristig | Ausdauer + Kraft + Athletik gleichzeitig |
| Ziel langfristig | 100 km Ultra, dabei Kraft halten/aufbauen |
| Zone-2-Pace | 6:20 min/km |
| 5 km | ~25:00 |
| FTP | 161 W |
| Schwimmen | 2:00 min/100 m |
| Pull-ups / Push-ups | 6 / 30 |
| Hardware | Garmin FR 265, Polar H10, WHOOP, Elite Direto XRT |

**Schichten** (12 h, wiederkehrend):

| Schicht | Zeit | Training |
|---|---|---|
| Tagschicht | 07:00–19:00 | kein echtes Training, max. 20 min Mobility |
| Nachtschicht | 19:00–07:00 | vor der Schicht, Schlaf 14:00–17:00 |
| Schlaftag | nach der Nacht, Schlaf 08:00–14:00 | Regeneration, nichts Hartes |
| Freischicht | frei | lange und harte Einheiten, auch zwei |
| V-Schicht | 08:00–20:00 | höchstens kurz |

---

## 3 Getroffene Annahmen

Wo Angaben fehlten, wurde entschieden statt gefragt:

1. **Max-HF 196** (220 − 24) als Startwert, Ruhe-HF 50 — beides in den
   Einstellungen änderbar. Die HF-Zonen entstehen daraus nach
   Herzfrequenzreserve und lassen sich einzeln überschreiben.
2. **Wochenziel 8 h** statt 10–12 h als Startwert. 10–12 h sind das Dach, nicht
   der Alltag; ein Ziel, das man in Schichtwochen systematisch verfehlt, taugt
   nicht als Maßstab. Änderbar, und pro Trainingsphase überschreibbar.
3. **Startphase BASE über 12 Wochen** — vom Leistungsstand her die richtige
   Antwort auf ein Ultra-Ziel. Phasen sind frei konfigurierbar.
4. **Kein Zieldatum für den Ultra** hinterlegt, weil keins genannt wurde. Sobald
   eins steht, richtet die Periodisierung sich danach.
5. **Der Coach ist regelbasiert**, kein Sprachmodell: Die App hat keinen Server
   und keine API-Schlüssel. Er beantwortet eine feste Menge Fragen aus echten
   Daten — und sagt das auch.

---

## 4 Tech Stack und warum

| Entscheidung | Grund |
|---|---|
| **Next.js 15, App Router, `output: 'export'`** | Rein statische Auslieferung: kein Server, keine laufenden Kosten, deploybar auf jeden Static Host. Gleichzeitig ein ausgewachsenes Router- und Build-System statt einer selbstgebauten SPA. |
| **TypeScript, strict** | Das Datenmodell ist der Kern dieser App. Ein Feld, das mal fehlt, fällt hier beim Kompilieren auf statt nachts um drei auf dem Telefon. |
| **Tailwind CSS 4** | Design-Tokens als CSS-Variablen, Dark/Light ohne zweites Stylesheet, kein Klassen-Framework, das man später wieder herausoperiert. |
| **Dexie 4 auf IndexedDB** | Die Daten liegen auf dem Gerät. Kein Login, kein Konto, keine Übertragung. IndexedDB ist der einzige Browser-Speicher, der Jahre an Trainingsdaten und Abfragen darüber trägt; Dexie macht ihn benutzbar und liefert mit `liveQuery` reaktive Abfragen. |
| **Recharts** | Für die Analyse. Deklarativ, gut dokumentiert, responsive — und klein genug, dass es nur auf der Analyse-Seite geladen wird. |
| **PWA (Manifest + Service Worker)** | Auf dem Homescreen läuft die App ohne Browserleisten und ohne Empfang. Genau der Fall im Schichtdienst. |

**Was bewusst nicht gewählt wurde:** kein React Native (eine PWA reicht für den
Anwendungsfall und läuft auch auf iPad und Desktop), keine Datenbank in der
Cloud (siehe unten), kein State-Management-Framework — der Zustand *ist* die
Datenbank, und `useLiveQuery` reicht als Bindeglied.

### Vorbereitet für später

Die Integrationen (Garmin, WHOOP, Polar, Apple Health, Kalender) brauchen OAuth
und damit einen Server. Sie sind **nicht** implementiert, aber das Datenmodell
ist darauf ausgelegt: Jede importierbare Entität trägt `source` und
`externalId`, und `TrainingSession` trennt **geplant** von **tatsächlich** — ein
Import füllt die Ist-Werte, ohne den Plan zu überschreiben.

---

## 5 Architektur

```
src/lib/      reine Logik, ohne React — testbar, ohne Browser lauffähig
  types.ts      das gesamte Datenmodell an einer Stelle
  db.ts         Dexie-Schema
  dates.ts      Kalenderarithmetik auf lokalen Tagen (nie UTC-Zeitstempel)
  shifts.ts     Dienstplan auflösen, Schichtregeln anwenden
  load.ts       Belastung: Session-Load, Wochenlast, akut/chronisch, Rampe
  recovery.ts   Erholung aus Check-in: READY / MODERATE / RECOVERY
  engine.ts     die Tagesempfehlung samt Begründung und Alternativen
  phases.ts     Periodisierung
  habits.ts     Zeitplan, Erfüllung, Serien
  tasks.ts      Fälligkeit, Wiederholung, Sortierung
  score.ts      Hybrid Score, transparent
  records.ts    Bestwerte erkennen
  review.ts     Wochenrückblick
  coach.ts      regelbasierte Antworten auf feste Fragen
  store.ts      alle Schreibzugriffe, in Transaktionen
  backup.ts     Export/Import JSON, Export CSV

src/components/  wiederverwendbare Bausteine
src/app/         Screens
```

**Regel, die alles zusammenhält:** `src/lib` kennt React nicht und schreibt nie
aus einer laufenden Abfrage heraus. Dexies `liveQuery` stürzt ab, wenn in ihr
geschrieben wird — Lesen und Schreiben sind deshalb strikt getrennt: Komponenten
lesen über `useLiveQuery`, Schreibvorgänge laufen über `store.ts` aus Effekten
und Event-Handlern.

---

## 6 Navigation

Fünf Reiter, nicht sieben. *Home* und *Today* aus der Anforderung beschreiben
denselben Bildschirm — zwei Reiter dafür hätten den Nutzer bei jedem Start vor
die Wahl gestellt, welcher der beiden gemeint ist. *Profile* ist kein Reiter,
sondern das Zahnrad oben rechts: Man öffnet es selten, und ein Reiter, den man
selten braucht, kostet Daumenweg für die, die man täglich braucht.

```
Heute · Training · Habits · Tasks · Analyse        ⚙ → Profil
```

Unter Profil: Stammdaten, Schichten und Schichtregeln, Trainingsphasen, Ziele,
Coach, Daten (Export/Import/Zurücksetzen).

---

## 7 Datenmodell

Alle Entitäten aus der Anforderung, zusammengefasst wo sie dasselbe meinten:

| Entität | Zweck |
|---|---|
| `Profile` | Stammdaten, Leistungswerte, HF-Zonen (Singleton) |
| `Settings` | Darstellung, Wochenziele, Benachrichtigungen (Singleton) |
| `ShiftType` | Art einer Schicht **samt Regel**, wie viel Training sie erlaubt |
| `ShiftAssignment` | Welche Schicht an welchem Tag |
| `ShiftPattern` | Optionale Rotation zum Vorbelegen |
| `TrainingPhase` | BASE / BUILD / PEAK / TAPER mit Zeitraum und Wochenziel |
| `TrainingSession` | Eine Einheit, geplant **und** tatsächlich |
| `Exercise`, `StrengthSet` | Krafttraining im Detail |
| `Habit`, `HabitEntry` | Gewohnheiten und ihre Tageswerte |
| `Task` | Aufgaben |
| `Goal` | Langfristige Ziele mit Fortschritt |
| `DailyCheckIn` | Schlaf, Erholung, Befinden — die Eingabe des Morgens |
| `WeeklyReview` | Wochenrückblick mit Momentaufnahme der Zahlen |
| `PersonalRecord` | Erkannte Bestwerte |
| `Meta` | Kleinkram (Seed-Marken, letzter Export) |

`TrainingSession` trägt Soll und Ist nebeneinander: `plannedMinutes` /
`actualMinutes`, `plannedDistanceKm` / `actualDistanceKm`. Das ist die
Voraussetzung dafür, dass Plan und Wirklichkeit später verglichen werden können
— und dafür, dass ein Garmin-Import die Ist-Seite füllt, ohne den Plan
anzufassen.

---

## 8 Trainingslogik

### Belastung

`load = Minuten × Intensitätsfaktor` (locker 1,0 · moderat 1,7 · hart 2,5),
Kraft mit eigenem Faktor. Bewusst einfach: Ein Modell, das niemand nachrechnen
kann, wird nicht geglaubt und deshalb nicht befolgt.

Daraus: **Wochenlast**, **akute Last** (7 Tage), **chronische Last** (28 Tage)
und die **Rampe** — wie stark die laufende Woche über dem Schnitt der letzten
vier liegt. Über +25 % warnt die App.

### Erholung

Eingabe morgens: Schlafdauer, Schlafqualität, Muskelkater, Stress, optional
WHOOP-Recovery, Ruhepuls und HRV. Daraus **READY / MODERATE / RECOVERY**.

Liegt eine WHOOP-Recovery vor, gewinnt sie: Sie verrechnet HRV, Ruhepuls, Schlaf
und Atemfrequenz bereits — sie mit schwächeren Signalen zu überstimmen, wäre
schlechter. Ohne sie entscheidet ein Punktestand aus den übrigen Angaben, HRV
und Ruhepuls **gegen die eigene Basislinie** der letzten drei Wochen, nicht gegen
einen Lehrbuchwert.

### Schichtregeln

Pro Schichtart hinterlegt und **im Profil änderbar**: die höchste Intensität je
Erholungsstufe, das Zeitfenster, die erlaubten Sportarten. Der Generator liest
diese Tabelle, er kennt keine fest eingebauten Schichtnamen.

### Die Empfehlung

Vier Schritte, in dieser Reihenfolge:

1. **Erholung** setzt die Obergrenze.
2. **Schicht** setzt die Obergrenze und das Zeitfenster.
3. **Belastung**: harte Tage in Folge, harte Einheiten der Woche, Rampe.
4. **Bedarf**: Was der Woche gegenüber Phase und Zielen noch fehlt — Stunden,
   Sportarten, lange Einheit, Kraft.

Ergebnis: eine Empfehlung, ein bis zwei Alternativen und was heute ausdrücklich
nicht sinnvoll ist — jeweils mit Begründung in ganzen Sätzen.

### Hybrid Score

Sechs Teilwerte 0–100, gewichtet: Endurance 25, Strength 20, Consistency 20,
Recovery 15, Habits 15, Mobility 5. Jeder Teilwert nennt seine Eingangsgrößen,
sodass die Frage „warum heute 78?" beantwortbar ist.

### Serien ohne Bestrafung

Eine Serie reißt nicht an einem Tag, an dem Ruhe richtig war: geplanter Ruhetag,
Tagschicht, Erholungsstatus RECOVERY oder ein Habit, der an Ruhetagen ausgesetzt
ist. Streaks sollen Verhalten belohnen, nicht Anwesenheit.

---

## 9 Was nicht gebaut wurde

Ehrlich benannt statt als Knopf angedeutet:

- **Externe Integrationen** — brauchen einen Server. Datenmodell vorbereitet.
- **Push-Benachrichtigungen** — iOS liefert sie für PWAs nur eingeschränkt und
  nur mit Server. Stattdessen: ein Benachrichtigungsbereich **in** der App, der
  dieselben Hinweise erzeugt, sichtbar beim Öffnen.
- **Cloud-Sync** — bewusst nicht. Der Export ist die Sicherung.
