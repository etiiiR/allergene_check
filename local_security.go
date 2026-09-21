package main

import (
	"net"
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// Loopback binding alone does not stop DNS rebinding. Reject unexpected Host
// headers before returning a personal diary or accepting its mutations.
func localHostGuard(c *fiber.Ctx) error {
	host := c.Get("Host")
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	configured, _ := url.Parse(envOrDefault("APP_URL", "http://localhost:3000"))
	if host != "localhost" && host != "127.0.0.1" && host != "::1" && (configured == nil || host != configured.Hostname()) {
		return NewAppError(403, "host_rejected", "Unbekannte Adresse für das persönliche Tagebuch.")
	}
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func sameOrigin(c *fiber.Ctx) bool {
	if origin := c.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		return err == nil && u.Host == c.Get("Host") && (u.Scheme == "http" || u.Scheme == "https")
	}
	return true
}
