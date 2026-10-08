package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// TestSurrealTransactionRollbackAndLiveQuery is opt-in because it requires a running SurrealDB.
// Run it against a disposable *_test namespace/database only; see README.md.
func TestSurrealTransactionRollbackAndLiveQuery(t *testing.T) {
	if os.Getenv("RUN_INTEGRATION_TESTS") != "1" {
		t.Skip("set RUN_INTEGRATION_TESTS=1 to run against SurrealDB")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	db, err := connectDatabase(ctx, requireIsolatedIntegrationConfig(t))
	if err != nil {
		t.Fatalf("connect to SurrealDB: %v", err)
	}
	defer db.Close(context.Background())
	store := NewSurrealStore(db)

	if _, err := Query[[]any](ctx, store, "DEFINE TABLE regression_notes SCHEMALESS", nil); err != nil {
		t.Fatalf("define regression table: %v", err)
	}
	defer Query[[]any](context.Background(), store, "REMOVE TABLE regression_notes", nil)

	rollbackID := models.NewRecordID("regression_notes", fmt.Sprintf("rollback-%d", time.Now().UnixNano()))
	rollbackErr := errors.New("force rollback")
	err = store.WithTransaction(ctx, func(tx *surrealdb.Transaction) error {
		_, err := surrealdb.Create[map[string]any](ctx, tx, rollbackID, map[string]any{"kind": "rollback"})
		if err != nil {
			return err
		}
		return rollbackErr
	})
	if !errors.Is(err, rollbackErr) {
		t.Fatalf("expected transaction callback error, got %v", err)
	}

	rows, err := Query[[]map[string]any](ctx, store,
		"SELECT * FROM regression_notes WHERE id = $id",
		map[string]any{"id": rollbackID},
	)
	if err != nil {
		t.Fatalf("query rolled-back record: %v", err)
	}
	if len(*rows) != 1 || len((*rows)[0].Result) != 0 {
		t.Fatalf("rolled-back record still exists: %#v", rows)
	}

	liveID := models.NewRecordID("regression_notes", fmt.Sprintf("live-%d", time.Now().UnixNano()))
	subscription, err := store.WatchTable(ctx, models.Table("regression_notes"), false)
	if err != nil {
		t.Fatalf("start live query: %v", err)
	}
	defer subscription.Close(context.Background())

	if _, err := Create[map[string]any](ctx, store, liveID, map[string]any{"kind": "live"}); err != nil {
		t.Fatalf("create live-query record: %v", err)
	}
	defer Delete[map[string]any](context.Background(), store, liveID)

	select {
	case notification := <-subscription.Notifications:
		if notification.Action != "CREATE" {
			t.Fatalf("expected CREATE notification, got %s", notification.Action)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for live notification")
	}
}

// TestSurrealVaultConcurrentRevisionCAS verifies that independent authenticated
// database clients cannot both replace the same vault revision. It is opt-in
// because it needs a running SurrealDB and a test-only namespace/database.
func TestSurrealVaultConcurrentRevisionCAS(t *testing.T) {
	if os.Getenv("RUN_INTEGRATION_TESTS") != "1" {
		t.Skip("set RUN_INTEGRATION_TESTS=1 to run against SurrealDB")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	db, err := connectDatabase(ctx, requireIsolatedIntegrationConfig(t))
	if err != nil {
		t.Fatalf("connect to SurrealDB: %v", err)
	}
	defer db.Close(context.Background())
	store := NewSurrealStore(db)
	if _, err := Query[any](ctx, store, `
		DEFINE TABLE IF NOT EXISTS diary_vault SCHEMALESS;
		DEFINE FIELD IF NOT EXISTS revision ON diary_vault TYPE int;
		DEFINE FIELD IF NOT EXISTS payload ON diary_vault TYPE string;
	`, nil); err != nil {
		t.Fatalf("define isolated vault table: %v", err)
	}
	db2, err := connectDatabase(ctx, requireIsolatedIntegrationConfig(t))
	if err != nil {
		t.Fatalf("connect second SurrealDB client: %v", err)
	}
	defer db2.Close(context.Background())
	key := "cas-" + uuid.NewString()
	first := &surrealVaultRepository{store: store, key: key}
	second := &surrealVaultRepository{store: NewSurrealStore(db2), key: key}
	defer Delete[any](context.Background(), store, first.recordID())

	start := make(chan struct{})
	type saveResult struct{ err error }
	results := make(chan saveResult, 2)
	for index, writer := range []string{"alpha", "bravo"} {
		writer := writer
		repository := first
		if index == 1 {
			repository = second
		}
		go func() {
			<-start
			_, err := repository.SaveVault(ctx, 0, json.RawMessage(`{"writer":"`+writer+`"}`), false)
			results <- saveResult{err: err}
		}()
	}
	close(start)

	wins, conflicts := 0, 0
	for range 2 {
		result := <-results
		if result.err == nil {
			wins++
			continue
		}
		var appErr *AppError
		if errors.As(result.err, &appErr) && appErr.Status == 409 {
			conflicts++
			continue
		}
		t.Fatalf("unexpected concurrent save error: %v", result.err)
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("expected exactly one writer and one conflict, got wins=%d conflicts=%d", wins, conflicts)
	}
	current, err := first.LoadVault(ctx)
	if err != nil {
		t.Fatalf("load winning vault: %v", err)
	}
	if current.Revision != 1 || !json.Valid(current.Envelope) {
		t.Fatalf("unexpected committed vault: %#v", current)
	}
}

// requireIsolatedIntegrationConfig prevents opt-in tests from modifying a
// normal development or production database. The integration suite can remove
// a test table and the migration suite may clear legacy tables, so both names
// must make the disposable nature of the target explicit.
func requireIsolatedIntegrationConfig(t *testing.T) appConfig {
	t.Helper()
	config := loadConfig()
	if !integrationDatabaseName(config.namespace) || !integrationDatabaseName(config.database) {
		t.Fatalf("refusing integration tests against namespace %q/database %q; use a disposable namespace and database ending in _test or _tests", config.namespace, config.database)
	}
	return config
}

func integrationDatabaseName(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasSuffix(value, "_test") || strings.HasSuffix(value, "_tests") ||
		strings.HasSuffix(value, "-test") || strings.HasSuffix(value, "-tests")
}

func TestIntegrationDatabaseGuard(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  bool
	}{
		{name: "single test suffix", value: "gutfeeling_test", want: true},
		{name: "plural test suffix", value: "gutfeeling_tests", want: true},
		{name: "hyphen test suffix", value: "gutfeeling-test", want: true},
		{name: "default database", value: "main", want: false},
		{name: "production database", value: "production", want: false},
		{name: "test in middle is insufficient", value: "test_gutfeeling", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := integrationDatabaseName(test.value); got != test.want {
				t.Fatalf("integrationDatabaseName(%q) = %t; want %t", test.value, got, test.want)
			}
		})
	}
}
