package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"
)

// runServer owns the application lifecycle: configuration, one database connection,
// HTTP server startup, and connection cleanup.
func runServer() error {
	config := loadConfig()
	if len(config.accountSetupToken) < 32 {
		return NewAppError(500, ErrorCodeStartup, "ACCOUNT_SETUP_TOKEN must contain at least 32 characters. Use sh setup-local-env.sh --new for a new database volume, or sh setup-auth-token.sh with an existing .env file.")
	}
	if err := validatePublicAppURL(envOrDefault("APP_URL", "http://localhost:3000")); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := connectDatabase(ctx, config)
	if err != nil {
		return WrapAppError(503, ErrorCodeStartup, "could not start database connection", err)
	}
	store := NewSurrealStore(db)
	defer func() {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer closeCancel()
		if store.close(closeCtx) != nil {
			log.Printf("could not close SurrealDB client cleanly")
		}
	}()
	if err := (&DiaryRepository{store: store}).initialize(ctx); err != nil {
		return WrapAppError(503, ErrorCodeStartup, "could not initialize diary schema", err)
	}

	supervisorCtx, stopSupervisor := context.WithCancel(context.Background())
	supervisorDone := superviseDatabase(supervisorCtx, store, config)
	defer func() {
		stopSupervisor()
		<-supervisorDone
	}()
	app := newAppWithStore(store)

	log.Printf("server listening on http://localhost:%s", config.port)
	if err := app.Listen(config.listenHost + ":" + config.port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return WrapAppError(500, ErrorCodeStartup, "could not start HTTP server", err)
	}
	return nil
}
