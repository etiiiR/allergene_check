package main

import (
	"context"
	"log"
	"regexp"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// newApp builds the Fiber routes around one shared SurrealDB client.
func newApp(db *surrealdb.DB) *fiber.App {
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	store := NewSurrealStore(db)

	app.Get("/", rootHandler)
	app.Get("/health", healthHandler(store, db != nil))
	registerLiveQueryRoutes(app, store, db != nil)

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

func registerLiveQueryRoutes(app *fiber.App, store *SurrealStore, databaseConfigured bool) {
	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Get("/ws/live/:table", websocket.New(func(conn *websocket.Conn) {
		if !databaseConfigured {
			writeWebSocketError(conn, ErrDatabaseNotConfigured)
			return
		}

		tableName := conn.Params("table")
		if !validTableName(tableName) {
			writeWebSocketError(conn, NewAppError(fiber.StatusBadRequest, ErrorCodeInvalidTable, "invalid table name"))
			return
		}

		diff := conn.Query("diff") == "true"
		subscription, err := store.WatchTable(context.Background(), models.Table(tableName), diff)
		if err != nil {
			writeWebSocketError(conn, WrapAppError(fiber.StatusServiceUnavailable, ErrorCodeLiveQuery, "could not start live query", err))
			return
		}
		defer subscription.Close(context.Background())

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
		go func() {
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					close(clientClosed)
					return
				}
			}
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
