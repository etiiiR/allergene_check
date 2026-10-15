import { test } from "node:test";
import assert from "node:assert/strict";
import { recipeIndex, findRecipes, searchText } from "../src/recipe-search.js";

const recipe = (id, title, ingredients = []) => ({
  id,
  title,
  ingredients: ingredients.map((text) => ({ text })),
});
test("German accents, transliterations, case, punctuation and whitespace match", () => {
  for (const [a, b] of [
    ["Kräuter", "kraeuter"],
    ["Öl", "OEL"],
    ["Süßkartoffel", "suesskartoffel"],
    ["Crème fraîche", "creme fraiche"],
    ["Reis — Zitrone", "reis zitrone"],
  ])
    assert.equal(searchText(a), searchText(b));
});
test("all terms may appear in a different order across name and ingredients", () => {
  const index = recipeIndex([
    recipe("1", "Kräuter-Reis", ["2 Bio Zitronen"]),
    recipe("2", "Kräuterbrot", ["Mehl"]),
  ]);
  assert.deepEqual(
    findRecipes(index, "ZITRONE kraeuter").map((i) => i.recipe.id),
    ["1"],
  );
  assert.equal(findRecipes(index, "Reis Mehl").length, 0);
});
test("exact name and title matches rank before ingredient-only matches", () => {
  const index = recipeIndex([
    recipe("1", "Pfanne", ["Reis"]),
    recipe("2", "Reis mit Gemüse"),
    recipe("3", "Reis"),
  ]);
  assert.deepEqual(
    findRecipes(index, "reis").map((i) => i.recipe.id),
    ["3", "2", "1"],
  );
});
test("recent and frequent use are distinct and compare actual instants", () => {
  const index = recipeIndex(
    [recipe("1", "A"), recipe("2", "B")],
    [
      { recipe_id: "1", occurred_at: "2026-01-02T11:00:00+02:00" },
      { recipe_id: "1", occurred_at: "2026-01-01T12:00:00Z" },
      { recipe_id: "2", occurred_at: "2026-01-02T10:00:00Z" },
    ],
  );
  assert.equal(findRecipes(index, "", "recent")[0].recipe.id, "2");
  assert.equal(findRecipes(index, "", "frequent")[0].recipe.id, "1");
});
test("200 recipes are all searchable, order is numeric and input data stays untouched", () => {
  const recipes = Array.from({ length: 200 }, (_, i) =>
    recipe(String(i), `Rezept ${200 - i}`),
  );
  const before = JSON.stringify(recipes);
  const index = recipeIndex(recipes);
  const ids = index.map((i) => i.recipe.id);
  assert.equal(findRecipes(index, "", "name")[1].recipe.title, "Rezept 2");
  assert.equal(findRecipes(index, "Rezept 200")[0].recipe.title, "Rezept 200");
  assert.equal(findRecipes(index, "   ").length, 200);
  assert.equal(findRecipes(index, "nicht vorhanden").length, 0);
  assert.deepEqual(
    index.map((i) => i.recipe.id),
    ids,
  );
  assert.equal(JSON.stringify(recipes), before);
});
test("same-name recipes remain separate choices and deleted recipes do not reappear", () => {
  const index = recipeIndex(
    [recipe("1", "Reis", ["Tomate"]), recipe("2", "Reis", ["Karotte"])],
    [{ recipe_id: "deleted", occurred_at: "2026-01-01T12:00:00Z" }],
  );
  assert.equal(findRecipes(index, "reis").length, 2);
  assert.equal(findRecipes(index, "Karotte")[0].recipe.id, "2");
});
