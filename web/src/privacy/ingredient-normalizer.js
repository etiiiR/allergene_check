import foods from "../../../ml-service/app/data/foods.json" with { type: "json" };
import rules from "../../../ml-service/app/data/ingredient_rules.json" with { type: "json" };

const quantityPrefix = /^[0-9]+(?:[.,][0-9]+)?(?: *\/ *[0-9]+)?(?: +[0-9]+ *\/ *[0-9]+)?(?: *- *[0-9]+(?:[.,][0-9]+)?)? */u;
const wordCharacter = /[\p{L}\p{N}_]/u;
const foodById = new Map(foods.map((food) => [food.id, food]));
const aliases = new Map();

export function ingredientText(input) {
  let value = String(input ?? "").toLowerCase();
  for (const key of Object.keys(rules.replacements).sort()) {
    value = value.split(key).join(rules.replacements[key]);
  }
  return value.trim().split(/\s+/u).filter(Boolean).join(" ");
}

for (const food of foods) {
  for (const alias of food.aliases) aliases.set(ingredientText(alias), food);
}

function stripLeading(value, tokens, hyphen = false) {
  for (const token of tokens) {
    for (const separator of hyphen ? [" ", ". ", "-"] : [" ", ". "]) {
      const prefix = token + separator;
      if (value.startsWith(prefix)) return value.slice(prefix.length).trim();
    }
  }
  return value;
}

export function normalizeIngredient(raw) {
  const original = ingredientText(raw);
  let name = original;
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = name;
    name = stripLeading(name, rules.prefixes, true);
    const amount = name.match(quantityPrefix);
    if (amount) {
      const rest = name.slice(amount[0].length);
      if (amount[0].endsWith(" ") || stripLeading(rest, rules.units) !== rest) {
        name = rest;
      }
    }
    name = stripLeading(name, rules.units);
    for (const suffix of rules.suffixes) {
      for (const ending of [
        ` (${suffix})`,
        `, ${suffix}`,
        `,${suffix}`,
        ` ${suffix}`,
      ]) {
        if (name.endsWith(ending)) name = name.slice(0, -ending.length).trim();
      }
    }
    name = name.replace(/^[,; ]+|[,; ]+$/gu, "");
    if (name === before) break;
  }
  name ||= original;
  const food = aliases.get(name);
  return {
    normalized_name: food?.name || name,
    canonical_id: food?.id || "",
    needs_review: !food,
  };
}

function withinWord(text, index) {
  if (index < 0 || index >= text.length) return false;
  return wordCharacter.test(String.fromCodePoint(text.codePointAt(index)));
}

function exactAliasMatches(text) {
  const candidates = [];
  for (const [alias, food] of aliases) {
    if (!alias) continue;
    let from = 0;
    while (from <= text.length - alias.length) {
      const start = text.indexOf(alias, from);
      if (start < 0) break;
      const end = start + alias.length;
      if (!withinWord(text, start - 1) && !withinWord(text, end)) {
        candidates.push({ start, end, food });
      }
      from = start + 1;
    }
  }
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start));
  const used = [];
  const matches = new Map();
  for (const candidate of candidates) {
    if (used.some(([start, end]) => candidate.start < end && candidate.end > start)) {
      continue;
    }
    used.push([candidate.start, candidate.end]);
    matches.set(candidate.food.id, candidate.food);
  }
  return [...matches.values()];
}

// SequenceMatcher's ratio is based on matching characters in order. LCS gives
// the same ratio for ordinary names and remains suggestion-only, never an ID.
function similarityRatio(left, right) {
  if (!left.length && !right.length) return 1;
  let previous = new Uint16Array(right.length + 1);
  for (let i = 0; i < left.length; i++) {
    const current = new Uint16Array(right.length + 1);
    for (let j = 0; j < right.length; j++) {
      current[j + 1] =
        left[i] === right[j]
          ? previous[j] + 1
          : Math.max(previous[j + 1], current[j]);
    }
    previous = current;
  }
  return (2 * previous[right.length]) / (left.length + right.length);
}

const foodMatch = (food) => ({
  id: food.id,
  name: food.name,
  level: food.level,
  groups: food.groups,
});

export function extractIngredientLine(line) {
  const normalized = normalizeIngredient(line);
  const exact = normalized.canonical_id
    ? [foodById.get(normalized.canonical_id)]
    : [];
  if (exact.length) {
    return {
      line,
      ...normalized,
      method: "exact_alias",
      matches: exact.map(foodMatch),
    };
  }
  let matches = exactAliasMatches(ingredientText(line));
  if (!matches.length && normalized.normalized_name.length >= 4) {
    matches = [...aliases.entries()]
      .map(([alias, food]) => ({
        score: similarityRatio(normalized.normalized_name, alias),
        food,
      }))
      .sort((a, b) => b.score - a.score || b.food.id.localeCompare(a.food.id))
      .filter((item) => item.score >= 0.82)
      .slice(0, 3)
      .map((item) => item.food);
  }
  const unique = [...new Map(matches.map((food) => [food.id, food])).values()];
  return {
    line,
    ...normalized,
    method: "review_required",
    matches: unique.map(foodMatch),
  };
}

// Keep identity derivation in the browser so ingredient text never needs to
// leave the device when a private vault is active.
export function ingredientKeys(items = []) {
  const keys = new Set();
  for (const item of items) {
    const confirmed = item.food_ids || [];
    if (!confirmed.length) {
      const normalized = normalizeIngredient(item.text);
      if (normalized.canonical_id) keys.add(normalized.canonical_id);
      else if (normalized.normalized_name) {
        keys.add(`custom:${ingredientText(normalized.normalized_name)}`);
      }
    }
    for (const id of confirmed) keys.add(id);
    for (const allergen of item.allergens || []) keys.add(`allergen:${allergen}`);
  }
  return [...keys].sort();
}

export { foods };
