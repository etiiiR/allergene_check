package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

func main() {
	config := loadConfig()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := connectDatabase(ctx, config)
	if err != nil {
		log.Fatalf("connect to SurrealDB: %v", err)
	}
	defer db.Close(context.Background())

	app := newApp(db)

	log.Printf("server listening on http://localhost:%s", config.port)
	if err := app.Listen(":" + config.port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

type appConfig struct {
	port      string
	dbURL     string
	namespace string
	database  string
	username  string
	password  string
}

func loadConfig() appConfig {
	return appConfig{
		port:      envOrDefault("PORT", "3000"),
		dbURL:     envOrDefault("SURREALDB_URL", "ws://localhost:8000/rpc"),
		namespace: envOrDefault("SURREALDB_NAMESPACE", "main"),
		database:  envOrDefault("SURREALDB_DATABASE", "main"),
		username:  envOrDefault("SURREALDB_USER", "root"),
		password:  envOrDefault("SURREALDB_PASS", "root"),
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func connectDatabase(ctx context.Context, config appConfig) (*surrealdb.DB, error) {
	db, err := surrealdb.FromEndpointURLString(ctx, config.dbURL)
	if err != nil {
		return nil, err
	}

	if err := db.Use(ctx, config.namespace, config.database); err != nil {
		_ = db.Close(context.Background())
		return nil, err
	}

	if _, err := db.SignIn(ctx, surrealdb.Auth{
		Username: config.username,
		Password: config.password,
	}); err != nil {
		_ = db.Close(context.Background())
		return nil, err
	}

	return db, nil
}

func newApp(db *surrealdb.DB) *fiber.App {
	app := fiber.New()
	store := NewSurrealStore(db)

	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"message":  "Fiber API is running",
			"database": "SurrealDB",
		})
	})

	app.Get("/health", func(c *fiber.Ctx) error {
		response := fiber.Map{
			"status": "ok",
		}

		if db == nil {
			response["database"] = "not_configured"
			return c.JSON(response)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if _, err := store.Version(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status":   "degraded",
				"database": "unavailable",
				"error":    err.Error(),
			})
		}

		response["database"] = "ok"
		return c.JSON(response)
	})

	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Get("/ws/live/:table", websocket.New(func(conn *websocket.Conn) {
		if db == nil {
			_ = conn.WriteJSON(fiber.Map{"error": "SurrealDB is not configured"})
			return
		}

		tableName := conn.Params("table")
		if !validTableName(tableName) {
			_ = conn.WriteJSON(fiber.Map{"error": "invalid table name"})
			return
		}

		diff := conn.Query("diff") == "true"
		subscription, err := store.WatchTable(context.Background(), models.Table(tableName), diff)
		if err != nil {
			_ = conn.WriteJSON(fiber.Map{"error": err.Error()})
			return
		}
		defer subscription.Close(context.Background())

		_ = conn.WriteJSON(fiber.Map{
			"type":  "subscribed",
			"id":    subscription.ID,
			"table": tableName,
			"diff":  diff,
		})

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
					return
				}
			case <-clientClosed:
				return
			}
		}
	}))

	return app
}

var tableNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validTableName(value string) bool {
	return tableNamePattern.MatchString(value)
}
