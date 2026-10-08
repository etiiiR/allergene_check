package main

import (
	"context"
	"embed"
	"log"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	inertia "github.com/romsar/gonertia/v3"
)

//go:embed web/app.gohtml
var webTemplates embed.FS

// The official community Go adapter handles the Inertia protocol. Fiber's
// net/http bridge keeps database/ML services shared with the JSON endpoints.
func registerWeb(app *fiber.App, repo *DiaryRepository) {
	base, err := inertia.NewFromFileFS(webTemplates, "web/app.gohtml", inertia.WithVersion(envOrDefault("ASSET_VERSION", "development")), inertia.WithContainerID("app"))
	if err != nil {
		log.Panicf("initialize Gonertia: %v", err)
	}
	manager, err := inertia.NewVite(base,
		inertia.WithFallbackManifest("web/dist/.vite/manifest.json"),
		// Vite's manifest already contains the "assets/" prefix. The public
		// Fiber route is /assets, so adding another prefix would yield the
		// broken /assets/assets/app.js URL.
		inertia.WithBuildDir("/"),
		inertia.WithEntryPoints("src/main.js"),
	)
	if err != nil {
		log.Panicf("initialize Gonertia Vite integration: %v", err)
	}
	app.Static("/assets", "./web/dist/assets")
	pages := map[string]string{"/": "Dashboard", "/onboarding": "Onboarding", "/diary": "Diary", "/recipes": "Recipes", "/insights": "Insights", "/report": "Report", "/calendar": "Calendar", "/foods": "Foods", "/profile": "Profile"}
	for path, component := range pages {
		path, component := path, component
		app.Get(path, adaptor.HTTPHandler(manager.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			defer cancel()
			vaultRepo := newSurrealVaultRepository(repo.store)
			vault, err := vaultRepo.LoadVault(ctx)
			var loadError string
			if err != nil {
				loadError = "Der verschlüsselte Tresor konnte nicht geladen werden. Bitte prüfe die Datenbank und lade die Seite erneut."
			}
			if err == nil {
				vault.LegacyAvailable, err = vaultRepo.LegacyDataAvailable(ctx)
				if err != nil {
					loadError = "Der Tresorstatus konnte nicht geladen werden. Bitte prüfe die Datenbank und lade die Seite erneut."
				}
			}
			props := map[string]any{"vault": vault, "foods": foods, "symptoms": symptomNames, "allergens": allergenNames, "loadError": loadError}
			if err := manager.Render(w, r, component, inertia.Props(props)); err != nil {
				http.Error(w, "Die Seite konnte nicht geladen werden.", 500)
			}
		}))))
	}
}
