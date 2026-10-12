# Bauchgefühl — recipe & symptom diary

A German-language personal food diary built with Go Fiber, the [Gonertia Go adapter](https://github.com/romsar/gonertia), Vue 3, SurrealDB, and a local Python analysis service. The server rendering follows the linked [Gonertia Vue example](https://github.com/henrriusdev/gonertia_vue_example).

## What you can do

- Save and edit recipes; paste ingredient lines for NLTK recognition, then confirm food mappings and allergens.
- Log a recipe as a timestamped meal with portions and notes. Every meal retains a snapshot of the recipe's ingredients.
- Record six symptom types with a 0–5 star-style scale (kept in the existing 0–10 analysis format), stress, sleep, or an explicit symptom-free check-in. Add multiple moments on the same day and optionally describe when symptoms started after a meal.
- Filter the diary by date, symptom, or symptom-free entries and sort by severity.
- Compare ingredient, spice, and confirmed-allergen associations across observed moments. Open a recipe's personal comparison before choosing what to cook.
- Browse 27 general food references and 10 unclassified spices/herbs. English and German aliases are supported; this is a small curated vocabulary, not unrestricted recipe understanding.
- Preview-import a recipe from a public URL using Schema.org JSON-LD, HTML Microdata (including Swissmilk-style ingredient tables), or clearly marked HTML recipe blocks; nothing is saved until you review the ingredients.
- Use the fast-entry flow: recent recipes, one-tap symptom-free moments, three common symptom shortcuts, severity presets, timing windows, optional meal references, default time/portion values, and optional details hidden until needed.
- Add an optional body-context profile. Male, female, and other/unspecified contexts are kept separate; cycle tracking is opt-in and only runs in the female cycle context.
- Review a non-food signal when symptoms repeatedly appear without a matching, documented food window. This is an exploratory prompt to consider stress, sleep, medication, unlogged meals, or other health factors — not a diagnosis.
- Mark a recipe as personally suspicious or mark a specific reaction manually. Add a simple next-day stool observation; the pattern summary can combine these personal signals with timing and ingredient associations.
- Import provider-normalized stress scores plus raw HRV/pulse/sleep metrics from an iOS HealthKit or Android Health Connect bridge, watch export, or ring adapter. The analysis never turns raw HRV or pulse into a guessed stress score.
- Create a compact doctor-facing full-data overview at `/report`. It summarizes the documented period, symptoms, ingredient associations and overlaps, timing windows, stool observations, stress comparison, and possible non-food factors. The browser print dialog can save it as a one-page PDF; the share button uses the device's native share sheet or copies a text summary as a fallback.
- Download and restore an encrypted vault backup; backups contain ciphertext, not a readable diary. Delete individual records; recipe deletion does not erase historical meals.

## Privacy and scope

This is a **single-person local application** with no accounts or per-person server authorization. Keep Docker Compose ports bound to `127.0.0.1`; do not expose the app publicly. Browser responses set a restrictive same-origin Content Security Policy and basic anti-framing/content-type headers, but these are defense-in-depth. The encrypted vault protects diary content at rest and during vault synchronization, not against a compromised device, a malicious app update, XSS, or access to an unlocked browser. No cloud AI service receives diary text. Recipe import sends the chosen URL to the local crawler service. Fonts are bundled locally.

After setup, diary records and the personal profile (including the pseudonym) are encrypted in the browser with AES-GCM before the server stores them in the `diary_vault` table. Passphrase and recovery key are not sent to the server. While unlocked, the diary is present in browser memory; lock it when leaving the device. Keep the recovery key separately: losing both keys means permanent data loss. In Profile → Sicherheit, you can replace both credentials; the diary is re-encrypted on the device with a fresh data key, and the replacement is committed only after you confirm the new recovery phrase. Previously downloaded backups remain unchanged and continue to require the credentials that were active when each backup was made. The profile page downloads an encrypted JSON backup containing only the ciphertext envelope; it can be restored only into an empty vault after local verification with the passphrase or recovery key. Existing plaintext records require the explicit first-run migration; after the encrypted copy is verified, the primary legacy rows are removed transactionally. Historical database snapshots and old exports are not automatically erased. The pseudonym is a display label, not anonymity or an account credential. The legacy plaintext API is disabled except for this one-time migration route. The vault uses revision checks backed by a database transaction; this prevents silent concurrent overwrite but does not add user authentication. Review retention of old database/volume backups before changing deployments.

## How analysis works

NLTK tokenization matches curated aliases using whole tokens and longest matches; almond milk must not be misidentified as cow's milk. Unknown and ambiguous lines need review. Unknown ingredients are compared by their exact lowercased, whitespace-normalized text; use consistent naming or a catalog mapping when quantities change. Allergens must be explicitly confirmed from ingredient labels. Missing allergen tags never mean allergen-free. Tiny BERT remains available for text similarity, but its embedding scores do not establish ingredient identity, allergy, or FODMAP content.

The analysis keeps each documented check-in moment in the browser's local timezone; multiple moments on one day remain separate, and a later symptom-free moment does not erase earlier symptoms. Symptoms can use a direct, 30-minute–2-hour, 2–6-hour, 6–24-hour/following-day, or unknown timing window, with an optional reference to a specific meal. The general 4/8/12/24-hour setting applies only when the timing is unknown. A day without a check-in is **missing**, not symptom-free. A selected symptom score of at least 3/10 is the exploratory outcome; comparison moments can include milder symptoms and are labelled separately from strictly symptom-free entries.

The non-food assessment compares symptom moments with and without a matching meal window. It can surface that a food explanation is incomplete, but it cannot determine that food has no role and cannot identify another illness. Menstrual-cycle context is analysed separately when enabled in the profile; the app stores a rough phase/day snapshot on each check-in rather than mixing it into the general food model. Cycle estimates are approximate because cycle lengths vary; the [Office on Women's Health overview](https://womenshealth.gov/menstrual-cycle/your-menstrual-cycle) notes that regular cycles can still range from 24 to 38 days. This feature is not fertility, contraception, or diagnosis guidance.

Recipe flags are explicit personal evidence, not confirmed intolerance. Stool observations are intentionally simple descriptions rather than a clinical stool scale; the [NIDDK stool diary](https://www.niddk.nih.gov/-/media/Files/Weight-Management/Stool_Diary_508.pdf) is a useful reference for why consistency and frequency can be worth documenting. Persistent, severe, bloody, black, or dehydrating bowel symptoms should be discussed with a medical professional; the [NIDDK constipation guidance](https://www.niddk.nih.gov/health-information/digestive-diseases/constipation/symptoms-causes) and [diarrhea guidance](https://www.niddk.nih.gov/health-information/digestive-diseases/diarrhea/symptoms-causes) describe warning signs.

Wearable stress data is an optional personal context signal. The [Apple HealthKit documentation](https://developer.apple.com/documentation/healthkit) describes a permission-controlled native repository for iPhone and Apple Watch data, while [Android Health Connect](https://developer.android.com/health-and-fitness/health-connect) provides a permission-controlled on-device health data layer. This server therefore exposes a normalized import contract rather than pretending a web page can directly read a watch or ring. See [`mobile-bridge/README.md`](mobile-bridge/README.md) for the bridge contract and sample payload. Provider availability and score semantics vary; a raw HRV or pulse reading is not automatically a stress measurement.

Descriptive comparisons need at least three exposed and three unexposed moments. Regularized multivariable logistic regression additionally requires at least 20 observed moments and at least five moments in each outcome class. Stress and sleep are optional: only explicitly recorded or normalized values count as observations. The model uses a context feature only when at least five varying values are available; remaining gaps are filled with that feature's observed mean for fitting, never with a made-up zero or default. Older entries without a confirmation marker are excluded from stress/sleep analysis until reviewed in the editor. Perfectly co-occurring ingredients are identified as inseparable. The application shows sample counts and exploratory coefficients, not validated accuracy, causal probabilities, or diagnoses. These minimums are engineering guardrails, not clinical validation. The configured time window is not a medically established response window. There is no portion-dose model, controlled experiment, clinical evaluation, or allergy test.

FODMAP references are based on [Monash University's public overview](https://www.monashfodmap.com/about-fodmap-and-ibs/high-and-low-fodmap-foods/), reviewed 2026-09-21. They are general examples without licensed laboratory serving-size data. Spices are explicitly unclassified. A low-FODMAP reference does not imply tolerance or absence of allergens. Persistent symptoms and restrictive diet changes should be discussed with an appropriate clinician/dietitian.

## Code organization

`diary_models.go` validates domain inputs; `diary_store.go` owns persistence; `diary_routes.go` owns JSON handlers; `analysis_client.go` calls Python with a deadline; `food_catalog.go` embeds the shared catalog; `web.go` bridges Gonertia's Vite integration into Fiber. Vue pages, reusable forms and styles live in `web/src/`. The UI uses Tailwind CSS 4 and DaisyUI 5 with a shared slate/indigo theme, reusable components in `components/ui/`, and a five-destination mobile navigation. Forms and confirmation views open within the main page: no modal overlays or focus traps. See [UX_THEME_STUDY.md](UX_THEME_STUDY.md) for the heuristic audit, implemented decisions, limitations and follow-up research. Python's reusable diary analysis lives in `ml-service/app/diary_analysis.py`; the review-first importer lives separately in `ml-service/app/recipe_scraper.py` and uses `httpx` plus BeautifulSoup.

## Personal setup and quick entries

Ingredient identities are normalized locally: `1 Prise Salz`, `½ TL Salz` and `Salz` share
the same analysis key, including in existing meal snapshots. Raw recipe text is retained.
Unknown or ambiguous names stay reviewable; no LLM, external API or model download is required.
See [INGREDIENT_NORMALIZATION.md](INGREDIENT_NORMALIZATION.md) for the researched alternatives,
mapping rules, safety boundaries and shared Go/Python regression corpus.

Use **Person anlegen** on Today, or open `/onboarding`, to save one personal profile in
three short steps. It suggests a pseudonym; no real name is needed. The pseudonym is a display
label, not anonymity or authentication. The profile, setup state and cycle settings are part of
the encrypted diary vault, not plaintext database fields. `/profile` separates Person,
Body/Cycle, and Health. This is one shared local diary, not separate user accounts.

Today shows quick actions, two recipe shortcuts and the three newest entries. The complete
history stays in the diary. Symptom logging uses two steps; good moments and meals stay short.
Optional details expand inline. Unsaved wizard inputs do not survive a page refresh.

Meal entry can create a recipe inline and selects it afterwards. **Good** is an explicit editable
default at meal time; **Symptoms** continues to the symptom wizard and **Don't record** leaves
wellbeing unknown. The meal and good-moment record are saved in one transaction. These marked
`meal_baseline` moments are visible in the diary but excluded from later-tolerance and stress
modelling; ordinary missing follow-ups are never treated as symptom-free.

### Direct Apple Health (iOS first)

The native SwiftUI/HealthKit wrapper is prepared in [mobile/ios](mobile/ios/README.md).
It requests actual iOS read permission for heart rate, resting heart rate and HRV and uses the
existing same-origin import API without a user-supplied file. Profile → Health enables this
only inside that native wrapper. Safari/PWA cannot grant HealthKit access. Android and Samsung
are not implemented. The wrapper still needs full Xcode, signing, a protected HTTPS server and
a real-device test; it has not been built or installed here.

## Run the stack with Docker Compose

Docker Compose builds the Vue assets and starts Fiber, persistent SurrealDB, and the Python ML service. For a **new, empty database volume**, create private database and one-time account setup secrets; the helper writes them to the ignored `.env` file with owner-only permissions and never replaces an existing file:

```sh
sh setup-local-env.sh --new
docker-compose up --build
```

If you already have a SurrealDB volume, do **not** use `--new`: its database password is stored inside that volume and is not changed by Compose. Keep your existing database credentials, then run `sh setup-auth-token.sh` to add the one-time account setup code without replacing `.env`. For a manually created `.env`, set the existing database credentials and `chmod 600 .env` before starting. Using the wrong credentials will keep the app from connecting, but will not delete the existing data.

Open the app at `http://localhost:3000`. On first visit, create the one account for this installation with the setup code from `.env`, then choose a pseudonymous username and a separate account password. Every new device signs in with those account credentials and then unlocks the encrypted diary with its own copy of the vault passphrase or recovery phrase. SurrealDB is at `http://localhost:8000`, and Python API docs are at `http://localhost:8001/docs`.
SurrealDB `v3.3.0` is pinned rather than following the moving `latest` tag. Data is stored in the named `surrealdb-data` volume. Before changing the database version, take a backup and verify restore plus the integration tests against that version.

The app and ML container base images also use explicit runtime and OS versions (Node `24.21.0`, Go `1.27.1`, Python `3.12.15`, Alpine `3.24.2`, and Debian Bookworm). Refresh these pins deliberately, then rebuild and run the full test suite; a version tag still needs regular security updates.

The Python container runs as an unprivileged UID and forces Hugging Face model access offline after the pinned tiny-BERT files are included in the image. Docker places SurrealDB on an isolated internal network; only Fiber connects both to that database and the Python service. The crawler has outbound access for explicitly requested public recipe URLs but cannot resolve or reach the database network. Recipe URL importing remains an explicit network operation; diary analysis does not send personal diary data to that service.

For a quick manual test:

```sh
cd /Users/etiiir/Documents/Codex/2026-09-15/cre/fiber-api
docker-compose up --build
```

Use `docker-compose up -d --build` to run in the background, `docker-compose ps` to check service health, and `docker-compose logs -f app` to follow Fiber logs. Stop everything with `docker-compose down`.

Stop the stack with:

```sh
docker-compose down
```

Compose refuses to start if database credentials or `ACCOUNT_SETUP_TOKEN` are missing; there is no `root` / `root` fallback. `.env.example` documents the variables, but its secrets are intentionally blank. The setup code can create only the first account. Keep `.env` private and do not publish the application port directly. Remote multi-device access is an MVP: put an HTTPS reverse proxy in front of the loopback-bound app, set `APP_URL` to the exact `https://` origin, and forward the original `Host` header. The server refuses a non-local `APP_URL` without HTTPS and issues `HttpOnly`, `SameSite=Strict`, `Secure` cookies for HTTPS. Sessions expire after 30 days; Profile → Sicherheit can revoke the current device only. There is no email/password recovery or screen to revoke other devices yet; do not treat this MVP as a production security review.

## Run

Requires Go 1.27 (required by the pinned Go Inertia adapter), Node 22.12+ or 24+, and the database/ML services. Build frontend assets before starting Go:

```sh
npm --prefix web ci
npm --prefix web run build
set -a
. ./.env
set +a
go run .
```

For frontend changes, run `npm --prefix web run dev` in another terminal and reload the page. This watches production assets; it is not a Vite HMR server. Set `APP_URL` alongside `PORT` if changing the browser URL, and `ML_SERVICE_URL` if using a different Python endpoint.

The server connects to SurrealDB at `ws://localhost:8000/rpc` by default and direct Go startup binds to `127.0.0.1:3000` only. Start SurrealDB separately before running the API locally. Database credentials and a 32-character one-time account setup secret are required; helpers create them in the ignored `.env`. To load them into a local Go process, run `set -a; . ./.env; set +a` in that shell first. Set `PORT` to use a different port. `LISTEN_HOST` defaults to loopback; only override it for a private container network or behind a verified HTTPS proxy. Compose binds the app inside its container but publishes the host port only on `127.0.0.1`:

```sh
PORT=8080 go run .
```

## Endpoints

- `GET /`, `/diary`, `/recipes`, `/calendar`, `/insights`, `/report`, `/foods` — Inertia/Vue pages
- `GET /api/status` — original boilerplate status response
- `GET /api/vault`, `PUT /api/vault` — read/write only the opaque encrypted envelope with a revision check
- `GET /api/legacy/diary` — one-time plaintext migration; requires an explicit migration header and is disabled after vault setup
- `POST /api/recipes/import` — preview-import public recipe HTML; the chosen URL is sent to the local Python crawler
- Personal CRUD, profile, ingredient normalization, exports, and `/patterns` run locally in the unlocked browser. The old plaintext personal API routes are disabled for direct callers.
- `GET /health` — checks the Fiber process and SurrealDB connection
- `GET /ws/live/:table` — upgrades to WebSocket and streams table changes; add `?diff=true` for JSON Patch diffs

## Python ML service

The nested [ml-service](ml-service) uses FastAPI with Uvicorn and scikit-learn for small stateless training/prediction requests. FastAPI is a good fit here because it provides typed request validation and an OpenAPI UI at `http://localhost:8001/docs`; Uvicorn can run multiple workers for deployments that need process-level replication.

Endpoints:

- `GET /health`
- `POST /ml/linear-regression`
- `POST /ml/logistic-regression`
- `POST /nlp/text-similarity` — NLTK lexical analysis
- `POST /nlp/bert-similarity` — CPU-only tiny-BERT semantic similarity
- `POST /diary/ingredients` — curated ingredient recognition
- `POST /diary/patterns` — temporal diary analysis
- `POST /diary/scrape` — bounded recipe preview importer; respects robots.txt by default and rejects private/local destinations

### Recipe URL import

The importer downloads HTML, without executing page scripts or requiring an LLM.
`ml-service/app/recipe_scraper.py` handles fetching and the preview response;
`ml-service/app/recipe_html.py` contains reusable, offline-testable HTML extraction.
`recipe_fields.py` normalizes publisher fields and yields; `recipe_sites.py` keeps
verified, host-scoped HTML adapters separate from the generic parser.
It prefers Recipe JSON-LD, then Recipe Microdata (`itemscope`/`itemprop`), then
explicit recipe containers with named ingredient and instruction lists (including
common WP Recipe Maker/Tasty Recipes patterns). Navigation and executable content
are removed; separate recipe candidates are never combined.

Amounts, units and ingredient wording are kept in the editable preview. The UI
then uses the existing ingredient normalizer for comparison identities, so
“1 Prise Salz” can be compared as salt without losing the original quantity.
Unambiguous serving counts (1–50) are filled in; ambiguous yields such as “1 Kuchen”
produce a review warning. The response also includes `extraction_method` and
`warnings`, plus the `original_yield`. Ambiguous piece/loaf counts clear the UI's
default portion count and require a deliberate choice. Saving is always a
separate, explicit step.

This is not a universal scraper: JavaScript-only, access-restricted or unmarked
pages may still require manually pasted ingredients. No paywall or bot-protection
bypass is attempted. Check ingredients, quantities, allergens and source usage
rights before saving or sharing. The synthetic Microdata fixture and scraper
regressions run offline; a live Swissmilk Kaiserschmarrn check on 2026-09-25 found
9 ingredient rows, 4 servings and 3 preparation steps.

The extended [35-platform sample audit](docs/RECIPE_IMPORT_AUDIT.md) documents
34 additional platforms plus Swissmilk, example URLs, before/after metadata and
reproduction commands. After fixes, 31 additional examples plus Swissmilk were
importable; REWE/EDEKA returned HTTP 403 and Taste.com.au disallowed the download
via robots.txt. This is sample-level evidence, not a guarantee for every page on
these platforms. The normal regression suite is offline; the opt-in audit uses
`ml-service/scripts/audit_recipe_imports.py` and a Git-/Docker-ignored HTML cache.

### API request examples

The opt-in SurrealDB integration tests can remove records from their test tables;
the vault-migration test deliberately clears the legacy diary tables. They refuse
to run unless both the namespace and database have an explicit
`_test`, `_tests`, `-test`, or `-tests` suffix. Point them only at a disposable
test database, never the personal `main` database:

```sh
SURREALDB_NAMESPACE=gutfeeling_test SURREALDB_DATABASE=gutfeeling_test RUN_INTEGRATION_TESTS=1 go test -count=1 ./...
```

The ordinary `go test ./...` suite does not connect to or modify a database.

Go JSON mutations require `Content-Type: application/json` and `X-Diary-Request: 1`. Cross-origin browser requests are rejected; responses are not cached. These controls are not a replacement for authentication on public deployments.

Example linear regression request:

```sh
curl -X POST http://localhost:8001/ml/linear-regression \
  -H 'Content-Type: application/json' \
  -d '{"features":[[1],[2],[3],[4]],"target":[3,5,7,9],"predict":[[5],[6]]}'
```

Example NLTK text similarity request:

```sh
curl -X POST http://localhost:8001/nlp/text-similarity \
  -H 'Content-Type: application/json' \
  -d '{"text_a":"The allergen warning is important.","text_b":"An important allergen warning."}'
```

Example tiny-BERT semantic similarity request:

```sh
curl -X POST http://localhost:8001/nlp/bert-similarity \
  -H 'Content-Type: application/json' \
  -d '{"text_a":"This product contains peanuts.","text_b":"Peanuts are present in this product."}'
```

The BERT endpoint uses `prajjwal1/bert-tiny` at a pinned [Hugging Face commit](https://huggingface.co/prajjwal1/bert-tiny/commit/6f75de8b60a9f8a2fdf7b69cbd86d9e64bcb3837), forces inference to CPU, mean-pools its hidden states, and returns cosine similarity. The model revision and local-only loading status are visible in `/health`; Docker caches that exact revision and refuses runtime model downloads.

`ml-service/pyproject.toml` and `uv.lock` define the Python dependency set. The generated `requirements.lock` and `requirements-dev.lock` pin every package with hashes for pip/Docker. PyTorch is explicitly sourced from its CPU index on Linux; ordinary packages resolve from PyPI, avoiding the old shared extra-index resolution. `requirements-cpu.txt` and `requirements-dev.txt` remain compatibility entry points.

Run the Python tests from the nested service with its development dependencies installed:

```sh
cd ml-service
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r requirements-dev.lock
python -m nltk.downloader stopwords
python -m pytest
```

After changing dependency ranges in `pyproject.toml`, update `uv.lock` and regenerate both pip exports with `uv lock --upgrade` and `uv export --format requirements.txt --locked --no-dev --no-emit-project --emit-index-url -o requirements.lock` (repeat `uv export` without `--no-dev` for `requirements-dev.lock`).

The deterministic synthetic benchmark lives in [`ml-service/tests/fixtures/diary_synthetic_large.json`](ml-service/tests/fixtures/diary_synthetic_large.json) and is checked by [`test_synthetic_diary.py`](ml-service/tests/test_synthetic_diary.py). It expands five recipe scenarios into 72 meal/check-in moments, includes all supported symptom keys, a planted allium trend, a secondary milk signal, a spice negative control, and four normalized health-stress overrides. The test checks qualitative associations, model readiness, stress comparison, and confounding guardrails; it intentionally expects a trend label rather than a “correct diagnosis”. Run only this benchmark with `python -m pytest tests/test_synthetic_diary.py`.

The standard Python tests skip model loading. To include the BERT regression test:

```sh
RUN_BERT_TESTS=1 python -m pytest
```

## SurrealDB helpers

[surreal_helpers.go](surreal_helpers.go) wraps the official SDK with parameterized query and typed helpers for:

- `Query`, `QueryRaw`
- `Select`, `Create`, `Insert`, `Update`, `Upsert`, `Merge`, `Patch`, `Delete`
- `Relate`, `InsertRelation`
- interactive transactions with `Begin`, `Commit`, `Rollback`, `WithTransaction`, and `RunInTransaction`
- `Version`, `Info`, `Let`, `Unset`, `Authenticate`, `Invalidate`
- live subscriptions with `WatchTable` and `KillLive`

Typed helpers are package-level generic functions because Go does not support generic methods:

```go
notes, err := Select[[]Note](ctx, store, models.Table("notes"))
note, err := Create[Note](ctx, store, models.NewRecordID("notes", "welcome"), data)
results, err := Query[[]Note](ctx, store, "SELECT * FROM notes WHERE done = $done", map[string]any{"done": false})
```

### Transaction boilerplate

Use the explicit methods when you need manual transaction control. The SDK CRUD helpers accept the transaction returned by `Begin`:

```go
tx, err := store.Begin(ctx)
if err != nil {
    return err
}

if _, err = surrealdb.Create[Note](ctx, tx, models.NewRecordID("notes", "welcome"), note); err != nil {
    _ = store.Rollback(ctx, tx)
    return err
}

return store.Commit(ctx, tx)
```

For automatic commit/rollback handling, use `WithTransaction`:

```go
err := store.WithTransaction(ctx, func(tx *surrealdb.Transaction) error {
    if _, err := surrealdb.Create[Note](ctx, tx, models.Table("notes"), note); err != nil {
        return err // automatically rolls back
    }
    _, err := surrealdb.Update[Note](ctx, tx, models.NewRecordID("notes", "welcome"), note)
    return err // commits when nil, rolls back when non-nil
})
```

Interactive transactions use the WebSocket connection and inherit the authenticated namespace/database session.

Connect a WebSocket client to `ws://localhost:3000/ws/live/notes`. Each connection receives a subscription message followed by `CREATE`, `UPDATE`, or `DELETE` change messages from SurrealDB.

## Error handling

[errors.go](errors.go) provides one error type and response contract for HTTP and WebSocket clients:

```json
{
  "error": {
    "code": "database_unavailable",
    "message": "SurrealDB is unavailable"
  }
}
```

Wrap internal causes with `WrapAppError`. The cause is retained for server logs and `errors.Is`/`errors.As`, but is not sent to clients.

## Test

### Tagebucheinträge bearbeiten

Im Tagebuch öffnet der Stift neben jedem Eintrag eine Bearbeitungsansicht ohne Modal. Mahlzeiten, Befinden (auch mehrere Symptome), Stuhlbeobachtungen und manueller Stress lassen sich korrigieren. Abbrechen verwirft nur den lokalen Entwurf; Speicherfehler behalten ihn bei.

- `PUT /api/{meals|checkins|stools|stress}/:id` aktualisiert einen vorhandenen Eintrag mit derselben ID. Nicht übermittelte Felder bleiben erhalten; ungültige Werte liefern 422, fehlende Einträge 404. Die üblichen Same-Origin-/Request-Header gelten auch hier.
- Mahlzeiten behalten beim gleichen Rezept ihren historischen Zutatenstand. Nur ein ausdrücklich anderes Rezept übernimmt dessen Zutaten. Bestehende mahlzeitbezogene Reaktionsmarkierungen müssen vor einem Rezeptwechsel entfernt werden. Befinden-Einträge bleiben eigenständige Beobachtungen mit eigenem Zeitpunkt.
- Notizkorrekturen an „Gut beim Essen“ bleiben von der Verträglichkeitsanalyse ausgeschlossen. Erst Beschwerden oder „Als eigenständige Beobachtung bestätigen“ machen daraus einen regulären Check-in. Historischer Zykluskontext wird nicht anhand des heutigen Profils überschrieben.
- Bei importierten Health-Messungen ist nur die Notiz bearbeitbar. Originalwerte, Einheit, Quelle und Zeitpunkt sind serverseitig geschützt. Eine erneute Synchronisation kann die Notiz ersetzen.
- Nach erfolgreichem Speichern fragt die UI die Analyse erneut an (alle Symptome, 8-Stunden-Fenster). Ein separater Status zeigt Erfolg oder bietet einen erneuten Versuch bei ML-Ausfall; die gespeicherte Korrektur bleibt in beiden Fällen erhalten. Muster und Arztbericht berechnen beim Öffnen mit ihren jeweiligen Zeitfenstern aus dem aktuellen Tagebuch. Bereits exportierte PDFs bleiben unverändert und müssen neu erstellt werden.

Die Regeln liegen in `diary_edit.go`, die gemeinsame Ansicht in `web/src/components/DiaryEntryEditor.vue`. Regressionen: `diary_edit_test.go` und `web/tests/diary-edit.spec.js`.

### Rezeptsuche für große Sammlungen

Mahlzeit-Erfassung und Tagebuch-Bearbeitung verwenden denselben `RecipePicker`: drei schnelle Vorschläge, Suche nach Rezeptname **und** Zutaten, maximal sechs Ergebnisse pro Seite und eine kompakte, jederzeit änderbare Auswahl. „Zuletzt verwendet“, „Häufig gegessen“ und „Name A–Z“ nutzen vorhandene Mahlzeiten, ohne zusätzliche Pflege von Favoriten zu verlangen. Zutaten-Vorschauen unterscheiden gleichnamige Rezepte. Keine Auswahl behauptet Verträglichkeit.

Die Rezeptsammlung zeigt zwölf kompakte Einträge pro Seite. Suche/Sortierung setzen auf Seite 1 zurück; fehlende Treffer werden von einer leeren Sammlung unterschieden. Sekundäre Aktionen sind unter „Bearbeiten & weitere Optionen“ erreichbar. Neue Rezepte werden nach dem Anlegen sichtbar gefiltert.

`web/src/recipe-search.js` baut einen lokalen Suchindex pro Datenänderung auf; Suchwörter werden über Name/Zutaten kombiniert, Großschreibung, Akzente und deutsche Umlautumschreibungen ignoriert. Dies ist ausschließlich Suchnormalisierung, keine medizinische Zutatenklassifikation. Die bestehende API liefert weiterhin die vollständige Sammlung; für deutlich größere Bestände sollte serverseitige Suche/Paginierung ergänzt werden.

Tests: `npm --prefix web run test:unit` prüft die Suchregeln; `web/tests/recipe-search.spec.js` erstellt 200 echte Testrezepte ausschließlich in der getrennten Test-App und prüft Auswahl, Suche, Paging, Tastatur, mobile Darstellung und Bearbeitung.

### Tests ausführen

Run the browser-independent regression checks with `GOCACHE=/private/tmp/gutfeeling-go-cache go test ./...` and `npm --prefix web run test:unit`. For Playwright, use a dedicated SurrealDB database and port 3001; the browser suite seeds and inspects data through an encrypted test vault and must never target the personal app on port 3000.

GitHub Actions is configured to run the Go race detector and `go vet`, frontend unit tests and a production asset build, the Python suite including CPU-only BERT, a full Compose runtime smoke test, plus the Playwright UX/accessibility suite and SurrealDB transaction tests against an ephemeral test database. The workflow uses read-only repository permissions and dedicated disposable test databases; it never targets a personal database.

Build the test-only event bridge, then start the isolated app:

```sh
npm --prefix web run test:e2e:build
PORT=3001 APP_URL=http://localhost:3001 SURREALDB_DATABASE=ux_tests go run .
```

In another terminal run `ALLOW_E2E_VAULT_MUTATION=1 APP_TEST_URL=http://localhost:3001 npm --prefix web test`. The browser fixture uses a test-only passphrase and encrypted vault. The explicit opt-in is required because the suite updates vault contents; never set it for a patient's database.

The end-to-end backup recovery test also needs a second app on port 3002 connected to a separate, fresh disposable `*_tests` namespace/database. Set `RESTORE_TEST_URL=http://localhost:3002` when running Playwright to include it. Without that variable, the recovery test is skipped; it never clears or overwrites the shared test vault.

Python tests cover alias specificity, unknown ingredients, meal-before-symptom ordering, missing check-ins, duplicate-day handling, symptom filters, co-occurring allergens and ingredients, and the model's data thresholds.

```sh
go test ./...
```

The default suite is self-contained. To run the SurrealDB transaction, live-query, revision-conflict, and legacy-migration integration tests, use a disposable test database (not the local personal `main` database):

```sh
SURREALDB_NAMESPACE=gutfeeling_test SURREALDB_DATABASE=gutfeeling_test RUN_INTEGRATION_TESTS=1 go test -count=1 ./...
```
