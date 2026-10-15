package main

import (
	"net"
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const localContentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; style-src-elem 'self'; style-src-attr 'none'; img-src 'self'; font-src 'self'; connect-src 'self'"

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
	origin := c.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	configured, err := url.Parse(envOrDefault("APP_URL", "http://localhost:3000"))
	if err != nil || configured.Host == "" {
		return false
	}
	requestHost := string(c.Context().URI().Host())
	return strings.EqualFold(u.Scheme, configured.Scheme) &&
		strings.EqualFold(u.Host, configured.Host) &&
		strings.EqualFold(u.Host, requestHost)
}
