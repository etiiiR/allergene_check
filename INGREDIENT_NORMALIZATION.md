# Zutaten vereinheitlichen: Entscheidung und Umsetzung

Stand: 23. September 2026. Ziel: gleiche Zutaten trotz unterschiedlicher Mengen,
Schreibweisen und gebräuchlicher Synonyme gemeinsam auswerten. Nicht: medizinische
Kategorien aus Text oder Modellantworten erfinden.

## Recherche und Entscheidung

| Ansatz | Eignung für diese App | Entscheidung |
| --- | --- | --- |
| Mengen-/Einheitenregeln + kontrollierte Synonyme | Lokal, ohne Modellgewichte; eindeutige Namen ergeben reproduzierbare IDs | Implementierter Standard |
| Ingredient Parser NLP | Strukturierte Extraktion; die aktuelle API dokumentiert nur `en` als unterstützte Sprache | Kein fertiger deutschsprachiger Ersatz; [offizielle API](https://ingredient-parser.readthedocs.io/en/stable/reference/parsers.html) |
| Multilingual MiniLM | Satz-Embeddings, laut Modellkarte 50 Sprachen; semantische Ähnlichkeit ist keine Zutatenidentität | Möglicher späterer Kandidaten-Ranker, nicht automatische Zuordnung; [Modellkarte](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) |
| Qwen3-0.6B | Kleines generatives Modell mit 0,6 Milliarden Parametern; laut Anbieter Unterstützung für über 100 Sprachen/Dialekte | Möglicher lokaler Fallback für schwierige Texte, nicht installiert oder evaluiert; [Hersteller-Modellkarte](https://huggingface.co/Qwen/Qwen3-0.6B) |

Das ist eine Architekturentscheidung, kein gemessener Qualitätsvergleich dieser Modelle.
Für „1 Prise Salz“ ist kein LLM notwendig. Ein Modell könnte unbekannte Zutaten erklären,
aber auch Zusätze übersehen, Negationen verlieren oder unterschiedliche Zutaten vereinheitlichen.
Der lokale Standard deckt bekannte Fälle ab und verweigert die automatische Zuordnung im Zweifel.

## Pipeline

1. Originalzeile unverändert erhalten.
2. Gross-/Kleinschreibung, Leerzeichen, Brüche und Mengenbereiche vereinheitlichen.
3. Bekannte führende Mengen/Einheiten entfernen (`g`, `TL`, `Prise`, `½`, `1–2` usw.).
4. Eng begrenzte Angaben wie `Bio-`, `weich`, `gehackt`, `nach Geschmack` für die Identität entfernen.
5. Den **gesamten** verbleibenden Namen mit dem Synonymkatalog vergleichen.
6. Bei genauem Treffer die stabile Lebensmittel-ID verwenden.
7. Sonst bereinigten eigenen Namen behalten; Teiltreffer/Schreibähnlichkeit nur als bestätigungspflichtige Vorschläge anzeigen.

Die Vorschlagsgrenze von 0,82 ist ein technischer String-Similarity-Schwellwert, keine
kalibrierte Konfidenz. Es gibt keinen automatischen Fuzzy-Merge. Neue Katalogeinträge haben
`level: unknown`, keine abgeleiteten Allergene und keine erfundenen FODMAP-Bewertungen.

| Eingabe | Identität |
| --- | --- |
| `1 Prise Salz`, `½ TL Salz`, `Salz nach Geschmack` | `salt` / Salz |
| `100 g Puderzucker`, `Staubzucker` | `powdered-sugar` / Puderzucker |
| `250 g Butter , weich` | `butter` / Butter |
| `3 Bio-Zitronen` | `lemon` / Zitrone |
| `4 Eier` | `egg` |
| `Mehl` / `Weizenmehl` / `Mandelmehl` | Drei unterschiedliche IDs; generisches Mehl wird nicht zu Weizen geraten |
| `Milch` / `Mandelmilch` / `laktosefreie Milch` | Unterschiedliche IDs |
| `Salz oder Zucker`, `ohne Milch`, `glutenfreies Mehl` | Eigener Name, manuelle Prüfung |

## Integration und Historie

- `ml-service/app/ingredient_normalization.py`: Vorschau und Vorschläge beim Rezeptimport.
- `ingredient_normalization.go`: dieselbe Normalisierung bei Analyse bestehender Mahlzeiten und Markierungen.
- `ml-service/app/data/ingredient_rules.json` und `foods.json`: gemeinsame Regeln und Synonyme.
- `Recipe.analysis_ingredient_ids`: serverseitig abgeleitete Keys für Rezeptdetail-Auswertungen;
  das Frontend baut nicht mehr eigene `custom:1 prise salz`-Keys.
- Manuell bestätigte `food_ids` haben Vorrang vor der Textnormalisierung.
- Originaltexte und Mahlzeit-Snapshots werden nicht migriert oder überschrieben. Beim nächsten
  Analyseaufruf werden bisher unzugeordnete, eindeutig erkennbare Zutaten gemeinsam verglichen.
- URL-Importe erhalten dieselbe Zuordnungsvorschau; ein Erkennungsfehler lässt den Rezeptentwurf bestehen.

Mengen bleiben im Originaltext; dies ist noch kein Dosis-Wirkungs-Modell. Zubereitungsformen,
Markennamen, komplexe Mischungen und unbekannte Sprachen sind nicht vollständig abgedeckt.
Der Katalog ist bewusst begrenzt und soll mit überprüften Synonymen wachsen.

## Tests und weiterer Modellversuch

Ein gemeinsamer Korpus mit 46 Positiv- und Negativbeispielen wird in Go und Python getestet.
Zusätzliche Tests prüfen Priorität manueller IDs, unveränderte historische Texte, fehlende
erfundene Allergen-Tags und den Unterschied zwischen Vorschlag und bestätigter Zuordnung.

```sh
go test ./...
cd ml-service
python3 -m unittest discover -s tests -p test_ingredient_normalization.py -v
```

Vor einem LLM-Rollout: einen grösseren, getrennten deutschen/Schweizerdeutschen Testdatensatz
aufbauen; falsche Zusammenführungen, Abdeckung, Review-Anteil, RAM und CPU-Latenz messen.
Ein optionales lokales Modell dürfte nur vorhandene IDs oder `unknown` vorschlagen;
Antworten wären schema-validiert, zeitbegrenzt und zunächst immer bestätigungspflichtig.
Keine Diagnose-, Allergenfrei- oder FODMAP-Entscheidungen aus einem Sprachmodell übernehmen.
