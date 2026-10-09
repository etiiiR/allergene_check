package main

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
)

type accountRequest struct {
	SetupToken string `json:"setup_token"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

func registerAccountRoutes(app *fiber.App, service *accountService) {
	app.Get("/api/auth/status", func(c *fiber.Ctx) error {
		c.Set("Cache-Control", "no-store")
		if service == nil {
			return c.JSON(fiber.Map{"configured": false, "available": false})
		}
		exists, err := service.HasAccount(c.UserContext())
		if err != nil {
			return WrapAppError(503, "account_status_unavailable", "Der Kontostatus ist vorübergehend nicht verfügbar.", err)
		}
		return c.JSON(fiber.Map{"configured": exists, "available": true})
	})

	app.Post("/api/auth/register", func(c *fiber.Ctx) error {
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

	app.Post("/api/auth/login", func(c *fiber.Ctx) error {
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

	app.Post("/api/auth/logout", func(c *fiber.Ctx) error {
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
		c.Set("Cache-Control", "no-store")
		return c.SendStatus(fiber.StatusNoContent)
	})

}
