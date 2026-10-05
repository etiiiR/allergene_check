"""Recipe extraction from downloaded HTML; no scripts, browser or model needed.

Keep parsing independent of network access so markup variants can be tested
offline. Microdata properties belong to their nearest itemscope, preventing
recommended recipes, ratings or an author's name from leaking into the recipe.
"""

from bs4 import BeautifulSoup, Tag


def text(node: Tag | None) -> str:
    if node is None:
        return ""
    if node.has_attr("content"):
        return " ".join(str(node["content"]).split())
    if node.name == "img":
        return str(node.get("src", ""))
    return " ".join(node.get_text(" ", strip=True).split())


def properties(scope: Tag, name: str) -> list[Tag]:
    return [node for node in scope.select(f'[itemprop~="{name}"]')
            if node.find_parent(attrs={"itemscope": True}) is scope]


def instruction_lines(node: Tag) -> list[str]:
    nodes = node.select('[itemprop~="text"]')
    if not nodes:
        nodes = node.select("li")
        # Nested lists must not duplicate their children in the parent text.
        nodes = [item for item in nodes if not item.find("li")]
    return [value for item in (nodes or [node]) if (value := text(item))]


def microdata_recipes(soup: BeautifulSoup) -> list[dict]:
    recipes = []
    for scope in soup.select("[itemscope][itemtype]"):
        types = str(scope.get("itemtype", "")).split()
        if not any(t.rstrip("/") in {"https://schema.org/Recipe", "http://schema.org/Recipe"} for t in types):
            continue
        # A nested recommended recipe must not be chosen as the main recipe.
        if scope.find_parent(attrs={"itemscope": True, "itemtype": lambda value: value and "schema.org/Recipe" in value}):
            continue
        def first(name):
            values = properties(scope, name)
            return text(values[0]) if values else ""
        ingredients = [text(item) for item in properties(scope, "recipeIngredient")]
        instructions = [line for node in properties(scope, "recipeInstructions") for line in instruction_lines(node)]
        authors = properties(scope, "author")
        author = ""
        if authors:
            names = properties(authors[0], "name") if authors[0].has_attr("itemscope") else []
            author = text(names[0]) if names else text(authors[0])
        recipes.append({
            "name": first("name"), "recipeIngredient": ingredients,
            "recipeInstructions": instructions, "recipeYield": first("recipeYield"),
            "author": author,
            "image": first("image"),
        })
    return recipes


def html_recipes(soup: BeautifulSoup) -> list[dict]:
    """Conservative fallback: a named recipe block AND explicit ingredient and
    instruction containers are required. Never scrape every list on a page.
    These selectors describe common HTML patterns, not guaranteed site support.
    """
    recipes = []
    selector = "article.recipe, .recipe-card, .wprm-recipe-container, .tasty-recipes"
    scopes = soup.select(selector)
    scope_ids = {id(scope) for scope in scopes}
    for scope in scopes:
        def owned_nodes(query):
            # Keep nested recommendations out, even when their lists use the
            # same CSS classes. A nested card can be its own candidate.
            return [node for node in scope.select(query)
                    if next((parent for parent in node.parents if id(parent) in scope_ids), None) is scope]

        titles = owned_nodes(".recipe-title, .wprm-recipe-name, .tasty-recipes-title, h1, h2")
        title = titles[0] if titles else None
        ingredients = owned_nodes(".recipe-ingredients li, .ingredients li, .wprm-recipe-ingredient, .tasty-recipes-ingredients li")
        ingredients = [item for item in ingredients if not item.find("li")]
        steps = owned_nodes(".recipe-instructions li, .instructions li, .wprm-recipe-instruction, .tasty-recipes-instructions li")
        yields = owned_nodes(".recipe-servings, .wprm-recipe-servings, .tasty-recipes-yield")
        # Requiring both lists avoids treating recipe-link cards as a recipe.
        if not text(title) or not ingredients or not steps:
            continue
        recipes.append({
            "name": text(title), "recipeIngredient": [text(item) for item in ingredients],
            "recipeInstructions": [text(item) for item in steps if not item.find("li")],
            "recipeYield": text(yields[0]) if yields else "",
        })
    return recipes
