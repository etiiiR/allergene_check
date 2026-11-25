package main

import (
	"net"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

func TestTrustedProxyAddressConfigurationIsExplicit(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "172.31.254.2, 10.8.0.4")
	got := trustedProxyAddresses()
	if len(got) != 2 || got[0] != "172.31.254.2" || got[1] != "10.8.0.4" {
		t.Fatalf("unexpected trusted proxies: %#v", got)
	}
	t.Setenv("TRUSTED_PROXIES", " ")
	if got := trustedProxyAddresses(); len(got) != 0 {
		t.Fatalf("empty configuration trusted a proxy: %#v", got)
	}
}

func TestForwardedClientIPIsTrustedOnlyFromConfiguredProxy(t *testing.T) {
	app := fiber.New(fiber.Config{
		EnableTrustedProxyCheck: true,
		TrustedProxies:          []string{"172.31.254.2"},
		ProxyHeader:             fiber.HeaderXForwardedFor,
		EnableIPValidation:      true,
	})
	clientIP := func(remote string) string {
		ctx := app.AcquireCtx(&fasthttp.RequestCtx{})
		ctx.Context().SetRemoteAddr(&net.TCPAddr{IP: net.ParseIP(remote)})
		ctx.Request().Header.Set(fiber.HeaderXForwardedFor, "198.51.100.77")
		got := ctx.IP()
		app.ReleaseCtx(ctx)
		return got
	}
	if got := clientIP("172.31.254.2"); got != "198.51.100.77" {
		t.Fatalf("trusted proxy client IP = %q, want forwarded client", got)
	}
	if got := clientIP("203.0.113.18"); got != "203.0.113.18" {
		t.Fatalf("untrusted forwarded header changed client IP to %q", got)
	}
}

func TestLocalHostGuardSetsBrowserSecurityHeaders(t *testing.T) {
	t.Setenv("APP_URL", "http://localhost:3000")
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Use(localSecurityHeaders)
	app.Use(localHostGuard)
	app.Get("/", func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	request := httptest.NewRequest("GET", "/", nil)
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

	request := httptest.NewRequest("GET", "/same-origin", nil)
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

	request = httptest.NewRequest("GET", "/cross-origin", nil)
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

	request := httptest.NewRequest("POST", "/same-origin", nil)
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

	request = httptest.NewRequest("POST", "/same-origin", nil)
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

	request := httptest.NewRequest("GET", "/", nil)
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
