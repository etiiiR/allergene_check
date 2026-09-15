package main

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func newTestApp() *fiber.App {
	return newApp(nil)
}

func TestHealthEndpoint(t *testing.T) {
	app := newTestApp()

	response, err := app.Test(httptest.NewRequest("GET", "/health", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("expected status %d, got %d", fiber.StatusOK, response.StatusCode)
	}
}

func TestValidTableName(t *testing.T) {
	valid := []string{"notes", "user_profiles", "table2"}
	for _, value := range valid {
		if !validTableName(value) {
			t.Errorf("expected %q to be a valid table name", value)
		}
	}

	invalid := []string{"", "notes-items", "notes items", "notes; DELETE users"}
	for _, value := range invalid {
		if validTableName(value) {
			t.Errorf("expected %q to be rejected as a table name", value)
		}
	}
}

func TestSurrealStoreWithoutDatabase(t *testing.T) {
	_, err := NewSurrealStore(nil).Version(t.Context())
	if !errors.Is(err, ErrDatabaseNotConfigured) {
		t.Fatalf("expected ErrDatabaseNotConfigured, got %v", err)
	}
}
