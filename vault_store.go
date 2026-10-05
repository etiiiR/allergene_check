package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// EncryptedVault contains only ciphertext plus a revision counter. The server
// never deserializes diary fields from Envelope.
type EncryptedVault struct {
	Revision int64           `json:"revision"`
	Envelope json.RawMessage `json:"envelope"`
}

// VaultRepository is deliberately opaque so HTTP behavior can be tested
// without a running SurrealDB instance.
type VaultRepository interface {
	LoadVault(context.Context) (EncryptedVault, error)
	SaveVault(context.Context, int64, json.RawMessage) (EncryptedVault, error)
}

type surrealVaultRecord struct {
	Revision int64  `json:"revision"`
	Payload  string `json:"payload"`
}

// surrealVaultRepository supports one local app process. The revision check
// and write are serialized in-process; deployments with multiple app replicas
// must replace this with a database-atomic compare-and-swap before enabling
// vault writes there.
type surrealVaultRepository struct {
	store *SurrealStore
	mu    sync.Mutex
}

func newSurrealVaultRepository(store *SurrealStore) VaultRepository {
	return &surrealVaultRepository{store: store}
}

func (r *surrealVaultRepository) LoadVault(ctx context.Context) (EncryptedVault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.loadVault(ctx)
}

func (r *surrealVaultRepository) loadVault(ctx context.Context) (EncryptedVault, error) {
	if r.store == nil {
		return EncryptedVault{}, ErrDatabaseNotConfigured
	}
	row, err := Select[surrealVaultRecord](ctx, r.store, models.NewRecordID("diary_vault", "default"))
	if err != nil {
		return EncryptedVault{}, err
	}
	if row == nil || row.Payload == "" {
		return EncryptedVault{Envelope: json.RawMessage("null")}, nil
	}
	if row.Revision < 1 || !json.Valid([]byte(row.Payload)) {
		return EncryptedVault{}, fmt.Errorf("invalid encrypted vault record")
	}
	return EncryptedVault{
		Revision: row.Revision,
		Envelope: append(json.RawMessage(nil), row.Payload...),
	}, nil
}

func (r *surrealVaultRepository) SaveVault(ctx context.Context, expected int64, envelope json.RawMessage) (EncryptedVault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, err := r.loadVault(ctx)
	if err != nil {
		return EncryptedVault{}, err
	}
	if expected != current.Revision {
		return EncryptedVault{}, NewAppError(409, "vault_revision_conflict", "Der Tresor wurde zwischenzeitlich geändert. Bitte neu laden und erneut versuchen.")
	}
	if r.store == nil {
		return EncryptedVault{}, ErrDatabaseNotConfigured
	}
	next := EncryptedVault{
		Revision: current.Revision + 1,
		Envelope: append(json.RawMessage(nil), envelope...),
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return EncryptedVault{}, invalid("Verschlüsselter Tresor ist ungültig.")
	}
	_, err = Upsert[surrealVaultRecord](ctx, r.store,
		models.NewRecordID("diary_vault", "default"),
		surrealVaultRecord{Revision: next.Revision, Payload: string(payload)},
	)
	if err != nil {
		return EncryptedVault{}, err
	}
	return next, nil
}
