package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestPersonalDiaryRoutesRequireTheEncryptedVault(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	registerDiaryAPI(app, &DiaryRepository{}, &AnalysisClient{})

	routes := []struct {
		method string
		path   string
	}{
		{method: "GET", path: "/api/diary"},
		{method: "GET", path: "/api/export"},
		{method: "GET", path: "/api/patterns"},
		{method: "PUT", path: "/api/profile"},
		{method: "POST", path: "/api/ingredients/analyze"},
		{method: "POST", path: "/api/recipe-flags"},
		{method: "POST", path: "/api/stools"},
		{method: "POST", path: "/api/stress"},
		{method: "POST", path: "/api/health/import"},
		{method: "POST", path: "/api/recipes"},
		{method: "PUT", path: "/api/recipes/00000000-0000-4000-8000-000000000001"},
		{method: "POST", path: "/api/meals"},
		{method: "POST", path: "/api/checkins"},
		{method: "DELETE", path: "/api/meals/00000000-0000-4000-8000-000000000001"},
	}
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, route.path, nil)
			if route.method != "GET" {
				request.Header.Set("X-Diary-Request", "1")
			}
			response, err := app.Test(request)
			if err != nil || response.StatusCode != 423 {
				t.Fatalf("status=%v err=%v, want 423 encrypted_vault_required", response.StatusCode, err)
			}
			response.Body.Close()
		})
	}

	legacy, err := app.Test(httptest.NewRequest("GET", "/api/legacy/diary", nil))
	if err != nil || legacy.StatusCode != 403 {
		t.Fatalf("unconfirmed legacy migration status=%v err=%v, want 403", legacy.StatusCode, err)
	}
	importRequest := httptest.NewRequest("GET", "/api/legacy/diary", nil)
	importRequest.Header.Set("X-Encrypted-Migration", "1")
	importResponse, err := app.Test(importRequest)
	if err != nil || importResponse.StatusCode == 423 {
		t.Fatalf("explicit migration route should reach the guarded repository, status=%v err=%v", importResponse.StatusCode, err)
	}
}
