package main

import (
	"encoding/json"
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

	var body map[string]string
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["status"] != "ok" || body["database"] != "not_configured" {
		t.Fatalf("unexpected health response: %#v", body)
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

func TestDiaryTablesCannotBeWatchedOverWebSocket(t *testing.T) {
	for _, value := range []string{"diary_recipes", "diary_meals", "diary_profile", "diary_vault"} {
		if watchableTableName(value) {
			t.Errorf("private diary table %q must not be exposed to live queries", value)
		}
	}
	if !watchableTableName("notes") {
		t.Fatal("non-diary boilerplate tables should keep the live-query helper")
	}
}

func TestSurrealStoreWithoutDatabase(t *testing.T) {
	_, err := NewSurrealStore(nil).Version(t.Context())
	if !errors.Is(err, ErrDatabaseNotConfigured) {
		t.Fatalf("expected ErrDatabaseNotConfigured, got %v", err)
	}
}

func TestTransactionLifecycleRejectsNilTransactions(t *testing.T) {
	store := NewSurrealStore(nil)

	if err := store.Commit(t.Context(), nil); !errors.Is(err, ErrTransactionNil) {
		t.Fatalf("commit should reject nil transaction, got %v", err)
	}
	if err := store.Rollback(t.Context(), nil); !errors.Is(err, ErrTransactionNil) {
		t.Fatalf("rollback should reject nil transaction, got %v", err)
	}
	if err := store.WithTransaction(t.Context(), nil); !errors.Is(err, ErrTransactionCallbackNil) {
		t.Fatalf("transaction helper should reject nil callback, got %v", err)
	}
}
