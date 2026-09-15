# Fiber API

Minimal Go API boilerplate using [Fiber](https://gofiber.io/) with [SurrealDB](https://surrealdb.com/) for persistence.

## Run the stack with Docker Compose

Docker Compose starts the Fiber API and a persistent SurrealDB instance:

```sh
docker-compose up --build
```

The API is available at `http://localhost:3000`, SurrealDB at `http://localhost:8000`, and the Python ML service at `http://localhost:8001`.
SurrealDB data is stored in the named `surrealdb-data` volume.

Stop the stack with:

```sh
docker-compose down
```

The default local credentials are `root` / `root`. Copy `.env.example` to `.env` to customize the port, namespace, database, and credentials.

## Run

```sh
go run .
```

The server connects to SurrealDB at `ws://localhost:8000/rpc` by default and listens on `http://localhost:3000`. Start SurrealDB separately before running the API locally. Set `PORT` to use a different port:

```sh
PORT=8080 go run .
```

## Endpoints

- `GET /` — returns a welcome message and stack information
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

Run the Python tests from the nested service with its development dependencies installed:

```sh
cd ml-service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

The standard Python tests skip model loading. To include the BERT regression test:

```sh
RUN_BERT_TESTS=1 pytest
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

```sh
go test ./...
```

The default suite is self-contained. To run the SurrealDB transaction/live-query regression test against the local Compose database:

```sh
RUN_INTEGRATION_TESTS=1 go test ./...
```
