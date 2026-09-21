package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRecipeValidation(t *testing.T) {
	r := Recipe{Title: "Gemüse", Servings: 2, Ingredients: []Ingredient{{Text: "1 Zwiebel", FoodIDs: []string{"onion"}, Allergens: []string{}}}}
	if err := r.validate(); err != nil {
		t.Fatal(err)
	}
	r.Ingredients[0].FoodIDs = []string{"invented-safe-food"}
	if r.validate() == nil {
		t.Fatal("unrecognized food must not receive a fabricated classification")
	}
}
func TestCheckinExplicitNegativeAndConflicts(t *testing.T) {
	c := Checkin{OccurredAt: time.Now().UTC().Format(time.RFC3339), Symptoms: map[string]int{}, SleepHours: 8}
	if c.validate() == nil {
		t.Fatal("missing symptoms cannot silently become symptom-free")
	}
	c.SymptomFree = true
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	c.Symptoms["bloating"] = 5
	if c.validate() == nil {
		t.Fatal("symptom-free contradicts symptoms")
	}
	c.SymptomFree = false
	c.Symptoms["bloating"] = 11
	if c.validate() == nil {
		t.Fatal("out of bounds severity accepted")
	}
}
func TestIngredientKeysPreserveSpicesAndAllergens(t *testing.T) {
	keys := ingredientKeys([]Ingredient{{Text: "Cumin", FoodIDs: []string{"cumin"}, Allergens: []string{"mustard"}}, {Text: " My spice blend ", FoodIDs: []string{}, Allergens: []string{}}})
	set := map[string]bool{}
	for _, k := range keys {
		set[k] = true
	}
	for _, want := range []string{"cumin", "allergen:mustard", "custom:my spice blend"} {
		if !set[want] {
			t.Fatalf("missing %s in %#v", want, keys)
		}
	}
}
func TestInertiaPageProtocolAndSafeRoot(t *testing.T) {
	app := newTestApp()
	for _, path := range []string{"/", "/diary", "/recipes", "/insights", "/foods"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("X-Inertia", "true")
		asset, _ := os.ReadFile("web/dist/assets/app.js")
		req.Header.Set("X-Inertia-Version", fmt.Sprintf("%x", sha256.Sum256(asset)))
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		var page struct {
			Component string         `json:"component"`
			Props     map[string]any `json:"props"`
		}
		if err := json.NewDecoder(res.Body).Decode(&page); err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if page.Component == "" || page.Props["loadError"] == "" {
			t.Fatalf("page missing data/error state: %#v", page)
		}
		if res.Header.Get("X-Inertia") != "true" || !strings.Contains(res.Header.Get("Vary"), "X-Inertia") {
			t.Fatal("missing Inertia protocol headers")
		}
	}
	res, err := app.Test(httptest.NewRequest("GET", "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(b), "/assets/app.js") || !strings.Contains(string(b), "data-page=") {
		t.Fatal("HTML shell missing")
	}
}
func TestDiaryRejectsCrossOriginAndUnconfirmedMutations(t *testing.T) {
	app := newTestApp()
	for _, origin := range []string{"https://attacker.example", ""} {
		req := httptest.NewRequest("POST", "/api/checkins", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
			req.Header.Set("X-Diary-Request", "1")
		}
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 403 {
			t.Fatalf("expected 403, got %d", res.StatusCode)
		}
	}
}

func TestHostGuardAndWebsocketOrigin(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	app.Use(localHostGuard)
	app.Get("/", func(c *fiber.Ctx) error { return c.SendString("ok") })
	for host, want := range map[string]int{"localhost:3000": 200, "127.0.0.1:3000": 200, "rebound.attacker.example": 403} {
		req := httptest.NewRequest("GET", "/", nil)
		req.Host = host
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Fatalf("host %s: got %d", host, res.StatusCode)
		}
	}
	req := httptest.NewRequest("GET", "/ws/live/diary_recipes", nil)
	req.Header.Set("Origin", "https://attacker.example")
	res, err := newTestApp().Test(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("cross-origin WebSocket exposed private diary")
	}
}
