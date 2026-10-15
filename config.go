package main

import (
	"net"
	"net/url"
	"os"
	"strings"
)

// appConfig contains all runtime configuration for the HTTP and database layers.
type appConfig struct {
	port              string
	listenHost        string
	dbURL             string
	namespace         string
	database          string
	username          string
	password          string
	accountSetupToken string
}

// loadConfig reads runtime settings. Database credentials intentionally have no
// insecure development fallback; a missing credential must fail closed.
func loadConfig() appConfig {
	return appConfig{
		port:              envOrDefault("PORT", "3000"),
		listenHost:        envOrDefault("LISTEN_HOST", "127.0.0.1"),
		dbURL:             envOrDefault("SURREALDB_URL", "ws://localhost:8000/rpc"),
		namespace:         envOrDefault("SURREALDB_NAMESPACE", "main"),
		database:          envOrDefault("SURREALDB_DATABASE", "main"),
		username:          os.Getenv("SURREALDB_USER"),
		password:          os.Getenv("SURREALDB_PASS"),
		accountSetupToken: os.Getenv("ACCOUNT_SETUP_TOKEN"),
	}
}

func (c appConfig) validate() error {
	if strings.TrimSpace(c.username) == "" || strings.TrimSpace(c.password) == "" {
		return NewAppError(500, ErrorCodeStartup, "SURREALDB_USER and SURREALDB_PASS must be configured before starting the app.")
	}
	return nil
}

func validatePublicAppURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return NewAppError(500, ErrorCodeStartup, "APP_URL must be a valid absolute HTTP or HTTPS URL.")
	}
	host := strings.ToLower(parsed.Hostname())
	local := host == "localhost" || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
	if !local && parsed.Scheme != "https" {
		return NewAppError(500, ErrorCodeStartup, "Remote account access requires APP_URL to use HTTPS.")
	}
	return nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
