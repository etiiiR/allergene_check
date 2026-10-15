package main

import (
	"math"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Recipe retains the original ingredient text and user-confirmed canonical IDs.
// Meals snapshot it so later recipe edits never rewrite diary history.
type Recipe struct {
	// Derived on read; consumers must not recreate raw-text analysis keys.
	AnalysisIngredientIDs []string     `json:"analysis_ingredient_ids,omitempty"`
	ID                    string       `json:"id"`
	Title                 string       `json:"title"`
	Ingredients           []Ingredient `json:"ingredients"`
	Instructions          string       `json:"instructions"`
	Servings              int          `json:"servings"`
	SourceURL             string       `json:"source_url,omitempty"`
	CreatedAt             string       `json:"created_at"`
}
type Ingredient struct {
	Text      string   `json:"text"`
	FoodIDs   []string `json:"food_ids"`
	Allergens []string `json:"allergens"`
}
type Meal struct {
	ID          string       `json:"id"`
	RecipeID    string       `json:"recipe_id"`
	Title       string       `json:"title"`
	Ingredients []Ingredient `json:"ingredients"`
	OccurredAt  string       `json:"occurred_at"`
	Portions    float64      `json:"portions"`
	Notes       string       `json:"notes"`
}
type Checkin struct {
	// A meal-time baseline is not evidence of later food tolerance. It is shown
	// in the diary but excluded from food/stress modelling (no context measured).
	MealBaseline    bool           `json:"meal_baseline,omitempty"`
	ID              string         `json:"id"`
	OccurredAt      string         `json:"occurred_at"`
	SymptomFree     bool           `json:"symptom_free"`
	Symptoms        map[string]int `json:"symptoms"`
	TimingBucket    string         `json:"timing_bucket,omitempty"`
	FoodRelation    string         `json:"food_relation,omitempty"`
	ReferenceMealID string         `json:"reference_meal_id,omitempty"`
	CyclePhase      string         `json:"cycle_phase,omitempty"`
	CycleDay        int            `json:"cycle_day,omitempty"`
	Stress          int            `json:"stress"`
	SleepHours      float64        `json:"sleep_hours"`
	Notes           string         `json:"notes"`
}
type RecipeFlag struct {
	ID         string         `json:"id"`
	RecipeID   string         `json:"recipe_id"`
	MealID     string         `json:"meal_id,omitempty"`
	Kind       string         `json:"kind"`
	OccurredAt string         `json:"occurred_at,omitempty"`
	Symptoms   map[string]int `json:"symptoms,omitempty"`
	Severity   int            `json:"severity"`
	Notes      string         `json:"notes,omitempty"`
}
type StoolObservation struct {
	ID              string `json:"id"`
	ObservedAt      string `json:"observed_at"`
	ObservedForDate string `json:"observed_for_date"`
	Quality         string `json:"quality"`
	Notes           string `json:"notes,omitempty"`
}

// StressObservation is the app's provider-neutral health import contract.
// Only an explicitly supplied normalized_stress score is used as a stress
// covariate. Raw HRV and heart-rate samples are retained for review but are
// never guessed into a stress score by the server.
type StressObservation struct {
	ID               string   `json:"id"`
	Source           string   `json:"source"`
	ExternalID       string   `json:"external_id,omitempty"`
	Metric           string   `json:"metric"`
	Value            float64  `json:"value"`
	Unit             string   `json:"unit"`
	NormalizedStress *float64 `json:"normalized_stress,omitempty"`
	ObservedAt       string   `json:"observed_at"`
	ObservedUntil    string   `json:"observed_until,omitempty"`
	Notes            string   `json:"notes,omitempty"`
}
type HealthImportRequest struct {
	Source  string              `json:"source"`
	Records []StressObservation `json:"records"`
}
type UserProfile struct {
	// DisplayName identifies the owner of this local diary, not an authenticated account.
	DisplayName         string `json:"display_name"`
	OnboardingCompleted bool   `json:"onboarding_completed"`
	BodyGroup           string `json:"body_group"`
	CycleTracking       bool   `json:"cycle_tracking"`
	CycleLengthDays     int    `json:"cycle_length_days"`
	PeriodStart         string `json:"period_start,omitempty"`
}
type DiaryData struct {
	Recipes     []Recipe            `json:"recipes"`
	Meals       []Meal              `json:"meals"`
	Checkins    []Checkin           `json:"checkins"`
	Profile     UserProfile         `json:"profile"`
	RecipeFlags []RecipeFlag        `json:"recipe_flags"`
	Stools      []StoolObservation  `json:"stools"`
	Stress      []StressObservation `json:"stress_observations"`
}

var symptomNames = map[string]string{"bloating": "Blähungen", "pain": "Bauchschmerzen", "nausea": "Übelkeit", "diarrhea": "Durchfall", "constipation": "Verstopfung", "reflux": "Sodbrennen"}
var allergenNames = []string{"gluten", "milk", "egg", "peanut", "tree_nuts", "soy", "sesame", "mustard", "celery", "fish", "crustaceans", "molluscs", "lupin", "sulphites"}
var timingBuckets = map[string]string{"immediate": "Direkt nach dem Essen", "early": "30 Minuten bis 2 Stunden", "mid": "2 bis 6 Stunden", "late": "6 bis 24 Stunden / Folgetag", "unknown": "Zeitpunkt unklar"}
var bodyGroups = map[string]string{"unspecified": "Nicht angegeben", "male": "Männlicher Körperkontext", "female": "Weiblicher Körperkontext", "other": "Anderer Körperkontext"}
var cyclePhases = map[string]string{"menstruation": "Menstruation", "follicular": "Follikelphase", "ovulation": "Ovulationsfenster", "luteal": "Lutealphase", "unknown": "Nicht zugeordnet"}
var recipeFlagKinds = map[string]string{"suspected": "Rezept unter Verdacht", "reaction": "Manuell als Reaktion markiert"}
var stoolQualities = map[string]string{"formed": "Gut geformt", "hard": "Hart / schwer", "soft": "Weich", "watery": "Wässrig", "mixed": "Unterschiedlich", "no_stool": "Kein Stuhl", "unknown": "Nicht sicher"}
var healthSources = map[string]string{"apple_healthkit": "Apple Health / HealthKit", "android_health_connect": "Android Health Connect", "oura": "Oura / Ring", "ring": "Ring", "watch": "Watch", "generic": "Andere normalisierte Quelle"}
var healthMetrics = map[string]string{"stress_score": "Stress-Score", "hrv": "Herzratenvariabilität", "heart_rate": "Herzfrequenz", "resting_heart_rate": "Ruhepuls", "sleep_score": "Schlaf-Score", "readiness_score": "Readiness-Score"}

func invalid(message string) error { return NewAppError(422, "validation_error", message) }
func validTime(value string) bool {
	t, err := time.Parse(time.RFC3339, value)
	return err == nil && !t.After(time.Now().Add(5*time.Minute)) && t.Year() >= 2000
}
func (r *Recipe) validate() error {
	r.Title = strings.TrimSpace(r.Title)
	if len(r.Title) < 1 || len(r.Title) > 160 {
		return invalid("Bitte einen Rezeptnamen mit maximal 160 Zeichen eingeben.")
	}
	if r.Servings < 1 || r.Servings > 50 || len(r.Instructions) > 15000 || len(r.SourceURL) > 2048 {
		return invalid("Portionen oder Zubereitung sind ungültig.")
	}
	if r.SourceURL != "" {
		parsed, err := url.ParseRequestURI(r.SourceURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
			return invalid("Die Rezeptquelle muss eine gültige HTTP- oder HTTPS-Adresse sein.")
		}
	}
	if len(r.Ingredients) < 1 || len(r.Ingredients) > 100 {
		return invalid("Bitte 1 bis 100 Zutaten eingeben.")
	}
	for i := range r.Ingredients {
		in := &r.Ingredients[i]
		if in.FoodIDs == nil {
			in.FoodIDs = []string{}
		}
		if in.Allergens == nil {
			in.Allergens = []string{}
		}
		in.Text = strings.TrimSpace(in.Text)
		if len(in.Text) < 1 || len(in.Text) > 500 || len(in.FoodIDs) > 10 || len(in.Allergens) > 14 {
			return invalid("Eine Zutat ist ungültig.")
		}
		for _, id := range in.FoodIDs {
			if _, ok := foodByID[id]; !ok {
				return invalid("Unbekannte Lebensmittel-Zuordnung.")
			}
		}
		for _, a := range in.Allergens {
			found := false
			for _, allowed := range allergenNames {
				if a == allowed {
					found = true
				}
			}
			if !found {
				return invalid("Unbekanntes Allergen.")
			}
		}
	}
	r.AnalysisIngredientIDs = ingredientKeys(r.Ingredients)
	return nil
}
func (c *Checkin) validate() error {
	if !validTime(c.OccurredAt) || len(c.Notes) > 3000 || c.Stress < 0 || c.Stress > 10 || math.IsNaN(c.SleepHours) || c.SleepHours < 0 || c.SleepHours > 24 || c.CycleDay < 0 || c.CycleDay > 45 {
		return invalid("Zeitpunkt, Schlaf, Stress oder Notiz sind ungültig.")
	}
	total := 0
	for key, v := range c.Symptoms {
		if _, ok := symptomNames[key]; !ok || v < 0 || v > 10 {
			return invalid("Symptome müssen zwischen 0 und 10 liegen.")
		}
		total += v
	}
	if c.SymptomFree && total != 0 {
		return invalid("Symptomfrei und Beschwerden können nicht gleichzeitig gespeichert werden.")
	}
	if !c.SymptomFree && total == 0 {
		return invalid("Bitte Beschwerden eintragen oder ausdrücklich symptomfrei wählen.")
	}
	if c.SymptomFree {
		c.TimingBucket = ""
		c.ReferenceMealID = ""
	} else {
		if c.FoodRelation == "" {
			c.FoodRelation = "timed_window"
		}
		if c.FoodRelation != "timed_window" && c.FoodRelation != "none" {
			return invalid("Bitte einen gültigen Essensbezug wählen.")
		}
		if c.TimingBucket == "" {
			c.TimingBucket = "unknown"
		}
		if _, ok := timingBuckets[c.TimingBucket]; !ok {
			return invalid("Bitte ein gültiges Beschwerde-Zeitfenster wählen.")
		}
		if c.ReferenceMealID != "" {
			if _, err := uuid.Parse(c.ReferenceMealID); err != nil {
				return invalid("Die zugeordnete Mahlzeit ist ungültig.")
			}
		}
	}
	if c.CyclePhase == "" {
		c.CyclePhase = "unknown"
	}
	if _, ok := cyclePhases[c.CyclePhase]; !ok {
		return invalid("Bitte eine gültige Zyklusphase wählen.")
	}
	if c.Symptoms == nil {
		c.Symptoms = map[string]int{}
	}
	return nil
}

func (f *RecipeFlag) validate() error {
	if _, err := uuid.Parse(f.RecipeID); err != nil {
		return invalid("Das markierte Rezept ist ungültig.")
	}
	if f.MealID != "" {
		if _, err := uuid.Parse(f.MealID); err != nil {
			return invalid("Die markierte Mahlzeit ist ungültig.")
		}
	}
	if _, ok := recipeFlagKinds[f.Kind]; !ok || f.Severity < 0 || f.Severity > 10 || len(f.Notes) > 1500 {
		return invalid("Die Rezeptmarkierung ist ungültig.")
	}
	if f.OccurredAt != "" && !validTime(f.OccurredAt) {
		return invalid("Der Zeitpunkt der Rezeptmarkierung ist ungültig.")
	}
	total := 0
	for key, value := range f.Symptoms {
		if _, ok := symptomNames[key]; !ok || value < 0 || value > 10 {
			return invalid("Die markierten Symptome müssen zwischen 0 und 10 liegen.")
		}
		total += value
	}
	if f.Kind == "reaction" && total == 0 && f.Severity == 0 {
		return invalid("Bitte mindestens ein Symptom oder eine Stärke angeben.")
	}
	if f.Symptoms == nil {
		f.Symptoms = map[string]int{}
	}
	return nil
}

func (s *StoolObservation) validate() error {
	if !validTime(s.ObservedAt) || len(s.Notes) > 1000 {
		return invalid("Der Zeitpunkt oder die Notiz der Stuhlbeobachtung ist ungültig.")
	}
	date, err := time.Parse("2006-01-02", s.ObservedForDate)
	if err != nil || date.After(time.Now().UTC().Truncate(24*time.Hour).Add(24*time.Hour)) || date.Year() < 2000 {
		return invalid("Der Beobachtungstag ist ungültig.")
	}
	if _, ok := stoolQualities[s.Quality]; !ok {
		return invalid("Bitte eine gültige Stuhlbeobachtung wählen.")
	}
	return nil
}

func (s *StressObservation) validate() error {
	if _, ok := healthSources[s.Source]; !ok {
		return invalid("Quelle oder Messart der Gesundheitsmessung ist ungültig.")
	}
	if _, ok := healthMetrics[s.Metric]; !ok {
		return invalid("Quelle oder Messart der Gesundheitsmessung ist ungültig.")
	}
	if len(s.ExternalID) > 300 || len(s.Unit) > 64 || len(s.Notes) > 1000 || math.IsNaN(s.Value) || math.IsInf(s.Value, 0) {
		return invalid("Die Gesundheitsmessung enthält ungültige Werte.")
	}
	if !validTime(s.ObservedAt) {
		return invalid("Der Zeitpunkt der Gesundheitsmessung ist ungültig.")
	}
	if s.ObservedUntil != "" {
		if !validTime(s.ObservedUntil) {
			return invalid("Das Ende der Gesundheitsmessung ist ungültig.")
		}
		start, _ := time.Parse(time.RFC3339, s.ObservedAt)
		end, _ := time.Parse(time.RFC3339, s.ObservedUntil)
		if end.Before(start) {
			return invalid("Das Ende der Gesundheitsmessung liegt vor ihrem Beginn.")
		}
	}
	if s.Metric == "stress_score" && s.NormalizedStress == nil {
		return invalid("Ein Stress-Score muss zusätzlich als normalized_stress zwischen 0 und 10 angegeben werden.")
	}
	if s.NormalizedStress != nil && (math.IsNaN(*s.NormalizedStress) || math.IsInf(*s.NormalizedStress, 0) || *s.NormalizedStress < 0 || *s.NormalizedStress > 10) {
		return invalid("normalized_stress muss zwischen 0 und 10 liegen.")
	}
	return nil
}

func defaultProfile() UserProfile {
	return UserProfile{BodyGroup: "unspecified", CycleLengthDays: 28}
}

func (p *UserProfile) validate() error {
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	if utf8.RuneCountInString(p.DisplayName) > 80 || strings.ContainsAny(p.DisplayName, "\r\n\t") {
		return invalid("Bitte einen Namen mit maximal 80 Zeichen ohne Zeilenumbrüche eingeben.")
	}
	if p.OnboardingCompleted && p.DisplayName == "" {
		return invalid("Bitte einen Namen für die Person eingeben.")
	}
	if p.BodyGroup == "" {
		p.BodyGroup = "unspecified"
	}
	if _, ok := bodyGroups[p.BodyGroup]; !ok {
		return invalid("Bitte einen gültigen Körperkontext wählen.")
	}
	if p.CycleLengthDays == 0 {
		p.CycleLengthDays = 28
	}
	if p.CycleLengthDays < 21 || p.CycleLengthDays > 45 {
		return invalid("Die angenommene Zykluslänge muss zwischen 21 und 45 Tagen liegen.")
	}
	if p.PeriodStart != "" {
		start, err := time.Parse("2006-01-02", p.PeriodStart)
		if err != nil || start.After(time.Now().UTC().Truncate(24*time.Hour)) {
			return invalid("Der Beginn der letzten Periode ist ungültig.")
		}
	}
	if p.BodyGroup != "female" || !p.CycleTracking {
		p.CycleTracking = false
		p.PeriodStart = ""
	}
	return nil
}

func inferredCycleContext(occurredAt string, profile UserProfile) (string, int) {
	if profile.BodyGroup != "female" || !profile.CycleTracking || profile.PeriodStart == "" || profile.CycleLengthDays < 21 {
		return "unknown", 0
	}
	start, err := time.Parse("2006-01-02", profile.PeriodStart)
	when, timeErr := time.Parse(time.RFC3339, occurredAt)
	if err != nil || timeErr != nil {
		return "unknown", 0
	}
	calendarDay := int(when.UTC().Sub(start.UTC()).Hours()/24) + 1
	if calendarDay < 1 {
		return "unknown", 0
	}
	cycleDay := ((calendarDay - 1) % profile.CycleLengthDays) + 1
	switch {
	case cycleDay <= 5:
		return "menstruation", cycleDay
	case cycleDay <= 13:
		return "follicular", cycleDay
	case cycleDay == 14:
		return "ovulation", cycleDay
	default:
		return "luteal", cycleDay
	}
}
