#!/usr/bin/env python3
"""Behavioral tests for scripts/regions/reviews.py.

Every roster row, listing and price below is SYNTHETIC test data, not research evidence.
Run: python3 scripts/regions/reviews.test.py
"""

import copy
import csv
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CLI = Path(__file__).resolve().parent / "reviews.py"
REGION = "research/north-jersey"
CMS_HEADER = [
    "CMS Certification Number (CCN)", "Provider Name", "Provider Address", "City/Town",
    "State", "ZIP Code", "Telephone Number", "County/Parish",
]
CMS_ROWS = [
    ["31S001", "SYNTHETIC UNION CARE CENTER", "10 EXAMPLE AVENUE", "ELIZABETH", "NJ", "07201", "000-000-0000", "Union"],
    ["31S002", "SYNTHETIC MORRIS REHAB", "20 SAMPLE STREET", "MORRISTOWN", "NJ", "07960", "000-000-0000", "Morris"],
    ["31S003", "SYNTHETIC CAMDEN HOME", "30 OTHER ROAD", "CAMDEN", "NJ", "08101", "000-000-0000", "Camden"],
    ["39S001", "SYNTHETIC PENNSYLVANIA HOME", "40 ELSEWHERE ROAD", "EASTON", "PA", "18042", "000-000-0000", "Northampton"],
    ["31S004", "SYNTHETIC NO COUNTY HOME", "50 SAMPLE STREET", "MORRISTOWN", "NJ", "07960", "000-000-0000", ""],
    ["1234", "SYNTHETIC MANGLED CCN", "60 SAMPLE STREET", "MORRISTOWN", "NJ", "07960", "000-000-0000", "Morris"],
]
CMS_PAGE_ROWS = [
    {"cms_certification_number_ccn": "31S005", "provider_name": "SYNTHETIC ESSEX CENTER",
     "provider_address": "70 Test Pl", "citytown": "Newark", "state": "NJ", "zip_code": "07102", "countyparish": "Essex"},
    {"cms_certification_number_ccn": "31S002", "provider_name": "SYNTHETIC MORRIS REHAB",
     "provider_address": "20 Sample St", "citytown": "Morristown", "state": "NJ", "zip_code": "07960", "countyparish": "Morris"},
    {"cms_certification_number_ccn": "31S006", "provider_name": "SYNTHETIC NUMERIC ZIP",
     "provider_address": "80 Test Pl", "citytown": "Newark", "state": "NJ", "zip_code": 7102, "countyparish": "Essex"},
]
RAW_LTC = b"SYNTHETIC state workbook bytes"
RAW_SHA = hashlib.sha256(RAW_LTC).hexdigest()


def doh(facility, name, street, city, zip_code, county, official_type, row, **extra):
    return {
        "record_kind": "licensed_care_unit", "official_facility_id": facility, "official_license_id": facility[2:],
        "name": f"{name} ({facility})", "official_type": official_type, "address": f"{street} \n{city}, NJ {zip_code}",
        "city": city, "state": "NJ", "zip": zip_code, "county": county,
        "county_basis": "Explicit DOH source COUNTY field",
        "source": {"file": "raw/ltc.xlsx", "sha256": RAW_SHA, "row": row}, **extra,
    }


UNION_UNITS = [
    doh("NJ-0001", "SYNTHETIC UNION CARE CENTER ASSISTED LIVING", "10 EXAMPLE AVENUE", "ELIZABETH", "07201", "Union",
        "ASSISTED LIVING RESIDENCE", 2),
    doh("NJ-0002", "SYNTHETIC UNION CARE CENTER", "10 EXAMPLE AVE.", "ELIZABETH", "07201", "UNION",
        "LONG TERM CARE FACILITY", 3, ccn="31S001"),
    doh("NJ-0003", "SYNTHETIC CONFLICT A", "90 TEST LANE", "SUMMIT", "07901", "Union", "ASSISTED LIVING RESIDENCE", 4),
    doh("NJ-0003", "SYNTHETIC CONFLICT B", "91 TEST LANE", "SUMMIT", "07901", "Union", "ASSISTED LIVING RESIDENCE", 5),
    doh("NJ-0004", "SYNTHETIC STALE DERIVATION", "92 TEST LANE", "SUMMIT", "07901", "Union", "ASSISTED LIVING RESIDENCE", 6,
        source={"file": "raw/ltc.xlsx", "sha256": "0" * 64, "row": 6}),
]
MORRIS_UNITS = [
    doh("NJ-0005", "SYNTHETIC WRONG FOLDER", "93 TEST LANE", "SUMMIT", "07901", "Union", "ASSISTED LIVING RESIDENCE", 7),
]
UNION_FIRMS = [{
    "record_kind": "home_care_firm_registration", "official_registration_id": "HP-0001",
    "name": "SYNTHETIC HOME CARE", "official_type": "Health Care Services", "address": "94 Test Lane",
    "city": "Cranford", "state": "NJ", "zip": "07016", "county": "Union", "county_basis": "NJ municipality name match",
}]
MORRIS_IDENTITY = {
    "name": "Synthetic Morris Rehab", "street": "20 Sample St", "city": "Morristown", "zip": "07960",
    "careSetting": "nursing-home", "careUnitText": "Nursing Homes",
}
LISTING = {
    "outcome": "observed", "kind": "consumer-listing", "rosterKey": "cms-ccn:31S002", "platform": "Caring.com",
    "sourceFamily": "Caring.com", "sourceType": "review-platform", "population": "consumer",
    "url": "https://reviews.example/synthetic-morris", "canonicalUrl": "https://reviews.example/synthetic-morris",
    "checkedAt": "2026-11-10", "inspection": "full-page",
    "access": {"decision": "permitted", "basis": "SYNTHETIC public page; terms reviewed"},
    "identity": MORRIS_IDENTITY,
    "rating": {"kind": "consumer-average", "value": 2.5, "scale": 5, "count": 32, "asOf": None},
    "syndication": {"status": "original"},
}
PROVIDER_PAGE = {
    "outcome": "observed", "kind": "provider-page", "rosterKey": "cms-ccn:31S002", "platform": "Provider website",
    "sourceType": "provider-website", "url": "https://provider.example/morris",
    "canonicalUrl": "https://provider.example/morris", "checkedAt": "2026-11-10", "inspection": "full-page",
    "access": {"decision": "permitted", "basis": "SYNTHETIC provider page"}, "identity": MORRIS_IDENTITY,
    "sourceClaimDate": None, "offerings": ["Short-term rehabilitation", "Long-term care"],
    "prices": [{"amount": 400, "currency": "USD", "period": "day", "label": "SYNTHETIC private room", "claimDate": None}],
    "openings": "not-listed",
}


def variant(base, oid, **changes):
    item = copy.deepcopy(base)
    item["id"] = oid
    for path, value in changes.items():
        target = item
        *parents, leaf = path.split("__")
        for parent in parents:
            target = target[parent]
        target[leaf] = value
    return item


def union_identity(name="Synthetic Union Care Center"):
    return {"name": name, "street": "10 Example Avenue", "city": "Elizabeth", "zip": "07201",
            "careSetting": "nursing-home", "careUnitText": "Nursing Homes"}


OBSERVATIONS = [
    variant(LISTING, "ok-caring"),
    variant(LISTING, "name-mismatch", identity__name="Synthetic Morris Rehab North"),
    variant(LISTING, "address-mismatch", identity__street="21 Sample St"),
    variant(LISTING, "unit-mismatch", identity__careSetting="assisted-living"),
    variant(LISTING, "snippet", inspection="search-snippet"),
    variant(LISTING, "search-page", url="https://www.google.com/search?q=synthetic"),
    variant(LISTING, "restricted", access={"decision": "restricted", "basis": "login wall"}),
    variant(LISTING, "fractional-count", rating__count=2.5),
    variant(LISTING, "zero-count", rating__count=0),
    variant(LISTING, "proprietary", rating__kind="proprietary-score"),
    variant(LISTING, "testimonial", sourceType="provider-promotion"),
    variant(LISTING, "unknown-syndication", syndication={"status": "unknown"}),
    variant(LISTING, "bad-scale", rating__scale=100, rating__value=50),
    variant(LISTING, "apfm", rosterKey="cms-ccn:31S001", platform="A Place for Mom", sourceFamily="APFM",
            identity=union_identity(), rating__count=6),
    variant(LISTING, "senioradvisor", rosterKey="cms-ccn:31S001", platform="SeniorAdvisor.com",
            sourceFamily="SeniorAdvisor", syndication={"status": "syndicated", "family": "A Place for Mom"},
            identity=union_identity(), rating__count=7),
    variant(LISTING, "doh-unit-ok", rosterKey="nj-doh:NJ-0001", platform="Synthetic Reviews",
            sourceFamily="Synthetic Reviews", rating__count=3,
            identity={"name": "Synthetic Union Care Center Assisted Living", "street": "10 Example Ave",
                      "city": "Elizabeth", "zip": "07201", "careSetting": "Assisted Living Residence",
                      "careUnitText": "Assisted Living"}),
    variant(LISTING, "doh-other-unit", rosterKey="nj-doh:NJ-0001", identity=union_identity(
            "Synthetic Union Care Center Assisted Living")),
    variant(LISTING, "invalid-date", rosterKey="nj-doh:NJ-0002", checkedAt="2026-02-30"),
    variant(LISTING, "not-in-roster", rosterKey="cms-ccn:999999"),
    variant(PROVIDER_PAGE, "facts-ok"),
    variant(PROVIDER_PAGE, "facts-no-period", prices=[{"amount": 400, "currency": "USD", "label": "room", "claimDate": None}]),
    variant(PROVIDER_PAGE, "facts-zero-price", prices=[{"amount": 0, "currency": "USD", "period": "month", "label": "room", "claimDate": None}]),
    variant(PROVIDER_PAGE, "facts-empty-openings", openings=[]),
    {"id": "essex-not-listed", "rosterKey": "cms-ccn:31S005", "outcome": "not-listed", "platform": "Caring.com",
     "checkedAt": "2026-11-11", "method": "SYNTHETIC site search by exact name and ZIP"},
]
LEADS = [{"id": "lead-1", "name": "SYNTHETIC Unlisted Home", "url": "https://directory.example/unlisted", "foundAt": "2026-11-11"}]


def csv_bytes(header, rows):
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows([header, *rows])
    return out.getvalue().encode()


def write(root, relative, data):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else json.dumps(data, indent=2).encode())
    return path


def cms_manifest(page_sha):
    page = {"file": "raw/4pq5-n9py/primary/page-0000000.json", "sha256": page_sha, "rows": len(CMS_PAGE_ROWS)}
    return {"status": "collecting", "sources": {"4pq5-n9py": {
        "complete": True, "partitions": [{"complete": True, "pages": [page]}]}}}


def synthetic_access(root):
    write(root, f"{REGION}/reviews/source-access.json", {"sources": [
        {"host": host, "access_decision": "permitted_synthetic",
         "basis": "SYNTHETIC explicit host permission"}
        for host in ["reviews.example", "provider.example"]
    ]})


def full_roster(root):
    synthetic_access(root)
    page = write(root, f"{REGION}/cms/raw/4pq5-n9py/primary/page-0000000.json", {"results": CMS_PAGE_ROWS, "count": 3})
    write(root, f"{REGION}/cms/manifest.partial.json", cms_manifest(hashlib.sha256(page.read_bytes()).hexdigest()))
    write(root, f"{REGION}/cms/nursing-homes/provider-info.csv", csv_bytes(CMS_HEADER, CMS_ROWS))
    write(root, f"{REGION}/state/raw/ltc.xlsx", RAW_LTC)
    write(root, f"{REGION}/state/union/care-units.json", UNION_UNITS)
    write(root, f"{REGION}/state/union/home-care-firms.json", UNION_FIRMS)
    write(root, f"{REGION}/state/union/ccrc-campuses.json", [])
    write(root, f"{REGION}/state/morris/care-units.json", MORRIS_UNITS)
    write(root, f"{REGION}/state/morris/ccrc-campuses.json", [{"record_kind": "historical_ccrc_campus_listing",
                                                             "official_registration_id": None, "name": "SYNTHETIC CAMPUS",
                                                             "address": "1 Campus Rd, Summit, NJ 07901", "county": "Morris"}])
    write(root, f"{REGION}/state/essex/care-units.json", b"{")


def run(root, *args):
    result = subprocess.run([sys.executable, str(CLI), *args, "--root", str(root)], capture_output=True, text=True)
    summary = json.loads(result.stdout) if result.stdout.strip() else None
    files = {}
    if summary and "runDir" in summary:
        directory = root / summary["runDir"]
        files = {p.name: json.loads(p.read_text()) for p in directory.iterdir()}
    return result.returncode, summary, files, result.stderr


def snapshot(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file() and "/reviews/runs/" not in p.as_posix()}


def actual_shapes(root):
    synthetic_access(root)
    for county in ["union", "morris", "essex", "bergen", "hudson", "passaic"]:
        for name in ["care-units.json", "home-care-firms.json", "ccrc-campuses.json"]:
            write(root, f"{REGION}/state/{county}/{name}", [])
    sources = {}
    for dataset in ["4pq5-n9py", "6jpm-sxkc"]:
        page = write(root, f"{REGION}/cms/raw/{dataset}/primary/page.json", {"results": []})
        sources[dataset] = {"complete": True, "partitions": [{"complete": True, "pages": [{
            "file": f"raw/{dataset}/primary/page.json", "sha256": hashlib.sha256(page.read_bytes()).hexdigest(),
        }]}]}
    write(root, f"{REGION}/cms/manifest.json", {"sources": sources})


def derived_firm(root, identifier="HP-SYNTHETIC", **changes):
    references = []
    for filename, url in [
        ("municipalities.json", "https://data.nj.gov/resource/k9xb-zgh4.json"),
        ("localities.html", "https://www.nj.gov/cgi-bin/infobank/localsearch.pl"),
        ("ltc.xlsx", "https://healthapps.nj.gov/facilities/documents2/All_LTC.xlsx"),
    ]:
        data = b"SYNTHETIC official reference"
        write(root, f"{REGION}/state/raw/{filename}", data)
        references.append({"file": f"raw/{filename}", "url": url, "sha256": hashlib.sha256(data).hexdigest()})
    write(root, f"{REGION}/state/raw/firms.xlsx", b"SYNTHETIC firm export")
    return {
        "record_kind": "home_care_firm_registration", "official_registration_id": identifier,
        "name": "SYNTHETIC REGISTERED OFFICE LLC", "official_type": "Health Care Services",
        "address": "95 Test Lane", "city": "Cranford", "state": "NJ", "zip": "07016", "county": "Union",
        "county_basis": "NJ municipality name match", "county_reference_sources": references[:2],
        "source": {"file": "raw/firms.xlsx", "sha256": hashlib.sha256(b"SYNTHETIC firm export").hexdigest(), "row": 12},
        "source_date": None, **changes,
    }, references


class ReviewsCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def stage(self, observations=OBSERVATIONS, leads=LEADS):
        full_roster(self.root)
        write(self.root, f"{REGION}/reviews/observations/synthetic.json",
              {"schemaVersion": 1, "observations": observations, "leads": leads})
        return run(self.root, "stage", "--as-of", "2026-11-12",
                   "--observations", str(self.root / REGION / "reviews/observations/synthetic.json"))

    def test_missing_rosters_are_reported_per_county_without_fabricated_rows(self):
        write(self.root, f"{REGION}/state/raw/ltc.xlsx", RAW_LTC)
        code, summary, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual(code, 1)
        self.assertEqual(summary["status"], "created")
        expected = {("missing-directory", f"{REGION}/cms")} | {
            ("missing-roster", f"{REGION}/state/{county}/{name}")
            for county in ["union", "morris", "essex", "bergen", "hudson", "passaic"]
            for name in ["care-units.json", "home-care-firms.json", "ccrc-campuses.json"]
        } | {("missing-access-registry", f"{REGION}/reviews/source-access.json")}
        self.assertEqual({(e["code"], e["path"]) for e in files["errors.json"]}, expected)
        self.assertEqual(files["roster.json"]["rows"], [])
        self.assertEqual(files["coverage.json"]["locations"], [])
        self.assertEqual(
            [(c["county"], c["rosterStatus"]) for c in files["coverage.json"]["counties"]],
            [(c, "missing-roster") for c in ["Union", "Morris", "Essex", "Bergen", "Hudson", "Passaic"]],
        )

    def test_cms_and_state_aliases_freeze_lossless_rows_with_provenance(self):
        full_roster(self.root)
        code, _, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual(code, 1)
        roster = files["roster.json"]
        keys = sorted({row["key"] for row in roster["rows"]})
        self.assertEqual(keys, ["cms-ccn:31S001", "cms-ccn:31S002", "cms-ccn:31S003", "cms-ccn:31S005",
                                "cms-ccn:39S001", "nj-doh:NJ-0001", "nj-doh:NJ-0002", "nj-doh:NJ-0003",
                                f"source-row:{REGION}/state/morris/ccrc-campuses.json#1"])
        csv_path = self.root / REGION / "cms/nursing-homes/provider-info.csv"
        first = next(r for r in roster["rows"] if r["key"] == "cms-ccn:31S001")
        self.assertEqual(first["source"], {"path": f"{REGION}/cms/nursing-homes/provider-info.csv",
                                           "sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(), "row": 2})
        self.assertEqual((first["input"]["ZIP Code"], first["address"]["zip"]), ("07201", "07201"))
        self.assertEqual(first["setting"], "nursing-home")
        essex = next(r for r in roster["rows"] if r["key"] == "cms-ccn:31S005")
        self.assertEqual((essex["source"]["path"], essex["source"]["row"], essex["input"]), (
            f"{REGION}/cms/raw/4pq5-n9py/primary/page-0000000.json", 1, CMS_PAGE_ROWS[0]))
        unit = next(r for r in roster["rows"] if r["key"] == "nj-doh:NJ-0001")
        self.assertEqual((unit["setting"], unit["input"]), ("ASSISTED LIVING RESIDENCE", UNION_UNITS[0]))

        rejected = {r["identity"].get("ccn") or r["identity"].get("stateId"): r["reasons"] for r in roster["rejectedRows"]}
        self.assertEqual(rejected["31S004"], ["missing county"])
        self.assertIn("CCN must be exactly six characters as published", rejected["1234"])
        self.assertIn("zip must be a string so identifiers stay lossless", rejected["31S006"])
        self.assertIn("upstream source file is missing or its hash does not match", rejected["NJ-0004"])
        self.assertEqual(rejected["NJ-0005"], ["county 'Union' differs from the roster file's county"])
        self.assertIn("derived county requires official county reference sources", rejected["HP-0001"])
        self.assertNotIn("31S003", rejected)
        outside = next(r for r in roster["rows"] if r["key"] == "cms-ccn:31S003")
        self.assertEqual(outside["scope"], "out-of-scope")

        errors = {(e["code"], e["path"]) for e in files["errors.json"]}
        self.assertTrue({
            ("incomplete-roster", f"{REGION}/cms/manifest.partial.json"),
            ("parse-error", f"{REGION}/state/essex/care-units.json"),
            ("missing-roster", f"{REGION}/state/morris/home-care-firms.json"),
        } <= errors)
        self.assertNotIn(f"{REGION}/state/union/ccrc-campuses.json", {path for _, path in errors})

        issues = roster["issues"]
        self.assertIn({"type": "shared-address", "street": "10 example ave", "zip": "07201",
                       "keys": ["cms-ccn:31S001", "nj-doh:NJ-0001", "nj-doh:NJ-0002"]}, issues)
        self.assertIn({"type": "crosswalk", "key": "nj-doh:NJ-0002", "cmsKey": "cms-ccn:31S001", "cmsKeyInRoster": True}, issues)
        duplicates = {i["key"]: i["conflicting"] for i in issues if i["type"] == "duplicate-identifier"}
        self.assertEqual(duplicates, {"cms-ccn:31S002": False, "nj-doh:NJ-0003": True})

        coverage = files["coverage.json"]
        self.assertEqual(len(coverage["sourceRows"]), 17)
        self.assertEqual(len(roster["rows"]) + len(roster["rejectedRows"]), 17)
        self.assertEqual([l["county"] for l in coverage["locations"] if l["scope"] == "in-scope"],
                         ["Union"] * 4 + ["Morris"] * 2 + ["Essex"])
        self.assertTrue(all(l["status"] == "not-checked" and l["outcomes"] == [] for l in coverage["locations"]))
        counties = {c["county"]: c for c in coverage["counties"]}
        self.assertEqual(counties["Essex"]["missingRosterSources"], ["cms", "state"])
        self.assertEqual(counties["Bergen"]["rosterStatus"], "partial-roster")

    def test_cms_pages_must_match_manifest_receipts(self):
        full_roster(self.root)
        write(self.root, f"{REGION}/cms/manifest.partial.json", cms_manifest("0" * 64))
        _, _, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertIn(("hash-mismatch", f"{REGION}/cms/raw/4pq5-n9py/primary/page-0000000.json"),
                      {(e["code"], e["path"]) for e in files["errors.json"]})
        self.assertNotIn("cms-ccn:31S005", {row["key"] for row in files["roster.json"]["rows"]})

    def test_explicit_counties_keep_priority_and_unknown_county_fails(self):
        full_roster(self.root)
        _, _, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12", "--counties", "morris,union")
        self.assertEqual(files["manifest.json"]["counties"], ["Union", "Morris"])
        self.assertNotIn("Essex", {l["county"] for l in files["coverage.json"]["locations"] if l["scope"] == "in-scope"})
        self.assertEqual(next(l["scope"] for l in files["coverage.json"]["locations"] if l["county"] == "Essex"),
                         "out-of-scope")
        code, summary, _, stderr = run(self.root, "inventory", "--as-of", "2026-11-12", "--counties", "Gotham")
        self.assertEqual((code, summary), (2, None))
        self.assertIn("unknown New Jersey county", stderr)

    def test_stage_accepts_only_exact_permitted_full_page_consumer_averages(self):
        _, _, files, _ = self.stage()
        statuses = {o["id"]: o["status"] for o in files["observations.json"]}
        self.assertEqual({k for k, v in statuses.items() if v == "accepted"},
                         {"ok-caring", "apfm", "senioradvisor", "doh-unit-ok", "facts-ok", "essex-not-listed"})
        self.assertEqual({k for k, v in statuses.items() if v == "invalid"}, {"invalid-date", "not-in-roster"})
        reasons = {o["id"]: " ".join(o["reasons"]) for o in files["observations.json"]}
        for oid, fragment in [
            ("name-mismatch", "observed name"), ("address-mismatch", "observed street"),
            ("unit-mismatch", "observed careSetting"), ("snippet", "search snippets"),
            ("search-page", "search-engine page"), ("restricted", "permitted decision"),
            ("fractional-count", "positive whole number"), ("zero-count", "positive whole number"),
            ("proprietary", "proprietary scores"), ("testimonial", "provider-selected testimonials"),
            ("unknown-syndication", "syndication status"), ("bad-scale", "5 or 10"),
            ("doh-other-unit", "observed careSetting"),
        ]:
            self.assertEqual(statuses[oid], "excluded", oid)
            self.assertIn(fragment, reasons[oid], oid)

        candidates = {c["observationId"]: c for c in files["candidates.json"]}
        self.assertEqual(set(candidates), {"ok-caring", "apfm", "senioradvisor", "doh-unit-ok"})
        self.assertEqual(candidates["ok-caring"]["aggregate"], {
            "sourceId": "ok-caring", "platform": "Caring.com", "sourceFamily": "caring", "rating": 2.5,
            "scale": 5, "count": 32, "asOf": None, "scope": "consumer"})
        self.assertEqual(candidates["ok-caring"]["source"]["url"], "https://reviews.example/synthetic-morris")
        self.assertEqual({candidates["apfm"]["sourceFamily"], candidates["senioradvisor"]["sourceFamily"]}, {"aplaceformom"})
        self.assertTrue(all(c["status"] == "awaiting-review" for c in candidates.values()))
        self.assertEqual(set(candidates["ok-caring"]), {"rosterKey", "observationId", "status", "sourceFamily",
                                                         "aggregate", "source", "syndication"})

    def test_coverage_counts_only_supplied_checks_and_applies_sample_floor(self):
        _, _, files, _ = self.stage()
        locations = {l["rosterKey"]: l for l in files["coverage.json"]["locations"]}
        self.assertEqual(locations["cms-ccn:31S002"]["sampleStatus"], "awaiting-review")
        self.assertEqual(locations["cms-ccn:31S001"]["sampleStatus"], "insufficient-sample")
        self.assertEqual(locations["nj-doh:NJ-0001"]["sampleStatus"], "insufficient-sample")
        self.assertEqual(locations["cms-ccn:31S005"]["status"], "checked")
        self.assertEqual(locations["cms-ccn:31S005"]["sampleStatus"], "no-eligible-aggregate")
        self.assertEqual(locations["nj-doh:NJ-0002"]["status"], "not-checked")
        self.assertEqual([o["id"] for o in locations["nj-doh:NJ-0002"]["outcomes"]], ["invalid-date"])
        self.assertEqual((locations["nj-doh:NJ-0003"]["status"], locations["nj-doh:NJ-0003"]["outcomes"]), ("not-checked", []))
        union = next(c for c in files["coverage.json"]["counties"] if c["county"] == "Union")
        self.assertEqual((union["locations"], union["checked"], union["notChecked"]), (4, 2, 2))
        self.assertEqual(files["leads.json"], [{**LEADS[0], "status": "discovery-only"}])
        self.assertNotIn("lead-1", json.dumps(files["coverage.json"]))
        invalid = {e["id"] for e in files["errors.json"] if e["code"] == "invalid-observation"}
        self.assertEqual(invalid, {"invalid-date", "not-in-roster"})

    def test_provider_facts_keep_period_dates_and_unknowns(self):
        _, _, files, _ = self.stage()
        self.assertEqual(files["provider-facts.json"], [{
            "rosterKey": "cms-ccn:31S002", "observationId": "facts-ok", "url": "https://provider.example/morris",
            "checkedAt": "2026-11-10", "sourceClaimDate": None,
            "offerings": ["Short-term rehabilitation", "Long-term care"],
            "prices": {"status": "listed", "items": PROVIDER_PAGE["prices"]},
            "openings": {"status": "unknown", "reason": "not listed on the checked page", "items": []},
        }])
        reasons = {o["id"]: " ".join(o["reasons"]) for o in files["observations.json"]}
        self.assertIn("period must be one of", reasons["facts-no-period"])
        self.assertIn("amount must be positive", reasons["facts-zero-price"])
        self.assertIn("not no vacancy", reasons["facts-empty-openings"])

    def test_reruns_are_byte_identical_and_never_overwrite(self):
        full_roster(self.root)
        before = snapshot(self.root)
        first = run(self.root, "inventory", "--as-of", "2026-11-12")
        run_dir = self.root / first[1]["runDir"]
        bytes_first = {p.name: p.read_bytes() for p in run_dir.iterdir()}
        second = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((second[1]["status"], second[1]["runDir"]), ("unchanged", first[1]["runDir"]))
        self.assertEqual({p.name: p.read_bytes() for p in run_dir.iterdir()}, bytes_first)
        self.assertEqual(snapshot(self.root), before)

        (run_dir / "coverage.json").write_text("{}\n")
        code, summary, _, stderr = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((code, summary), (3, None))
        self.assertIn("refusing to overwrite", stderr)
        self.assertEqual((run_dir / "coverage.json").read_text(), "{}\n")

        write(self.root, f"{REGION}/cms/nursing-homes/provider-info.csv", csv_bytes(CMS_HEADER, CMS_ROWS[:2]))
        changed = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertNotEqual(changed[1]["runDir"], first[1]["runDir"])

        inside = write(self.root, f"{first[1]['runDir']}/observations.json", {"schemaVersion": 1, "observations": []})
        code, _, _, stderr = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(inside))
        self.assertEqual(code, 3)
        self.assertIn("inputs must stay outside run output", stderr)

    def test_actual_state_derived_counties_retain_every_row_and_reference(self):
        actual_shapes(self.root)
        firm, refs = derived_firm(self.root)
        locality = {**firm, "official_registration_id": "HP-LOCAL", "county_basis": "NJ locality name match"}
        disambiguated = {**firm, "official_registration_id": "HP-DOH",
                         "county_basis": "NJ municipality name match disambiguated by DOH city and ZIP county",
                         "county_reference_sources": refs}
        no_type = {**firm, "official_registration_id": "HP-NO-TYPE", "official_type": ""}
        write(self.root, f"{REGION}/state/union/home-care-firms.json", [firm, locality, disambiguated, no_type, firm])
        before = snapshot(self.root)
        code, summary, files, stderr = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((code, stderr, files["errors.json"]), (0, "", []))
        rows = files["roster.json"]["rows"]
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0]["input"], firm)
        self.assertEqual(rows[0]["geography"]["status"], "derived")
        self.assertEqual(rows[0]["geography"]["basis"], firm["county_basis"])
        self.assertEqual(rows[0]["geography"]["referenceSources"], refs[:2])
        self.assertEqual(rows[3]["setting"], None)
        self.assertEqual(rows[3]["identityStatus"], "unresolved-identity")
        self.assertEqual(files["manifest.json"]["counts"]["locations"], 4)
        self.assertEqual(len(files["coverage.json"]["sourceRows"]), 5)
        self.assertEqual(snapshot(self.root), before)
        again = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((again[1]["status"], again[1]["runDir"]), ("unchanged", summary["runDir"]))
        write(self.root, f"{REGION}/state/raw/localities.html", b"SYNTHETIC changed reference")
        changed = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertNotEqual(changed[1]["runDir"], summary["runDir"])
        self.assertEqual(len(changed[2]["roster.json"]["rejectedRows"]), 5)
        self.assertTrue(all("county reference" in " ".join(r["reasons"])
                            for r in changed[2]["roster.json"]["rejectedRows"]))

    def test_null_county_hha_and_firms_remain_outside_county_denominators(self):
        actual_shapes(self.root)
        firm, _ = derived_firm(self.root, county=None,
                               county_basis="Unresolved county. No unique official name match.")
        write(self.root, f"{REGION}/state/unresolved-home-care-counties.json", [firm])
        hha = {"cms_certification_number_ccn": "31H001", "provider_name": "SYNTHETIC HHA",
               "address": "100 Test Road", "citytown": "Morristown", "state": "NJ", "zip_code": "07960"}
        page = write(self.root, f"{REGION}/cms/raw/6jpm-sxkc/primary/page.json",
                     {"results": [hha, {**hha, "cms_certification_number_ccn": "39H001", "state": "PA"}]})
        manifest = json.loads((self.root / REGION / "cms/manifest.json").read_text())
        manifest["sources"]["6jpm-sxkc"]["partitions"][0]["pages"][0]["sha256"] = hashlib.sha256(page.read_bytes()).hexdigest()
        write(self.root, f"{REGION}/cms/manifest.json", manifest)
        code, _, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((code, files["errors.json"]), (0, []))
        locations = {l["rosterKey"]: l for l in files["coverage.json"]["locations"]}
        self.assertEqual(len(locations), 3)
        self.assertEqual(locations["cms-ccn:31H001"]["scope"], "unresolved-geography")
        self.assertEqual(locations["cms-ccn:39H001"]["scope"], "out-of-scope")
        self.assertTrue(all(l["geography"]["county"] is None for l in locations.values()))
        self.assertEqual(files["coverage.json"]["unresolvedGeography"]["locations"], 3)
        self.assertTrue(all(c["locations"] == 0 for c in files["coverage.json"]["counties"]))
        self.assertNotIn("serviceZip", json.dumps(files["coverage.json"]))
        self.assertTrue(all(l["status"] == "not-checked" for l in locations.values()))

    def test_historical_ccrc_has_provisional_source_row_identity_and_never_stages(self):
        actual_shapes(self.root)
        source = b"SYNTHETIC historical PDF"
        write(self.root, f"{REGION}/state/raw/ccrc.pdf", source)
        campus = {
            "record_kind": "historical_ccrc_campus_listing", "official_registration_id": None,
            "name": "SYNTHETIC HISTORICAL CAMPUS", "address": "535 Example Avenue, New Providence, NJ 07974",
            "county": "Union", "county_basis": "Explicit DCA directory county heading", "source_date": "2018-01",
            "source": {"file": "raw/ccrc.pdf", "sha256": hashlib.sha256(source).hexdigest(), "pdf_page": 44},
        }
        write(self.root, f"{REGION}/state/union/ccrc-campuses.json", [campus, {**campus, "name": "SYNTHETIC OTHER CAMPUS"}])
        code, _, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((code, files["errors.json"]), (0, []))
        rows = files["roster.json"]["rows"]
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["key"], rows[1]["key"])
        self.assertTrue(all(row["key"].startswith("source-row:") and row["identifier"] is None for row in rows))
        self.assertEqual(rows[0]["address"], {"street": campus["address"], "city": None, "state": None, "zip": None})
        self.assertEqual(rows[0]["sourceDate"], "2018-01")
        self.assertEqual(rows[0]["input"]["source"]["pdf_page"], 44)
        observation = variant(LISTING, "historical", rosterKey=rows[0]["key"])
        path = write(self.root, f"{REGION}/reviews/observations/synthetic.json",
                     {"schemaVersion": 1, "observations": [observation]})
        _, _, staged, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual(staged["observations.json"][0]["status"], "excluded")
        self.assertIn("unresolved", " ".join(staged["observations.json"][0]["reasons"]))
        self.assertEqual(staged["candidates.json"], [])
        self.assertEqual(staged["provider-facts.json"], [])
        self.assertEqual(staged["coverage.json"]["locations"][0]["status"], "checked")

    def test_empty_rosters_are_loaded_zero_denominators_not_missing(self):
        actual_shapes(self.root)
        code, _, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((code, files["errors.json"]), (0, []))
        self.assertEqual(files["manifest.json"]["counts"]["rosterRows"], 0)
        for county in files["coverage.json"]["counties"]:
            self.assertEqual((county["rosterStatus"], county["missingRosterSources"]), ("loaded", []))
            self.assertEqual((county["locations"], county["rosterRows"]), (0, {"cms": 0, "state": 0}))

    def test_forbidden_hosts_override_permitted_labels_and_third_party_offerings(self):
        observations = []
        for index, host in enumerate(["caring.com", "care-one.com", "seniorcare.com", "yelp.com"]):
            observations.extend([
                variant(LISTING, f"blocked-{index}", url=f"https://www.{host}/location"),
                variant(PROVIDER_PAGE, f"blocked-provider-{index}", canonicalUrl=f"https://m.{host}/location"),
            ])
        observations.append(variant(PROVIDER_PAGE, "third-party", sourceType="review-platform"))
        _, _, files, _ = self.stage(observations, [])
        self.assertEqual(files["candidates.json"], [])
        self.assertEqual(files["provider-facts.json"], [])
        for observation in files["observations.json"]:
            self.assertEqual(observation["status"], "excluded")
            if observation["id"] != "third-party":
                self.assertIn("source-access", " ".join(observation["reasons"]))
        self.assertEqual(files["observations.json"][-1]["input"]["offerings"], PROVIDER_PAGE["offerings"])

    def test_source_access_file_is_applied_and_hashed_without_fetching(self):
        full_roster(self.root)
        path = write(self.root, f"{REGION}/reviews/observations/synthetic.json",
                     {"schemaVersion": 1, "observations": [variant(LISTING, "policy-check")]})
        first = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual(len(first[2]["candidates.json"]), 1)
        policy = write(self.root, f"{REGION}/reviews/source-access.json", {"sources": [{
            "terms_url": "https://reviews.example/terms", "access_decision": "restricted_no_automation",
            "retain_as_eligible": False, "basis": "SYNTHETIC access decision",
        }]})
        second = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertNotEqual(first[1]["runDir"], second[1]["runDir"])
        self.assertEqual(second[2]["candidates.json"], [])
        self.assertIn({"path": f"{REGION}/reviews/source-access.json",
                       "sha256": hashlib.sha256(policy.read_bytes()).hexdigest()},
                      second[2]["manifest.json"]["dependencyInputs"])
        write(self.root, f"{REGION}/reviews/source-access.json", b"{")
        invalid = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual(invalid[0], 1)
        self.assertEqual(invalid[2]["candidates.json"], [])
        self.assertEqual(invalid[2]["observations.json"][0]["status"], "excluded")

    def test_unknown_hosts_and_redirects_require_registry_permission(self):
        observations = [
            variant(LISTING, "unknown-visited", url="https://unassessed-directory.example/p/1"),
            variant(LISTING, "unknown-canonical", canonicalUrl="https://unassessed-directory.example/p/1"),
            variant(LISTING, "suffix-lookalike", url="https://evilreviews.example/p/1"),
            variant(LISTING, "prefix-lookalike", url="https://reviews.example.evil/p/1"),
            variant(LISTING, "denied-redirect", canonicalUrl="https://m.CARING.COM./p/1"),
            variant(LISTING, "trailing-dot-caring", url="https://caring.com./p/1"),
            variant(LISTING, "permitted-subdomain", url="https://locations.REVIEWS.EXAMPLE./p/1"),
        ]
        _, _, files, _ = self.stage(observations, [])
        self.assertEqual([c["observationId"] for c in files["candidates.json"]], ["permitted-subdomain"])
        self.assertEqual(files["provider-facts.json"], [])
        for entry in files["observations.json"][:-1]:
            self.assertEqual(entry["status"], "excluded", entry["id"])
            self.assertIn("source-access", " ".join(entry["reasons"]), entry["id"])
        self.assertEqual([entry["input"] for entry in files["observations.json"]], observations)

    def test_missing_and_malformed_access_registry_fail_closed(self):
        actual_shapes(self.root)
        write(self.root, f"{REGION}/cms/nursing-homes/provider-info.csv", csv_bytes(CMS_HEADER, [CMS_ROWS[1]]))
        path = write(self.root, f"{REGION}/reviews/observations/synthetic.json", {
            "schemaVersion": 1, "observations": [variant(LISTING, "listing"), variant(PROVIDER_PAGE, "facts")],
        })
        policy = self.root / REGION / "reviews/source-access.json"
        policy.unlink()
        code, _, files, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual(code, 1)
        self.assertIn("missing-access-registry", {e["code"] for e in files["errors.json"]})
        self.assertEqual(files["candidates.json"], [])
        self.assertEqual(files["provider-facts.json"], [])
        self.assertTrue(all(o["status"] == "excluded" for o in files["observations.json"]))
        for malformed in [
            b"{",
            {"sources": {}},
            {"sources": [None]},
            {"sources": [{"host": "reviews.example", "access_decision": 1}]},
            {"sources": [{"host": "reviews.example", "access_decision": "permitted"}]},
            {"sources": [{"source": "reviews.example", "access_decision": "permitted", "basis": "SYNTHETIC"}]},
            {"sources": [{"host": "reviews.example/path", "access_decision": "permitted", "basis": "SYNTHETIC"}]},
            {"sources": [{"terms_url": "https://[broken", "access_decision": "permitted", "basis": "SYNTHETIC"}]},
            {"sources": [
                {"host": "reviews.example", "access_decision": "permitted", "basis": "SYNTHETIC"},
                {"host": "other.example", "access_decision": None},
            ]},
        ]:
            with self.subTest(policy=malformed):
                write(self.root, f"{REGION}/reviews/source-access.json", malformed)
                code, _, files, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
                self.assertEqual(code, 1)
                self.assertIn("parse-error", {e["code"] for e in files["errors.json"]})
                self.assertEqual(files["candidates.json"], [])
                self.assertEqual(files["provider-facts.json"], [])
                self.assertTrue(all(o["status"] == "excluded" for o in files["observations.json"]))

    def test_registry_derives_hosts_from_urls_and_denials_override_permissions(self):
        actual_shapes(self.root)
        write(self.root, f"{REGION}/cms/nursing-homes/provider-info.csv", csv_bytes(CMS_HEADER, [CMS_ROWS[1]]))
        write(self.root, f"{REGION}/reviews/source-access.json", {"sources": [
            {"source": "SYNTHETIC directory without a host field", "terms_url": "https://www.REVIEWS.EXAMPLE./terms",
             "robots_url": "https://robots.example/robots.txt", "url": "https://listing.example/location",
             "access_decision": "permitted_low_volume", "basis": "SYNTHETIC terms checked"},
            {"host": "blocked.reviews.example.", "access_decision": "restricted_no_automation", "basis": "SYNTHETIC"},
            {"host": "blocked.reviews.example", "access_decision": "permitted", "basis": "SYNTHETIC conflicting permission"},
            {"host": "permitted.blocked.reviews.example", "access_decision": "permitted", "basis": "SYNTHETIC"},
            {"host": "care-one.com.", "access_decision": "permitted", "basis": "SYNTHETIC cannot override known ban"},
        ]})
        observations = [
            variant(LISTING, "terms-derived"),
            variant(LISTING, "robots-derived", url="https://robots.example/p/1"),
            variant(LISTING, "url-derived", canonicalUrl="https://listing.example/p/1"),
            variant(LISTING, "denied-after-allow", canonicalUrl="https://blocked.reviews.example/p/1"),
            variant(LISTING, "denied-parent", url="https://permitted.blocked.reviews.example/p/1"),
            variant(LISTING, "known-denial", url="https://m.care-one.com./p/1"),
        ]
        path = write(self.root, f"{REGION}/reviews/observations/synthetic.json",
                     {"schemaVersion": 1, "observations": observations})
        code, _, files, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual((code, files["errors.json"]), (0, []))
        self.assertEqual([c["observationId"] for c in files["candidates.json"]],
                         ["terms-derived", "robots-derived", "url-derived"])
        self.assertTrue(all(o["status"] == "excluded" for o in files["observations.json"][3:]))

    def test_identity_withholding_is_not_a_host_access_denial(self):
        actual_shapes(self.root)
        write(self.root, f"{REGION}/cms/nursing-homes/provider-info.csv", csv_bytes(CMS_HEADER, [CMS_ROWS[1]]))
        policy = {"host": "360healthcare.online", "robots_url": "https://360healthcare.online/robots.txt",
                  "access_decision": "public_read_only_identity_unresolved", "retain_as_eligible": False,
                  "basis": "SYNTHETIC page lacks an office address"}
        write(self.root, f"{REGION}/reviews/source-access.json", {"sources": [policy]})
        observation = variant(PROVIDER_PAGE, "identity-withheld", url="https://360healthcare.online/",
                              canonicalUrl="https://360healthcare.online/")
        path = write(self.root, f"{REGION}/reviews/observations/synthetic.json",
                     {"schemaVersion": 1, "observations": [observation]})
        code, _, files, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual((code, files["errors.json"]), (0, []))
        self.assertEqual(files["provider-facts.json"], [])
        reason = " ".join(files["observations.json"][0]["reasons"])
        self.assertIn("permitted access assessment", reason)
        self.assertNotIn("excluded by source-access policy", reason)
        policy["access_decision"] = "permitted_low_volume"
        write(self.root, f"{REGION}/reviews/source-access.json", {"sources": [policy]})
        _, _, reassessed, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual(len(reassessed["provider-facts.json"]), 1)

    def test_license_status_duplicates_and_county_inventory_summaries_keep_provenance(self):
        actual_shapes(self.root)
        firm, refs = derived_firm(self.root, license_status="Active")
        firms = [
            firm, firm, {**firm, "license_status": "Expired"},
            {**firm, "official_registration_id": "HP-CLOSED", "license_status": "Closed"},
            {**firm, "official_registration_id": "HP-REVOKED", "license_status": "Revoked"},
        ]
        write(self.root, f"{REGION}/state/union/home-care-firms.json", firms)
        write(self.root, f"{REGION}/state/union/care-units.json", [doh(
            "NJ-SYNTHETIC", "SYNTHETIC UNIT", "200 Test St", "Cranford", "07016", "Union",
            "ASSISTED LIVING RESIDENCE", 2,
            source={"file": "raw/ltc.xlsx", "sha256": refs[-1]["sha256"], "row": 2})])
        code, _, files, _ = run(self.root, "inventory", "--as-of", "2026-11-12")
        self.assertEqual((code, files["errors.json"]), (0, []))
        rows = files["roster.json"]["rows"]
        registrations = [r for r in rows if r["recordKind"] == "home_care_firm_registration"]
        self.assertEqual([r["licenseStatus"] for r in registrations], ["Active", "Active", "Expired", "Closed", "Revoked"])
        self.assertEqual([r["input"] for r in registrations], firms)
        coverage = files["coverage.json"]
        location = next(l for l in coverage["locations"] if l["rosterKey"] == "nj-dca-hcsf:HP-SYNTHETIC")
        self.assertEqual(location["licenseStatuses"], ["Active", "Expired"])
        self.assertTrue(location["licenseStatusConflict"])
        self.assertEqual(location["licenseStatusRows"], [
            {"licenseStatus": r["licenseStatus"], "source": r["source"]} for r in registrations[:3]
        ])
        self.assertEqual([r["licenseStatus"] for r in coverage["sourceRows"]
                          if r["recordKind"] == "home_care_firm_registration"],
                         ["Active", "Active", "Expired", "Closed", "Revoked"])
        county = coverage["counties"][0]
        self.assertEqual(county["locations"], 4)
        self.assertEqual(county["licenseStatuses"], {
            "Active": {"rosterRows": 2, "locations": 1},
            "Expired": {"rosterRows": 1, "locations": 1},
            "Closed": {"rosterRows": 1, "locations": 1},
            "Revoked": {"rosterRows": 1, "locations": 1},
            "not-reported": {"rosterRows": 1, "locations": 1},
        })
        self.assertEqual(county["licenseStatusConflicts"], 1)
        self.assertEqual(county["geography"], {
            "derived": {"rosterRows": 5, "locations": 3},
            "explicit": {"rosterRows": 1, "locations": 1},
            "unresolved": {"rosterRows": 0, "locations": 0},
        })
        self.assertEqual(county["recordKinds"], {
            "licensed_care_unit": {"rosterRows": 1, "locations": 1},
            "home_care_firm_registration": {"rosterRows": 5, "locations": 3},
        })
        self.assertIn("all-status/historical", coverage["inventoryMeaning"])
        self.assertEqual(files["manifest.json"]["counts"]["rosterRows"], 6)

    def test_historical_record_kind_blocks_complete_identity_and_has_separate_counts(self):
        actual_shapes(self.root)
        campus = {
            "record_kind": "historical_ccrc_campus_listing", "official_registration_id": "CCRC-SYNTHETIC",
            "name": MORRIS_IDENTITY["name"], "address": MORRIS_IDENTITY["street"], "city": MORRIS_IDENTITY["city"],
            "state": "NJ", "zip": MORRIS_IDENTITY["zip"], "county": "Morris", "official_type": "nursing-home",
            "county_basis": "Explicit DCA directory county heading", "source_date": "2018-01",
        }
        write(self.root, f"{REGION}/state/morris/ccrc-campuses.json", [campus])
        key = "nj-dca-ccrc:CCRC-SYNTHETIC"
        observations = [variant(LISTING, "historical-listing", rosterKey=key),
                        variant(PROVIDER_PAGE, "historical-facts", rosterKey=key)]
        path = write(self.root, f"{REGION}/reviews/observations/synthetic.json",
                     {"schemaVersion": 1, "observations": observations})
        code, _, files, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual((code, files["errors.json"]), (0, []))
        self.assertEqual(files["roster.json"]["rows"][0]["identityStatus"], "resolved")
        self.assertEqual(files["candidates.json"], [])
        self.assertEqual(files["provider-facts.json"], [])
        for entry in files["observations.json"]:
            self.assertEqual(entry["status"], "excluded")
            self.assertIn("historical_ccrc_campus_listing", " ".join(entry["reasons"]))
        county = files["coverage.json"]["counties"][1]
        self.assertEqual(county["locations"], 1)
        self.assertEqual(county["historicalCCRC"], {"rosterRows": 1, "locations": 1})
        self.assertEqual(county["nonHistoricalLocations"], 0)
        self.assertEqual(county["recordKinds"], {"historical_ccrc_campus_listing": {"rosterRows": 1, "locations": 1}})
        self.assertEqual(files["manifest.json"]["counts"]["rosterRows"], 1)

    def test_malformed_published_zip_is_retained_but_cannot_pass_exact_identity(self):
        actual_shapes(self.root)
        firm, _ = derived_firm(self.root, zip="07016 -1117")
        write(self.root, f"{REGION}/state/union/home-care-firms.json", [{**firm, "zip": "07016"}, firm])
        observation = variant(LISTING, "bad-published-zip", rosterKey="nj-dca-hcsf:HP-SYNTHETIC", identity={
            "name": firm["name"], "street": firm["address"], "city": firm["city"], "zip": firm["zip"],
            "careSetting": firm["official_type"], "careUnitText": "Health Care Services",
        })
        path = write(self.root, f"{REGION}/reviews/observations/synthetic.json",
                     {"schemaVersion": 1, "observations": [observation]})
        code, _, files, _ = run(self.root, "stage", "--as-of", "2026-11-12", "--observations", str(path))
        self.assertEqual((code, files["errors.json"]), (0, []))
        self.assertEqual(files["roster.json"]["rows"][1]["address"]["zip"], "07016 -1117")
        self.assertEqual(files["coverage.json"]["counties"][0]["rosterRows"]["state"], 2)
        self.assertEqual(files["coverage.json"]["locations"][0]["identityStatus"], "unresolved-identity")
        self.assertEqual(files["observations.json"][0]["status"], "excluded")
        self.assertIn("do not repair or stage", " ".join(files["observations.json"][0]["reasons"]))
        self.assertEqual(files["candidates.json"], [])


if __name__ == "__main__":
    unittest.main()
