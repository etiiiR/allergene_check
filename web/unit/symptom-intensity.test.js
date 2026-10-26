import test from "node:test";
import assert from "node:assert/strict";
import { reactive } from "vue";
import {
  symptomIntensityFromScore,
  symptomScoreFromIntensity,
  symptomIntensityLabels,
  preserveUnchangedSymptomScores,
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

test("editing one rating preserves untouched legacy symptom scores exactly", () => {
  const original = { bloating: 1, pain: 6, nausea: 0 };
  const edited = { bloating: 4, pain: 7, nausea: 0 };
  const result = preserveUnchangedSymptomScores(original, edited, ["bloating"]);

  assert.deepEqual(result, { bloating: 4, pain: 6, nausea: 0 });
  assert.deepEqual(original, { bloating: 1, pain: 6, nausea: 0 });
});

test("editing a reactive symptom map creates a detached plain payload", () => {
  const original = reactive({ bloating: 1, pain: 6 });
  const result = preserveUnchangedSymptomScores(
    original,
    { bloating: 4, pain: 7 },
    ["bloating"],
  );

  assert.deepEqual(result, { bloating: 4, pain: 6 });
  assert.deepEqual(original, { bloating: 1, pain: 6 });
});

test("explicitly changed ratings can add or clear a symptom", () => {
  assert.deepEqual(
    preserveUnchangedSymptomScores({ pain: 5 }, { pain: 0, nausea: 8 }, [
      "pain",
      "nausea",
    ]),
    { pain: 0, nausea: 8 },
  );
});
