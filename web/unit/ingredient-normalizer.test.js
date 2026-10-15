import test from "node:test";
import assert from "node:assert/strict";
import cases from "../../ml-service/tests/fixtures/ingredient_normalization.json" with {
  type: "json",
};
import {
  extractIngredientLine,
  ingredientKeys,
  normalizeIngredient,
} from "../src/privacy/ingredient-normalizer.js";

test("browser ingredient identities match the shared Go/Python golden corpus", () => {
  for (const item of cases) {
    assert.deepEqual(normalizeIngredient(item.line), {
      normalized_name: item.normalized_name,
      canonical_id: item.canonical_id,
      needs_review: item.needs_review,
    }, item.line);
  }
});

test("ingredient suggestions remain review-only and precise aliases win", () => {
  const almond = extractIngredientLine("300 ml Mandelmilch");
  assert.equal(almond.method, "exact_alias");
  assert.deepEqual(almond.matches.map((item) => item.id), ["almond-milk"]);

  const contained = extractIngredientLine("selbstgemachte Mandelmilch mit Wasser");
  assert.equal(contained.method, "review_required");
  assert.deepEqual(contained.matches.map((item) => item.id), ["almond-milk"]);

  const salt = extractIngredientLine("1 Prise Salz");
  assert.equal(salt.method, "exact_alias");
  assert.deepEqual(salt.matches.map((item) => item.id), ["salt"]);

  const unknown = extractIngredientLine("2 TL Zauberkraut-XYZ");
  assert.equal(unknown.needs_review, true);
  assert.equal(unknown.method, "review_required");
});

test("ingredient keys coalesce quantities but retain explicit allergen confirmation", () => {
  const onePinch = [{ text: "1 Prise Salz", food_ids: [], allergens: ["mustard"] }];
  const twoTeaspoons = [{ text: "2 TL Salz", food_ids: [], allergens: ["mustard"] }];
  assert.deepEqual(ingredientKeys(onePinch), ["allergen:mustard", "salt"]);
  assert.deepEqual(ingredientKeys(twoTeaspoons), ingredientKeys(onePinch));
});
