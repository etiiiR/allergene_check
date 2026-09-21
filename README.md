# Bauchgefühl — recipe & symptom diary

A German-language personal food diary built with Go Fiber, the [petaki Go Inertia adapter](https://github.com/petaki/inertia-go), Vue 3, SurrealDB, and a local Python analysis service.

## What you can do

- Save and edit recipes; paste ingredient lines for NLTK recognition, then confirm food mappings and allergens.
- Log a recipe as a timestamped meal with portions and notes. Every meal retains a snapshot of the recipe's ingredients.
- Record six symptom types on a 0–10 scale, stress, sleep, or an explicit symptom-free check-in. Use the date picker to backfill days.
- Filter the diary by date, symptom, or symptom-free entries and sort by severity.
- Compare ingredient, spice, and confirmed-allergen associations across days. Open a recipe's personal comparison before choosing what to cook.
- Browse 27 general food references and 10 unclassified spices/herbs. English and German aliases are supported; this is a small curated vocabulary, not unrestricted recipe understanding.
- Export your diary as JSON and delete individual records. Recipe deletion does not erase historical meals.

## Privacy and scope

This is a **single-person local application**, with all Compose ports bound to `127.0.0.1`. It has no accounts or multi-user authorization. Do not expose it publicly without adding authentication, per-user database scoping, TLS and operational safeguards. The existing generic live-query helper is also intended for trusted local development. No cloud AI service receives diary text. Fonts are bundled locally. Initial image construction downloads dependencies and model weights; the diary's ingredient/pattern analysis does not contact external AI services.

Data lives in the existing SurrealDB volume, in `diary_recipes`, `diary_meals`, and `diary_checkins`. The application reuses one authenticated DB connection and one pooled Python HTTP client. These dedicated tables do not modify the existing boilerplate tables. Back up the volume or export your diary before changing deployments.

## How analysis works

NLTK tokenization matches curated aliases using whole tokens and longest matches; almond milk must not be misidentified as cow's milk. Unknown and ambiguous lines need review. Unknown ingredients are compared by their exact lowercased, whitespace-normalized text; use consistent naming or a catalog mapping when quantities change. Allergens must be explicitly confirmed from ingredient labels. Missing allergen tags never mean allergen-free. Tiny BERT remains available for text similarity, but its embedding scores do not establish ingredient identity, allergy, or FODMAP content.

The analysis takes one observation per local day (browser timezone): the check-in with the strongest selected symptom, choosing the latest on ties. This prevents repeated same-day check-ins from inflating the sample and a later symptom-free entry from erasing earlier symptoms. It only considers meals before that check-in within a selectable 4/8/12/24-hour window. A day without a check-in is **missing**, not symptom-free. A selected symptom score of at least 3/10 is the exploratory outcome; comparison days can include milder symptoms and are labelled separately from strictly symptom-free entries.

Descriptive comparisons need at least three exposed and three unexposed days. Regularized multivariable logistic regression additionally requires at least 20 observed days and at least five days in each outcome class. Stress and sleep are covariates. Perfectly co-occurring ingredients are identified as inseparable. The application shows sample counts and exploratory coefficients, not validated accuracy, causal probabilities, or diagnoses. These minimums are engineering guardrails, not clinical validation. The configured time window is not a medically established response window. There is no portion-dose model, controlled experiment, clinical evaluation, or allergy test.

FODMAP references are based on [Monash University's public overview](https://www.monashfodmap.com/about-fodmap-and-ibs/high-and-low-fodmap-foods/), reviewed 2026-09-21. They are general examples without licensed laboratory serving-size data. Spices are explicitly unclassified. A low-FODMAP reference does not imply tolerance or absence of allergens. Persistent symptoms and restrictive diet changes should be discussed with an appropriate clinician/dietitian.

## Code organization

`diary_models.go` validates domain inputs; `diary_store.go` owns persistence; `diary_routes.go` owns JSON handlers; `analysis_client.go` calls Python with a deadline; `food_catalog.go` embeds the shared catalog; `web.go` bridges the Go Inertia adapter into Fiber. Vue pages, reusable forms and styles live in `web/src/`. Python's reusable diary analysis lives in `ml-service/app/diary_analysis.py`, separately from the original ML endpoints.

## Run the stack with Docker Compose

Docker Compose builds the Vue assets and starts Fiber, persistent SurrealDB, and the Python ML service:

```sh
docker-compose up --build
```

Open the app at `http://localhost:3000`. SurrealDB is at `http://localhost:8000`, and Python API docs are at `http://localhost:8001/docs`.
SurrealDB data is stored in the named `surrealdb-data` volume.

Stop the stack with:

```sh
docker-compose down
```

The default local credentials are `root` / `root`. Copy `.env.example` to `.env` to customize the port, namespace, database, and credentials.

## Run

Requires Go 1.27 (required by the pinned Go Inertia adapter), Node 22.12+ or 24+, and the database/ML services. Build frontend assets before starting Go:

```sh
npm --prefix web ci
npm --prefix web run build
go run .
```

For frontend changes, run `npm --prefix web run dev` in another terminal and reload the page. This watches production assets; it is not a Vite HMR server. Set `APP_URL` alongside `PORT` if changing the browser URL, and `ML_SERVICE_URL` if using a different Python endpoint.

The server connects to SurrealDB at `ws://localhost:8000/rpc` by default and listens on `http://localhost:3000`. Start SurrealDB separately before running the API locally. Set `PORT` to use a different port:

```sh
PORT=8080 go run .
```

## Endpoints

- `GET /`, `/diary`, `/recipes`, `/insights`, `/foods` — Inertia/Vue pages
- `GET /api/status` — original boilerplate status response
- `GET /api/diary`, `/api/export` — persisted diary / JSON download
- `POST /api/recipes`, `PUT /api/recipes/:id` — create / edit recipes
- `POST /api/meals`, `/api/checkins` — diary entries
- `DELETE /api/:kind/:id` — delete one recipe, meal, or check-in
- `POST /api/ingredients/analyze` — ingredient suggestions
- `GET /api/patterns?symptom=any&hours=8` — personal associations
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

The BERT endpoint uses `prajjwal1/bert-tiny`, forces inference to CPU, mean-pools its hidden states, and returns cosine similarity. The model is cached while building the Docker image and loaded lazily on the first request.

`requirements-cpu.txt` selects the official CPU-only PyTorch wheel, which keeps the ARM64 image free of unnecessary CUDA/NVIDIA runtime packages. `requirements-dev.txt` includes this CPU profile automatically.

Run the Python tests from the nested service with its development dependencies installed:

```sh
cd ml-service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest
```

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

The browser test exercises recipe extraction and creation, persistent reload, meal logging, explicit symptom-free recording, navigation, search, and mobile layout. It deletes only the test records it creates. Start Compose, then run:

```sh
cd web
npx playwright install chromium
npm test
```

Python tests cover alias specificity, unknown ingredients, meal-before-symptom ordering, missing check-ins, duplicate-day handling, symptom filters, co-occurring allergens and ingredients, and the model's data thresholds.

```sh
go test ./...
```

The default suite is self-contained. To run the SurrealDB transaction/live-query regression test against the local Compose database:

```sh
RUN_INTEGRATION_TESTS=1 go test ./...
```
