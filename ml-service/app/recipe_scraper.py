"""Small, review-first recipe importer.

The importer supports Recipe JSON-LD, HTML Microdata and recognizable recipe
blocks. It returns a reviewable preview, never guesses missing ingredients.
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
from app.recipe_html import microdata_recipes, html_recipes
from app.recipe_fields import strings as _strings, serving_count
from app.recipe_sites import site_recipes, refine_same_recipe


USER_AGENT = "BauchgefuehlRecipeImporter/0.1 (+local diary; contact site owner before use)"
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_ROBOTS_BYTES = 128 * 1024
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
    servings: int | None = None
    original_yield: str = ""
    extraction_method: str = "json_ld"
    warnings: list[str] = Field(default_factory=list)


def _public_destination(value: str) -> tuple[str, str, str]:
    """Validate and resolve a URL to one public IP for a pinned connection."""
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Nur öffentliche HTTP- oder HTTPS-Adressen sind erlaubt.")

    raw_host = parsed.hostname.rstrip(".").lower()
    try:
        literal_ip = ipaddress.ip_address(raw_host)
        host = str(literal_ip)
    except ValueError:
        try:
            host = raw_host.encode("idna").decode("ascii")
        except UnicodeError:
            raise HTTPException(status_code=422, detail="Die Rezept-Adresse konnte nicht aufgelöst werden.")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise HTTPException(status_code=422, detail="Lokale oder interne Adressen sind nicht erlaubt.")

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        ips = [ipaddress.ip_address(address[4][0]) for address in addresses]
    except (OSError, ValueError):
        raise HTTPException(status_code=422, detail="Die Rezept-Adresse konnte nicht aufgelöst werden.")

    # `is_private` alone is not sufficient: shared address space such as
    # 100.64.0.0/10 is neither private nor globally routable. Reject mixed
    # public/private answers, then connect to the checked address itself so
    # the HTTP library cannot perform a second, rebinding DNS lookup.
    if not ips or any(not ip.is_global for ip in ips):
        raise HTTPException(status_code=422, detail="Lokale oder interne Adressen sind nicht erlaubt.")
    return value, host, str(ips[0])


def _validate_public_url(value: str) -> str:
    """Allow public HTTP(S) hosts and reject local/private SSRF destinations."""

    return _public_destination(value)[0]


def _pinned_request(value: str) -> tuple[str, dict[str, str], dict[str, str]]:
    """Build an IP-pinned request while retaining HTTP Host and TLS hostname."""

    _, host, address = _public_destination(value)
    parsed = urlsplit(value)
    ip = ipaddress.ip_address(address)
    pinned_host = f"[{address}]" if ip.version == 6 else address
    port = parsed.port
    pinned_netloc = f"{pinned_host}:{port}" if port is not None else pinned_host
    request_url = parsed._replace(netloc=pinned_netloc, fragment="").geturl()

    host_header = f"[{host}]" if ":" in host else host
    if port is not None:
        host_header = f"{host_header}:{port}"
    request_extensions = {"sni_hostname": host} if parsed.scheme == "https" else {}
    return request_url, {"Host": host_header}, request_extensions


def _new_recipe_client() -> httpx.Client:
    # Do not honor ambient proxy variables: a proxy would resolve/route the
    # target outside the IP-pinning checks performed by this importer.
    return httpx.Client(
        timeout=8.0,
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        trust_env=False,
    )


def _first_string(value: Any) -> str | None:
    values = _strings(value)
    return values[0] if values else None


def _find_recipes(value: Any) -> list[dict[str, Any]]:
    """Find explicit Recipe objects in JSON-LD, including @graph wrappers."""

    if isinstance(value, dict):
        types = value.get("@type", [])
        if isinstance(types, str):
            types = [types]
        if not isinstance(types, list):
            types = []
        if any(str(item).rstrip("/").rsplit("/", 1)[-1].lower() == "recipe" for item in types):
            return [value]
        result = []
        for key in ("@graph", "mainEntity", "mainEntityOfPage"):
            result.extend(_find_recipes(value.get(key)))
        return result
    elif isinstance(value, list):
        result = []
        for item in value:
            result.extend(_find_recipes(item))
        return result
    return []


def parse_recipe_document(document: str, source_url: str, warnings: list[str] | None = None) -> ScrapeResponse:
    """Prefer structured recipe data, then explicitly marked HTML recipe blocks.

    Do not combine different recipe candidates: multi-recipe pages can contain
    recommendations. Each preview is taken from one candidate, with a warning.
    """

    notes = list(warnings or [])
    soup = BeautifulSoup(document, "html.parser")
    candidates: list[tuple[str, dict[str, Any]]] = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text()
        if not raw.strip():
            continue
        try:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                # 750g embeds literal newlines inside JSON strings. Python's
                # strict=False accepts ONLY control characters, never JS/eval.
                payload = json.loads(raw, strict=False)
                notes.append("Zeilenumbrüche in den strukturierten Rezeptdaten wurden bereinigt; bitte Vorschau prüfen.")
            found = _find_recipes(payload)
        except (json.JSONDecodeError, TypeError, RecursionError):
            notes.append("Ein JSON-LD-Block der Seite war nicht lesbar.")
            continue
        candidates.extend(("json_ld", recipe) for recipe in found)

    # JSON has been read. Remove executable/UI noise before extracting text.
    for node in soup.select("script, style, noscript, nav, aside, button, svg, iframe, select, input"):
        node.decompose()
    # Verified site cards can be more accurate than malformed publisher schema:
    # Zucker & Jagdwurst collapses whole ingredient groups in its JSON-LD.
    candidates = [("html_site", recipe) for recipe in site_recipes(soup, source_url)] + candidates
    candidates.extend(("microdata", recipe) for recipe in microdata_recipes(soup))
    candidates.extend(("html", recipe) for recipe in html_recipes(soup))
    # A Recipe stub without ingredients should not hide a usable HTML recipe.
    usable = [(method, recipe) for method, recipe in candidates if _strings(recipe.get("recipeIngredient"))]
    method, recipe = (usable or candidates or [("", None)])[0]

    if not recipe:
        raise HTTPException(status_code=422, detail="Im heruntergeladenen HTML wurde kein eindeutig erkennbares Rezept gefunden. Möglicherweise wird es erst per JavaScript geladen. Bitte Zutaten manuell einfügen.")

    recipe, refined = refine_same_recipe(soup, source_url, recipe)
    if refined:
        method += "+html"
        notes.append("Zutaten einschließlich Mengen und Verwendungshinweisen aus der sichtbaren Liste desselben Rezepts übernommen; bitte prüfen.")

    if method in {"html", "html_site"}:
        notes.append("Aus dem sichtbaren HTML-Rezeptblock gelesen. Bitte Zutaten, Mengen und Zubereitung besonders sorgfältig prüfen.")
    if len({_first_string(item.get("name")) for _, item in usable}) > 1:
        notes.append("Die Seite enthält mehrere Rezepte. Bitte prüfen, ob die Vorschau das gewünschte Rezept zeigt.")

    ingredients = _strings(recipe.get("recipeIngredient"))
    instructions = "\n".join(_strings(recipe.get("recipeInstructions")))
    image = _first_string(recipe.get("image"))
    author = _first_string(recipe.get("author"))
    servings, yield_text = serving_count(recipe.get("recipeYield"))
    if servings is None:
        source_hint = f" (Quellangabe: {yield_text[:120]})" if yield_text else ""
        notes.append(f"Portionszahl nicht eindeutig erkannt{source_hint}; bitte vor dem Speichern prüfen.")
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
        servings=servings,
        original_yield=yield_text,
        extraction_method=method,
        warnings=list(dict.fromkeys(notes)),
    )


def _robots_warning(target: str) -> str | None:
    """Return a warning when robots.txt cannot be checked; explicit denial is fatal."""

    parsed = urlsplit(target)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        request_url, headers, extensions = _pinned_request(robots_url)
        with _new_recipe_client() as client:
            with client.stream("GET", request_url, headers=headers, extensions=extensions) as response:
                if response.status_code == 404:
                    return None
                if response.status_code >= 400:
                    return "robots.txt konnte nicht geprüft werden; Import bitte manuell verifizieren."
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > MAX_ROBOTS_BYTES:
                            return "robots.txt ist zu groß und konnte nicht geprüft werden; Import bitte manuell verifizieren."
                    except ValueError:
                        return "robots.txt konnte nicht geprüft werden; Import bitte manuell verifizieren."
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_ROBOTS_BYTES:
                        return "robots.txt ist zu groß und konnte nicht geprüft werden; Import bitte manuell verifizieren."
                    chunks.append(chunk)
                body = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
        parser = RobotFileParser()
        parser.set_url(robots_url)
        parser.parse(body.splitlines())
        if not parser.can_fetch(USER_AGENT, target):
            raise HTTPException(status_code=403, detail="Die Zielseite erlaubt diesen Import laut robots.txt nicht.")
    except HTTPException:
        raise
    except (httpx.HTTPError, UnicodeError):
        return "robots.txt konnte nicht geprüft werden; Import bitte manuell verifizieren."
    return None


def _download_document(target: str, respect_robots: bool) -> tuple[str, str, list[str]]:
    warnings: list[str] = []
    current = target

    if respect_robots:
        warning = _robots_warning(current)
        if warning:
            warnings.append(warning)

    for _ in range(MAX_REDIRECTS + 1):
        request_url, headers, extensions = _pinned_request(current)
        with _new_recipe_client() as client:
            try:
                with client.stream("GET", request_url, headers=headers, extensions=extensions) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise HTTPException(status_code=502, detail="Die Rezeptseite liefert eine ungültige Weiterleitung.")
                        current = urljoin(current, location)
                        if respect_robots:
                            warning = _robots_warning(current)
                            if warning:
                                warnings.append(warning)
                        continue
                    if response.status_code >= 400:
                        if response.status_code in {401, 403, 429}:
                            raise HTTPException(status_code=response.status_code, detail=f"Die Rezeptplattform blockiert den automatischen Abruf (HTTP {response.status_code}). Bitte Zutaten manuell einfügen.")
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
