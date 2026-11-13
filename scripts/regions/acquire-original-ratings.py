#!/usr/bin/env python3
"""Replay factual original-rating receipts without collecting or publishing pages."""

import argparse
import collections
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "research/north-jersey/experience-acquisition/original-sources"
RUNTIME = ROOT / "research/north-jersey/runtime"
DENIED = {
    "aplaceformom.com", "senioradvisor.com", "nursinghomes.com",
    "caring.com", "care-one.com", "seniorcare.com", "yelp.com",
    "assistedlivingcenter.com", "seniorsite.org", "mylivingchoice.com",
    "facebook.com",
}


def load(path):
    return json.loads(path.read_text())


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def host(url):
    return (urlsplit(url).hostname or "").lower().rstrip(".").removeprefix("www.")


def forbidden(url):
    name = host(url)
    return any(name == item or name.endswith("." + item) for item in DENIED)


def release_module():
    path = ROOT / "scripts/regions/release-reviews.py"
    spec = importlib.util.spec_from_file_location("original_rating_release", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def assess(row, policies, providers, crosswalk, release):
    reasons = []
    policy = policies.get(host(row["url"]))
    if forbidden(row["url"]):
        reasons.append("Source is restricted or outside this agent's collection scope.")
    if not policy or policy["decision"] != "permitted-low-volume":
        reasons.append("No completed permitted access assessment.")
    if row.get("inspection") != "full-page" or row.get("httpStatus") != 200:
        reasons.append("No successful full-page inspection.")
    if row.get("sourceType") != "review-platform":
        reasons.append("Provider promotion/testimonials cannot supply eligible scores.")
    if row.get("syndication") != "original":
        reasons.append("Original independent review-family provenance is not established.")
    if row.get("ratingKind") != "consumer-average":
        reasons.append("No published consumer average; proprietary scores are not means.")
    aggregate = row.get("aggregate")
    if not aggregate:
        reasons.append("No complete published mean, scale and count.")
    if row.get("identityStatus") != "exact-unit":
        reasons.append("Exact office or care-unit identity is not resolved.")
    if row.get("population") != "consumer":
        reasons.append("Consumer population is ambiguous or unverified.")
    if row.get("providerId") not in providers:
        reasons.append("No unique active runtime provider match.")
    if reasons:
        return reasons
    observed = {
        "officialId": row["officialId"], "providerId": row["providerId"],
        "identity": row["identity"],
    }
    try:
        release.validate_identity(row, observed, providers, crosswalk)
    except (ValueError, KeyError) as error:
        reasons.append(str(error))
    return reasons


def build(directory=OUTPUT, assessment_date="2026-11-13"):
    release = release_module()
    if not release.valid_date(assessment_date):
        raise ValueError("Invalid assessment date")
    providers = {p["id"]: p for p in load(RUNTIME / "providers.json")}
    crosswalk = load(RUNTIME / "crosswalk.json")
    retained = load(RUNTIME / "locationResearch.json")
    policies_doc = load(directory / "source-access.json")
    policies = {p["host"]: p for p in policies_doc["sources"]}
    receipts_doc = load(directory / "checked-pages.json")
    receipts = receipts_doc["observations"]
    ids = [row["id"] for row in receipts]
    if len(ids) != len(set(ids)):
        raise ValueError("Repeated receipt ID")
    baseline_input = {
        key: {"sources": retained.get(key, {}).get("sources", []),
              "reviewAggregates": retained.get(key, {}).get("reviewAggregates", [])}
        for key in providers
    }
    baseline = release.score(baseline_input, assessment_date)
    combined = copy.deepcopy(baseline_input)
    candidates, exclusions = [], []
    source_totals = collections.defaultdict(collections.Counter)
    for index, row in enumerate(receipts):
        source_totals[row["platform"]]["fullPageChecks" if row.get("inspection") == "full-page"
                                      else "accessGaps"] += 1
        reasons = assess(row, policies, providers, crosswalk, release)
        if reasons:
            exclusions.append({"id": row["id"], "providerId": row.get("providerId"),
                               "url": row["url"], "reasons": reasons})
            source_totals[row["platform"]]["excluded"] += 1
            continue
        source_id = "original-acquisition-" + row["id"]
        source = {"id": source_id, "url": row["url"], "kind": row["sourceType"],
                  "checkedAt": row["checkedAt"], "access": "full-page"}
        aggregate = {"sourceId": source_id, "platform": row["platform"],
                     **row["aggregate"]}
        combined[row["providerId"]]["sources"].append(source)
        combined[row["providerId"]]["reviewAggregates"].append(aggregate)
        candidates.append({"providerId": row["providerId"], "officialId": row["officialId"],
                           "source": source, "aggregate": aggregate,
                           "observation": {"path": str((directory / "checked-pages.json").relative_to(ROOT)),
                                           "sha256": sha(directory / "checked-pages.json"),
                                           "pointer": f"/observations/{index}"},
                           "status": "awaiting-independent-editorial-review"})
        source_totals[row["platform"]]["candidates"] += 1
    after = release.score(combined, assessment_date)
    candidate_only = {}
    for row in candidates:
        record = candidate_only.setdefault(row["providerId"], {"sources": [], "reviewAggregates": []})
        record["sources"].append(row["source"])
        record["reviewAggregates"].append(row["aggregate"])
    alone = release.score(candidate_only, assessment_date) if candidate_only else {}
    counties = collections.defaultdict(set)
    for row in crosswalk:
        if row.get("status") == "included" and row.get("providerId") in providers:
            counties[row["providerId"]].add(row.get("county") or "unresolved")
    coverage = []
    for key, provider in providers.items():
        checks = [r["id"] for r in receipts if r.get("providerId") == key]
        coverage.append({
            "providerId": key, "name": provider["name"], "address": provider["address"],
            "city": provider["city"], "zip": provider["zip"], "category": provider["category"],
            "counties": sorted(counties[key]) or ["unresolved"],
            "baselineScore": baseline[key]["value"], "candidateScore": after[key]["value"],
            "baselineReportedReviewCount": baseline[key]["reviewCount"],
            "priority": ("sparse-unscored" if baseline[key]["value"] is None
                         and baseline[key]["reviewCount"] > 0 else
                         "unscored" if baseline[key]["value"] is None else "already-scored"),
            "status": "page-checked" if checks else "not-page-checked",
            "receiptIds": checks,
        })
    gained = [p for p in providers if baseline[p]["value"] is None and after[p]["value"] is not None]
    inputs = [RUNTIME / name for name in
              ("providers.json", "crosswalk.json", "locationResearch.json")]
    inputs += [directory / "source-access.json", directory / "checked-pages.json",
               Path(__file__), ROOT / "src/lib/experience-score.ts",
               ROOT / "scripts/regions/release-reviews.py"]
    summary = {
        "assessmentDate": assessment_date, "activeRuntimeRecords": len(providers),
        "baselineScored": sum(r["value"] is not None for r in baseline.values()),
        "afterScored": sum(r["value"] is not None for r in after.values()),
        "newlyScoredProviderIds": gained, "candidateCount": len(candidates),
        "observedPages": len(receipts), "excludedPages": len(exclusions),
        "sourceTotals": dict(source_totals),
        "sourceAccessDecisions": dict(collections.Counter(p["decision"] for p in policies.values())),
        "countyCoverage": {
            county: {"records": sum(county in r["counties"] for r in coverage),
                     "pageChecked": sum(county in r["counties"] and bool(r["receiptIds"]) for r in coverage)}
            for county in sorted({c for r in coverage for c in r["counties"]})
        },
        "inputs": [{"path": str(p.relative_to(ROOT)), "sha256": sha(p)} for p in inputs],
        "limitations": [
            "Catalog records include separately licensed units and active registrations, not unique physical businesses.",
            "Searches and source-wide policy checks do not count as exact-unit full-page checks.",
            "Not-page-checked means unsearched or discovery-only, never no reviews exist.",
            "No source narratives, reviewer identities, inferred unit matches or hypothetical restricted-source scores are released.",
            "No runtime publication or independent editorial approval occurred.",
        ],
    }
    return {
        "candidates.json": {"schemaVersion": 1, "assessmentDate": assessment_date, "candidates": candidates},
        "exclusions.json": exclusions,
        "coverage.json": coverage,
        "score-verification.json": {"baseline": baseline, "combined": after, "candidateOnly": alone},
        "summary.json": summary,
        "approval-ledger.json": {"schemaVersion": 1, "assessmentDate": assessment_date, "approvals": []},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", default="2026-11-13")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = build(assessment_date=args.as_of)
    for name, value in outputs.items():
        path = OUTPUT / name
        data = encoded(value)
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                raise SystemExit(f"Output drift: {path}")
        else:
            path.write_bytes(data)
    summary = outputs["summary.json"]
    print(json.dumps({k: summary[k] for k in
                      ("activeRuntimeRecords", "candidateCount", "baselineScored",
                       "afterScored", "newlyScoredProviderIds", "observedPages")}))


if __name__ == "__main__":
    main()
