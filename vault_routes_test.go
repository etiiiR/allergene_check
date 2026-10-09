package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type memoryVaultRepository struct {
	mu     sync.Mutex
	vault  EncryptedVault
	legacy bool
}

func (r *memoryVaultRepository) LoadVault(context.Context) (EncryptedVault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return cloneVault(r.vault), nil
}

func (r *memoryVaultRepository) LegacyDataAvailable(context.Context) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.legacy, nil
}

func (r *memoryVaultRepository) SaveVault(_ context.Context, expected int64, envelope json.RawMessage, migrateLegacy bool) (EncryptedVault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if expected != r.vault.Revision {
		return EncryptedVault{}, NewAppError(409, "vault_revision_conflict", "revision conflict")
	}
	r.vault = EncryptedVault{Revision: expected + 1, Envelope: append(json.RawMessage(nil), envelope...)}
	if migrateLegacy {
		r.legacy = false
	}
	return cloneVault(r.vault), nil
}

func TestVaultRequiresAndConfirmsLegacyMigration(t *testing.T) {
	repository := &memoryVaultRepository{vault: EncryptedVault{Envelope: json.RawMessage("null")}, legacy: true}
	app := newVaultTestApp(repository)
	put := func(body string) *http.Response {
		req := httptest.NewRequest("PUT", "/api/vault", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Diary-Request", "1")
		response, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}

	withoutMigration := put(`{"expected_revision":0,"envelope":{"version":1}}`)
	if withoutMigration.StatusCode != 409 {
		t.Fatalf("unconfirmed migration status=%d, want 409", withoutMigration.StatusCode)
	}
	unchanged, _ := repository.LoadVault(context.Background())
	if unchanged.Revision != 0 || !repository.legacy {
		t.Fatalf("rejected setup changed legacy data or vault: %#v, legacy=%v", unchanged, repository.legacy)
	}

	confirmed := put(`{"expected_revision":0,"migrate_legacy":true,"envelope":{"version":1,"payload":{"ciphertext":"opaque"}}}`)
	if confirmed.StatusCode != 200 {
		t.Fatalf("confirmed migration status=%d, want 200", confirmed.StatusCode)
	}
	if repository.legacy {
		t.Fatal("confirmed migration did not clear the legacy marker")
	}
}

func cloneVault(v EncryptedVault) EncryptedVault {
	if len(v.Envelope) == 0 {
		v.Envelope = json.RawMessage("null")
	} else {
		v.Envelope = append(json.RawMessage(nil), v.Envelope...)
	}
	return v
}

func newVaultTestApp(repository VaultRepository) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	api := app.Group("/api", func(c *fiber.Ctx) error {
		c.Set("Cache-Control", "no-store")
		if !sameOrigin(c) {
			return NewAppError(403, "origin_rejected", "origin rejected")
		}
		if c.Method() != "GET" && c.Get("X-Diary-Request") != "1" {
			return NewAppError(403, "request_rejected", "request rejected")
		}
		return c.Next()
	})
	registerVaultRoutes(api, repository)
	return app
}

func TestVaultRoutesStoreOpaqueEnvelopeAndCheckRevision(t *testing.T) {
	repository := &memoryVaultRepository{vault: EncryptedVault{Envelope: json.RawMessage("null")}}
	app := newVaultTestApp(repository)

	initial, err := app.Test(httptest.NewRequest("GET", "/api/vault", nil))
	if err != nil || initial.StatusCode != 200 {
		t.Fatalf("initial vault request: status=%v err=%v", initial.StatusCode, err)
	}
	var current EncryptedVault
	if err := json.NewDecoder(initial.Body).Decode(&current); err != nil {
		t.Fatal(err)
	}
	if current.Revision != 0 || string(current.Envelope) != "null" {
		t.Fatalf("unexpected empty vault: %#v", current)
	}

	body := `{"expected_revision":0,"envelope":{"version":1,"payload":{"iv":"random","ciphertext":"opaque"}}}`
	put := httptest.NewRequest("PUT", "/api/vault", strings.NewReader(body))
	put.Header.Set("Content-Type", "application/json")
	put.Header.Set("X-Diary-Request", "1")
	saved, err := app.Test(put)
	if err != nil || saved.StatusCode != 200 {
		t.Fatalf("save vault: status=%v err=%v", saved.StatusCode, err)
	}
	if err := json.NewDecoder(saved.Body).Decode(&current); err != nil {
		t.Fatal(err)
	}
	if current.Revision != 1 || !strings.Contains(string(current.Envelope), `"ciphertext":"opaque"`) {
		t.Fatalf("unexpected saved vault: %#v", current)
	}

	staleBody := `{"expected_revision":0,"envelope":{"version":1,"payload":{"ciphertext":"stale"}}}`
	stale := httptest.NewRequest("PUT", "/api/vault", strings.NewReader(staleBody))
	stale.Header.Set("Content-Type", "application/json")
	stale.Header.Set("X-Diary-Request", "1")
	conflict, err := app.Test(stale)
	if err != nil || conflict.StatusCode != 409 {
		t.Fatalf("stale update status=%v err=%v, want 409", conflict.StatusCode, err)
	}
	stored, _ := repository.LoadVault(context.Background())
	if stored.Revision != 1 || strings.Contains(string(stored.Envelope), "stale") {
		t.Fatalf("stale update overwrote current vault: %#v", stored)
	}
}

func TestVaultRoutesDoNotReturnOversizedStoredEnvelope(t *testing.T) {
	repository := &memoryVaultRepository{
		vault: EncryptedVault{
			Revision: 1,
			Envelope: json.RawMessage(`{"ciphertext":"` + strings.Repeat("a", maxVaultEnvelopeBytes) + `"}`),
		},
	}
	response, err := newVaultTestApp(repository).Test(httptest.NewRequest("GET", "/api/vault", nil))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 500 {
		t.Fatalf("oversized stored envelope status=%d, want 500", response.StatusCode)
	}
	var payload ErrorResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "vault_record_invalid" {
		t.Fatalf("unexpected error response: %#v", payload.Error)
	}
}

func TestVaultRoutesRejectInvalidAndUnconfirmedRequests(t *testing.T) {
	app := newVaultTestApp(&memoryVaultRepository{vault: EncryptedVault{Envelope: json.RawMessage("null")}})
	for _, body := range []string{
		`{"envelope":{"version":1}}`,
		`{"expected_revision":0,"envelope":[]}`,
		`{"expected_revision":0,"envelope":null}`,
	} {
		req := httptest.NewRequest("PUT", "/api/vault", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Diary-Request", "1")
		response, err := app.Test(req)
		if err != nil || response.StatusCode != 422 {
			t.Fatalf("body %s: status=%v err=%v, want 422", body, response.StatusCode, err)
		}
	}

	withoutConfirmation := httptest.NewRequest("PUT", "/api/vault", strings.NewReader(`{}`))
	withoutConfirmation.Header.Set("Content-Type", "application/json")
	response, err := app.Test(withoutConfirmation)
	if err != nil || response.StatusCode != 403 {
		t.Fatalf("unconfirmed mutation status=%v err=%v, want 403", response.StatusCode, err)
	}
}
