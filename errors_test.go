package main

import (
	"bytes"
	"errors"
	"io"
	"log"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestInternalErrorLogsDoNotExposeCause(t *testing.T) {
	const sentinel = "private-diary-error-sentinel"
	var logs bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(originalWriter)

	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Get("/private-operation", func(*fiber.Ctx) error {
		return errors.New(sentinel)
	})

	response, err := app.Test(httptest.NewRequest("GET", "/private-operation", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}

	if response.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status=%d, want %d", response.StatusCode, fiber.StatusInternalServerError)
	}
	if strings.Contains(string(body), sentinel) {
		t.Fatal("internal cause was sent to the client")
	}
	if strings.Contains(logs.String(), sentinel) {
		t.Fatal("internal cause was written to server logs")
	}
	if !strings.Contains(logs.String(), "GET /private-operation") || !strings.Contains(logs.String(), ErrorCodeInternal) {
		t.Fatalf("safe request metadata missing from log: %q", logs.String())
	}
}
