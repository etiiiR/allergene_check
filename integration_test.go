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

// TestSurrealVaultMigrationCommitsCiphertextAndRemovesLegacyRows verifies the
// complete first-save migration on a disposable database. The migration is
// intentionally destructive to the old diary tables, so the database-name
// guard below is mandatory and this test is opt-in.
func TestSurrealVaultMigrationCommitsCiphertextAndRemovesLegacyRows(t *testing.T) {
	if os.Getenv("RUN_INTEGRATION_TESTS") != "1" {
		t.Skip("set RUN_INTEGRATION_TESTS=1 to run against SurrealDB")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	db, err := connectDatabase(ctx, requireIsolatedIntegrationConfig(t))
	if err != nil {
		t.Fatalf("connect to SurrealDB: %v", err)
	}
	defer db.Close(context.Background())
	store := NewSurrealStore(db)
	diary := &DiaryRepository{store: store}
	if err := diary.initialize(ctx); err != nil {
		t.Fatalf("initialize isolated diary schema: %v", err)
	}

	sentinel := "legacy-migration-" + uuid.NewString()
	legacyKinds := []string{"recipes", "meals", "checkins", "recipe_flags", "stools", "stress"}
	for _, kind := range legacyKinds {
		if err := diary.save(ctx, kind, sentinel, map[string]string{"migration_test": sentinel}); err != nil {
			t.Fatalf("seed legacy %s row: %v", kind, err)
		}
	}
	profile := defaultProfile()
	profile.DisplayName = sentinel
	if err := diary.saveProfile(ctx, profile); err != nil {
		t.Fatalf("seed legacy profile: %v", err)
	}

	vaultRepo := &surrealVaultRepository{store: store, key: "migration-" + uuid.NewString()}
	defer Delete[any](context.Background(), store, vaultRepo.recordID())
	legacyAvailable, err := vaultRepo.LegacyDataAvailable(ctx)
	if err != nil || !legacyAvailable {
		t.Fatalf("expected seeded legacy diary to be detected, available=%t err=%v", legacyAvailable, err)
	}

	envelope := json.RawMessage(`{"version":1,"payload":{"ciphertext":"opaque-test-ciphertext"}}`)
	if _, err := vaultRepo.SaveVault(ctx, 99, envelope, true); err == nil {
		t.Fatal("expected stale revision to reject migration")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != 409 {
			t.Fatalf("expected a revision conflict before migration, got %v", err)
		}
	}
	for _, kind := range legacyKinds {
		row, err := Select[diaryRecord](ctx, store, models.NewRecordID("diary_"+kind, sentinel))
		if err != nil {
			t.Fatalf("check legacy %s row after rejected migration: %v", kind, err)
		}
		if row == nil {
			t.Fatalf("stale vault revision deleted legacy %s data", kind)
		}
	}
	saved, err := vaultRepo.SaveVault(ctx, 0, envelope, true)
	if err != nil {
		t.Fatalf("save encrypted vault and migrate legacy rows: %v", err)
	}
	if saved.Revision != 1 || string(saved.Envelope) != string(envelope) {
		t.Fatalf("unexpected saved vault: %#v", saved)
	}
	loaded, err := vaultRepo.LoadVault(ctx)
	if err != nil || loaded.Revision != 1 || string(loaded.Envelope) != string(envelope) {
		t.Fatalf("could not read committed encrypted vault: %#v err=%v", loaded, err)
	}

	for _, kind := range legacyKinds {
		row, err := Select[diaryRecord](ctx, store, models.NewRecordID("diary_"+kind, sentinel))
		if err != nil {
			t.Fatalf("check migrated %s row: %v", kind, err)
		}
		if row != nil {
			t.Errorf("legacy %s row remains after vault migration", kind)
		}
	}
	profileRow, err := Select[diaryRecord](ctx, store, models.NewRecordID("diary_profile", "default"))
	if err != nil {
		t.Fatalf("check migrated profile: %v", err)
	}
	if profileRow != nil {
		t.Error("legacy profile remains after vault migration")
	}
	legacyAvailable, err = vaultRepo.LegacyDataAvailable(ctx)
	if err != nil || legacyAvailable {
		t.Fatalf("expected no primary legacy rows after commit, available=%t err=%v", legacyAvailable, err)
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
