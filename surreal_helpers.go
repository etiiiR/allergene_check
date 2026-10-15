package main

import (
	"context"
	"errors"
	"sync"

	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/connection"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// SurrealStore provides helpers around the official SurrealDB Go SDK.
// Generic CRUD helpers below are package functions because Go does not allow
// type parameters on methods. Use Query when you need arbitrary SurrealQL.
type SurrealStore struct {
	db *surrealdb.DB
}

// NewSurrealStore wraps an authenticated SurrealDB client for reuse across handlers and services.
func NewSurrealStore(db *surrealdb.DB) *SurrealStore {
	return &SurrealStore{db: db}
}

func (s *SurrealStore) client() (*surrealdb.DB, error) {
	if s == nil || s.db == nil {
		return nil, ErrDatabaseNotConfigured
	}
	return s.db, nil
}

// Query executes parameterized SurrealQL and returns one result per statement.
func Query[T any](ctx context.Context, s *SurrealStore, sql string, vars map[string]any) (*[]surrealdb.QueryResult[T], error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Query[T](ctx, db, sql, vars)
}

// QueryRaw executes low-level query statements when Query's string form is not enough.
func (s *SurrealStore) QueryRaw(ctx context.Context, queries *[]surrealdb.QueryStmt) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return surrealdb.QueryRaw(ctx, db, queries)
}

// Select reads a table or a single record into the requested Go type.
func Select[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Select[T](ctx, db, target)
}

// Create creates a record with generated or explicit identity and decodes its result.
func Create[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Create[T](ctx, db, target, data)
}

// Insert inserts one or more values into a table and returns the created records.
func Insert[T any](ctx context.Context, s *SurrealStore, table models.Table, data any) (*[]T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Insert[T](ctx, db, table, data)
}

// Update replaces the content of a record or all records targeted by a table.
func Update[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Update[T](ctx, db, target, data)
}

// Upsert creates a record when absent or replaces it when it already exists.
func Upsert[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Upsert[T](ctx, db, target, data)
}

// Merge updates only the supplied fields and preserves other record fields.
func Merge[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Merge[T](ctx, db, target, data)
}

// Patch applies JSON Patch operations to a record or table target.
func Patch[TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, patches []surrealdb.PatchData) (*[]surrealdb.PatchData, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Patch(ctx, db, target, patches)
}

// Delete deletes a record or all records targeted by a table.
func Delete[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Delete[T](ctx, db, target)
}

// InsertRelation inserts a relation record with an explicit relation ID.
func InsertRelation[T any](ctx context.Context, s *SurrealStore, relationship *surrealdb.Relationship) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.InsertRelation[T](ctx, db, relationship)
}

// Relate creates a relation with an auto-generated relation ID.
func Relate[T any](ctx context.Context, s *SurrealStore, relationship *surrealdb.Relationship) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Relate[T](ctx, db, relationship)
}

// Begin starts an interactive transaction on the authenticated WebSocket session.
func (s *SurrealStore) Begin(ctx context.Context) (*surrealdb.Transaction, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return db.Begin(ctx)
}

// Commit commits an explicitly started transaction.
func (s *SurrealStore) Commit(ctx context.Context, tx *surrealdb.Transaction) error {
	if tx == nil {
		return ErrTransactionNil
	}
	return tx.Commit(ctx)
}

// Rollback cancels an explicitly started transaction.
func (s *SurrealStore) Rollback(ctx context.Context, tx *surrealdb.Transaction) error {
	if tx == nil {
		return ErrTransactionNil
	}
	return tx.Cancel(ctx)
}

// WithTransaction starts, commits, and rolls back an interactive transaction.
// Any callback error triggers a rollback; panics are rolled back and re-raised.
func (s *SurrealStore) WithTransaction(ctx context.Context, fn func(*surrealdb.Transaction) error) (err error) {
	if fn == nil {
		return ErrTransactionCallbackNil
	}

	tx, err := s.Begin(ctx)
	if err != nil {
		return err
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			_ = s.Rollback(ctx, tx)
			panic(recovered)
		}
	}()

	if err := fn(tx); err != nil {
		if rollbackErr := s.Rollback(ctx, tx); rollbackErr != nil {
			return errors.Join(err, rollbackErr)
		}
		return err
	}

	return s.Commit(ctx, tx)
}

// RunInTransaction is kept as a descriptive alias for WithTransaction.
func (s *SurrealStore) RunInTransaction(ctx context.Context, fn func(*surrealdb.Transaction) error) error {
	return s.WithTransaction(ctx, fn)
}

// Version returns the connected SurrealDB server version.
func (s *SurrealStore) Version(ctx context.Context) (*surrealdb.VersionData, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return db.Version(ctx)
}

// Info returns information about the current authenticated database session.
func (s *SurrealStore) Info(ctx context.Context) (map[string]any, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return db.Info(ctx)
}

// Let stores a session variable for subsequent SurrealQL statements.
func (s *SurrealStore) Let(ctx context.Context, key string, value any) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Let(ctx, key, value)
}

// Unset removes a session variable.
func (s *SurrealStore) Unset(ctx context.Context, key string) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Unset(ctx, key)
}

// Authenticate applies an existing SurrealDB token to the client session.
func (s *SurrealStore) Authenticate(ctx context.Context, token string) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Authenticate(ctx, token)
}

// Invalidate clears the current authentication from the client session.
func (s *SurrealStore) Invalidate(ctx context.Context) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Invalidate(ctx)
}

// LiveSubscription represents a server-side LIVE query and its notification stream.
type LiveSubscription struct {
	// ID is the server-side live query identifier used for killing the query.
	ID string
	// Notifications receives create, update, and delete events from SurrealDB.
	Notifications <-chan connection.Notification
	db            *surrealdb.DB
	once          sync.Once
	closeErr      error
}

// WatchTable subscribes to CREATE, UPDATE, and DELETE changes for a table.
// Live queries require the store to be connected over ws:// or wss://.
func (s *SurrealStore) WatchTable(ctx context.Context, table models.Table, diff bool) (*LiveSubscription, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}

	id, err := surrealdb.Live(ctx, db, table, diff)
	if err != nil {
		return nil, err
	}

	notifications, err := db.LiveNotifications(id.String())
	if err != nil {
		_ = surrealdb.Kill(context.Background(), db, id.String())
		return nil, err
	}

	return &LiveSubscription{
		ID:            id.String(),
		Notifications: notifications,
		db:            db,
	}, nil
}

// Close kills the server-side LIVE query and closes its notification stream.
func (s *LiveSubscription) Close(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.once.Do(func() {
		s.closeErr = surrealdb.Kill(ctx, s.db, s.ID)
	})
	return s.closeErr
}

// KillLive stops a live query by its server-side identifier.
func (s *SurrealStore) KillLive(ctx context.Context, id string) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return surrealdb.Kill(ctx, db, id)
}
