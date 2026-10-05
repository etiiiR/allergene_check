package main

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// API callers opt in explicitly. The UI shows this as an editable default.
func mealGoodMoment(meal Meal, selected bool) *Checkin {
	if !selected {
		return nil
	}
	return &Checkin{ID: uuid.NewString(), OccurredAt: meal.OccurredAt, SymptomFree: true,
		Symptoms: map[string]int{}, TimingBucket: "unknown", ReferenceMealID: meal.ID,
		MealBaseline: true, Notes: "Gutes Befinden beim Erfassen der Mahlzeit. Keine Aussage über spätere Beschwerden."}
}

// Commit both records, or neither. An error must not leave an orphaned default
// check-in or a saved meal that the user thinks failed.
func (r *DiaryRepository) saveMeal(ctx context.Context, meal Meal, check *Checkin) error {
	if check == nil {
		return r.save(ctx, "meals", meal.ID, meal)
	}
	return r.store.WithTransaction(ctx, func(tx *surrealdb.Transaction) error {
		for _, item := range []struct {
			kind, id string
			value    any
		}{{"meals", meal.ID, meal}, {"checkins", check.ID, check}} {
			payload, err := json.Marshal(item.value)
			if err != nil {
				return err
			}
			if _, err := surrealdb.Create[diaryRecord](ctx, tx, models.NewRecordID("diary_"+item.kind, item.id), diaryRecord{Payload: string(payload)}); err != nil {
				return err
			}
		}
		return nil
	})
}
