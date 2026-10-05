"""Narrow HTML adapters for verified public publisher templates.

These run only on their named hosts, require complete recipe evidence and do
not execute scripts or call hidden APIs. Template changes fail closed (no
candidate); generic JSON-LD/Microdata handling remains available afterwards.
"""

import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from app.recipe_html import text
from app.recipe_fields import plain_text


def _lines(node):
    """Split actual block/break boundaries, not spans inside an ingredient."""
    copy = BeautifulSoup(str(node), "html.parser")
    for br in copy.select("br"):
        br.replace_with("\n")
    for block in copy.select("p, li"):
        block.insert_after("\n")
    return [" ".join(line.split()) for line in copy.get_text().splitlines() if line.strip()]


def _rich_text_cards(soup):
    recipes = []
    for card in soup.select("[data-rich-text-recipe-card]"):
        sections = {}
        for heading in card.select("h3"):
            label = text(heading).casefold()
            if label in {"zutaten", "zubereitung"} and heading.parent.has_attr("data-rich-text-component"):
                sections[label] = heading.parent.find_next_sibling("div")
        ingredients_node, steps_node = sections.get("zutaten"), sections.get("zubereitung")
        title = text(card.select_one("h2"))
        if not title or ingredients_node is None or steps_node is None:
            continue
        ingredients = [line for node in ingredients_node.select("p, li")
                       if not node.find(["p", "li"]) for line in _lines(node)]
        steps = [text(node) for node in steps_node.select("ol > li")]
        # A direct yield node is preferable to scraping all numbers in the card.
        yields = [text(node) for node in card.select("div")
                  if not node.find("div") and re.fullmatch(r"\d+ Portionen?", text(node))]
        if ingredients and steps:
            recipes.append({"name": title, "recipeIngredient": ingredients,
                            "recipeInstructions": steps, "recipeYield": yields[0] if yields else ""})
    return recipes


def _springlane(soup):
    # The Shopify article contains a recipe as <br>-delimited text, not JSON-LD.
    # Require the observed ordered structure: ingredient heading, bullet lines,
    # preparation heading, numbered steps, then a known non-recipe boundary.
    body = soup.select_one(".post-content")
    title = text(soup.select_one("h1.entry-title"))
    if body is None or not title:
        return []
    lines = _lines(body)
    starts = [(i, re.fullmatch(r"Zutaten für (.+):", line)) for i, line in enumerate(lines)]
    starts = [(i, match) for i, match in starts if match]
    if len(starts) != 1 or lines.count("Zubereitung") != 1:
        return []
    start, match = starts[0]
    end = lines.index("Zubereitung")
    ingredient_lines = lines[start + 1:end]
    if not ingredient_lines or not all(re.match(r"^[-•] \S", line) for line in ingredient_lines):
        return []
    steps, current, expected, bounded = [], [], 1, False
    for line in lines[end + 1:]:
        if line in {"Tipps & Variationen", "Tipps", "Serviervorschlag", "Fazit"}:
            bounded = True
            break
        step = re.match(r"^Schritt (\d+):\s*\S", line)
        if step:
            if int(step[1]) != expected or (expected > 1 and not current):
                return []
            if current:
                steps.append(" ".join(current))
            expected += 1
            current = []
        elif expected > 1:
            current.append(line)
        else:
            return []
    if current:
        steps.append(" ".join(current))
    if not steps or not bounded:
        return []
    return [{"name": title, "recipeIngredient": [line[2:] for line in ingredient_lines],
             "recipeInstructions": steps, "recipeYield": match[1]}]


def site_recipes(soup, source_url):
    host = (urlsplit(source_url).hostname or "").lower().removeprefix("www.")
    if host == "zuckerjagdwurst.com":
        return _rich_text_cards(soup)
    if host == "springlane.de":
        return _springlane(soup)
    return []


def refine_same_recipe(soup, source_url, recipe):
    """Recover FOOBY's preparation qualifiers and separate ingredient groups.

Its schema aggregates repeated ingredients (e.g. two salt quantities) and drops
details such as how much juice to use. Only replace the ingredient field when
the unique visible recipe title matches this exact structured candidate.
    """
    host = (urlsplit(source_url).hostname or "").lower().removeprefix("www.")
    titles, lists = soup.select("h1"), soup.select(".recipe-ingredientlist")
    if host != "fooby.ch" or len(titles) != 1 or len(lists) != 1:
        return recipe, False
    name = recipe.get("name")
    if not isinstance(name, str) or plain_text(name) != text(titles[0]):
        return recipe, False
    rows = lists[0].select(".recipe-ingredientlist__ingredient-wrapper")
    ingredients = []
    for row in rows:
        description = text(row.select_one(".recipe-ingredientlist__ingredient-desc"))
        if not description:
            return recipe, False
        quantity = text(row.select_one(".recipe-ingredientlist__ingredient-quantity"))
        ingredients.append(" ".join(filter(None, [quantity, description])))
    if not ingredients:
        return recipe, False
    return {**recipe, "recipeIngredient": ingredients}, True
