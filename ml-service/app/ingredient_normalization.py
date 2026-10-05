"""Small offline ingredient identity resolver; no model downloads or health claims.

Rules + exact whole-name aliases are shared with Go's historical-analysis path.
Fuzzy/substring matches are suggestions ONLY; they never become automatic IDs.
"""
import json
import re
from difflib import SequenceMatcher
from pathlib import Path

DATA = Path(__file__).parent / "data"
RULES = json.loads((DATA / "ingredient_rules.json").read_text())
FOODS = json.loads((DATA / "foods.json").read_text())
FOOD_IDS = {food["id"] for food in FOODS}
QUANTITY = re.compile(r"^[0-9]+(?:[.,][0-9]+)?(?: */ *[0-9]+)?(?: +[0-9]+ */ *[0-9]+)?(?: *- *[0-9]+(?:[.,][0-9]+)?)? *")


def ingredient_text(value: str) -> str:
    value = value.lower()
    for key in sorted(RULES["replacements"]):
        value = value.replace(key, RULES["replacements"][key])
    return " ".join(value.split())


def strip_leading(value: str, tokens: list[str], hyphen: bool = False) -> str:
    for token in tokens:
        for separator in [" ", ". "] + (["-"] if hyphen else []):
            if value.startswith(token + separator):
                return value[len(token + separator):].strip()
    return value


ALIASES = {ingredient_text(alias): food for food in FOODS for alias in food["aliases"]}


def normalize_ingredient(raw: str) -> dict:
    original = ingredient_text(raw)
    name = original
    for _ in range(8):
        before = name
        name = strip_leading(name, RULES["prefixes"], True)
        amount = QUANTITY.match(name)
        if amount:
            rest = name[amount.end():]
            if amount.group().endswith(" ") or strip_leading(rest, RULES["units"]) != rest:
                name = rest
        name = strip_leading(name, RULES["units"])
        for suffix in RULES["suffixes"]:
            for ending in [f" ({suffix})", f", {suffix}", f",{suffix}", f" {suffix}"]:
                if name.endswith(ending):
                    name = name[:-len(ending)].strip()
        name = name.strip(",; ")
        if name == before:
            break
    name = name or original
    food = ALIASES.get(name)
    return {"normalized_name": food["name"] if food else name,
            "canonical_id": food["id"] if food else "",
            "needs_review": food is None}


def food_match(food: dict) -> dict:
    return {key: food[key] for key in ("id", "name", "level", "groups")}


def extract_line(line: str) -> dict:
    normalized = normalize_ingredient(line)
    if normalized["canonical_id"]:
        food = next(f for f in FOODS if f["id"] == normalized["canonical_id"])
        return {"line": line, **normalized, "method": "exact_alias", "matches": [food_match(food)]}
    # Preserve specific aliases before generic spans (almond milk before milk).
    text = ingredient_text(line)
    candidates = []
    for alias, food in ALIASES.items():
        for match in re.finditer(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", text):
            candidates.append((match.start(), match.end(), food))
    used, matches = [], {}
    for start, end, food in sorted(candidates, key=lambda item: item[1]-item[0], reverse=True):
        if any(start < b and end > a for a, b in used):
            continue
        used.append((start, end))
        matches[food["id"]] = food_match(food)
    # Spelling similarity is a candidate-ranking score, not calibrated confidence.
    if not matches and len(normalized["normalized_name"]) >= 4:
        ranked = sorted(((SequenceMatcher(None, normalized["normalized_name"], alias).ratio(), food["id"]) for alias, food in ALIASES.items()), reverse=True)
        by_id = {food["id"]: food for food in FOODS}
        for score, food_id in ranked:
            if score < 0.82 or len(matches) >= 3:
                break
            matches[food_id] = food_match(by_id[food_id])
    return {"line": line, **normalized, "method": "review_required", "matches": list(matches.values())}
