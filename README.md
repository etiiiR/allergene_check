# Fiber API

Minimal Go API boilerplate using [Fiber](https://gofiber.io/) with [SurrealDB](https://surrealdb.com/) for persistence.

## Run the stack with Docker Compose

Docker Compose starts the Fiber API and a persistent SurrealDB instance:

```sh
docker-compose up --build
```

The API is available at `http://localhost:3000` and SurrealDB at `http://localhost:8000`.
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
