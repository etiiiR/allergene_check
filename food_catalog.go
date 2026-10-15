package main

import (
	_ "embed"
	"encoding/json"
	"sort"
)

//go:embed ml-service/app/data/foods.json
var foodJSON []byte

type Food struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Aliases  []string `json:"aliases"`
	Category string   `json:"category"`
	Level    string   `json:"level"`
	Groups   []string `json:"groups"`
	Note     string   `json:"note"`
	Source   string   `json:"source"`
	Reviewed string   `json:"reviewed"`
}

var foods []Food
var foodByID = map[string]Food{}

func init() {
	if err := json.Unmarshal(foodJSON, &foods); err != nil {
		panic(err)
	}
	for _, food := range foods {
		foodByID[food.ID] = food
	}
}

// Derive canonical keys at analysis time, including old meal snapshots. Original
// recipe text and stored history are never rewritten. Confirmed IDs take priority.
// Allergen tags remain explicitly user-confirmed, not guessed from text.
func ingredientKeys(items []Ingredient) []string {
	set := map[string]bool{}
	for _, item := range items {
		if len(item.FoodIDs) == 0 {
			normalized := normalizeIngredient(item.Text)
			if normalized.FoodID != "" {
				set[normalized.FoodID] = true
			} else if normalized.Name != "" {
				set["custom:"+ingredientText(normalized.Name)] = true
			}
		}
		for _, id := range item.FoodIDs {
			set[id] = true
		}
		for _, a := range item.Allergens {
			set["allergen:"+a] = true
		}
	}
	keys := []string{}
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
