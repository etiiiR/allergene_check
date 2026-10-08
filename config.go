package main

import (
	"os"
	"strings"
)

// appConfig contains all runtime configuration for the HTTP and database layers.
type appConfig struct {
	port      string
	dbURL     string
	namespace string
	database  string
	username  string
	password  string
}

// loadConfig reads runtime settings. Database credentials intentionally have no
// insecure development fallback; a missing credential must fail closed.
func loadConfig() appConfig {
	return appConfig{
		port:      envOrDefault("PORT", "3000"),
		dbURL:     envOrDefault("SURREALDB_URL", "ws://localhost:8000/rpc"),
		namespace: envOrDefault("SURREALDB_NAMESPACE", "main"),
		database:  envOrDefault("SURREALDB_DATABASE", "main"),
		username:  os.Getenv("SURREALDB_USER"),
		password:  os.Getenv("SURREALDB_PASS"),
	}
}

func (c appConfig) validate() error {
	if strings.TrimSpace(c.username) == "" || strings.TrimSpace(c.password) == "" {
		return NewAppError(500, ErrorCodeStartup, "SURREALDB_USER and SURREALDB_PASS must be configured before starting the app.")
	}
	return nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
