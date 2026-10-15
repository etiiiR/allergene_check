package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// AnalysisClient is shared across requests; its transport reuses connections.
type AnalysisClient struct {
	base string
	http *http.Client
}

func newAnalysisClient() *AnalysisClient {
	return &AnalysisClient{base: envOrDefault("ML_SERVICE_URL", "http://127.0.0.1:8001"), http: &http.Client{Timeout: 20 * time.Second}}
}
func (a *AnalysisClient) post(ctx context.Context, path string, payload any) (json.RawMessage, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", a.base+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.http.Do(req)
	if err != nil {
		return nil, WrapAppError(503, "analysis_unavailable", "Die Analyse ist momentan nicht erreichbar. Deine Einträge bleiben gespeichert.", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		var detail struct {
			Detail string `json:"detail"`
		}
		if json.Unmarshal(data, &detail) == nil && detail.Detail != "" {
			return nil, NewAppError(resp.StatusCode, "analysis_request_rejected", detail.Detail)
		}
		return nil, NewAppError(resp.StatusCode, "analysis_request_rejected", "Die Analyse-Anfrage wurde abgelehnt.")
	}
	if resp.StatusCode != 200 || !json.Valid(data) {
		return nil, NewAppError(503, "analysis_unavailable", "Die Analyse ist momentan nicht verfügbar.")
	}
	return data, nil
}
func analysisPayload(data DiaryData, symptom string, hours int) map[string]any {
	checkins := []Checkin{}
	for _, check := range data.Checkins {
		if !check.MealBaseline {
			checkins = append(checkins, check)
		}
	}
	meals := []map[string]any{}
	for _, m := range data.Meals {
		meals = append(meals, map[string]any{"id": m.ID, "recipe_id": m.RecipeID, "occurred_at": m.OccurredAt, "ingredient_ids": ingredientKeys(m.Ingredients)})
	}
	flags := []map[string]any{}
	for _, flag := range data.RecipeFlags {
		ingredientIDs := []string{}
		for _, recipe := range data.Recipes {
			if recipe.ID == flag.RecipeID {
				ingredientIDs = ingredientKeys(recipe.Ingredients)
				break
			}
		}
		flags = append(flags, map[string]any{"id": flag.ID, "recipe_id": flag.RecipeID, "meal_id": flag.MealID, "kind": flag.Kind, "severity": flag.Severity, "symptoms": flag.Symptoms, "occurred_at": flag.OccurredAt, "ingredient_ids": ingredientIDs})
	}
	return map[string]any{
		"meals": meals, "checkins": checkins, "symptom": symptom, "window_hours": hours,
		"profile_group": data.Profile.BodyGroup, "cycle_enabled": data.Profile.BodyGroup == "female" && data.Profile.CycleTracking,
		"recipe_flags": flags, "stools": data.Stools, "stress_observations": data.Stress,
	}
}
