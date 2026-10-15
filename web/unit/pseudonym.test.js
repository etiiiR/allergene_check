import test from "node:test";
import assert from "node:assert/strict";
import { generatePseudonym } from "../src/privacy/pseudonym.js";

test("generated pseudonyms are short, readable display labels, not account credentials", () => {
  const pseudonym = generatePseudonym();
  assert.match(pseudonym, /^[A-ZÄÖÜ][a-zäöüß]+ [A-ZÄÖÜ][a-zäöüß]+ \d{2}$/u);
  assert.ok(pseudonym.length <= 80);
});
