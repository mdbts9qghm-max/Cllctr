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

**Cllctr plant Tag für Tag, in dieser Rangfolge: Schlaf und Erholung → Schicht → Training.**

Normale Trainings-Apps verteilen Sessions auf feste Wochentage („Dienstag Intervalle").
Bei rotierenden 12-Stunden-Schichten ist der Wochentag bedeutungslos — der Dienstag ist
mal frei, mal Nachtschicht. Und selbst ein freier Tag sagt noch nichts: Wer vier Stunden
geschlafen hat, hat keinen harten Tag vor sich, egal was im Dienstplan steht.

Deshalb entscheidet der Generator für **jeden einzelnen Kalendertag** in drei Schritten:

1. **Erholung** — was der Körper hergibt (`recovery`, `sleepHours`, `sleepDebt`).
2. **Schicht** — was der Tag hergibt (Art der Schicht, Zeitfenster, mögliche Disziplinen).
3. **Training** — was die Woche noch braucht (Wochenziele, harte Einheiten, Volumen).

Die Reihenfolge ist keine Formulierung, sondern die tatsächliche Abfolge der Prüfungen in
`rules.dayAllowance()`. Keine Regel kann einen Tag *härter* machen, als Schicht und
Erholung ihn zulassen — nach oben korrigiert nichts.

Folge: `WeeklyTargets` sind **Anzahl Einheiten pro Woche**, nie Wochentage. Und ein
Mikrozyklus ist eine **Kalenderwoche**, weil alle Regeln in Wochen zählen.

### Die Rotation läuft quer zur Kalenderwoche

Die Rotation ist 5 Tage lang, die Woche 7. Beide decken sich erst nach 35 Tagen wieder.
Konkret heißt das: eine Kalenderwoche enthält **2, 3 oder 4 freie Tage** — im Schnitt 2,8.
Ein starres Wochenprogramm kann es deshalb nicht geben; der Plan muss Woche für Woche
mitgehen. Seit der Umstellung auf Tag-für-Tag-Eingabe ist die Rotation ohnehin nur noch
eine Vorbelegung, keine Voraussetzung.

### Kapazität und Schichtart

`TrainingCapacity` (`none`/`light`/`moderate`/`full`) gibt es weiterhin, aber nur noch als
grobe Kurzfassung für Anzeige, Filter und die manuelle Auswahl im Plan. Die **Regeln**
hängen an `ShiftType.kind`:

| `kind` | Schicht | Was der Tag hergibt |
|---|---|---|
| `day` | Tagschicht 07:00–19:00 | Kein Training. Schlaf, Regeneration, höchstens ein Spaziergang |
| `night` | Nachtschicht 19:00–07:00 | Fenster 15:30–18:00 davor, danach nichts |
| `sleep` | Schlaftag, Hauptschlaf 08:00–14:00 | Fenster 16:00–19:30, in erster Linie Regenerationstag |
| `free` | Freischicht | Ganzer Tag — hier liegen die harten Einheiten |
| `variable` | V-Schicht 08:00–20:00 | Nur Laufen, kurz, morgens oder abends. Kein Gym |
| `off` | Krank und alles ohne Kapazität | Nichts |

Die Marke sitzt an der Schichtart und nicht am Namen: Wer die Nachtschicht umbenennt,
ändert nicht, wie sie geplant wird.

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

### Der ursprüngliche Generator — abgelöst

> Der erste Generator plante auf **Rotationszyklen** und verteilte die Wochenziele in drei
> Durchgängen (Best-Fit, Aufwerten, Doppeltag) auf die Tage. Er ist durch das Regelwerk
> abgelöst worden (siehe *Phase 9*). Der Grund steht dort: Ein Verfahren, das erst alle
> Wünsche sammelt und sie dann verteilt, kann Regeln, die am einzelnen Tag und an
> Wochengrenzen hängen, nicht zuverlässig einhalten.
>
> Was aus dieser Phase geblieben ist: die Trennung von Planungslogik (`planner.ts`) und
> Schreibzugriffen (`plan-store.ts`), der Umplaner (`replan.ts`) und die Erkenntnis, dass
> Krafttraining keinen ganzen Tag braucht.

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

## Urlaub: mehrere Tage auf einmal

Abweichungen ließen sich nur Tag für Tag setzen. Bei zwei Wochen Urlaub sind das
vierzehn Griffe — und genau dann lässt man es, der Plan rechnet weiter gegen die
Rotation, und die Einheiten stapeln sich auf Doppeltagen, während daneben freie Tage
leer stehen.

Auf dem Schicht-Screen gibt es dafür jetzt **Mehrere Tage auf einmal**: von, bis,
Schichtart. *Setzen* schreibt für jeden Tag im Zeitraum dieselbe Abweichung,
*Abweichungen entfernen* nimmt sie wieder zurück. Der Knopf sagt, wie viele Tage
betroffen sind, bevor man ihn drückt. Ein Ende vor dem Anfang wird nicht als Fehler
gemeldet, sondern mitgezogen; mehr als 183 Tage am Stück lehnt das Formular ab.

Wichtig für das Verständnis: **Urlaub erhöht das Volumen nicht.** Die Wochenziele
bleiben 3× Kraft, 2× Laufen, 1× optional — mehr freie Tage heißen nur, dass sich
dieselben Einheiten sauberer verteilen. Durchgespielt mit 14 Tagen Freischicht: eine
Einheit pro Tag, ein Ruhetag je Zyklus, kein einziger Doppeltag im Urlaubszeitraum.

---

## Urlaub und Krank

Bis hierher ließ sich Abwesenheit nur als „Freischicht" eintragen. Für Urlaub geht das
gerade noch — für Krankheit nicht: eine Freischicht ist ein voller Tag, und der Plan
legte dort prompt eine Key-Session hin.

Beides sind jetzt eigene Schichtarten, bewusst **neben** den Schichten statt in einem
eigenen Konzept. Für die Planung ist die einzige Frage, was an einem Tag geht — und
damit funktionieren Rotation überschreiben, Zeitraum setzen und Konflikterkennung
unverändert weiter.

| | Kapazität | Besonderheit |
|---|---|---|
| **Urlaub** | voll | wie eine Freischicht; mehr freie Tage heißen nicht mehr Training |
| **Krank** | keine | geplante Einheiten **entfallen**, statt umgeplant zu werden |

### Der Unterschied ist die Absicht, nicht die Kapazität

Eine Tagschicht und ein Krankheitstag tragen beide kein Training. Trotzdem will man
Gegensätzliches: fällt ein freier Tag einer Tagschicht zum Opfer, soll die Einheit
gerettet werden; ist man krank, soll sie weg — sie am nächsten Tag nachzuholen wäre
genau die falsche Reaktion.

Dafür trägt `ShiftType` jetzt `cancelsPlanned`. Ist die Marke gesetzt, heißt der Knopf
am Konflikt **Einheit streichen** statt *Umplanen*, und beim Setzen eines Zeitraums
werden die Einheiten darin gleich mit gestrichen — sonst stünden sie als Konflikte im
Plan und man müsste jeden einzeln wegklicken. Die Marke ist unter Setup → Schichtarten
für jede Art umschaltbar.

Gestrichen heißt `skipped` mit Begründung, nicht `missed`: eine gestrichene Einheit ist
eine Entscheidung, keine liegengelassene. Nur `missed` bricht die Serie.

### Krank darf die Steigerung nicht nach oben schieben

Der eigentliche Fallstrick. Fällt eine Einheit aus, ist die nächste desselben Typs im
Plan bereits eine Stufe höher — nach einer Krankheitswoche stünde man zwei Stufen
weiter, als je trainiert wurde. Das ist das Gegenteil von „die Stufe wird verdient".

`relevelPlannedProgression()` nummeriert deshalb nach jedem Statuswechsel die noch
geplanten Einheiten neu durch: Erledigte schieben die Stufe hoch und behalten ihre
eigene (Verlauf wird nicht rückwirkend umgeschrieben), Gestrichene und Verpasste zählen
nicht, Deload-Einheiten fahren die aktuelle Stufe ohne sie zu erhöhen — dieselbe Regel
wie beim Erzeugen. Läuft nach *streichen*, *verpasst*, *zurück auf geplant* und nach
einer angewandten Umplanung.

Durchgespielt: Plan erzeugt, alle Arten auf Stufe 0 → 7 Tage Krank gesetzt, 6 Einheiten
gestrichen → alle Arten stehen weiter auf Stufe 0.

### Eine ausgefallene Woche bricht die Serie nicht

`cycleVerdict` kannte nur *clean*, *broken*, *running*. Ein Zyklus, in dem alles
gestrichen wurde, fiel unter „broken" (`done.length === 0`) — eine Grippe hätte die
Serie zerrissen. Neu ist `paused`: sind **alle** Einheiten eines abgeschlossenen Zyklus
gestrichen, verdient er keine Seele, unterbricht die Serie aber auch nicht.
`currentStreak` überspringt ihn, statt abzubrechen.

Geprüft mit drei Zyklen (sauber / komplett gestrichen / sauber): Serie 2. Dieselben
Daten mit einer *verpassten* statt gestrichenen Einheit: Serie 1.

Schema auf Version 6: `ShiftType.cancelsPlanned`. Bestehende Installationen bekommen
Urlaub und Krank über die Markierung `seed.absenceShifts.v1` nachgereicht — wer sie
löscht, bekommt sie nicht wieder aufgedrängt.

---

## Zwei Fehler beim Protokoll

**„Protokoll bearbeiten" zeigte nie, was gespeichert war.** Das Formular setzte seine
Felder aus der *geplanten* Einheit (`targetRpe`, `plannedDurationMin`) und lud den
vorhandenen `SessionLog` nicht. Beim erneuten Öffnen standen wieder die Planwerte da —
es sah aus, als wäre nichts gespeichert worden. Wer dann speicherte, überschrieb seine
eigenen Zahlen mit den Vorgaben. Geschrieben hatte `logSession()` die ganze Zeit
korrekt; nur gelesen wurde nie.

Jetzt lädt das Formular Log und Satzeinträge und füllt RPE, Dauer, Distanz, Gefühl,
Notiz und Sätze vor. Übernommen wird genau einmal, sonst würde der nächste Lauf des
LiveQuery die gerade getippte Änderung zurücksetzen. Die Überschrift heißt beim
Bearbeiten auch so.

**Zweimal speichern verdoppelte die Sätze.** `recordSets()` legt immer neue Einträge an.
Beim Bearbeiten wurden die alten deshalb nicht ersetzt, sondern ergänzt — und Volumen
wie Bestwerte zählten denselben Satz mehrfach. Vor dem Schreiben werden die Einträge des
Logs jetzt gelöscht.

Durchgespielt: RPE 9, 55 Min, ein Satz mit 100, Notiz gespeichert → Formular neu geöffnet
zeigt genau das → nochmal gespeichert → weiterhin ein Log und ein Satzeintrag.

---

## Erledigte Einheit doppelt am selben Tag

Nach *Plan neu erzeugen* stand dieselbe Einheit zweimal auf dem Heute-Screen: einmal
erledigt auf Stufe 0, einmal geplant auf Stufe 1.

`clearActivePlanInternal()` behält protokollierte Einheiten — sie sind Verlauf, kein
Plan. Der neue Generator wusste davon aber nichts und belegte denselben Tag noch einmal.
Der Kommentar behauptete außerdem, die Einheiten würden „aus dem Plan gelöst"; tatsächlich
zeigten sie weiter auf einen Mikrozyklus, den es nicht mehr gab.

Drei Änderungen:

- `createAndSavePlan()` sammelt die erledigten Einheiten ab dem Startdatum ein und gibt
  sie als `PlanInput.completed` weiter.
- `placeCandidates()` nimmt diese Tage als **frozen** auf. Sie bekommen nichts Neues,
  zählen für die Nachbarregeln aber mit — wer gestern Intervalle gelaufen ist, bekommt
  heute keine, nur weil der Plan ersetzt wurde. Der Mechanismus dafür war schon da: so
  wird auch der Vortag am Zyklusrand berücksichtigt.
- Zurückbehaltene Einheiten werden wirklich gelöst (`microcycleId: ''`). Damit die
  Planliste sie trotzdem zeigt, gruppiert sie jetzt nach **Datum** statt nach Zyklus-Id —
  sonst stünde an dem Tag „Ruhetag", obwohl dort trainiert wurde.

Durchgespielt: zwei Einheiten protokolliert, Plan neu erzeugt → beide Tage tragen genau
ihre erledigte Einheit, die neuen Einheiten liegen dahinter, kein Doppel.

---

## Erledigt sah aus wie geplant

In der Planliste war einer erledigten Einheit nichts anzusehen: gleiche Farbe, rechts
die geplante Dauer. Standen zwei gleiche Einheiten an einem Tag — etwa das Doppel aus
dem Fehler oben, beide protokolliert —, ließen sie sich nicht auseinanderhalten und der
Plan wirkte kaputt, obwohl er es nicht war.

Jetzt steht rechts **erledigt** statt der Minuten, in der Bestätigungsfarbe, und der
Titel ist zurückgenommen. Nur der Status wird gezeigt, keine zweite Zeile — die Liste
soll überfliegbar bleiben.

### Einheit löschen

Für Reste aus einem ersetzten Plan und für versehentlich Protokolliertes gab es keinen
Weg zurück: *Verpasst* lässt die Einheit stehen, und eine protokollierte Einheit
überlebt jedes Neuerzeugen — zu Recht, sie ist Verlauf.

Im Detail einer **erledigten** Einheit steht deshalb jetzt *Einheit löschen*, mit
Rückfrage. `deleteSession()` räumt Einheit, Protokoll und Satzeinträge zusammen ab und
nummeriert die Stufen danach neu durch. Nur für erledigte Einheiten: eine geplante zu
löschen würde den Plan stillschweigend verkleinern, dafür gibt es *Verpasst*.

---

## Die Stufe konnte nur hoch

Der schwerere Fehler unter den bisherigen: nahm man eine Einheit zurück oder löschte
sie, blieb die Stufe oben stehen.

Grund war das Speichermodell. `Settings.progressionBase` war ein **fortgeschriebener
Zähler**: beim Neuerzeugen des Plans wurden die erledigten Einheiten aufaddiert und die
Summe in die Einstellungen geschrieben. Danach war die Zahl von ihrer Herkunft gelöst —
sie ließ sich durch nichts mehr widerlegen. Ein Fehleintrag hat die Stufe für immer
angehoben.

Jetzt wird die Stufe **gezählt statt gespeichert**:

```
Stufe = Anzahl erledigter Einheiten dieser Art  +  Korrektur
```

Damit ergibt sie sich immer aus dem, was tatsächlich in der Datenbank steht.
Zurücknehmen zählt von selbst zurück, Löschen ebenso, und nach einem Import stimmt sie
ohne Zusatzfeld. `advanceProgressionBase()` ist ersatzlos entfallen — es gibt nichts
mehr fortzuschreiben.

Damit Deload- und Ersatzformen nicht mitzählen, trägt die Einheit selbst die Marke
`countsForProgression`. Sie steht bewusst auf der Einheit und nicht am Zyklus: eine
protokollierte Einheit überlebt das Neuerzeugen und hängt danach an keinem Zyklus mehr,
muss aber weiter zählbar bleiben.

`relevelPlannedProgression()` startet jetzt beim gezählten Stand und nummeriert nur noch
die **geplanten** Einheiten durch. Erledigte behalten ihre eigene Stufe — sie ist
Verlauf und beschreibt, was tatsächlich trainiert wurde; sie rückwirkend umzuschreiben
würde das Protokoll verfälschen. Ausgelöst wird das nach jedem Statuswechsel,
einschließlich Protokollieren.

### Korrigieren

`progressionAdjust` ist der Griff daneben — eine bewusste Korrektur, positiv wie
negativ. Im Abschnitt **Steigerung** ist jede Zeile antippbar: **− 1**, **+ 1**,
**Auf Stufe 0**. Damit lässt sich ein Fehleintrag geradeziehen, ohne das Protokoll zu
löschen, und wer nicht bei null einsteigen will, stellt seine Startstufe selbst ein.

Der Abschnitt zeigt jetzt außerdem **alle** steigernden Arten, auch die, von denen
gerade nichts geplant ist — der Stand wird gezählt und ist deshalb immer bekannt.

Durchgespielt: 2× Intervalle protokolliert → Stufe 2 → eine zurück auf geplant →
Stufe 1 → die andere gelöscht → Stufe 0. Dann über die Knöpfe +1, +1, −1, *Auf Stufe 0*
→ 1, 2, 1, 0, und der Planinhalt zieht jedes Mal mit (4× 400 m ↔ 6× 400 m).

Schema auf Version 7: `Session.countsForProgression`, `Settings.progressionAdjust`
ersetzt `progressionBase`. Der alte Zähler wird bewusst **nicht** übernommen — er würde
doppelt zählen.

---

## Fünfzehn Seelen mehr

Der Katalog hatte 14 Einträge — genug, um das Prinzip zu zeigen, zu wenig, um über
Monate zu tragen. Zwischen *Fundament* (500 Min) und *Ausdauer* (2000 Min) lagen Wochen
ohne einen einzigen greifbaren nächsten Schritt.

Jetzt sind es **29**, in drei Gruppen. Die beiden Grundsätze bleiben: nichts wird
verschenkt, nichts bestraft. Jede neue Seele hängt an einer nachprüfbaren Bedingung aus
den echten Daten.

### Was der Tag hergab (gewöhnlich)

| Seele | Bedingung |
|---|---|
| Trotzdem | Eine Einheit protokolliert, die sich **schlecht** angefühlt hat |
| Im Zaum gehalten | Ein lockerer Lauf mit RPE ≤ 4 |
| Eine Stufe höher | Dieselbe Einheitsart zum zweiten Mal absolviert |
| Fünfundzwanzig | 25 protokollierte Einheiten |

*Trotzdem* ist die wichtigste davon: sie belohnt ausdrücklich den schlechten Tag, den
man zu Ende gebracht hat. *Im Zaum gehalten* zielt auf den häufigsten Fehler im
Ausdauersport — den lockeren Lauf zu schnell zu laufen.

### Handwerk (selten)

Die lange Runde (90 Min am Stück), Jede Schicht bespielt, Fünfte Stufe, Hundert
Kilometer, Hundert Einheiten, Fünftausend Minuten, Sechs am Stück.

**Jede Schicht bespielt** ist die einzige, die es so nur in dieser App gibt: mindestens
eine Einheit an *jeder* Schichtart, die überhaupt etwas trägt — bei dieser Rotation
Nachtschicht, Schlaftag und V-Schicht. Freischicht und Urlaub zählen nicht mit
(`startTime === null`), sonst wäre es geschenkt. Abwesenheiten ebenso wenig.

### Das lange Spiel (legendär)

Zwölfte Stufe, Auf breiter Front (jede steigernde Art auf mindestens Stufe 5),
Fünfhundert Kilometer, Ganzjährig (in zwölf verschiedenen Monaten trainiert).

*Ganzjährig* ist die Seele zum eigentlichen Ziel — kein Sommerform-Sport, sondern das
ganze Jahr.

### Stufen zählen, aber nur verdiente

`earnedLevels()` zählt für die Stufen-Seelen ausschließlich erledigte Einheiten mit
`countsForProgression` — die manuelle Korrektur aus den Einstellungen bleibt außen vor.
Eine Stufe, die man sich selbst eingetragen hat, ist keine verdiente Seele.

Fast alle neuen Seelen haben eine `progress`-Funktion; damit füllt sich auch *In
Reichweite* auf dem Heute-Screen, statt wie bisher fast nur Minuten-Schwellen zu zeigen.

Durchgespielt mit einem synthetischen Datenstand (5× Intervalle, ein schlechtes Gefühl,
ein Lauf über 95 Min): acht Seelen verdient, in Reichweite *Jede Schicht bespielt* 2/3,
*Hundert Kilometer* 62/100, *Zwölfte Stufe* 5/12. Leerer Datenstand: null verdient,
kein Absturz. Keine doppelten Schlüssel.

---

## Neu erzeugen löschte den Verlauf

`clearActivePlanInternal()` löschte **alle** Mikro-, Meso- und Makrozyklen — auch die
längst abgeschlossenen. Protokollierte Einheiten überlebten zwar, hingen danach aber an
keinem Zyklus mehr. Die Folge: die Serie fing bei null an, abgeschlossene Zyklen waren
weg, und im Plan war von dem, was man geleistet hatte, nichts mehr zu sehen. Die Daten
lagen noch in der Datenbank, aber ohne Zusammenhang — und das kommt einem Verlust
gleich.

Der Denkfehler war die Annahme, ein Plan sei ein Objekt, das man ersetzt. Er ist ein
**Zeitraum**. Ein neuer Plan schreibt die Zukunft neu, nicht die Vergangenheit.

`clearPlanFrom(stichtag)` räumt deshalb nur noch ab dem Stichtag ab:

| | |
|---|---|
| Zyklus endete vor dem Stichtag | bleibt unverändert |
| Zyklus reicht darüber hinweg | wird auf den Vortag gekürzt |
| Zyklus beginnt am Stichtag oder später | entfällt |
| Erledigte und protokollierte Einheiten | bleiben immer |

Mesozyklen ohne verbleibenden Zyklus verschwinden, die übrigen enden am letzten Tag,
der ihnen geblieben ist. Der alte Makrozyklus gibt die Aktivmarkierung ab und bleibt als
Verlauf stehen.

### Zwei Folgen für die Anzeige

Der Plan-Screen hing bisher am **aktiven** Makrozyklus — nach *Plan löschen* gab es
keinen, und die Seite zeigte „Noch kein Plan", obwohl Verlauf da war. Er lädt jetzt die
Zyklen direkt und unterscheidet: gibt es nichts ab heute, steht oben *Kein aktueller
Plan* mit dem Erzeugen-Knopf, darunter weiter der Verlauf.

Abgeschlossene Zyklen sind standardmäßig eingeklappt (*Einen früheren Zyklus zeigen*),
damit die Liste nicht mit jedem Monat länger scrollt.

Und für erledigte Einheiten, deren Zyklus wirklich nicht mehr existiert, gibt es die
Liste **Früher erledigt** unter dem Plan. Ohne sie wären sie unsichtbar, obwohl sie in
der Datenbank stehen — und genau das fühlt sich an, als wäre etwas verloren gegangen.

*Plan löschen* heißt jetzt auch ehrlich „Alles ab heute wird gelöscht. Erledigtes
bleibt." Für einen echten Neuanfang gibt es weiterhin das Zurücksetzen unter Daten.

Durchgespielt: einen abgeschlossenen Zyklus mit zwei erledigten Einheiten angelegt, Plan
neu erzeugt → der alte Zyklus steht unverändert da, seine Einheiten hängen weiter an
ihm, der alte Makrozyklus ist als *alt* markiert, der neue aktiv. Dann *Plan löschen* →
57 geplante Einheiten weg, beide erledigten und ihre Protokolle und Seelen da, sichtbar
unter *Früher erledigt*.

---

## Der Plan passt sich selbst an

Bis hierher musste man nach jedem Schichttausch daran denken, *Plan neu erzeugen* zu
drücken. Genau das ist die Art Arbeit, die die App abnehmen soll — und wer es vergisst,
läuft mit einem Plan herum, der eine Woche beschreibt, die es nicht mehr gibt. Die
Konfliktmarkierung („passt nicht mehr") war eine Krücke dafür.

### Woran die App merkt, dass sich etwas geändert hat

`planFingerprint()` fasst alle Eingaben zusammen, aus denen ein Plan entsteht: Rotation
(Folge und Startdatum), Kapazität und Abwesenheitsmarke jeder Schichtart, alle
Abweichungen im Planungszeitraum, Wochenziele, Profil, Zyklus-Längen und die
Herzfrequenzzonen. Der Wert steht auf dem Makrozyklus (`inputFingerprint`).

Bewusst nur die **Eingaben**, nicht das Ergebnis: Was man abhakt, verschiebt oder
streicht, ist keine Änderung der Grundlage und löst nichts aus. Name und Farbe einer
Schichtart auch nicht — eine Umbenennung soll den Plan nicht anfassen.

### Was dabei geschützt ist

`syncPlan()` plant ab **heute** neu. Unangetastet bleiben:

- erledigte und protokollierte Einheiten (wie bisher),
- abgeschlossene Zyklen (seit `clearPlanFrom`),
- alles, was **fixiert** ist.

Damit bekommt *Fixieren* endlich seinen eigentlichen Zweck: es ist der Griff, mit dem
man eine einzelne Einheit an ihrem Tag festnagelt. Fixierte Tage gehen als belegt in die
Neuplanung ein, genau wie erledigte.

### Wo es ausgelöst wird

In `AppShell`, also einmal für die ganze App statt auf jedem Screen einzeln. Ein
LiveQuery beobachtet **rein lesend** den Fingerabdruck; gehandelt wird im Effekt
darunter. Ein Schreibzugriff im laufenden LiveQuery würde die Seite abstürzen lassen —
dieselbe Trennung wie bei `syncSouls()`.

Danach steht oben ein Hinweis: *„Plan angepasst: an 6 Tagen liegt jetzt etwas anderes."*
Gezählt wird in Tagen, nicht in Einheiten — eine Zahl, die durch Verschiebungen in beide
Richtungen entsteht, trifft ohnehin nur die halbe Wahrheit.

Pläne, die vor dieser Automatik erzeugt wurden, tragen keinen Fingerabdruck. Sie
bekommen ihn beim ersten Start nachgetragen, **ohne** neu geplant zu werden — ein Update
soll den bestehenden Plan nicht ungefragt umbauen.

### Abschaltbar

Unter Setup → *Plan bei Änderungen selbst anpassen*. Aus heißt: die App wartet wieder auf
den Knopf. Der Nutzer hatte früh entschieden, dass die App vorschlägt und er bestätigt —
diese Automatik ist eine Ausnahme davon, also gehört ihr ein Schalter.

Durchgespielt: Plan erzeugt, eine Einheit protokolliert, eine spätere fixiert. Dann
sechs Tage auf Tagschicht gesetzt → Hinweis „an 6 Tagen liegt jetzt etwas anderes", die
erledigte Einheit unverändert, die fixierte weiter auf ihrem Tag. Beim erneuten Öffnen
passiert nichts mehr. Automatik abgeschaltet und die Rotation verschoben → Plan bleibt
stehen.

---

## Zwei Zählfehler in der Auswertung

**Erledigtes an einem künftigen Tag zählte nicht.** `headline()` filterte
`s.date <= reference` — „was noch bevorsteht, ist keine verpasste Chance". Richtig, aber
zu grob: bei Schichtarbeit hakt man eine Einheit auch mal vor ihrem geplanten Tag ab.
Die verschwand dann aus *Durchgezogen* und aus den Wochenminuten. Nachgeprüft: zwei
erledigte Einheiten, angezeigt „1 von 1" und 40 statt 100 Minuten. Erledigtes zählt
jetzt unabhängig vom Datum, und die laufende Woche zählt ganz statt nur bis heute.

**Offene Einheiten aus der Vergangenheit blieben für immer offen.** Sie stehen zu Recht
im Nenner — eine nie abgehakte Einheit ist nicht durchgezogen. Nur gab es keinen Ort,
sie zu erledigen: der Heute-Screen zeigt heute, der Plan-Screen ist eine Liste. Also
sammelten sie sich an und zogen die Quote nach unten, ohne dass man etwas tun konnte.

Neu auf dem Heute-Screen: **Noch offen** — Einheiten der letzten 14 Tage, die nie
abgehakt wurden, mit *Nachtragen* (öffnet das Protokollformular), *Verpasst* und
*Streichen*. Damit schließt sich die Schleife.

---

## Der Aufgaben-Tab bekommt eine Kette

„Spielerischer" darf hier nicht heißen: bunter. Die Vorgabe war von Anfang an
Artefakt-Inventar, kein Belohnungs-Stickerheft — kein Konfetti, eine Akzentfarbe. Das
Spiel dieser App ist der Soul Collector, also wird der Aufgaben-Tab in **dessen** Sprache
gespielt, nicht in der einer Habit-App.

### Tagesstand

Über den Routinen steht groß **4 / 4** mit einem Balken je Routine — gefüllt heißt
erledigt. Darunter ein Satz: „Alles erledigt an 4 Tagen in Folge." Eine Zahl, ein Balken,
ein Satz.

### Sieben Tage zurück

Jede Routine trägt ein Raster der letzten sieben Tage. Eine Lücke sieht man sofort, und
genau das ist der Antrieb, keine zu lassen — dieselbe Mechanik wie beim Zyklus-Streak,
nur auf Tagesebene. Rechts daneben die eigene Serie, ab zwei Tagen in der Akzentfarbe.

Die Daten dafür lagen längst da: beim Abhaken entsteht eine neue Instanz, die erledigte
bleibt stehen und `templateTaskId` hält die Familie zusammen. `routineDays()`,
`routineStreak()`, `routineGrid()` und `allRoutinesStreak()` in `tasks.ts` lesen sie aus.
Gerechnet wird über das **Fälligkeitsdatum**, nicht den Zeitstempel — bei Nachtschicht
hakt man gern nach Mitternacht ab.

Der heutige Tag bricht eine Serie nicht, solange er noch läuft: er ist erst dann eine
Lücke, wenn er vorbei ist.

### Drei Seelen dafür

Drei Tage Ordnung (gewöhnlich), Zwei Wochen Ordnung (selten), Sechzig Tage Ordnung
(legendär) — jeweils *jede* tägliche Routine an so vielen Tagen in Folge. Eine einzelne
Routine hält man leicht durch; alle zusammen ist der Maßstab, der etwas aussagt. Der
Katalog steht damit bei **32**.

`SoulContext` bekommt dafür die Aufgaben mit dazu.

Durchgespielt: vier Routinen an vier Tagen in Folge erledigt → „4 / 4", „Alles erledigt
an 4 Tagen in Folge", je Routine „4 Tage in Folge", Seele *Drei Tage Ordnung*
eingesammelt. Eine Lücke in der Mitte einer Reihe bricht die Serie korrekt.

---

## „4 von 4" bei zwei Einheiten

Der Nutzer meldete vier gezählte Einheiten bei zwei absolvierten. Die Auswertung rechnete
richtig — in den Daten standen tatsächlich vier: Reste des Fehlers, bei dem *Plan neu
erzeugen* eine zweite Einheit auf einen Tag legte, an dem schon eine protokolliert war.
Beide wurden abgehakt, beide zählen.

Der Fehler ist behoben, die Altlast blieb. Und sie war schwer zu finden: eine erledigte
Einheit sieht aus wie jede andere, und dass eine Zahl aus vier Einträgen besteht, sieht
man ihr nicht an.

### Die Zahl aufmachen

Unter den Kacheln steht jetzt **Welche Einheiten sind das?** und klappt genau die Liste
auf, aus der „x von y" entsteht — Datum, Titel, Status. Eine Zahl, die man nicht
nachschauen kann, glaubt man irgendwann nicht mehr.

### Doppelte finden und entfernen

`findDuplicateSessions()` sucht erledigte Einheiten mit **gleichem Tag und gleicher Art**.
Das kann der Generator nicht erzeugen — ein Doppeltag ist immer Kraft *und* Laufen —,
also ist jedes solche Paar ein Fehleintrag. Behalten wird die Einheit mit Protokoll,
sonst die ältere.

Gefundene Paare stehen als Hinweis oben auf der Statistik, mit den betroffenen Tagen und
einem Knopf *Doppelte entfernen*. Gelöscht wird nur auf Ansage: Verlauf verschwindet
nicht von selbst, auch fehlerhafter nicht.

Nachgestellt: zwei Einheiten protokolliert, beide gedoppelt → „4 von 4", Hinweis nennt
beide Tage, die aufgeklappte Liste zeigt jeden Eintrag zweimal → *Doppelte entfernen* →
„2 von 2".

---

## Das Logbuch

Der Verlauf war über die App verstreut: erledigte Einheiten standen im Plan zwischen den
geplanten, Reste aus ersetzten Plänen unter *Früher erledigt*, korrigieren ließ sich
etwas nur dort, wo man es zufällig fand. Dabei ist genau dieser Verlauf die Grundlage
von allem — Statistik, Stufen und Seelen rechnen daraus.

Also bekommt er einen eigenen Ort: **Logbuch**, als sechster Tab.

### Was drinsteht

Alle Einheiten mit Status *erledigt*, nach Monat gruppiert, neueste zuerst — unabhängig
davon, ob der Plan, aus dem sie stammen, noch existiert. Oben drei Zahlen (Einheiten,
Minuten, Kilometer) und ein Filter für Laufen/Kraft.

Ein Eintrag klappt auf und zeigt, was protokolliert wurde: RPE, Distanz, Gefühl, Notiz,
Stufe und den Ablauf der Einheit. Darunter drei Wege:

| | |
|---|---|
| **Bearbeiten** | öffnet das Protokollformular mit den gespeicherten Werten |
| **Zurück auf geplant** | der Eintrag zählt nicht mehr mit, die Einheit bleibt |
| **Eintrag löschen** | Einheit, Protokoll und Satzeinträge, mit Rückfrage |

Alle drei ziehen die Stufen automatisch nach (`relevelPlannedProgression`), weil sie über
`plan-store` laufen. Was hier geändert wird, ändert sich überall — das steht auch so im
Hinweis über der Liste.

### Was dadurch woanders verschwindet

- Die Duplikat-Erkennung samt Aufräumknopf sitzt jetzt hier; die Statistik zeigt nur noch
  einen Hinweis mit Verweis. Doppelte Einträge sind ein Problem des Verlaufs, nicht der
  Auswertung.
- Die Liste *Früher erledigt* auf dem Plan-Screen ist auf einen Satz mit Link
  geschrumpft. Der Plan zeigt den Plan; der Verlauf hat jetzt sein eigenes Zuhause.
- Unter den Statistik-Kacheln steht bei der aufgeklappten Liste *Im Logbuch bearbeiten*.

### Kein eigener Tab

Zuerst als sechster Tab gebaut, auf Wunsch wieder herausgenommen: die Leiste bleibt bei
fünf. Das Logbuch ist nichts, was man täglich öffnet — man geht hin, wenn eine Zahl
falsch aussieht oder ein Eintrag korrigiert gehört.

Der Weg dorthin steht jetzt im **Plan**, direkt unter *Stand im Block*: eine Zeile mit
Buchsymbol, der Anzahl erledigter Einheiten und dem, was dort möglich ist. Der Plan zeigt,
was ansteht — der Verlauf gehört daneben, nicht in die Leiste. Zurück führt oben links
ein *‹ Plan*, weil das Logbuch selbst nicht mehr in der Leiste hängt.

Durchgespielt: drei Einheiten protokolliert → Logbuch zeigt 3 / 125 Min → einen Eintrag
auf 77 Min bearbeitet → Summe 177 → Filter *Kraft* zeigt 1 / 60 Min → einen Eintrag
gelöscht → Einheit **und** Protokoll weg (3/3 → 2/2). Alle neun Screens laden fehlerfrei.

---

## Der Weg

Der Aufgaben-Tab war eine Liste. Er wird zu einem **Weg**: von null zurück in einen
Alltag, der trägt. Kein zweites Aufgabensystem, sondern eine Ordnung über dem, das es
schon gibt — die Schritte des Wegs *sind* tägliche Aufgaben und stehen dort, wo alle
täglichen Aufgaben stehen.

Alle Festlegungen kommen aus drei Fragerunden mit dem Nutzer; nichts davon ist geraten.

### Vier Bereiche, einer nach dem anderen

| # | Bereich | Warum an dieser Stelle |
|---|---|---|
| 1 | Hygiene und Körper | Hängt von niemandem ab außer dir und wirkt sofort |
| 2 | Schlaf und Erholung | Bei zwölf Stunden im Wechsel hängt alles andere daran |
| 3 | Ernährung und Einkauf | Kleinster Sprung von dort, wo er schon ist — das Training läuft |
| 4 | Haushalt und Ordnung | Der größte Brocken; mit stehendem Alltag Arbeit, ohne eine Wand |

Nur **ein** Bereich ist aktiv. Der nächste kommt erst dazu, wenn der aktuelle steht —
mehr Fronten gleichzeitig ist genau der Grund, warum es vorher nicht geklappt hat. Der
vorige wird dabei nicht „abgeschlossen", sondern **established**: seine Routinen laufen
weiter, sie stehen nur nicht mehr im Vordergrund. Etwas fertig zu nennen, was täglich
stattfindet, wäre eine Lüge.

### Stufe 0 ist lächerlich klein

Ein einziger Schritt: *Zähne putzen, morgens und abends*. Wer bei null anfängt, scheitert
an jedem ambitionierten Startpaket. Alle **3 Tage Serie** kommt ein Schritt dazu, nach
**14 Tagen** fragt die App, ob der nächste Bereich dran ist — sie fragt, sie entscheidet
nicht.

Was als Nächstes dazukommt, steht sichtbar unter der Liste. Das nimmt dem Aufstieg die
Überraschung, ohne ihn vorwegzunehmen.

### Die Serie, und was sie nicht bricht

Ein Tag zählt, wenn alles erledigt wurde, was es an dem Tag **schon gab**. Ohne diese
Einschränkung setzte jede neue Stufe die Serie auf null: der frisch dazugekommene Schritt
hat für gestern nichts vorzuweisen und könnte es auch nicht. Man käme nie über drei Tage
hinaus — der Weg hätte sich selbst blockiert.

Tage mit **Krank** oder **Urlaub** werden übersprungen: sie zählen nicht mit, brechen aber
auch nicht. Dafür trägt `ShiftType` jetzt `pausesRoutines`, getrennt von
`cancelsPlanned` — beim Training unterscheiden sich Urlaub und Krankheit (im Urlaub
trainiert man, krank nicht), beim Alltag verhalten sie sich gleich.

Reißt die Serie doch, fängt sie neu an — **die Stufe bleibt**. Wie überall in dieser App:
nichts wird verschenkt, nichts bestraft.

### Brocken

Der Rückstand, der in einem Bereich liegt: Wäscheberg, Bad putzen, Kühlschrank ausräumen.
Je Bereich gibt es einen Katalog typischer Brocken zum Übernehmen, eigene kommen über das
normale Formular dazu. Sie gehören **nicht** in die tägliche Serie — sie schrumpfen nur,
und der Zähler sagt, wie weit. Sie halten den nächsten Bereich auch nicht auf; der
Freischalt-Hinweis erwähnt sie, mehr nicht.

### Drei Seelen

*Der erste Schritt zurück* (Stufe 1 erreicht), *Etappe steht* (ein Bereich läuft von
selbst, je Bereich einmal), *Wieder im Griff* (alle vier stehen, legendär). Der Katalog
ist damit bei **35**.

### Geprüft

Serie-Regeln als Einzeltest: lückenlos 11 Tage → 11; Lücke vor zwei Tagen → 2; dieselbe
Lücke als Kranktag → 10 (übersprungen, nicht gebrochen); heute noch nicht abgehakt → die
Serie von gestern bleibt; Tage vor dem ersten Schritt zählen nicht.

Im Browser durchgespielt: Start bei 0/1 → nach 3 Tagen Stufe 1 mit *Duschen* → nach 14
Tagen alle fünf Schritte und das Angebot *Schlaf und Erholung dazunehmen* → nach dem
Freischalten Etappe 2 bei Stufe 0, Hygiene steht als „läuft". Brocken aus dem Katalog
übernommen. Einen Weg-Schritt unter *Täglich* abgehakt → die Weg-Karte zeigt sofort 1/1
und „1 Tag in Folge". Auf dem Heute-Screen steht er zwischen den anderen Routinen.

Schema auf Version 9: Tabelle `wayAreas`, `Task.wayArea`/`wayOrder`,
`ShiftType.pausesRoutines`.

---

## Der Weg wird ein Pfad

Die Etappe stand als Karte da: Bereich, Stufe, Serie, eine Liste Schritte. Korrekt, aber
ohne Zug. Was fehlte, war das, was Sprach-Apps richtig machen — man **sieht** den Weg:
wo man steht, was hinter einem liegt, was kommt.

Also eine Kette von Knoten, ein Knoten je Schritt, am Ende jedes Bereichs ein
Etappenziel. 24 Knoten insgesamt.

Die Umsetzung bleibt aber in der Sprache dieser App: eine Akzentfarbe, kein Konfetti,
keine Maskottchen, keine Belohnungstöne.

| Zustand | Aussehen |
|---|---|
| erreicht | gefüllter Kreis, Haken |
| aktuell | offener Kreis mit **Fortschrittsring** — die Tage bis zum nächsten Knoten |
| gesperrt | blasser Umriss mit Nummer, Titel trotzdem lesbar |
| Etappenziel | Raute statt Kreis — dasselbe Zeichen wie bei den Seelen |

Genau **ein** Knoten ist der aktuelle. Steht ein Bereich kurz vor dem Abschluss, rückt er
auf das Etappenziel vor, sonst hätte man zwei Stellen, an denen es weitergeht.

Gesperrte Schritte stehen mit Titel da, nicht als Fragezeichen: ein Weg, dessen Ende man
nicht sieht, ist kein Weg, sondern ein Laufband.

### Technisch unspektakulär

Der Schlangenlauf ist ein Versatz aus einer festen Folge (`0, 46, 64, 46, 0, −46, −64,
−46`), die Knoten sind absolut positioniert, die Spur dazwischen sind zwei interpolierte
Punkte. Eine echte SVG-Kurve bräuchte Koordinaten, die sich mit der Bildschirmbreite
ändern — Punkte tun es genauso und überleben jede Breite.

Der Zeilenabstand (124 px) trägt Kreis, Abstand und zwei Zeilen Beschriftung und lässt
darunter noch Platz für die Spur. Beim ersten Versuch mit 96 px lief der Text in die
Punkte des nächsten Knotens.

### Zwei Orte

Auf dem **Aufgaben-Tab** steht nur der Ausschnitt um die aktuelle Stelle — einer davor,
drei danach. Der ganze Pfad wäre am Anfang des Tages eine Wand.

**`/weg`** zeigt alles, nach Etappen gruppiert, mit einem Zähler oben (*5 von 24 Knoten*).
Erreichbar über *Den ganzen Weg ansehen* unter dem Ausschnitt, zurück über *‹ Aufgaben* —
dasselbe Muster wie beim Logbuch.

Ein Knoten ist antippbar und zeigt Titel, Notiz und Zustand. Abgehakt wird weiter unter
*Täglich*: Der Nutzer hatte sich ausdrücklich für **eine** Liste entschieden, und ein
zweiter Haken am selben Schritt wäre genau das, was er nicht wollte. Das Detail sagt das
auch so.

---

## Ordnung im Aufgaben-Tab

Der Tab war gewachsen, nicht gebaut: **sieben Abschnitte in einem Scroll** — Der Weg,
Heute möglich, Neu, Termine, Täglich, Haushalt, Erledigt. Alle gleich laut, alle
gleichzeitig sichtbar, der Knopf zum Anlegen mittendrin. Der Weg allein war länger als
ein Bildschirm.

Das Problem war nicht die Menge, sondern dass drei verschiedene Anlässe übereinander
lagen. Man kommt aus einem von drei Gründen hierher:

| Anlass | Ansicht |
|---|---|
| Wo stehe ich? | **Weg** — Etappe, Pfadausschnitt, Brocken, kommende Bereiche |
| Was ist heute dran? | **Routinen** — Tagesstand, Serien, Sieben-Tage-Raster |
| Was liegt sonst an? | **Aufgaben** — Energie des Tages, Neu, Termine, Haushalt, Erledigt |

Also stehen sie jetzt getrennt, hinter einem Umschalter am Kopf des Tabs. Neben
*Routinen* und *Aufgaben* steht, wie viel dort offen ist; am *Weg* nicht, denn dort gibt
es nichts abzuhaken — dort steht eine Etappe, kein Rest. Eine Null wird weggelassen:
„Aufgaben 0" ist keine Information, sondern Rauschen.

### Innerhalb der Ansichten

- **Heute möglich** war eine eigene Sektion mit Karte für drei Chips. Jetzt eine Zeile
  über der Liste — es ist der Rahmen für das, was darunter steht, nicht selbst ein Thema.
- **Neu** stand zwischen Haushalt und Erledigt. Jetzt oben in der Aufgaben-Ansicht: es
  ist die Hauptaktion dort, nicht ein Nachtrag.
- **Routinen** sind nach Herkunft gruppiert — *Aus dem Weg* und *Eigene Routinen*, jeweils
  mit eigenem Tagesstand. Woher eine Routine kommt, entscheidet, ob man sie streichen
  darf: ein Weg-Schritt gehört zur Etappe, eine eigene nicht. Das kleine „Weg"-Etikett an
  der einzelnen Zeile ist damit überflüssig geworden und entfallen.
- Der Weg braucht keine Überschrift „Der Weg" mehr — die Ansicht heißt so. Sie heißt jetzt
  *Aktuelle Etappe*.

Die Ansicht bleibt beim Wechseln nicht gespeichert: Der Weg ist der Rahmen, also steht er
beim Öffnen da.

---

## Tag für Tag statt Rotation

Die ganze Planung stand auf einer Annahme: es gibt eine Rotation, die sich endlos
wiederholt. Das stimmte, solange der Dienstplan wirklich so lief. Sobald er jeden Monat
anders aussieht, ist man nur noch damit beschäftigt, die Rotation zu korrigieren.

Also gibt es jetzt **zwei Wege**, oben auf dem Schicht-Screen umschaltbar:

- **Tag für Tag** — du trägst ein, was auf dem Dienstplan steht.
- **Nach Rotation** — wie bisher, für den Fall, dass es wieder regelmäßig wird.

Abschalten löscht die Folge nicht, sie greift nur nicht mehr. Wer zwischen den Wegen
probiert, soll sie nicht jedes Mal neu eintippen.

### Ein Tag ohne Eintrag ist kein freier Tag

Mit Rotation war ein Tag ohne Abweichung ein Tag aus der Folge. Ohne Rotation wäre er
nach der alten Regel eine Freischicht gewesen — und der Plan hätte fröhlich Training auf
Tage gelegt, von denen niemand etwas weiß. Deshalb gibt es `UNPLANNED_SHIFT`:
*Nicht eingetragen*, Kapazität `none`, Kürzel `–`.

Daraus folgt der **Planungshorizont**: `planningHorizon()` liefert ohne Rotation den
letzten eingetragenen Tag, und der Generator hört dort auf. Vorher erzeugte er
pflichtschuldig 15 Zyklen und meldete *„78 Einheiten fanden keinen Tag"* — technisch
korrekt, praktisch Unsinn. Jetzt: *„12 Einheiten über 2 Zyklen."* Der Plan reicht so weit
wie dein Wissen, keinen Tag weiter.

### Monatsraster

Der Dienstplan kommt als Monatsblatt, und so denkt man auch darüber. Eine Liste der
nächsten 21 Tage kann man abarbeiten, aber nicht überblicken — und genau der Überblick
ist der Grund, warum man draufschaut.

`MonthGrid` kennt weder Schichten noch Training: sie bekommt je Tag ein Kürzel, eine
Farbe und optional einen Punkt. Dadurch tragen Schicht- und Plan-Screen dasselbe Raster,
ohne voneinander zu wissen.

| Screen | Raster zeigt | Antippen |
|---|---|---|
| **Schicht** | Schichtkürzel, Punkt = Training geplant | Schicht dieses Tages setzen |
| **Plan** | dasselbe Kürzel, Punkt orange = geplant, grau = erledigt | Tagesdetail mit Einheit, Aktionen und Schichtwechsel |

Die Zyklusliste auf dem Plan-Screen ist damit entfallen. Sie war eine Liste von Listen;
das Monatsraster sagt dasselbe auf einem Blick und lässt sich Monat für Monat
zurückblättern.

### Jede Änderung wirkt

Der Fingerabdruck der Planungsgrundlage hatte eine obere Grenze — er endete am letzten
Tag des Plans. Trug man Schichten für den **nächsten** Monat ein, änderte sich nichts,
weil der Plan dort noch gar nicht hinreichte. Die Grenze ist gefallen: alle Abweichungen
ab heute zählen. Damit verlängert ein neu eingetragener Monat den Plan von selbst.

Ebenso gibt `syncPlan()` nicht mehr auf, wenn der Plan abgelaufen ist — solange
Schichten in der Zukunft stehen, gibt es etwas zu planen.

Durchgespielt: auf *Tag für Tag* umgestellt → alle Tage zeigen `–` → 14 Tage Freischicht
gesetzt → Plan erzeugt: 12 Einheiten über 2 Zyklen, nichts unplatziert → den 8. auf
Tagschicht gesetzt → *„Plan angepasst: an 4 Tagen liegt jetzt etwas anderes"*, der 8. ist
leer, die Einheiten haben sich drumherum neu verteilt.

Ohne Rotation heißt ein Zyklus **Woche** — es ist keine Rotation mehr da, auf die sich
das Wort beziehen könnte. Die Hochrechnung *Passt das zusammen?* erscheint nur mit
Rotation: ein Schnitt über nicht eingetragene Tage sagt nichts.

---

## Das Regelwerk — Schlaf, Schicht, Training, Ernährung

Die bisherigen Planungsregeln sind vollständig ersetzt. Nicht angepasst: ersetzt.

### Warum der alte Generator nicht reichte

Er sammelte die Wochenziele als Wünsche ein und verteilte sie anschließend per Best-Fit
auf die Tage. Solange die einzige Frage „Wie viel Zeit hat der Tag?" lautete, ging das auf.
Die neuen Regeln fragen aber am **einzelnen Tag** nach der Erholung und zählen an
**Wochengrenzen** (höchstens drei harte Einheiten, nie mehr als zwei harte Tage in Folge,
Volumen plus 5–10 % gegenüber der Vorwoche). Ein Verfahren, das erst alles einsammelt und
dann verteilt, kann keine dieser Regeln zuverlässig einhalten — es weiß beim Verteilen
nicht mehr, in welcher Reihenfolge die Tage kommen.

Der neue Generator läuft deshalb **Tag für Tag von vorn nach hinten** und führt eine
Wochenbilanz mit. Ein Mikrozyklus ist jetzt eine Kalenderwoche.

### Drei Intensitäten statt Kapazitätsstufen

Jede Einheitsart trägt eine `intensity`:

| | Ausdauer | Kraft |
|---|---|---|
| **hart** (RPE 8–10) | Intervalle, Schwellenlauf, Tempolauf, Long Run mit Endbeschleunigung | Kraft schwer, Kraft Unterkörper |
| **mittel** (RPE 6–7) | Langer Lauf locker, Zügiger Dauerlauf, Steigerungslauf | Kraft Hypertrophie, Oberkörper, Ganzkörper |
| **locker** (RPE 3–5) | Lockerer Lauf, Regenerationslauf, Spaziergang | Kraft kurz, Technik, Mobility |

`countsAsHardDay` wird nicht mehr einzeln gepflegt, sondern aus der Intensität abgeleitet.
Damit zählt jetzt auch **schweres Krafttraining** als harter Tag — vorher nur harte Läufe.

Die alten Schlüssel bleiben im Katalog, auch wo neuere sie fachlich ablösen: Sie stehen in
erledigten Einheiten im Logbuch, und Verlauf wird nicht umgeschrieben.

### Die Matrix (`rules.ts`)

Fünf Schichtarten × drei Erholungsstufen, als Tabelle geschrieben statt als verschachtelte
Bedingungen — so ist auf einen Blick prüfbar, ob sie stimmt:

| | hoch | mittel | niedrig |
|---|---|---|---|
| **Tagschicht** | Ruhetag | Ruhetag | Ruhetag |
| **Nachtschicht** | hart | mittel | locker (freiwillig) |
| **Schlaftag** | mittel | locker | Ruhetag |
| **Freischicht** | hart | mittel | locker (freiwillig) |
| **V-Schicht** | mittel, nur Laufen | locker, nur Laufen (freiwillig) | Ruhetag |

Danach schneiden die globalen Regeln nach unten:

- **Große Schlafschuld** oder **unter 5 h Schlaf** → höchstens locker.
- **Etwas Schlafschuld** oder **unter 6,5 h Schlaf** → nichts Hartes.
- **Drei harte Einheiten** in der Woche *oder* in den letzten 7 Tagen → nichts Hartes mehr.
  Die zweite, rollierende Prüfung ist nötig, weil sich die Wochengrenze sonst umgehen
  ließe: sechs harte Tage in acht, drei auf jeder Seite des Montags.
- **Zwei harte Tage in Folge** → der dritte wird leichter.
- **Deload-Woche** → nichts Hartes.

### Erholung kommt von Hand

Cllctr hat keinen Server, keinen Login und keinen Zugriff auf eine Uhr — es gibt niemanden,
der die Erholung liefern könnte. Sie wird deshalb pro Tag eingetragen (Tabelle `readiness`,
Primärschlüssel Datum), bewusst grob: niedrig/mittel/hoch, Schlafstunden, Schlafschuld in
drei Stufen. Was man morgens in fünf Sekunden ehrlich beantworten kann, wird eingetragen.

Für einen Tag **ohne Eintrag** gilt:

- **heute und in der Vergangenheit** → `mid`. Wie es einem geht, weiß man am selben Tag;
  wer nichts einträgt, bekommt keine harte Einheit geschenkt.
- **in der Zukunft** → `high`. Das ist keine Annahme über den Körper, sondern über den
  Plan: Er muss die harten Einheiten irgendwo hinlegen, sonst gibt es nie welche und die
  Steigerung steht still. Trägt man später etwas Schlechteres ein, gibt der Plan von selbst
  nach — das ist die Richtung, in der die Regel wirken soll.

Ohne diese Unterscheidung war der erzeugte Plan über acht Wochen **komplett ohne harte
Einheit**: Alles stand auf `mid`, und `mid` deckelt überall auf mittel.

### Auswahl der Einheit

Steht die erlaubte Intensität fest, entscheidet der Bedarf der Woche, welchen Platz der Tag
füllt: harte Ausdauer, schwere Kraft, mittlere Kraft, lockerer Lauf. Die harten Läufe
rotieren (Intervalle → Long Run → Schwelle → Tempo), damit über einen Monat jede Art
zweimal drankommt. Dieselbe Disziplin kommt nicht zweimal hintereinander hart.

**Sind die Wochenziele gedeckt, bleibt der Tag frei.** Nur direkt nach einem harten Tag
steht noch Mobility als aktive Erholung. Ohne diese Grenze bekäme jeder Tag, an dem
irgendetwas erlaubt ist, auch irgendetwas zugewiesen — der Plan wäre voll und „Erholung
steht über dem Training" stünde nur im Text.

### Progressive Overload mit Deckel

Die Einheiten wachsen weiterhin einzeln nach ihrer eigenen Stufe (`progression.ts`, siehe
oben). In Summe kann eine Woche dadurch einen Sprung machen, den keine der Einheiten für
sich gerechtfertigt hätte — und genau daran gehen Läufer kaputt. Deshalb prüft
`capWeeklyVolume()` das Wochenvolumen gegen die **letzte volle Belastungswoche**:

- Wächst es um mehr als `weeklyVolumeGrowthPct` (Standard 8 %), werden Einheiten gekürzt —
  erst die lockeren, dann die mittleren, **nie die harten**. Der harte Reiz ist der Sinn
  der Woche; das lockere Volumen ist die Stellschraube.
- Lag die Erholung an zwei Tagen der Woche niedrig, wird das Volumen **gehalten** statt
  gesteigert.
- Deload-Wochen werden nicht gedeckelt — dort ist weniger die Absicht.

Bezugspunkt ist bewusst die letzte volle Belastungswoche und nicht die Vorwoche: Nach einem
Deload ist die Rückkehr aufs alte Volumen keine Steigerung, und eine angebrochene erste
Woche taugt als Maßstab überhaupt nicht.

### Ernährung (`nutrition.ts`)

Neu und bewusst **nicht gespeichert**, sondern jedes Mal aus dem Tag berechnet: Verschiebt
sich die Einheit oder ändert sich die Schicht, stimmt eine gespeicherte Empfehlung nicht
mehr — und eine falsche ist schlimmer als gar keine.

Die App kennt weder Gewicht noch Körperfett und rechnet deshalb keine absoluten Kalorien
aus. Was sie sagen kann, ist die Richtung — und die ist im Schichtdienst die eigentliche
Frage:

| Tag | Energie | Kohlenhydrate |
|---|---|---|
| hart | Erhalt bis leichter Überschuss | hoch, der Großteil um das Training |
| mittel | Erhalt oder leichtes Defizit | moderat, um das Training herum |
| locker / frei | leichtes Defizit möglich | niedriger, Protein und Gemüse im Vordergrund |

Mit zwei Ausnahmen, die schwerer wiegen als die Tabelle: **nach einer Nachtschicht** und
**bei großer Schlafschuld** kein Defizit. Zum Schlafmangel noch den Energiemangel zu legen,
zieht die Erholung doppelt nach unten.

Dazu die schichtspezifischen Hinweise: größere Mahlzeit 2–4 h vor der Nachtschicht, nachts
nur kleine Snacks, Koffein nur in der ersten Schichthälfte; nach dem Hauptschlaf am
Schlaftag die erste richtige Mahlzeit; an Tag- und V-Schichten genug Energie für zwölf
Stunden Arbeit einpacken.

### Wo das im Alltag auftaucht

Eine Karte, `DayCoach`, auf dem Heute-Screen und im Tagesdetail des Plans. Sie enthält die
drei Dinge in der Reihenfolge, in der sie zusammenhängen: **Erholung eintragen** (die
Eingabe), **was heute geht** (die Folgerung), **Ernährung** (die zweite Folgerung). Sie auf
drei Ecken der App zu verteilen hieße, genau den Zusammenhang zu verstecken, auf den es
ankommt.

Jede geplante Einheit trägt zusätzlich `planReason`: den Satz aus dem Regelwerk, der
erklärt, warum an diesem Tag diese Intensität steht. `explain.ts` benutzt ihn, statt aus
der Kapazität eine zweite Begründung zu bauen — zwei Wahrheiten zu pflegen ginge schief.

### Geprüft

Ein Regelwerk, das man nicht prüfen kann, ist eine Behauptung. Getestet wurde gegen die
Spezifikation, nicht gegen die Implementierung:

- Alle **18 Zellen der Matrix** (5 Schichtarten + `off` × 3 Erholungsstufen) gegen die
  Vorgabe. V-Schicht: nie Kraft, nie hart. Tagschicht: bei keiner Erholung eine Einheit.
- Jede globale Regel einzeln: Schlafschuld, kurze Nacht, Wochenkontingent, rollierende
  7 Tage, harte Tage in Folge, Deload, Krankheit.
- Katalog: `countsAsHardDay` folgt der Intensität, harte Einheiten RPE ≥ 7, lockere ≤ 5.
- Ein **vollständiger Plan über acht Wochen** auf der echten Rotation: kein Training an
  Tagschichten, keine Kraft an V-Schichten, nie mehr als zwei harte Tage in Folge, nie mehr
  als drei harte Einheiten pro Woche, keine harte Einheit in einer Deload-Woche, kein Tag
  mit zwei Einheiten, Volumenwachstum ≤ 8 % gegenüber der letzten Belastungswoche,
  Deload-Woche unter der Belastungswoche.
- Derselbe Plan mit durchgehend **niedriger Erholung**: nichts über locker, deutlich
  weniger Einheiten.
- Ernährung: harter Tag im Überschuss, Nachtschicht mit Mahlzeit- und Koffein-Hinweis,
  Tagschicht mit Hinweisen trotz fehlender Einheit, große Schlafschuld nie im Defizit.

Dazu im Browser durchgespielt: Plan erzeugt (67 Einheiten über 13 Wochen, 17 Ruhetage),
Tagesdetails geöffnet, Erholung auf *Niedrig* gesetzt — die Regel und die
Ernährungsempfehlung ändern sich sofort mit.

### Was dabei kaputtging und repariert wurde

- `createAndSavePlan()` las die Erholung **innerhalb** der Dexie-Transaktion, ohne
  `db.readiness` im Transaktionsbereich. Dexie brach ab, der Plan wurde stumm nicht
  erzeugt. Tabelle ergänzt.
- Die neue Tabelle kam als **Datenbankversion 2**. Eine bestehende Datenbank steht auf
  IndexedDB-Version 1 und bekommt ohne erhöhte Nummer kein `onupgradeneeded` — die Tabelle
  hätte schlicht gefehlt.
- `Long Run mit Endbeschleunigung` hatte den zügigen Schluss erst ab Stufe 4. Der Titel
  versprach damit etwas, das die ersten vier Male nicht drinstand — und ohne ihn wäre die
  Einheit der lange lockere Lauf, den es als eigene Art gibt. Der Schluss ist jetzt von
  Anfang an dabei und wächst von 5 auf 15 Minuten.

---

## WHOOP, Ernährung als Tab, kompakte Steigerung

### Die Statistik ist weg

Der fünfte Tab war *Statistik*: Wochenvolumen, Zonenverteilung, RPE-Verlauf, Deload-Signal.
Er ist ersatzlos gestrichen. Was dort stand, war eine Nacherzählung des Logbuchs in
Diagrammform — und ein Diagramm, das nur bestätigt, was man ohnehin weiß, ist kein Feature,
sondern 121 kB JavaScript.

Zwei Dinge sind mitgezogen statt zu verschwinden:

- **Bestwerte** stehen jetzt im **Logbuch**. Sie sind kein Diagramm, sondern die Spitze
  dieses Verlaufs — sie gehören dorthin, wo die Einträge liegen, aus denen sie entstehen.
- Die **Doppel-Erkennung** lag ohnehin schon im Logbuch.

Gelöscht: `src/app/statistik/`, `src/components/charts.tsx`, `src/lib/stats.ts`.

### Ernährung bekommt den freien Platz

Der Tab heißt jetzt **Ernährung**. Er zeigt drei Dinge:

1. **Heute** — die volle Empfehlung: Richtung, Makros, Timing, schichtspezifische Hinweise.
2. **Die nächsten Tage** — sechs Zeilen, je eine pro Tag, mit Energierichtung und der
   geplanten Einheit. Antippen klappt die Einzelheiten auf. Der Sinn ist praktisch: Wer am
   Freitag sieht, dass Sonntag Intervalle stehen, kauft am Samstag anders ein.
3. **Die Regel dahinter** — die Tabelle, nach der die App entscheidet.

Gerechnet wird weiterhin bei jedem Aufruf aus `nutrition.ts`; gespeichert wird nichts.

### WHOOP: die Zahlen von der Uhr

Es gibt **keine Schnittstelle**. Cllctr hat keinen Server und keine API-Schlüssel — das ist
der Kern des Projekts, nicht eine fehlende Funktion. Übertragen werden deshalb die Zahlen,
die morgens ohnehin auf dem Bildschirm stehen:

| Feld | wofür |
|---|---|
| Recovery % | wird zur Erholungsstufe |
| Schlaf (h) | wird zur Schlafdauer |
| Sleep Debt (h) | wird zur Schlafschuld |
| Day Strain, HRV, Ruhepuls | nur Verlauf, hinter dem Aufklapper |

Die Umrechnung nutzt **WHOOPs eigene Farbgrenzen**: rot bis 33 % ist `low`, gelb bis 66 %
ist `mid`, grün darüber ist `high`. Eigene Schwellen zu setzen hieße, der Zahl auf dem
Handgelenk zu widersprechen — dann stünde in der App etwas anderes als auf der Uhr. Die
Sleep Debt wird bei einer Stunde und bei drei Stunden geschnitten; unter einer Stunde ist
Rauschen, ab drei fehlt eine halbe Nacht.

`setWhoop()` schreibt die Rohwerte **und** überschreibt die abgeleiteten Felder. Ohne das
Überschreiben stünde auf der Uhr 28 % und in der App weiter „mittel", weil dort die
Einschätzung von gestern klebt. Die drei Knöpfe darunter bleiben als Ausweg: für Tage ohne
Uhr, und für einen Wert, den man nicht glaubt.

Die Rohwerte werden aufgehoben, nicht nur die Stufe: 68 % und 34 % sind beide „mittel bis
hoch" und erzählen doch Verschiedenes. Wer die Zahl behält, kann später anders auswerten.

### Eine Eingabe, die sofort wirkt

Der Fingerabdruck der Planungsgrundlage wurde in `AppShell` ohne die Erholung gebildet —
und weil Dexies `liveQuery` nur beobachtet, was sie tatsächlich liest, änderte sich beim
Eintragen der WHOOP-Werte gar nichts. Die Karte zeigte sofort „locker", im Plan stand
weiter die mittlere Krafteinheit.

Jetzt liest die Abfrage die Erholungstabelle mit. Durchgespielt: Recovery auf 22 %
gesetzt → die Einheit des Tages wird zum lockeren Lauf, die Ernährung wechselt auf „kein
Defizit bei großer Schlafschuld"; danach auf 85 % → *„Plan angepasst: an 22 Tagen liegt
jetzt etwas anderes"*, heute stehen Intervalle.

Dieselbe Zahl wirkt auch auf den **Haushalt**: Bei niedriger Erholung fällt das
Aufgabenbudget auf `light`. Sonst hätte die App auf demselben Bildschirm das Training auf
locker heruntergesetzt und zwei Zeilen tiefer den Großputz vorgeschlagen.

### Die Steigerung nimmt keine halbe Seite mehr ein

Aus 6 steigernden Einheitsarten sind 12 geworden — als Liste mit Titel, Detailzeile und
Stufe waren das zwei Bildschirmhöhen für eine Zahl, die man selten braucht. Jetzt steht der
Stand als **Kachelfeld**: Name und Stufe pro Kachel, drei Zeilen statt vierundzwanzig. Die
Einzelheiten und die Korrekturknöpfe erscheinen erst beim Antippen einer Kachel.

### Die Seelen kennen die neuen Regeln

- **Entfernt: „Doppelt genommen".** Der neue Generator plant nie zwei Einheiten an einem
  Tag. Eine Seele, die der Plan nicht mehr hergibt, ist keine Belohnung, sondern eine
  Sackgasse.
- **„Auf breiter Front"** verlangte jede steigernde Art auf Stufe 5. Bei 12 Arten wäre das
  unerreichbar geworden, ohne dass jemand etwas falsch gemacht hätte — jetzt zählen die
  sechs **Kernarten**, um die der Generator den Plan baut.
- **„Im Zaum gehalten"** schloss den Long Run ein. Der trägt inzwischen eine
  Endbeschleunigung und zählt als hart; RPE 4 wäre dort kein Zeichen von Disziplin,
  sondern eine verpasste Einheit. Jetzt zählen nur Läufe der Intensität *locker*.
- **„Jede Schicht bespielt"** fragte die Kapazität. Die Tagschicht hat formal eine, trägt
  aber nie eine Einheit — die Seele war unerreichbar. Jetzt fragt sie das Regelwerk.

Neu dazugekommen, alle an den neuen Regeln aufgehängt:

| Seele | Bedingung |
|---|---|
| **Hingehört** | Fünfmal an einem Tag mit niedriger Erholung nichts Hartes trainiert |
| **Sieben Tage gemessen** | Eine Woche am Stück die Erholung eingetragen |
| **Vier Wochen Daten** | An 28 Tagen die Werte von der Uhr übertragen |
| **Beide Seiten** | In einer Woche harte Ausdauer *und* schwere Kraft erledigt |
| **Ausgereizt, nicht überzogen** | Genau drei harte Einheiten in einer Woche — keine vierte |

„Hingehört" ist die wichtigste davon: Sie belohnt ausdrücklich das *Nicht*-Training. Die
schwerste Übung im Hybridtraining ist, es an einem schlechten Tag sein zu lassen — und ein
Belohnungssystem, das nur Geleistetes zählt, arbeitet genau dagegen.

Der Katalog steht damit bei 23 Seelen. `SoulContext` trägt jetzt die Erholungseinträge mit.

### Schema 11

`DayReadiness.whoop` (Rohwerte), `recoveryFromWhoop()` und `sleepDebtFromHours()` in
`types.ts`, `setWhoop()` in `readiness.ts`.

---

## Entwicklung

```
npm install
npm run dev        # http://localhost:3000
npm run build      # statischer Export nach out/
npm run typecheck
```
