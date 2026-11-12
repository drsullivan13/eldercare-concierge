#!/usr/bin/env python3
"""Rebuild exact-location daily-life evidence from reviewed provider-page quotes."""

import argparse
from collections import Counter
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "research/daily-life"
OUTPUT = ROOT / "src/data/daily-life-evidence.json"
REPORT = INPUT / "coverage.json"
KINDS = {"dining", "care-support", "staffing", "activity", "trip", "transport"}
ALIASES = {
    "AVENUE": "AVE", "ROAD": "RD", "STREET": "ST", "DRIVE": "DR",
    "BOULEVARD": "BLVD", "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
}


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode()


def clean(text):
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    return re.sub(r"\s+", " ", re.sub(r"[*_]", "", text)).strip()


def words(text):
    return [ALIASES.get(w, w) for w in re.findall(r"[A-Z0-9]+", text.upper())]


def capture(slug, captures):
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        raise ValueError("Invalid capture filename")
    page = captures[slug]
    raw = encode(page)
    status = page.get("status", page.get("metadata", {}).get("statusCode"))
    url = page.get("url", page.get("effectiveUrl"))
    if status != 200 or urlparse(url).scheme != "https" or "/404" in url:
        raise ValueError(f"Unusable provider page: {slug}")
    if date.fromisoformat(page["checkedAt"]).isoformat() != page["checkedAt"]:
        raise ValueError(f"Missing retrieval date: {slug}")
    return {
        "url": url,
        "title": page["title"],
        "checkedAt": page["checkedAt"],
        "text": clean(page.get("text", page.get("markdown", ""))),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def build(directory=INPUT):
    baseline = json.loads((ROOT / "src/data/providers.json").read_bytes())
    regional = json.loads((ROOT / "src/data/regional-markets.json").read_bytes())
    providers = {p["id"]: p for p in baseline}
    research = json.loads((ROOT / "src/data/location-research.json").read_bytes())
    for market in regional:
        providers.update({p["id"]: p for p in market["providers"]})
        research.update(market.get("locationResearch", {}))
    rows = json.loads((directory / "reviewed-pages.json").read_bytes())
    captures = json.loads((directory / "source-captures.json").read_bytes())
    exclusions = json.loads((directory / "excluded-pages.json").read_bytes())
    locations, receipts, seen = {}, {}, set()
    for row in rows:
        pid = row["providerId"]
        if pid not in providers:
            raise ValueError(f"Unknown provider: {pid}")
        provider = providers[pid]
        page = capture(row["capture"], captures)
        identity = capture(row["identityCapture"], captures)
        for slug, item in [(row["capture"], page), (row["identityCapture"], identity)]:
            receipts[slug] = {"sha256": item["sha256"], "url": item["url"]}
        if (pid, page["url"]) in seen:
            raise ValueError(f"Duplicate reviewed page: {pid}")
        seen.add((pid, page["url"]))
        if row["state"] != provider["state"] or row["zip"] != provider["zip"]:
            raise ValueError(f"State or ZIP disagrees: {pid}")
        street = words(row["street"])
        if words(provider["address"])[:len(street)] != street:
            raise ValueError(f"Catalog street disagrees: {pid}: {row['street']} != {provider['address']}")
        if not all(clean(s).lower() in identity["text"].lower()
                   for s in (row["street"], row["city"], row["zip"])):
            raise ValueError(f"Missing source street/city/ZIP: {pid}")
        name = words(row["name"])
        if " ".join(name) not in " ".join(words(identity["title"] + " " + identity["text"])):
            raise ValueError(f"Missing exact community identity: {pid}")
        if urlparse(page["url"]).hostname != urlparse(identity["url"]).hostname:
            raise ValueError(f"Identity is not on the same provider site: {pid}")
        location_base = row["locationBaseUrl"].rstrip("/") + "/"
        if not all((item["url"].rstrip("/") + "/").startswith(location_base)
                   for item in (page, identity)):
            raise ValueError(f"Identity is not the same location path: {pid}")
        record = locations.setdefault(pid, {
            "providerId": pid, "checkedAt": page["checkedAt"], "sources": [], "facts": [],
            "notes": [
                "Provider-reported offerings checked on the linked location pages, not independently audited care quality, current availability or guaranteed delivery.",
                "Missing staffing ratios, per-resident hours or excursion schedules remain unknown. Round-the-clock support is not a staffing ratio.",
                "Confirm current services, eligibility, additional charges and schedules directly with this exact location.",
            ],
        })
        record["checkedAt"] = max(record["checkedAt"], page["checkedAt"], identity["checkedAt"])
        location_evidence = f"{row['name']}; {row['street']}, {row['city']}, {row['state']} {row['zip']}"
        source_id = "daily-life-" + hashlib.sha256(page["url"].encode()).hexdigest()[:14]
        facts = []
        for claim in row["facts"]:
            kind, quote = claim["kind"], clean(claim["quote"])
            if kind not in KINDS or not quote or quote not in page["text"] or not claim["text"].strip():
                raise ValueError(f"Unsupported claim: {pid}: {quote}")
            if kind == "trip" and not re.search(r"\b(outings?|trips?|excursions?)\b", quote, re.I):
                raise ValueError(f"Transport is not an excursion: {pid}")
            numeric = claim.get("numeric")
            if (kind == "staffing") != (numeric is not None):
                raise ValueError(f"Staffing needs explicit numeric evidence: {pid}")
            if numeric:
                if (numeric["unit"] != "hours-per-day" or numeric["value"] != 24
                        or not re.search(r"licensed nursing, 24 hours a day", quote, re.I)
                        or not numeric["population"] or numeric["period"] is not None):
                    raise ValueError(f"Unreviewed staffing metric: {pid}")
            digest = hashlib.sha256(f"{pid}|{kind}|{quote}".encode()).hexdigest()[:16]
            fact = {
                "id": f"daily-life-{digest}", "kind": kind, "text": claim["text"],
                "quote": quote, "sourceId": source_id, "evidence": "provider-reported",
            }
            if numeric:
                fact["numeric"] = numeric
            facts.append(fact)
        if not facts:
            raise ValueError(f"Empty reviewed page: {pid}")
        for item, sid, excerpt in [
            (page, source_id, "\n".join(dict.fromkeys(f["quote"] for f in facts))),
            (identity, "daily-life-" + hashlib.sha256(identity["url"].encode()).hexdigest()[:14],
             location_evidence),
        ]:
            if any(s["id"] == sid for s in record["sources"]):
                continue
            record["sources"].append({
                "id": sid, "url": item["url"], "title": item["title"],
                "publisher": row["publisher"], "checkedAt": item["checkedAt"],
                "publishedAt": None, "access": "full-page", "excerpt": excerpt,
                "locationEvidence": location_evidence + f". Address corroborated at {identity['url']}",
            })
        record["facts"].extend(facts)
    for record in locations.values():
        ids = [f["id"] for f in record["facts"]]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Duplicate fact: {record['providerId']}")
    states = Counter(providers[pid]["state"] for pid in locations)
    kinds = Counter(f["kind"] for r in locations.values() for f in r["facts"])
    prior_provider_facts = {
        pid: [f for f in research.get(pid, {}).get("facts", [])
              if f.get("kind") in {"dining", "amenity", "activity"}
              and any(s.get("id") == f["sourceId"] and s.get("kind") == "provider"
                      for s in research.get(pid, {}).get("sources", []))]
        for pid in locations
    }
    stats = {
        "providers": len(locations), "byState": dict(states),
        "reviewedPages": len(rows), "retainedCaptures": len(captures),
        "publishedSourceCaptures": len(receipts),
        "facts": sum(kinds.values()), "byKind": dict(kinds),
        "withExistingReviewAggregates": sum(bool(research.get(pid, {}).get("reviewAggregates")) for pid in locations),
        "withoutPriorProviderDailyLifeFacts": sum(not fs for fs in prior_provider_facts.values()),
    }
    return {"schemaVersion": 1, "locations": locations}, {"stats": stats, "captures": receipts, "exclusions": exclusions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the published artifact or receipts differ")
    args = parser.parse_args()
    output, report = build()
    for path, value in [(OUTPUT, output), (REPORT, report)]:
        content = encode(value)
        if args.check:
            if not path.exists() or path.read_bytes() != content:
                raise SystemExit(f"Stale daily-life output: {path.relative_to(ROOT)}")
        else:
            path.write_bytes(content)
    print(json.dumps(report["stats"], sort_keys=True))


if __name__ == "__main__":
    main()
