package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

type memoryAccountRepository struct {
	mu       sync.Mutex
	account  *accountRecord
	sessions map[string]int64
}

func newMemoryAccountRepository() *memoryAccountRepository {
	return &memoryAccountRepository{sessions: make(map[string]int64)}
}

func (r *memoryAccountRepository) Account(context.Context) (*accountRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.account == nil {
		return nil, nil
	}
	copy := *r.account
	return &copy, nil
}

func (r *memoryAccountRepository) CreateAccount(_ context.Context, account accountRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.account != nil {
		return ErrAccountExists
	}
	copy := account
	r.account = &copy
	return nil
}

func (r *memoryAccountRepository) CreateSession(_ context.Context, id string, expiry int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[id] = expiry
	return nil
}

func (r *memoryAccountRepository) SessionExpiry(_ context.Context, id string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessions[id], nil
}

func (r *memoryAccountRepository) DeleteSession(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, id)
	return nil
}

func TestAccountSetupPasswordAndSessionAreIndependent(t *testing.T) {
	repository := newMemoryAccountRepository()
	service := newAccountService(repository, "setup-code-that-is-not-the-vault-key", "https://gut.example")
	ctx := context.Background()

	if err := service.Register(ctx, "wrong-code", "gut-user", "A long account password"); err == nil {
		t.Fatal("registration accepted a wrong one-time setup code")
	}
	if err := service.Register(ctx, "setup-code-that-is-not-the-vault-key", "gut-user", "short"); err == nil {
		t.Fatal("registration accepted a short account password")
	}
	const accountPassword = "a separate account password 123"
	if err := service.Register(ctx, "setup-code-that-is-not-the-vault-key", "Gut-User", accountPassword); err != nil {
		t.Fatalf("register account: %v", err)
	}
	stored, err := repository.Account(ctx)
	if err != nil || stored == nil {
		t.Fatalf("load stored account: record=%#v err=%v", stored, err)
	}
	if stored.Username != "gut-user" || stored.PasswordHash == accountPassword || stored.Salt == "" {
		t.Fatalf("account credentials were not normalized and hashed: %#v", stored)
	}

	if _, err := service.Login(ctx, "127.0.0.1", "not-this-user", accountPassword); err == nil {
		t.Fatal("login accepted an unknown username")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != fiber.StatusUnauthorized {
			t.Fatalf("unknown username returned a distinguishable error: %v", err)
		}
	}
	if _, err := service.Login(ctx, "127.0.0.1", "gut-user", "not the password"); err == nil {
		t.Fatal("login accepted an incorrect password")
	}
	token, err := service.Login(ctx, "127.0.0.1", "gut-user", accountPassword)
	if err != nil {
		t.Fatalf("login with account password: %v", err)
	}
	valid, err := service.ValidSession(ctx, token)
	if err != nil || !valid {
		t.Fatalf("new session is not valid: valid=%v err=%v", valid, err)
	}
	if err := service.Logout(ctx, token); err != nil {
		t.Fatalf("revoke session: %v", err)
	}
	valid, err = service.ValidSession(ctx, token)
	if err != nil || valid {
		t.Fatalf("revoked session remained valid: valid=%v err=%v", valid, err)
	}
}

func TestAccountRoutesIssueHttpOnlySameSiteCookieAndProtectPrivateData(t *testing.T) {
	repository := newMemoryAccountRepository()
	service := newAccountService(repository, "one-time-local-bootstrap-token", "https://gut.example")
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	registerAccountRoutes(app, service)
	app.Get("/private", service.authenticateRequest, func(c *fiber.Ctx) error {
		return c.SendString("private")
	})

	unauthenticated, err := app.Test(httptest.NewRequest("GET", "/private", nil))
	if err != nil {
		t.Fatal(err)
	}
	if unauthenticated.StatusCode != fiber.StatusSeeOther || unauthenticated.Header.Get("Location") != "/login" {
		t.Fatalf("private page did not redirect to sign in: status=%d location=%q", unauthenticated.StatusCode, unauthenticated.Header.Get("Location"))
	}

	body := `{"setup_token":"one-time-local-bootstrap-token","username":"gut-user","password":"a separate account password 123"}`
	register := httptest.NewRequest("POST", "/api/auth/register", strings.NewReader(body))
	register.Header.Set("Content-Type", "application/json")
	register.Header.Set("X-Diary-Request", "1")
	response, err := app.Test(register)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusNoContent {
		var result map[string]any
		_ = json.NewDecoder(response.Body).Decode(&result)
		t.Fatalf("register returned %d: %#v", response.StatusCode, result)
	}
	cookies := response.Cookies()
	if len(cookies) != 1 || cookies[0].Name != accountSessionCookie || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("unexpected session cookie settings: %#v", cookies)
	}

	private := httptest.NewRequest("GET", "/private", nil)
	private.AddCookie(cookies[0])
	response, err = app.Test(private)
	if err != nil || response.StatusCode != fiber.StatusOK {
		t.Fatalf("authenticated private request: response=%v err=%v", response, err)
	}

}

func TestAccountLoginRateLimitAndSessionExpiry(t *testing.T) {
	service := newAccountService(newMemoryAccountRepository(), strings.Repeat("x", 32), "http://localhost:3000")
	for attempt := 0; attempt < loginMaxAttempts; attempt++ {
		if !service.allowLogin("198.51.100.5") {
			t.Fatalf("attempt %d was blocked too early", attempt+1)
		}
	}
	if service.allowLogin("198.51.100.5") {
		t.Fatal("login rate limit allowed an additional attempt")
	}
	if service.secureCookie {
		t.Fatal("HTTP local origin should not set Secure cookies that browsers reject")
	}
	repository := newMemoryAccountRepository()
	expiredService := newAccountService(repository, "", "https://gut.example")
	token := "this-is-a-valid-looking-but-expired-token"
	if err := repository.CreateSession(context.Background(), hashSessionToken(token), time.Now().Add(-time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	valid, err := expiredService.ValidSession(context.Background(), token)
	if err != nil || valid {
		t.Fatalf("expired session remained valid: valid=%v err=%v", valid, err)
	}
	if !constantTimeTokenEqual(strings.Repeat("a", 64), strings.Repeat("a", 64)) || constantTimeTokenEqual("a", "b") {
		t.Fatal("bootstrap token comparison behaved incorrectly")
	}
}
