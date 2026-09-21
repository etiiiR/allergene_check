from datetime import datetime, timedelta, timezone
from app.diary_analysis import Checkin, Meal, PatternRequest, extract_line, patterns

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


def test_duplicates_in_a_day_do_not_inflate_evidence():
    result = patterns(PatternRequest(
        meals=[Meal(occurred_at=BASE, ingredient_ids=["onion"])],
        checkins=[Checkin(occurred_at=BASE + timedelta(hours=h), symptoms={"bloating": 7}) for h in range(1, 5)]))
    assert result["observations"] == 1
    assert result["associations"][0]["exposed"] == 1


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
    assert result["observations"] == 1
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
    assert patterns(req)["observations"] == 1
