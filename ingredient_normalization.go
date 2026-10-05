package main

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Rules and vocabulary are shared with Python. The golden corpus is exercised
// in both runtimes so historical analysis and new recipe imports use the same keys.
//
//go:embed ml-service/app/data/ingredient_rules.json
var ingredientRuleJSON []byte

type ingredientRules struct {
	Replacements map[string]string `json:"replacements"`
	Units        []string          `json:"units"`
	Prefixes     []string          `json:"prefixes"`
	Suffixes     []string          `json:"suffixes"`
}
type normalizedIngredient struct {
	Name        string `json:"normalized_name"`
	FoodID      string `json:"canonical_id"`
	NeedsReview bool   `json:"needs_review"`
}

var normalizationRules ingredientRules
var ingredientReplacer *strings.Replacer
var canonicalFoods = sync.OnceValue(func() map[string]Food {
	aliases := map[string]Food{}
	for _, food := range foods {
		for _, alias := range food.Aliases {
			aliases[ingredientText(alias)] = food
		}
	}
	return aliases
})
var quantityPrefix = regexp.MustCompile(`^[0-9]+(?:[.,][0-9]+)?(?: */ *[0-9]+)?(?: +[0-9]+ */ *[0-9]+)?(?: *- *[0-9]+(?:[.,][0-9]+)?)? *`)

func init() {
	if err := json.Unmarshal(ingredientRuleJSON, &normalizationRules); err != nil {
		panic(err)
	}
	keys := make([]string, 0, len(normalizationRules.Replacements))
	for key := range normalizationRules.Replacements {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	pairs := []string{}
	for _, key := range keys {
		pairs = append(pairs, key, normalizationRules.Replacements[key])
	}
	ingredientReplacer = strings.NewReplacer(pairs...)
}

func ingredientText(value string) string {
	value = strings.ToLower(value)
	value = ingredientReplacer.Replace(value)
	return strings.Join(strings.Fields(value), " ")
}

func stripLeadingToken(value string, tokens []string, hyphen bool) string {
	for _, token := range tokens {
		for _, sep := range []string{" ", ". "} {
			if strings.HasPrefix(value, token+sep) {
				return strings.TrimSpace(strings.TrimPrefix(value, token+sep))
			}
		}
		if hyphen && strings.HasPrefix(value, token+"-") {
			return strings.TrimPrefix(value, token+"-")
		}
	}
	return value
}

// normalizeIngredient removes only known quantity/preparation syntax. Identity-
// changing terms (lactose-free, plant milk, flour type, juice) are not discarded.
// Unknown names remain custom observations, never fabricated FODMAP/allergen facts.
func normalizeIngredient(raw string) normalizedIngredient {
	original := ingredientText(raw)
	name := original
	for i := 0; i < 8; i++ {
		before := name
		name = stripLeadingToken(name, normalizationRules.Prefixes, true)
		if loc := quantityPrefix.FindStringIndex(name); loc != nil {
			amount, rest := name[:loc[1]], name[loc[1]:]
			// Accept "250g", but don't turn a product such as "5-spice" into "spice".
			if strings.HasSuffix(amount, " ") || stripLeadingToken(rest, normalizationRules.Units, false) != rest {
				name = rest
			}
		}
		name = stripLeadingToken(name, normalizationRules.Units, false)
		for _, suffix := range normalizationRules.Suffixes {
			for _, ending := range []string{" (" + suffix + ")", ", " + suffix, "," + suffix, " " + suffix} {
				if strings.HasSuffix(name, ending) {
					name = strings.TrimSpace(strings.TrimSuffix(name, ending))
				}
			}
		}
		name = strings.TrimSpace(strings.Trim(name, ",;"))
		if name == before {
			break
		}
	}
	if name == "" {
		name = original
	}
	result := normalizedIngredient{Name: name, NeedsReview: true}
	// An exact whole-name alias avoids false substring matches such as "Milch"
	// inside an unrecognised plant product or "Salz" inside a seasoning blend.
	if food, found := canonicalFoods()[name]; found {
		result.FoodID, result.Name, result.NeedsReview = food.ID, food.Name, false
	}
	return result
}
