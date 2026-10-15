package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestLegacyDiaryRoutesAreBlockedOutsideExplicitMigration(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: AppErrorHandler})
	registerDiaryAPI(app, &DiaryRepository{}, &AnalysisClient{})

	for _, route := range []string{"/api/diary", "/api/export", "/api/patterns"} {
		response, err := app.Test(httptest.NewRequest("GET", route, nil))
		if err != nil || response.StatusCode != 423 {
			t.Fatalf("GET %s status=%v err=%v, want 423", route, response.StatusCode, err)
		}
	}
	request := httptest.NewRequest("POST", "/api/profile", nil)
	request.Header.Set("X-Diary-Request", "1")
	response, err := app.Test(request)
	if err != nil || response.StatusCode != 423 {
		t.Fatalf("POST /api/profile status=%v err=%v, want 423", response.StatusCode, err)
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
