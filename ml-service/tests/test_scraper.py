import pytest
from fastapi import HTTPException

from app.recipe_scraper import parse_recipe_document


def test_schema_recipe_json_ld_is_imported_without_saving():
    document = """
    <html><head>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"WebPage","@graph":[
        {"@type":"Recipe","name":"Kartoffelsuppe","recipeIngredient":["500 g Kartoffeln","1 Zwiebel"],
         "recipeInstructions":[{"@type":"HowToStep","text":"Kochen."}],"author":{"@type":"Person","name":"Ada"}}
      ]}
      </script>
    </head></html>
    """

    result = parse_recipe_document(document, "https://example.org/suppe")

    assert result.title == "Kartoffelsuppe"
    assert result.ingredients == ["500 g Kartoffeln", "1 Zwiebel"]
    assert result.instructions == "Kochen."
    assert result.author == "Ada"
    assert result.source_url == "https://example.org/suppe"


def test_non_recipe_html_is_rejected():
    with pytest.raises(HTTPException) as error:
        parse_recipe_document("<html><body><h1>Kein Rezept</h1></body></html>", "https://example.org")

    assert error.value.status_code == 422
