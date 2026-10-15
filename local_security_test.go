package main

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestLocalHostGuardSetsBrowserSecurityHeaders(t *testing.T) {
	t.Setenv("APP_URL", "http://localhost:3000")
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Use(localSecurityHeaders)
	app.Use(localHostGuard)
	app.Get("/", func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	request := httptest.NewRequest("GET", "http://localhost:3000/", nil)
	request.Host = "localhost:3000"
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusNoContent {
		t.Fatalf("unexpected status: %d", response.StatusCode)
	}
	for header, want := range map[string]string{
		"Content-Security-Policy": localContentSecurityPolicy,
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "no-referrer",
	} {
		if got := response.Header.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	policy := response.Header.Get("Content-Security-Policy")
	if strings.Contains(policy, "unsafe-inline") {
		t.Fatal("Content-Security-Policy allows unsafe inline content")
	}
	if !strings.Contains(policy, "style-src-attr 'none'") {
		t.Fatal("Content-Security-Policy must block inline style attributes")
	}
}

func TestSameOriginUsesParsedRequestAuthority(t *testing.T) {
	t.Setenv("APP_URL", "http://localhost:3000")
	app := fiber.New()
	app.Get("/same-origin", func(c *fiber.Ctx) error {
		if !sameOrigin(c) {
			return c.SendStatus(fiber.StatusForbidden)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})
	app.Get("/cross-origin", func(c *fiber.Ctx) error {
		if !sameOrigin(c) {
			return c.SendStatus(fiber.StatusForbidden)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	request := httptest.NewRequest("GET", "http://localhost:3000/same-origin", nil)
	request.Host = "localhost:3000"
	request.Header.Set("Origin", "http://localhost:3000")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != fiber.StatusNoContent {
		t.Fatalf("same-origin request rejected: %d", response.StatusCode)
	}

	request = httptest.NewRequest("GET", "http://localhost:3000/cross-origin", nil)
	request.Host = "localhost:3000"
	request.Header.Set("Origin", "http://attacker.example")
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != fiber.StatusForbidden {
		t.Fatalf("cross-origin request accepted: %d", response.StatusCode)
	}
}

func TestSameOriginRejectsDifferentSchemeButAllowsConfiguredHTTPSProxyOrigin(t *testing.T) {
	t.Setenv("APP_URL", "https://journal.example")
	app := fiber.New()
	app.Post("/same-origin", func(c *fiber.Ctx) error {
		if !sameOrigin(c) {
			return c.SendStatus(fiber.StatusForbidden)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	request := httptest.NewRequest("POST", "http://journal.example/same-origin", nil)
	request.Host = "journal.example"
	request.Header.Set("Origin", "http://journal.example")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != fiber.StatusForbidden {
		t.Fatalf("cross-scheme origin accepted: %d", response.StatusCode)
	}

	request = httptest.NewRequest("POST", "http://journal.example/same-origin", nil)
	request.Host = "journal.example"
	request.Header.Set("Origin", "https://journal.example")
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != fiber.StatusNoContent {
		t.Fatalf("configured HTTPS origin behind a proxy rejected: %d", response.StatusCode)
	}
}

func TestLocalHostGuardRejectsUnexpectedHost(t *testing.T) {
	t.Setenv("APP_URL", "http://localhost:3000")
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Use(localHostGuard)
	app.Get("/", func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	request := httptest.NewRequest("GET", "http://attacker.example/", nil)
	request.Host = "attacker.example"
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusForbidden {
		t.Fatalf("unexpected status: %d", response.StatusCode)
	}
}
