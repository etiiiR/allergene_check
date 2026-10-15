package main

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func editFixture() DiaryData {
	mealID, recipeID := uuid.NewString(), uuid.NewString()
	return DiaryData{
		Recipes:  []Recipe{{ID: recipeID, Title: "New recipe version", Ingredients: []Ingredient{{Text: "Zucker"}}}},
		Meals:    []Meal{{ID: mealID, RecipeID: recipeID, Title: "Original", Ingredients: []Ingredient{{Text: "Salz"}}, OccurredAt: "2026-01-01T12:00:31.125Z", Portions: 1}},
		Checkins: []Checkin{{ID: uuid.NewString(), OccurredAt: "2026-01-01T14:00:31.125Z", Symptoms: map[string]int{"pain": 6, "bloating": 4}, TimingBucket: "mid", ReferenceMealID: mealID, Stress: 3, SleepHours: 7, CyclePhase: "luteal", CycleDay: 19}},
		Stools:   []StoolObservation{{ID: uuid.NewString(), ObservedAt: "2026-01-02T08:00:00Z", ObservedForDate: "2026-01-01", Quality: "hard"}},
		Stress:   []StressObservation{{ID: uuid.NewString(), Source: "generic", Metric: "stress_score", Value: 3, Unit: "score_0_10", NormalizedStress: floatPtr(3), ObservedAt: "2026-01-01T12:00:00Z"}},
	}
}
func floatPtr(value float64) *float64 { return &value }

func TestMealEditPreservesSnapshotAndID(t *testing.T) {
	data := editFixture()
	value, err := prepareDiaryEdit(data, "meals", data.Meals[0].ID, []byte(`{"id":"forged","notes":"corrected","portions":2,"ingredients":[{"text":"forged","food_ids":["onion"]}],"title":"forged"}`))
	if err != nil {
		t.Fatal(err)
	}
	meal := value.(Meal)
	if meal.ID != data.Meals[0].ID || meal.Title != "Original" || meal.Ingredients[0].Text != "Salz" || meal.Portions != 2 || meal.Notes != "corrected" || meal.OccurredAt != data.Meals[0].OccurredAt {
		t.Fatalf("lost historical values: %+v", meal)
	}
	// Even a deleted recipe must not prevent correcting a historical meal.
	data.Recipes = nil
	if _, err := prepareDiaryEdit(data, "meals", meal.ID, []byte(`{"notes":"ok"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestMealEditSwitchesRecipeOnlyExplicitly(t *testing.T) {
	data := editFixture()
	recipe := Recipe{ID: uuid.NewString(), Title: "Replacement", Ingredients: []Ingredient{{Text: "Pfeffer"}}}
	data.Recipes = append(data.Recipes, recipe)
	body, _ := json.Marshal(map[string]any{"recipe_id": recipe.ID})
	value, err := prepareDiaryEdit(data, "meals", data.Meals[0].ID, body)
	if err != nil {
		t.Fatal(err)
	}
	if meal := value.(Meal); meal.Title != recipe.Title || !reflect.DeepEqual(meal.Ingredients, recipe.Ingredients) {
		t.Fatal("new recipe not snapshotted")
	}
	data.RecipeFlags = []RecipeFlag{{MealID: data.Meals[0].ID, RecipeID: data.Meals[0].RecipeID}}
	if _, err := prepareDiaryEdit(data, "meals", data.Meals[0].ID, body); err == nil {
		t.Fatal("reassigned a flagged meal without resolving its flag")
	}
}

func TestCheckinEditPreservesContextAndReplacesSymptoms(t *testing.T) {
	data := editFixture()
	old := data.Checkins[0]
	value, err := prepareDiaryEdit(data, "checkins", old.ID, []byte(`{"notes":"changed"}`))
	if err != nil {
		t.Fatal(err)
	}
	next := value.(Checkin)
	if next.CyclePhase != old.CyclePhase || next.CycleDay != old.CycleDay || next.OccurredAt != old.OccurredAt || !reflect.DeepEqual(next.Symptoms, old.Symptoms) {
		t.Fatal("note edit changed hidden context")
	}
	value, err = prepareDiaryEdit(data, "checkins", old.ID, []byte(`{"symptoms":{"pain":2}}`))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(value.(Checkin).Symptoms, map[string]int{"pain": 2}) || old.Symptoms["pain"] != 6 {
		t.Fatal("symptoms merged or original was mutated")
	}
	value, err = prepareDiaryEdit(data, "checkins", old.ID, []byte(`{"symptom_free":true,"symptoms":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	data.Checkins[0] = value.(Checkin)
	payload := analysisPayload(data, "any", 8)
	encoded, _ := json.Marshal(payload["checkins"])
	var checks []map[string]any
	if err := json.Unmarshal(encoded, &checks); err != nil {
		t.Fatal(err)
	}
	if len(checks) != 1 || checks[0]["symptom_free"] != true {
		t.Fatalf("analysis did not see corrected observation: %s", encoded)
	}
}

func TestBaselineEditDoesNotInventToleranceEvidence(t *testing.T) {
	data := editFixture()
	old := *mealGoodMoment(data.Meals[0], true)
	data.Checkins = []Checkin{old}
	value, err := prepareDiaryEdit(data, "checkins", old.ID, []byte(`{"notes":"typo fixed","meal_baseline":false}`))
	if err != nil {
		t.Fatal(err)
	}
	next := value.(Checkin)
	if !next.MealBaseline || next.ReferenceMealID != old.ReferenceMealID {
		t.Fatal("note edit changed baseline provenance")
	}
	value, err = prepareDiaryEdit(data, "checkins", old.ID, []byte(`{"confirm_observation":true,"stress":3,"sleep_hours":8}`))
	if err != nil {
		t.Fatal(err)
	}
	if value.(Checkin).MealBaseline {
		t.Fatal("explicit observation still excluded")
	}
	value, err = prepareDiaryEdit(data, "checkins", old.ID, []byte(`{"symptom_free":false,"symptoms":{"pain":4},"stress":3,"sleep_hours":8}`))
	if err != nil {
		t.Fatal(err)
	}
	if value.(Checkin).MealBaseline || value.(Checkin).SymptomFree {
		t.Fatal("symptomatic correction still treated as baseline")
	}
	data.Checkins[0] = value.(Checkin)
	checks := analysisPayload(data, "any", 8)["checkins"]
	encoded, _ := json.Marshal(checks)
	if string(encoded) == "[]" {
		t.Fatal("corrected baseline excluded from analysis")
	}
}

func TestStoolAndStressEdits(t *testing.T) {
	data := editFixture()
	value, err := prepareDiaryEdit(data, "stools", data.Stools[0].ID, []byte(`{"quality":"formed","observed_for_date":"2026-01-02"}`))
	if err != nil {
		t.Fatal(err)
	}
	if stool := value.(StoolObservation); stool.Quality != "formed" || stool.ObservedForDate != "2026-01-02" || stool.ID != data.Stools[0].ID {
		t.Fatal(stool)
	}
	value, err = prepareDiaryEdit(data, "stress", data.Stress[0].ID, []byte(`{"value":7.5}`))
	if err != nil {
		t.Fatal(err)
	}
	if stress := value.(StressObservation); stress.Value != 7.5 || *stress.NormalizedStress != 7.5 {
		t.Fatal(stress)
	}
	if *data.Stress[0].NormalizedStress != 3 {
		t.Fatal("mutated original observation")
	}
}

func TestImportedHealthEditsProtectMeasurements(t *testing.T) {
	data := editFixture()
	data.Stress[0].Source, data.Stress[0].ExternalID = "apple_healthkit", "sample-1"
	data.Stress[0].Metric, data.Stress[0].Value, data.Stress[0].Unit = "hrv", 42, "ms"
	data.Stress[0].NormalizedStress = nil
	value, err := prepareDiaryEdit(data, "stress", data.Stress[0].ID, []byte(`{"notes":"after walk"}`))
	if err != nil {
		t.Fatal(err)
	}
	next := value.(StressObservation)
	if next.Notes != "after walk" || next.Value != 42 || next.NormalizedStress != nil {
		t.Fatal(next)
	}
	for _, body := range []string{`{"value":9}`, `{"source":"generic"}`, `{"normalized_stress":5}`, `{"observed_at":"2026-01-02T08:00:00Z"}`} {
		if _, err := prepareDiaryEdit(data, "stress", next.ID, []byte(body)); err == nil {
			t.Fatalf("accepted imported measurement edit: %s", body)
		}
	}
}

func TestDiaryEditRejectsInvalidChanges(t *testing.T) {
	data := editFixture()
	for _, tc := range []struct{ kind, id, body string }{
		{"meals", data.Meals[0].ID, `{"portions":0}`},
		{"meals", data.Meals[0].ID, `{"occurred_at":"bad"}`},
		{"meals", data.Meals[0].ID, `{"recipe_id":"missing"}`},
		{"checkins", data.Checkins[0].ID, `{"symptoms":{"pain":11}}`},
		{"checkins", data.Checkins[0].ID, `{"symptom_free":true}`},
		{"checkins", data.Checkins[0].ID, `{"reference_meal_id":"` + uuid.NewString() + `"}`},
		{"stools", data.Stools[0].ID, `{"quality":"invented"}`},
		{"stress", data.Stress[0].ID, `{"value":11}`},
		{"stress", data.Stress[0].ID, `{"metric":"hrv"}`},
		{"meals", uuid.NewString(), `{}`},
		{"recipes", data.Recipes[0].ID, `{}`},
		{"meals", data.Meals[0].ID, `null`},
		{"meals", data.Meals[0].ID, `[]`},
	} {
		t.Run(tc.kind+tc.body, func(t *testing.T) {
			if _, err := prepareDiaryEdit(data, tc.kind, tc.id, []byte(tc.body)); err == nil {
				t.Fatal("invalid edit accepted")
			}
		})
	}
}
