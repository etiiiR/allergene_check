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

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := connectDatabase(ctx, config)
	if err != nil {
		return WrapAppError(503, ErrorCodeStartup, "could not start database connection", err)
	}
	defer db.Close(context.Background())

	app := newApp(db)

	log.Printf("server listening on http://localhost:%s", config.port)
	if err := app.Listen(":" + config.port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return WrapAppError(500, ErrorCodeStartup, "could not start HTTP server", err)
	}
	return nil
}
