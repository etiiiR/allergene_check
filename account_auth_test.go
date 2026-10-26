package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

type memoryAccountRepository struct {
	mu              sync.Mutex
	account         *accountRecord
	sessions        map[string]int64
	sessionMetadata map[string]accountSessionRecord
}

func newMemoryAccountRepository() *memoryAccountRepository {
	return &memoryAccountRepository{
		sessions: make(map[string]int64), sessionMetadata: make(map[string]accountSessionRecord),
	}
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
	return r.CreateSessionWithMetadata(context.Background(), id, expiry, 0, "")
}

func (r *memoryAccountRepository) CreateSessionWithMetadata(_ context.Context, id string, expiry, createdAt int64, deviceLabel string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[id] = expiry
	r.sessionMetadata[id] = accountSessionRecord{
		ID: models.NewRecordID("diary_account_sessions", id), ExpiresAt: expiry,
		CreatedAt: createdAt, DeviceLabel: deviceLabel,
	}
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
	delete(r.sessionMetadata, id)
	return nil
}

func (r *memoryAccountRepository) ListSessions(context.Context) ([]accountSessionRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]accountSessionRecord, 0, len(r.sessionMetadata))
	for _, session := range r.sessionMetadata {
		items = append(items, session)
	}
	return items, nil
}

func (r *memoryAccountRepository) DeleteOtherSessions(_ context.Context, currentID string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	deleted := 0
	for id := range r.sessions {
		if id != currentID {
			delete(r.sessions, id)
			delete(r.sessionMetadata, id)
			deleted++
		}
	}
	return deleted, nil
}

func (r *memoryAccountRepository) UpdatePasswordAndDeleteOtherSessions(_ context.Context, account accountRecord, currentID string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.account == nil {
		return 0, ErrNoAccount
	}
	updated := account
	r.account = &updated
	deleted := 0
	for id := range r.sessions {
		if id != currentID {
			delete(r.sessions, id)
			delete(r.sessionMetadata, id)
			deleted++
		}
	}
	return deleted, nil
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
	if err := service.Register(ctx, "setup-code-that-is-not-the-vault-key", "second-user", "another long account password"); err == nil {
		t.Fatal("setup code created another account after the owner account existed")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != fiber.StatusConflict {
			t.Fatalf("second account setup returned an unexpected error: %v", err)
		}
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
	for attempt := 0; attempt < loginMaxAttempts+2; attempt++ {
		if _, err := service.Login(ctx, "127.0.0.1", "gut-user", accountPassword); err != nil {
			t.Fatalf("successful sign-in %d was rate-limited: %v", attempt+1, err)
		}
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
	app.Use(accountGateMiddleware(service))
	registerAccountRoutes(app, service)
	app.Get("/private", func(c *fiber.Ctx) error {
		return c.SendString("private")
	})
	app.Get("/api/private", func(c *fiber.Ctx) error { return c.SendString("private") })

	unauthenticated, err := app.Test(httptest.NewRequest("GET", "/private", nil))
	if err != nil {
		t.Fatal(err)
	}
	if unauthenticated.StatusCode != fiber.StatusSeeOther || unauthenticated.Header.Get("Location") != "/login" {
		t.Fatalf("private page did not redirect to sign in: status=%d location=%q", unauthenticated.StatusCode, unauthenticated.Header.Get("Location"))
	}
	privateAPI, err := app.Test(httptest.NewRequest("GET", "/api/private", nil))
	if err != nil || privateAPI.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("private API did not reject an anonymous request: response=%v err=%v", privateAPI, err)
	}

	body := `{"setup_token":"one-time-local-bootstrap-token","username":"gut-user","password":"a separate account password 123"}`
	register := httptest.NewRequest("POST", "/api/auth/register", strings.NewReader(body))
	register.Header.Set("Content-Type", "application/json")
	register.Header.Set("X-Diary-Request", "1")
	response, err := app.Test(register, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusNoContent {
		var result map[string]any
		_ = json.NewDecoder(response.Body).Decode(&result)
		t.Fatalf("register returned %d: %#v", response.StatusCode, result)
	}
	if got := response.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("register Cache-Control=%q, want no-store", got)
	}
	if got := response.Header.Get("Pragma"); got != "no-cache" {
		t.Fatalf("register Pragma=%q, want no-cache", got)
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

func TestLoginRateLimiterBoundsTrackedIPsAndCleansExpiredEntries(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	service := newAccountService(nil, "", "http://localhost")
	service.clock = func() time.Time { return now }

	for i := 0; i < maxTrackedLoginIPs; i++ {
		ip := fmt.Sprintf("test-address-%d", i)
		if !service.allowLogin(ip) {
			t.Fatalf("address %d unexpectedly rejected below capacity", i)
		}
	}
	if service.allowLogin("new-address-at-capacity") {
		t.Fatal("new address was accepted after limiter capacity was reached")
	}
	if got := len(service.attempts); got != maxTrackedLoginIPs {
		t.Fatalf("tracked address count=%d, want hard cap %d", got, maxTrackedLoginIPs)
	}

	// Expiration cleanup runs periodically, not on every request. Once the
	// window has elapsed, a new address can start a bucket.
	now = now.Add(loginWindow)
	if !service.allowLogin("after-expiration") {
		t.Fatal("new address remained blocked after expired buckets were cleaned")
	}
	if got := len(service.attempts); got != 1 {
		t.Fatalf("expired buckets were not removed: tracked=%d, want 1", got)
	}
}

func TestRevokeOtherSessionsKeepsCurrentDeviceSignedIn(t *testing.T) {
	repository := newMemoryAccountRepository()
	service := newAccountService(repository, strings.Repeat("s", 32), "https://gut.example")
	ctx := context.Background()
	if err := service.Register(ctx, strings.Repeat("s", 32), "gut-user", "a long account password"); err != nil {
		t.Fatalf("register account: %v", err)
	}
	current, err := service.Login(ctx, "192.0.2.1", "gut-user", "a long account password")
	if err != nil {
		t.Fatalf("create current session: %v", err)
	}
	otherOne, err := service.Login(ctx, "192.0.2.2", "gut-user", "a long account password")
	if err != nil {
		t.Fatalf("create other session: %v", err)
	}
	otherTwo, err := service.Login(ctx, "192.0.2.3", "gut-user", "a long account password")
	if err != nil {
		t.Fatalf("create second other session: %v", err)
	}

	deleted, err := service.RevokeOtherSessions(ctx, current)
	if err != nil || deleted != 2 {
		t.Fatalf("revoke other sessions: deleted=%d err=%v", deleted, err)
	}
	if valid, err := service.ValidSession(ctx, current); err != nil || !valid {
		t.Fatalf("current device was revoked: valid=%v err=%v", valid, err)
	}
	for _, token := range []string{otherOne, otherTwo} {
		if valid, err := service.ValidSession(ctx, token); err != nil || valid {
			t.Fatalf("other device remained signed in: valid=%v err=%v", valid, err)
		}
	}
}

func TestDeviceSessionInventoryAndSelectiveRevocation(t *testing.T) {
	repository := newMemoryAccountRepository()
	service := newAccountService(repository, strings.Repeat("s", 32), "https://gut.example")
	ctx := context.Background()
	if err := service.Register(ctx, strings.Repeat("s", 32), "gut-user", "a long account password"); err != nil {
		t.Fatalf("register account: %v", err)
	}
	current, err := service.Login(ctx, "192.0.2.1", "gut-user", "a long account password", "Firefox auf Linux")
	if err != nil {
		t.Fatalf("create current session: %v", err)
	}
	other, err := service.Login(ctx, "192.0.2.2", "gut-user", "a long account password", "Safari auf iPhone / iPad")
	if err != nil {
		t.Fatalf("create other session: %v", err)
	}

	sessions, err := service.Sessions(ctx, current)
	if err != nil || len(sessions) != 2 {
		t.Fatalf("list sessions: sessions=%#v err=%v", sessions, err)
	}
	var currentFound, otherFound bool
	for _, session := range sessions {
		switch {
		case session.Current:
			currentFound = session.DeviceLabel == "Firefox auf Linux" && session.ID == hashSessionToken(current)
		case session.ID == hashSessionToken(other):
			otherFound = session.DeviceLabel == "Safari auf iPhone / iPad"
		}
		if session.ID == current || session.ID == other {
			t.Fatal("session inventory exposed a bearer token")
		}
	}
	if !currentFound || !otherFound {
		t.Fatalf("inventory omitted expected device labels or current session: %#v", sessions)
	}
	if err := service.RevokeSession(ctx, current, hashSessionToken(current)); err == nil {
		t.Fatal("selective revocation allowed the current device to revoke itself")
	}
	if err := service.RevokeSession(ctx, current, hashSessionToken(other)); err != nil {
		t.Fatalf("revoke selected device: %v", err)
	}
	if valid, err := service.ValidSession(ctx, other); err != nil || valid {
		t.Fatalf("selected device remained signed in: valid=%v err=%v", valid, err)
	}
	if valid, err := service.ValidSession(ctx, current); err != nil || !valid {
		t.Fatalf("current device was revoked: valid=%v err=%v", valid, err)
	}
	if err := service.RevokeSession(ctx, current, "not-a-session-id"); err == nil {
		t.Fatal("selective revocation accepted a malformed session id")
	}
}

func TestDeviceLabelFromUserAgentStoresOnlyCoarsePlatform(t *testing.T) {
	for _, test := range []struct{ ua, want string }{
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", "Safari auf iPhone / iPad"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0", "Firefox auf Linux"},
		{"Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0", "Edge auf Windows"},
		{"", "Browser auf Gerät"},
	} {
		if got := deviceLabelFromUserAgent(test.ua); got != test.want {
			t.Errorf("deviceLabelFromUserAgent()=%q, want %q", got, test.want)
		}
	}
	if got := deviceLabelFromUserAgent(strings.Repeat("x", 4096)); len(got) > 64 {
		t.Fatalf("unexpectedly retained raw user-agent data: %q", got)
	}
}

func TestAccountSessionRoutesListAndRevokeOneDevice(t *testing.T) {
	repository := newMemoryAccountRepository()
	service := newAccountService(repository, strings.Repeat("s", 32), "http://localhost")
	ctx := context.Background()
	if err := service.Register(ctx, strings.Repeat("s", 32), "gut-user", "a long account password"); err != nil {
		t.Fatalf("register account: %v", err)
	}
	current, err := service.Login(ctx, "192.0.2.1", "gut-user", "a long account password", "Firefox auf Linux")
	if err != nil {
		t.Fatalf("create current session: %v", err)
	}
	other, err := service.Login(ctx, "192.0.2.2", "gut-user", "a long account password", "Safari auf iPhone / iPad")
	if err != nil {
		t.Fatalf("create other session: %v", err)
	}
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Use(accountGateMiddleware(service))
	registerAccountRoutes(app, service)

	listRequest := httptest.NewRequest(http.MethodGet, "/api/auth/sessions", nil)
	listRequest.AddCookie(&http.Cookie{Name: accountSessionCookie, Value: current})
	listResponse, err := app.Test(listRequest, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	defer listResponse.Body.Close()
	if listResponse.StatusCode != http.StatusOK || listResponse.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("session inventory response status=%d cache=%q", listResponse.StatusCode, listResponse.Header.Get("Cache-Control"))
	}
	var body struct {
		Sessions []accountSessionView `json:"sessions"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sessions) != 2 {
		t.Fatalf("inventory returned %d sessions, want 2", len(body.Sessions))
	}

	revokeRequest := httptest.NewRequest(http.MethodDelete, "/api/auth/sessions/"+hashSessionToken(other), nil)
	revokeRequest.AddCookie(&http.Cookie{Name: accountSessionCookie, Value: current})
	revokeResponse, err := app.Test(revokeRequest, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	defer revokeResponse.Body.Close()
	if revokeResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("mutation without request token returned status %d, want 403", revokeResponse.StatusCode)
	}
	revokeRequest = httptest.NewRequest(http.MethodDelete, "/api/auth/sessions/"+hashSessionToken(other), nil)
	revokeRequest.Header.Set("X-Diary-Request", "1")
	revokeRequest.AddCookie(&http.Cookie{Name: accountSessionCookie, Value: current})
	revokeResponse, err = app.Test(revokeRequest, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	defer revokeResponse.Body.Close()
	if revokeResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("selective revoke returned status %d, want 204", revokeResponse.StatusCode)
	}
	if valid, err := service.ValidSession(ctx, other); err != nil || valid {
		t.Fatalf("selected device remained authorized: valid=%v err=%v", valid, err)
	}
	if valid, err := service.ValidSession(ctx, current); err != nil || !valid {
		t.Fatalf("requesting device lost authorization: valid=%v err=%v", valid, err)
	}
}

func TestChangePasswordKeepsCurrentSessionAndRevokesOtherDevices(t *testing.T) {
	repository := newMemoryAccountRepository()
	service := newAccountService(repository, strings.Repeat("s", 32), "https://gut.example")
	ctx := context.Background()
	oldPassword := "a long account password"
	if err := service.Register(ctx, strings.Repeat("s", 32), "gut-user", oldPassword); err != nil {
		t.Fatalf("register account: %v", err)
	}
	current, err := service.Login(ctx, "192.0.2.1", "gut-user", oldPassword)
	if err != nil {
		t.Fatalf("create current session: %v", err)
	}
	other, err := service.Login(ctx, "192.0.2.2", "gut-user", oldPassword)
	if err != nil {
		t.Fatalf("create other session: %v", err)
	}
	const nextPassword = "a completely new password 456"
	deleted, err := service.ChangePassword(ctx, "192.0.2.1", current, oldPassword, nextPassword)
	if err != nil || deleted != 1 {
		t.Fatalf("change password: deleted=%d err=%v", deleted, err)
	}
	if valid, err := service.ValidSession(ctx, current); err != nil || !valid {
		t.Fatalf("current session was not kept: valid=%v err=%v", valid, err)
	}
	if valid, err := service.ValidSession(ctx, other); err != nil || valid {
		t.Fatalf("other session was not revoked: valid=%v err=%v", valid, err)
	}
	if _, err := service.Login(ctx, "192.0.2.3", "gut-user", oldPassword); err == nil {
		t.Fatal("old account password still worked")
	}
	if _, err := service.Login(ctx, "192.0.2.3", "gut-user", nextPassword); err != nil {
		t.Fatalf("new account password did not work: %v", err)
	}
	if _, err := service.ChangePassword(ctx, "192.0.2.4", current, "wrong current", "another long account password"); err == nil {
		t.Fatal("password change accepted an incorrect current password")
	}
	if _, err := service.ChangePassword(ctx, "192.0.2.4", current, nextPassword, "short"); err == nil {
		t.Fatal("password change accepted a short replacement password")
	}
}

func TestAccountPasswordChangeRouteRequiresSessionAndUpdatesSignIn(t *testing.T) {
	repository := newMemoryAccountRepository()
	service := newAccountService(repository, strings.Repeat("s", 32), "https://gut.example")
	ctx := context.Background()
	oldPassword := "the original account password"
	if err := service.Register(ctx, strings.Repeat("s", 32), "gut-user", oldPassword); err != nil {
		t.Fatalf("register account: %v", err)
	}
	current, err := service.Login(ctx, "192.0.2.1", "gut-user", oldPassword)
	if err != nil {
		t.Fatalf("create current session: %v", err)
	}
	other, err := service.Login(ctx, "192.0.2.2", "gut-user", oldPassword)
	if err != nil {
		t.Fatalf("create other session: %v", err)
	}
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Use(accountGateMiddleware(service))
	registerAccountRoutes(app, service)

	request := httptest.NewRequest(http.MethodPut, "/api/auth/password", strings.NewReader(
		`{"current_password":"the original account password","new_password":"a replacement password 123"}`,
	))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Diary-Request", "1")
	request.AddCookie(&http.Cookie{Name: accountSessionCookie, Value: current})
	response, err := app.Test(request, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		var body map[string]any
		_ = json.NewDecoder(response.Body).Decode(&body)
		t.Fatalf("password change returned %d: %#v", response.StatusCode, body)
	}
	var body map[string]int
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body["revoked_other_sessions"] != 1 {
		t.Fatalf("password change response does not report revoked sessions: body=%#v err=%v", body, err)
	}
	if valid, err := service.ValidSession(ctx, current); err != nil || !valid {
		t.Fatalf("current session was revoked: valid=%v err=%v", valid, err)
	}
	if valid, err := service.ValidSession(ctx, other); err != nil || valid {
		t.Fatalf("other device session remains valid: valid=%v err=%v", valid, err)
	}
	for _, attempt := range []struct {
		password string
		wantErr  bool
	}{{oldPassword, true}, {"a replacement password 123", false}} {
		_, err := service.Login(ctx, "192.0.2.3", "gut-user", attempt.password)
		if (err != nil) != attempt.wantErr {
			t.Fatalf("login with replacement password: err=%v wantErr=%v", err, attempt.wantErr)
		}
	}
}
