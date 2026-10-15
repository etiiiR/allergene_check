"""Opt-in, bounded live sample audit; NOT a crawler or a normal unit test.

One user-selected recipe per domain, at most four parallel domains. Uses the
production downloader including robots.txt, redirect validation and size limits.
Ignored HTML snapshots allow offline before/after comparisons without repeated
requests. Reports contain only metadata, never complete third-party recipes.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recipe_scraper import _download_document, parse_recipe_document


def audit_sample(sample, cache, offline):
    key = hashlib.sha256(sample["url"].encode()).hexdigest()[:20]
    html_file, meta_file = cache / f"{key}.html", cache / f"{key}.json"
    row = dict(sample)
    try:
        if offline:
            meta = json.loads(meta_file.read_text())
            if "failure" in meta:
                return {**row, **meta["failure"], "fetched_at": meta["fetched_at"]}
            document = html_file.read_text()
        else:
            fetched_at = datetime.now(timezone.utc).isoformat()
            try:
                document, final_url, warnings = _download_document(sample["url"], True)
            except HTTPException as exc:
                failure = {"status": "download_failed", "http_status": exc.status_code, "error": str(exc.detail)}
                meta_file.write_text(json.dumps({"fetched_at": fetched_at, "failure": failure}, ensure_ascii=False))
                return {**row, **failure, "fetched_at": fetched_at}
            meta = {"final_url": final_url, "warnings": warnings, "fetched_at": fetched_at}
            html_file.write_text(document)
            meta_file.write_text(json.dumps(meta, ensure_ascii=False))
        row.update(fetched_at=meta["fetched_at"], final_url=meta["final_url"],
                   html_sha256=hashlib.sha256(document.encode()).hexdigest(), html_bytes=len(document.encode()))
        result = parse_recipe_document(document, meta["final_url"], meta["warnings"])
        # A nonempty title/list is a structural check, not an accuracy claim.
        complete = bool(result.title and result.title != "Importiertes Rezept" and result.ingredients and result.instructions)
        row.update(status="parsed" if complete else "incomplete", title=result.title,
                   method=result.extraction_method, ingredient_count=len(result.ingredients),
                   instruction_count=len(result.instructions.splitlines()), servings=result.servings,
                   original_yield=result.original_yield,
                   warnings=result.warnings)
    except HTTPException as exc:
        row.update(status="parse_failed", http_status=exc.status_code, error=str(exc.detail))
    except Exception as exc:
        row.update(status="unexpected_error", error=f"{type(exc).__name__}: {exc}")
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).resolve().parents[1] / "tests/fixtures/recipe_platforms.json")
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--verify", action="store_true", help="Exit nonzero on parser errors or changed sample expectations; known download restrictions are reported separately")
    parser.add_argument("--platform", help="Restrict to one exact platform name")
    args = parser.parse_args()
    samples = json.loads(args.manifest.read_text())
    if args.platform:
        samples = [sample for sample in samples if sample["platform"] == args.platform]
        if not samples:
            parser.error("Unknown platform")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(lambda sample: audit_sample(sample, args.cache_dir, args.offline), samples))
    for row in rows:
        if expected := row.get("expected"):
            mismatches = {key: {"expected": value, "actual": row.get(key)}
                          for key, value in expected.items() if row.get(key) != value}
            row["verification"] = "failed" if mismatches else "passed"
            if mismatches:
                row["mismatches"] = mismatches
    report = {"audited_at": datetime.now(timezone.utc).isoformat(), "offline": args.offline,
              "samples": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for row in rows:
        print(row["platform"], row["status"], row.get("ingredient_count", "-"),
              row.get("servings", "-"), row.get("error", ""), flush=True)
    if args.verify and any(row["status"] in {"parse_failed", "unexpected_error", "incomplete"}
                           or row.get("verification") != "passed" for row in rows):
        sys.exit(1)


if __name__ == "__main__":
    main()
