package main

import (
	"context"
	"crypto/sha256"
	"embed"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	inertia "github.com/petaki/inertia-go"
)

//go:embed web/app.gohtml
var webTemplates embed.FS

// The official community Go adapter handles the Inertia protocol. Fiber's
// net/http bridge keeps database/ML services shared with the JSON endpoints.
func registerWeb(app *fiber.App, repo *DiaryRepository) {
	asset, _ := os.ReadFile("web/dist/assets/app.js")
	manager := inertia.New(envOrDefault("APP_URL", "http://localhost:3000"), "web/app.gohtml", fmt.Sprintf("%x", sha256.Sum256(asset)), webTemplates)
	app.Static("/assets", "./web/dist/assets")
	pages := map[string]string{"/": "Dashboard", "/diary": "Diary", "/recipes": "Recipes", "/insights": "Insights", "/foods": "Foods"}
	for path, component := range pages {
		app.Get(path, adaptor.HTTPHandler(manager.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			defer cancel()
			data, err := repo.load(ctx)
			var loadError string
			if err != nil {
				loadError = "Das Tagebuch konnte nicht geladen werden. Bitte prüfe die Datenbank und lade die Seite erneut."
			}
			props := map[string]any{"diary": data, "foods": foods, "symptoms": symptomNames, "allergens": allergenNames, "loadError": loadError}
			if err := manager.Render(w, r, component, props); err != nil {
				http.Error(w, "Die Seite konnte nicht geladen werden.", 500)
			}
		}))))
	}
}
