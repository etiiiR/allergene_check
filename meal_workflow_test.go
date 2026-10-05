package main

import (
	"testing"
	"time"
)

func TestMealGoodMomentRequiresOptInAndDoesNotInventLaterTolerance(t *testing.T) {
	meal := Meal{ID: "test-meal", OccurredAt: time.Now().UTC().Format(time.RFC3339)}
	if mealGoodMoment(meal, false) != nil {
		t.Fatal("legacy API calls must not create check-ins")
	}
	check := mealGoodMoment(meal, true)
	if check == nil || !check.SymptomFree || !check.MealBaseline || check.OccurredAt != meal.OccurredAt || check.ReferenceMealID != meal.ID {
		t.Fatalf("bad baseline: %+v", check)
	}
	check.ID = "baseline"
	explicit := Checkin{ID: "later", OccurredAt: meal.OccurredAt, SymptomFree: true}
	payload := analysisPayload(DiaryData{Checkins: []Checkin{*check, explicit}}, "any", 8)
	got := payload["checkins"].([]Checkin)
	if len(got) != 1 || got[0].ID != "later" {
		t.Fatal("meal default contaminated outcome/stress comparison")
	}
}
