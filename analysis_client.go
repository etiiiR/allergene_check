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
	if resp.StatusCode != 200 || !json.Valid(data) {
		return nil, NewAppError(503, "analysis_unavailable", "Die Analyse ist momentan nicht verfügbar.")
	}
	return data, nil
}
func analysisPayload(data DiaryData, symptom string, hours int) map[string]any {
	meals := []map[string]any{}
	for _, m := range data.Meals {
		meals = append(meals, map[string]any{"occurred_at": m.OccurredAt, "ingredient_ids": ingredientKeys(m.Ingredients)})
	}
	return map[string]any{"meals": meals, "checkins": data.Checkins, "symptom": symptom, "window_hours": hours}
}
