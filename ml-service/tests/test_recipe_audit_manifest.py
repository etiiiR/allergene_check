"""Validate the audit inventory offline; never contact publishers in CI."""

import json
from pathlib import Path
from urllib.parse import urlsplit


def test_audit_covers_at_least_30_additional_distinct_platforms_with_explicit_expectations():
    samples = json.loads((Path(__file__).parent / "fixtures/recipe_platforms.json").read_text())
    additional = [s for s in samples if "Swissmilk" not in s["platform"]]
    hosts = {urlsplit(s["url"]).hostname.removeprefix("www.") for s in additional}
    assert len(additional) == len(hosts) >= 30
    assert len({s["url"] for s in samples}) == len(samples)
    for sample in samples:
        expected = sample["expected"]
        assert urlsplit(sample["url"]).scheme == "https"
        if expected["status"] == "parsed":
            assert expected["title"]
            assert expected["ingredient_count"] > 0
            assert expected["instruction_count"] > 0
            assert expected["servings"] is None or 1 <= expected["servings"] <= 50
        else:
            assert expected["status"] == "download_failed"
            assert expected["http_status"] == 403
