package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Leave enough time for the longest bounded API operation to finish while
// keeping the container's configured stop grace period finite.
const serverShutdownTimeout = 28 * time.Second

// runServer owns the application lifecycle: configuration, one database connection,
// HTTP server startup, and connection cleanup.
func runServer() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runServerWithContext(ctx)
}

func runServerWithContext(runCtx context.Context) error {
	config := loadConfig()
	if len(config.accountSetupToken) < 32 {
		return NewAppError(500, ErrorCodeStartup, "ACCOUNT_SETUP_TOKEN must contain at least 32 characters. Use sh setup-local-env.sh --new for a new database volume, or sh setup-auth-token.sh with an existing .env file.")
	}
	if err := validatePublicAppURL(envOrDefault("APP_URL", "http://localhost:3000")); err != nil {
		return err
	}

	startupCtx, cancel := context.WithTimeout(runCtx, 10*time.Second)
	defer cancel()

	db, err := connectDatabase(startupCtx, config)
	if err != nil {
		if runCtx.Err() != nil {
			return nil
		}
		return WrapAppError(503, ErrorCodeStartup, "could not start database connection", err)
	}
	store := NewSurrealStore(db)
	defer func() {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer closeCancel()
		if store.close(closeCtx) != nil {
			log.Printf("could not close SurrealDB client cleanly")
		}
	}()
	if err := (&DiaryRepository{store: store}).initialize(startupCtx); err != nil {
		if runCtx.Err() != nil {
			return nil
		}
		return WrapAppError(503, ErrorCodeStartup, "could not initialize diary schema", err)
	}

	supervisorCtx, stopSupervisor := context.WithCancel(context.Background())
	supervisorDone := superviseDatabase(supervisorCtx, store, config)
	defer func() {
		stopSupervisor()
		<-supervisorDone
	}()
	app := newAppWithLifecycleContext(store, runCtx)
	listener, err := net.Listen("tcp", net.JoinHostPort(config.listenHost, config.port))
	if err != nil {
		return WrapAppError(500, ErrorCodeStartup, "could not listen for HTTP requests", err)
	}

	log.Printf("server listening on http://localhost:%s", config.port)
	if err := serveFiber(runCtx, app, listener, serverShutdownTimeout); err != nil {
		return WrapAppError(500, ErrorCodeStartup, "HTTP server stopped unexpectedly", err)
	}
	return nil
}

// serveFiber waits until Fiber has entered its accept loop before reacting to a
// shutdown signal. This prevents a signal during server startup from racing the
// listener registration and leaving the process blocked in Listen.
func serveFiber(ctx context.Context, app *fiber.App, listener net.Listener, timeout time.Duration) error {
	ready := make(chan struct{})
	serverListener := &readinessListener{Listener: listener, ready: ready}
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- app.Listener(serverListener)
	}()
	defer listener.Close()

	select {
	case err := <-serveErr:
		return err
	case <-ready:
	case <-ctx.Done():
		select {
		case err := <-serveErr:
			return err
		case <-ready:
		}
	}

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	shutdownErr := app.ShutdownWithContext(shutdownCtx)
	cancel()
	if shutdownErr != nil {
		return shutdownErr
	}
	return <-serveErr
}

type readinessListener struct {
	net.Listener
	ready chan struct{}
	once  sync.Once
}

func (l *readinessListener) Accept() (net.Conn, error) {
	l.once.Do(func() { close(l.ready) })
	return l.Listener.Accept()
}
