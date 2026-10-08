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
| Drei tägliche Erfassungsaktionen sahen durch Akzentfarbe und Button-Variante wie verschiedene Prioritätsstufen aus | Mahlzeit, Befinden, gutes Befinden und der Einstieg zu weiteren Beobachtungen erhalten dieselbe Form, Höhe und ruhige Indigo-Fläche; die Reihenfolge und Beschriftung geben Orientierung |
| Ein frisches oder zurückgesetztes Tagebuch konnte auf der Heute-Seite landen, ohne die persönliche Einrichtung zu beginnen | Ein unvollständiges Profil startet direkt im Einrichtungs-Wizard; überspringen bleibt möglich, und das Dashboard bietet eine sichtbare Wiederaufnahme |
| Sechs kleine Navigationsziele auf dem Smartphone | Fünf Hauptziele; FODMAP, Bericht und Profil bleiben über Mehr erreichbar |
| Modale Formulare und Details unterbrechen den Lesefluss | Eintrags- und Detailansichten werden im Hauptbereich der Seite angezeigt |
| Speichern ist erst durch das Schliessen des Formulars erkennbar | Sichtbarer Pending-Zustand, Erfolgsfeedback und aktualisierte Daten |
| Kalender bezeichnet einen einzelnen guten Check-in als guten Tag | Gutes Befinden wird ausdrücklich als Moment bezeichnet |
| Analyse zeigt viele Detailabschnitte vor Zutatenmustern | Datenbasis, führende Muster, Stress und weitere Einflüsse zuerst; Details danach |
| Gemischte Schriftfamilien, kleine Texte und dekorative Rezeptgrafiken | Eine Schrift, besser lesbare Hilfstexte und kompakte Rezeptköpfe |

## 3. Produktziele

- Häufige Einträge mit wenigen Entscheidungen ermöglichen.
- Auf jeder Seite die nächste Aktion erkennbar machen.
- Auf dem Smartphone nur die aktive Inertia-Seite im ersten JavaScript-Bundle laden.
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
| Mahlzeit, Alltagserfassung und guter Moment | Indigo plus klare Beschriftung / Symbol |
| Eingetragene Beschwerden | Rosé plus Symptomtext; kein Diagnosealarm |
| Freiwilliger Kontext (Stress, Zyklus, Schlaf, Stuhl) | Neutrales Slate; Kontext bleibt beschriftet |
| Fehler / Löschen | Rot |

Es gibt keine eigene Farbe pro Feld. Rot bleibt Fehlern und Löschen vorbehalten; ein
statistischer Zusammenhang ist kein Alarm. Kalender ohne Check-in bekommen keine positive Bewertung.

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
Optionale Stress- und Schlafwerte starten leer; es werden keine Standardwerte still gespeichert.
Ältere, nicht bestätigte Kontextwerte zählen erst nach Prüfung im Editor zur Auswertung.
Mehrfaktorenmodelle verwenden optionale Kontextdaten nur bei ausreichender Zahl verschiedener,
ausdrücklich dokumentierter Werte.

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
- [x] Seitenbündel pro Inertia-Route laden; CI begrenzt die Startseite samt statischen Abhängigkeiten auf 450 KiB raw / 155 KiB gzip.

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

Die Routen werden inzwischen dynamisch geladen, sodass nicht alle Seiten und deren Symbole beim
Start geladen werden. Produktionsbuild am 08.10.2026: `app.js` 310.45 kB raw / 108.24 kB gzip
(vorher 504.89 kB raw / 164.98 kB gzip). Die Startseite lädt zusätzlich gemeinsame Komponenten;
der gesamte statische JavaScript-Ladepfad beträgt 413.55 kB raw / 142.95 kB gzip. Vite meldet
keinen Chunk-Size-Warnhinweis mehr. CI begrenzt diesen vollständigen Startpfad. Echte
Geräte-/Netzwerk-Labormessungen bleiben offen.

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

## 12. Zurückhaltende Farbe und gleichwertige Erfassungsaktionen

Das Feedback vom 05.10.2026 korrigiert die frühere, zu stark ausdifferenzierte Farbpalette:
Farbe soll Orientierung geben, aber nicht jede Eingabeart in eine eigene Farbe kleiden oder
Alltagsaktionen als unterschiedlich wichtig darstellen. Grün bleibt ausgeschlossen.

| Semantische Gruppe | Behandlung | Bedeutung |
| --- | --- | --- |
| Tagebuch-Alltag, Mahlzeit und gutes Befinden | Indigo und sehr helle Indigo-Fläche | Primäre Erfassung; Essen und Befinden haben gleichwertig erreichbare Aktionen |
| Symptome | Dunkles Rosé auf sehr heller Rosé-Fläche | Eingetragene Beschwerden, kein Warn- oder Diagnoseurteil |
| Stress, Stuhl, Zyklus, Zeit und Notiz | Neutrales Slate | Freiwilliger Kontext; Unterschiede bleiben in Text und Symbolen erkennbar |

Die vier Einstiege „Mahlzeit eintragen“, „Befinden“, „Gutes Befinden“ und „Weitere
Beobachtungen“ teilen im Heute-Bereich dieselbe Höhe, Fläche, Kontur und Rundung. Mahlzeit
steht zuerst, doch ein kräftig gefüllter Sonderbutton macht sie nicht visuell wichtiger als die
anderen Alltagseinträge. Weitere Beobachtungen bleiben aufklappbar und gleich gross.

Die semantischen Variablen in `web/src/colors.css` bündeln Essen und gutes Befinden unter
Indigo, Beschwerden unter Rosé und seltene Kontextfelder unter Slate. Labels und Icons bleiben
erhalten; Farbe ist nie der einzige Hinweis. Ausgewählte Symptomstufen nutzen eine neutrale
Darstellung für „Keine“ und dieselbe kontrastreiche Beschwerdefarbe für „Leicht“, „Mittel“ und
„Stark“ – die Textstufe, nicht eine weitere Ampelfarbe, vermittelt die Stärke.

Die Rezeptbibliothek behält auf schmalen Geräten eine gut bedienbare Spalte, zeigt ab 1024px
zwei und auf breiten 1440px-Ansichten drei kompaktere Karten nebeneinander. Dadurch werden
breite horizontale Rezeptboxen vermieden, ohne die Zutaten- und Aktionsbeschriftungen zu
verstecken.

## 13. Planmanager-Update: Produktführung vereinfachen und mit Aufgaben prüfen

Stand: 5. Oktober 2026. Dieses Update trennt **Codebefund**, **heuristische Simulation**,
**Änderung** und **echte Nutzerforschung**. Die folgenden simulierten Ergebnisse sind
Walkthrough-Hypothesen, keine Interviews, Messungen oder Nutzerzitate. Das entspricht den
allgemeinen Prinzipien zu Sichtbarkeit, verständlicher Sprache, Kontrolle, Konsistenz und
Fehlervermeidung der [Nielsen-Norman-Group-Heuristiken](https://www.nngroup.com/articles/ten-usability-heuristics/).
Touch-Ziele werden zusätzlich an [WCAG 2.2, SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
geprüft; 44px bleibt das praktische App-Ziel, nicht die WCAG-AA-Mindestanforderung.

### Produktidee und Hauptschleife

GutFeeling ist zuerst ein persönliches Beobachtungstagebuch, kein Diagnose-Dashboard:

1. **Jetzt festhalten:** Mahlzeit oder aktuelles Befinden eintragen.
2. **Später ergänzen:** Beschwerden mit Zeitpunkt und grobem Abstand zum Essen erfassen;
   eine konkrete Mahlzeit ist optional.
3. **Mit der Zeit verstehen:** wiederkehrende Zutaten- und Kontextmuster mit Datenbasis und
   Unsicherheit ansehen, bei Bedarf als Gesprächsgrundlage teilen.

Rezeptimport, Zutatenzuordnung, Health-Daten, Zyklus und Stress unterstützen diese Schleife,
sind aber nicht gleichrangige Startaufgaben. Sie dürfen den kurzen Alltagsweg nicht blockieren.
Fehlende Einträge bleiben unbekannt; sie werden nie als symptomfrei dargestellt. Eine
Zusammenfassung bleibt ein Hinweis und keine Diagnose.

### Heuristische Befunde am aktuellen Produkt

| Priorität | Codebefund | Risiko für die Person | Richtung |
| --- | --- | --- | --- |
| P0 | Symptomstärken wurden in bestehenden Check-ins als 0–10-Zahlen bearbeitet; die Analyse nutzt weiter den historischen Zahlenvertrag. | Ein freies Zahlenfeld ist mühsam und suggeriert eine Genauigkeit, die die eigene Erinnerung nicht immer hergibt. | Pro Symptom eine zusammenhängende 0–5-Sterne-Auswahl mit passendem Symptomnamen und Icon; 0 bedeutet „Keine“. Die gewählte Stufe zusätzlich ausschreiben und per Tastatur bedienbar machen. Keine freie 0–10-Eingabe. |
| P0 | Die Rezeptbibliothek zeigt eine einspaltige, über die ganze Inhaltsbreite laufende Kartenliste. | Auf breiten Bildschirmen entstehen breite Inhaltsbänder und wenig Überblick; Personen müssen vertikal viele Karten absuchen. | Karteninhalt kompakter setzen, auf breiten Desktop-Ansichten zwei Spalten nutzen und auf Mobilgeräten bei einer lesbaren Spalte bleiben. Suche, Zutatenhinweis und primäre Aktion sichtbar halten. |
| P1 | Der Rezepteditor kann pro Zutat Zuordnung, Vorschläge und Allergene zeigen. | Viele Zutaten vergrössern den Editor stark; native Mehrfachauswahl kann auf schmalen Geräten unleserlich werden. | Vollständige Zutatenliste mit kompakten Zeilen; seltene Detailfelder inline bei Bedarf öffnen. Allergene als umfließende, beschriftete Auswahl statt horizontal gequetschter Mehrfachauswahl. |
| P1 | Die App bündelt Tagebuch, Rezeptcrawler, ML-Auswertung und optionale Gesundheitskontexte. | Neue Personen können nicht sofort erkennen, was sie täglich tun müssen und was nur Zusatz ist. | Pro Seite eine nächste Hauptaktion, übrige Funktionen klar nachgeordnet; optionale Kontexte nicht als Pflicht oder Voraussetzung formulieren. |
| P1 | Zeit, Mahlzeitenbezug und Kontext beeinflussen die spätere Analyse. | Personen können einen späteren Beschwerdebeginn fälschlich dem zuletzt gegessenen Essen zuschreiben. | Symptombeginn/Timing und konkrete Mahlzeit getrennt erfassen; „nicht zuordnen“ gleichwertig anbieten. |

### Simulierte Aufgaben – drei Überarbeitungsrunden

**Runde 1 – Alltagsmahlzeit.** Modellperson: kennt ein gespeichertes Rezept und möchte
rasch festhalten, was sie gegessen hat. Walkthrough: Heute → Mahlzeit → Rezept suchen/aus
„Noch einmal“ wählen → Zeitpunkt und Befinden prüfen → speichern. Vermutete Hürde im
Bibliotheksbildschirm: breite Einzelkarten liefern zu wenig gleichzeitigen Überblick. Änderung:
kompaktere Karte, zwei Spalten am Desktop, eine Spalte am Telefon. Erfolg ist noch nicht
gemessen; Rezeptwahl und Formularerhalt bleiben als reale Testaufgaben offen.

**Runde 2 – zeitversetzte Beschwerden.** Modellperson: bemerkt Blähungen mehrere Stunden
nach dem Essen und ist sich bei der Ursache nicht sicher. Walkthrough: Befinden → Symptom
und Stärke → Zeitpunkt/Abstand → Mahlzeit auswählen oder ausdrücklich offenlassen → speichern.
Die erste Hypothese war eine vierstufige qualitative Auswahl. Sie wurde nach der konkreten
Nutzerpräferenz verworfen: Die aktuelle Richtung ist eine zusammenhängende 0–5-Sterne-Auswahl
mit Symptomname und passendem Icon, wobei 0 „Keine“ bedeutet und die aktuelle Stufe zusätzlich
ausgeschrieben wird. Es gibt kein freies 0–10-Eingabefeld. Zeitpunkt und Mahlzeitenbezug bleiben
getrennte Fragen; die separate Stressangabe ist Kontext und keine Symptomstärke. Echte
Verständlichkeit und Bedienbarkeit sind noch zu prüfen.

**Runde 3 – kein klarer Essensbezug.** Modellperson: hat Beschwerden, kann sie aber keinem
Rezept zuordnen; Stress oder andere Umstände könnten ebenfalls eine Rolle spielen. Walkthrough:
Beschwerde ohne ausgewählte Mahlzeit speichern → optionalen Stress-/Stuhlkontext ergänzen →
später Muster mit Datenbasis ansehen. Prüffrage: Kann die Person ohne Hinweis auf ein bestimmtes
Lebensmittel speichern und versteht sie, dass fehlende Daten keine Entwarnung sind? Richtung:
keinen Mahlzeitenbezug erzwingen; „Zusammenhang“ und „keine ausreichenden Daten“ klar von
Ursache/Diagnose unterscheiden.

**Aktualisierte Iteration:** Symptomstärke wird als echte 0–5-Sterne-Auswahl erfasst,
nicht als freies Zahlenfeld und nicht nur durch ein Emoji. Die Symptomart bleibt mit Name und
passendem Icon sichtbar; fünf Sterne wählen die Stärke, eine eigene 0-Auswahl bedeutet „keine“.
Die aktuelle Stufe wird zusätzlich ausgeschrieben und ist per Tastatur bedienbar. Der nächste
Walkthrough prüft diese Änderung bei 320px, 390px und Desktop, mit Tastatur und Screenreader.
Wenn Begriffe, Rückwege oder Datenstatus unklar bleiben, wird der Ablauf vor dem echten Test
erneut angepasst. Diese Simulation belegt keine Zeitersparnis und keine erfolgreiche Nutzung
durch reale Personen.

### UX-Regeln: tun und vermeiden

**Tun**

- Häufige Tagebuchaufgaben vor seltenen Analyse- und Einstellungsaufgaben platzieren.
- Pro Ansicht eine klare Hauptaktion und einen sichtbaren Rückweg anbieten.
- Alltagswörter und benannte Zustände verwenden; Symptomstärke als qualitative Wahl,
  Stress als getrennten Kontext kennzeichnen.
- Symptomart mit Name und passendem Icon kennzeichnen; die Stärke selbst mit einer echten
  Rating-Auswahl aus fünf Sternen plus ausdrücklich auswählbarer 0 erfassen. Stufe, Fokus und
  Auswahlzustand zusätzlich verständlich beschriften.
- Optionale Felder als optional markieren und erst bei Bedarf zeigen.
- Eingegebene Daten bei Fehlern erhalten und Erfolg, Laden sowie Analysefehler voneinander
  unterscheiden.
- Auf 320px ohne horizontales Seiten-Scrolling funktionieren; Bedienelemente gross,
  beschriftet und mit Tastatur bedienbar halten.
- Fehlende Beobachtung ausdrücklich als unbekannt behandeln und Muster vorsichtig formulieren.

**Vermeiden**

- Keine freien 0–10-Eingabefelder für Symptome und kein dekoratives Emoji als Ersatz für eine
  Rating-Auswahl. Die fünf Sterne sind auswählbare Stärke-Stufen; 0 muss separat erreichbar
  und als beschwerdefrei beschriftet sein. Stress bleibt eine getrennte Messung.
- Keine falsche Genauigkeit behaupten: Sterne erfassen die persönliche Einschätzung, keine
  medizinisch kalibrierte Messung.
- Keine Pflicht, jede Mahlzeit, jedes Symptom oder jeden Kontext vollständig zu dokumentieren.
- Keine Ursache, Allergie oder Unverträglichkeit aus einer Korrelation ableiten.
- Keine Farbcodierung oder Emojis als alleinige Beschriftung verwenden.
- Das Symptom-Emoji nicht als ganze Bewertung oder Dekoration neben einem Zahlenfeld verwenden;
  Symptomart und Rating müssen gemeinsam sichtbar sein, aber klar verschiedene Aufgaben haben.
- Keine überbreiten Inhaltskarten, endlosen Listen, verschachtelten Scrollbereiche oder
  unbeschrifteten Aktionen.
- Keine erfolgreichen Nutzertests, Zeitgewinne oder qualitative Ergebnisse behaupten,
  solange sie nicht mit echten Personen erhoben wurden.

### Priorisierter Umsetzungs- und Forschungs-Backlog

| Prio | Arbeit | Abnahmekriterium | Status |
| --- | --- | --- | --- |
| P0 | Symptomstärke in Erfassen, Bearbeiten, Markierung, Tagebuch, Kalender und Bericht vereinheitlichen. | Ein auswählbarer 0–5-Sterne-Status mit sichtbarem Symptomname/Icon, klarer Textstufe, Tastatursteuerung und lesbarer Übernahme bestehender Einträge. | 0–5-Control, Legacy-Mapping, Unit-Tests und Build umgesetzt; aktueller Browser-/Axe-Retest ausstehend. |
| P0 | Rezeptbibliothek kompakter darstellen. | 12 Einträge pro Seite; bei 320/390px eine Spalte ohne Überlauf, bei 1024px zwei und bei 1440px drei kompakte Spalten; Suche, Aktionen, lange Namen und Screenreader-Beschriftungen bleiben nutzbar. | Im Quellcode umgesetzt; mobile/desktop Layout- und vollständige Browser-/Axe-Prüfung bestanden. |
| P0 | Gleichwertige Heute-Aktionen und reduzierte Farbpalette. | Mahlzeit, Befinden, Gutes Befinden und Weitere Beobachtungen teilen Grösse und Gestaltung; drei semantische Farbfamilien; Kontrast/Axe bestehen. | Im Quellcode umgesetzt; Computed-Style-, Farbgruppen- und vollständige Axe-Prüfungen bestanden. |
| P0 | Erststart und erneutes Durchgehen der Profileinrichtung. | Kein vollständiges Profil führt in den dreistufigen Wizard; später fortsetzen; bestehende Profile vorausgefüllt erneut öffnen; Übergänge animiert und reduzierte Bewegung respektiert. | Im Quellcode umgesetzt; Erststart, späterer Wiedereinstieg, Profiländerung, Schritt-Fokus, reduzierte Bewegung und mobile Axe-Prüfungen bestanden. |
| P1 | Zutateneditor verdichten und Allergenauswahl für Mobilgeräte neu ordnen. | Alle Zutatennamen bleiben in der Liste sichtbar; Zuordnung/Allergene überlappen nicht; Import- und manuelle Zutaten bleiben änderbar. | Kompakte Zeilen und aufklappbare Zuordnung/Allergen-Checkboxen umgesetzt; Unit-Test, Build und E2E-Testfall-Erkennung bestanden. Echter mobiler Browserlauf steht noch aus. |
| P1 | Tagebuch-Hauptschleife mit fünf moderierten Personen prüfen. | Aufgaben: wiederholtes Rezept erfassen, neues Essen protokollieren, Beschwerden mit Verzögerung eintragen, Kontext ohne Mahlzeitenbezug ergänzen, Muster vorsichtig erklären. | Studienplan vorhanden; Personen noch nicht rekrutiert/getestet. |
| P2 | Erkenntnisse aus echten Sitzungen priorisieren und zweite Iteration prüfen. | Ergebnisse enthalten Erfolgsquote, Zeit, Fehlbedienungen, Rücksprünge, Missverständnisse, Zitat nur mit Einwilligung sowie konkrete Änderung und Retest. | Nach der ersten echten Testrunde. |

**Sprint-Vorschlag (je zwei Wochen):** Sprint 1 schliesst die P0-Eingabe- und Rezeptkartenänderungen
mit Browser-/Geräteprüfung ab. Sprint 2 verdichtet Zutatenbearbeitung und Allergenauswahl, danach
folgt ein moderierter Testlauf mit fünf Personen. Sprint 3 wertet Sitzungen aus, behebt die drei
grössten beobachteten Hindernisse und wiederholt dieselben Kernaufgaben. Sprint-Review und Retro
halten fest, welche Annahmen bestätigt, verworfen oder weiter offen sind.

**Reale Nutzertests (noch nicht durchgeführt):** mindestens fünf Personen, moderierte
Aufgaben ohne Schritt-für-Schritt-Hilfe. Beobachten: Erfolg je Aufgabe, Zeit bis zum Abschluss,
Fehleingaben, Hilfebedarf, Rücksprünge und ob „fehlend“ von „symptomfrei“ unterschieden wird.
Startziel: mindestens vier von fünf Personen schliessen jede Kernaufgabe ohne Hilfe ab;
wiederholtes Rezept in höchstens zehn Sekunden ist ein zu prüfendes Ziel, kein Versprechen.
Nach jeder Runde höchstens die drei grössten Hindernisse beheben und dieselben Aufgaben erneut
prüfen. Erkenntnisse aus dieser Studie planen keine Diagnosevalidierung; das bleibt ausserhalb
des Usability-Tests.

### Technische Abgrenzung und Prüfstatus

Die sichtbaren qualitativen Symptomstufen werden in `web/src/symptom-intensity.js` auf den
bestehenden internen Datenbereich abgebildet, damit keine Backend-Migration erforderlich ist.
Das ist ein Kompatibilitätsdetail, keine Zahlenskala in der Bedienoberfläche. Stresswerte aus
manueller Eingabe oder Health-Anbietern bleiben eine getrennte Funktion.

Frontend-Build, acht Unit-Tests und `go test ./...` bestanden. Alle 43 Playwright-Tests liefen gegen die isolierte
SurrealDB-Datenbank `ux_tests` und bestanden. Die Suite prüft acht Hauptansichten bei
320/390/768/1440px, Axe/WCAG-A, Tastatur und Fokus, Fehlererhalt, reduzierte Bewegung,
Tagebuch-CRUD, 200 Rezepte, die Aktionsgestaltung/Rezeptdichte und das Onboarding mit fehlendem
Profil, späterem Wiedereinstieg und Profil-Assistent. Im ersten Lauf wurden drei Testabläufe
entdeckt, die nach Auswahl eines Symptoms keine Stärke gesetzt hatten, sowie ein widersprüchlicher
gespeicherter Erwartungswert; die Tests wurden korrigiert und der Farbkontrast verbessert.
Danach bestanden 42/42, mit dem ergänzten Onboarding 43/43 Playwright-Tests. Die abschliessenden
Fokus- und Reduced-Motion-Prüfungen liefen erneut in den drei Profil-Tests und bestanden.
`main` wurde von den Browser-Suiten nicht verwendet. Am 2026-10-05 wurde die Sterneskala auf
Wunsch neu festgelegt: zwölf Frontend-Unit-Tests, Go-Tests und Produktionsbuild bestehen. Ein
erster vollständiger 44-Test-Lauf hatte zwei Timeouts unter Gesamtlast; beide Tests bestanden
einzeln, danach bestand der vollständige isolierte Lauf erneut mit 44/44 in 1,1 Minuten. Keine
dieser technischen Prüfungen ersetzt den geplanten Test mit echten Personen.
