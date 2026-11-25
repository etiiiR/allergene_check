package main

import (
	"context"
	"log"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// newApp builds the Fiber routes around one shared SurrealDB client.
func newApp(db *surrealdb.DB) *fiber.App {
	return newAppWithStore(NewSurrealStore(db))
}

func newAppWithStore(store *SurrealStore) *fiber.App {
	return newAppWithLifecycleContext(store, context.Background())
}

// newAppWithLifecycleContext ties long-lived connections to the process
// lifecycle so shutdown can release them before closing the shared DB client.
func newAppWithLifecycleContext(store *SurrealStore, lifecycleCtx context.Context) *fiber.App {
	if lifecycleCtx == nil {
		lifecycleCtx = context.Background()
	}
	// Match the vault endpoint's explicit ciphertext limit while allowing room
	// for the surrounding JSON request. Individual routes still validate their
	// own payload sizes and shapes.
	app := fiber.New(fiber.Config{
		ErrorHandler:            AppErrorHandler,
		BodyLimit:               maxVaultEnvelopeBytes + (64 << 10),
		ReadTimeout:             15 * time.Second,
		WriteTimeout:            30 * time.Second,
		EnableTrustedProxyCheck: true,
		TrustedProxies:          trustedProxyAddresses(),
		ProxyHeader:             fiber.HeaderXForwardedFor,
		EnableIPValidation:      true,
	})
	app.Use(localSecurityHeaders)
	var account *accountService
	databaseConfigured := store.configured()
	if databaseConfigured {
		app.Use(localHostGuard)
		account = newAccountService(&surrealAccountRepository{store: store}, os.Getenv("ACCOUNT_SETUP_TOKEN"), envOrDefault("APP_URL", "http://localhost:3000"))
	}
	app.Use(accountGateMiddleware(account))

	app.Get("/api/status", rootHandler)
	registerAccountRoutes(app, account)
	repo := &DiaryRepository{store: store}
	registerDiaryAPI(app, repo, newAnalysisClient())
	registerWeb(app, repo, account)
	app.Get("/health", healthHandler(store, databaseConfigured))
	registerLiveQueryRoutes(app, store, databaseConfigured, lifecycleCtx)

	return app
}

func rootHandler(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"message":  "Fiber API is running",
		"database": "SurrealDB",
	})
}

func healthHandler(store *SurrealStore, databaseConfigured bool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		response := fiber.Map{"status": "ok"}
		if !databaseConfigured {
			response["database"] = "not_configured"
			return c.JSON(response)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if _, err := store.Version(ctx); err != nil {
			return WrapAppError(fiber.StatusServiceUnavailable, ErrorCodeDatabaseUnavailable, "SurrealDB is unavailable", err)
		}

		response["database"] = "ok"
		return c.JSON(response)
	}
}

func registerLiveQueryRoutes(app *fiber.App, store *SurrealStore, databaseConfigured bool, lifecycleCtx context.Context) {
	app.Use("/ws", func(c *fiber.Ctx) error {
		if !sameOrigin(c) {
			return NewAppError(403, "origin_rejected", "WebSocket-Verbindung von einer fremden Webseite abgelehnt.")
		}
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Get("/ws/live/:table", websocket.New(func(conn *websocket.Conn) {
		if lifecycleCtx.Err() != nil {
			_ = conn.Close()
			return
		}
		if !databaseConfigured {
			writeWebSocketError(conn, ErrDatabaseNotConfigured)
			return
		}

		tableName := conn.Params("table")
		if !watchableTableName(tableName) {
			writeWebSocketError(conn, NewAppError(fiber.StatusBadRequest, ErrorCodeInvalidTable, "invalid table name"))
			return
		}

		diff := conn.Query("diff") == "true"
		subscription, err := store.WatchTable(lifecycleCtx, models.Table(tableName), diff)
		if err != nil {
			writeWebSocketError(conn, WrapAppError(fiber.StatusServiceUnavailable, ErrorCodeLiveQuery, "could not start live query", err))
			return
		}
		defer func() {
			closeCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := subscription.Close(closeCtx); err != nil {
				log.Printf("websocket subscription cleanup error: %v", err)
			}
		}()

		if err := conn.WriteJSON(fiber.Map{
			"type":  "subscribed",
			"id":    subscription.ID,
			"table": tableName,
			"diff":  diff,
		}); err != nil {
			log.Printf("websocket subscription write error: %v", err)
			return
		}

		clientClosed := make(chan struct{})
		readerDone := make(chan struct{})
		go func() {
			defer close(readerDone)
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					close(clientClosed)
					return
				}
			}
		}()
		defer func() {
			_ = conn.Close()
			<-readerDone
		}()

		for {
			select {
			case notification, ok := <-subscription.Notifications:
				if !ok {
					return
				}
				if err := conn.WriteJSON(fiber.Map{
					"type":   "change",
					"id":     notification.ID,
					"action": notification.Action,
					"result": notification.Result,
				}); err != nil {
					log.Printf("websocket change write error for table %s: %v", tableName, err)
					return
				}
			case <-clientClosed:
				return
			case <-lifecycleCtx.Done():
				return
			}
		}
	}))
}

func writeWebSocketError(conn *websocket.Conn, err error) {
	if writeErr := conn.WriteJSON(ErrorResponseFor(err)); writeErr != nil {
		log.Printf("websocket error: %v", writeErr)
	}
}

var tableNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validTableName(value string) bool {
	return tableNamePattern.MatchString(value)
}

func watchableTableName(value string) bool {
	return validTableName(value) && !strings.HasPrefix(value, "diary_")
}
