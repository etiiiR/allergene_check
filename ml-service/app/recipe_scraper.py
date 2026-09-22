"""Small, review-first recipe importer.

The importer deliberately accepts only Schema.org Recipe JSON-LD. That keeps the
skeleton predictable and avoids pretending that arbitrary page HTML is a recipe.
It also validates every redirect before fetching it, which is important for a
server-side URL fetcher running next to a private database.
"""

import ipaddress
import json
import socket
from typing import Any
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


USER_AGENT = "BauchgefuehlRecipeImporter/0.1 (+local diary; contact site owner before use)"
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3

router = APIRouter(prefix="/diary", tags=["Recipe import"])


class ScrapeRequest(BaseModel):
    """A URL supplied by the user for one preview import."""

    url: str = Field(..., min_length=8, max_length=2048)
    respect_robots: bool = True


class ScrapeResponse(BaseModel):
    """Recipe fields the Go UI can show for confirmation before saving."""

    title: str
    ingredients: list[str]
    instructions: str
    source_url: str
    image: str | None = None
    author: str | None = None
    warnings: list[str] = []


def _validate_public_url(value: str) -> str:
    """Allow public HTTP(S) hosts and reject local/private SSRF destinations."""

    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Nur öffentliche HTTP- oder HTTPS-Adressen sind erlaubt.")

    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise HTTPException(status_code=422, detail="Lokale oder interne Adressen sind nicht erlaubt.")

    try:
        addresses = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except (OSError, ValueError):
        raise HTTPException(status_code=422, detail="Die Rezept-Adresse konnte nicht aufgelöst werden.")

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise HTTPException(status_code=422, detail="Lokale oder interne Adressen sind nicht erlaubt.")
    return value


def _strings(value: Any) -> list[str]:
    """Flatten common Schema.org text shapes without inventing page content."""

    if isinstance(value, str):
        text = " ".join(value.split())
        return [text] if text else []
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(_strings(item))
        return result
    if isinstance(value, dict):
        for key in ("text", "name", "description"):
            if isinstance(value.get(key), str):
                return _strings(value[key])
        if "itemListElement" in value:
            return _strings(value["itemListElement"])
    return []


def _first_string(value: Any) -> str | None:
    values = _strings(value)
    return values[0] if values else None


def _find_recipe(value: Any) -> dict[str, Any] | None:
    """Find a Recipe object in JSON-LD, including an @graph wrapper."""

    if isinstance(value, dict):
        types = value.get("@type", [])
        if isinstance(types, str):
            types = [types]
        if any(str(item).lower() == "recipe" for item in types):
            return value
        for key in ("@graph", "mainEntity", "mainEntityOfPage"):
            found = _find_recipe(value.get(key))
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_recipe(item)
            if found:
                return found
    return None


def parse_recipe_document(document: str, source_url: str, warnings: list[str] | None = None) -> ScrapeResponse:
    """Parse one HTML document and return only explicit Schema.org recipe data."""

    notes = list(warnings or [])
    soup = BeautifulSoup(document, "html.parser")
    recipe: dict[str, Any] | None = None
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text()
        if not raw.strip():
            continue
        try:
            found = _find_recipe(json.loads(raw))
        except (json.JSONDecodeError, TypeError):
            notes.append("Ein JSON-LD-Block der Seite war nicht lesbar.")
            continue
        if found:
            recipe = found
            break

    if not recipe:
        raise HTTPException(status_code=422, detail="Diese Seite enthält keine erkennbaren Schema.org-Rezeptdaten.")

    ingredients = _strings(recipe.get("recipeIngredient"))
    instructions = "\n".join(_strings(recipe.get("recipeInstructions")))
    image = _first_string(recipe.get("image"))
    author = _first_string(recipe.get("author"))
    if not ingredients:
        notes.append("Die Seite liefert keine Zutatenliste; bitte vor dem Speichern ergänzen.")
    if not instructions:
        notes.append("Die Seite liefert keine Zubereitung; bitte vor dem Speichern ergänzen.")

    return ScrapeResponse(
        title=_first_string(recipe.get("name")) or "Importiertes Rezept",
        ingredients=ingredients,
        instructions=instructions,
        source_url=source_url,
        image=image,
        author=author,
        warnings=list(dict.fromkeys(notes)),
    )


def _robots_warning(client: httpx.Client, target: str) -> str | None:
    """Return a warning when robots.txt cannot be checked; explicit denial is fatal."""

    parsed = urlsplit(target)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        response = client.get(robots_url)
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            return "robots.txt konnte nicht geprüft werden; Import bitte manuell verifizieren."
        parser = RobotFileParser()
        parser.set_url(robots_url)
        parser.parse(response.text.splitlines())
        if not parser.can_fetch(USER_AGENT, target):
            raise HTTPException(status_code=403, detail="Die Zielseite erlaubt diesen Import laut robots.txt nicht.")
    except HTTPException:
        raise
    except (httpx.HTTPError, UnicodeError):
        return "robots.txt konnte nicht geprüft werden; Import bitte manuell verifizieren."
    return None


def _download_document(target: str, respect_robots: bool) -> tuple[str, str, list[str]]:
    warnings: list[str] = []
    current = _validate_public_url(target)
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}

    with httpx.Client(timeout=8.0, follow_redirects=False, headers=headers) as client:
        if respect_robots:
            warning = _robots_warning(client, current)
            if warning:
                warnings.append(warning)

        for _ in range(MAX_REDIRECTS + 1):
            try:
                with client.stream("GET", current) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise HTTPException(status_code=502, detail="Die Rezeptseite liefert eine ungültige Weiterleitung.")
                        current = _validate_public_url(urljoin(current, location))
                        if respect_robots:
                            warning = _robots_warning(client, current)
                            if warning:
                                warnings.append(warning)
                        continue
                    if response.status_code >= 400:
                        raise HTTPException(status_code=502, detail="Die Rezeptseite konnte nicht geladen werden.")
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > MAX_HTML_BYTES:
                        raise HTTPException(status_code=413, detail="Die Rezeptseite ist zu groß für den Import.")
                    chunks: list[bytes] = []
                    size = 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > MAX_HTML_BYTES:
                            raise HTTPException(status_code=413, detail="Die Rezeptseite ist zu groß für den Import.")
                        chunks.append(chunk)
                    media_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                    if media_type and media_type not in {"text/html", "application/xhtml+xml"}:
                        raise HTTPException(status_code=415, detail="Die Adresse verweist nicht auf eine HTML-Rezeptseite.")
                    encoding = response.encoding or "utf-8"
                    return b"".join(chunks).decode(encoding, errors="replace"), current, warnings
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail="Die Rezeptseite konnte nicht geladen werden.") from exc
        raise HTTPException(status_code=502, detail="Zu viele Weiterleitungen von der Rezeptseite.")


@router.post("/scrape", response_model=ScrapeResponse)
def scrape_recipe(request: ScrapeRequest) -> ScrapeResponse:
    """Fetch one recipe preview; the caller must review and save it separately."""

    document, final_url, warnings = _download_document(request.url, request.respect_robots)
    return parse_recipe_document(document, final_url, warnings)
