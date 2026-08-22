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
| Tagschicht | 07:00–19:00 | `none` | 12 h Arbeit — danach ist nichts mehr drin |
| Nachtschicht | 19:00–07:00 | `moderate` | Der Vormittag vor der Schicht ist frei: normales Volumen inklusive Kraft |
| Schlaftag | Schlaf 08:00–14:00 | `moderate` | Ab ca. 15:00 normales Volumen, keine Key-Session |
| Freischicht | ganzer Tag | `full` | Hier liegen die harten Einheiten |
| V-Schicht | 08:00–20:00 | `light` | Laufen geht **während** der Schicht, ins Gym kommt man dabei nicht. Nicht Teil der Rotation — wird als Abweichung gesetzt |

Die V-Schicht bleibt trainierbar, aber nur laufend: `allowStrengthOnLightDays` steht
deshalb auf **aus**. Weil sie inzwischen die einzige Schichtart mit lockerer Kapazität ist,
wirkt diese eine Einstellung genau dort — der Generator schlägt an einem V-Tag einen
Recovery Run vor, nie eine Krafteinheit, und der Umplaner schiebt auch keine dorthin.

Nach der Tagschicht ist kein Training mehr vorgesehen. Damit liefert die Rotation pro
Woche 2,8 volle und 2,8 halbe Tage; das Urteil bleibt **passt**, das erzeugte Volumen
2,9× Kraft und 3,0× Laufen. Die kurze Krafteinheit (`strength_short`) taucht im
Standardplan dadurch nicht mehr auf — sie greift nur noch, wenn eine Schichtart mit
`light` im Spiel ist, etwa die V-Schicht.

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
| `light` | Kurz und locker, ≤ 45 min | Recovery Run, Kraft kurz, Mobility |
| `moderate` | Halber Tag frei | + Lockerer Lauf, Kraft Ober- und Unterkörper, Ganzkörper |
| `full` | Ganzer Tag frei | + Intervalle, Tempolauf, Long Run |

Krafttraining braucht keinen ganzen Tag: schwere Beinarbeit passt an den Schlaftag ab 15:00
ebenso wie an den Vormittag vor der Nachtschicht. Nur die harten Laufeinheiten brauchen
wirklich einen freien Tag. Das entzerrt den Plan deutlich — Doppeltage fielen dadurch von
fünf auf einen pro Planungszeitraum.

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
| 3 | Heute-Screen | **fertig** |
| 4 | Tasks | **fertig** |
| 5 | Statistiken (`recharts`) | **fertig** |
| 6 | Soul Collector Layer | **fertig** |
| 7 | PWA, Polish, Deployment | **fertig** |

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

Seit Krafttraining auch an halben Tagen möglich ist, lautet das Urteil **passt**: Jede Woche
bringt mindestens 2 volle Tage, gebraucht werden 2 für die harten Laufeinheiten. Tatsächlich
erzeugtes Volumen: **3,0× Kraft und 3,0× Laufen pro Woche**.

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

## Phase 3 — Heute-Screen

Der Startbildschirm und die Antwort auf „nimm mir das Nachdenken ab". Aufbau in der
Reihenfolge, in der die Fragen morgens auftauchen:

1. **Heute** — Schicht, Kapazität, die Einheit(en) mit vollem Inhalt
2. **Warum heute** — die Begründung, siehe unten
3. **Heute sinnvoll** — Aufgaben, Platzhalter bis Phase 4
4. **Stand im Block** — Zyklus X von Y, erledigt/geplant, Deload-Countdown
5. **Als Nächstes** — die kommenden vier Tage in einer Zeile pro Tag
6. **Seelen in Reichweite** — Platzhalter bis Phase 6

### Die Begründung ist das eigentliche Feature (`explain.ts`)

Eine App, die nur sagt *was* ansteht, muss man glauben. Eine, die sagt *warum*, kann man
nachvollziehen. `explainSession` leitet den Satz aus dem ab, was der Generator ohnehin
entschieden hat — Schichtkapazität, Position im Zyklus, Nachbartage:

> „Intervalle braucht einen ganzen Tag. Heute ist Freischicht — der nächste Tag, der das
> hergibt, wäre erst Di, 25. Aug."
>
> *Doppeltag: dazu kommt Kraft Unterkörper. Laufen zuerst, Kraft danach — mit frischen
> Beinen läuft es sich besser.*
> *Morgen ist Tagschicht — die gute Gelegenheit ist heute.*

Rangfolge: Eine Umplanung erklärt sich selbst und schlägt alles andere. Sonst zählt der
Engpass — je knapper der Tag, desto mehr sagt er darüber aus, warum genau hier trainiert
wird. Zusatzhinweise entstehen aus Deload, Nachtschicht, Doppeltag, dem Vortag und dem
Folgetag.

Ruhetage bekommen ebenfalls eine Begründung. Sind die Einheiten des Tages verpasst oder
gestrichen, sagt die App das auch so — statt zu behaupten, der Zyklus sei planmäßig voll.
Dazu der Satz, der den Ton der App trägt: *„Ein ausgefallener Tag bricht nichts."*

### Protokoll beim Abhaken

„Erledigt" öffnet direkt ein kurzes Protokoll: RPE über eine 1–10-Skala, Dauer, Distanz,
Gefühl, Notiz. Bewusst zusammen — ein „erledigt" ohne RPE verliert die Information, aus der
in Phase 5 die Statistiken und die Deload-Erkennung entstehen. Pro Einheit gibt es höchstens
einen Eintrag, erneutes Abhaken aktualisiert ihn.

Verpasste Einheiten lösen den Umplanungs-Vorschlag direkt auf dem Heute-Screen aus — ohne
Umweg über den Plan.

### Geprüft

Ende-zu-Ende gegen den statischen Export: Plan erzeugen, Begründung prüfen, abhaken,
Protokoll speichern und in IndexedDB nachweisen, verpassen, Vorschlag übernehmen,
Ruhetag-Ansicht. Keine Konsolenfehler.

---

## Phase 4 — Aufgaben und Termine

### Haushalt und Termine sind nicht dasselbe

`TaskKind` unterscheidet beides, und der Unterschied ist nicht kosmetisch:

- **Termin** — liegt fest, hat eine Uhrzeit, wird **immer** angezeigt, egal wie der Tag
  aussieht. Ein Zahnarzttermin verhandelt nicht mit dem Trainingsplan.
- **Haushalt** — verschiebbar, hat einen Energiebedarf, wird nur vorgeschlagen, wenn der
  Tag ihn trägt.

### Das Energiebudget des Tages (`tasks.ts`)

Der Punkt, an dem sich Cllctr von einer normalen To-do-App unterscheidet. Grundlage ist
dieselbe Kapazitätsskala wie beim Training, weil sie dasselbe misst: **wie viel von diesem
Tag dir gehört.**

| Schicht | Erlaubt |
|---|---|
| Freischicht | leicht, fokussiert, anstrengend |
| Schlaftag, Nachtschicht | leicht, fokussiert |
| Tag-, V-Schicht | nur leicht |

Danach zieht das Training ab: Ab einer Tageslast von 8 — eine harte Laufeinheit oder
schwere Beinarbeit — fällt die oberste Stufe weg. Diese Schwelle liegt bewusst **niedriger**
als die Härte-Regel des Planers: Für die Trainingsplanung ist Krafttraining kein harter
Tag, für den Haushalt danach sehr wohl. Wer 65 Minuten Kniebeugen hinter sich hat, fängt
keinen Großputz mehr an.

Aufgaben, die der Tag nicht hergibt, tauchen gar nicht erst auf. Sie als „heute vielleicht"
anzuzeigen wäre genau das Nachdenken, das die App abnehmen soll — stattdessen steht darunter
eine Zeile, wie viele auf einen Tag mit mehr Luft warten.

Sortierung der Vorschläge: überfällig vor fällig vor irgendwann, dann Priorität, dann die
kleinere Aufgabe zuerst — sie ist eher erledigt.

### Wiederholungen

Beim Abhaken entsteht sofort die nächste Instanz, verknüpft über `templateTaskId`. Die
erledigte bleibt als Verlauf stehen, sonst wäre nach einem Jahr nicht nachvollziehbar, wie
oft etwas tatsächlich gemacht wurde. Monatliche Termine werden auf den Monatsletzten
begrenzt, damit der 31. Januar nicht in den 3. März rutscht.

### Vier Routinen ab Werk

Damit die Liste nicht leer beginnt, legt die App vier tägliche Routinen selbst an:
Supplements, 3 Liter trinken, Proteinziel, Mobility 10 Minuten. Bewusst nur Kleinigkeiten,
die ohnehin jeden Tag anstehen und nichts kosten außer daran zu denken.

Angelegt werden sie **nicht** über „Tabelle leer", sondern über eine eigene Markierung in
`meta` (`seed.dailyRoutines.v1`). Das hat zwei Gründe: Eine Installation, in der schon
Aufgaben liegen, bekommt sie einmalig nachgereicht — und wer eine davon löscht, bekommt sie
nicht beim nächsten Start wieder.

### Tägliche Routinen sind keine Vorschläge

Aufgaben mit täglicher Wiederholung laufen bewusst an der Vorschlagslogik vorbei und stehen
in einem eigenen Abschnitt — auf dem Heute-Screen wie im Aufgaben-Screen. Zwei Gründe:

1. Sie würden sonst **jeden Tag alle drei Vorschlagsplätze belegen**, und einmalige
   Aufgaben kämen nie durch.
2. Sie würden an einem knappen Tag **stillschweigend verschwinden** — obwohl man sie sich
   täglich vorgenommen hat. Ob es heute wirklich passt, ist deine Entscheidung; die App
   hält den Vorsatz nur sichtbar.

Deshalb gilt für sie auch das Etikett „heute nicht drin" nicht — es wäre ein Widerspruch zu
dem, was der Heute-Screen zeigt. Wöchentliche und monatliche Aufgaben bleiben normale
Vorschläge und erscheinen an ihrem Fälligkeitstag.

### Geprüft

- Wiederholungslogik: täglich, mehrtägig, wöchentlich mit Wochentag, monatlich,
  Monatsende (31.01. → 28.02., im Schaltjahr → 29.02.), Jahreswechsel
- Energiebudget über alle Schichtarten, mit und ohne Training
- Vorschläge: Überfälliges zuerst, Termine getrennt, nicht fällige ausgeschlossen
- Ende-zu-Ende: anlegen, abhaken, Folgeinstanz in IndexedDB nachgewiesen, neuer Termin
  erscheint nicht sofort wieder als Vorschlag

---

## Phase 5 — Auswertung und Bestwerte

### Kein Diagramm ohne Aussage

Drei Diagramme, jedes beantwortet genau eine Frage, die man sich als Athlet
wirklich stellt:

| Darstellung | Frage |
|---|---|
| **Wochenvolumen** (gestapelte Balken) | Halte ich das Volumen konstant, oder schwankt es mit der Schicht? |
| **Intensitätsverteilung** (Balken je Zone) | Polarisiert — viel locker, wenig hart — oder versandet alles im Mitteltempo? |
| **Anstrengung gegen Plan** (Linie + Bezugslinie) | Fühlt es sich härter an, als es sein sollte? |

Darüber vier Kennzahlen-Kacheln (durchgezogen, Minuten diese Woche, Ø RPE,
Abweichung zum Plan). Für einen einzelnen Wert ist eine Kachel ehrlicher als ein
Balkendiagramm mit einem Balken.

Ohne Protokolle zeigt der Screen einen Leerzustand statt leerer Achsen.

### Farben sind gerechnet, nicht gewählt

Alle Serienfarben wurden gegen die Diagrammfläche (`#131316`) geprüft:

- **Disziplinen** — Blau `#3987e5` / Orange `#d95926`: Kontrast ≥ 3:1, Abstand
  bei Farbfehlsichtigkeit ΔE 26.8 (Schwelle 8), Normalsicht ΔE 31.8.
- **Zonen** — einhuige Rampe `#184f95` → `#b7d3f6`, monoton in der Helligkeit,
  Stufenabstände ≥ 0.06, helles Ende 2.29:1 gegen die Fläche.
- Der **Bernstein-Akzent der App fällt für Serienfarben durch das
  Helligkeitsband** (L 0.758 statt 0.48–0.67) und bleibt deshalb der Oberfläche
  vorbehalten — mit einer Ausnahme: als einzelne hervorgehobene Linie im
  RPE-Verlauf, wo er gegen Grau steht und nicht gegen eine zweite Serie.

Legende bei jeder Mehrserien-Darstellung, Tabellenansicht als Rückfallebene,
Tooltips auf allen Diagrammen — Identität hängt nie allein an der Farbe.

### Deload-Erkennung

Drei unabhängige Signale, bewusst zurückhaltend gewichtet:

1. Drei oder mehr Einheiten in Folge als schlecht bewertet.
2. Die letzten Einheiten waren im Schnitt ≥ 1.5 RPE-Punkte härter als geplant.
3. Das Wochenvolumen ist in drei Wochen um ≥ 40 % gestiegen.

Ein Signal ist eine **Beobachtung**, zwei sind eine **Empfehlung**. Eine App, die
bei jeder schlechten Einheit Alarm schlägt, wird ignoriert.

### Bestwerte

Beim Abhaken lassen sich Sätze bzw. Zeiten eintragen; die Übungsauswahl ist nach
Disziplin gefiltert (bei Kraft die Kraftübungen, beim Laufen die Distanzen). Die
Erkennung läuft automatisch:

- **Gewicht** — bestes Einzelgewicht *und* geschätztes 1RM nach Epley, damit auch
  mehr Wiederholungen bei weniger Gewicht als Fortschritt zählen (über 10 Wdh.
  wird die Formel unzuverlässig, dort greift sie nicht).
- **Wiederholungen / Distanz** — mehr ist besser.
- **Zeit** — weniger ist besser. Die Richtung hängt an der Übung
  (`higherIsBetter`), nicht an der Kennzahl.

Neue Bestwerte werden direkt nach dem Speichern gemeldet.

### Protokollieren geht überall

Ursprünglich nur auf dem Heute-Screen — bei Schichtarbeit zu eng, weil man nach
einer Nachtschicht selten am selben Tag dazu kommt. Das Formular ist deshalb eine
eigene Komponente (`SessionLogForm`) und im Plan genauso verfügbar.

### Geprüft

- Wochenvolumen, Zonenverteilung, Kennzahlen, RPE-Verlauf gegen synthetische Daten
- Deload-Erkennung: ruhiger Verlauf, drei schlechte Bewertungen, RPE über Plan,
  beides gleichzeitig
- Zukünftige Einheiten zählen nicht in die Completion-Rate
- Ende-zu-Ende: Kniebeuge 120 kg × 5 → Bestwert 120 kg und 1RM 140 kg; 5 km in
  22:45 → Bestzeit; Übungsauswahl disziplin-gefiltert
- Achsen und Beschriftungen im gerenderten Screenshot auf Beschnitt geprüft

---

## Phase 6 — Soul Collector

Jeder erreichte Meilenstein ist eine Seele. Zwei Grundsätze tragen den ganzen Layer:

1. **Nichts wird verschenkt.** Jede Seele hängt an einer nachprüfbaren Bedingung aus den
   echten Daten — keine Teilnahme-Abzeichen.
2. **Nichts bestraft.** Eine verpasste Einheit bricht keinen Streak, solange sie
   regelkonform umgeplant wurde.

### Die Streak-Regel

Ein Zyklus gilt als **sauber**, wenn jede geplante Einheit entweder erledigt oder
regelkonform umgeplant wurde. Der Unterschied steckt im Status:

| Status | Bedeutung | Bricht den Streak? |
|---|---|---|
| `done` | erledigt | nein |
| `skipped` mit Begründung | die App hat entschieden, dass sie entfällt | **nein** |
| `missed` | offen geblieben | ja |
| `planned` in der Vergangenheit | nie abgehakt | ja |

Damit ist die Vorgabe „eine verpasste Session bricht keinen Streak, wenn ich sie
regelkonform verschiebe" wörtlich umgesetzt: Wer den Vorschlag der App annimmt, verliert
nichts. Nur wer „nur als verpasst markieren" wählt, lässt etwas offen.

### Der Katalog

14 Seelen in drei Stufen. Mehrere sind bewusst auf diese Lebenssituation gemünzt:

| Seele | Bedingung | Stufe |
|---|---|---|
| Der erste Schritt | erste protokollierte Einheit | gewöhnlich |
| Nach zwölf Stunden | Einheit an einem vollen Schichttag | gewöhnlich |
| Vor der Nacht | Einheit am Vormittag vor der Nachtschicht | gewöhnlich |
| Zyklus geschlossen | Rotationsdurchlauf ohne offene Einheit | gewöhnlich |
| Die Kunst des Weniger | Deload wirklich locker gehalten | gewöhnlich |
| Fundament | 500 Minuten | gewöhnlich |
| Doppelt genommen | Laufen und Kraft an einem Tag, beides erledigt | selten |
| Neue Bestmarke | echte Verbesserung eines Bestwerts | selten |
| Drei am Stück | 3 saubere Zyklen in Folge | selten |
| Ausdauer | 2000 Minuten | selten |
| Block vollendet | ganzer Mesozyklus | selten |
| Wiederkehr | Einheit nach ≥ 14 Tagen Pause | legendär |
| Unbeirrbar | 12 saubere Zyklen in Folge | legendär |
| Zehntausend | 10 000 Minuten | legendär |

Das geschätzte 1RM löst **keine** eigene Seele aus — es ist abgeleitet, sonst gäbe es für
einen schweren Satz gleich zwei.

### Der Vault

Seltenheit über die eine Akzentfarbe abgestuft (`◇` Rand grau, `◈` gedämpftes Bernstein,
`◆` volles Bernstein mit leichtem Schein) — kein Regenbogen, kein Konfetti.

- Die große Zahl ist der **Besitz**, nicht der Fortschritt; die Vollständigkeit steht klein
  darunter.
- Mehrfach eingesammelte Seelen werden zu einem Eintrag mit `×N` zusammengefasst. Vier
  gleichnamige Karten untereinander sehen aus wie ein Fehler und entwerten das, was sie
  feiern sollen.
- **Offene Seelen sind sichtbar**, mit Beschreibung und Fortschrittsbalken. Man jagt
  leichter, was man kennt.

### Verwoben, nicht versteckt

- Auf dem **Heute-Screen**: die drei Seelen, die gerade am nächsten sind, mit Balken.
- Nach jedem **Protokoll**: neu eingesammelte Seelen erscheinen direkt neben den Bestwerten.
- Beim **App-Start**: eine Auswertung, damit auch Seelen ankommen, die fällig wurden,
  während die App zu war.

### Eine Falle, die Zeit gekostet hat

Die Auswertung schreibt — und lief zunächst innerhalb eines Dexie-`liveQuery`. Das lässt
die Seite mit einer Client-Exception abstürzen. Schreiben und Anzeigen sind jetzt
getrennt: `syncSouls()` läuft aus Effekten heraus, `getSoulsInReach()` ist rein lesend und
darf beobachtet werden.

### Geprüft

- Streak-Regel in allen vier Statusfällen, Streak über mehrere Zyklen mit Bruch in der Mitte
- Comeback nur bei echter Pause, Bestwert-Seele nur bei echter Verbesserung
- Keine doppelten Schlüssel im Katalog
- Ende-zu-Ende: leerer Vault, erste Seele nach dem Abhaken, Fortschritt auf dem
  Heute-Screen, Persistenz in IndexedDB, und mehrfaches Auswerten legt nichts doppelt an

---

## Phase 7 — PWA, Politur, Deployment

### Auf dem Homescreen

`public/manifest.json` mit `display: standalone`, dunklem Hintergrund und drei Icons
(192, 512, maskierbar 512). Dazu die apple-spezifischen Metadaten: Next setzt nur das
moderne `mobile-web-app-capable`, ältere iOS-Versionen starten ohne die apple-Variante
weiterhin mit Safari-Leisten — beide sind gesetzt.

Das Zeichen ist eine Raute in der Raute: dieselbe Geometrie wie die Seltenheitsmarken
`◇ ◈ ◆` im Vault. Ein erster Entwurf mit einem Seelen-Glyph las sich bei 32 px als
Glühbirne und wurde verworfen.

### Offline

`public/sw.js` — kein Framework, rund 90 Zeilen:

| Anfrage | Strategie |
|---|---|
| Seitenaufruf | erst Netz (damit neue Versionen ankommen), sonst Cache, sonst Startseite |
| `/_next/static/*` | Cache zuerst — die Dateien tragen einen Hash und ändern sich nie |
| alles Übrige | aus dem Cache antworten, im Hintergrund erneuern |

Beim Anheben von `VERSION` verwirft der Worker alte Caches. Die Kernseiten werden
einzeln vorgeladen statt per `addAll` — ein fehlender Eintrag darf die Installation nicht
scheitern lassen.

Ziel ist nicht Geschwindigkeit, sondern Verfügbarkeit: Die Daten liegen ohnehin lokal;
fehlt nur die Hülle, ist alles unerreichbar.

### Navigation neu

Acht Einträge in einer Zeile waren auf 390 px nicht mehr lesbar. Jetzt eine feste
Leiste am unteren Rand mit den fünf Screens des Alltags (Heute, Plan, Aufgaben,
Statistik, Seelen), jeweils mit eigenem Symbol. Schicht, Setup und Daten hängen hinter
dem Zahnrad oben rechts; die Schichtkarte auf dem Heute-Screen führt zusätzlich direkt
dorthin. Die Leiste respektiert `env(safe-area-inset-bottom)`, damit sie über der
Home-Anzeige des iPhones liegt.

### Ein Fehler, der nur im Export auftrat

`usePathname()` liefert beim Vorrendern `/plan`, beim Aufruf der exportierten Datei aber
`/plan.html`. Der aktive Reiter unterschied sich dadurch zwischen Server- und
Client-Rendering, und React brach die Hydration mit einer Client-Exception ab — sichtbar
nur im Produktionsbuild, nie im Entwicklungsmodus. Der Pfad wird jetzt vor dem Vergleich
angeglichen.

### Geprüft

- Manifest, Icons und alle iOS-Metadaten im gebauten HTML
- Service Worker registriert sich und wird aktiv
- **Echtes Offline**: Netz abgeschaltet, neu geladen — App startet, Trainingsplan da
- Alle acht Screens auf waagerechtes Scrollen und abgeschnittenen Text geprüft
- Die untere Leiste verdeckt keinen Inhalt
- Keine Konsolenfehler auf irgendeinem Screen

---

## Nachbesserung nach dem ersten Test auf dem Gerät

Drei Dinge zeigten sich erst auf einem echten iPhone:

### Der Inhalt lag unter der Statusleiste

`apple-mobile-web-app-status-bar-style: black-translucent` lässt die Seite bis unter Uhr
und Batterieanzeige laufen — das ist der Sinn der Einstellung, verlangt aber einen
Ausgleich. Der Kopf hat jetzt `padding-top: calc(env(safe-area-inset-top) + 1.25rem)`.

### Zeichen wie ▪ und ◆ sind unzuverlässig

iOS rendert sie je nach Schrift als Emoji oder als leeren Kasten — auf dem Testgerät stand
statt der Key-Session-Marke ein graues Rechteck. Alle Marken sind jetzt gezeichnete SVGs
(`<Mark variant="solid" | "half" | "outline" />`), die überall gleich aussehen und die
Rautenform des App-Symbols aufnehmen.

### Der Heute-Screen war zu ausführlich

Der komplette Ablauf und die Begründung standen offen auf dem Startbildschirm. Morgens
will man nicht lesen, sondern wissen, was ansteht. Jetzt:

- **Eingeklappt:** Titel groß, drei Eckdaten als Kacheln (Dauer, Zone, RPE), der Hauptteil
  in einer Zeile — ohne Herzfrequenzbereich, der die Zeile umbrechen ließ.
- **Beim Antippen:** der vollständige Ablauf und „Warum heute".
- Datum, Schicht und Kapazität sitzen in einer Zeile statt in einer eigenen Karte.

Ergebnis: Die Session-Karte endet nach 397 von 852 Pixeln — sie passt mit allem, was
zählt, in die obere Hälfte des Bildschirms.

Außerdem: Kopf und untere Leiste sind deckend statt durchscheinend (`backdrop-blur` auf
einem fixierten Element kostet auf dem Telefon Leistung), und das „Doppeltag"-Etikett im
Plan ist weg — die zweite Zeile sagt mit „↳ dazu" ohnehin, was los ist.

---

## Plan neu erzeugen

Ganz unten auf dem Plan-Screen. Vorher musste man den Plan erst löschen, damit der
Erzeugen-Knopf wieder auftauchte — zwei Schritte, davon einer rot als Gefahr markiert,
obwohl das Neuerzeugen der normale Weg nach einer Einstellungsänderung ist.

Jetzt: **Plan neu erzeugen** mit einer Rückfrage, darunter abgesetzt weiterhin
*Plan löschen*. Beide lassen protokollierte Einheiten unangetastet — nur die noch
geplanten werden ersetzt.

---

## Konflikte nach einem Schichttausch

Trägt man eine Schicht nachträglich ein — Tausch, Krankheit, kurzfristige V-Schicht —,
steht eine bereits geplante Einheit plötzlich an einem Tag, der sie nicht mehr trägt.
Vorher blieb sie dort stumm stehen; man musste selbst darauf kommen, dass der Plan nicht
mehr stimmt.

Jetzt prüft die App bei jeder Anzeige, ob `capacityAllows(Tageskapazität, Session-Typ)`
noch gilt, und zeigt den Konflikt an drei Stellen:

| Screen | Anzeige |
|---|---|
| Schicht | Hinweis mit Anzahl und Titeln, direkt nach dem Setzen der Abweichung |
| Heute | Band über der Karte: „Passt nicht mehr" plus Knopf **Umplanen** |
| Plan | Zeile hervorgehoben, statt der Dauer steht „passt nicht"; im Detail derselbe Knopf |

Der Knopf führt in den bestehenden Umplanungs-Vorschlag — es braucht dafür keine eigene
Logik, nur den Anlass.

Durchgespielt: heutigen Tag auf Tagschicht setzen → Warnung auf drei Screens → Umplanen →
Intervalle rücken auf den nächsten freien Tag, die verdrängte Krafteinheit sucht sich
selbst einen Platz → heute ist Ruhetag, keine offenen Konflikte mehr.

---

## Progressive Steigerung

Vorher stand jeder Belastungszyklus für sich: Intervalle waren immer `6× 800 m`, der
Long Run immer 90 Minuten, die Kniebeuge immer `4× 5 schwer`. Der Deload senkte die
Last auf 60 %, danach ging es auf demselben Niveau weiter. Es gab also keine
Steigerung — nur Wiederholung. Für jemanden, der einsteigt, war der Start außerdem zu
hoch: 90 Minuten Long Run in der ersten Woche.

Jetzt startet jede Einheitsart bei null und steigert sich mit jedem Mal.

### Die Stufe zählt Vorkommen, keine Zyklen

Naheliegend wäre, pro Zyklus eine Stufe hochzuzählen. Das geht schief: der Long Run
kommt nur jeden zweiten Zyklus dran, weil er sich mit den Intervallen um die zwei
vollen Tage streitet. Pro Zyklus zu zählen ließe ihn zwischen zwei Läufen um zwei
Stufen springen — 45 auf 57 Minuten statt 45 auf 51.

Deshalb führt **jede Einheitsart ihre eigene Stufe**, und die zählt, wie oft diese Art
schon dran war. Der Sprung ist damit immer gleich groß, egal wie die Rotation gerade
liegt. Der Stand steht in `Session.progressionStep`; fortgeschrieben wird er während
der Planung in `PlanState.levels`.

### Womit gesteigert wird

| Einheit | Stufe 0 | pro Stufe | Grenze |
|---|---|---|---|
| Long Run | 45 Min | +6 Min | 120 Min |
| Lockerer Lauf | 25 Min | +3 Min | 60 Min |
| Recovery Run | 20 Min | +2 Min | 35 Min |
| Tempolauf | 10 Min am Stück | +2 Min | 30 Min |
| Intervalle | 4× 400 m | +1 Wiederholung, nach 6 die nächste Distanz | 8× 1000 m |
| Kraft (je Übung) | untere Wiederholungszahl, leicht | +1 Wiederholung | oben angekommen: Gewicht rauf, zurück auf unten |

Laufen steigert sich in Minuten bzw. Wiederholungen, Kraft nach **doppelter
Progression**: erst die Wiederholungen innerhalb der Spanne hoch (Kniebeuge 5 → 8),
dann Gewicht drauf und zurück auf 5. Die App kennt die Gewichte nicht und behauptet
deshalb keine Kilogramm, sondern sagt, *was sich ändert*: „4× 6 · gleiches Gewicht"
oder „4× 5 · +5 kg".

Die Dauer der Krafteinheiten bleibt konstant — dort wächst die Last, nicht die Zeit.
Bei den Läufen wächst die Zeit, deshalb wird `plannedDurationMin` aus der Stufe
berechnet statt aus einem festen Vorgabewert.

Die ersten beiden Male einer Art laufen bewusst unter dem Ziel-RPE (−2, dann −1).
Stufe 0 dient dem Kennenlernen des Gewichts, nicht dem Ausreizen; über einer
ausdrücklich leichten Einheit stünde sonst RPE 8.

### Die Stufe wird verdient

Ein Plan, der stur weitersteigert, egal ob trainiert wurde, ist eine Fiktion. Beim
Erzeugen eines neuen Plans zählt `advanceProgressionBase()` deshalb nur die Einheiten
mit, die als **erledigt** protokolliert sind, und schreibt den Stand in
`Settings.progressionBase`. Wer einen Zyklus verpasst, verliert nichts — er setzt den
neuen Plan nur nicht höher an, als er tatsächlich trainiert hat.

Nicht mitgezählt werden:

- **Deload-Zyklen** — dort wird bewusst unter dem Stand trainiert.
- **Ersatzformen** nach einer Umplanung (`strength_short`, `run_recovery`) — sie halten
  die Gewohnheit, sind aber kein Fortschritt.

Der Deload setzt die Stufe **nicht** zurück, sondern fährt sie abgeschwächt: rund 60 %
der aktuellen Länge, halbe Intervallanzahl, Kraft bei ca. 60 %. Danach geht es dort
weiter, wo der Block aufgehört hat — sonst wäre die Steigerung ein Kreis.

### Anzeige

- **Plan → Steigerung**: eine Zeile je Einheitsart mit Stufe und dem, was als Nächstes
  ansteht. Der Stand ist die nächste geplante Einheit dieser Art — eine Stufe, die noch
  nicht geplant ist, ist auch nicht erreicht.
- **Heute** und **Plan-Detail**: Chip „Stufe N" und ein Satz, was sich gegenüber dem
  letzten Mal ändert (`Session.progressionNote`).

Durchgespielt: Plan über drei Blöcke erzeugt → Long Run 45/51/57/63/69/75 Min,
Intervalle 4×400 → 6×600, Kniebeuge 4×5 → 4×8 → +5 kg → 4×5. Dann drei
Unterkörper-Einheiten als erledigt markiert und neu erzeugt → Kraft Unterkörper steht
auf Stufe 3, alle anderen Arten weiter auf 0.

Schema auf Version 5: `Session.progressionStep`/`progressionNote`,
`Microcycle.progression`, `Settings.progressionBase`. Ältere Sicherungen lassen sich
weiter importieren; fehlende Felder werden als Stufe 0 gelesen.

---

## Ruhetage im Plan, Schicht direkt am Tag ändern

Der Plan listete nur Einheiten. Ein Tag ohne Training fiel damit komplett heraus —
zwischen Di 25.08. und Do 27.08. klaffte eine Lücke, und ob dort ein Ruhetag geplant war
oder etwas fehlte, war der Liste nicht anzusehen. Ein Tag ohne Einheit ist aber keine
Lücke, sondern eine Entscheidung.

Jetzt steht **jeder Tag des Zyklus** in der Liste. Tage ohne Einheit erscheinen mit
gestricheltem Rahmen und heißen je nach Kapazität *Ruhetag* oder *Kein Training* — die
Tagschicht ist kein Ruhetag, sondern ein Tag, an dem nichts geht. Rechts steht die
Schichtart, damit der Grund direkt daneben steht.

Und weil genau dort auffällt, dass eine Schicht nicht stimmt („da habe ich getauscht"),
lässt sie sich jetzt an Ort und Stelle ändern statt über den Schicht-Screen:

- **Ruhetag antippen** → Begründung plus Schichtauswahl.
- **Einheit antippen** → im Detail *Schicht ändern*, eingeklappt, damit der Ablauf oben
  bleibt.

Beides schreibt dieselbe `shiftOverrides`-Abweichung wie der Schicht-Screen; die Auswahl
steckt jetzt in `components/ShiftPicker.tsx` und wird von beiden Screens benutzt. Die
aktuelle Schichtart ist darin hervorgehoben, ein abweichend gesetzter Tag trägt in der
Liste ein `∗`.

Durchgespielt: Tagschicht im Plan auf Freischicht gesetzt → Zeile wechselt auf *Ruhetag*
mit `∗`. Umgekehrt einen Trainingstag auf Tagschicht gesetzt → dieselbe Zeile zeigt
sofort „passt nicht" und im Detail den Umplanen-Knopf.

`capacityExplanation()` sagt jetzt „an diesem Tag" statt „heute" — der Satz steht auch
über künftigen Tagen.

---

## Entwicklung

```
npm install
npm run dev        # http://localhost:3000
npm run build      # statischer Export nach out/
npm run typecheck
```
