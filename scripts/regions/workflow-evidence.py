#!/usr/bin/env python3
"""Offline checks for retained snapshots without a standalone read-only entry point."""
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "src/data"
NJ = ROOT / "research/north-jersey"


def confined(path):
    if not path.resolve().is_relative_to(ROOT):
        raise ValueError("source path outside checkout")
    return path


def read(path):
    return json.loads(confined(path).read_bytes())


def sha(path):
    return hashlib.sha256(confined(path).read_bytes()).hexdigest()


def check(ok, message):
    if not ok:
        raise ValueError(message)


def module(name):
    spec = importlib.util.spec_from_file_location("region_owner", ROOT / "scripts/regions" / (name + ".py"))
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    return owner


def catalog():
    providers = read(DATA / "providers.json")
    meta = read(DATA / "catalog-meta.json")
    rows = {p["id"]: p for p in providers}
    check(len(rows) == len(providers) == meta["catalogTotal"], "catalog identity/count mismatch")
    check(Counter(p["category"] for p in providers) == meta["categories"], "category counts differ")
    check(meta["officialDatasetSummary"] == read(DATA / "inputs/dataset-summary.json"), "official source summary differs")
    for p in providers:
        check(p["state"] == "MA" and p["sources"] and p["name"], p["id"] + " lacks MA identity/source")
    for corr in read(DATA / "inputs/provider-corrections.json"):
        p = rows[corr["providerId"]]
        check(p["zip"] == corr["zip"] and p["address"] == corr["address"], "uncorrected catalog address")
    return {"providers": len(rows)}


def geography():
    zips, provenance = (read(DATA / name) for name in ("ma-zips.json", "ma-zips-provenance.json"))
    manifest = read(DATA / "zip-source-manifest.json")
    check(zips.keys() == provenance.keys(), "ZIP/provenance join differs")
    for name in ("ma-zips.json", "ma-zips-provenance.json"):
        check(manifest["outputs"][name]["sha256"] == sha(DATA / name), name + " hash differs")
    for z, p in zips.items():
        check(len(z) == 5 and z.isdigit() and p["city"] and -90 <= p["lat"] <= 90
              and -180 <= p["lng"] <= 180 and provenance[z]["coordinateSource"], "invalid ZIP " + z)
    return {"zips": len(zips)}


def evidence():
    providers = {p["id"]: p for p in read(DATA / "providers.json")}
    locations = read(DATA / "location-research.json")
    check(providers.keys() == locations.keys(), "location/provider coverage differs")
    coverage = Counter()
    for pid, entry in locations.items():
        check(entry["providerId"] == pid, "location identity differs")
        sources = {s["id"] for s in entry["sources"]}
        for row in entry["facts"] + entry["reviews"] + entry["reviewAggregates"]:
            check(row["sourceId"] in sources, "unlinked location evidence " + pid)
        coverage.update({"catalog": 1, "withFacts": bool(entry["facts"]),
            "providerDetailsReviewed": entry["providerDetailsReviewed"],
            "withPublishedCosts": any((f.get("amount") or {}).get("min", 0) > 0 for f in entry["facts"]),
            "withReviewAggregates": bool(entry["reviewAggregates"]), "withReviewExcerpts": bool(entry["reviews"]),
            "publishedOpeningClaims": entry["availability"]["status"] == "opening-published",
            "publishedWaitlistClaims": entry["availability"]["status"] == "waitlist-published"})
    check(dict(coverage) == read(DATA / "location-research-coverage.json"), "location coverage counts differ")
    cms = {p["cms"]["ccn"] for p in providers.values() if p.get("cms")}
    check(set(read(DATA / "inspection-history.json")["facilities"]) <= cms, "unlinked inspection facility")
    hh = read(DATA / "home-health-evidence.json")["agencies"]
    check(len({a["ccn"] for a in hh}) == len(hh) and all(a["organizationId"] in providers for a in hh),
          "agency identity mismatch")
    check(set(read(DATA / "facebook-research.json")["locations"]) <= providers.keys(), "unlinked Facebook location")
    return dict(coverage)


def state():
    base = NJ / "state"
    c = read(base / "coverage.json")
    for src in c["sources"].values():
        check(sha(base / src["file"]) == src["sha256"], "state source mismatch " + src["file"])
    for county in c["counties"]:
        counts = c["county_counts"][county]
        for name, total in [("care-units", "care_unit_rows"), ("home-care-firms", "home_care_registration_rows"),
                            ("ccrc-campuses", "historical_ccrc_campuses")]:
            rows = read(base / county.lower() / (name + ".json"))
            check(len(rows) == counts[total] and all(row["county"] == county for row in rows),
                  f"{county}/{name} county or count mismatch")
            for row in rows:
                source = row["source"]
                check(any(source["file"] == s["file"] and source["sha256"] == s["sha256"]
                          for s in c["sources"].values()), "unlinked state source")
    check(len(read(base / "unresolved-home-care-counties.json")) == c["unresolved_nj_firm_county_rows"],
          "unresolved state rows differ")
    return {"counties": c["counties"], "coverage": c["county_counts"]}


def pos():
    base = NJ / "cms/pos"
    latest = base / read(base / "latest.json")["snapshot"]
    owner = module("cms_pos")
    owner.verify(latest)
    historical, incomplete = [], []
    for directory in sorted((base / "snapshots").iterdir()):
        if directory == latest or not directory.is_dir():
            continue
        if not (directory / "manifest.json").exists():
            incomplete.append(directory.name)
            continue
        manifest = read(directory / "manifest.json")
        for name, receipt in manifest["receipts"].items():
            f = directory / name
            check(f.resolve().is_relative_to(directory.resolve()) and sha(f) == receipt["sha256"]
                  and f.stat().st_size == receipt["bytes"], "historical POS receipt mismatch")
        archived = read(directory / "supplement.json")
        check(archived["release"] == manifest["release"], "historical POS release mismatch")
        pages = {}
        for group in archived["records"].values():
            for row in group:
                src = row["source"]
                if src["file"] not in pages:
                    pages[src["file"]] = read(directory / src["file"])
                raw = pages[src["file"]]
                i = src["row_index"]
                check(src["response_sha256"] == manifest["receipts"][src["file"]]["sha256"]
                      and 0 <= i < len(raw) and raw[i] == row["source_record"]
                      and raw[i]["prvdr_num"] == row["ccn"], "historical POS source pointer mismatch")
        historical.append(directory.name)
    return {"current": latest.name, "historicalReceiptsChecked": historical, "incompleteHistoricalAttempts": incomplete}


def reviews():
    folder = NJ / "reviews"
    source_names = [s["source"] for s in read(folder / "source-access.json")["sources"]]
    check(bool(source_names) and len(source_names) == len(set(source_names)), "invalid source access registry")
    runs = {}
    for manifest in sorted((folder / "runs").glob("*/manifest.json")):
        batch = manifest.parent
        m = read(manifest)
        check(m["runId"] == batch.name, "run identity mismatch")
        roster = read(batch / "roster.json")
        coverage = read(batch / "coverage.json")
        counts = m["counts"]
        rows = roster["rows"] if isinstance(roster, dict) else roster
        check(len(rows) == counts["rosterRows"] and len(coverage["locations"]) == counts["locations"],
              "review roster/coverage mismatch " + batch.name)
        for key, file in [("observations","observations"),("leads","leads"),("errors","errors"),
                          ("candidates","candidates"),("providerFacts","provider-facts")]:
            check(len(read(batch / (file + ".json"))) == counts[key], "review count mismatch " + key)
        runs[batch.name] = {"observations": counts["observations"], "errors": counts["errors"]}
    check(runs, "no retained runs")
    return {"historicalRunCounts": runs}


def listings():
    base = NJ / "listing-index"
    queue = read(base / "discovery-queue.json")
    ids = {r["providerId"] for r in queue["coverage"]}
    check(len(ids) == len(queue["coverage"]) == queue["providerCount"], "listing denominator mismatch")
    counts = Counter(r["providerId"] for r in queue["requests"])
    check(set(counts) <= ids and all(r["candidateCount"] == counts[r["providerId"]] for r in queue["coverage"]),
          "listing candidate counts differ")
    runtime_ids = {p["id"] for p in read(NJ / "runtime/providers.json")}
    check(ids <= runtime_ids, "stale listing identities")
    manifests = sorted((base / "runs").glob("*/manifest.json"))
    current = []
    historical = []
    for file in manifests:
        m = read(file)
        for row in m["inputs"] + m.get("rawObservations", []):
            obj = base / "raw" / row["sha256"]
            check(sha(obj) == row["sha256"] and obj.stat().st_size == row["bytes"], "listing archive hash mismatch")
        check(sha(file.parent / "crosswalk.json") == m["crosswalkSha256"], "crosswalk hash mismatch")
        if m["toolSha256"] != sha(ROOT / "scripts/regions/listing-index.py"):
            historical.append(file.parent.name)
            continue
        module("listing-index").verify(ROOT, file.parent)
        current.append(file.parent.name)
    changed_inputs = [r["path"] for r in queue["inputs"] if sha(ROOT / r["path"]) != r["sha256"]]
    return {"discoveryInputDrift": changed_inputs, "discoveryProviderCount": len(ids), "runtimeProviderCount": len(runtime_ids),
            "reproducibleWithCurrentTool": current, "historicalArchiveOnly": historical, "uninspectedDiscoveryOnly": not manifests}


def addresses():
    owner = module("address-points")
    base = NJ / "address-points"
    def compare(path, value):
        check(path.read_bytes() == owner.encoded(value), "address output differs " + path.name)
    owner.write = compare
    owner.build(base)
    return read(base / "coverage.json")["coverage"]["all"]


def released_reviews():
    base = NJ / "review-release"
    m = read(base / "manifest.json")
    for filename, digest in m["outputs"].items():
        check(sha(base / filename) == digest, "review release output mismatch " + filename)
    for record in [m["transformer"], m["scorer"]]:
        check(sha(ROOT / record["path"]) == record["sha256"], "review release tool drift")
    for row in m["inputs"]:
        obj = ROOT / row["path"]
        check(sha(obj) == row["sha256"] and obj.stat().st_size == row["bytes"], "review release source drift " + row["path"])
    records = read(base / "locationResearch.json")
    verification = read(base / "experience-verification.json")["releasedOutput"]
    roster = {p["id"] for p in read(NJ / "runtime/providers.json")}
    counts = m["counts"]
    check(records.keys() == verification.keys() and set(records) <= roster
          and len(records) == counts["providers"], "released review/provider join mismatch")
    check(len(read(base / "approvals-audit.json")["approvals"]) == counts["approved"]
          and len(read(base / "staging.json")) == counts["pendingOrInventory"], "approval ledger count mismatch")
    return {**counts, "withNumericExperienceScore": sum(v["value"] is not None for v in verification.values())}


def comparison():
    ma = {"providers": read(DATA / "providers.json"), "zips": read(DATA / "ma-zips.json"),
          "locationResearch": read(DATA / "location-research.json"),
          "facebookResearch": read(DATA / "facebook-research.json"),
          "inspectionHistory": read(DATA / "inspection-history.json"),
          "homeHealthEvidence": read(DATA / "home-health-evidence.json")}
    nj = next(r for r in read(DATA / "regional-markets.json") if r["id"] == "north-jersey")
    def metrics(market):
        records = list(market.get("locationResearch", {}).values())
        fb = market.get("facebookResearch", {}).get("locations", {})
        return {"catalogRecords": len(market["providers"]), "supportedZips": len(market["zips"]),
                "byCategory": dict(sorted(Counter(p["category"] for p in market["providers"]).items())),
                "inspectionFacilities": len(market["inspectionHistory"]["facilities"]),
                "homeHealthReportingEntities": len(market["homeHealthEvidence"]["agencies"]),
                "withFacts": sum(bool(r["facts"]) for r in records),
                "withPositivePrice": sum(any((f.get("amount") or {}).get("min", 0) > 0
                                             for f in r["facts"]) for r in records),
                "withReviewAggregate": sum(bool(r["reviewAggregates"]) for r in records),
                "openingClaims": sum(r["availability"]["status"] == "opening-published" for r in records),
                "waitlistClaims": sum(r["availability"]["status"] == "waitlist-published" for r in records),
                "facebookLocations": len(fb), "facebookWithFindings": sum(bool(v["findings"]) for v in fb.values())}
    return {"massachusetts": metrics(ma), "north-jersey": metrics(nj)}


if __name__ == "__main__":
    checks = {"catalog": catalog, "geography": geography, "evidence": evidence, "state": state,
              "pos": pos, "reviews": reviews, "listings": listings, "address-points": addresses,
              "release-reviews": released_reviews, "comparison": comparison}
    print(json.dumps(checks[sys.argv[1]](), sort_keys=True))
