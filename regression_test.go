package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestRootEndpointContract(t *testing.T) {
	response, err := newTestApp().Test(httptest.NewRequest("GET", "/api/status", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("expected status %d, got %d", fiber.StatusOK, response.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	want := map[string]string{
		"message":  "Fiber API is running",
		"database": "SurrealDB",
	}
	for key, expected := range want {
		if body[key] != expected {
			t.Errorf("expected %s=%q, got %q", key, expected, body[key])
		}
	}
}

func TestWebSocketRouteRequiresUpgrade(t *testing.T) {
	response, err := newTestApp().Test(httptest.NewRequest("GET", "/ws/live/notes", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if response.StatusCode != fiber.StatusUpgradeRequired {
		t.Fatalf("expected status %d, got %d", fiber.StatusUpgradeRequired, response.StatusCode)
	}
}

func TestAppErrorHandlerContract(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Get("/failure", func(*fiber.Ctx) error {
		return WrapAppError(fiber.StatusServiceUnavailable, ErrorCodeDatabaseUnavailable, "SurrealDB is unavailable", errors.New("private driver details"))
	})

	response, err := app.Test(httptest.NewRequest("GET", "/failure", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if response.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", fiber.StatusServiceUnavailable, response.StatusCode)
	}

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if strings.Contains(string(payload), "private driver details") {
		t.Fatalf("response leaked internal error: %s", payload)
	}

	var body ErrorResponse
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if body.Error.Code != ErrorCodeDatabaseUnavailable || body.Error.Message != "SurrealDB is unavailable" {
		t.Fatalf("unexpected error response: %#v", body)
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	for _, key := range []string{
		"PORT",
		"LISTEN_HOST",
		"SURREALDB_URL",
		"SURREALDB_NAMESPACE",
		"SURREALDB_DATABASE",
		"SURREALDB_USER",
		"SURREALDB_PASS",
		"ACCOUNT_SETUP_TOKEN",
	} {
		t.Setenv(key, "")
	}

	config := loadConfig()
	if config.port != "3000" || config.listenHost != "127.0.0.1" ||
		config.dbURL != "ws://localhost:8000/rpc" ||
		config.namespace != "main" || config.database != "main" ||
		config.username != "" || config.password != "" || config.accountSetupToken != "" {
		t.Fatalf("unexpected default config: %#v", config)
	}
	if err := config.validate(); err == nil {
		t.Fatal("configuration without database credentials should fail closed")
	}
}

func TestLoadConfigFromEnvironment(t *testing.T) {
	t.Setenv("PORT", "8080")
	t.Setenv("LISTEN_HOST", "0.0.0.0")
	t.Setenv("SURREALDB_URL", "wss://db.example.com/rpc")
	t.Setenv("SURREALDB_NAMESPACE", "production")
	t.Setenv("SURREALDB_DATABASE", "allergens")
	t.Setenv("SURREALDB_USER", "app")
	t.Setenv("SURREALDB_PASS", "secret")

	config := loadConfig()
	if config.port != "8080" || config.listenHost != "0.0.0.0" ||
		config.dbURL != "wss://db.example.com/rpc" ||
		config.namespace != "production" || config.database != "allergens" ||
		config.username != "app" || config.password != "secret" {
		t.Fatalf("unexpected environment config: %#v", config)
	}
	if err := config.validate(); err != nil {
		t.Fatalf("complete configuration should validate: %v", err)
	}
}

func TestConfigRejectsWhitespaceDatabaseCredentials(t *testing.T) {
	t.Setenv("SURREALDB_USER", "   ")
	t.Setenv("SURREALDB_PASS", "\t")
	if err := loadConfig().validate(); err == nil {
		t.Fatal("whitespace-only credentials should fail closed")
	}
}

func TestRemoteAccountOriginsRequireHTTPS(t *testing.T) {
	for _, test := range []struct {
		name string
		url  string
		want bool
	}{
		{name: "local development over HTTP", url: "http://localhost:3000", want: true},
		{name: "loopback IP over HTTP", url: "http://127.0.0.1:3000", want: true},
		{name: "remote HTTPS", url: "https://gut.example", want: true},
		{name: "remote HTTP", url: "http://gut.example", want: false},
		{name: "missing scheme", url: "gut.example", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validatePublicAppURL(test.url)
			if (err == nil) != test.want {
				t.Fatalf("validatePublicAppURL(%q) error=%v; want success=%v", test.url, err, test.want)
			}
		})
	}
}

func TestConnectDatabaseRejectsMissingCredentialsBeforeConnecting(t *testing.T) {
	_, err := connectDatabase(context.Background(), appConfig{dbURL: "not-a-valid-url"})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Code != ErrorCodeStartup {
		t.Fatalf("missing credentials should fail before database connection, got %v", err)
	}
}
