"""Small, deterministic normalizers for publisher-supplied recipe fields.

Never infer ingredients or translate them. In particular a yield in pieces is
not automatically a serving count: that decision belongs to the user.
"""

import html
import re
from typing import Any

from bs4 import BeautifulSoup


def plain_text(value: str) -> str:
    # Some publishers double-encode entities inside JSON-LD (e.g. &amp;frac14;).
    for _ in range(2):
        value = html.unescape(value)
    if "<" in value:
        value = BeautifulSoup(value, "html.parser").get_text(" ", strip=True)
    return " ".join(value.split())


def strings(value: Any) -> list[str]:
    """Flatten Schema.org text shapes, including Alnatura's capitalized keys."""
    if isinstance(value, str):
        cleaned = plain_text(value)
        return [cleaned] if cleaned else []
    if isinstance(value, list):
        return [line for item in value for line in strings(item)]
    if isinstance(value, dict):
        fields = {str(key).casefold(): item for key, item in value.items()}
        if "itemlistelement" in fields:
            return strings(fields["itemlistelement"])
        for key in ("text", "name", "description", "url"):
            if isinstance(fields.get(key), str) and fields[key].strip():
                return strings(fields[key])
    return []


def serving_count(value: Any) -> tuple[int | None, str]:
    """Return a certain count and the ORIGINAL yield for transparent review.

Handle numeric JSON, German/French/English serving labels, and equivalent
array entries. Reject ranges, conflicting counts, and named piece/loaf yields,
even if an array starts with an apparently usable bare number.
    """
    values = value if isinstance(value, list) else [value]
    labels = [plain_text(str(item)) for item in values
              if isinstance(item, (str, int, float)) and not isinstance(item, bool)]
    labels = [label for label in labels if label]
    counts, unknown = set(), False
    number = r"(\d{1,2})(?:[.,]0+)?"
    unit = r"(?:Portion(?:en?|\(en\))?|Person(?:en)?|personnes?|servings?|people)"
    pattern = rf"(?:(?:für|for|serves)\s+)?{number}(?:\s*{unit}(?:\s*\([^)]*\))?|\s*\([^)]*\bservings?\))?"
    for label in labels:
        match = re.fullmatch(pattern, label, re.IGNORECASE)
        if not match or not 1 <= int(match[1]) <= 50:
            unknown = True
        else:
            counts.add(int(match[1]))
    count = next(iter(counts)) if len(counts) == 1 and not unknown else None
    return count, " / ".join(dict.fromkeys(labels))
