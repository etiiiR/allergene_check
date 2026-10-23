package main

import (
	"context"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
)

type accountRequest struct {
	SetupToken string `json:"setup_token"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

type changeAccountPasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func registerAccountRoutes(app *fiber.App, service *accountService) {
	auth := app.Group("/api/auth", func(c *fiber.Ctx) error {
		// Never cache authentication responses, especially those that set or
		// clear a session cookie.
		c.Set("Cache-Control", "no-store")
		c.Set("Pragma", "no-cache")
		return c.Next()
	})

	auth.Get("/status", func(c *fiber.Ctx) error {
		if service == nil {
			return c.JSON(fiber.Map{"configured": false, "available": false})
		}
		exists, err := service.HasAccount(c.UserContext())
		if err != nil {
			return WrapAppError(503, "account_status_unavailable", "Der Kontostatus ist vorübergehend nicht verfügbar.", err)
		}
		return c.JSON(fiber.Map{"configured": exists, "available": true})
	})

	auth.Post("/register", func(c *fiber.Ctx) error {
		if service == nil {
			return ErrDatabaseNotConfigured
		}
		if !sameOrigin(c) || c.Get("X-Diary-Request") != "1" {
			return NewAppError(403, "request_rejected", "Die Anfrage konnte nicht bestätigt werden.")
		}
		var request accountRequest
		if err := c.BodyParser(&request); err != nil {
			return invalid("Die Kontodaten sind ungültig.")
		}
		if err := service.Register(c.UserContext(), request.SetupToken, request.Username, request.Password); err != nil {
			if err == ErrAccountExists {
				return NewAppError(409, "account_already_setup", "Für diese Installation ist bereits ein Konto eingerichtet.")
			}
			return err
		}
		token, err := service.Login(c.UserContext(), c.IP(), request.Username, request.Password)
		if err != nil {
			return err
		}
		service.setSessionCookie(c, token)
		return c.SendStatus(fiber.StatusNoContent)
	})

	auth.Post("/login", func(c *fiber.Ctx) error {
		if service == nil {
			return ErrDatabaseNotConfigured
		}
		if !sameOrigin(c) || c.Get("X-Diary-Request") != "1" {
			return NewAppError(403, "request_rejected", "Die Anfrage konnte nicht bestätigt werden.")
		}
		var request accountRequest
		if err := c.BodyParser(&request); err != nil || len(request.Password) > 1024 {
			return NewAppError(401, "account_login_failed", "Benutzername oder Passwort stimmen nicht.")
		}
		token, err := service.Login(c.UserContext(), c.IP(), request.Username, request.Password)
		if err != nil {
			return err
		}
		service.setSessionCookie(c, token)
		return c.SendStatus(fiber.StatusNoContent)
	})

	auth.Post("/logout", func(c *fiber.Ctx) error {
		if !sameOrigin(c) || c.Get("X-Diary-Request") != "1" {
			return NewAppError(403, "request_rejected", "Die Anfrage konnte nicht bestätigt werden.")
		}
		if service != nil {
			ctx, cancel := context.WithTimeout(c.UserContext(), 3*time.Second)
			defer cancel()
			if err := service.Logout(ctx, c.Cookies(accountSessionCookie)); err != nil {
				return WrapAppError(503, "account_logout_unavailable", "Dieses Gerät konnte nicht abgemeldet werden.", err)
			}
			service.clearSessionCookie(c)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	auth.Delete("/sessions/others", func(c *fiber.Ctx) error {
		if service == nil {
			return ErrDatabaseNotConfigured
		}
		if !sameOrigin(c) || c.Get("X-Diary-Request") != "1" {
			return NewAppError(403, "request_rejected", "Die Anfrage konnte nicht bestätigt werden.")
		}
		ctx, cancel := context.WithTimeout(c.UserContext(), 5*time.Second)
		defer cancel()
		count, err := service.RevokeOtherSessions(ctx, c.Cookies(accountSessionCookie))
		if err != nil {
			var appErr *AppError
			if errors.As(err, &appErr) {
				return err
			}
			return WrapAppError(503, "account_sessions_unavailable", "Andere Geräte konnten nicht abgemeldet werden.", err)
		}
		return c.JSON(fiber.Map{"revoked": count})
	})

	auth.Put("/password", func(c *fiber.Ctx) error {
		if service == nil {
			return ErrDatabaseNotConfigured
		}
		if !sameOrigin(c) || c.Get("X-Diary-Request") != "1" {
			return NewAppError(403, "request_rejected", "Die Anfrage konnte nicht bestätigt werden.")
		}
		var request changeAccountPasswordRequest
		if err := c.BodyParser(&request); err != nil || len(request.CurrentPassword) > 1024 || len(request.NewPassword) > 1024 {
			return invalid("Die Passwortangaben sind ungültig.")
		}
		ctx, cancel := context.WithTimeout(c.UserContext(), 10*time.Second)
		defer cancel()
		count, err := service.ChangePassword(ctx, c.IP(), c.Cookies(accountSessionCookie), request.CurrentPassword, request.NewPassword)
		if err != nil {
			var appErr *AppError
			if errors.As(err, &appErr) {
				return err
			}
			return WrapAppError(503, "account_password_unavailable", "Das Kontopasswort konnte nicht sicher geändert werden. Bitte prüfe die Anmeldung und versuche es erneut.", err)
		}
		return c.JSON(fiber.Map{"revoked_other_sessions": count})
	})

	// Active browsers poll this endpoint while visible. A revoked device locks
	// its in-memory vault on its next poll, rather than merely failing on save.
	auth.Get("/session", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

}
