"""Minimal authored markup fixtures, matching observed publisher structure."""

import pytest
from fastapi import HTTPException

from app.recipe_scraper import parse_recipe_document


RICH_CARD = '''<section data-rich-text-recipe-card>
<div><h2>Testauflauf</h2></div><div><div>4 Portionen</div></div>
<div><div data-rich-text-component><h3>Zutaten</h3></div><div>
<h4>Für die Basis:</h4><p>200 g <a href="/">Kartoffeln</a><br>1 Prise Salz</p>
<h4>Für die Soße:</h4><p>20 g Butter<br>100 ml Milch<br>1 Prise Salz</p>
</div></div>
<div><div data-rich-text-component><h3>Zubereitung</h3></div><div>
<ol><li><p>Testzutaten mischen.</p></li></ol><ol start="2"><li><p>Erwärmen.</p></li></ol>
</div></div></section>'''


SPRINGLANE = '''<h1 class="entry-title">Testpfannkuchen</h1>
<div class="post-content">Einleitende Werbung<br>Zutaten für 7 Stück:<br>
- 100 g Mehl<br>- 2 Eier<br>- 1 Prise Salz<br>
Zubereitung<br>Schritt 1: Vorbereiten<br>Testzutaten mischen.<br>
Schritt 2: Fertigstellen<br>Erwärmen.<br>Tipps &amp; Variationen<br>
- Werbung und Varianten nicht als Zutat aufnehmen.<br>Fazit<br>Werbung</div>'''


def test_rich_text_card_replaces_collapsed_schema_groups_without_losing_repeated_ingredients():
    schema = '''<script type="application/ld+json">{"@type":"Recipe","name":"Testauflauf",
      "recipeIngredient":["Für die Basis:","200 g Kartoffeln 1 Prise Salz"],"recipeInstructions":["Mischen."]}</script>'''
    result = parse_recipe_document(schema + RICH_CARD, "https://www.zuckerjagdwurst.com/de/rezepte/test")
    assert result.extraction_method == "html_site"
    assert result.ingredients == ["200 g Kartoffeln", "1 Prise Salz", "20 g Butter", "100 ml Milch", "1 Prise Salz"]
    assert result.instructions == "Testzutaten mischen.\nErwärmen."
    assert result.servings == 4
    assert any("HTML-Rezeptblock" in warning for warning in result.warnings)


def test_rich_cards_do_not_mix_multiple_recipes_or_page_lists():
    second = RICH_CARD.replace("Testauflauf", "Empfehlung").replace("Kartoffeln", "Karotten")
    result = parse_recipe_document(RICH_CARD + second + '<ul><li>Newsletter</li></ul>', "https://zuckerjagdwurst.com/test")
    assert len(result.ingredients) == 5
    assert "Karotten" not in " ".join(result.ingredients)
    assert any("mehrere Rezepte" in warning for warning in result.warnings)


def test_springlane_delimited_recipe_excludes_intro_tips_and_marketing():
    result = parse_recipe_document(SPRINGLANE, "https://springlane.de/blogs/rezepte/test")
    assert result.ingredients == ["100 g Mehl", "2 Eier", "1 Prise Salz"]
    assert result.instructions == "Testzutaten mischen.\nErwärmen."
    assert result.servings is None
    assert result.original_yield == "7 Stück"


@pytest.mark.parametrize("markup,url", [
    (RICH_CARD, "https://zuckerjagdwurst.com.evil.example/test"),
    (SPRINGLANE, "https://not-springlane.de/test"),
    (SPRINGLANE.replace("- 2 Eier", "Unmarkierter Text"), "https://springlane.de/test"),
    (SPRINGLANE.replace("Schritt 2:", "Schritt 4:"), "https://springlane.de/test"),
    (SPRINGLANE.replace("Tipps &amp; Variationen", "Unbekannt").replace("Fazit", "Unbekannt"), "https://springlane.de/test"),
    (RICH_CARD.replace("Zubereitung", "Weitere Artikel"), "https://zuckerjagdwurst.com/test"),
])
def test_site_adapters_reject_unrecognized_hosts_and_incomplete_recipe_structure(markup, url):
    with pytest.raises(HTTPException) as exc:
        parse_recipe_document(markup, url)
    assert exc.value.status_code == 422


FOOBY = '''<script type="application/ld+json">{"@type":"Recipe","name":"Test",
  "recipeIngredient":["2 Prisen Salz", "1 Zitrone"],"recipeInstructions":["Mischen."],"recipeYield":"4"}</script>
  <h1>Test</h1><div class="recipe-ingredientlist">
  <div class="recipe-ingredientlist__ingredient-wrapper"><span class="recipe-ingredientlist__ingredient-quantity">1 Prise</span><span class="recipe-ingredientlist__ingredient-desc">Salz</span></div>
  <div class="recipe-ingredientlist__ingredient-wrapper"><span class="recipe-ingredientlist__ingredient-quantity">1</span><span class="recipe-ingredientlist__ingredient-desc">Zitrone, 1 EL Saft</span></div>
  <div class="recipe-ingredientlist__ingredient-wrapper"><span class="recipe-ingredientlist__ingredient-quantity">1 Prise</span><span class="recipe-ingredientlist__ingredient-desc">Salz</span></div></div>'''


def test_fooby_recovers_quantities_and_qualifiers_from_the_same_recipe_only():
    result = parse_recipe_document(FOOBY, "https://fooby.ch/de/rezepte/test")
    assert result.ingredients == ["1 Prise Salz", "1 Zitrone, 1 EL Saft", "1 Prise Salz"]
    assert result.extraction_method == "json_ld+html"
    assert result.instructions == "Mischen."
    assert result.servings == 4


@pytest.mark.parametrize("markup,url", [
    (FOOBY.replace("<h1>Test", "<h1>Anderes Rezept"), "https://fooby.ch/test"),
    (FOOBY, "https://notfooby.ch/test"),
    (FOOBY + "<h1>Weitere Rezepte</h1>", "https://fooby.ch/test"),
])
def test_fooby_cannot_merge_unrelated_or_ambiguous_recipe_lists(markup, url):
    result = parse_recipe_document(markup, url)
    assert result.ingredients == ["2 Prisen Salz", "1 Zitrone"]
