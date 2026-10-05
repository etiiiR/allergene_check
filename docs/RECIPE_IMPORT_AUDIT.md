# Rezeptimport: Plattformprüfung

Stand: 25. September 2026. **34 zusätzliche Plattformen und Swissmilk als Kontrolle**, jeweils ein öffentliches Beispielrezept. **31/34 zusätzliche Beispiele importierbar**, plus Swissmilk; 3 Zugriffe gesperrt. Das ist eine Stichprobe, keine Zusage für alle Rezepte einer Plattform.

## Vorgehen und Aussagekraft

- Die URLs wurden über Websuche bzw. die Rezeptseiten recherchiert. Die verlinkten Beispiele unten sind die Primärquellen.
- Der erste Live-Lauf verwendet denselben Downloader wie die App: eigener User-Agent, robots.txt-Prüfung, öffentlich auflösbare Ziele, validierte Weiterleitungen, 2-MB-Grenze. Höchstens vier unterschiedliche Plattformen gleichzeitig; kein Login, Headless-Browser, Proxy oder Bot-Schutz-Bypass.
- Zugängliche HTML-Seiten wurden lokal zwischengespeichert. Parserkorrekturen wurden anschließend **auf denselben HTML-Snapshots offline** geprüft. REWE/EDEKA wurden einmal zur präzisen HTTP-Fehlerklassifikation nachgeprüft.
- „Importiert“ bedeutet: plausibler Rezepttitel, nichtleere Zutatenliste und Zubereitung aus dem Beispiel. Sichtbare Zutatenblöcke und strukturierte Daten wurden auf Zeilen/Gruppen und Mengenhinweise abgeglichen; dabei wurden u. a. FOOBY und Zucker & Jagdwurst korrigiert. Kein vollständiger wortweiser oder kulinarischer Qualitätsnachweis für jede Quelle.
- Die Sollwerte im Manifest sichern Titel, Zutatenzeilen, Schrittanzahl und bewusste Portionsentscheidung für diese Beispiele. Sie sind **keine unabhängige inhaltliche Referenz** und keine umfassende Plattformabdeckung. Stückzahlen/Laibe/uneindeutige Angaben lassen das Portionsfeld leer und verlangen eine bewusste Eingabe.
- Rezeptwörter werden nicht übersetzt oder durch ein LLM ergänzt. Zutaten- und Allergen-Zuordnung bleiben separat prüfpflichtig; insbesondere fremdsprachige und zusammengefasste Angaben sind kein Allergiesicherheitsnachweis.

## Stichproben

Z/S = Zutatenzeilen / Zubereitungsschritte. Wiederholte Zutaten für verschiedene Teilzubereitungen bleiben erhalten. „–“ bei Portionen bedeutet bewusste manuelle Bestätigung, nicht fehlenden Rezeptimport.

| Nr. | Plattform / Beispielquelle | Erkannter Titel | Ergebnis | Z/S | Portionen | Beobachtung |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [Chefkoch](https://www.chefkoch.de/rezepte/4270791701544182/Pfannkuchen.html) | Pfannkuchen von Hebscher | Importiert | 11 / 3 | 4 | JSON-LD geprüft. |
| 2 | [FOOBY](https://fooby.ch/de/rezepte/28498/kaiserschmarrn-mit-mirabellen) | Kaiserschmarrn mit Mirabellen | Importiert | 14 / 4 | 4 | Sichtbare Liste: 14 Zeilen statt 13 aggregierter Schema-Einträge; Verwendungshinweise bleiben erhalten. |
| 3 | [Betty Bossi](https://www.bettybossi.ch/de/rezepte/rezept/spaghetti-carbonara-10009942/) | Spaghetti Carbonara | Importiert | 9 / 3 | 4 | JSON-LD liefert Mengen; sichtbares Server-HTML enthält teilweise NaN. |
| 4 | [Migusto](https://migusto.migros.ch/de/rezepte/schnittlauch-kaiserschmarrn) | Schnittlauch-Kaiserschmarrn | Importiert | 13 / 4 | 4 | „Für 4 Personen“ wird erkannt. |
| 5 | [Essen und Trinken](https://www.essen-und-trinken.de/rezepte/einfache-kartoffelsuppe-rezept-13967730.html) | Einfache Kartoffelsuppe Rezept | Importiert | 9 / 2 | 4 | Numerischer JSON-Wert für Portionen wird erkannt. |
| 6 | [LECKER](https://www.lecker.de/kartoffelsuppe-wie-von-oma-das-klassische-rezept-82249.html) | Kartoffelsuppe wie von Oma - das klassische Rezept Rezept | Importiert | 12 / 3 | 4 | JSON-LD geprüft. |
| 7 | [EAT SMARTER](https://eatsmarter.de/rezepte/kartoffelsuppe-smarter) | Kartoffelsuppe – smarter | Importiert | 12 / 8 | 4 | JSON-LD geprüft. |
| 8 | [GuteKueche.at](https://www.gutekueche.at/kaiserschmarrn-rezept-180) | Kaiserschmarrn | Importiert | 10 / 5 | 2 | JSON-LD geprüft. |
| 9 | [Kitchen Stories](https://www.kitchenstories.com/de/rezepte/klassische-pfannkuchen) | Pfannkuchen | Importiert | 9 / 3 | – | 6 Stück sind nicht automatisch 6 Portionen. |
| 10 | [Einfach Backen](https://www.einfachbacken.de/rezepte/pfannkuchen-das-schnelle-grundrezept) | Pfannkuchen - Das schnelle Grundrezept | Importiert | 7 / 2 | – | 7 Stück: Portionszahl bewusst selbst bestätigen. |
| 11 | [Emmi kocht einfach](https://emmikochteinfach.de/pfannkuchen-rezept-einfaches-grundrezept/) | Pfannkuchen – einfaches Grundrezept | Importiert | 6 / 8 | 5 | JSON-LD geprüft. |
| 12 | [Gaumenfreundin](https://www.gaumenfreundin.de/ganz-einfache-kartoffelsuppe-mit-wuerstchen-und-suppengemuese/) | Omas Kartoffelsuppe mit Würstchen | Importiert | 10 / 3 | 4 | Doppelte Desktop-/Mobil-Listen werden nicht doppelt importiert. |
| 13 | [Kochkarussell](https://kochkarussell.com/omas-kartoffelsuppe-wuerstchen/) | Omas Kartoffelsuppe mit Würstchen | Importiert | 10 / 3 | 4 | JSON-LD geprüft. |
| 14 | [Maltes Kitchen](https://www.malteskitchen.de/pfannkuchen-rezept-einfach-fluffig-schnell/) | Pfannkuchen Grundrezept ／ einfach, schnell & gelingt immer | Importiert | 9 / 4 | – | HTML-Entities bereinigt; 12 Pfannkuchen sind keine sicheren Portionen. |
| 15 | [Zucker und Jagdwurst](https://www.zuckerjagdwurst.com/de/rezepte/vegane-lasagne-mit-bechamelsosse) | Vegane Lasagne mit Béchamelsoße | Importiert | 28 / 6 | 4 | 28 einzelne Zeilen statt 6 Überschriften/zusammengezogener Gruppen. |
| 16 | [Bianca Zapatka](https://biancazapatka.com/en/best-vegan-pancakes/) | Vegan Pancakes | Importiert | 12 / 6 | – | 8 Pancakes: keine automatische Portionsumrechnung. |
| 17 | [Food Network](https://www.foodnetwork.com/recipes/alton-brown/pancake-cake-with-avocado-frosting-recipe-1957043) | Pancake Cake with Avocado Frosting | Importiert | 14 / 7 | 4 | JSON-LD geprüft. |
| 18 | [Marmiton](https://www.marmiton.org/recettes/recette_crepes-faciles_15899.aspx) | Crêpes faciles : la meilleure recette | Importiert | 4 / 4 | 2 | Französische Portionsangabe „personnes“ erkannt. |
| 19 | [750g](https://www.750g.com/crepes-r38216.htm) | Crêpes classiques | Importiert | 5 / 2 | 6 | Unzulässige Zeilenumbrüche in JSON-Strings toleriert; Vorschauhinweis. |
| 20 | [Taste.com.au](https://www.taste.com.au/recipes/basic-pancakes/2480dad2-f1d5-49a0-9e01-2251470dcc86) | – | Gesperrt | – / – | – | robots.txt verweigert den Import; kein Seitenabruf/Parsernachweis. |
| 21 | [Budget Bytes](https://www.budgetbytes.com/coconut-curry-chickpeas/) | Chickpea Curry | Importiert | 10 / 6 | 4 | JSON-LD geprüft. |
| 22 | [Cookie and Kate](https://cookieandkate.com/best-lentil-soup-recipe/) | Best Lentil Soup | Importiert | 16 / 7 | 4 | HTML-Entities wie `&frac14;` werden als ¼ gelesen. |
| 23 | [RecipeTin Eats](https://www.recipetineats.com/pancake-recipe/) | Simple, Fluffy Pancakes | Importiert | 8 / 7 | – | 13 Pancakes: Portionsfeld bleibt leer. |
| 24 | [Minimalist Baker](https://minimalistbaker.com/instant-pot-red-lentils-tender-fast-no-soaking/) | Instant Pot Red Lentils (Tender, Fast, No Soaking!) | Importiert | 2 / 3 | 4 | JSON-LD geprüft. |
| 25 | [REWE](https://www.rewe.de/rezepte/pfannkuchen-klassisch/) | – | Gesperrt | – / – | – | HTTP 403; keine Umgehung und kein Parsernachweis. |
| 26 | [EDEKA](https://www.edeka.de/rezeptwelt/rezepte/suesse-pfannkuchen/) | – | Gesperrt | – / – | – | HTTP 403; keine Umgehung und kein Parsernachweis. |
| 27 | [LIDL Kochen](https://www.lidl-kochen.de/rezeptwelt/pfannkuchen-grundrezept-150859) | Pfannkuchen Grundrezept | Importiert | 5 / 3 | 4 | JSON-LD geprüft. |
| 28 | [Alnatura](https://www.alnatura.de/de-de/rezepte/suche/klassische-kartoffelsuppe-105645/) | Klassische Kartoffelsuppe | Importiert | 9 / 3 | 4 | Großgeschriebene Text-Felder und „Portion(en)“ erkannt. |
| 29 | [Dr. Oetker](https://www.oetker.de/rezepte/r/pfannkuchen-eierkuchen) | Pfannkuchen (Eierkuchen) | Importiert | 7 / 2 | – | „etwa 7 Stück“ bleibt eine zu prüfende Ausbeute. |
| 30 | [Springlane](https://springlane.de/blogs/rezepte/perfekte-pfannkuchen) | Perfekte Pfannkuchen: Ein Grundrezept für Genießer und Experimentierfreudige | Importiert | 7 / 4 | – | Begrenzter HTML-Textadapter: Zutaten und nummerierte Schritte, ohne Werbetext. |
| 31 | [Allrecipes](https://www.allrecipes.com/recipe/21014/good-old-fashioned-pancakes/) | Good Old-Fashioned Pancakes | Importiert | 7 / 5 | 8 | JSON-LD geprüft. |
| 32 | [Simply Recipes](https://www.simplyrecipes.com/recipes/banana_bread/) | Banana Bread | Importiert | 8 / 6 | – | „10 / 1 loaf“: konservativ keine automatische Portionszahl. |
| 33 | [Serious Eats](https://www.seriouseats.com/light-and-fluffy-pancakes-recipe) | Light and Fluffy Buttermilk Pancakes | Importiert | 10 / 3 | – | „6 / 16 pancakes“: konservativ keine automatische Portionszahl. |
| 34 | [BBC Good Food](https://www.bbcgoodfood.com/recipes/easy-pancakes) | Easy pancakes | Importiert | 6 / 5 | – | „Makes 12“ nennt keine eindeutige Portionszahl. |
| 35 | [Swissmilk (Kontrolle)](https://www.swissmilk.ch/de/rezepte-kochideen/rezepte/LM200801_75/kaiserschmarrn/) | Kaiserschmarrn | Importiert | 9 / 3 | 4 | HTML-Microdata geprüft. |

## Implementierte Änderungen

1. **Feldnormalisierung** in `ml-service/app/recipe_fields.py`: HTML-Entities, doppelt kodierte Zeichen, Groß-/Kleinschreibung bei verschachtelten Schema-Feldern und vorsichtige Portionsinterpretation. `original_yield` bleibt für Rückfragen erhalten.
2. **JSON-LD-Toleranz**: echte Zeilenumbrüche in JSON-Strings werden akzeptiert; JavaScript wird niemals ausgewertet. Defekte Typangaben verdecken nicht andere gültige Rezepte.
3. **Begrenzte HTML-Adapter** in `ml-service/app/recipe_sites.py`: Zucker & Jagdwurst (Rich-Text-Rezeptkarten), Springlane (klar abgegrenzte Artikelabschnitte) und FOOBY (sichtbare Zutaten desselben eindeutig identifizierten Rezepts). Templateabweichungen liefern keinen geratenen Inhalt.
4. **Fehlermeldungen** unterscheiden HTTP 401/403/429 von Parserproblemen. robots.txt-Sperren werden weiter beachtet. Kein Versuch, Sperren durch andere Identitäten/Endpunkte zu umgehen.
5. **Frontend**: keine stillschweigende Übernahme der Standard-Portionszahl bei unklarer Ausbeute. Die Vorschau wird nicht automatisch gespeichert.

## Reproduzierbare Prüfung

Abschließender Teststand: 101 Python-Tests (inklusive CPU-BERT), 52 Untertests,
41 Browser-Regressionen und 6 Frontend-Unit-Tests erfolgreich. `go test ./...`,
Frontend-Build und Docker-Build erfolgreich. Der Offline-Audit erfüllt alle
35 dokumentierten Erwartungen; darin enthalten sind ausdrücklich die drei
erwarteten Zugriffssperren, nicht 35 erfolgreiche Importe.

Nach Aktualisierung der lokalen Container: App- und ML-Healthchecks erfolgreich.
FOOBY, Kitchen Stories, Zucker & Jagdwurst, 750g, Cookie & Kate, Alnatura und
Springlane wurden zusätzlich live über `POST /api/recipes/import` geprüft
(je HTTP 200, erwartete Zutatenanzahl und Portionsentscheidung). Es wurden
ausschließlich Vorschauen erstellt, keine Rezepte im Tagebuch gespeichert.

Maschinenlesbare Ergebnisse: [Vorher](recipe-import-baseline.json), [Nachher](recipe-import-audit.json). Diese Dateien enthalten nur Metadaten, keine vollständigen fremden Rezepte. Abrufzeit und HTML-SHA-256 dokumentieren die geprüfte Version. Die Nachher-Datei kennzeichnet den Offline-Parserlauf ausdrücklich.

Das Manifest liegt unter [recipe_platforms.json](../ml-service/tests/fixtures/recipe_platforms.json). Offline-Regressionen verwenden selbst geschriebene Mini-Fixtures statt kopierter kompletter Rezeptseiten. Der Live-Audit ist ausdrücklich opt-in und gehört **nicht** zum normalen Testlauf.

Aus dem Repo-Verzeichnis, nach Build des ML-Images:

```sh
# Öffentliches Beispiel je Plattform neu abrufen; bestehende Audit-Ausgabe behalten.
docker run --rm -v "$PWD:/workspace" -w /workspace/ml-service \
  fiber-api-ml-service python scripts/audit_recipe_imports.py \
  --cache-dir /workspace/.recipe-audit-cache \
  --output /workspace/.recipe-audit-cache/live-results.json --verify

# Identische HTML-Snapshots erneut prüfen, ohne externe Requests.
docker run --rm -v "$PWD:/workspace" -w /workspace/ml-service \
  fiber-api-ml-service python scripts/audit_recipe_imports.py --offline \
  --cache-dir /workspace/.recipe-audit-cache \
  --output /workspace/.recipe-audit-cache/offline-results.json --verify
```

Optional `--platform "FOOBY"` für genau ein Beispiel. `--verify` vergleicht die dokumentierten Sollwerte; ein neuer Abruffehler bei vorher erfolgreicher Seite oder geänderte Parserwerte führen zu Exit 1. Erwartete Zugriffssperren werden als Sperren ausgewiesen, nicht als erfolgreich importierte Rezepte. Neue Seitenversionen können eine fachliche Überprüfung und Anpassung der Sollwerte erfordern.

Der lokale HTML-Cache ist in Git und Docker-Builds ausgeschlossen. Es werden keine Rezepte ins Tagebuch geschrieben. Die Anwendung bietet weiterhin eine bearbeitbare Vorschau; Zutaten, Allergene, Mengen und Nutzungsrechte müssen vor Speicherung oder Weitergabe geprüft werden.
