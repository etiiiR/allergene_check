import test from "node:test";
import assert from "node:assert/strict";
import {
  allSelectedSymptomsRated,
  toggleSelectedSymptom,
} from "../src/symptom-selection.js";

test("symptoms can be selected together and removed without changing others", () => {
  const withBloating = toggleSelectedSymptom([], "bloating");
  const withBoth = toggleSelectedSymptom(withBloating, "nausea");

  assert.deepEqual(withBoth, ["bloating", "nausea"]);
  assert.deepEqual(toggleSelectedSymptom(withBoth, "bloating"), ["nausea"]);
  assert.deepEqual(withBoth, ["bloating", "nausea"]);
});

test("every selected symptom needs its own non-zero rating before continuing", () => {
  const selected = ["bloating", "nausea"];

  assert.equal(
    allSelectedSymptomsRated(selected, { bloating: 4, nausea: 0 }),
    false,
  );
  assert.equal(allSelectedSymptomsRated(selected, { bloating: 4 }), false);
  assert.equal(
    allSelectedSymptomsRated(selected, { bloating: 4, nausea: 7 }),
    true,
  );
  assert.equal(allSelectedSymptomsRated([], {}), false);
});
