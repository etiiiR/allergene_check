import test from "node:test";
import assert from "node:assert/strict";
import { applyDiaryRequest } from "../src/privacy/client-diary-api.js";

const now = new Date("2026-10-05T12:00:00.000Z");
const emptyDiary = () => ({
  recipes: [],
  meals: [],
  checkins: [],
  profile: {
    display_name: "",
    onboarding_completed: false,
    body_group: "unspecified",
    cycle_tracking: false,
    cycle_length_days: 28,
    period_start: "",
  },
  recipe_flags: [],
  stools: [],
  stress_observations: [],
});
const apply = (diary, path, method, body) =>
  applyDiaryRequest(diary, path, method, body, now);

test("local API creates recipe, snapshots meal ingredients and records its optional baseline", () => {
  let diary = emptyDiary();
  const recipe = apply(diary, "/recipes", "POST", {
    title: "  Haferbrei  ",
    servings: 2,
    instructions: "Rühren.",
    ingredients: [{ text: "1 Prise Salz", food_ids: [], allergens: [] }],
  });
  diary = recipe.diary;
  assert.match(recipe.result.id, /^[0-9a-f-]{36}$/iu);
  assert.equal(recipe.result.title, "Haferbrei");
  assert.deepEqual(recipe.result.analysis_ingredient_ids, ["salt"]);

  const savedMeal = apply(diary, "/meals", "POST", {
    recipe_id: recipe.result.id,
    occurred_at: "2026-10-05T10:00:00.000Z",
    portions: 1,
    notes: "mit Banane",
    record_good_moment: true,
  });
  assert.equal(savedMeal.diary.meals.length, 1);
  assert.equal(savedMeal.result.checkin.meal_baseline, true);
  assert.equal(savedMeal.result.checkin.reference_meal_id, savedMeal.result.id);
  assert.deepEqual(savedMeal.result.ingredients, recipe.result.ingredients);

  const editedRecipe = apply(savedMeal.diary, `/recipes/${recipe.result.id}`, "PUT", {
    ...recipe.result,
    title: "Neue Rezeptversion",
    ingredients: [{ text: "Zucker", food_ids: ["sugar"], allergens: [] }],
  });
  const historicalMeal = editedRecipe.diary.meals[0];
  assert.equal(historicalMeal.title, "Haferbrei");
  assert.equal(historicalMeal.ingredients[0].text, "1 Prise Salz");
  assert.equal(editedRecipe.result.analysis_ingredient_ids[0], "sugar");
});

test("check-ins keep unentered stress and sleep unknown", () => {
  const created = apply(emptyDiary(), "/checkins", "POST", {
    occurred_at: "2026-10-05T11:00:00.000Z",
    symptom_free: true,
    symptoms: {},
    context_recorded: false,
  });
  assert.equal(created.result.stress, null);
  assert.equal(created.result.sleep_hours, null);
  assert.equal(created.result.context_recorded, false);

  const edited = apply(created.diary, `/checkins/${created.result.id}`, "PUT", {
    symptom_free: true,
    symptoms: {},
    stress: 4,
    sleep_hours: "",
    context_recorded: true,
  });
  assert.equal(edited.result.stress, 4);
  assert.equal(edited.result.sleep_hours, null);
  assert.equal(edited.result.context_recorded, true);
});

test("editing older context keeps the saved values but does not silently confirm them", () => {
  const diary = emptyDiary();
  diary.checkins.push({
    id: "legacy-checkin",
    occurred_at: "2026-10-05T10:00:00.000Z",
    symptom_free: false,
    symptoms: { pain: 4 },
    timing_bucket: "unknown",
    stress: 3,
    sleep_hours: 8,
    notes: "",
  });
  const edited = apply(diary, "/checkins/legacy-checkin", "PUT", {
    notes: "Notiz korrigiert",
  });
  assert.equal(edited.result.stress, 3);
  assert.equal(edited.result.sleep_hours, 8);
  assert.equal(edited.result.context_recorded, false);
});

test("local API preserves diary edit invariants and refuses forged historical snapshots", () => {
  const recipeId = "4f00e040-df5b-4ca2-9be2-764ddc76252f";
  const mealId = "cb1244e0-7b75-49ac-bd34-1eb88ef83f22";
  const checkinId = "07c03e83-979f-4827-986f-a6ce015ff3e2";
  const diary = emptyDiary();
  diary.recipes.push({
    id: recipeId,
    title: "Neu",
    ingredients: [{ text: "Zucker", food_ids: ["sugar"], allergens: [] }],
    servings: 2,
    instructions: "",
    analysis_ingredient_ids: ["sugar"],
    created_at: "2026-10-01T00:00:00.000Z",
  });
  diary.meals.push({
    id: mealId,
    recipe_id: recipeId,
    title: "Alt",
    ingredients: [{ text: "Salz", food_ids: [], allergens: [] }],
    occurred_at: "2026-10-01T10:00:00.000Z",
    portions: 1,
    notes: "",
  });
  diary.checkins.push({
    id: checkinId,
    occurred_at: "2026-10-01T12:00:00.000Z",
    symptom_free: true,
    symptoms: {},
    meal_baseline: true,
    timing_bucket: "unknown",
    reference_meal_id: mealId,
    stress: 0,
    sleep_hours: 0,
    cycle_phase: "unknown",
    cycle_day: 0,
    notes: "",
  });
  const editedMeal = apply(diary, `/meals/${mealId}`, "PUT", {
    title: "forged",
    ingredients: [{ text: "forged", food_ids: ["onion"], allergens: [] }],
    notes: "Korrektur",
    portions: 2,
  });
  assert.equal(editedMeal.result.title, "Alt");
  assert.equal(editedMeal.result.ingredients[0].text, "Salz");

  const editedBaseline = apply(editedMeal.diary, `/checkins/${checkinId}`, "PUT", {
    notes: "Tippfehler korrigiert",
    meal_baseline: false,
  });
  assert.equal(editedBaseline.result.meal_baseline, true);
  assert.equal(editedBaseline.result.reference_meal_id, mealId);

  assert.throws(
    () => apply(editedBaseline.diary, `/checkins/${checkinId}`, "PUT", {
      symptom_free: true,
      symptoms: { pain: 3 },
    }),
    /Symptomfrei und Beschwerden/u,
  );
  assert.throws(
    () => apply(editedBaseline.diary, `/meals/${mealId}`, "PUT", { portions: 0 }),
    /Portionen/u,
  );
});

test("check-in creation applies cycle context locally and keeps body groups separate", () => {
  const diary = emptyDiary();
  diary.profile = {
    display_name: "Testperson",
    onboarding_completed: true,
    body_group: "female",
    cycle_tracking: true,
    cycle_length_days: 28,
    period_start: "2026-09-20",
  };
  const created = apply(diary, "/checkins", "POST", {
    occurred_at: "2026-10-05T10:00:00.000Z",
    symptom_free: false,
    symptoms: { nausea: 4 },
    timing_bucket: "unknown",
    stress: 3,
    sleep_hours: 7,
    context_recorded: true,
    notes: "",
  });
  assert.equal(created.result.cycle_phase, "luteal");
  assert.equal(created.result.cycle_day, 16);

  created.diary.profile.body_group = "male";
  const separate = apply(created.diary, "/checkins", "POST", {
    occurred_at: "2026-10-05T11:00:00.000Z",
    symptom_free: true,
    symptoms: {},
    stress: 0,
    sleep_hours: 8,
    context_recorded: true,
    notes: "",
  });
  assert.equal(separate.result.cycle_phase, "unknown");
  assert.equal(separate.result.cycle_day, 0);
});

test("Health imports upsert by provider ID; imported measurements remain immutable", () => {
  const diary = emptyDiary();
  const observation = {
    id: "d72ed6d1-c4c0-4a2b-a220-01e34d775cde",
    source: "apple_healthkit",
    external_id: "sample-42",
    metric: "hrv",
    value: 42,
    unit: "ms",
    observed_at: "2026-10-04T10:00:00.000Z",
    notes: "",
  };
  diary.stress_observations.push(observation);
  const imported = apply(diary, "/health/import", "POST", {
    source: "apple_healthkit",
    records: [{ ...observation, notes: "reviewed" }],
  });
  assert.equal(imported.result.imported, 0);
  assert.equal(imported.result.updated, 1);
  assert.equal(imported.diary.stress_observations[0].notes, "reviewed");
  assert.throws(
    () => apply(imported.diary, `/stress/${observation.id}`, "PUT", { value: 9 }),
    /nur die Notiz/u,
  );
});

test("failed local validation leaves the input diary unchanged", () => {
  const diary = emptyDiary();
  const before = structuredClone(diary);
  assert.throws(
    () => apply(diary, "/recipes", "POST", {
      title: "Incomplete",
      servings: 1,
      ingredients: [{ text: "Salz", food_ids: ["not-a-food"], allergens: [] }],
    }),
    /Unbekannte Lebensmittel/u,
  );
  assert.deepEqual(diary, before);
});
