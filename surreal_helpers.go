package main

import (
	"context"
	"errors"
	"sync"

	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/connection"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

var ErrDatabaseNotConfigured = errors.New("SurrealDB is not configured")

// SurrealStore provides helpers around the official SurrealDB Go SDK.
// Generic CRUD helpers below are package functions because Go does not allow
// type parameters on methods. Use Query when you need arbitrary SurrealQL.
type SurrealStore struct {
	db *surrealdb.DB
}

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

func Select[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Select[T](ctx, db, target)
}

func Create[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Create[T](ctx, db, target, data)
}

func Insert[T any](ctx context.Context, s *SurrealStore, table models.Table, data any) (*[]T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Insert[T](ctx, db, table, data)
}

func Update[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Update[T](ctx, db, target, data)
}

func Upsert[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Upsert[T](ctx, db, target, data)
}

func Merge[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, data any) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Merge[T](ctx, db, target, data)
}

func Patch[TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat, patches []surrealdb.PatchData) (*[]surrealdb.PatchData, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Patch(ctx, db, target, patches)
}

func Delete[T any, TWhat surrealdb.TableOrRecord](ctx context.Context, s *SurrealStore, target TWhat) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Delete[T](ctx, db, target)
}

func InsertRelation[T any](ctx context.Context, s *SurrealStore, relationship *surrealdb.Relationship) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.InsertRelation[T](ctx, db, relationship)
}

func Relate[T any](ctx context.Context, s *SurrealStore, relationship *surrealdb.Relationship) (*T, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return surrealdb.Relate[T](ctx, db, relationship)
}

// RunInTransaction runs interactive WebSocket transaction operations atomically.
func (s *SurrealStore) RunInTransaction(ctx context.Context, fn func(*surrealdb.Transaction) error) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	if fn == nil {
		return errors.New("transaction callback is required")
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Cancel(ctx)
		return err
	}
	return tx.Commit(ctx)
}

func (s *SurrealStore) Version(ctx context.Context) (*surrealdb.VersionData, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return db.Version(ctx)
}

func (s *SurrealStore) Info(ctx context.Context) (map[string]any, error) {
	db, err := s.client()
	if err != nil {
		return nil, err
	}
	return db.Info(ctx)
}

func (s *SurrealStore) Let(ctx context.Context, key string, value any) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Let(ctx, key, value)
}

func (s *SurrealStore) Unset(ctx context.Context, key string) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Unset(ctx, key)
}

func (s *SurrealStore) Authenticate(ctx context.Context, token string) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Authenticate(ctx, token)
}

func (s *SurrealStore) Invalidate(ctx context.Context) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return db.Invalidate(ctx)
}

// LiveSubscription represents a server-side LIVE query and its notification stream.
type LiveSubscription struct {
	ID            string
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

func (s *SurrealStore) KillLive(ctx context.Context, id string) error {
	db, err := s.client()
	if err != nil {
		return err
	}
	return surrealdb.Kill(ctx, db, id)
}
