#!/usr/bin/env python3
"""Acceptance tests for the NJ home-care supply builder. Run: python3 -B scripts/regions/nj_homecare_supply_test.py"""

import gzip
import sys

sys.dont_write_bytecode = True

import csv  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402
import zipfile  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402
from pathlib import Path  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import nj_homecare_supply as supply  # noqa: E402
from nj_collect import place_key, workbook_rows  # noqa: E402

RESEARCH = ROOT / "research/north-jersey"
OUT = RESEARCH / "home-care-supply"
BUILDER = HERE / "nj_homecare_supply.py"
CAPTURED = "2026-11-15"
TARGET = {"Essex", "Morris", "Union", "Somerset", "Middlesex", "Bergen", "Passaic", "Monmouth", "Hudson"}
PROVIDER_KEYS = {"id", "name", "category", "address", "city", "state", "zip", "lat", "lng", "locationKind", "phone",
                 "description", "services", "officialRecord", "sources", "warnings", "limitations"}
INPUTS = [
    supply.REGISTRY_FILE, supply.REGISTRY_FILE + ".json", "state/raw/municipalities.json",
    "state/raw/municipalities.json.json", "state/raw/localities.html", "state/raw/localities.html.json",
    "geography/source-manifest.json", "geography/raw/geonames-US.zip", "geography/raw/geonames-readme.txt",
    "geography/raw/census-2026-zcta.zip", "geography/raw/census-2020-zcta-county.txt",
    supply.BASELINE, supply.BASELINE + ".json", "geography/nj-zips.json", "geography/manifest.json",
    "home-care-supply/source/census-office-geocode/capture.json",
    "home-care-supply/source/census-office-geocode/census-input.csv",
    "home-care-supply/source/census-office-geocode/census-output.csv",
]


def run(*args):
    return subprocess.run([sys.executable, "-B", str(BUILDER), *map(str, args)], capture_output=True, text=True)


def load(name, directory=OUT):
    return json.loads((directory / name).read_text())


def excel(serial):
    return (datetime(1899, 12, 30) + timedelta(days=float(serial))).date().isoformat() if serial else None


class PublishedSnapshot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = workbook_rows(RESEARCH / supply.REGISTRY_FILE)
        cls.providers = load("providers.json")
        cls.by_id = {p["id"]: p for p in cls.providers}
        cls.ledger = load("rows.json")
        cls.registrations = {r["registrationId"]: r for r in load("registrations.json")}
        cls.reconciliation = load("reconciliation.json")
        cls.zip_refs = load("zip-references.json")
        cls.runtime = {p["id"]: p for p in json.loads(gzip.decompress((RESEARCH / supply.BASELINE).read_bytes())) if p["category"] == "home-care"}

    def test_check_mode_accepts_retained_outputs(self):
        result = run("--check")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_two_offline_builds_are_byte_identical_to_retained_outputs(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            for directory in (first, second):
                result = run("--output-dir", directory)
                self.assertEqual(result.returncode, 0, result.stderr)
            names = sorted(path.name for path in Path(first).iterdir())
            self.assertEqual(names, sorted([*load("manifest.json")["outputs"], "manifest.json"]))
            for name in names:
                self.assertEqual((Path(first) / name).read_bytes(), (Path(second) / name).read_bytes(), name)
                self.assertEqual((Path(first) / name).read_bytes(), (OUT / name).read_bytes(), name)

    def test_registry_counts_match_the_coordinator_baseline(self):
        ids = {row["License/Registration"].strip().upper() for row in self.rows}
        active = [row for row in self.rows if row["License Status"] == "Active"]
        baseline = {"rows": 3628, "distinctIds": 3582, "activeRows": 1678, "idsWithActiveRow": 1644}
        observed = {"rows": len(self.rows), "distinctIds": len(ids), "activeRows": len(active),
                    "idsWithActiveRow": len({row["License/Registration"].strip().upper() for row in active})}
        self.assertEqual(observed, baseline)
        self.assertEqual({k: self.reconciliation["registry"][k] for k in baseline}, baseline)
        self.assertEqual(len(self.registrations), 3582)
        past = [row for row in active if excel(row["Expiration Date"]) and excel(row["Expiration Date"]) < CAPTURED]
        self.assertEqual(len(past), 331)
        self.assertEqual(self.reconciliation["registry"]["activeRowsPastExpirationAtCapture"], 331)
        self.assertEqual(self.reconciliation["registry"]["checkedAt"], CAPTURED)
        self.assertIsNone(self.reconciliation["registry"]["dataAsOf"])

    def test_every_source_row_has_exactly_one_disposition(self):
        self.assertEqual([entry["row"] for entry in self.ledger], [row["source_row"] for row in self.rows])
        by_row = {row["source_row"]: row for row in self.rows}
        allowed = {"published", "held", "excluded", "exact_duplicate", "superseded_non_active"}
        for entry in self.ledger:
            self.assertIn(entry["disposition"], allowed)
            source = by_row[entry["row"]]
            self.assertEqual(entry["registrationId"], source["License/Registration"].strip().upper())
            self.assertEqual(entry["status"], source["License Status"])
            if entry["disposition"] == "exact_duplicate":
                primary = by_row[entry["primaryRow"]]
                self.assertLess(entry["primaryRow"], entry["row"])
                strip = lambda r: {k: v for k, v in r.items() if k not in ("source_row", "License/Registration")}
                self.assertEqual(strip(source), strip(primary))
                self.assertEqual(source["License/Registration"].upper(), primary["License/Registration"].upper())
        counts = {d: sum(e["disposition"] == d for e in self.ledger) for d in allowed}
        self.assertEqual(counts["published"], len(self.providers))
        self.assertEqual(counts["exact_duplicate"], 45)
        self.assertEqual(counts["superseded_non_active"], 1)
        self.assertEqual(sum(counts.values()), 3628)

    def test_published_registrations_map_one_to_one_to_providers(self):
        published = [r for r in self.registrations.values() if r["outcome"] == "published"]
        self.assertEqual(sorted(r["providerId"] for r in published), sorted(self.by_id))
        self.assertEqual(len(self.by_id), len(self.providers))
        for reg in published:
            self.assertEqual(reg["providerId"], "north-jersey-hp-" + reg["registrationId"].lower())

    def test_mixed_status_registration_resolves_to_its_single_active_row(self):
        record = self.by_id["north-jersey-hp-hp0365500"]
        self.assertEqual((record["address"], record["city"], record["zip"]),
                         ("80 COTTONTAIL LANE, SUITE 430", "SOMERSET", "08873"))
        self.assertIn("source row 2195", record["sources"][0]["supports"])
        self.assertTrue(any("source row 2193" in w and "Expired" in w and "GLEN ROCK" in w for w in record["warnings"]))
        rows = {e["row"]: e for e in self.ledger if e["registrationId"] == "HP0365500"}
        self.assertEqual(rows[2193]["disposition"], "superseded_non_active")
        self.assertEqual(rows[2193]["primaryRow"], 2195)
        self.assertEqual(rows[2195]["disposition"], "published")
        self.assertEqual(self.registrations["HP0365500"]["county"], "Somerset")
        self.assertEqual(sum(p["id"] == "north-jersey-hp-hp0365500" for p in self.providers), 1)

    def test_consumer_records_carry_only_registry_and_location_facts(self):
        by_row = {row["source_row"]: row for row in self.rows}
        for record in self.providers:
            self.assertLessEqual(set(record), PROVIDER_KEYS, record["id"])
            self.assertEqual((record["category"], record["state"], record["officialRecord"], record["services"]),
                             ("home-care", "NJ", True, []))
            self.assertRegex(record["id"], r"^north-jersey-hp-hp\d+$")
            self.assertIn(record["locationKind"], ("office", "zip"))
            self.assertTrue(38.8 <= record["lat"] <= 41.4 and -75.6 <= record["lng"] <= -73.8, record["id"])
            registry_source = record["sources"][0]
            self.assertEqual((registry_source["url"], registry_source["checkedAt"]),
                             ("https://rgbportal.dca.njoag.gov/public-view/", CAPTURED))
            self.assertNotIn("dataAsOf", registry_source)
            row = by_row[int(re.search(r"source row (\d+)", registry_source["supports"])[1])]
            self.assertEqual(row["License Status"], "Active")
            self.assertEqual("north-jersey-hp-" + row["License/Registration"].strip().lower(), record["id"])
            self.assertEqual(record["name"], row["Business Name"])
            self.assertIn(f"Portal lists expiration {excel(row['Expiration Date'])}.", " ".join(record["limitations"]))
            self.assertTrue(any("private-pay acceptance" in l for l in record["limitations"]))
            self.assertTrue(any("not countywide service coverage" in l for l in record["limitations"]))
            self.assertIn("Not a verified service area.", record["description"])
            past = excel(row["Expiration Date"]) < CAPTURED
            self.assertEqual(past, any(excel(row["Expiration Date"]) in w and "Active" in w for w in record["warnings"]))
            if record["locationKind"] == "zip":
                ref = self.zip_refs[record["zip"]]
                self.assertEqual((record["lat"], record["lng"]), (ref["lat"], ref["lng"]))
                self.assertIn("approximate ZIP representative point", record["limitations"][-1])
        self.assertLess(max(len(json.dumps(p)) for p in self.providers), 4000)

    def test_runtime_records_are_reused_or_explicitly_omitted(self):
        omitted = {e["providerId"]: e["reason"] for e in self.reconciliation["runtime"]["omitted"]}
        self.assertEqual(omitted, {
            "north-jersey-hp-hp0144800": "po_box_address", "north-jersey-hp-hp0404800": "po_box_address",
            "north-jersey-hp-hp0286200": "city_zip_county_conflict",
            "north-jersey-hp-hp0373200": "city_zip_county_conflict",
        })
        self.assertEqual(len(self.runtime), 673)
        for pid, original in self.runtime.items():
            if pid in omitted:
                self.assertNotIn(pid, self.by_id)
                continue
            record = self.by_id[pid]
            identity = ("id", "address", "city", "state", "zip", "lat", "lng", "name", "locationKind")
            self.assertEqual({k: record[k] for k in identity}, {k: original[k] for k in identity}, pid)
            self.assertEqual(record["sources"][0]["checkedAt"], CAPTURED)
            self.assertEqual(record["warnings"][:len(original["warnings"])], original["warnings"])
        kinds = [self.by_id[pid]["locationKind"] for pid in self.runtime if pid in self.by_id]
        self.assertEqual((kinds.count("office"), kinds.count("zip")), (588, 81))

    def test_app_runtime_records_match_retained_runtime_or_this_output(self):
        market = next(m for m in json.loads((ROOT / "src/data/regional-markets.json").read_text())
                      if m["id"] == "north-jersey")
        app = [p for p in market["providers"] if p["id"].startswith("north-jersey-hp-")]
        self.assertEqual(len(app), 1074)
        for record in app:
            basis = self.by_id.get(record["id"]) or self.runtime[record["id"]]
            fields = ["name", "address", "city", "state", "zip", "category", "locationKind"]
            if record["id"] in self.by_id:
                fields.extend(["lat", "lng"])
            else:
                self.assertIsNone(record["lat"])
                self.assertTrue(any("physical office location is unverified" in w for w in record["warnings"]))
            for field in fields:
                self.assertEqual(record[field], basis[field], (record["id"], field))
            if record.get("website") or record.get("serviceAreaZips"):
                self.assertTrue(any(s["kind"] == "provider" for s in record["sources"]))
        by_id = {p["id"]: p for p in app}
        for key, zip_code in (("hp0289000", "08807"), ("hp0374000", "08817")):
            self.assertIn(zip_code, by_id["north-jersey-hp-"+key]["serviceAreaZips"])
        held = by_id["north-jersey-hp-hp0436900"]
        self.assertFalse(any(held.get(k) for k in ("serviceArea", "services", "website", "serviceAreaZips")))

    def test_county_assignment_reconciles_place_and_zip_candidates(self):
        for reg in self.registrations.values():
            if reg["outcome"] != "published":
                continue
            overlap = set(reg["placeCounties"]) & set(reg["zipCounties"])
            self.assertTrue(overlap and overlap <= TARGET, reg["registrationId"])
            self.assertEqual(set(self.zip_refs[reg["zip"]]["counties"]), set(reg["zipCounties"]))
            if reg["county"] is None:
                self.assertGreater(len(overlap), 1)
            else:
                self.assertEqual(overlap, {reg["county"]})
        expected = {"HP0365500": "Somerset", "HP0015347": "Morris"}
        for reg_id, county in expected.items():
            self.assertEqual(self.registrations[reg_id]["county"], county)
        hackensack = self.registrations["HP0286200"]
        self.assertEqual((hackensack["outcome"], hackensack["reason"], hackensack["placeCounties"], hackensack["zipCounties"]),
                         ("held", "city_zip_county_conflict", ["Bergen"], ["Passaic"]))
        newfoundland = [r for r in self.registrations.values() if r.get("county", "") is None]
        self.assertTrue(all(set(r["candidateCounties"]) <= TARGET for r in newfoundland))
        counties = self.reconciliation["counties"]
        self.assertEqual(sum(c["published"] for c in counties.values())
                         + len(self.reconciliation["publishedMultipleTargetCounties"]), len(self.providers))
        for county, entry in counties.items():
            self.assertEqual(entry["published"] > 0, county in TARGET, county)
            self.assertEqual(entry["published"], entry["publishedRuntimeReused"] + entry["publishedNew"])

    def test_held_registrations_are_listed_gaps_and_never_published(self):
        held = {r["registrationId"]: r for r in self.registrations.values() if r["outcome"] == "held"}
        self.assertEqual(sum(self.reconciliation["registrationOutcomes"]["held"].values()), len(held))
        listed = {entry["registrationId"] for entry in self.reconciliation["heldTargetRelevant"]}
        self.assertEqual(listed, {k for k, r in held.items() if r["targetRelevant"]})
        self.assertEqual(held["HP0389400"]["reason"], "zip_not_in_nj_postal_reference")
        for reg_id in held:
            self.assertNotIn("north-jersey-hp-" + reg_id.lower(), self.by_id)

    def test_zip_points_equal_retained_census_or_geonames_values(self):
        with zipfile.ZipFile(RESEARCH / "geography/raw/census-2026-zcta.zip") as archive:
            reader = csv.reader(io.StringIO(archive.read(archive.namelist()[0]).decode("utf-8-sig")), delimiter="|")
            header = [h.strip() for h in next(reader)]
            gazetteer = {row[header.index("GEOID")]: (float(row[header.index("INTPTLAT")]),
                                                       float(row[header.index("INTPTLONG")])) for row in reader}
        with zipfile.ZipFile(RESEARCH / "geography/raw/geonames-US.zip") as archive:
            postal = {}
            for line in archive.read("US.txt").decode().splitlines():
                fields = line.split("\t")
                if fields[4] == "NJ":
                    postal.setdefault(fields[1], []).append((fields[2], float(fields[9]), float(fields[10])))
        runtime_zips = load("geography/nj-zips.json", RESEARCH)
        for code, ref in self.zip_refs.items():
            expected = gazetteer.get(code) or min(postal[code])[1:]
            self.assertEqual((ref["lat"], ref["lng"]), expected, code)
            self.assertEqual(ref["inRuntimeLookup"], code in runtime_zips)
            if code in runtime_zips:
                self.assertEqual(runtime_zips[code], {"city": ref["city"], "lat": ref["lat"], "lng": ref["lng"]})
        self.assertNotIn("08873", runtime_zips)
        self.assertIn("08873", self.zip_refs)

    def test_census_office_points_are_exact_matches_for_the_registry_address(self):
        base = RESEARCH / "home-care-supply/source/census-office-geocode"
        inputs = {row[0]: row for row in csv.reader(open(base / "census-input.csv"))}
        outputs = {row[0]: row for row in csv.reader(open(base / "census-output.csv"))}
        census = [p for p in self.providers if any(s["publisher"] == "U.S. Census Bureau" for s in p["sources"])
                  and p["id"] not in self.runtime]
        self.assertEqual(len(census), 236)
        for record in census:
            reg_id = record["id"].removeprefix("north-jersey-hp-").upper()
            self.assertEqual(outputs[reg_id][2:4], ["Match", "Exact"])
            lng, lat = map(float, outputs[reg_id][5].split(","))
            self.assertEqual((record["lat"], record["lng"], record["locationKind"]), (lat, lng, "office"))
            self.assertTrue(record["address"].upper().startswith(inputs[reg_id][1].upper()))
            self.assertEqual(inputs[reg_id][4], record["zip"])
        moved = self.by_id["north-jersey-hp-hp0389500"]
        self.assertEqual((moved["locationKind"], moved["address"]), ("office", "2905 Birchwood Court"))


def row(number, reg_id="HP0000001", status="Active", name="ACME CARE LLC", address="10 MAIN STREET",
        city="MORRISTOWN", state="NJ", zip_code="07960", expires="46660.1666666667"):
    return {"source_row": number, "Business Name": name, "License/Registration": reg_id,
            "License Type": "Health Care Services", "License Status": status, "Expiration Date": expires,
            "DBAs": "", "Business Country": "United States", "Business Address": address, "Business City": city,
            "Business USA State": state, "Business Foreign State/Province": "", "Business Zipcode": zip_code,
            "Business Phone": "(973) 555-0100"}


def ref(lat, lng, *counties):
    return {"city": "X", "lat": lat, "lng": lng, "coordinateSource": "census_2026_zcta_representative_point",
            "countyBasis": "census_2020_zcta_positive_land_overlap", "counties": sorted(counties),
            "outOfStateCountyFips": []}


PLACES = {place_key(name): {"municipality": set(m), "locality": set(loc)} for name, m, loc in [
    ("MORRISTOWN", {"Morris"}, ()), ("NEWFOUNDLAND", (), {"Morris", "Passaic"}),
    ("HAMILTON", {"Mercer", "Atlantic"}, {"Monmouth"}), ("HACKENSACK", {"Bergen"}, ()), ("CAMDEN", {"Camden"}, ()),
]}
ZIPS = {"07960": ref(40.78, -74.50, "Morris"), "07435": ref(41.05, -74.43, "Morris", "Passaic"),
        "08691": ref(40.20, -74.60, "Mercer", "Monmouth"), "07524": ref(40.93, -74.15, "Passaic"),
        "08102": ref(39.95, -75.12, "Camden")}
REGISTRY = {"url": "https://example.test/registry", "checkedAt": CAPTURED}
NO_GEOCODES = {"records": {}, "countyFips": {"34027": "Morris"}, "url": "https://example.test/census", "checkedAt": "2026-11-15"}


def resolve(rows, runtime=None, geocodes=NO_GEOCODES):
    result = supply.resolve(rows, PLACES, ZIPS, runtime or {}, REGISTRY, geocodes)
    registrations = {r["registrationId"]: r for r in result["registrations"]}
    ledger = {e["row"]: e for e in result["rows"]}
    return result, registrations, ledger


class SyntheticResolution(unittest.TestCase):
    def assertHeld(self, rows, reason, reg_id="HP0000001"):
        result, registrations, ledger = resolve(rows)
        self.assertEqual((registrations[reg_id]["outcome"], registrations[reg_id].get("reason")), ("held", reason))
        self.assertEqual(result["providers"], [])
        self.assertEqual(sorted(ledger), sorted(r["source_row"] for r in rows))
        return registrations[reg_id], ledger

    def test_multiple_active_rows_with_conflicting_fields_are_held_never_duplicated(self):
        for field, value in [("address", "99 OTHER ROAD"), ("name", "OTHER NAME"), ("expires", "46295.1666666667")]:
            with self.subTest(field=field):
                reg, ledger = self.assertHeld([row(2), row(3, **{field: value})], "conflicting_active_rows")
                self.assertEqual(reg["activeRows"], [2, 3])
                self.assertEqual({e["disposition"] for e in ledger.values()}, {"held"})

    def test_exact_duplicates_collapse_after_registration_case_normalization(self):
        result, registrations, ledger = resolve([row(2, reg_id="hp0000001"), row(3, reg_id="HP0000001 ")])
        self.assertEqual([p["id"] for p in result["providers"]], ["north-jersey-hp-hp0000001"])
        self.assertEqual(ledger[3], {"row": 3, "registrationId": "HP0000001", "status": "Active",
                                     "disposition": "exact_duplicate", "primaryRow": 2})
        self.assertEqual(registrations["HP0000001"]["sourceIds"], ["HP0000001 ", "hp0000001"])

    def test_active_row_wins_over_expired_row_at_another_address_with_a_warning(self):
        result, registrations, ledger = resolve([
            row(2, status="Expired", address="5 OLD ROAD", expires="45473.1666666667"), row(3)])
        [record] = result["providers"]
        self.assertEqual(record["address"], "10 MAIN STREET")
        self.assertTrue(any("source row 2" in w and "Expired" in w and "5 OLD ROAD" in w for w in record["warnings"]))
        self.assertEqual(ledger[2]["disposition"], "superseded_non_active")
        self.assertEqual(registrations["HP0000001"]["variantConflict"]["rows"], [2, 3])
        same_place, _, _ = resolve([row(2, status="Expired", expires="45473.1666666667"), row(3)])
        self.assertEqual(same_place["providers"][0]["warnings"], [])

    def test_only_the_exact_active_status_is_eligible(self):
        _, registrations, ledger = resolve([row(2, status="Expired."), row(3, reg_id="HP0000002", status="active")])
        self.assertEqual({r["reason"] for r in registrations.values()}, {"no_active_row"})
        self.assertEqual({e["disposition"] for e in ledger.values()}, {"excluded"})

    def test_missing_address_po_box_and_invalid_zip_are_held(self):
        self.assertHeld([row(2, address="15")], "missing_address")
        self.assertHeld([row(2, address="P.O. Box 12")], "po_box_address")
        self.assertHeld([row(2, zip_code="0796")], "invalid_zip")
        reg, _ = self.assertHeld([row(2, zip_code="07089")], "zip_not_in_nj_postal_reference")
        self.assertEqual((reg["candidateCounties"], reg["targetRelevant"]), (["Morris"], True))

    def test_zip_plus_four_variants_resolve_to_the_five_digit_zip(self):
        for value in ("07960-1234", " 07960", "07960 -1234", "079601234"):
            result, _, _ = resolve([row(2, zip_code=value)])
            self.assertEqual(result["providers"][0]["zip"], "07960", value)

    def test_county_ambiguity_including_a_non_target_county_is_held(self):
        reg, _ = self.assertHeld([row(2, city="Hamilton", zip_code="08691")], "county_ambiguous")
        self.assertEqual((reg["candidateCounties"], reg["targetRelevant"]), (["Mercer", "Monmouth"], True))

    def test_ambiguity_entirely_inside_the_target_publishes_without_a_county(self):
        result, registrations, _ = resolve([row(2, city="Newfoundland", zip_code="07435")])
        self.assertEqual(len(result["providers"]), 1)
        reg = registrations["HP0000001"]
        self.assertEqual((reg["county"], reg["countyAssignment"], reg["candidateCounties"]),
                         (None, "multiple_target_overlap", ["Morris", "Passaic"]))

    def test_city_and_zip_in_different_counties_are_held(self):
        reg, _ = self.assertHeld([row(2, city="HACKENSACK", zip_code="07524")], "city_zip_county_conflict")
        self.assertEqual((reg["placeCounties"], reg["zipCounties"]), (["Bergen"], ["Passaic"]))
        self.assertHeld([row(2, city="MORRISTWON")], "place_name_unmatched")

    def test_state_and_target_boundaries(self):
        _, registrations, _ = resolve([
            row(2, reg_id="HP0000001", state="NY", zip_code="10001"),
            row(3, reg_id="HP0000002", state="", zip_code="75019", city="DALLAS"),
            row(4, reg_id="HP0000003", city="CAMDEN", zip_code="08102"),
        ])
        self.assertEqual({k: (r["outcome"], r["reason"]) for k, r in registrations.items()}, {
            "HP0000001": ("excluded", "outside_nj"), "HP0000002": ("excluded", "outside_nj"),
            "HP0000003": ("excluded", "outside_target_counties")})

    def test_blank_state_nj_office_is_published_with_its_limitation(self):
        result, _, _ = resolve([row(2, state="")])
        self.assertIn(supply.BLANK_STATE_LIMITATION, result["providers"][0]["limitations"])
        self.assertEqual(result["providers"][0]["state"], "NJ")

    def test_active_past_expiration_is_published_with_literal_date_and_warning(self):
        result, registrations, _ = resolve([row(2, expires="46295.1666666667")])
        [record] = result["providers"]
        self.assertTrue(registrations["HP0000001"]["expirationPastAtCapture"])
        self.assertEqual(registrations["HP0000001"]["expiration"], "2026-09-30")
        self.assertIn("Portal lists expiration 2026-09-30.", " ".join(record["limitations"]))
        self.assertTrue(any("2026-09-30" in w and CAPTURED in w for w in record["warnings"]))

    def test_runtime_overlay_keeps_identity_and_coordinates_or_reports_a_mismatch(self):
        generated, _, _ = resolve([row(2, expires="46295.1666666667")])
        runtime = {**generated["providers"][0], "lat": 40.7801, "lng": -74.4901, "locationKind": "office",
                   "warnings": [], "limitations": generated["providers"][0]["limitations"][:4] + ["Map position uses a NJ address point."]}
        result, registrations, _ = resolve([row(2, expires="46295.1666666667")], {runtime["id"]: runtime})
        [record] = result["providers"]
        self.assertEqual((record["lat"], record["lng"], record["locationKind"]), (40.7801, -74.4901, "office"))
        self.assertEqual(len(record["warnings"]), 1)
        self.assertEqual(registrations["HP0000001"]["runtime"], "reused")
        moved, registrations, _ = resolve([row(2, address="20 NEW STREET")], {runtime["id"]: runtime})
        self.assertEqual(registrations["HP0000001"]["runtime"], "regenerated")
        self.assertEqual(moved["providers"][0]["locationKind"], "zip")
        self.assertIn("address", moved["runtime"]["regenerated"][0]["fields"])
        held, registrations, _ = resolve([row(2, address="PO BOX 1")], {runtime["id"]: runtime})
        self.assertEqual(held["runtime"]["omitted"], [{"providerId": runtime["id"], "reason": "po_box_address"}])

    def test_census_office_point_requires_an_exact_match_for_the_same_address(self):
        exact = {"street": "10 MAIN STREET", "city": "MORRISTOWN", "state": "NJ", "zip": "07960", "match": "Match",
                 "exactness": "Exact", "matchedAddress": "10 MAIN ST, MORRISTOWN, NJ, 07960",
                 "coordinates": "-74.4812,40.7968", "stateFips": "34", "countyFips": "027"}
        cases = {
            "accepted": exact,
            "not_exact_match": {**exact, "exactness": "Non_Exact"},
            "input_differs_from_registry_row": {**exact, "street": "2905 BIRCHWOOD COURT"},
            "matched_zip_differs": {**exact, "matchedAddress": "10 MAIN ST, MORRISTOWN, NJ, 07961"},
            "matched_street_differs": {**exact, "matchedAddress": "12 MAIN ST, MORRISTOWN, NJ, 07960"},
            "census_county_differs": {**exact, "countyFips": "031"},
        }
        for expected, record in cases.items():
            with self.subTest(expected=expected):
                result, registrations, _ = resolve([row(2)], geocodes={**NO_GEOCODES, "records": {"HP0000001": record}})
                [provider] = result["providers"]
                self.assertEqual(registrations["HP0000001"]["officeGeocode"], expected)
                self.assertEqual(provider["locationKind"], "office" if expected == "accepted" else "zip")
                if expected == "accepted":
                    self.assertEqual((provider["lat"], provider["lng"]), (40.7968, -74.4812))
                    self.assertEqual(provider["sources"][1]["publisher"], "U.S. Census Bureau")


class InputBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.temp.name) / "base"
        for relative in INPUTS:
            target = cls.base / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(RESEARCH / relative, target)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def copy(self):
        target = Path(tempfile.mkdtemp(dir=self.temp.name))
        shutil.copytree(self.base, target / "research")
        return target / "research", target / "out"

    def build(self, research, out, *extra):
        return run("--research-root", research, "--output-dir", out, *extra)

    def assertRejected(self, research, message):
        result = self.build(research, research.parent / "out")
        self.assertEqual(result.returncode, 1)
        self.assertIn(message, result.stderr)
        self.assertFalse((research.parent / "out").exists())

    def test_copied_inputs_rebuild_the_retained_outputs(self):
        research, out = self.copy()
        self.assertEqual(self.build(research, out).returncode, 0)
        self.assertEqual((out / "providers.json").read_bytes(), (OUT / "providers.json").read_bytes())

    def test_tampered_workbook_is_rejected(self):
        research, _ = self.copy()
        body = bytearray((research / supply.REGISTRY_FILE).read_bytes())
        body[-10] ^= 1
        (research / supply.REGISTRY_FILE).write_bytes(bytes(body))
        self.assertRejected(research, "Source hash mismatch")

    def test_replayed_capture_with_rewritten_sidecar_is_rejected(self):
        research, _ = self.copy()
        replay = RESEARCH / "state/raw/firms.xlsx"
        body = replay.read_bytes()
        (research / supply.REGISTRY_FILE).write_bytes(body)
        sidecar = research / (supply.REGISTRY_FILE + ".json")
        meta = json.loads(sidecar.read_text())
        meta.update(sha256=supply.sha256(body), bytes=len(body))
        sidecar.write_text(json.dumps(meta))
        self.assertRejected(research, "Unpinned input capture")

    def test_sidecar_date_or_count_drift_is_rejected(self):
        research, _ = self.copy()
        sidecar = research / (supply.REGISTRY_FILE + ".json")
        meta = json.loads(sidecar.read_text())
        sidecar.write_text(json.dumps({**meta, "retrieved_at": "2026-11-13T00:00:00+00:00"}))
        self.assertRejected(research, "Capture date differs")
        sidecar.write_text(json.dumps({**meta, "displayed_rows": 3624}))
        self.assertRejected(research, "row count")

    def test_tampered_runtime_and_geocode_inputs_are_rejected(self):
        for relative in (supply.BASELINE, "home-care-supply/source/census-office-geocode/census-output.csv",
                         "geography/raw/census-2020-zcta-county.txt"):
            with self.subTest(relative=relative):
                research, _ = self.copy()
                path = research / relative
                path.write_bytes(path.read_bytes() + b"\n")
                self.assertRejected(research, "Source hash mismatch")

    def test_check_detects_output_tampering_and_build_refuses_foreign_files(self):
        research, out = self.copy()
        self.assertEqual(self.build(research, out).returncode, 0)
        self.assertEqual(self.build(research, out, "--check").returncode, 0)
        self.assertEqual(self.build(research, out).returncode, 0)
        original = (out / "providers.json").read_bytes()
        (out / "providers.json").write_bytes(original.replace(b'"services":[]', b'"services":["Companion care"]', 1))
        check = self.build(research, out, "--check")
        self.assertEqual(check.returncode, 1)
        self.assertIn("providers.json", check.stderr)
        refused = self.build(research, out)
        self.assertEqual(refused.returncode, 1)
        self.assertIn("was not written by this builder", refused.stderr)
        foreign = research.parent / "foreign"
        foreign.mkdir()
        (foreign / "providers.json").write_text("[]\n")
        self.assertEqual(self.build(research, foreign).returncode, 1)
        self.assertEqual((foreign / "providers.json").read_text(), "[]\n")


if __name__ == "__main__":
    unittest.main()
