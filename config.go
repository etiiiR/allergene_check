package main

import "os"

// appConfig contains all runtime configuration for the HTTP and database layers.
type appConfig struct {
	port      string
	dbURL     string
	namespace string
	database  string
	username  string
	password  string
}

// loadConfig reads configuration from environment variables with development defaults.
func loadConfig() appConfig {
	return appConfig{
		port:      envOrDefault("PORT", "3000"),
		dbURL:     envOrDefault("SURREALDB_URL", "ws://localhost:8000/rpc"),
		namespace: envOrDefault("SURREALDB_NAMESPACE", "main"),
		database:  envOrDefault("SURREALDB_DATABASE", "main"),
		username:  envOrDefault("SURREALDB_USER", "root"),
		password:  envOrDefault("SURREALDB_PASS", "root"),
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
