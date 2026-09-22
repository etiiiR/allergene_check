package main

import (
	"context"
	"encoding/json"
	"time"
	_ "time/tzdata"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// registerDiaryAPI exposes a local personal diary. Same-origin JSON requests
// prevent a third-party site from silently changing sensitive diary records.
func registerDiaryAPI(app *fiber.App, repo *DiaryRepository, analysis *AnalysisClient) {
	api := app.Group("/api")
	api.Use(func(c *fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.UserContext(), 25*time.Second)
		defer cancel()
		c.SetUserContext(ctx)
		c.Set("Cache-Control", "no-store")
		if !sameOrigin(c) {
			return NewAppError(403, "origin_rejected", "Diese Anfrage stammt von einer anderen Webseite.")
		}
		if c.Method() != "GET" && c.Get("X-Diary-Request") != "1" {
			return NewAppError(403, "request_rejected", "Die Anfrage konnte nicht bestätigt werden.")
		}
		return c.Next()
	})
	api.Get("/diary", func(c *fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.UserContext(), 10*time.Second)
		defer cancel()
		data, err := repo.load(ctx)
		if err != nil {
			return err
		}
		return c.JSON(data)
	})
	api.Get("/export", func(c *fiber.Ctx) error {
		data, err := repo.load(c.UserContext())
		if err != nil {
			return err
		}
		c.Set("Content-Disposition", "attachment; filename=bauchgefuehl-tagebuch.json")
		return c.JSON(data)
	})
	api.Put("/profile", func(c *fiber.Ctx) error {
		var profile UserProfile
		if err := c.BodyParser(&profile); err != nil {
			return invalid("Ungültiges Profil.")
		}
		if err := profile.validate(); err != nil {
			return err
		}
		if err := repo.saveProfile(c.UserContext(), profile); err != nil {
			return err
		}
		return c.JSON(profile)
	})
	api.Post("/ingredients/analyze", func(c *fiber.Ctx) error {
		var req struct {
			Lines []string `json:"lines"`
		}
		if err := c.BodyParser(&req); err != nil {
			return invalid("Ungültige Zutatenliste.")
		}
		if len(req.Lines) < 1 || len(req.Lines) > 100 {
			return invalid("Bitte 1 bis 100 Zutaten eingeben.")
		}
		for _, l := range req.Lines {
			if len(l) > 500 {
				return invalid("Eine Zutatenzeile ist zu lang.")
			}
		}
		data, err := analysis.post(c.UserContext(), "/diary/ingredients", req)
		if err != nil {
			return err
		}
		return c.Type("json").Send(data)
	})
	api.Post("/recipes/import", func(c *fiber.Ctx) error {
		var req struct {
			URL string `json:"url"`
		}
		if err := c.BodyParser(&req); err != nil || len(req.URL) < 1 || len(req.URL) > 2048 {
			return invalid("Bitte eine gültige Rezept-Adresse eingeben.")
		}
		data, err := analysis.post(c.UserContext(), "/diary/scrape", req)
		if err != nil {
			return err
		}
		return c.Type("json").Send(data)
	})
	api.Post("/recipe-flags", func(c *fiber.Ctx) error {
		var flag RecipeFlag
		if err := c.BodyParser(&flag); err != nil {
			return invalid("Ungültige Rezeptmarkierung.")
		}
		if err := flag.validate(); err != nil {
			return err
		}
		data, err := repo.load(c.UserContext())
		if err != nil {
			return err
		}
		foundRecipe := false
		for _, recipe := range data.Recipes {
			if recipe.ID == flag.RecipeID {
				foundRecipe = true
				break
			}
		}
		if !foundRecipe {
			return invalid("Das markierte Rezept wurde nicht gefunden.")
		}
		if flag.MealID != "" {
			foundMeal := false
			for _, meal := range data.Meals {
				if meal.ID == flag.MealID && meal.RecipeID == flag.RecipeID {
					foundMeal = true
					if flag.OccurredAt == "" {
						flag.OccurredAt = meal.OccurredAt
					}
					break
				}
			}
			if !foundMeal {
				return invalid("Die markierte Mahlzeit gehört nicht zu diesem Rezept.")
			}
		}
		flag.ID = uuid.NewString()
		if err := repo.save(c.UserContext(), "recipe_flags", flag.ID, flag); err != nil {
			return err
		}
		return c.Status(201).JSON(flag)
	})
	api.Post("/stools", func(c *fiber.Ctx) error {
		var stool StoolObservation
		if err := c.BodyParser(&stool); err != nil {
			return invalid("Ungültige Stuhlbeobachtung.")
		}
		if err := stool.validate(); err != nil {
			return err
		}
		stool.ID = uuid.NewString()
		if err := repo.save(c.UserContext(), "stools", stool.ID, stool); err != nil {
			return err
		}
		return c.Status(201).JSON(stool)
	})
	api.Post("/stress", func(c *fiber.Ctx) error {
		var observation StressObservation
		if err := c.BodyParser(&observation); err != nil {
			return invalid("Ungültige Gesundheitsmessung.")
		}
		if err := observation.validate(); err != nil {
			return err
		}
		observation.ID = uuid.NewString()
		if err := repo.save(c.UserContext(), "stress", observation.ID, observation); err != nil {
			return err
		}
		return c.Status(201).JSON(observation)
	})
	api.Post("/health/import", func(c *fiber.Ctx) error {
		var request HealthImportRequest
		if err := c.BodyParser(&request); err != nil || len(request.Records) == 0 || len(request.Records) > 10000 {
			return invalid("Bitte 1 bis 10000 Gesundheitsmessungen importieren.")
		}
		if request.Source != "" {
			if _, ok := healthSources[request.Source]; !ok {
				return invalid("Die Gesundheitsquelle ist nicht bekannt.")
			}
		}
		data, err := repo.load(c.UserContext())
		if err != nil {
			return err
		}
		existing := map[string]string{}
		for _, old := range data.Stress {
			if old.Source != "" && old.ExternalID != "" {
				existing[old.Source+"\x00"+old.ExternalID] = old.ID
			}
		}
		imported, updated := 0, 0
		stored := make([]StressObservation, 0, len(request.Records))
		for i := range request.Records {
			observation := request.Records[i]
			if observation.Source == "" {
				observation.Source = request.Source
			} else if request.Source != "" && observation.Source != request.Source {
				return invalid("Eine Messung gehört zu einer anderen Quelle als der Import.")
			}
			if err := observation.validate(); err != nil {
				return err
			}
			key := observation.Source + "\x00" + observation.ExternalID
			if observation.ExternalID != "" {
				if oldID, ok := existing[key]; ok {
					observation.ID = oldID
					updated++
				} else {
					observation.ID = uuid.NewString()
					imported++
				}
			} else {
				observation.ID = uuid.NewString()
				imported++
			}
			if err := repo.save(c.UserContext(), "stress", observation.ID, observation); err != nil {
				return err
			}
			stored = append(stored, observation)
		}
		return c.JSON(fiber.Map{"imported": imported, "updated": updated, "records": stored})
	})
	api.Get("/patterns", func(c *fiber.Ctx) error {
		symptom := c.Query("symptom", "any")
		if _, ok := symptomNames[symptom]; !ok && symptom != "any" {
			return invalid("Unbekanntes Symptom.")
		}
		hours := c.QueryInt("hours", 8)
		if hours < 1 || hours > 24 {
			return invalid("Zeitfenster muss zwischen 1 und 24 Stunden liegen.")
		}
		data, err := repo.load(c.UserContext())
		if err != nil {
			return err
		}
		zone := c.Query("timezone", envOrDefault("DIARY_TIMEZONE", "Europe/Zurich"))
		if _, err := time.LoadLocation(zone); err != nil {
			return invalid("Unbekannte Zeitzone.")
		}
		payload := analysisPayload(data, symptom, hours)
		payload["timezone"] = zone
		result, err := analysis.post(c.UserContext(), "/diary/patterns", payload)
		if err != nil {
			return err
		}
		return c.Type("json").Send(result)
	})
	for _, method := range []string{"POST", "PUT"} {
		path := "/recipes"
		if method == "PUT" {
			path += "/:id"
		}
		api.Add(method, path, func(c *fiber.Ctx) error {
			var recipe Recipe
			if err := c.BodyParser(&recipe); err != nil {
				return invalid("Ungültiges Rezept.")
			}
			if err := recipe.validate(); err != nil {
				return err
			}
			recipe.ID = uuid.NewString()
			recipe.CreatedAt = time.Now().UTC().Format(time.RFC3339)
			if c.Method() == "PUT" {
				id := c.Params("id")
				if _, err := uuid.Parse(id); err != nil {
					return fiber.ErrNotFound
				}
				data, err := repo.load(c.UserContext())
				if err != nil {
					return err
				}
				found := false
				for _, old := range data.Recipes {
					if old.ID == id {
						found = true
						recipe.ID = id
						recipe.CreatedAt = old.CreatedAt
					}
				}
				if !found {
					return fiber.ErrNotFound
				}
			}
			if err := repo.save(c.UserContext(), "recipes", recipe.ID, recipe); err != nil {
				return err
			}
			return c.Status(201).JSON(recipe)
		})
	}
	api.Post("/meals", func(c *fiber.Ctx) error {
		var meal Meal
		if err := c.BodyParser(&meal); err != nil {
			return invalid("Ungültiger Eintrag.")
		}
		if !validTime(meal.OccurredAt) || meal.Portions <= 0 || meal.Portions > 20 || len(meal.Notes) > 3000 {
			return invalid("Zeitpunkt, Portionen oder Notiz sind ungültig.")
		}
		data, err := repo.load(c.UserContext())
		if err != nil {
			return err
		}
		found := false
		for _, r := range data.Recipes {
			if r.ID == meal.RecipeID {
				meal.Title = r.Title
				meal.Ingredients = r.Ingredients
				found = true
				break
			}
		}
		if !found {
			return invalid("Bitte ein gespeichertes Rezept wählen.")
		}
		meal.ID = uuid.NewString()
		if err := repo.save(c.UserContext(), "meals", meal.ID, meal); err != nil {
			return err
		}
		return c.Status(201).JSON(meal)
	})
	api.Post("/checkins", func(c *fiber.Ctx) error {
		var check Checkin
		if err := json.Unmarshal(c.Body(), &check); err != nil {
			return invalid("Ungültiger Symptom-Eintrag.")
		}
		if err := check.validate(); err != nil {
			return err
		}
		profile, err := repo.loadProfile(c.UserContext())
		if err != nil {
			return err
		}
		if check.CyclePhase == "unknown" {
			check.CyclePhase, check.CycleDay = inferredCycleContext(check.OccurredAt, profile)
		}
		if profile.BodyGroup != "female" || !profile.CycleTracking {
			check.CyclePhase = "unknown"
			check.CycleDay = 0
		}
		if check.ReferenceMealID != "" {
			data, err := repo.load(c.UserContext())
			if err != nil {
				return err
			}
			found := false
			for _, meal := range data.Meals {
				if meal.ID == check.ReferenceMealID {
					found = true
					break
				}
			}
			if !found {
				return invalid("Die zugeordnete Mahlzeit wurde nicht gefunden.")
			}
		}
		check.ID = uuid.NewString()
		if err := repo.save(c.UserContext(), "checkins", check.ID, check); err != nil {
			return err
		}
		return c.Status(201).JSON(check)
	})
	api.Delete("/:kind/:id", func(c *fiber.Ctx) error {
		kind, id := c.Params("kind"), c.Params("id")
		if !diaryTables[kind] {
			return fiber.ErrNotFound
		}
		if _, err := uuid.Parse(id); err != nil {
			return fiber.ErrNotFound
		}
		if err := repo.remove(c.UserContext(), kind, id); err != nil {
			return err
		}
		return c.SendStatus(204)
	})
}
