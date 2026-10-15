import test from "node:test";
import assert from "node:assert/strict";
import { analyseDiaryPatterns } from "../src/privacy/diary-analysis.js";

const base = Date.parse("2026-01-01T12:00:00.000Z");
const at = (hours) => new Date(base + hours * 3600000).toISOString();
const checkin = (hours, symptoms, extras = {}) => ({
  id: `check-${hours}`,
  occurred_at: at(hours),
  symptoms,
  timing_bucket: "unknown",
  stress: null,
  sleep_hours: null,
  context_recorded: false,
  ...extras,
});

test("local analysis ignores future meals, keeps multiple moments and respects timing windows", () => {
  const result = analyseDiaryPatterns({
    meals: [
      { id: "m1", occurred_at: at(0), ingredients: [{ text: "1 tsp cumin", food_ids: ["cumin"], allergens: [] }] },
      { id: "m2", occurred_at: at(5), ingredient_ids: ["onion"] },
    ],
    checkins: [
      checkin(1, { pain: 8 }),
      checkin(2, { pain: 0 }),
      checkin(4, { pain: 6 }, { timing_bucket: "early", reference_meal_id: "m1" }),
      checkin(6, { pain: 7 }),
      checkin(7, { pain: 7 }, { meal_baseline: true }),
    ],
  }, { symptom: "pain", hours: 8 });

  assert.equal(result.observations, 3);
  assert.equal(result.symptomatic_moments, 3);
  assert.equal(result.associations[0].ingredient_id, "cumin");
  assert.equal(result.associations[0].exposed, 3);
  assert.equal(result.associations.find((item) => item.ingredient_id === "onion").exposed, 1);
  assert.equal(result.documented_moments, 4);
});

test("non-food, stress, cycle, flags and next-day stool summaries are computed locally", () => {
  const meals = [{ id: "meal", recipe_id: "r1", occurred_at: at(0), ingredients: [{ text: "onion", food_ids: ["onion"], allergens: [] }] }];
  const checkins = [
    checkin(1, { pain: 8 }, { stress: 8, context_recorded: true, cycle_phase: "menstruation" }),
    checkin(2, { pain: 0 }, { stress: 8, context_recorded: true, cycle_phase: "menstruation" }),
    checkin(3, { pain: 8 }, { stress: 8, context_recorded: true, cycle_phase: "menstruation" }),
    checkin(10, { pain: 8 }, { stress: 2, context_recorded: true, cycle_phase: "luteal" }),
    checkin(11, { pain: 8 }, { stress: 2, context_recorded: true, cycle_phase: "luteal" }),
    checkin(12, { pain: 8 }, { stress: 2, context_recorded: true, cycle_phase: "luteal" }),
  ];
  const result = analyseDiaryPatterns({
    meals,
    checkins,
    profile: { body_group: "female", cycle_tracking: true },
    recipes: [{ id: "r1", ingredients: meals[0].ingredients }],
    recipe_flags: [{ id: "f1", recipe_id: "r1", kind: "reaction", severity: 6 }],
    stools: [{ observed_at: "2026-01-02T08:00:00.000Z", observed_for_date: "2026-01-02", quality: "watery" }],
    stress_observations: [{ source: "apple_healthkit", metric: "hrv", value: 35, unit: "ms", observed_at: at(0) }],
  }, { symptom: "pain", timezone: "UTC" });

  assert.equal(result.non_food_assessment.status, "possible_other_driver");
  const stress = analyseDiaryPatterns({ checkins: [
    checkin(1, { pain: 8 }, { stress: 8, context_recorded: true }),
    checkin(2, { pain: 8 }, { stress: 8, context_recorded: true }),
    checkin(3, { pain: 8 }, { stress: 8, context_recorded: true }),
    checkin(4, { pain: 0 }, { stress: 2, context_recorded: true }),
    checkin(5, { pain: 0 }, { stress: 2, context_recorded: true }),
    checkin(6, { pain: 0 }, { stress: 2, context_recorded: true }),
  ] }, { symptom: "pain" });
  assert.equal(stress.stress_assessment.status, "more_symptoms_at_higher_stress");
  assert.equal(result.cycle_summary.find((item) => item.phase === "menstruation").moments, 3);
  assert.equal(result.stress_summary.raw_metric_count, 1);
  assert.equal(result.possible_ingredients[0].ingredient_id, "onion");
  assert.equal(result.possible_ingredients[0].manual_reactions, 1);
  assert.equal(result.possible_ingredients[0].stool_abnormal, 1);
});

test("small datasets are not presented as a trained model and input remains unchanged", () => {
  const diary = {
    meals: [{ id: "m1", occurred_at: at(0), ingredients: [{ text: "onion", food_ids: ["onion"], allergens: [] }] }],
    checkins: [checkin(1, { bloating: 7 })],
  };
  const before = structuredClone(diary);
  const result = analyseDiaryPatterns(diary);
  assert.equal(result.model_status, "insufficient_data");
  assert.deepEqual(diary, before);
});

test("eligible 24-moment data fits finite multivariable exploratory weights", () => {
  const meals = [];
  const checkins = [];
  for (let day = 0; day < 24; day += 1) {
    const exposed = day % 2 === 0;
    meals.push({
      id: `meal-${day}`,
      occurred_at: new Date(base + day * 86400000).toISOString(),
      ingredient_ids: exposed ? ["onion", "garlic"] : ["carrot"],
    });
    checkins.push({
      id: `check-${day}`,
      occurred_at: new Date(base + day * 86400000 + 3600000).toISOString(),
      symptoms: { bloating: exposed ? 8 : 0 },
      timing_bucket: "unknown",
      stress: day % 3,
      sleep_hours: 8,
      context_recorded: true,
    });
  }
  const result = analyseDiaryPatterns({ meals, checkins });
  assert.equal(result.model_status, "exploratory");
  const onion = result.associations.find((item) => item.ingredient_id === "onion");
  assert.ok(Number.isFinite(onion.coefficient));
  assert.ok(onion.coefficient > 0);
  assert.ok(onion.co_occurring.includes("garlic"));
});

test("missing and legacy-unconfirmed context is not counted as zero stress or standard sleep", () => {
  const legacy = checkin(1, { pain: 8 }, { stress: 3, sleep_hours: 8 });
  delete legacy.context_recorded;
  const result = analyseDiaryPatterns({ checkins: [legacy] });
  assert.equal(result.stress_assessment.moments, 0);
  assert.equal(result.stress_assessment.average_stress, null);
});
