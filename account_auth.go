package main

import (
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

const (
	accountRecordKey         = "owner"
	accountSessionCookie     = "gutfeeling_session"
	accountSessionLifetime   = 30 * 24 * time.Hour
	passwordHashIterations   = 600_000
	passwordHashBytes        = 32
	passwordSaltBytes        = 16
	accountRecoveryCodeBytes = 32
	loginWindow              = 15 * time.Minute
	loginMaxAttempts         = 8
	loginCleanupInterval     = time.Minute
	maxTrackedLoginIPs       = 4096
)

var (
	ErrAccountExists         = errors.New("account already exists")
	ErrNoAccount             = errors.New("account does not exist")
	ErrAccountRecoveryFailed = errors.New("account recovery failed")
	accountNameRE            = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$`)
)

type accountRecord struct {
	Username         string `json:"username"`
	Salt             string `json:"salt"`
	PasswordHash     string `json:"password_hash"`
	RecoveryCodeHash string `json:"recovery_code_hash"`
}

type accountSessionRecord struct {
	ID          models.RecordID `json:"id"`
	ExpiresAt   int64           `json:"expires_at"`
	CreatedAt   int64           `json:"created_at"`
	DeviceLabel string          `json:"device_label"`
}

// accountSessionData is the create payload; record identity belongs to the
// explicit SurrealDB target and must not be serialized as an empty field.
type accountSessionData struct {
	ExpiresAt   int64  `json:"expires_at"`
	CreatedAt   int64  `json:"created_at"`
	DeviceLabel string `json:"device_label"`
}

type accountSessionView struct {
	ID          string `json:"id"`
	ExpiresAt   int64  `json:"expires_at"`
	CreatedAt   int64  `json:"created_at"`
	DeviceLabel string `json:"device_label"`
	Current     bool   `json:"current"`
}

// AccountRepository persists only account credentials and opaque session
// hashes. It never receives the diary-vault passphrase or plaintext.
type AccountRepository interface {
	Account(context.Context) (*accountRecord, error)
	CreateAccount(context.Context, accountRecord) error
	CreateSession(context.Context, string, int64) error
	CreateSessionWithMetadata(context.Context, string, int64, int64, string) error
	SessionExpiry(context.Context, string) (int64, error)
	ListSessions(context.Context) ([]accountSessionRecord, error)
	DeleteSession(context.Context, string) error
	DeleteOtherSessions(context.Context, string) (int, error)
	UpdatePasswordAndDeleteOtherSessions(context.Context, accountRecord, string) (int, error)
	SetRecoveryCodeHash(context.Context, string) error
	RecoverAccountPassword(context.Context, string, string, accountRecord) error
}

type surrealAccountRepository struct{ store *SurrealStore }

func (r *surrealAccountRepository) Account(ctx context.Context) (*accountRecord, error) {
	return Select[accountRecord](ctx, r.store, models.NewRecordID("diary_account", accountRecordKey))
}

func (r *surrealAccountRepository) CreateAccount(ctx context.Context, account accountRecord) error {
	_, err := Create[accountRecord](ctx, r.store, models.NewRecordID("diary_account", accountRecordKey), account)
	if err != nil {
		// A fixed record ID makes setup single-use even when two requests race.
		if current, loadErr := r.Account(ctx); loadErr == nil && current != nil {
			return ErrAccountExists
		}
	}
	return err
}

func (r *surrealAccountRepository) CreateSession(ctx context.Context, id string, expiry int64) error {
	return r.CreateSessionWithMetadata(ctx, id, expiry, 0, "")
}

func (r *surrealAccountRepository) CreateSessionWithMetadata(ctx context.Context, id string, expiry, createdAt int64, deviceLabel string) error {
	_, err := Create[accountSessionRecord](ctx, r.store, models.NewRecordID("diary_account_sessions", id), accountSessionData{
		ExpiresAt: expiry, CreatedAt: createdAt, DeviceLabel: deviceLabel,
	})
	return err
}

func (r *surrealAccountRepository) SessionExpiry(ctx context.Context, id string) (int64, error) {
	record, err := Select[accountSessionRecord](ctx, r.store, models.NewRecordID("diary_account_sessions", id))
	if err != nil || record == nil {
		return 0, err
	}
	return record.ExpiresAt, nil
}

func (r *surrealAccountRepository) ListSessions(ctx context.Context) ([]accountSessionRecord, error) {
	records, err := Select[[]accountSessionRecord](ctx, r.store, models.Table("diary_account_sessions"))
	if err != nil || records == nil {
		return nil, err
	}
	return *records, nil
}

func (r *surrealAccountRepository) DeleteSession(ctx context.Context, id string) error {
	_, err := Delete[any](ctx, r.store, models.NewRecordID("diary_account_sessions", id))
	return err
}

func (r *surrealAccountRepository) DeleteOtherSessions(ctx context.Context, currentID string) (int, error) {
	results, err := Query[[]accountSessionRecord](ctx, r.store,
		`DELETE FROM diary_account_sessions WHERE id != $current RETURN BEFORE;`,
		map[string]any{"current": models.NewRecordID("diary_account_sessions", currentID)},
	)
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, result := range *results {
		if result.Error != nil {
			return deleted, result.Error
		}
		deleted += len(result.Result)
	}
	return deleted, nil
}

func (r *surrealAccountRepository) UpdatePasswordAndDeleteOtherSessions(ctx context.Context, account accountRecord, currentID string) (int, error) {
	deleted := 0
	err := r.store.WithTransaction(ctx, func(tx *surrealdb.Transaction) error {
		if _, err := surrealdb.Update[accountRecord](ctx, tx, models.NewRecordID("diary_account", accountRecordKey), account); err != nil {
			return err
		}
		results, err := surrealdb.Query[[]accountSessionRecord](ctx, tx,
			`DELETE FROM diary_account_sessions WHERE id != $current RETURN BEFORE;`,
			map[string]any{"current": models.NewRecordID("diary_account_sessions", currentID)},
		)
		if err != nil {
			return err
		}
		for _, result := range *results {
			if result.Error != nil {
				return result.Error
			}
			deleted += len(result.Result)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

func (r *surrealAccountRepository) SetRecoveryCodeHash(ctx context.Context, hash string) error {
	_, err := Merge[accountRecord](ctx, r.store,
		models.NewRecordID("diary_account", accountRecordKey),
		map[string]any{"recovery_code_hash": hash},
	)
	return err
}

// RecoverAccountPassword atomically consumes a recovery verifier, replaces
// only sign-in credentials, and revokes every session. It never touches the
// encrypted diary vault or receives its decryption keys.
func (r *surrealAccountRepository) RecoverAccountPassword(ctx context.Context, username, expectedHash string, replacement accountRecord) error {
	return r.store.WithTransaction(ctx, func(tx *surrealdb.Transaction) error {
		id := models.NewRecordID("diary_account", accountRecordKey)
		current, err := surrealdb.Select[accountRecord](ctx, tx, id)
		if err != nil {
			return err
		}
		if current == nil || current.Username != username || current.RecoveryCodeHash == "" ||
			subtle.ConstantTimeCompare([]byte(current.RecoveryCodeHash), []byte(expectedHash)) != 1 {
			return ErrAccountRecoveryFailed
		}
		replacement.Username = current.Username
		replacement.RecoveryCodeHash = "" // Recovery codes are single-use.
		if _, err := surrealdb.Update[accountRecord](ctx, tx, id, replacement); err != nil {
			return err
		}
		results, err := surrealdb.Query[any](ctx, tx, `DELETE FROM diary_account_sessions;`, nil)
		if err != nil {
			return err
		}
		for _, result := range *results {
			if result.Error != nil {
				return result.Error
			}
		}
		return nil
	})
}

type accountService struct {
	repository   AccountRepository
	setupToken   string
	secureCookie bool
	clock        func() time.Time
	mu           sync.Mutex
	attempts     map[string]loginAttempt
	nextCleanup  time.Time
}

type loginAttempt struct {
	started time.Time
	count   int
}

func newAccountService(repository AccountRepository, setupToken, publicURL string) *accountService {
	parsed, _ := url.Parse(publicURL)
	return &accountService{
		repository:   repository,
		setupToken:   strings.TrimSpace(setupToken),
		secureCookie: parsed != nil && strings.EqualFold(parsed.Scheme, "https"),
		clock:        time.Now,
		attempts:     make(map[string]loginAttempt),
	}
}

func (s *accountService) HasAccount(ctx context.Context) (bool, error) {
	account, err := s.repository.Account(ctx)
	return account != nil, err
}

func (s *accountService) Register(ctx context.Context, setupToken, username, password string) error {
	if s.setupToken == "" || !constantTimeTokenEqual(setupToken, s.setupToken) {
		return NewAppError(403, "account_setup_rejected", "Der Einrichtungscode ist ungültig.")
	}
	username = strings.ToLower(strings.TrimSpace(username))
	if !accountNameRE.MatchString(username) {
		return invalid("Der Benutzername muss 3–32 Zeichen lang sein und darf Buchstaben, Zahlen, Punkt, Bindestrich oder Unterstrich enthalten.")
	}
	if len(password) < 12 || len(password) > 1024 {
		return invalid("Das Kontopasswort muss mindestens 12 Zeichen lang sein.")
	}
	if exists, err := s.HasAccount(ctx); err != nil {
		return err
	} else if exists {
		return NewAppError(409, "account_already_setup", "Für diese Installation ist bereits ein Konto eingerichtet.")
	}
	salt := make([]byte, passwordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return fmt.Errorf("generate account password salt: %w", err)
	}
	derived, err := deriveAccountPassword(password, salt)
	if err != nil {
		return err
	}
	return s.repository.CreateAccount(ctx, accountRecord{
		Username: username, Salt: base64.RawURLEncoding.EncodeToString(salt),
		PasswordHash: base64.RawURLEncoding.EncodeToString(derived),
	})
}

func (s *accountService) Login(ctx context.Context, ip, username, password string, deviceLabels ...string) (string, error) {
	if len(password) > 1024 {
		return "", NewAppError(401, "account_login_failed", "Benutzername oder Passwort stimmen nicht.")
	}
	if !s.allowLogin(ip) {
		return "", NewAppError(429, "login_rate_limited", "Zu viele Anmeldeversuche. Bitte warte 15 Minuten.")
	}
	account, err := s.repository.Account(ctx)
	if err != nil {
		return "", err
	}
	// Perform the same expensive derivation for a missing account or wrong
	// username so those cases do not reveal whether setup has happened.
	known := account != nil && account.Username == strings.ToLower(strings.TrimSpace(username))
	salt := make([]byte, passwordSaltBytes)
	expected := make([]byte, passwordHashBytes)
	if known {
		salt, err = base64.RawURLEncoding.DecodeString(account.Salt)
		if err == nil {
			expected, err = base64.RawURLEncoding.DecodeString(account.PasswordHash)
		}
	} else {
		// Deterministic dummy values are not account credentials; they keep the
		// missing-user path comparable to normal password verification.
		salt = []byte("gutfeeling-dummy")
		expected = make([]byte, passwordHashBytes)
	}
	if err != nil || len(salt) < 8 || len(salt) > 64 || len(expected) != passwordHashBytes {
		known = false
		salt = []byte("gutfeeling-dummy")
		expected = make([]byte, passwordHashBytes)
	}
	actual, deriveErr := deriveAccountPassword(password, salt)
	if deriveErr != nil || !known || subtle.ConstantTimeCompare(actual, expected) != 1 {
		return "", NewAppError(401, "account_login_failed", "Benutzername oder Passwort stimmen nicht.")
	}
	deviceLabel := "Browser auf Gerät"
	if len(deviceLabels) > 0 && deviceLabels[0] != "" {
		deviceLabel = deviceLabels[0]
	}
	token, err := s.newSession(ctx, deviceLabel)
	if err != nil {
		return "", err
	}
	s.clearLoginAttempts(ip)
	return token, nil
}

// ChangePassword authenticates the existing session and current password,
// replaces only account sign-in credentials, and revokes other devices in the
// same transaction. The diary-vault passphrase and ciphertext are untouched.
func (s *accountService) ChangePassword(ctx context.Context, ip, token, currentPassword, nextPassword string) (int, error) {
	if len(currentPassword) > 1024 || len(nextPassword) < 12 || len(nextPassword) > 1024 {
		return 0, invalid("Das neue Kontopasswort muss mindestens 12 Zeichen lang sein.")
	}
	if !s.allowLogin(ip) {
		return 0, NewAppError(429, "login_rate_limited", "Zu viele Versuche. Bitte warte 15 Minuten.")
	}
	valid, err := s.ValidSession(ctx, token)
	if err != nil {
		return 0, err
	}
	if !valid {
		return 0, NewAppError(fiber.StatusUnauthorized, "account_sign_in_required", "Bitte melde dich erneut an.")
	}
	account, err := s.repository.Account(ctx)
	if err != nil {
		return 0, err
	}
	if account == nil || !accountPasswordMatches(account, currentPassword) {
		return 0, NewAppError(fiber.StatusUnauthorized, "account_password_incorrect", "Das aktuelle Kontopasswort stimmt nicht.")
	}
	if subtle.ConstantTimeCompare([]byte(currentPassword), []byte(nextPassword)) == 1 {
		return 0, invalid("Wähle ein anderes neues Kontopasswort.")
	}
	salt := make([]byte, passwordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return 0, fmt.Errorf("generate account password salt: %w", err)
	}
	derived, err := deriveAccountPassword(nextPassword, salt)
	if err != nil {
		return 0, err
	}
	account.Salt = base64.RawURLEncoding.EncodeToString(salt)
	account.PasswordHash = base64.RawURLEncoding.EncodeToString(derived)
	deleted, err := s.repository.UpdatePasswordAndDeleteOtherSessions(ctx, *account, hashSessionToken(token))
	if err != nil {
		return 0, err
	}
	s.clearLoginAttempts(ip)
	return deleted, nil
}

// SetAccountRecoveryCode stores only a digest of a cryptographically random
// account-access code after verifying both the current session and password.
// The code cannot decrypt the diary vault.
func (s *accountService) SetAccountRecoveryCode(ctx context.Context, ip, token, currentPassword, code string) error {
	if len(currentPassword) > 1024 {
		return NewAppError(fiber.StatusUnauthorized, "account_password_incorrect", "Das aktuelle Kontopasswort stimmt nicht.")
	}
	if !s.allowLogin(ip) {
		return NewAppError(429, "login_rate_limited", "Zu viele Versuche. Bitte warte 15 Minuten.")
	}
	valid, err := s.ValidSession(ctx, token)
	if err != nil {
		return err
	}
	if !valid {
		return NewAppError(fiber.StatusUnauthorized, "account_sign_in_required", "Bitte melde dich erneut an.")
	}
	hash, validCode := accountRecoveryCodeDigest(code)
	if !validCode {
		return invalid("Erstelle bitte einen gültigen Wiederherstellungscode und bestätige ihn.")
	}
	account, err := s.repository.Account(ctx)
	if err != nil {
		return err
	}
	if account == nil || !accountPasswordMatches(account, currentPassword) {
		return NewAppError(fiber.StatusUnauthorized, "account_password_incorrect", "Das aktuelle Kontopasswort stimmt nicht.")
	}
	if err := s.repository.SetRecoveryCodeHash(ctx, hash); err != nil {
		return err
	}
	s.clearLoginAttempts(ip)
	return nil
}

// RecoverAccountPassword uses a one-time high-entropy code to restore account
// sign-in. The generic failure message avoids revealing whether a username or
// recovery code is valid. Vault decryption credentials are never involved.
func (s *accountService) RecoverAccountPassword(ctx context.Context, ip, username, code, nextPassword string) error {
	username = strings.ToLower(strings.TrimSpace(username))
	if !accountNameRE.MatchString(username) || len(nextPassword) < 12 || len(nextPassword) > 1024 {
		return accountRecoveryRejected()
	}
	if !s.allowLogin(ip) {
		return NewAppError(429, "login_rate_limited", "Zu viele Versuche. Bitte warte 15 Minuten.")
	}
	recoveryHash, validCode := accountRecoveryCodeDigest(code)
	if !validCode {
		return accountRecoveryRejected()
	}
	account, err := s.repository.Account(ctx)
	if err != nil {
		return err
	}
	if account == nil || account.Username != username || account.RecoveryCodeHash == "" ||
		subtle.ConstantTimeCompare([]byte(account.RecoveryCodeHash), []byte(recoveryHash)) != 1 {
		return accountRecoveryRejected()
	}
	salt := make([]byte, passwordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return fmt.Errorf("generate account password salt: %w", err)
	}
	derived, err := deriveAccountPassword(nextPassword, salt)
	if err != nil {
		return err
	}
	replacement := accountRecord{
		Username: username, Salt: base64.RawURLEncoding.EncodeToString(salt),
		PasswordHash: base64.RawURLEncoding.EncodeToString(derived),
	}
	if err := s.repository.RecoverAccountPassword(ctx, username, recoveryHash, replacement); err != nil {
		if errors.Is(err, ErrAccountRecoveryFailed) {
			return accountRecoveryRejected()
		}
		return err
	}
	s.clearLoginAttempts(ip)
	return nil
}

func accountRecoveryCodeDigest(code string) (string, bool) {
	decoded, err := base64.RawURLEncoding.DecodeString(code)
	if err != nil || len(decoded) != accountRecoveryCodeBytes || base64.RawURLEncoding.EncodeToString(decoded) != code {
		return "", false
	}
	digest := sha256.Sum256(decoded)
	return hex.EncodeToString(digest[:]), true
}

func accountRecoveryRejected() error {
	return NewAppError(fiber.StatusUnauthorized, "account_recovery_failed", "Wiederherstellungscode oder Benutzername ungültig. Falls du noch keinen Code eingerichtet hast, wende dich an die Serverbetreuung.")
}

func accountPasswordMatches(account *accountRecord, password string) bool {
	if account == nil || len(password) > 1024 {
		return false
	}
	salt, err := base64.RawURLEncoding.DecodeString(account.Salt)
	if err != nil || len(salt) < 8 || len(salt) > 64 {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(account.PasswordHash)
	if err != nil || len(expected) != passwordHashBytes {
		return false
	}
	actual, err := deriveAccountPassword(password, salt)
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}

func deriveAccountPassword(password string, salt []byte) ([]byte, error) {
	return pbkdf2.Key(sha256.New, password, salt, passwordHashIterations, passwordHashBytes)
}

func (s *accountService) newSession(ctx context.Context, deviceLabel string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate account session: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	now := s.clock().Unix()
	if err := s.repository.CreateSessionWithMetadata(ctx, hashSessionToken(token), now+int64(accountSessionLifetime.Seconds()), now, deviceLabel); err != nil {
		return "", err
	}
	return token, nil
}

// Sessions returns only unexpired sign-in metadata. The session record ID is a
// SHA-256 token digest, never the browser's bearer cookie; raw User-Agent and IP
// values are deliberately not persisted.
func (s *accountService) Sessions(ctx context.Context, token string) ([]accountSessionView, error) {
	valid, err := s.ValidSession(ctx, token)
	if err != nil {
		return nil, err
	}
	if !valid {
		return nil, NewAppError(fiber.StatusUnauthorized, "account_sign_in_required", "Bitte melde dich erneut an.")
	}
	records, err := s.repository.ListSessions(ctx)
	if err != nil {
		return nil, err
	}
	currentID := hashSessionToken(token)
	now := s.clock().Unix()
	sessions := make([]accountSessionView, 0, len(records))
	for _, record := range records {
		id, ok := record.ID.ID.(string)
		if !ok || !isSessionDigest(id) || record.ExpiresAt <= now {
			continue
		}
		label := record.DeviceLabel
		if label == "" {
			label = "Unbekanntes Gerät"
		}
		sessions = append(sessions, accountSessionView{
			ID: id, ExpiresAt: record.ExpiresAt, CreatedAt: record.CreatedAt,
			DeviceLabel: label, Current: id == currentID,
		})
	}
	return sessions, nil
}

// RevokeSession removes one other device while ensuring the caller cannot
// accidentally revoke the session currently authorizing this request.
func (s *accountService) RevokeSession(ctx context.Context, token, targetID string) error {
	valid, err := s.ValidSession(ctx, token)
	if err != nil {
		return err
	}
	if !valid {
		return NewAppError(fiber.StatusUnauthorized, "account_sign_in_required", "Bitte melde dich erneut an.")
	}
	if !isSessionDigest(targetID) {
		return invalid("Diese Anmeldung konnte nicht erkannt werden.")
	}
	if subtle.ConstantTimeCompare([]byte(targetID), []byte(hashSessionToken(token))) == 1 {
		return invalid("Dieses Gerät kannst du hier nicht abmelden. Nutze dafür „Dieses Gerät abmelden“.")
	}
	expiry, err := s.repository.SessionExpiry(ctx, targetID)
	if err != nil {
		return err
	}
	if expiry == 0 || expiry <= s.clock().Unix() {
		return NewAppError(fiber.StatusNotFound, "account_session_not_found", "Diese Anmeldung ist nicht mehr aktiv.")
	}
	return s.repository.DeleteSession(ctx, targetID)
}

func isSessionDigest(value string) bool {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

// deviceLabelFromUserAgent reduces the browser header to a coarse, readable
// label; it never stores the full header or a network address.
func deviceLabelFromUserAgent(value string) string {
	if len(value) > 512 {
		value = value[:512]
	}
	ua := strings.ToLower(value)
	browser := "Browser"
	switch {
	case strings.Contains(ua, "edg/"):
		browser = "Edge"
	case strings.Contains(ua, "firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "chrome/") || strings.Contains(ua, "crios/"):
		browser = "Chrome"
	case strings.Contains(ua, "safari/"):
		browser = "Safari"
	}
	platform := "Gerät"
	switch {
	case strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad") || strings.Contains(ua, "ipod"):
		platform = "iPhone / iPad"
	case strings.Contains(ua, "android"):
		platform = "Android"
	case strings.Contains(ua, "windows"):
		platform = "Windows"
	case strings.Contains(ua, "macintosh") || strings.Contains(ua, "mac os"):
		platform = "Mac"
	case strings.Contains(ua, "linux"):
		platform = "Linux"
	}
	return browser + " auf " + platform
}

func hashSessionToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func (s *accountService) ValidSession(ctx context.Context, token string) (bool, error) {
	if len(token) < 40 || len(token) > 64 {
		return false, nil
	}
	expiry, err := s.repository.SessionExpiry(ctx, hashSessionToken(token))
	if err != nil || expiry == 0 {
		return false, err
	}
	if expiry <= s.clock().Unix() {
		_ = s.repository.DeleteSession(ctx, hashSessionToken(token))
		return false, nil
	}
	return true, nil
}

func (s *accountService) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.repository.DeleteSession(ctx, hashSessionToken(token))
}

// RevokeOtherSessions removes every account session except the caller's current
// session. The opaque session hash is used as a record ID, never the cookie.
func (s *accountService) RevokeOtherSessions(ctx context.Context, token string) (int, error) {
	valid, err := s.ValidSession(ctx, token)
	if err != nil {
		return 0, err
	}
	if !valid {
		return 0, NewAppError(fiber.StatusUnauthorized, "account_sign_in_required", "Bitte melde dich erneut an.")
	}
	return s.repository.DeleteOtherSessions(ctx, hashSessionToken(token))
}

func (s *accountService) setSessionCookie(c *fiber.Ctx, token string) {
	c.Cookie(&fiber.Cookie{
		Name: accountSessionCookie, Value: token, Path: "/", MaxAge: int(accountSessionLifetime.Seconds()),
		HTTPOnly: true, Secure: s.secureCookie, SameSite: fiber.CookieSameSiteStrictMode,
	})
}

func (s *accountService) clearSessionCookie(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name: accountSessionCookie, Value: "", Path: "/", MaxAge: -1,
		HTTPOnly: true, Secure: s.secureCookie, SameSite: fiber.CookieSameSiteStrictMode,
	})
}

func (s *accountService) allowLogin(ip string) bool {
	now := s.clock()
	s.mu.Lock()
	defer s.mu.Unlock()
	// Avoid scanning the full source-address map on every login. Cleanup is
	// amortized, and the map has a hard cap so a flood of distinct addresses
	// cannot grow process memory without bound.
	if s.nextCleanup.IsZero() || !now.Before(s.nextCleanup) {
		for key, attempt := range s.attempts {
			if now.Sub(attempt.started) >= loginWindow {
				delete(s.attempts, key)
			}
		}
		s.nextCleanup = now.Add(loginCleanupInterval)
	}
	attempt, exists := s.attempts[ip]
	if !exists && len(s.attempts) >= maxTrackedLoginIPs {
		// Fail closed rather than evicting another address's active bucket.
		// This can temporarily reject new addresses during saturation, but it
		// prevents an address spray from bypassing existing attempt limits.
		return false
	}
	if attempt.started.IsZero() || now.Sub(attempt.started) >= loginWindow {
		s.attempts[ip] = loginAttempt{started: now, count: 1}
		return true
	}
	if attempt.count >= loginMaxAttempts {
		return false
	}
	attempt.count++
	s.attempts[ip] = attempt
	return true
}

// A successful credential check proves the current attempt was not a guess.
// Forget earlier failures so repeated legitimate sign-ins from one household
// do not accumulate into a lockout.
func (s *accountService) clearLoginAttempts(ip string) {
	s.mu.Lock()
	delete(s.attempts, ip)
	s.mu.Unlock()
}

// authenticateRequest checks only an opaque random session token. The stored
// database value is a one-way digest, so a read-only database leak cannot
// directly reuse browser cookies.
func (s *accountService) authenticateRequest(c *fiber.Ctx) error {
	token := c.Cookies(accountSessionCookie)
	valid, err := s.ValidSession(c.UserContext(), token)
	if err != nil {
		return WrapAppError(503, "account_session_unavailable", "Die Anmeldung ist vorübergehend nicht verfügbar.", err)
	}
	if !valid {
		if strings.HasPrefix(c.Path(), "/api/") {
			return NewAppError(401, "account_sign_in_required", "Bitte melde dich an, um dein Tagebuch zu öffnen.")
		}
		return c.Redirect("/login", fiber.StatusSeeOther)
	}
	c.Locals("accountAuthenticated", true)
	return c.Next()
}

func accountGateMiddleware(service *accountService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := c.Path()
		if service == nil || path == "/health" || path == "/api/status" || path == "/login" ||
			strings.HasPrefix(path, "/assets/") || path == "/api/auth/status" || path == "/api/auth/login" || path == "/api/auth/register" || path == "/api/auth/logout" || path == "/api/auth/recover" {
			return c.Next()
		}
		return service.authenticateRequest(c)
	}
}

// constantTimeTokenEqual is kept small and explicit for bootstrap tests.
func constantTimeTokenEqual(got, want string) bool {
	return len(got) == len(want) && hmac.Equal([]byte(got), []byte(want))
}
