package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// TestSurrealTransactionRollbackAndLiveQuery is opt-in because it requires a running SurrealDB.
// Run it with: RUN_INTEGRATION_TESTS=1 go test ./...
func TestSurrealTransactionRollbackAndLiveQuery(t *testing.T) {
	if os.Getenv("RUN_INTEGRATION_TESTS") != "1" {
		t.Skip("set RUN_INTEGRATION_TESTS=1 to run against SurrealDB")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	db, err := connectDatabase(ctx, loadConfig())
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
