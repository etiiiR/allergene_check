package main

import (
	"context"

	surrealdb "github.com/surrealdb/surrealdb.go"
)

// connectDatabase creates and authenticates the single shared SurrealDB client.
// The returned client is reused by the store, HTTP handlers, transactions, and live queries.
func connectDatabase(ctx context.Context, config appConfig) (*surrealdb.DB, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	db, err := surrealdb.FromEndpointURLString(ctx, config.dbURL)
	if err != nil {
		return nil, WrapAppError(503, ErrorCodeDatabaseUnavailable, "could not connect to SurrealDB", err)
	}

	if err := db.Use(ctx, config.namespace, config.database); err != nil {
		_ = db.Close(context.Background())
		return nil, WrapAppError(503, ErrorCodeDatabaseUnavailable, "could not select SurrealDB namespace", err)
	}

	if _, err := db.SignIn(ctx, surrealdb.Auth{
		Username: config.username,
		Password: config.password,
	}); err != nil {
		_ = db.Close(context.Background())
		return nil, WrapAppError(503, ErrorCodeDatabaseUnavailable, "could not authenticate with SurrealDB", err)
	}

	return db, nil
}
