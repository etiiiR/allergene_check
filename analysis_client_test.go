package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestAnalysisClientPropagatesValidationMessages(t *testing.T) {
	client := &AnalysisClient{
		base: "http://analysis.test",
		http: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusUnprocessableEntity,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"detail":"Lokale oder interne Adressen sind nicht erlaubt."}`)),
			}, nil
		})},
	}
	_, err := client.post(context.Background(), "/diary/scrape", map[string]string{"url": "http://localhost"})
	var appErr *AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("expected AppError, got %v", err)
	}
	if appErr.Status != http.StatusUnprocessableEntity || appErr.Code != "analysis_request_rejected" || appErr.Message == "" {
		t.Fatalf("unexpected propagated error: %#v", appErr)
	}
}

func TestRecipeSourceValidation(t *testing.T) {
	recipe := Recipe{
		Title:     "Suppe",
		Servings:  2,
		SourceURL: "javascript:alert(1)",
		Ingredients: []Ingredient{{
			Text: "Kartoffel",
		}},
	}
	if recipe.validate() == nil {
		t.Fatal("non-http recipe source must be rejected")
	}
}
