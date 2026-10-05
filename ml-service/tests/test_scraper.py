import pytest
import httpx
from pathlib import Path
from fastapi import HTTPException

from app.recipe_scraper import parse_recipe_document
from app import recipe_scraper


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


def test_swissmilk_style_microdata_keeps_quantities_units_and_separate_steps():
    document = (Path(__file__).parent / "fixtures" / "recipe_microdata.html").read_text()
    result = parse_recipe_document(document, "https://example.org/recipe")
    assert result.extraction_method == "microdata"
    assert result.title == "Pfannengericht zum Testen"
    assert result.servings == 4
    assert result.author == "Testküche"
    assert result.image == "https://example.org/image.jpg"
    assert len(result.ingredients) == 9
    assert result.ingredients[:4] == ["125 g Mehl", "2,5 dl Milch", "1 Prise Salz", "2 - 3 EL Zucker"]
    assert result.ingredients[-1] == "Puderzucker"
    assert result.instructions.splitlines() == ["Zutaten für den Test mischen.", "In einer Pfanne erwärmen."]
    assert not result.warnings


def test_microdata_does_not_mix_author_rating_or_nested_recommendations():
    document = '''<article itemscope itemtype="https://schema.org/Recipe">
      <div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Ada</span></div>
      <h1 itemprop="name">Suppe</h1><meta itemprop="recipeYield" content="2">
      <p itemprop="recipeIngredient">1 Karotte</p>
      <section itemscope itemtype="https://schema.org/Recipe"><h2 itemprop="name">Werberezept</h2><p itemprop="recipeIngredient">Geheime Zutat</p></section>
      <p itemprop="recipeInstructions">Garen.</p></article>'''
    result = parse_recipe_document(document, "https://example.org")
    assert result.title == "Suppe"
    assert result.author == "Ada"
    assert result.ingredients == ["1 Karotte"]
    assert result.servings == 2


def test_broken_or_incomplete_json_ld_falls_back_to_microdata():
    document = '''<script type="application/ld+json">not json</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Stub"}</script>
      <article itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Suppe</h1>
      <p itemprop="recipeIngredient">1 Karotte</p><p itemprop="recipeInstructions">Garen.</p></article>'''
    result = parse_recipe_document(document, "https://example.org")
    assert result.extraction_method == "microdata"
    assert result.ingredients == ["1 Karotte"]
    assert any("JSON-LD" in warning for warning in result.warnings)


def test_json_ld_wins_when_complete_and_keeps_section_steps_not_only_headings():
    document = '''<script type="application/ld+json">{"@type":"https://schema.org/Recipe", "name":"Suppe",
      "recipeYield":"3 servings","recipeIngredient":["1 Karotte"],
      "recipeInstructions":[{"@type":"HowToSection","name":"Vorbereitung","itemListElement":[
        {"@type":"HowToStep","text":"<p>Gemüse schneiden.</p>"},{"@type":"HowToStep","text":"Kochen."}]}]}</script>
      <article itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Andere Suppe</h1>
      <p itemprop="recipeIngredient">Kein Ersatz</p></article>'''
    result = parse_recipe_document(document, "https://example.org")
    assert result.extraction_method == "json_ld"
    assert result.ingredients == ["1 Karotte"]
    assert result.instructions == "Gemüse schneiden.\nKochen."
    assert result.servings == 3
    assert any("mehrere Rezepte" in warning for warning in result.warnings)


def test_explicit_html_recipe_blocks_and_scoped_ingredient_lists():
    document = '''<nav><ul><li>Newsletter</li></ul></nav><article class="recipe">
      <h1>Suppe</h1><span class="recipe-servings">2 Portionen</span>
      <ul class="ingredients"><li><span>100 g</span> Karotten</li><li>1 Prise Salz</li></ul>
      <ol class="instructions"><li>Würfeln.</li><li>Kochen.</li></ol></article>
      <footer><ul class="ingredients"><li>Keine Rezeptzutat</li></ul></footer>'''
    result = parse_recipe_document(document, "https://example.org")
    assert result.extraction_method == "html"
    assert result.ingredients == ["100 g Karotten", "1 Prise Salz"]
    assert result.instructions == "Würfeln.\nKochen."
    assert result.servings == 2
    assert any("HTML-Rezeptblock" in warning for warning in result.warnings)


@pytest.mark.parametrize("markup", [
    '<article class="recipe"><h1>Rezept-Links</h1><ul><li>Rezept A</li><li>Rezept B</li></ul></article>',
    '<h1>Zutaten</h1><ul><li>Newsletter</li></ul><h2>Zubereitung</h2><p>Werbung</p>',
    '<article class="recipe"><h1>Teaser</h1><ul class="ingredients"><li>Karotte</li></ul></article>',
])
def test_arbitrary_lists_and_incomplete_teasers_are_not_guessed(markup):
    with pytest.raises(HTTPException) as error:
        parse_recipe_document(markup, "https://example.org")
    assert error.value.status_code == 422


@pytest.mark.parametrize("amount", ["12 Stück", "4–6 Portionen", "1 Kuchen", "100 Portionen", "0"])
def test_ambiguous_yield_does_not_silently_become_a_serving_count(amount):
    document = f'<script type="application/ld+json">{{"@type":"Recipe","name":"Test","recipeIngredient":["Salz"],"recipeYield":"{amount}"}}</script>'
    result = parse_recipe_document(document, "https://example.org")
    assert result.servings is None
    assert any("Portionszahl" in warning for warning in result.warnings)


def test_html_nested_recipe_cards_do_not_mix_ingredients():
    document = '''<article class="recipe"><h1>Hauptgericht</h1>
      <ul class="ingredients"><li>Karotte</li></ul><ol class="instructions"><li>Garen.</li></ol>
      <div class="recipe-card"><h2>Empfehlung</h2><ul class="ingredients"><li>Milch</li></ul>
      <ol class="instructions"><li>Rühren.</li></ol></div></article>'''
    result = parse_recipe_document(document, "https://example.org")
    assert result.title == "Hauptgericht"
    assert result.ingredients == ["Karotte"]
    assert result.instructions == "Garen."
    assert any("mehrere Rezepte" in warning for warning in result.warnings)


def mock_public_download(monkeypatch, handler):
    """No real network in regression tests; retain URL/redirect validation."""
    monkeypatch.setattr(recipe_scraper.socket, "getaddrinfo", lambda *a, **kw: [
        (2, 1, 6, "", ("93.184.216.34", 443)),
    ])
    client_class = httpx.Client
    monkeypatch.setattr(recipe_scraper.httpx, "Client", lambda **kw: client_class(
        transport=httpx.MockTransport(handler), **kw,
    ))


def test_download_then_parse_microdata_endpoint_keeps_final_source(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    document = (Path(__file__).parent / "fixtures" / "recipe_microdata.html").read_text()
    visited = []

    def handler(request):
        visited.append(request.url.path)
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /\n")
        if request.url.path == "/old":
            return httpx.Response(302, headers={"location": "/recipe"})
        return httpx.Response(200, text=document, headers={"content-type": "text/html; charset=utf-8"})

    mock_public_download(monkeypatch, handler)
    app = FastAPI()
    app.include_router(recipe_scraper.router)
    response = TestClient(app).post("/diary/scrape", json={"url": "https://example.org/old"})
    assert response.status_code == 200
    assert response.json()["source_url"] == "https://example.org/recipe"
    assert response.json()["servings"] == 4
    assert len(response.json()["ingredients"]) == 9
    assert visited == ["/robots.txt", "/old", "/robots.txt", "/recipe"]


def test_redirect_to_local_address_is_rejected_before_fetching(monkeypatch):
    visited = []

    def handler(request):
        visited.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://localhost:8000/private"})

    mock_public_download(monkeypatch, handler)
    with pytest.raises(HTTPException) as error:
        recipe_scraper._download_document("https://example.org/recipe", False)
    assert error.value.status_code == 422
    assert visited == ["https://example.org/recipe"]


def test_robots_denial_prevents_recipe_download(monkeypatch):
    visited = []

    def handler(request):
        visited.append(request.url.path)
        return httpx.Response(200, text="User-agent: *\nDisallow: /\n")

    mock_public_download(monkeypatch, handler)
    with pytest.raises(HTTPException) as error:
        recipe_scraper._download_document("https://example.org/recipe", True)
    assert error.value.status_code == 403
    assert visited == ["/robots.txt"]


@pytest.mark.parametrize("headers,body,code", [
    ({"content-type": "application/pdf"}, "pdf", 415),
    ({"content-length": "10000000"}, "", 413),
    ({"content-type": "text/html"}, "x" * 65, 413),
])
def test_downloader_keeps_content_type_and_size_limits(monkeypatch, headers, body, code):
    mock_public_download(monkeypatch, lambda request: httpx.Response(200, headers=headers, content=body))
    monkeypatch.setattr(recipe_scraper, "MAX_HTML_BYTES", 64)
    with pytest.raises(HTTPException) as error:
        recipe_scraper._download_document("https://example.org/recipe", False)
    assert error.value.status_code == code


@pytest.mark.parametrize("code", [401, 403, 429])
def test_access_restrictions_are_reported_without_retry_or_bypass(monkeypatch, code):
    visited = []
    def handler(request):
        visited.append(request.url.path)
        return httpx.Response(code)
    mock_public_download(monkeypatch, handler)
    with pytest.raises(HTTPException) as error:
        recipe_scraper._download_document("https://example.org/recipe", False)
    assert error.value.status_code == code
    assert f"HTTP {code}" in error.value.detail
    assert visited == ["/recipe"]
