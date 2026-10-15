import test from "node:test";
import assert from "node:assert/strict";
import {
  associationPresentation,
  MIN_COMPARISON_MOMENTS,
} from "../src/association-presentation.js";

test("a single 1/1 moment shows counts without an alarming 100%", () => {
  const shown = associationPresentation({
    exposed: 1,
    unexposed: 0,
    rate_exposed: 1,
    rate_unexposed: null,
    difference: null,
  });

  assert.equal(shown.enoughData, false);
  assert.equal(shown.label, "Noch wenig Daten");
  assert.equal(shown.exposedRate, "Zu wenige Daten");
  assert.equal(shown.unexposedRate, "Keine Vergleichsmomente");
});

test("small comparison groups never show rates or directional language", () => {
  const shown = associationPresentation({
    exposed: MIN_COMPARISON_MOMENTS - 1,
    unexposed: 30,
    rate_exposed: 1,
    rate_unexposed: 0.1,
    difference: 0.9,
  });

  assert.equal(shown.enoughData, false);
  assert.equal(shown.label, "Noch wenig Daten");
  assert.equal(shown.exposedRate, "Zu wenige Daten");
  assert.equal(shown.unexposedRate, "Zu wenige Daten");
});

test("rates appear only when both groups meet the minimum and use personal wording", () => {
  const shown = associationPresentation({
    exposed: 5,
    unexposed: 7,
    rate_exposed: 0.8,
    rate_unexposed: 0.2,
    difference: 0.6,
  });

  assert.equal(shown.enoughData, true);
  assert.equal(shown.label, "Häufiger in deinen Einträgen");
  assert.equal(shown.exposedRate, "80 %");
  assert.equal(shown.unexposedRate, "20 %");
});

test("a small negative difference is described as similar, not protective", () => {
  const shown = associationPresentation({
    exposed: 6,
    unexposed: 6,
    rate_exposed: 0.33,
    rate_unexposed: 0.5,
    difference: -0.17,
  });

  assert.equal(shown.label, "Ähnlich in deinen Einträgen");
  assert.equal(shown.tone, "neutral");
});
