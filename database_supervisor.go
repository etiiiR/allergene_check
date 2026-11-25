package main

import (
	"context"
	"log"
	"time"
)

// superviseDatabase keeps one shared SurrealDB client and replaces it after
// repeated health failures. It never replays a failed write automatically.
func superviseDatabase(ctx context.Context, store *SurrealStore, config appConfig) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		failures := 0
		loggedUnavailable := false

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}

			probeCtx, cancelProbe := context.WithTimeout(ctx, 2*time.Second)
			_, err := store.Version(probeCtx)
			cancelProbe()
			if err == nil {
				failures = 0
				loggedUnavailable = false
				continue
			}
			failures++
			if failures < 2 {
				continue
			}
			if !loggedUnavailable {
				log.Printf("SurrealDB connection is unavailable; attempting recovery")
				loggedUnavailable = true
			}

			connectCtx, cancelConnect := context.WithTimeout(ctx, 5*time.Second)
			client, connectErr := connectDatabase(connectCtx, config)
			cancelConnect()
			if connectErr != nil {
				continue
			}

			previous := store.replaceClient(client)
			if previous != nil {
				closeCtx, cancelClose := context.WithTimeout(context.Background(), 2*time.Second)
				_ = previous.Close(closeCtx)
				cancelClose()
			}
			log.Printf("SurrealDB connection restored")
			failures = 0
			loggedUnavailable = false
		}
	}()
	return done
}
