"""Explainable diary analysis. Associations are exploratory, never causal diagnoses."""
from datetime import date, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field, AwareDatetime, field_validator
from sklearn.linear_model import LogisticRegression
from .ingredient_normalization import extract_line, FOODS, FOOD_IDS

router = APIRouter(prefix="/diary", tags=["Food diary"])


class RecipeText(BaseModel):
    lines: list[str] = Field(min_length=1, max_length=100)


@router.post("/ingredients")
def ingredients(request: RecipeText):
    return {"ingredients": [extract_line(line[:500]) for line in request.lines]}


class Meal(BaseModel):
    id: str = ""
    recipe_id: str = ""
    occurred_at: AwareDatetime
    ingredient_ids: list[str] = Field(max_length=100)


class Checkin(BaseModel):
    occurred_at: AwareDatetime
    symptoms: dict[str, int]
    timing_bucket: str = "unknown"
    reference_meal_id: str = ""
    cycle_phase: str = "unknown"
    cycle_day: int = Field(default=0, ge=0, le=45)
    stress: int = Field(default=0, ge=0, le=10)
    sleep_hours: float = Field(default=8, ge=0, le=24)


class RecipeFlag(BaseModel):
    id: str = ""
    recipe_id: str
    meal_id: str = ""
    kind: str = "suspected"
    occurred_at: AwareDatetime | None = None
    ingredient_ids: list[str] = Field(default_factory=list, max_length=100)
    symptoms: dict[str, int] = Field(default_factory=dict)
    severity: int = Field(default=0, ge=0, le=10)


class StoolObservation(BaseModel):
    observed_at: AwareDatetime
    observed_for_date: date
    quality: str
    notes: str = ""


class StressObservation(BaseModel):
    """Provider-neutral wearable data; raw vitals are not stress labels."""

    source: str
    external_id: str = ""
    metric: str
    value: float
    unit: str = ""
    normalized_stress: float | None = Field(default=None, ge=0, le=10)
    observed_at: AwareDatetime
    observed_until: AwareDatetime | None = None
    notes: str = ""


class PatternRequest(BaseModel):
    meals: list[Meal] = Field(max_length=10000)
    checkins: list[Checkin] = Field(max_length=10000)
    symptom: str = "any"
    window_hours: int = Field(default=8, ge=1, le=24)
    timezone: str = Field(default="UTC", max_length=100)
    profile_group: str = "unspecified"
    cycle_enabled: bool = False
    recipe_flags: list[RecipeFlag] = Field(default_factory=list, max_length=10000)
    stools: list[StoolObservation] = Field(default_factory=list, max_length=10000)
    stress_observations: list[StressObservation] = Field(default_factory=list, max_length=10000)

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Unknown timezone") from exc
        return value


TIMING_WINDOWS = {
    "immediate": (0, 0.5),
    "early": (0.5, 2),
    "mid": (2, 6),
    "late": (6, 24),
    "unknown": (0, 24),
}
TIMING_META = {
    "immediate": {"label": "Direkt nach dem Essen", "phase": "Frühes Fenster", "range": "0–30 min"},
    "early": {"label": "30 Minuten bis 2 Stunden", "phase": "Frühes Verdauungsfenster", "range": "30 min–2 h"},
    "mid": {"label": "2 bis 6 Stunden", "phase": "Dünndarm-orientiertes Fenster", "range": "2–6 h"},
    "late": {"label": "6 bis 24 Stunden / Folgetag", "phase": "Spätes / Folgetag-Fenster", "range": "6–24 h"},
    "unknown": {"label": "Zeitpunkt unklar", "phase": "Nicht zugeordnet", "range": "–"},
}
CYCLE_PHASE_META = {
    "menstruation": "Menstruation",
    "follicular": "Follikelphase",
    "ovulation": "Ovulationsfenster",
    "luteal": "Lutealphase",
}
STOOL_QUALITY_META = {
    "formed": "Gut geformt",
    "hard": "Hart / schwer",
    "soft": "Weich",
    "watery": "Wässrig",
    "mixed": "Unterschiedlich",
    "no_stool": "Kein Stuhl",
    "unknown": "Nicht sicher",
}
STOOL_ABNORMAL = {"hard", "soft", "watery", "mixed"}


def non_food_assessment(moments: list[dict], severity_for):
    """Flag an exploratory absence of a meal link without diagnosing a cause."""
    with_food = [moment for moment in moments if moment["exposures"]]
    without_food = [moment for moment in moments if not moment["exposures"]]
    symptomatic_with_food = sum(severity_for(moment["check"]) >= 3 for moment in with_food)
    symptomatic_without_food = sum(severity_for(moment["check"]) >= 3 for moment in without_food)
    with_rate = symptomatic_with_food / len(with_food) if with_food else None
    without_rate = symptomatic_without_food / len(without_food) if without_food else None
    status = "insufficient_data"
    label = "Noch zu wenig Vergleichsmomente"
    explanation = "Dokumentiere Mahlzeiten und Befinden auch dann, wenn du keinen Essensauslöser vermutest."
    if len(with_food) >= 3 and len(without_food) >= 3:
        if without_rate is not None and with_rate is not None and without_rate - with_rate >= 0.25 and symptomatic_without_food >= 3:
            status = "possible_other_driver"
            label = "Möglicherweise nicht primär lebensmittelbezogen"
            explanation = "Viele Beschwerden traten in Momenten ohne passend dokumentierte Mahlzeit auf. Andere Faktoren sollten mitbeobachtet werden."
        elif with_rate is not None and without_rate is not None and with_rate - without_rate >= 0.25:
            status = "food_timing_more_consistent"
            label = "Essensbezug ist in den Daten konsistenter"
            explanation = "Beschwerden traten häufiger in dokumentierten Essensfenstern auf. Das ist ein Hinweis, kein Beweis."
        else:
            status = "mixed_or_unclear"
            label = "Gemischtes oder unklareres Muster"
            explanation = "Die Beschwerden verteilen sich auf Momente mit und ohne passenden Essensbezug."
    return {
        "status": status,
        "label": label,
        "explanation": explanation,
        "documented_moments": len(moments),
        "moments_with_food_window": len(with_food),
        "moments_without_food_window": len(without_food),
        "symptomatic_with_food": symptomatic_with_food,
        "symptomatic_without_food": symptomatic_without_food,
        "rate_with_food": round(with_rate, 3) if with_rate is not None else None,
        "rate_without_food": round(without_rate, 3) if without_rate is not None else None,
    }


def manual_and_stool_evidence(request: PatternRequest):
    """Collect explicit recipe flags and next-day stool observations.

    These signals are deliberately reported as personal evidence, not as a
    diagnosis. Stool observations are linked to meals from the preceding local
    calendar day so the user can review delayed digestive patterns.
    """
    manual = {}
    for flag in request.recipe_flags:
        for ingredient_id in flag.ingredient_ids:
            item = manual.setdefault(ingredient_id, {"flags": 0, "reaction_flags": 0, "suspected_flags": 0, "severity": 0})
            item["flags"] += 1
            item["reaction_flags"] += int(flag.kind == "reaction")
            item["suspected_flags"] += int(flag.kind == "suspected")
            item["severity"] = max(item["severity"], flag.severity)

    stool_counts = {quality: 0 for quality in STOOL_QUALITY_META}
    stool_by_ingredient = {}
    zone = ZoneInfo(request.timezone)
    for stool in request.stools:
        quality = stool.quality if stool.quality in STOOL_QUALITY_META else "unknown"
        stool_counts[quality] += 1
        if quality not in STOOL_ABNORMAL and quality != "formed":
            continue
        for meal in request.meals:
            meal_day = meal.occurred_at.astimezone(zone).date()
            if stool.observed_for_date != meal_day + timedelta(days=1):
                continue
            for ingredient_id in meal.ingredient_ids:
                item = stool_by_ingredient.setdefault(ingredient_id, {"abnormal": 0, "formed": 0})
                item["abnormal"] += int(quality in STOOL_ABNORMAL)
                item["formed"] += int(quality == "formed")

    return manual, stool_by_ingredient, [
        {"quality": quality, "label": label, "count": stool_counts[quality]}
        for quality, label in STOOL_QUALITY_META.items()
    ], {
        "flags": len(request.recipe_flags),
        "suspected_recipe_flags": sum(flag.kind == "suspected" for flag in request.recipe_flags),
        "reaction_flags": sum(flag.kind == "reaction" for flag in request.recipe_flags),
        "stool_observations": len(request.stools),
    }


def stress_value_for(check: Checkin, observations: list[StressObservation]):
    """Use only an explicit provider-normalized score near a check-in.

    HRV, pulse, sleep and readiness records remain useful context for a later
    review, but this service deliberately does not invent a stress conversion.
    """
    best = None
    for observation in observations:
        if observation.normalized_stress is None:
            continue
        if observation.observed_until and observation.observed_at <= check.occurred_at <= observation.observed_until:
            distance = 0.0
        else:
            distance = abs((check.occurred_at - observation.observed_at).total_seconds())
            if distance > 6 * 60 * 60:
                continue
        if best is None or distance < best[0]:
            best = (distance, observation.normalized_stress)
    return best[1] if best else None


def stress_summary(observations: list[StressObservation]):
    by_source = {}
    by_metric = {}
    normalized = []
    for observation in observations:
        by_source[observation.source] = by_source.get(observation.source, 0) + 1
        by_metric[observation.metric] = by_metric.get(observation.metric, 0) + 1
        if observation.normalized_stress is not None:
            normalized.append(observation)
    normalized.sort(key=lambda item: item.observed_at)
    return {
        "total": len(observations),
        "normalized_count": len(normalized),
        "raw_metric_count": len(observations) - len(normalized),
        "by_source": [{"source": source, "count": count} for source, count in sorted(by_source.items())],
        "by_metric": [{"metric": metric, "count": count} for metric, count in sorted(by_metric.items())],
        "last_normalized_score": round(normalized[-1].normalized_stress, 2) if normalized else None,
        "last_normalized_at": normalized[-1].observed_at.isoformat() if normalized else None,
    }


def stress_assessment(moments: list[dict], severity_for):
    """Summarize documented symptom rates across two personal stress bands.

    The bands are deliberately descriptive (6/10 is a review threshold, not
    a clinical cutoff). Imported normalized values override the manual
    check-in value only when they are close to that moment.
    """
    scored = [moment for moment in moments if moment["stress"] is not None]
    high = [moment for moment in scored if moment["stress"] >= 6]
    lower = [moment for moment in scored if moment["stress"] < 6]
    high_symptomatic = sum(severity_for(moment["check"]) >= 3 for moment in high)
    lower_symptomatic = sum(severity_for(moment["check"]) >= 3 for moment in lower)
    high_rate = high_symptomatic / len(high) if high else None
    lower_rate = lower_symptomatic / len(lower) if lower else None
    difference = high_rate - lower_rate if high_rate is not None and lower_rate is not None else None
    status = "insufficient_data"
    label = "Noch zu wenig Stress-Vergleichsdaten"
    explanation = "Dokumentiere Stress und Befinden zu mehreren Zeitpunkten, damit diese persönliche Gegenüberstellung aussagekräftiger wird."
    if len(high) >= 3 and len(lower) >= 3:
        if difference is not None and difference >= 0.25:
            status = "more_symptoms_at_higher_stress"
            label = "Mehr Beschwerden bei höherem dokumentiertem Stress"
            explanation = "In deinen bisherigen Einträgen wurden Beschwerden häufiger bei Stress ab 6/10 dokumentiert. Das ist ein persönliches Muster, kein Nachweis einer Ursache."
        elif difference is not None and difference <= -0.25:
            status = "more_symptoms_at_lower_stress"
            label = "Mehr Beschwerden bei niedrigerem dokumentiertem Stress"
            explanation = "In deinen bisherigen Einträgen wurden Beschwerden häufiger bei Stress unter 6/10 dokumentiert. Das ist ein persönliches Muster, kein Nachweis einer Ursache."
        else:
            status = "mixed_or_unclear"
            label = "Kein klares Stress-Muster"
            explanation = "Die Beschwerderaten liegen in den beiden Stressbereichen nah beieinander oder sind gemischt."
    average = sum(moment["stress"] for moment in scored) / len(scored) if scored else None
    return {
        "status": status,
        "label": label,
        "explanation": explanation,
        "moments": len(scored),
        "high_stress_moments": len(high),
        "lower_stress_moments": len(lower),
        "high_stress_symptomatic": high_symptomatic,
        "lower_stress_symptomatic": lower_symptomatic,
        "high_stress_rate": round(high_rate, 3) if high_rate is not None else None,
        "lower_stress_rate": round(lower_rate, 3) if lower_rate is not None else None,
        "difference": round(difference, 3) if difference is not None else None,
        "average_stress": round(average, 2) if average is not None else None,
    }


@router.post("/patterns")
def patterns(request: PatternRequest):
    """Compare each documented symptom moment with meals in its timing window.

    Multiple check-ins on one day are intentionally retained: a symptom-free
    moment is not the same thing as a symptom-free day. Timing buckets are
    user-entered observation windows, not an anatomical diagnosis.
    """
    def selected_severity(check):
        return max(check.symptoms.values(), default=0) if request.symptom == "any" else check.symptoms.get(request.symptom, 0)
    rows = []
    moments = []
    timing_counts = {key: 0 for key in TIMING_WINDOWS}
    for check in sorted(request.checkins, key=lambda c: c.occurred_at):
        bucket = check.timing_bucket if check.timing_bucket in TIMING_WINDOWS else "unknown"
        timing_counts[bucket] += 1
        lower, upper = TIMING_WINDOWS[bucket]
        if bucket == "unknown":
            upper = request.window_hours
        exposures = set()
        for meal in request.meals:
            if check.reference_meal_id and meal.id != check.reference_meal_id:
                continue
            elapsed = (check.occurred_at - meal.occurred_at).total_seconds() / 3600
            if lower <= elapsed <= upper:
                exposures.update(meal.ingredient_ids)
        imported_stress = stress_value_for(check, request.stress_observations)
        moments.append({
            "check": check,
            "exposures": exposures,
            "stress": imported_stress if imported_stress is not None else check.stress,
            "stress_source": "health" if imported_stress is not None else "manual",
        })
        if not exposures:
            continue
        severity = max(check.symptoms.values(), default=0) if request.symptom == "any" else check.symptoms.get(request.symptom, 0)
        rows.append((exposures, int(severity >= 3), check, stress_value_for(check, request.stress_observations)))
    names = sorted(set().union(*(r[0] for r in rows))) if rows else []
    labels = np.array([r[1] for r in rows])
    positives = int(labels.sum())
    eligible = [name for name in names if sum(name in r[0] for r in rows) >= 3 and sum(name not in r[0] for r in rows) >= 3]
    trained = len(rows) >= 20 and positives >= 5 and len(rows)-positives >= 5 and bool(eligible)
    coefficients = {}
    if trained:
        # Regularized multivariable model includes logged stress and sleep.
        matrix = np.array([[int(name in r[0]) for name in eligible] + [(r[3] if r[3] is not None else r[2].stress) / 10, r[2].sleep_hours / 24] for r in rows])
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
    manual, stool_by_ingredient, stool_summary, manual_summary = manual_and_stool_evidence(request)
    association_by_ingredient = {item["ingredient_id"]: item for item in associations}
    candidates = []
    for ingredient_id in sorted(set(association_by_ingredient) | set(manual) | set(stool_by_ingredient)):
        association = association_by_ingredient.get(ingredient_id, {})
        explicit = manual.get(ingredient_id, {})
        stool = stool_by_ingredient.get(ingredient_id, {})
        reasons = []
        score = 0
        if explicit.get("reaction_flags", 0):
            reasons.append("manuell als Reaktion markiert")
            score += explicit["reaction_flags"] * 3
        if explicit.get("suspected_flags", 0):
            reasons.append("Rezept manuell als verdächtig markiert")
            score += explicit["suspected_flags"] * 2
        if stool.get("abnormal", 0):
            reasons.append("mit auffälligerer Stuhlbeobachtung am Folgetag verbunden")
            score += stool["abnormal"]
        if association.get("difference") is not None and association["difference"] > 0:
            reasons.append("in den Essensfenstern häufiger mit Beschwerden verbunden")
            score += 1
        if not reasons:
            continue
        candidates.append({
            "ingredient_id": ingredient_id,
            "reasons": reasons,
            "evidence_score": score,
            "manual_flags": explicit.get("flags", 0),
            "manual_reactions": explicit.get("reaction_flags", 0),
            "stool_abnormal": stool.get("abnormal", 0),
            "stool_formed": stool.get("formed", 0),
            "observed_difference": association.get("difference"),
        })
    candidates.sort(key=lambda item: (-item["evidence_score"], item["ingredient_id"]))
    documented_positive = sum(selected_severity(moment["check"]) >= 3 for moment in moments)
    cycle_active = request.profile_group == "female" and request.cycle_enabled
    cycle_counts = {phase: {"moments": 0, "symptomatic_moments": 0} for phase in CYCLE_PHASE_META}
    if cycle_active:
        for moment in moments:
            phase = moment["check"].cycle_phase
            if phase not in cycle_counts:
                continue
            cycle_counts[phase]["moments"] += 1
            cycle_counts[phase]["symptomatic_moments"] += int(selected_severity(moment["check"]) >= 3)
    cycle_summary = [
        {
            "phase": phase,
            "label": CYCLE_PHASE_META[phase],
            **values,
            "rate": round(values["symptomatic_moments"] / values["moments"], 3) if values["moments"] else None,
        }
        for phase, values in cycle_counts.items()
    ] if cycle_active else []
    if request.profile_group == "female" and cycle_active:
        analysis_scope = "female_cycle_separated"
    elif request.profile_group == "male":
        analysis_scope = "male_separated_no_cycle_context"
    else:
        analysis_scope = "personal_profile_without_cycle_model"
    return {
        "observations": len(rows),
        # Keep the old keys for API compatibility while exposing their moment-level meaning.
        "symptomatic_days": positives,
        "comparison_days": len(rows)-positives,
        "documented_moments": len(moments),
        "food_matched_moments": len(rows),
        "symptomatic_moments": documented_positive,
        "comparison_moments": len(moments)-documented_positive,
        "model_status": "exploratory" if trained else "insufficient_data",
        "window_hours": request.window_hours, "symptom": request.symptom, "associations": associations,
        "timezone": request.timezone,
        "timing_summary": [{"bucket": key, **TIMING_META[key], "count": timing_counts[key]} for key in TIMING_WINDOWS],
        "non_food_assessment": non_food_assessment(moments, selected_severity),
        "possible_ingredients": candidates[:12],
        "manual_flag_summary": manual_summary,
        "stool_summary": stool_summary,
        "stress_summary": stress_summary(request.stress_observations),
        "stress_assessment": stress_assessment(moments, selected_severity),
        "analysis_scope": analysis_scope,
        "cycle_summary": cycle_summary,
        "method": "Each check-in is a separate observation; multiple moments on one local day remain separate. Food associations only use documented meals before symptom onset and the selected timing bucket; symptom threshold is 3/10. Manual check-in stress is always included; an explicitly provider-normalized stress score near a check-in overrides it for that moment. Raw HRV, pulse, sleep and readiness values are not converted into stress. The summary compares symptom rates at stress below versus at least 6/10, while logistic regression uses the effective stress value as an exploratory covariate. Logistic regression starts at 20 food-linked observations with at least 5 in each outcome and 3 exposed/unexposed observations per ingredient.",
        "limitations": "Associations cannot diagnose intolerance, allergy, or another illness. Moments without a food window can still have unlogged meals or non-food explanations. Timing buckets describe personal observation windows, not the exact location of digestion or a medical transit measurement. Cycle phases are approximate user-entered or calendar-derived context, not fertility or contraceptive guidance. Ingredients eaten together cannot be separated reliably. Unlogged meals, portion sizes, timing, medications, stress, sleep and other factors can confound results. Wearable availability and score meaning vary by provider; raw metrics are shown separately, and coefficients are unvalidated exploratory weights, not risk probabilities.",
    }
