package main

import (
	"math"
	"strings"
	"time"
)

// Recipe retains the original ingredient text and user-confirmed canonical IDs.
// Meals snapshot it so later recipe edits never rewrite diary history.
type Recipe struct {
	ID           string       `json:"id"`
	Title        string       `json:"title"`
	Ingredients  []Ingredient `json:"ingredients"`
	Instructions string       `json:"instructions"`
	Servings     int          `json:"servings"`
	CreatedAt    string       `json:"created_at"`
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
	ID          string         `json:"id"`
	OccurredAt  string         `json:"occurred_at"`
	SymptomFree bool           `json:"symptom_free"`
	Symptoms    map[string]int `json:"symptoms"`
	Stress      int            `json:"stress"`
	SleepHours  float64        `json:"sleep_hours"`
	Notes       string         `json:"notes"`
}
type DiaryData struct {
	Recipes  []Recipe  `json:"recipes"`
	Meals    []Meal    `json:"meals"`
	Checkins []Checkin `json:"checkins"`
}

var symptomNames = map[string]string{"bloating": "Blähungen", "pain": "Bauchschmerzen", "nausea": "Übelkeit", "diarrhea": "Durchfall", "constipation": "Verstopfung", "reflux": "Sodbrennen"}
var allergenNames = []string{"gluten", "milk", "egg", "peanut", "tree_nuts", "soy", "sesame", "mustard", "celery", "fish", "crustaceans", "molluscs", "lupin", "sulphites"}

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
	if r.Servings < 1 || r.Servings > 50 || len(r.Instructions) > 15000 {
		return invalid("Portionen oder Zubereitung sind ungültig.")
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
	return nil
}
func (c *Checkin) validate() error {
	if !validTime(c.OccurredAt) || len(c.Notes) > 3000 || c.Stress < 0 || c.Stress > 10 || math.IsNaN(c.SleepHours) || c.SleepHours < 0 || c.SleepHours > 24 {
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
	if c.Symptoms == nil {
		c.Symptoms = map[string]int{}
	}
	return nil
}
