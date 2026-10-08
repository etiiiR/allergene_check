package main

import (
	"net"
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const localContentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'"

// Loopback binding alone does not stop DNS rebinding. Reject unexpected Host
// headers before returning a personal diary or accepting its mutations.
func localHostGuard(c *fiber.Ctx) error {
	host := c.Hostname()
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	configured, _ := url.Parse(envOrDefault("APP_URL", "http://localhost:3000"))
	if host != "localhost" && host != "127.0.0.1" && host != "::1" && (configured == nil || host != configured.Hostname()) {
		return NewAppError(403, "host_rejected", "Unbekannte Adresse für das persönliche Tagebuch.")
	}
	return c.Next()
}

// localSecurityHeaders restricts browser capabilities even when the app is
// running without a configured database. HSTS is deliberately omitted: TLS
// termination is deployment-specific and must be configured at the proxy.
func localSecurityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("Content-Security-Policy", localContentSecurityPolicy)
	return c.Next()
}

func sameOrigin(c *fiber.Ctx) bool {
	if origin := c.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		requestHost := string(c.Context().URI().Host())
		return err == nil && u.Host == requestHost && (u.Scheme == "http" || u.Scheme == "https")
	}
	return true
}
