package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// runServer owns the application lifecycle: configuration, one database connection,
// HTTP server startup, and connection cleanup.
func runServer() error {
	config := loadConfig()
	if len(config.accountSetupToken) < 32 {
		return NewAppError(500, ErrorCodeStartup, "ACCOUNT_SETUP_TOKEN must contain at least 32 characters. Create it with sh setup-local-env.sh --auth.")
	}
	publicURL, parseErr := url.Parse(envOrDefault("APP_URL", "http://localhost:3000"))
	if parseErr != nil || publicURL.Hostname() == "" {
		return NewAppError(500, ErrorCodeStartup, "APP_URL must be a valid absolute URL.")
	}
	host := strings.ToLower(publicURL.Hostname())
	local := host == "localhost" || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
	if !local && publicURL.Scheme != "https" {
		return NewAppError(500, ErrorCodeStartup, "Remote account access requires APP_URL to use HTTPS.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := connectDatabase(ctx, config)
	if err != nil {
		return WrapAppError(503, ErrorCodeStartup, "could not start database connection", err)
	}
	defer db.Close(context.Background())
	if err := (&DiaryRepository{store: NewSurrealStore(db)}).initialize(ctx); err != nil {
		return WrapAppError(503, ErrorCodeStartup, "could not initialize diary schema", err)
	}

	app := newApp(db)

	log.Printf("server listening on http://localhost:%s", config.port)
	if err := app.Listen(config.listenHost + ":" + config.port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return WrapAppError(500, ErrorCodeStartup, "could not start HTTP server", err)
	}
	return nil
}
