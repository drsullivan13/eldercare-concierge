#!/usr/bin/env python3
"""Source-backed acceptance tests for the NJ address-points release."""

import importlib.util
import json
import unittest
from hashlib import sha256
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "research/north-jersey/address-points"
SPEC = importlib.util.spec_from_file_location(
    "address_points", Path(__file__).with_name("address-points.py"))
ap = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ap)

ACCURACY = {"nj-address-point", "nj-street-interpolated", "census-street-interpolated",
            "zip-representative-point", "supplied-coordinate-unverified"}


def provider(**overrides):
    base = {"id": "test-1", "name": "TEST PROVIDER", "category": "home-care",
            "address": "144 GALES DRIVE NEW PROVIDENCE, NJ 07974",
            "city": "NEW PROVIDENCE", "state": "NJ", "zip": "07974",
            "lat": 40.7024, "lng": -74.4023, "locationKind": "zip",
            "officialRecord": True}
    base.update(overrides)
    return base


def nj_candidate(**attrs):
    attributes = {"Loc_name": "NJ_Geocode_Mul", "Addr_type": "PointAddress",
                  "StAddr": "144 Gales Drive", "City": "New Providence",
                  "Subregion": "Union", "RegionAbbr": "NJ", "Postal": "07974",
                  "Addr_Block": "163", "Addr_Lot": "43", "Addr_Qualifier": ""}
    attributes.update(attrs)
    return {"address": "144 Gales Drive, New Providence, New Jersey, 07974",
            "location": {"x": -74.4023925, "y": 40.702383},
            "attributes": attributes, "score": 100}


class AddressParsingTests(unittest.TestCase):
    def test_plain_facility_address(self):
        parts = ap.street_parts(provider())
        self.assertEqual(parts["street"], "144 GALES DRIVE")
        self.assertEqual(parts["streetKey"], "144 GALES DR")
        self.assertEqual(parts["unit"], "")
        self.assertTrue(parts["parseable"])

    def test_suite_is_preserved_and_not_geocoded(self):
        parts = ap.street_parts(provider(address="680 BROADWAY SUITE 301 PATERSON, NJ 07514",
                                         city="PATERSON", zip="07514"))
        self.assertEqual(parts["street"], "680 BROADWAY")
        self.assertEqual(parts["unit"], "SUITE 301")
        self.assertTrue(parts["parseable"])

    def test_po_box_is_not_a_street_match(self):
        parts = ap.street_parts(provider(address="P.O. BOX 1131", city="ENGLEWOOD CLIFFS"))
        self.assertFalse(parts["parseable"])

    def test_street_with_trailing_po_box_is_not_a_street_match(self):
        parts = ap.street_parts(provider(
            address="540 WEST HANOVER AVENUE PO BOX 437 MORRISTOWN, NJ 07960",
            city="MORRISTOWN", zip="07960"))
        self.assertFalse(parts["parseable"])

    def test_spelled_out_one_becomes_digit(self):
        parts = ap.street_parts(provider(address="ONE GATEWAY CENTER, SUITE 2600",
                                         city="NEWARK", zip="07102"))
        self.assertEqual(parts["street"], "1 GATEWAY CENTER")
        self.assertEqual(parts["unit"], "SUITE 2600")

    def test_bergen_hyphenated_house_number(self):
        parts = ap.street_parts(provider(address="16-50 Chandler Dr", city="Fair Lawn",
                                         zip="07410"))
        self.assertEqual(parts["street"], "16-50 Chandler Dr")
        self.assertTrue(parts["parseable"])

    def test_hash_marks_a_unit(self):
        parts = ap.street_parts(provider(address="470 PROSPECT AVENUE, #104",
                                         city="WEST ORANGE", zip="07052"))
        self.assertEqual(parts["street"], "470 PROSPECT AVENUE")
        self.assertTrue(parts["parseable"])

    def test_floor_designation_splits_street(self):
        parts = ap.street_parts(provider(address="294 CENTRAL AVENUE, 1ST FLOOR",
                                         city="ORANGE", zip="07050"))
        self.assertEqual(parts["street"], "294 CENTRAL AVENUE")
        self.assertIn("FLOOR", parts["unit"].upper())


class CandidateAcceptanceTests(unittest.TestCase):
    def inspect(self, candidate, **overrides):
        return ap.inspect_candidate(provider(**overrides), "Union", candidate, "nj", set())

    def test_exact_point_match_accepted(self):
        row = self.inspect(nj_candidate())
        self.assertTrue(row["accepted"])
        self.assertEqual(row["coordinateAccuracy"], "nj-address-point")
        self.assertEqual(row["lat"], 40.702383)

    def test_street_range_match_is_labeled_interpolated(self):
        row = self.inspect(nj_candidate(Addr_type="StreetAddress"))
        self.assertTrue(row["accepted"])
        self.assertEqual(row["coordinateAccuracy"], "nj-street-interpolated")

    def test_zip_mismatch_rejected(self):
        row = self.inspect(nj_candidate(Postal="07901"))
        self.assertFalse(row["accepted"])
        self.assertFalse(row["checks"]["exactZip"])

    def test_street_mismatch_rejected(self):
        row = self.inspect(nj_candidate(StAddr="144 Gales Court"))
        self.assertFalse(row["accepted"])
        self.assertFalse(row["checks"]["exactStreetNumberAndName"])

    def test_county_mismatch_rejected(self):
        row = self.inspect(nj_candidate(Subregion="Essex"))
        self.assertFalse(row["accepted"])

    def test_postal_locality_match_type_rejected(self):
        for kind in ("Postal", "Locality", "Admin"):
            row = self.inspect(nj_candidate(Addr_type=kind))
            self.assertFalse(row["accepted"], kind)
            self.assertFalse(row["checks"]["streetLevelType"])

    def test_zip_representative_point_rejected(self):
        candidate = nj_candidate()
        point = (candidate["location"]["y"], candidate["location"]["x"])
        row = ap.inspect_candidate(provider(), "Union", candidate, "nj", {point})
        self.assertFalse(row["accepted"])
        self.assertFalse(row["checks"]["notZipRepresentativePoint"])

    def test_out_of_state_coordinates_rejected(self):
        candidate = nj_candidate()
        candidate["location"] = {"x": -71.0, "y": 42.3}
        row = self.inspect(candidate)
        self.assertFalse(row["accepted"])

    def test_city_alias_difference_does_not_reject(self):
        row = self.inspect(nj_candidate(City="New Providence Borough"))
        self.assertTrue(row["accepted"])
        self.assertFalse(row["checks"]["exactCity"])

    def test_census_candidate_is_interpolated(self):
        candidate = {
            "matchedAddress": "144 GALES DR, NEW PROVIDENCE, NJ, 07974",
            "coordinates": {"x": -74.4023, "y": 40.7024},
            "addressComponents": {"zip": "07974", "city": "NEW PROVIDENCE",
                                  "state": "NJ"},
            "geographies": {"Counties": [{"STATE": "34", "COUNTY": "039"}]},
            "tigerLine": {"side": "L", "tigerLineId": "1"},
        }
        row = ap.inspect_candidate(provider(), "Union", candidate, "census", set())
        self.assertTrue(row["accepted"])
        self.assertEqual(row["coordinateAccuracy"], "census-street-interpolated")

    def test_census_match_outside_six_counties_rejected(self):
        candidate = {
            "matchedAddress": "144 GALES DR, NEW PROVIDENCE, NJ, 07974",
            "coordinates": {"x": -74.4023, "y": 40.7024},
            "addressComponents": {"zip": "07974", "city": "NEW PROVIDENCE",
                                  "state": "NJ"},
            "geographies": {"Counties": [{"STATE": "34", "COUNTY": "023"}]},
        }
        row = ap.inspect_candidate(provider(), "Union", candidate, "census", set())
        self.assertFalse(row["accepted"])
        self.assertFalse(row["checks"]["countyAgrees"])


class ReleaseAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = json.loads((OUTPUT / "providers-by-id.json").read_bytes())
        cls.coverage = json.loads((OUTPUT / "coverage.json").read_bytes())
        cls.exceptions = json.loads((OUTPUT / "exceptions.json").read_bytes())
        cls.runtime = json.loads(
            (ROOT / "research/north-jersey/runtime/providers.json").read_bytes())

    def test_release_covers_every_provider_exactly_once(self):
        self.assertEqual(set(self.release), {p["id"] for p in self.runtime})
        self.assertEqual(len(self.release), 974)
        self.assertEqual(self.coverage["providerCount"], 974)

    def test_every_capture_body_matches_its_receipt(self):
        checked = 0
        for receipt_path in OUTPUT.glob("raw/*/*.json"):
            receipt = json.loads(receipt_path.read_bytes())
            body = (OUTPUT / receipt["bodyFile"]).read_bytes()
            self.assertEqual(sha256(body).hexdigest(), receipt["sha256"])
            self.assertEqual(len(body), receipt["bytes"])
            checked += 1
        self.assertGreater(checked, 800)

    def test_matched_records_pass_every_acceptance_check(self):
        matched = 0
        for record in self.release.values():
            if record["status"] != "matched":
                continue
            matched += 1
            match = record["match"]
            self.assertIn(match["source"], ("nj", "census"))
            self.assertIn(match["coordinateAccuracy"],
                          ("nj-address-point", "nj-street-interpolated",
                           "census-street-interpolated"))
            self.assertEqual(match["lat"], record["lat"])
            self.assertEqual(match["lng"], record["lng"])
            for key, passed in match["checks"].items():
                if key == "exactCity":
                    continue
                self.assertTrue(passed, (record["providerId"], key))
            self.assertNotEqual(match["coordinateAccuracy"], "zip-representative-point")
        self.assertGreater(matched, 0)

    def test_fallback_records_preserve_supplied_coordinates(self):
        by_id = {p["id"]: p for p in self.runtime}
        for record in self.release.values():
            if record["status"] == "matched":
                continue
            supplied = by_id[record["providerId"]]
            self.assertEqual(record["lat"], supplied["lat"])
            self.assertEqual(record["lng"], supplied["lng"])
            self.assertIn(record["coordinateAccuracy"],
                          ("zip-representative-point", "supplied-coordinate-unverified"))
            self.assertIn("no_unique_validated_official_street_match",
                          record["exceptions"])

    def test_no_verified_label_on_representative_points(self):
        zips = json.loads((OUTPUT / "inputs/zips.json").read_bytes())
        points = {(z["lat"], z["lng"]) for z in zips.values()}
        for record in self.release.values():
            if record["status"] == "matched":
                self.assertNotIn((record["lat"], record["lng"]), points,
                                 record["providerId"])

    def test_supplied_address_and_units_preserved(self):
        by_id = {p["id"]: p for p in self.runtime}
        for record in self.release.values():
            supplied = by_id[record["providerId"]]
            self.assertEqual(record["suppliedAddress"]["address"], supplied["address"])
            self.assertEqual(record["suppliedAddress"]["zip"], supplied["zip"])
            if "SUITE" in supplied["address"].upper() or "STE " in supplied["address"].upper():
                self.assertTrue(record["addressParts"]["unit"], record["providerId"])
                self.assertIn("unit_preserved_but_not_geospatially_verified",
                              record["exceptions"])

    def test_coverage_totals_reconcile(self):
        total = self.coverage["coverage"]["all"]["total"]
        self.assertEqual(total, 974)
        by_county = sum(v["total"] for k, v in self.coverage["coverage"].items()
                        if k.startswith("county/"))
        self.assertEqual(by_county, 974)
        by_setting = sum(v["total"] for k, v in self.coverage["coverage"].items()
                         if k.startswith("setting/"))
        self.assertEqual(by_setting, 974)
        matched = self.coverage["coverage"]["all"].get("matched", 0)
        fallback = self.coverage["coverage"]["all"].get("fallback", 0)
        self.assertEqual(matched + fallback, 974)

    def test_two_same_zip_examples_have_distinct_street_points(self):
        examples = self.coverage["twoSameZipExamples"]
        self.assertEqual(len(examples), 2)
        for example in examples:
            pair = example["providers"]
            self.assertEqual(len(pair), 2)
            a, b = pair
            self.assertEqual(a["suppliedAddress"]["zip"], example["zip"])
            self.assertEqual(b["suppliedAddress"]["zip"], example["zip"])
            self.assertNotEqual((a["lat"], a["lng"]), (b["lat"], b["lng"]))
            self.assertNotEqual(a["suppliedAddress"]["address"],
                                b["suppliedAddress"]["address"])

    def test_exceptions_file_lists_every_exception_record(self):
        expected = {pid for pid, row in self.release.items() if row["exceptions"]}
        self.assertEqual(set(self.exceptions), expected)

    def test_location_ids_are_deterministic(self):
        for record in self.release.values():
            parts = record["addressParts"]
            key = [parts["streetKey"], record["suppliedAddress"]["zip"]]
            location = "nj-location-" + sha256(
                ap.encoded([*key, ap.normalized(parts["unit"])])).hexdigest()[:20]
            self.assertEqual(record["locationId"], location, record["providerId"])


if __name__ == "__main__":
    unittest.main()
