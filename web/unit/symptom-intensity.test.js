import test from "node:test";
import assert from "node:assert/strict";
import {
  symptomIntensityFromScore,
  symptomScoreFromIntensity,
  symptomIntensityLabels,
} from "../src/symptom-intensity.js";

test("five-star symptom levels preserve the legacy storage range", () => {
  assert.deepEqual(symptomIntensityLabels, [
    "Keine",
    "Sehr leicht",
    "Leicht",
    "Mittel",
    "Stark",
    "Sehr stark",
  ]);
  assert.deepEqual(
    [0, 1, 4, 5, 6, 7, 8, 9, 10].map(symptomIntensityFromScore),
    [0, 1, 1, 2, 3, 3, 4, 5, 5],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(symptomScoreFromIntensity),
    [0, 4, 5, 7, 8, 10],
  );
});

test("a newly selected mild symptom is included by the existing analysis threshold", () => {
  const mildScore = symptomScoreFromIntensity(1);
  assert.ok(mildScore >= 3);
  assert.equal(symptomIntensityFromScore(mildScore), 1);
});
