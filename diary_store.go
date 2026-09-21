package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// DiaryRepository reuses the application's authenticated SurrealDB connection.
// A JSON payload preserves the explicit API schema independently of record IDs.
type DiaryRepository struct{ store *SurrealStore }
type diaryRecord struct {
	Payload string `json:"payload"`
}

var diaryTables = map[string]bool{"recipes": true, "meals": true, "checkins": true}

// initializeDiary is an idempotent bootstrap for empty databases. Select on an
// undefined table is an error in SurrealDB, so create the schema before serving.
func (r *DiaryRepository) initialize(ctx context.Context) error {
	_, err := Query[any](ctx, r.store, `BEGIN TRANSACTION;
DEFINE TABLE IF NOT EXISTS diary_recipes SCHEMALESS;
DEFINE FIELD IF NOT EXISTS payload ON diary_recipes TYPE string;
DEFINE TABLE IF NOT EXISTS diary_meals SCHEMALESS;
DEFINE FIELD IF NOT EXISTS payload ON diary_meals TYPE string;
DEFINE TABLE IF NOT EXISTS diary_checkins SCHEMALESS;
DEFINE FIELD IF NOT EXISTS payload ON diary_checkins TYPE string;
COMMIT TRANSACTION;`, nil)
	return err
}

func (r *DiaryRepository) list(ctx context.Context, kind string, target any) error {
	if !diaryTables[kind] {
		return invalid("Unbekannter Datentyp.")
	}
	rows, err := Select[[]diaryRecord](ctx, r.store, models.Table("diary_"+kind))
	if err != nil {
		return err
	}
	raw := []json.RawMessage{}
	if rows != nil {
		for _, row := range *rows {
			if !json.Valid([]byte(row.Payload)) {
				return fmt.Errorf("invalid diary payload")
			}
			raw = append(raw, json.RawMessage(row.Payload))
		}
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}
func (r *DiaryRepository) save(ctx context.Context, kind, id string, value any) error {
	if !diaryTables[kind] {
		return invalid("Unbekannter Datentyp.")
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = Upsert[diaryRecord](ctx, r.store, models.NewRecordID("diary_"+kind, id), diaryRecord{Payload: string(payload)})
	return err
}
func (r *DiaryRepository) remove(ctx context.Context, kind, id string) error {
	if !diaryTables[kind] {
		return invalid("Unbekannter Datentyp.")
	}
	_, err := Delete[any](ctx, r.store, models.NewRecordID("diary_"+kind, id))
	return err
}
func (r *DiaryRepository) load(ctx context.Context) (DiaryData, error) {
	data := DiaryData{Recipes: []Recipe{}, Meals: []Meal{}, Checkins: []Checkin{}}
	if err := r.list(ctx, "recipes", &data.Recipes); err != nil {
		return data, err
	}
	if err := r.list(ctx, "meals", &data.Meals); err != nil {
		return data, err
	}
	if err := r.list(ctx, "checkins", &data.Checkins); err != nil {
		return data, err
	}
	return data, nil
}
