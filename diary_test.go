package main

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
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

func TestCheckinTimingAndMealReferenceValidation(t *testing.T) {
	c := Checkin{
		OccurredAt:   time.Now().UTC().Format(time.RFC3339),
		Symptoms:     map[string]int{"bloating": 5},
		SleepHours:   8,
		TimingBucket: "mid",
	}
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}

	c.TimingBucket = "not-a-window"
	if c.validate() == nil {
		t.Fatal("invalid timing bucket accepted")
	}

	c.TimingBucket = "mid"
	c.ReferenceMealID = "not-a-uuid"
	if c.validate() == nil {
		t.Fatal("invalid meal reference accepted")
	}
}

func TestProfileSeparatesCycleContext(t *testing.T) {
	p := UserProfile{
		BodyGroup:       "female",
		CycleTracking:   true,
		CycleLengthDays: 28,
		PeriodStart:     "2026-01-01",
	}
	if err := p.validate(); err != nil {
		t.Fatal(err)
	}
	phase, day := inferredCycleContext("2026-01-14T12:00:00Z", p)
	if phase != "ovulation" || day != 14 {
		t.Fatalf("unexpected cycle context: %s, day %d", phase, day)
	}

	p.BodyGroup = "male"
	if err := p.validate(); err != nil {
		t.Fatal(err)
	}
	if p.CycleTracking || p.PeriodStart != "" {
		t.Fatal("cycle data must be cleared outside the female cycle context")
	}
}

func TestRecipeFlagsAndStoolObservationsValidate(t *testing.T) {
	flag := RecipeFlag{RecipeID: uuid.NewString(), Kind: "reaction", Symptoms: map[string]int{"pain": 6}, Severity: 6}
	if err := flag.validate(); err != nil {
		t.Fatal(err)
	}
	flag.Kind = "made-up-kind"
	if flag.validate() == nil {
		t.Fatal("invalid recipe flag accepted")
	}

	stool := StoolObservation{
		ObservedAt:      time.Now().UTC().Format(time.RFC3339),
		ObservedForDate: time.Now().UTC().Format("2006-01-02"),
		Quality:         "formed",
	}
	if err := stool.validate(); err != nil {
		t.Fatal(err)
	}
	stool.Quality = "not-a-quality"
	if stool.validate() == nil {
		t.Fatal("invalid stool quality accepted")
	}
}

func TestStressObservationValidationKeepsRawMetricsSeparate(t *testing.T) {
	value := 7.5
	observation := StressObservation{
		Source: "apple_healthkit", Metric: "stress_score", Value: 75, Unit: "percent",
		NormalizedStress: &value, ObservedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := observation.validate(); err != nil {
		t.Fatal(err)
	}

	raw := StressObservation{
		Source: "android_health_connect", Metric: "hrv", Value: 42, Unit: "ms",
		ObservedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := raw.validate(); err != nil {
		t.Fatal(err)
	}
	raw.Metric = "stress_score"
	if raw.validate() == nil {
		t.Fatal("stress score without an explicit normalized value must be rejected")
	}
	value = 11
	if observation.validate() == nil {
		t.Fatal("normalized stress outside 0-10 must be rejected")
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
	for _, path := range []string{"/", "/diary", "/recipes", "/insights", "/report", "/calendar", "/foods", "/profile"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("X-Inertia", "true")
		req.Header.Set("X-Inertia-Version", fmt.Sprintf("%x", md5.Sum([]byte("development"))))
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
