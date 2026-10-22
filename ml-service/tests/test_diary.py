from datetime import datetime, timedelta, timezone
from app.diary_analysis import Checkin, Meal, PatternRequest, RecipeFlag, StoolObservation, StressObservation, extract_line, patterns

BASE = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)


def test_longest_alias_preserves_lactose_free_and_plant_milk():
    assert [f["id"] for f in extract_line("200 ml almond milk")["matches"]] == ["almond-milk"]
    assert [f["id"] for f in extract_line("200 ml lactose-free milk")["matches"]] == ["lactose-free-milk"]
    assert extract_line("ohne Zwiebel")["needs_review"] is True
    assert extract_line("unknown secret sauce")["matches"] == []
    assert extract_line("2 TL Kreuzkümmel")["matches"][0]["id"] == "cumin"
    assert extract_line("garlic infused oil")["needs_review"] is True
    assert extract_line("lactose free yogurt")["needs_review"] is True


def test_absent_checkins_do_not_create_negative_examples():
    result = patterns(PatternRequest(meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])], checkins=[]))
    assert result["observations"] == 0
    assert result["associations"] == []
    assert result["model_status"] == "insufficient_data"


def test_future_meals_never_explain_earlier_symptoms():
    result = patterns(PatternRequest(
        meals=[Meal(occurred_at=BASE + timedelta(hours=1), ingredient_ids=["onion"])],
        checkins=[Checkin(occurred_at=BASE, symptoms={"bloating": 8})]))
    assert result["observations"] == 0


def test_multiple_moments_same_day_are_retained_as_separate_evidence():
    result = patterns(PatternRequest(
        meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])],
        checkins=[Checkin(occurred_at=BASE + timedelta(hours=h), symptoms={"bloating": 7}) for h in range(1, 5)]))
    assert result["observations"] == 4
    assert result["associations"][0]["exposed"] == 4


def test_patterns_compare_explicit_days_and_report_confounded_ingredients():
    meals, checkins = [], []
    for day in range(24):
        date = BASE + timedelta(days=day)
        exposed = day % 2 == 0
        meals.append(Meal(occurred_at=date, ingredient_ids=["onion", "garlic", "allergen:milk"] if exposed else ["carrot"]))
        checkins.append(Checkin(occurred_at=date + timedelta(hours=2), symptoms={"bloating": 7 if exposed else 0, "pain": 0}))
    result = patterns(PatternRequest(meals=meals, checkins=checkins))
    assert result["model_status"] == "exploratory"
    onion = next(a for a in result["associations"] if a["ingredient_id"] == "onion")
    assert onion["rate_exposed"] == 1
    assert onion["rate_unexposed"] == 0
    assert onion["coefficient"] > 0
    assert "garlic" in onion["co_occurring"]
    assert "allergen:milk" in onion["co_occurring"]
    pain = patterns(PatternRequest(meals=meals, checkins=checkins, symptom="pain"))
    assert pain["symptomatic_days"] == 0
    assert pain["model_status"] == "insufficient_data"


def test_window_changes_exposure_without_reversing_time():
    meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])]
    checkins=[Checkin(occurred_at=BASE+timedelta(hours=6), symptoms={"pain":5})]
    assert patterns(PatternRequest(meals=meals, checkins=checkins, window_hours=4))["observations"] == 0
    assert patterns(PatternRequest(meals=meals, checkins=checkins, window_hours=8))["observations"] == 1


def test_later_symptom_free_checkin_does_not_erase_earlier_symptoms():
    result = patterns(PatternRequest(
        meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])],
        checkins=[Checkin(occurred_at=BASE+timedelta(hours=1), symptoms={"pain":8}),
                  Checkin(occurred_at=BASE+timedelta(hours=3), symptoms={"pain":0})]))
    assert result["observations"] == 2
    assert result["symptomatic_days"] == 1


def test_local_day_boundary_is_respected():
    first = datetime(2026, 1, 1, 22, 30, tzinfo=timezone.utc)
    second = first + timedelta(hours=1)
    req = PatternRequest(timezone="Europe/Zurich",
        meals=[Meal(occurred_at=first-timedelta(minutes=10), ingredient_ids=["onion"])],
        checkins=[Checkin(occurred_at=first, symptoms={"pain":5}),
                  Checkin(occurred_at=second, symptoms={"pain":5})])
    assert patterns(req)["observations"] == 2
    req.timezone = "UTC"
    assert patterns(req)["observations"] == 2


def test_timing_bucket_and_reference_meal_narrow_exposure_window():
    meal = Meal(id="meal-a", occurred_at=BASE, ingredient_ids=["onion"])
    early = patterns(PatternRequest(
        meals=[meal],
        checkins=[Checkin(occurred_at=BASE + timedelta(hours=5), timing_bucket="early", reference_meal_id="meal-a", symptoms={"pain": 5})]))
    mid = patterns(PatternRequest(
        meals=[meal],
        checkins=[Checkin(occurred_at=BASE + timedelta(hours=5), timing_bucket="mid", reference_meal_id="meal-a", symptoms={"pain": 5})]))

    assert early["observations"] == 0
    assert mid["observations"] == 1
    assert next(item for item in mid["timing_summary"] if item["bucket"] == "mid")["count"] == 1


def test_explicit_no_meal_choice_excludes_nearby_ingredients_but_keeps_the_moment():
    result = patterns(PatternRequest(
        meals=[Meal(id="meal-a", occurred_at=BASE, ingredient_ids=["onion"])],
        checkins=[Checkin(
            occurred_at=BASE + timedelta(hours=1),
            symptoms={"pain": 7},
            food_relation="none",
        )],
    ))

    assert result["documented_moments"] == 1
    assert result["observations"] == 0
    assert result["associations"] == []
    assert result["non_food_assessment"]["moments_without_food_window"] == 1
    assert next(item for item in result["timing_summary"] if item["bucket"] == "unknown")["count"] == 0


def test_possible_non_food_signal_keeps_unmatched_moments_visible():
    result = patterns(PatternRequest(
        meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])],
        checkins=[
            Checkin(occurred_at=BASE + timedelta(hours=1), symptoms={"pain": 7}),
            Checkin(occurred_at=BASE + timedelta(hours=2), symptoms={"pain": 0}),
            Checkin(occurred_at=BASE + timedelta(hours=3), symptoms={"pain": 0}),
            Checkin(occurred_at=BASE + timedelta(hours=10), symptoms={"pain": 7}),
            Checkin(occurred_at=BASE + timedelta(hours=11), symptoms={"pain": 7}),
            Checkin(occurred_at=BASE + timedelta(hours=12), symptoms={"pain": 7}),
        ],
        symptom="pain"))
    signal = result["non_food_assessment"]
    assert result["documented_moments"] == 6
    assert signal["status"] == "possible_other_driver"
    assert signal["moments_without_food_window"] == 3


def test_cycle_summary_is_only_enabled_for_the_female_context():
    checkins = [
        Checkin(occurred_at=BASE, cycle_phase="menstruation", cycle_day=2, symptoms={"pain": 7}),
        Checkin(occurred_at=BASE + timedelta(days=14), cycle_phase="ovulation", cycle_day=14, symptoms={"pain": 0}),
    ]
    female = patterns(PatternRequest(meals=[], checkins=checkins, profile_group="female", cycle_enabled=True))
    menstruation = next(item for item in female["cycle_summary"] if item["phase"] == "menstruation")
    assert menstruation["moments"] == 1
    assert menstruation["symptomatic_moments"] == 1

    male = patterns(PatternRequest(meals=[], checkins=checkins, profile_group="male", cycle_enabled=False))
    assert male["cycle_summary"] == []


def test_manual_recipe_flag_and_next_day_stool_observation_feed_candidates():
    result = patterns(PatternRequest(
        meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])],
        checkins=[],
        recipe_flags=[RecipeFlag(recipe_id="recipe-a", kind="reaction", ingredient_ids=["onion"], severity=8)],
        stools=[StoolObservation(
            observed_at=BASE + timedelta(days=1, hours=8),
            observed_for_date=(BASE + timedelta(days=1)).date(),
            quality="watery",
        )]))
    onion = next(item for item in result["possible_ingredients"] if item["ingredient_id"] == "onion")
    assert onion["manual_reactions"] == 1
    assert onion["stool_abnormal"] == 1
    assert result["manual_flag_summary"]["reaction_flags"] == 1
    assert next(item for item in result["stool_summary"] if item["quality"] == "watery")["count"] == 1


def test_only_explicit_normalized_stress_is_used_and_raw_metrics_are_reported():
    result = patterns(PatternRequest(
        meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])],
        checkins=[Checkin(occurred_at=BASE + timedelta(hours=1), symptoms={"pain": 6})],
        stress_observations=[
            StressObservation(source="apple_healthkit", metric="hrv", value=32, unit="ms", observed_at=BASE),
            StressObservation(source="apple_healthkit", metric="stress_score", value=70, unit="percent", normalized_stress=7, observed_at=BASE),
        ],
    ))
    assert result["stress_summary"]["normalized_count"] == 1
    assert result["stress_summary"]["raw_metric_count"] == 1
    assert result["stress_summary"]["last_normalized_score"] == 7
    assert "Raw HRV" in result["method"]


def test_stress_is_summarized_against_symptom_moments():
    result = patterns(PatternRequest(
        meals=[],
        checkins=[
            *[Checkin(occurred_at=BASE + timedelta(hours=i), stress=8, symptoms={"pain": 6}) for i in range(3)],
            *[Checkin(occurred_at=BASE + timedelta(hours=i + 3), stress=2, symptoms={"pain": 0}) for i in range(3)],
        ],
        symptom="pain",
    ))
    assessment = result["stress_assessment"]
    assert assessment["status"] == "more_symptoms_at_higher_stress"
    assert assessment["high_stress_moments"] == 3
    assert assessment["lower_stress_moments"] == 3
    assert assessment["high_stress_rate"] == 1
    assert assessment["lower_stress_rate"] == 0
