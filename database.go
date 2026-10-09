package main

import (
	"context"

	surrealdb "github.com/surrealdb/surrealdb.go"
)

// connectDatabase authenticates the shared client before selecting its namespace
// and database. Root authentication is needed for first-run USE to create a
// configured namespace/database that does not exist yet.
func connectDatabase(ctx context.Context, config appConfig) (*surrealdb.DB, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	db, err := surrealdb.FromEndpointURLString(ctx, config.dbURL)
	if err != nil {
		return nil, WrapAppError(503, ErrorCodeDatabaseUnavailable, "could not connect to SurrealDB", err)
	}

	if _, err := db.SignIn(ctx, surrealdb.Auth{
		Username: config.username,
		Password: config.password,
	}); err != nil {
		_ = db.Close(context.Background())
		return nil, WrapAppError(503, ErrorCodeDatabaseUnavailable, "could not authenticate with SurrealDB", err)
	}

	if err := db.Use(ctx, config.namespace, config.database); err != nil {
		_ = db.Close(context.Background())
		return nil, WrapAppError(503, ErrorCodeDatabaseUnavailable, "could not select SurrealDB namespace", err)
	}

	return db, nil
}
