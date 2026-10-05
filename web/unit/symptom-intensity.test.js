import test from "node:test";
import assert from "node:assert/strict";
import {
  symptomIntensityFromScore,
  symptomScoreFromIntensity,
  symptomIntensityLabels,
} from "../src/symptom-intensity.js";

test("qualitative symptom levels preserve the legacy storage range", () => {
  assert.deepEqual(symptomIntensityLabels, [
    "Keine",
    "Leicht",
    "Mittel",
    "Stark",
  ]);
  assert.deepEqual(
    [0, 1, 4, 5, 6, 8, 9, 10].map(symptomIntensityFromScore),
    [0, 1, 1, 1, 2, 2, 3, 3],
  );
  assert.deepEqual([0, 1, 2, 3].map(symptomScoreFromIntensity), [0, 4, 7, 10]);
});

test("a newly selected mild symptom is included by the existing analysis threshold", () => {
  const mildScore = symptomScoreFromIntensity(1);
  assert.ok(mildScore >= 3);
  assert.equal(symptomIntensityFromScore(mildScore), 1);
});
