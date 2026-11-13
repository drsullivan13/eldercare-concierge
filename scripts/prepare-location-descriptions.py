#!/usr/bin/env python3
"""Validate and merge exact-provider North Jersey Overview descriptions offline."""

import argparse
import hashlib
from datetime import date, datetime, timezone
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "research/north-jersey/descriptions"
FIELDS = {"providerId", "summary", "scope", "basis", "sources", "limitations"}
SOURCE_FIELDS = {"url", "publisher", "title", "checkedAt"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key {key}")
        result[key] = value
    return result


def load(path):
    return json.loads(path.read_text(), object_pairs_hook=unique_object)


def active_providers(path):
    markets = load(path)
    matches = [m for m in markets if m.get("id") == "north-jersey"]
    require(len(matches) == 1, "Expected one North Jersey market")
    providers = matches[0]["providers"]
    result = {p["id"]: p for p in providers}
    require(len(result) == len(providers), "Duplicate active provider ID")
    return result


def box_only(address):
    return bool(re.match(r"^\s*P\.?\s*O\.?\s*BOX\b|^\s*POST OFFICE BOX\b", address, re.I))


def expected_scope(provider):
    if provider["category"] in {"home-care", "home-health"}:
        return "service-area" if box_only(provider["address"]) else "agency-office"
    return "campus" if provider["category"] == "life-plan" else "facility"


def valid_source(source, pid):
    require(isinstance(source, dict) and set(source) == SOURCE_FIELDS, f"{pid}: invalid source shape")
    for field in SOURCE_FIELDS:
        require(isinstance(source[field], str) and source[field].strip(), f"{pid}: empty source {field}")
    parsed = urlparse(source["url"])
    host = parsed.hostname or ""
    require(parsed.scheme == "https" and "." in host and not parsed.username and not parsed.password,
            f"{pid}: source must be an external HTTPS URL without credentials")
    require(not (host in {"localhost", "0.0.0.0"} or host.endswith((".local", ".internal"))),
            f"{pid}: source cannot be private")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError(f"{pid}: source must use a public hostname")
    require(not ({"token", "access_token", "api_key", "password", "secret"} & set(parse_qs(parsed.query))),
            f"{pid}: source URL contains credentials")
    checked = source["checkedAt"]
    require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", checked), f"{pid}: checkedAt must be an actual UTC day")
    require(date.fromisoformat(checked) <= datetime.now(timezone.utc).date(),
            f"{pid}: checkedAt is in the future")


def validate_entries(entries, providers, basis, layer):
    require(isinstance(entries, dict), f"{layer}: expected a plain provider-ID object")
    for pid, entry in entries.items():
        require(pid in providers, f"{layer}: orphan provider ID {pid}")
        require(isinstance(entry, dict) and set(entry) == FIELDS, f"{pid}: invalid description shape")
        require(entry["providerId"] == pid, f"{pid}: providerId must match the exact object key")
        require(entry["basis"] == basis, f"{pid}: invalid basis for {layer}")
        provider = providers[pid]
        require(entry["scope"] == expected_scope(provider), f"{pid}: scope does not match exact provider identity")
        office = provider["category"] in {"home-care", "home-health"}
        if layer == "provider-residential":
            require(not office, f"{pid}: office entry in residential override")
        if layer == "provider-offices":
            require(office, f"{pid}: residential entry in office override")
        summary = entry["summary"]
        require(isinstance(summary, str) and 25 <= len(summary.strip()) <= 700
                and "\n" not in summary, f"{pid}: summary must be succinct nonempty prose")
        require(isinstance(entry["limitations"], list)
                and all(isinstance(v, str) and v.strip() for v in entry["limitations"]),
                f"{pid}: limitations must contain only nonempty text")
        sources = entry["sources"]
        require(isinstance(sources, list) and sources, f"{pid}: sources cannot be empty")
        for source in sources:
            valid_source(source, pid)
        require(len({s["url"] for s in sources}) == len(sources), f"{pid}: duplicate source URL")
        if provider["category"] == "life-plan":
            require(not any("data.cms.gov" == urlparse(s["url"]).hostname for s in sources),
                    f"{pid}: CMS care-unit evidence cannot describe a campus")
            require(not re.search(r"\b(?:licensed|certified) beds\b|\bCCN\s*\d", summary, re.I),
                    f"{pid}: care-unit capacity or CCN leaked into campus summary")
        elif provider["category"] == "home-care":
            require(not re.search(
                r"\b(?:Medicare[- ]certified|skilled home[- ]health agency|residential facility|"
                r"guaranteed (?:available )?caregivers)\b", summary, re.I),
                f"{pid}: registration is not clinical certification, residential care, or staffing availability")
        if provider["category"] == "nursing-home":
            require(not re.search(r"\b(?:retirement|continuing[- ]care) campus\b", summary, re.I),
                    f"{pid}: campus description cannot replace a nursing-unit description")
        ccns = set(re.findall(r"\b31\d{4}\b", json.dumps(entry)))
        own_ccn = {pid[4:]} if pid.startswith("cms-") else set()
        require(not ccns - own_ccn, f"{pid}: another unit or agency CCN leaked into description")


def build(providers, baseline, residential=None, offices=None):
    layers = [
        ("official-listing", "official-listing", baseline),
        ("provider-residential", "provider", residential if residential is not None else {}),
        ("provider-offices", "provider", offices if offices is not None else {}),
    ]
    locations = {}
    for layer, basis, entries in layers:
        validate_entries(entries, providers, basis, layer)
        locations.update(entries)
    dates = [source["checkedAt"] for entry in locations.values() for source in entry["sources"]]
    require(dates, "No source-backed descriptions to publish")
    return {"schemaVersion": 1, "marketId": "north-jersey", "checkedAt": max(dates),
            "locations": dict(sorted(locations.items()))}


def cms_supplement(providers):
    entries, matches = {}, {}
    paths = sorted((RESEARCH / "official").glob("cms-*-receipt.json"))
    for path in paths:
        receipt = load(path)
        require(receipt["metadata"]["statusCode"] == 200, f"{path.name}: unsuccessful receipt")
        body = receipt["markdown"]
        rows = json.loads(re.sub(r"\s*```$", "", re.sub(r"^```json\s*", "", body)))
        for row in rows:
            pid = "cms-" + row["prvdr_num"]
            provider = providers.get(pid)
            if not provider:
                continue
            require(row["state_cd"] == "NJ", f"{pid}: wrong CMS state")
            category = {"3": "home-health", "20": "nursing-home"}.get(row["prvdr_type_id"])
            require(category == provider["category"], f"{pid}: wrong CMS provider type")
            for field, column in (("address", "st_adr"), ("city", "city_name"), ("zip", "zip_cd")):
                require(provider[field].strip().casefold() == row[column].strip().casefold(),
                        f"{pid}: CMS {field} conflict")
            require(row["fac_name"].casefold().startswith(provider["name"].casefold()),
                    f"{pid}: CMS name conflict")
            require(row["fed_crtfctn_stus_name"] == "Certified", f"{pid}: not certified in CMS file")
            kind = "home-health agency office" if category == "home-health" else "nursing unit"
            entry = {
                "providerId": pid, "scope": expected_scope(provider), "basis": "official-listing",
                "summary": f"CMS lists {row['fac_name']} in {row['city_name']} as a certified {kind} under CCN {row['prvdr_num']}.",
                "sources": [{
                    "url": receipt["effectiveUrl"], "publisher": "Centers for Medicare & Medicaid Services",
                    "title": "Provider of Services file — exact certification record",
                    "checkedAt": receipt["completedAt"][:10],
                }],
                "limitations": [
                    f"The CMS file was processed on {row['processing_date']}; certification is reported as of that file, not a live operating-status check.",
                    "This record applies only to the named unit or agency, not to an entire campus or another branch.",
                    "The listing does not establish amenities, current admissions, service at your address, or staff availability.",
                ],
            }
            require(pid not in entries or entries[pid] == entry, f"{pid}: duplicate CMS match")
            entries[pid] = entry
            matches[pid] = {
                "receipt": str(path.relative_to(RESEARCH)),
                "sha256": hashlib.sha256(body.encode()).hexdigest(),
                "row": row,
            }
    return entries, matches


def render(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=ROOT / "src/data/regional-markets.json")
    parser.add_argument("--baseline", type=Path, default=RESEARCH / "official/baseline.json")
    parser.add_argument("--residential", type=Path, default=RESEARCH / "provider-residential.json")
    parser.add_argument("--offices", type=Path, default=RESEARCH / "provider-offices.json")
    parser.add_argument("--output", type=Path, default=ROOT / "src/data/location-descriptions.json")
    parser.add_argument("--baseline-only", action="store_true")
    parser.add_argument("--check", action="store_true", help="Validate without writing output")
    args = parser.parse_args()
    providers = active_providers(args.inventory)
    residential = load(args.residential) if not args.baseline_only and args.residential.exists() else None
    offices = load(args.offices) if not args.baseline_only and args.offices.exists() else None
    baseline = load(args.baseline)
    supplement, matches = cms_supplement(providers) if not args.baseline_only else ({}, {})
    require(not (set(baseline) & set(supplement)), "CMS supplement must only fill baseline gaps")
    result = build(providers, {**baseline, **supplement}, residential, offices)
    if not args.check:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(render(result))
        official_coverage = {p["providerId"]: p for p in load(RESEARCH / "official/coverage.json")["locations"]}
        coverage = {
            "activeCount": len(providers), "describedCount": len(result["locations"]),
            "meaning": "Every active ID has a disposition. Described is source-backed, not a claim of availability. Original collection failures remain in official/coverage.json.",
            "locations": [{
                "providerId": pid,
                "status": "described" if pid in result["locations"] else official_coverage[pid]["status"],
                "basis": result["locations"][pid]["basis"] if pid in result["locations"] else None,
                "originalOfficialStatus": official_coverage[pid]["status"],
            } for pid in sorted(providers)],
            "cmsMatches": matches,
        }
        (RESEARCH / "coverage.json").write_text(render(coverage))
    print(json.dumps({
        "active": len(providers), "described": len(result["locations"]),
        "missing": sorted(set(providers) - set(result["locations"])),
        "checkedAt": result["checkedAt"],
        "basis": {basis: sum(e["basis"] == basis for e in result["locations"].values())
                  for basis in ("official-listing", "provider")},
        "output": None if args.check else str(args.output),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
