"""Synthetic regressions from the multi-platform audit; no copied recipes."""

import json

import pytest

from app.recipe_fields import plain_text, serving_count, strings
from app.recipe_scraper import parse_recipe_document


@pytest.mark.parametrize("raw,count", [
    (4, 4), (4.0, 4), ("Für 4 Personen", 4), ("4 Portion(en)", 4),
    ("2 personnes", 2), ("6 personnes", 6), ("Serves 4", 4),
    (["4", "4 servings (1.5 cups each)"], 4),
    (["4", "4 (~2/3 cup servings)"], 4),
    (["4", "4 Portionen"], 4), (["4", "6 Portionen"], None),
    (["6", "6 Stück"], None), (["13", "13 pancakes"], None),
    (["10", "1 loaf"], None), (["6", "16 pancakes"], None),
    ("etwa 7 Stück", None), ("Makes 12", None), ("4–6 Portionen", None),
    ("4 - 6 servings", None), ("1/2 Portion", None), (0, None), (51, None),
    (True, None), (None, None), ({"amount": 4}, None), (4.5, None),
])
def test_portions_never_confuse_pieces_ranges_or_conflicting_counts(raw, count):
    assert serving_count(raw)[0] == count


def test_original_yield_is_kept_for_user_review():
    assert serving_count(["6", "6 Stück"]) == (None, "6 / 6 Stück")


@pytest.mark.parametrize("raw,expected", [
    ("&frac14; TL Salz", "¼ TL Salz"),
    ("Zucker &amp; Salz", "Zucker & Salz"),
    ("&amp;agrave;", "à"),
    ("you&#39;re", "you're"),
    ("<p>1 <strong>Prise</strong> Salz</p>", "1 Prise Salz"),
])
def test_publisher_entities_are_decoded_and_markup_removed(raw, expected):
    assert plain_text(raw) == expected


def test_alnatura_capitalized_step_fields_prefer_text_over_heading_or_url():
    assert strings({"@type": "HowToStep", "Name": "Vorbereitung", "Text": "Testgemüse schneiden.", "Url": "https://example.org"}) == ["Testgemüse schneiden."]
    assert strings({"Name": "Abschnitt", "ItemListElement": [{"Text": "Rühren."}]}) == ["Rühren."]


def test_750g_literal_newlines_in_json_strings_are_tolerated_without_evaluating_js():
    document = '''<script type="application/ld+json">{
      "@type":"Recipe", "name":"Test", "recipeYield":"6 personnes",
      "recipeIngredient":["&frac14; TL Salz"],
      "recipeInstructions":[{"text":"Erst mischen.
      Dann erwärmen &amp;nbsp; und servieren."}]}</script>'''
    result = parse_recipe_document(document, "https://www.750g.com/test")
    assert result.servings == 6
    assert result.ingredients == ["¼ TL Salz"]
    assert result.instructions == "Erst mischen. Dann erwärmen und servieren."
    assert any("Zeilenumbrüche" in warning for warning in result.warnings)


def test_malformed_type_does_not_hide_other_graph_recipes():
    payload = {"@graph": [{"@type": None}, {"@type": "Recipe", "name": "Test", "recipeIngredient": ["Salz"], "recipeInstructions": [{"Text": "Rühren."}], "recipeYield": 4}]}
    result = parse_recipe_document(f'<script type="application/ld+json">{json.dumps(payload)}</script>', "https://example.org")
    assert result.title == "Test"
    assert result.servings == 4
    assert result.instructions == "Rühren."


def test_named_piece_yields_are_visible_in_preview_not_auto_filled():
    payload = {"@type": "Recipe", "name": "Test", "recipeIngredient": ["Salz"], "recipeYield": ["12", "12 Pancakes"]}
    result = parse_recipe_document(f'<script type="application/ld+json">{json.dumps(payload)}</script>', "https://example.org")
    assert result.servings is None
    assert result.original_yield == "12 / 12 Pancakes"
    assert any("12 Pancakes" in warning for warning in result.warnings)
