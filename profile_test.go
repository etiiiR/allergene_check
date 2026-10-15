package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNamedProfileValidation(t *testing.T) {
	for _, tc := range []struct {
		name             string
		completed, valid bool
	}{
		{"", false, true}, // Existing unnamed diaries remain readable.
		{"  Léa  ", true, true},
		{"   ", true, false},
		{strings.Repeat("ä", 80), true, true},
		{strings.Repeat("a", 81), false, false},
		{"first\nlast", false, false},
	} {
		p := defaultProfile()
		p.DisplayName, p.OnboardingCompleted = tc.name, tc.completed
		if err := p.validate(); (err == nil) != tc.valid {
			t.Errorf("profile %q validation = %v", tc.name, err)
		}
		if tc.valid && p.DisplayName != strings.TrimSpace(tc.name) {
			t.Error("name not trimmed")
		}
	}
}

func TestNamedProfileJSONRoundTrip(t *testing.T) {
	original := UserProfile{DisplayName: "Lea", OnboardingCompleted: true, BodyGroup: "female", CycleTracking: true, CycleLengthDays: 28, PeriodStart: "2026-01-01"}
	payload, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var decoded UserProfile
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded != original {
		t.Fatalf("profile changed: %+v", decoded)
	}
	if err := decoded.validate(); err != nil {
		t.Fatal(err)
	}
}
