package main

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strings"
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

var spaces = regexp.MustCompile(`\s+`)

// Unknown foods and spices remain trackable through an exact normalized label;
// they receive no invented FODMAP rating. Allergens are explicitly user-confirmed.
func ingredientKeys(items []Ingredient) []string {
	set := map[string]bool{}
	for _, item := range items {
		if len(item.FoodIDs) == 0 {
			set["custom:"+spaces.ReplaceAllString(strings.ToLower(strings.TrimSpace(item.Text)), " ")] = true
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
	return keys
}
