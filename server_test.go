package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestServeFiberDrainsActiveRequestBeforeShutdown(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	requestEntered := make(chan struct{})
	releaseRequest := make(chan struct{})
	var releaseOnce sync.Once
	app.Get("/blocked", func(c *fiber.Ctx) error {
		close(requestEntered)
		<-releaseRequest
		return c.SendStatus(fiber.StatusNoContent)
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	t.Cleanup(func() { releaseOnce.Do(func() { close(releaseRequest) }) })

	serveDone := make(chan error, 1)
	go func() {
		serveDone <- serveFiber(ctx, app, listener, time.Second)
	}()

	client := &http.Client{Timeout: 5 * time.Second}
	responseDone := make(chan error, 1)
	go func() {
		response, requestErr := client.Get("http://" + listener.Addr().String() + "/blocked")
		if requestErr != nil {
			responseDone <- requestErr
			return
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusNoContent {
			responseDone <- fmt.Errorf("unexpected response status: %d", response.StatusCode)
			return
		}
		responseDone <- nil
	}()

	select {
	case <-requestEntered:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not reach the handler")
	}

	cancel()
	select {
	case err := <-serveDone:
		releaseOnce.Do(func() { close(releaseRequest) })
		t.Fatalf("server stopped before the active request drained: %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	releaseOnce.Do(func() { close(releaseRequest) })
	select {
	case err := <-responseDone:
		if err != nil {
			t.Fatalf("active request failed during shutdown: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("active request did not complete")
	}
	select {
	case err := <-serveDone:
		if err != nil {
			t.Fatalf("graceful shutdown failed: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server did not stop after the active request completed")
	}
}
