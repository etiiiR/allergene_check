"""Qualitative benchmark for the diary analysis, using synthetic planted signals."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.diary_analysis import Checkin, Meal, PatternRequest, StressObservation, patterns


FIXTURE = Path(__file__).parent / "fixtures" / "diary_synthetic_large.json"


def load_synthetic_request():
    fixture = json.loads(FIXTURE.read_text())
    recipes = {recipe["id"]: recipe for recipe in fixture["recipes"]}
    base = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    meals = []
    checkins = []
    for scenario in fixture["daily_scenarios"]:
        recipe = recipes[scenario["recipe_id"]]
        for offset in range(scenario["days"]):
            day = scenario["start_day"] + offset
            occurred_at = base + timedelta(days=day)
            meals.append(Meal(
                id=f"synthetic-meal-{day}",
                recipe_id=recipe["id"],
                occurred_at=occurred_at,
                ingredient_ids=recipe["ingredient_ids"],
            ))
            checkins.append(Checkin(
                occurred_at=occurred_at + timedelta(hours=2),
                symptoms=scenario["symptoms"],
                stress=scenario["stress"],
                sleep_hours=8,
            ))

    stress_observations = [
        StressObservation(
            source="generic",
            external_id=f"synthetic-stress-{item['day']}",
            metric="stress_score",
            value=item["normalized_stress"],
            unit="score_0_10",
            normalized_stress=item["normalized_stress"],
            observed_at=base + timedelta(days=item["day"]),
        )
        for item in fixture["health_overrides"]
    ]
    return fixture, PatternRequest(
        meals=meals,
        checkins=checkins,
        symptom=fixture["expected"]["symptom"],
        stress_observations=stress_observations,
    )


def test_large_synthetic_diary_finds_planted_trend_without_claiming_diagnosis():
    fixture, request = load_synthetic_request()
    result = patterns(request)
    expected = fixture["expected"]

    assert result["observations"] >= expected["minimum_observations"]
    assert result["model_status"] == expected["expected_model_status"]
    assert result["stress_assessment"]["status"] == expected["expected_stress_status"]

    associations = {item["ingredient_id"]: item for item in result["associations"]}
    for ingredient_id in expected["primary_ingredients"]:
        signal = associations[ingredient_id]
        assert signal["difference"] >= expected["minimum_primary_difference"]
        assert signal["rate_exposed"] > signal["rate_unexposed"]

    # Cumin is planted as a negative control: it should not look like the
    # allium signal merely because it is a spice.
    assert associations[expected["negative_control"]]["difference"] < 0
    assert result["stress_summary"]["normalized_count"] == len(fixture["health_overrides"])
    assert expected["not_a_diagnosis"] is True
