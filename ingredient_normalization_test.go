package main

import (
	_ "embed"
	"encoding/json"
	"reflect"
	"testing"
)

//go:embed ml-service/tests/fixtures/ingredient_normalization.json
var normalizationCases []byte

func TestIngredientNormalizationSharedCorpus(t *testing.T) {
	var cases []struct {
		Line string `json:"line"`
		normalizedIngredient
	}
	if err := json.Unmarshal(normalizationCases, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Line, func(t *testing.T) {
			if got := normalizeIngredient(tc.Line); got != tc.normalizedIngredient {
				t.Errorf("got %+v; want %+v", got, tc.normalizedIngredient)
			}
		})
	}
}

func TestHistoricalIngredientKeysMergeWithoutRewritingHistory(t *testing.T) {
	original := []Ingredient{{Text: "1 Prise Salz"}, {Text: "½ TL Salz"}, {Text: "250 g Butter , weich"}, {Text: "4 Eier", Allergens: []string{"egg"}}}
	snapshot, _ := json.Marshal(original)
	keys := ingredientKeys(original)
	if !reflect.DeepEqual(keys, []string{"allergen:egg", "butter", "egg", "salt"}) {
		t.Fatalf("unexpected keys: %v", keys)
	}
	after, _ := json.Marshal(original)
	if string(snapshot) != string(after) {
		t.Fatal("historical text was changed")
	}
	// Explicit user mappings win, even if the old raw text disagrees.
	if got := ingredientKeys([]Ingredient{{Text: "Milch", FoodIDs: []string{"almond-milk"}}}); !reflect.DeepEqual(got, []string{"almond-milk"}) {
		t.Fatal(got)
	}
}

func TestCanonicalRecipeKeysCannotBeSuppliedByClient(t *testing.T) {
	recipe := Recipe{Title: "Test", Servings: 1, Ingredients: []Ingredient{{Text: "1 Prise Salz"}}, AnalysisIngredientIDs: []string{"allergen:milk"}}
	if err := recipe.validate(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(recipe.AnalysisIngredientIDs, []string{"salt"}) {
		t.Fatal(recipe.AnalysisIngredientIDs)
	}
}
