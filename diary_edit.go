package main

import (
	"context"
	"encoding/json"
	"reflect"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// Editing is separate from creation: IDs, meal snapshots and measurement
// provenance belong to the server. Omitted fields retain their stored values.
func prepareDiaryEdit(data DiaryData, kind, id string, body []byte) (any, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		return nil, invalid("Ungültige Änderungen.")
	}
	decode := func(value any) error {
		if err := json.Unmarshal(body, value); err != nil {
			return invalid("Ungültige Änderungen.")
		}
		return nil
	}
	switch kind {
	case "meals":
		for _, old := range data.Meals {
			if old.ID != id {
				continue
			}
			next := old
			// Never decode client ingredients into the snapshot's shared slice.
			next.Ingredients = nil
			if err := decode(&next); err != nil {
				return nil, err
			}
			next.ID, next.Title, next.Ingredients = old.ID, old.Title, old.Ingredients
			if !validTime(next.OccurredAt) || next.Portions <= 0 || next.Portions > 20 || len(next.Notes) > 3000 {
				return nil, invalid("Zeitpunkt, Portionen oder Notiz sind ungültig.")
			}
			// Notes/time edits must never refresh an old recipe snapshot.
			if next.RecipeID != old.RecipeID {
				for _, flag := range data.RecipeFlags {
					if flag.MealID == id {
						return nil, invalid("Bitte zuerst die Reaktionsmarkierung dieser Mahlzeit beim bisherigen Rezept entfernen, bevor du das Rezept wechselst.")
					}
				}
				found := false
				for _, recipe := range data.Recipes {
					if recipe.ID == next.RecipeID {
						next.Title, next.Ingredients, found = recipe.Title, recipe.Ingredients, true
						break
					}
				}
				if !found {
					return nil, invalid("Bitte ein gespeichertes Rezept wählen.")
				}
			}
			return next, nil
		}
	case "checkins":
		for _, old := range data.Checkins {
			if old.ID != id {
				continue
			}
			next := old
			// JSON objects merge into non-nil maps. Copy before decoding so a
			// failed edit cannot mutate the loaded diary; supplied maps replace.
			if _, supplied := fields["symptoms"]; supplied {
				next.Symptoms = nil
			}
			if err := decode(&next); err != nil {
				return nil, err
			}
			var intent struct {
				ConfirmObservation bool `json:"confirm_observation"`
			}
			if err := decode(&intent); err != nil {
				return nil, err
			}
			next.ID = old.ID
			next.MealBaseline = old.MealBaseline && next.SymptomFree && !intent.ConfirmObservation
			if err := next.validate(); err != nil {
				return nil, err
			}
			if next.MealBaseline {
				// A note correction is not new evidence of food tolerance.
				next.ReferenceMealID, next.TimingBucket = old.ReferenceMealID, old.TimingBucket
				next.Stress, next.SleepHours = old.Stress, old.SleepHours
				next.CyclePhase, next.CycleDay = old.CyclePhase, old.CycleDay
			} else if next.ReferenceMealID != "" && next.ReferenceMealID != old.ReferenceMealID {
				found := false
				for _, meal := range data.Meals {
					if meal.ID == next.ReferenceMealID {
						found = true
						break
					}
				}
				if !found {
					return nil, invalid("Die zugeordnete Mahlzeit wurde nicht gefunden.")
				}
			}
			// Keep historical cycle context; editing a note must not recalculate
			// it using today's profile or period start.
			return next, nil
		}
	case "stools":
		for _, old := range data.Stools {
			if old.ID != id {
				continue
			}
			next := old
			if err := decode(&next); err != nil {
				return nil, err
			}
			next.ID = old.ID
			if err := next.validate(); err != nil {
				return nil, err
			}
			return next, nil
		}
	case "stress":
		for _, old := range data.Stress {
			if old.ID != id {
				continue
			}
			next := old
			// Avoid mutating a pointer shared with the stored observation.
			if old.NormalizedStress != nil {
				value := *old.NormalizedStress
				next.NormalizedStress = &value
			}
			if err := decode(&next); err != nil {
				return nil, err
			}
			next.ID = old.ID
			if old.Source != "generic" || old.ExternalID != "" || old.Metric != "stress_score" {
				compare := next
				compare.Notes = old.Notes
				if !reflect.DeepEqual(compare, old) {
					return nil, invalid("Bei importierten Health-Messungen lässt sich nur die Notiz bearbeiten. Messwerte und Zeitpunkt bleiben unverändert.")
				}
			} else {
				if next.Source != old.Source || next.ExternalID != old.ExternalID || next.Metric != old.Metric || next.Unit != old.Unit || next.ObservedUntil != old.ObservedUntil {
					return nil, invalid("Die Quelle und Messart lassen sich nicht ändern.")
				}
				if next.Value < 0 || next.Value > 10 {
					return nil, invalid("Stress muss zwischen 0 und 10 liegen.")
				}
				next.NormalizedStress = &next.Value
			}
			if err := next.validate(); err != nil {
				return nil, err
			}
			return next, nil
		}
	}
	return nil, NewAppError(404, "entry_not_found", "Dieser Eintrag wurde nicht gefunden. Bitte lade das Tagebuch neu.")
}

// UPDATE, not UPSERT: a concurrently deleted entry must never be recreated.
func (r *DiaryRepository) updateEntry(ctx context.Context, kind, id string, value any) error {
	if !diaryTables[kind] {
		return invalid("Unbekannter Datentyp.")
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	result, err := Query[[]diaryRecord](ctx, r.store,
		"UPDATE $record SET payload = $payload RETURN AFTER;",
		map[string]any{"record": models.NewRecordID("diary_"+kind, id), "payload": string(payload)})
	if err != nil {
		return err
	}
	if result == nil || len(*result) == 0 || len((*result)[0].Result) == 0 {
		return NewAppError(404, "entry_not_found", "Dieser Eintrag wurde inzwischen gelöscht.")
	}
	return nil
}

func registerDiaryEdits(api fiber.Router, repo *DiaryRepository) {
	for _, kind := range []string{"meals", "checkins", "stools", "stress"} {
		api.Put("/"+kind+"/:id", func(c *fiber.Ctx) error {
			id := c.Params("id")
			if _, err := uuid.Parse(id); err != nil {
				return fiber.ErrNotFound
			}
			data, err := repo.load(c.UserContext())
			if err != nil {
				return err
			}
			next, err := prepareDiaryEdit(data, kind, id, c.Body())
			if err != nil {
				return err
			}
			if err := repo.updateEntry(c.UserContext(), kind, id, next); err != nil {
				return err
			}
			return c.JSON(next)
		})
	}
}
