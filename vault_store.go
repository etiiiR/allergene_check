package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// EncryptedVault contains only ciphertext plus a revision counter. The server
// never deserializes diary fields from Envelope.
type EncryptedVault struct {
	Revision        int64           `json:"revision"`
	Envelope        json.RawMessage `json:"envelope"`
	LegacyAvailable bool            `json:"legacy_available,omitempty"`
}

// VaultRepository is deliberately opaque so HTTP behavior can be tested
// without a running SurrealDB instance.
type VaultRepository interface {
	LoadVault(context.Context) (EncryptedVault, error)
	LegacyDataAvailable(context.Context) (bool, error)
	SaveVault(context.Context, int64, json.RawMessage, bool) (EncryptedVault, error)
}

type surrealVaultRecord struct {
	Revision int64  `json:"revision"`
	Payload  string `json:"payload"`
}

// surrealVaultRepository uses a database transaction for revision checks so
// concurrent tabs and app replicas cannot silently overwrite a newer vault.
type surrealVaultRepository struct {
	store *SurrealStore
	key   string
}

func newSurrealVaultRepository(store *SurrealStore) VaultRepository {
	return &surrealVaultRepository{store: store, key: "default"}
}

func (r *surrealVaultRepository) LoadVault(ctx context.Context) (EncryptedVault, error) {
	return r.loadVault(ctx)
}

func (r *surrealVaultRepository) LegacyDataAvailable(ctx context.Context) (bool, error) {
	if r.store == nil {
		return false, ErrDatabaseNotConfigured
	}
	for _, table := range []string{"diary_recipes", "diary_meals", "diary_checkins", "diary_recipe_flags", "diary_stools", "diary_stress"} {
		rows, err := Select[[]any](ctx, r.store, models.Table(table))
		if err != nil {
			return false, err
		}
		if rows != nil && len(*rows) > 0 {
			return true, nil
		}
	}
	profile, err := Select[map[string]any](ctx, r.store, models.NewRecordID("diary_profile", "default"))
	return profile != nil, err
}

func (r *surrealVaultRepository) loadVault(ctx context.Context) (EncryptedVault, error) {
	if r.store == nil {
		return EncryptedVault{}, ErrDatabaseNotConfigured
	}
	row, err := Select[surrealVaultRecord](ctx, r.store, r.recordID())
	if err != nil {
		return EncryptedVault{}, err
	}
	if row == nil {
		return EncryptedVault{Envelope: json.RawMessage("null")}, nil
	}
	if row.Revision == 0 && row.Payload == "" {
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

func (r *surrealVaultRepository) SaveVault(ctx context.Context, expected int64, envelope json.RawMessage, migrateLegacy bool) (EncryptedVault, error) {
	if r.store == nil {
		return EncryptedVault{}, ErrDatabaseNotConfigured
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return EncryptedVault{}, invalid("Verschlüsselter Tresor ist ungültig.")
	}
	var next EncryptedVault
	err = r.store.WithTransaction(ctx, func(tx *surrealdb.Transaction) error {
		id := r.recordID()
		current, err := surrealdb.Select[surrealVaultRecord](ctx, tx, id)
		if err != nil {
			return err
		}
		currentRevision := int64(0)
		if current != nil {
			if current.Revision == 0 && current.Payload == "" {
				currentRevision = 0
			} else if current.Revision < 1 || !json.Valid([]byte(current.Payload)) {
				return fmt.Errorf("invalid encrypted vault record")
			} else {
				currentRevision = current.Revision
			}
		}
		if expected != currentRevision {
			return vaultRevisionConflict()
		}
		if migrateLegacy {
			if currentRevision != 0 {
				return NewAppError(409, "vault_migration_unavailable", "Die vorhandenen Tagebuchdaten können nur beim erstmaligen Einrichten übernommen werden.")
			}
			for _, table := range []string{"diary_recipes", "diary_meals", "diary_checkins", "diary_recipe_flags", "diary_stools", "diary_stress"} {
				if _, err := surrealdb.Delete[any](ctx, tx, models.Table(table)); err != nil {
					return err
				}
			}
			if _, err := surrealdb.Delete[any](ctx, tx, models.NewRecordID("diary_profile", "default")); err != nil {
				return err
			}
		}
		next = EncryptedVault{
			Revision: currentRevision + 1,
			Envelope: append(json.RawMessage(nil), envelope...),
		}
		record := surrealVaultRecord{Revision: next.Revision, Payload: string(payload)}
		if current == nil {
			_, err = surrealdb.Create[surrealVaultRecord](ctx, tx, id, record)
		} else {
			_, err = surrealdb.Update[surrealVaultRecord](ctx, tx, id, record)
		}
		return err
	})
	if err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) && appErr.Code == "vault_revision_conflict" {
			return EncryptedVault{}, err
		}
		// Concurrent transactions may both observe the same revision. If the
		// other writer committed first, normalize the database conflict to the
		// same user-actionable stale-write response as an explicit mismatch.
		current, loadErr := r.loadVault(ctx)
		if loadErr == nil && current.Revision != expected {
			return EncryptedVault{}, vaultRevisionConflict()
		}
		return EncryptedVault{}, err
	}
	return next, nil
}

func (r *surrealVaultRepository) recordID() models.RecordID {
	key := r.key
	if key == "" {
		key = "default"
	}
	return models.NewRecordID("diary_vault", key)
}

func vaultRevisionConflict() error {
	return NewAppError(409, "vault_revision_conflict", "Der Tresor wurde zwischenzeitlich geändert. Bitte neu laden und erneut versuchen.")
}
