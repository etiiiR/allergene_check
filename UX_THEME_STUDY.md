# Bauchgefühl — UX-Studie und implementierte Richtung

Stand: 23. September 2026. Diese Fassung ersetzt die ursprüngliche Übergabeplanung.

## 1. Grundlage und Grenzen

Dies ist ein heuristisches UX-Audit anhand der Vue-Seiten, CSS-Regeln und bestehenden Abläufe.
Es wurden keine Interviews oder beobachteten Nutzertests durchgeführt. Aussagen über
Bediengeschwindigkeit und Verständlichkeit sind deshalb überprüfbare Ziele, keine nachgewiesenen Ergebnisse.

Untersucht wurden Heute, Tagebuch, Kalender, Rezepte, Muster, FODMAP, Profil und Arztbericht
sowie die Formulare für Mahlzeiten, Befinden, Stress, Stuhl, Rezepte und persönliche Markierungen.

## 2. Beobachtungen und Entscheidungen

| Beobachtung im bisherigen Code | Konsequenz für die Überarbeitung |
| --- | --- |
| Mehr als 4.000 CSS-Zeilen mit vielen späteren Overrides und separaten Grüntönen | Ein gemeinsames Token-System und eine kompakte CSS-Datei mit klaren Komponenten- und Layoutabschnitten |
| Mehrere gleichgewichtige Dashboard-Aktionen und doppelte Einstiege | Eine primäre Mahlzeit-Aktion, zwei Befinden-Aktionen, weitere Beobachtungen als aufklappbarer Bereich |
| Sechs kleine Navigationsziele auf dem Smartphone | Fünf Hauptziele; FODMAP, Bericht und Profil bleiben über Mehr erreichbar |
| Modale Formulare und Details unterbrechen den Lesefluss | Eintrags- und Detailansichten werden im Hauptbereich der Seite angezeigt |
| Speichern ist erst durch das Schliessen des Formulars erkennbar | Sichtbarer Pending-Zustand, Erfolgsfeedback und aktualisierte Daten |
| Kalender bezeichnet einen einzelnen guten Check-in als guten Tag | Gutes Befinden wird ausdrücklich als Moment bezeichnet |
| Analyse zeigt viele Detailabschnitte vor Zutatenmustern | Datenbasis, führende Muster, Stress und weitere Einflüsse zuerst; Details danach |
| Gemischte Schriftfamilien, kleine Texte und dekorative Rezeptgrafiken | Eine Schrift, besser lesbare Hilfstexte und kompakte Rezeptköpfe |

## 3. Produktziele

- Häufige Einträge mit wenigen Entscheidungen ermöglichen.
- Auf jeder Seite die nächste Aktion erkennbar machen.
- Eine Mahlzeit oder einen guten Moment bei vorhandenem Rezept in ungefähr zehn Sekunden erfassen können.
- Bei Fehlern Eingaben erhalten und einen erneuten Versuch ermöglichen.
- Fehlende Dokumentation niemals als Symptomfreiheit interpretieren.
- Eine Oberfläche anbieten, die bei 320px und bei 1440px funktioniert.
- Beobachtungen, persönliche Vermutungen und explorative Zusammenhänge verständlich unterscheiden.

Die Zehn-Sekunden-Vorgabe und die Erkennbarkeit innerhalb von drei Sekunden sind Ziele für spätere
Nutzertests. Automatisierte Browsertests messen sie nicht sinnvoll.

## 4. Visuelles System

### Farbe

Die Grundflächen sind Weiss und helles Slate. Dunkler Slate-Text liefert den Kontrast,
Indigo kennzeichnet aktive Navigation und primäre Aktionen. Grün wurde auf ausdrücklichen
Nutzerwunsch entfernt, auch aus Erfolgs- und Kalenderzuständen. Farbe unterstützt immer ein Textlabel.

| Verwendung | Token / Farbe |
| --- | --- |
| Hintergrund | `--canvas: #f8fafc` |
| Oberfläche | `--surface: #ffffff` |
| Haupttext | `--ink: #17232e` |
| Hilfstext | `--muted: #526171` |
| Trennlinien | `--line: #e2e8f0` |
| Eingaberahmen | `--border-strong: #cbd5e1` |
| Primäraktion | `--accent: #4338ca` |
| Aktive Auswahl | `--accent-soft: #eef2ff` |
| Guter Moment / Speicherung | Indigo mit Check-Symbol / Text |
| Offenes Befinden / Beschwerdehinweis | Amber mit Text |
| Fehler / Löschen | Rot |
| Zyklus / Stress-Kontext | Gedämpftes Violett |

Rot wird nicht pauschal zur Darstellung von Symptomen eingesetzt.
Ein statistischer Zusammenhang ist kein Alarm. Kalender ohne Check-in bekommen keine positive Bewertung.

### Form, Schrift und Abstände

- DM Sans für Navigation, Text und Überschriften; lokal gebundene Fonts.
- Kleine Controls mit 7–8px Radius, Container mit 10px Radius.
- Mindestens 44px hohe Hauptbuttons und Eingabefelder.
- 8/12/16/20/24/32px als Abstandsfolge.
- Dünne Borders statt übereinandergestapelter Schatten.
- Keine dekorativen Gradients, Pflanzen oder künstlichen Rezeptillustrationen.
- Die Dokumentansicht behält ihre kompakten Druckmasse.

### Bibliotheken

Tailwind 4 bleibt der Utility-Unterbau. DaisyUI 5 ist tatsächlich installiert und als Plugin mit
Präfix `d-` eingebunden. Ein eigenes Light-Theme liefert die Bibliotheksfarben.
Vue-Primitives kapseln Button, Card, Badge, Skeleton, Toast und Seiteneditor.
Native Formularelemente verwenden DaisyUI-Klassen und gemeinsame Formregeln.

Die Komponenten folgen dem kleinen, lokal kontrollierten Aufbau von shadcn.
Es wird keine zusätzliche React-Bibliothek und keine zweite konkurrierende Theme-Engine verwendet.
Es handelt sich nicht um eine Installation von shadcn-vue.

Technische Quellen:
[DaisyUI / Vite](https://daisyui.com/docs/install/vite/),
[Konfiguration und Präfix](https://daisyui.com/docs/config/),
[Themes](https://daisyui.com/docs/themes/).

## 5. Navigation und Seiten statt Modals

Die aktuelle Nutzerentscheidung ist verbindlich: **Keine Dialoge, Overlays oder modalen Formulare.**

Desktop verwendet eine linke Navigation mit fünf Hauptzielen und drei sekundären Links.
Mobile verwendet Heute, Tagebuch, Kalender, Rezepte und Muster unten; Mehr öffnet eine kleine
Navigationsliste. Profil bleibt zusätzlich über das Zahnrad erreichbar.

Ein Eintrag öffnet einen fokussierten Editor im Hauptbereich. Die App-Navigation bleibt sichtbar.
Ein Zurück-Link beendet die Bearbeitung. Nach Speichern kehrt die Übersicht mit frischen Daten zurück.
Details, persönliche Markierungen und Löschbestätigungen verwenden denselben Seitenbereich.

Technik: `UiEditor` rendert über Vue Teleport in `#entry-workspace`.
Der vorherige Seiteninhalt bleibt gemountet, wird aber während der Bearbeitung ausgeblendet.
So bleiben Filter, Kalenderauswahl und Formularzustand bei verschachtelten Detailansichten erhalten.
Es gibt keine Fokusfalle und keine Verdunkelung. Beim Öffnen erhält die Überschrift Fokus;
beim Zurückkehren erhält der auslösende Control den Fokus zurück.

Diese Editoren sind lokale Seitenzustände und keine eigenen URLs. Neuladen beendet einen
ungespeicherten Editor. Deep Links und dauerhafte Entwürfe sind eine spätere Erweiterung.

## 6. Nutzerabläufe

### Heute

1. Datum und kurzer Titel.
2. Mahlzeit eintragen als eindeutige Primäraktion.
3. Befinden und gutes Befinden als zwei sekundäre Aktionen.
4. Stress und Stuhl unter Weitere Beobachtungen.
5. Maximal zwei zuletzt verwendete Rezepte als Wiederholen-Buttons.
6. Maximal drei neueste Einträge; Alle ansehen führt ins vollständige Tagebuch.
7. Kleiner Einrichtungshinweis bis zum abgeschlossenen Onboarding, danach mehr Platz für den Alltag.

Die doppelte Momentaufnahme und die zweite Zählerübersicht entfallen.
Ein Hinweis auf offenes Befinden verwendet ausschliesslich heutige Check-ins.
Ein guter Eintrag von gestern darf die heutige Zusammenfassung nicht positiv einfärben.

### Geführte Einträge und persönlicher Start

Beschwerden verwenden zwei Schritte: zuerst Befinden und Stärke, dann zeitliche Einordnung
und Speichern. Zurück erhält die Auswahl; es wird erst beim endgültigen Speichern geschrieben.
Ein guter Moment und eine Mahlzeit bleiben kurze Ein-Schritt-Abläufe. Zusätzliche Angaben
wie Portionen, Stress, Schlaf, Mahlzeitenbezug, Zyklus und Notizen sind bewusst aufklappbar.
Die Uhrzeit ist vor dem Speichern sichtbar. Es gibt keine Dialoge oder versteckten Overlays.

`/onboarding` bietet Person → optionaler Körperkontext → Startklar. Die Einrichtung ist
freiwillig und nicht bei jedem Besuch im Weg. Vorname oder Spitzname genügen. Nach erfolgreichem
Abschluss werden `display_name` und `onboarding_completed` gemeinsam mit den Körper-/Zyklusdaten
im bestehenden SurrealDB-Datensatz `diary_profile:default` gespeichert. Vorhandene Einträge bleiben
unverändert. Der Name ist im Header und standardmässig im Bericht sichtbar; ein ausdrücklich
gewähltes lokales Berichts-Pseudonym hat Vorrang.

Explizite Nutzerentscheidung: **ein benanntes persönliches Profil**, nicht mehrere Personen.
Das ist keine Authentifizierung. Jeder mit Zugriff auf diese lokale Instanz sieht dasselbe
Tagebuch. Unabgeschlossene Wizard-Schritte bleiben nur während der aktuellen Seite erhalten;
es werden keine Entwürfe in Local Storage oder auf dem Server gespeichert.

Das Profil teilt Person, Körper & Zyklus und Health-Import in drei kompakte Ansichten.
So muss niemand für eine Namensänderung durch Health-Import oder Zykluserklärungen scrollen.
Der Health-Bereich bietet jetzt die direkte iOS-Bridge als Haupteinstieg; Datei-Import ist nur
noch ein aufklappbarer Fallback. Die native Implementierung liegt unter `mobile/ios` und
benötigt vor Benutzung noch Xcode-Build, Signierung und Gerätetest.

### Mahlzeiten ohne Kontextwechsel

Die vier Dashboard-Aktionen sind gleich breit und 60px hoch. Ein Rezept kann direkt innerhalb
von Mahlzeit eintragen erstellt werden; Datum und übrige Eingaben bleiben erhalten. Nach dem
Speichern wird das neue Rezept ausgewählt. Es gibt weder Seitenwechsel noch verschachtelte Formulare.

Bei einer Mahlzeit ist **Gut** sichtbar vorausgewählt. Alternativen: Beschwerden (führt nach
der Mahlzeit direkt in den Symptom-Wizard) und Nicht erfassen. Mahlzeit und guter Moment werden
atomar gespeichert. Der gute Moment ist als `meal_baseline` gekennzeichnet: Er beschreibt nur
das Befinden beim Essen und wird nicht als Nachweis späterer Verträglichkeit oder als erfundene
Stress-/Schlafmessung in das Modell aufgenommen. Fehlende spätere Check-ins bleiben unbekannt.
Der Kalender verwendet auf kleinen Displays kompaktere, weiterhin mindestens 44px hohe Tagesbuttons.

**Viewport-Ziel:** Die Tagesübersicht sowie die Hauptaktionen der beiden Beschwerde-Schritte
passen bei 390 × 844px ohne Scrollen über die untere Navigation. Das wird mit Testdaten geprüft.
Bei grösserer Schrift, langen Namen oder geöffneten optionalen Feldern bleibt normales Scrollen
erlaubt. Keine festen Bildschirmhöhen, abgeschnittenen Formulare oder winzigen Touch-Ziele.

### Tagebuch

Einträge werden nach lokalem Kalendertag gruppiert. Die Beschwerdestärke-Sortierung
verwendet bewusst eine gemeinsame Liste, damit ihre Reihenfolge erhalten bleibt.
Datum, Eintragstyp, Symptome und Sortierung bleiben filterbar. Notizen sind aufklappbar.
Löschen wird auf einer Bestätigungsseite erklärt; Abbrechen und Behalten schreiben keine Daten.

### Kalender

Das Monatsraster kennzeichnet Mahlzeiten und Beobachtungstypen. Der gewählte Tag zeigt seine Einträge.
Ein Tag mit Mahlzeit ohne Check-in ist offen. Gute und symptomatische Momente können am selben Tag
nebeneinander vorkommen. Ein Check-in erledigt keinen medizinischen Tagesstatus.
Zukünftige Tage bleiben durchsuchbar, bieten aber keine rückblickende Beobachtungserfassung.

### Rezepte

Suche, kompakte Rezeptkarten, Zutaten und persönliche Markierungen.
Die Hauptaktion pro Rezept ist der Eintrag als Mahlzeit.
Erstellen, Bearbeiten, Zutatenzuordnung, Analyse und Markierungen öffnen Seiteneditoren.
Import und Zutatenanalyse geben eigene Pending-/Fehlerzustände.

### Muster

Datenbasis und Modellgrenzen stehen am Anfang. Zuerst werden maximal drei Muster angezeigt;
weitere sind auf ausdrückliche Auswahl zugänglich. Stress und mögliche weitere Einflüsse bleiben sichtbar.
Timing, Zyklus, Stuhl und Health-Details sind unter Weitere Zusammenhänge gruppiert.
Vergleichszahlen und methodische Grenzen bleiben erhalten.

### Profil, FODMAP und Bericht

Profil bündelt Körperkontext und Datenquellen. Upload und Speichern geben konkretes Feedback.
FODMAP bleibt eine durchsuchbare Referenztabelle mit eigener horizontaler Scrollfläche.
Der Bericht verwendet die vorhandenen Daten und eine separate Druckansicht ohne Navigation oder Toasts.

## 7. Feedback und Bewegung

- 140ms für Hover- und Auswahlzustände.
- 200ms für Seiteninhalt, neue Timeline-Einträge und Benachrichtigungen.
- Keine springenden Karten und keine dauerhaften Dekorationsanimationen.
- Kleine Spinner nur während tatsächlicher Arbeit.
- Skeletons für Analyse und Bericht.
- Reduced Motion deaktiviert die nicht notwendigen Animationen und Übergänge.
- Erfolge bleiben einige Sekunden sichtbar; Fehler bleiben bis zum Schliessen.
- Benachrichtigungen werden über Live-Regionen angekündigt.
- Während Speichern werden doppelte Requests verhindert.
- Fehlgeschlagene Requests erhalten Formularwerte und zeigen den Serverfehler.
- Ein erfolgreicher API-Write wird als gespeichert bestätigt; ein Refresh-Problem wird separat benannt.

Ablauf: Auswahl → Eingabe → Speichern → Pending → Bestätigung → aktualisierte Übersicht.
Bei Fehler: Eingabe bleibt bestehen → Fehler lesen → korrigieren → erneut speichern.

## 8. Komponenten und Wartung

| Datei | Verantwortung |
| --- | --- |
| `web/src/tailwind.css` | Tailwind, DaisyUI-Plugin und Light-Theme |
| `web/src/style.css` | gemeinsame Tokens, Komponentenregeln, Seitenlayouts und Print |
| `components/ui/UiButton.vue` | Varianten, native Button-Semantik, Loading und Disabled |
| `components/ui/UiCard.vue`, `UiBadge.vue` | gemeinsame Container und Statusdarstellung |
| `components/ui/UiEditor.vue` | Bearbeitung im Seiteninhalt, Fokus und Rückkehr |
| `components/EntryPanel.vue` | gemeinsamer Einstieg der bestehenden Formulare in den Editor |
| `components/ui/UiSkeleton.vue` | lesbarer Ladezustand |
| `components/ui/ToastHost.vue`, `ui/feedback.js` | Feedback über Seitenwechsel hinweg |
| `ui/workspace.js` | aktive Seiteneditoren |
| `lib.js` | Speichern, Duplicate-Guard und Feedback |

Fachformulare behalten vorerst ihre bisherigen Dateinamen wie `EntryModal.vue`.
Diese Namen sind historisch; die Komponenten erzeugen keine Dialoge.
Keine individuellen Farbwerte in neue Seiten kopieren. Varianten und gemeinsame Tokens verwenden.

## 9. Umsetzungsstand und Prüfungen

- [x] Bestehende Seiten, Formulare und Testselektoren inventarisiert.
- [x] Light-Theme mit Tailwind und DaisyUI eingebunden.
- [x] Dekorative Legacy-CSS durch gemeinsame Regeln ersetzt.
- [x] Desktop-Sidebar und Navigation mit fünf mobilen Zielen umgesetzt.
- [x] Seiteneditoren ersetzen modale Eintrags-, Detail- und Löschansichten.
- [x] Dashboard, Tagebuch, Kalender, Rezepte und Muster vereinfacht.
- [x] Datum bei schnellen Einträgen sichtbar gemacht.
- [x] Pending-, Success-, Error- und Skeleton-Zustände vereinheitlicht.
- [x] Tastaturfokus und Reduced Motion vorgesehen.
- [x] Browser-Regressionen, neue Editor-/Fehlerfälle und Fokus-Rückkehr abschliessend prüfen.
- [x] Alle Kernseiten bei 320/390/768/1440px prüfen.
- [x] Axe-Prüfung der Seiten und des fehlerhaften Befinden-Editors abschliessen.
- [x] Druckansicht prüfen.
- [x] Testdatenbereinigung in isolierter Datenbank prüfen.

Prüfergebnis am 23. September 2026: `npm run build`, `go test ./...` und alle 19
Playwright-Tests der ersten Überarbeitung bestanden. Die Browserprüfung lief gegen eine separate lokale Datenbank,
nicht gegen das persönliche Tagebuch. Die Design-Suite vergleicht nach der Bereinigung die
Datensatz-IDs mit dem Zustand vor dem Test. Test-Screenshots liegen in `web/test-results/`.

Acht Kernseiten wurden mit befüllten Testdaten in vier Breiten auf horizontalen Überlauf,
Navigation und Laufzeitfehler geprüft. Axe meldete auf diesen Seiten bei 390px und im
getesteten Fehlerzustand keine Verstösse gegen die gewählten WCAG-2-A/AA- und 2.1-AA-Regeln.
Zusätzlich geprüft: Fokus-Rückkehr, Wechsel von gutem Befinden zu Beschwerden, Verlassen
eines Editors über die Navigation und Reduced Motion. Die Druckansicht wurde im Browser
mit Print-Media und visuell geprüft; ein physischer Drucktest wurde nicht durchgeführt.
Automatisierte Checks ersetzen keine vollständige Accessibility-Prüfung mit Assistenztechnik.

## 10. Spätere Validierung

Nachtrag zur Vereinfachung: Frontend-Build, Go-Tests und alle 23 Browser-Tests für kompakte
Ansichten, Onboarding und Profilpersistenz bestanden. Der Profiltest prüft auch einen neuen
Browserkontext, Namensänderung, Fehler/Retry und unveränderte Tagebuch-Einträge. Die spätere
Zutaten-Normalisierung hat eigene Go-/Python-Tests. Für den anschliessenden Mahlzeit-Ablauf und
die native Health-Anbindung wurden weitere Regressionstests ergänzt; diese neuesten Browsertests
konnten wegen des Freigabelimits noch nicht ausgeführt werden. Der Container-Rebuild
ist aus demselben Grund noch ausstehend.

Diese Punkte sind keine Behauptung über bereits erreichte Nutzerergebnisse:

- Mit mindestens fünf Testpersonen eine Mahlzeit, einen guten Moment, eine Beschwerde nach sechs
  Stunden und einen Kalendereintrag erfassen lassen.
- Zeit bis zum ersten Eintrag und erfolgreiche Abschlüsse beobachten.
- Prüfen, ob Personen fehlendes Befinden von symptomfrei unterscheiden.
- Prüfen, ob Personen den Unterschied zwischen Zusammenhang und Diagnose verstehen.
- Deep Links und lokale Entwürfe bei längeren Rezeptformularen evaluieren.
- Ein echtes Undo benötigt eine verlässliche Wiederherstellung; bis dahin bleibt die Löschbestätigung.
- Dark Mode erst nach Prüfung der Light-Variante planen.

## 11. Große Rezeptsammlungen: finden statt lange Listen durchsehen

Nachtrag 24.09.2026. Ausgangspunkt: Ein Dropdown mit 200 Einträgen und die vollständige Darstellung aller Rezeptkarten machen die alltägliche Mahlzeit-Erfassung unnötig mühsam. Dies ist eine Designentscheidung mit automatisierter Prüfung, noch keine Studie mit Testpersonen.

- **Primärer Ablauf:** Mahlzeit öffnen → bekannte Rezepte direkt auswählen oder Name/Zutat suchen → Auswahl wird kompakt zusammengefasst → Zeitpunkt/Befinden prüfen → speichern. Das Suchen verändert keine anderen Formulareingaben.
- **Wiederholungen vereinfachen:** Drei Vorschläge aus vorhandenen Mahlzeiten, nach letzter Verwendung. Alternativ häufig gegessene Rezepte oder alphabetische Reihenfolge. Nutzungshäufigkeit ist kein Verträglichkeitsurteil.
- **Suche:** Alle Wörter müssen im Namen oder den Zutaten vorkommen, unabhängig von Reihenfolge, Großschreibung und Umlautschreibweise. Namensübereinstimmungen vor reinen Zutatentreffern; bei gleichem Namen helfen sichtbare Zutaten.
- **Begrenzte Darstellung:** Sechs Treffer pro Auswahlseite, zwölf kompakte Einträge pro Sammlungsseite. Kein endloses Scrollen und kein verschachteltes Scrollfenster. Suchen und Sortieren starten auf Seite 1.
- **Progressive Anzeige:** Nach Auswahl bleibt nur eine Zusammenfassung mit „Rezept ändern“. Seltenere Bibliotheksaktionen liegen unter „Bearbeiten & weitere Optionen“. Keine Modals; neue Rezepte weiterhin direkt beim Erfassen hinzufügen.
- **Verlässlicher Zustand:** Wechseln öffnet die Suche, löscht aber die bisherige Auswahl nicht. „Auswahl beibehalten“/Escape kehrt zurück. Kein Treffer bedeutet nicht, dass die Sammlung leer ist. Ein eindeutiger Treffer lässt sich mit Enter wählen; mehrere Treffer erfordern eine ausdrückliche Auswahl.
- **Barrierefreiheit:** Beschriftete Suchfelder, native Ergebnisbuttons mit Zutatenbeschreibung, erreichbare 44px-Touch-Ziele, Fokus auf „Rezept ändern“ nach Auswahl und Ergebnis-/Seitenmeldungen für Screenreader.
- **Regressionen:** 200 gespeicherte Testrezepte, Duplikatnamen, Umlautsuche, Zutatenkombinationen, Seitenwechsel, leere Treffer, erhaltene Mahlzeitdaten und gemeinsame Auswahl beim Bearbeiten. Zusätzlich Tastatur-, Axe- und 320/390px-Checks.

Offene qualitative Validierung: Personen ein selten genutztes Rezept aus 200 Einträgen sowie zwei gleichnamige Gerichte finden lassen. Suchabbrüche, Fehlwahlen und Zeit bis zur Auswahl beobachten; keine erreichte Zeitersparnis behaupten, bevor diese Tests stattfinden. Bei wesentlich größeren Beständen die aktuell lokale Suche auf serverseitige Suche umstellen.

Technische Validierung: 36 Browser-Regressionsprüfungen einschließlich der 200-Rezepte-Fälle, sechs Such-Unit-Tests, Go-Tests und Frontend-Build erfolgreich. Die mobile Auswahl und Sammlung wurden zusätzlich als Screenshots geprüft. Die früher in Abschnitt 10 genannten Browser-/Container-Freigabeblocker sind inzwischen behoben; die native HealthKit-App benötigt weiterhin einen separaten Xcode-/Gerätetest.

## 12. Mehr Farbe als Orientierung, ohne zusätzliche UI-Komplexität

Auf Wunsch vom 24.09.2026 erhalten Eingaben und Beobachtungen wieder mehr Farbe. Die indigo-blaue Navigation bleibt bestehen; Grün wird weiterhin nicht verwendet. Die Kategoriezuordnung ist keine medizinische Ampel.

| Bereich | Akzent | Anwendung |
| --- | --- | --- |
| Mahlzeiten & Rezepte | Orange / dunkles Terrakotta | Schnellaktion, Rezeptsuche, Auswahl, Tagebuchmarkierung |
| Beschwerden | Rosé / dunkles Himbeerrot | Befinden-Formular, Symptomwahl, Beobachtung |
| Gutes Befinden | Blau | Eigene Schnellaktion, positive Beobachtung, Kalenderlegende |
| Zeit & Schlaf | Blau | Abgesetzte Eingabefelder, unabhängig vom Formulartyp |
| Stress & Health | Violett | Erfassung, Messungen und zugehörige Profilfelder |
| Stuhl | Ocker | Beobachtungsformular und Verlauf |
| Zyklus | Beerenrosa | Optionaler Profil- und Zykluskontext |
| Notizen | Schiefergrau | Ruhige, klar getrennte Freitextflächen |

Gemeinsame Tokens und Darstellungsregeln liegen in `web/src/colors.css`; `entry-tones.js` liefert die gleiche Kategorie für Startseite, Tagebuch und Kalender. `EntryPanel` reicht die Farbe ausdrücklich an den teleportalisierten Editor weiter. Neue Formulare nutzen diese Zuordnung statt eigener Farbwerte.

Farbe ergänzt Beschriftung, Symbole, Rahmen und `aria-pressed`; sie ersetzt diese nicht. Fehler und Löschen behalten ihre eigenen roten Warnstile. Gemischte Kalendertage kennzeichnen gute und symptomatische Momente mit beiden Akzenten. Farbflächen direkt in den Eingaben trennen Bereiche, ohne zusätzliche Formularschritte oder vertikale Abstände einzuführen.

Feinschliff nach Nutzerfeedback: `data-tone` bleibt eine technische Kategorie, erzeugt aber keine zusätzliche sichtbare Box. Keine dicken seitlichen Farblinien, keine durchgehend farbigen Editor-Rahmen und keine doppelten Auswahlrahmen. Stattdessen helle Eingabeflächen, zurückhaltende 1px-Konturen und 10–14px-Rundungen. Beschriftungen bleiben dunkel; deutliche Akzentfarbe erscheint bei Fokus und Auswahl. Editor- und Profilkarten sind neutral gerahmt, damit Rosé nicht wie ein Formularfehler wirkt. Gute-Befinden-Auswahl und Rezeptzusammenfassung bleiben klar beschriftet.

Validierung: 38 Browserprüfungen bestanden, einschließlich neuer Kontrast-/Axe-Checks in allen fünf Erfassungsansichten und unterscheidbarer Zeit-/Stress-/Notizfelder. Mobile Screenshots wurden überprüft; bestehende Prüfungen für direkt erreichbare Hauptaktionen, reduzierte Bewegung, Druckansicht und 200 Rezepte bleiben erhalten. Dies ersetzt keinen Nutzertest mit Personen mit unterschiedlichen Sehfähigkeiten.
