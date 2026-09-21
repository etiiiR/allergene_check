"""Explainable diary analysis. Associations are exploratory, never causal diagnoses."""
from datetime import timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pathlib import Path
import json
import re

import numpy as np
from fastapi import APIRouter
from nltk.tokenize import wordpunct_tokenize
from pydantic import BaseModel, Field, AwareDatetime, field_validator
from sklearn.linear_model import LogisticRegression

router = APIRouter(prefix="/diary", tags=["Food diary"])
FOODS = json.loads((Path(__file__).parent / "data" / "foods.json").read_text())
FOOD_IDS = {food["id"] for food in FOODS}


class RecipeText(BaseModel):
    lines: list[str] = Field(min_length=1, max_length=100)


def tokenize(text: str) -> str:
    return " ".join(wordpunct_tokenize(text.casefold()))


def extract_line(line: str) -> dict:
    """Prefer longest alias spans: almond milk must not also become cow's milk.
    Unknown ingredients stay unknown. Embedding similarity must never certify food.
    """
    text = tokenize(line)
    candidates = []
    for food in FOODS:
        for alias in food["aliases"]:
            for match in re.finditer(r"(?<!\w)" + re.escape(tokenize(alias)) + r"(?!\w)", text):
                candidates.append((match.start(), match.end(), food))
    used, matches = [], {}
    for start, end, food in sorted(candidates, key=lambda x: x[1] - x[0], reverse=True):
        if any(start < b and end > a for a, b in used):
            continue
        used.append((start, end))
        matches[food["id"]] = {"id": food["id"], "name": food["name"], "level": food["level"], "groups": food["groups"]}
    # Negation and substitutions require human review, even if names matched.
    ambiguous = bool(re.search(r"\b(without|no|optional|instead|or|ohne|oder|infused|marinated|mariniert|mischung|blend)\b", text))
    if re.search(r"\b(lactose|laktosefrei|laktosefreie|gluten)\b", text) and "lactose-free-milk" not in matches:
        ambiguous = True
    return {"line": line, "matches": list(matches.values()), "needs_review": ambiguous or not matches}


@router.post("/ingredients")
def ingredients(request: RecipeText):
    return {"ingredients": [extract_line(line[:500]) for line in request.lines]}


class Meal(BaseModel):
    occurred_at: AwareDatetime
    ingredient_ids: list[str] = Field(max_length=100)


class Checkin(BaseModel):
    occurred_at: AwareDatetime
    symptoms: dict[str, int]
    stress: int = Field(default=0, ge=0, le=10)
    sleep_hours: float = Field(default=8, ge=0, le=24)


class PatternRequest(BaseModel):
    meals: list[Meal] = Field(max_length=10000)
    checkins: list[Checkin] = Field(max_length=10000)
    symptom: str = "any"
    window_hours: int = Field(default=8, ge=1, le=24)
    timezone: str = Field(default="UTC", max_length=100)

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Unknown timezone") from exc
        return value


@router.post("/patterns")
def patterns(request: PatternRequest):
    """One observation per local day (strongest selected symptom; latest on ties), reducing repeated
    symptom episodes. Only preceding meals in the chosen window are exposures.
    Missing check-ins never become symptom-free observations.
    """
    daily = {}
    def selected_severity(check):
        return max(check.symptoms.values(), default=0) if request.symptom == "any" else check.symptoms.get(request.symptom, 0)

    for item in sorted(request.checkins, key=lambda c: c.occurred_at):
        day = item.occurred_at.astimezone(ZoneInfo(request.timezone)).date()
        previous = daily.get(day)
        if previous is None or selected_severity(item) >= selected_severity(previous):
            daily[day] = item
    rows = []
    for check in daily.values():
        exposures = set()
        for meal in request.meals:
            elapsed = (check.occurred_at - meal.occurred_at).total_seconds() / 3600
            if 0 <= elapsed <= request.window_hours:
                exposures.update(meal.ingredient_ids)
        if not exposures:
            continue
        severity = max(check.symptoms.values(), default=0) if request.symptom == "any" else check.symptoms.get(request.symptom, 0)
        rows.append((exposures, int(severity >= 3), check))
    names = sorted(set().union(*(r[0] for r in rows))) if rows else []
    labels = np.array([r[1] for r in rows])
    positives = int(labels.sum())
    eligible = [name for name in names if sum(name in r[0] for r in rows) >= 3 and sum(name not in r[0] for r in rows) >= 3]
    trained = len(rows) >= 20 and positives >= 5 and len(rows)-positives >= 5 and bool(eligible)
    coefficients = {}
    if trained:
        # Regularized multivariable model includes logged stress and sleep.
        matrix = np.array([[int(name in r[0]) for name in eligible] + [r[2].stress / 10, r[2].sleep_hours / 24] for r in rows])
        model = LogisticRegression(C=0.5, max_iter=1000, random_state=0).fit(matrix, labels)
        coefficients = dict(zip(eligible, model.coef_[0][:len(eligible)]))
    associations = []
    for name in names:
        exposed = [r for r in rows if name in r[0]]
        unexposed = [r for r in rows if name not in r[0]]
        a, b = sum(r[1] for r in exposed), sum(r[1] for r in unexposed)
        comparable = len(exposed) >= 3 and len(unexposed) >= 3
        twins = [other for other in names if other != name and all((name in r[0]) == (other in r[0]) for r in rows)]
        associations.append({
            "ingredient_id": name, "exposed": len(exposed), "unexposed": len(unexposed),
            "symptomatic_exposed": a, "symptomatic_unexposed": b,
            "rate_exposed": round(a / len(exposed), 3),
            "rate_unexposed": round(b / len(unexposed), 3) if unexposed else None,
            "difference": round(a / len(exposed) - b / len(unexposed), 3) if comparable else None,
            "coefficient": round(float(coefficients[name]), 3) if name in coefficients else None,
            "co_occurring": twins, "evidence": "exploratory" if comparable else "insufficient",
        })
    associations.sort(key=lambda a: a["difference"] if a["difference"] is not None else -2, reverse=True)
    return {
        "observations": len(rows), "symptomatic_days": positives, "comparison_days": len(rows)-positives,
        "model_status": "exploratory" if trained else "insufficient_data",
        "window_hours": request.window_hours, "symptom": request.symptom, "associations": associations,
        "timezone": request.timezone,
        "method": "Strongest selected symptom per local day (latest check-in on ties); preceding meals within the selected window; symptom threshold 3/10. Logistic regression starts at 20 observed days with at least 5 days in each outcome and 3 exposed/unexposed days per ingredient.",
        "limitations": "Associations cannot diagnose intolerance or allergy. Ingredients eaten together cannot be separated reliably. Unlogged meals, portion sizes, timing, medications and other factors can confound results. Coefficients are unvalidated exploratory weights, not risk probabilities.",
    }
