#!/usr/bin/env python3
"""Acceptance checks over retained evidence. Run with python3 -B scripts/regions/reviews.integration.test.py."""

import sys

sys.dont_write_bytecode = True

import builtins
import io
import json
import os
import unittest
from contextlib import ExitStack
from datetime import date
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

import reviews

ROOT = Path(__file__).resolve().parents[2]
REGION = Path("research/north-jersey")
COUNTIES = ["union", "morris", "essex", "bergen", "hudson", "passaic"]
BATCH = ROOT / REGION / "reviews/public-inventory/checked-batch.json"


def read_json(path):
    return json.loads(path.read_bytes())


def read_only(open_file):
    def checked(file, mode="r", *args, **kwargs):
        if any(flag in mode for flag in "wax+"):
            raise AssertionError(f"Unexpected write to {file}")
        return open_file(file, mode, *args, **kwargs)
    return checked


def build_without_side_effects(observations):
    with ExitStack() as stack:
        stack.enter_context(patch.object(builtins, "open", read_only(builtins.open)))
        stack.enter_context(patch.object(io, "open", read_only(io.open)))
        for name in ("open", "mkdir", "remove", "unlink", "rename", "replace", "rmdir",
                     "truncate", "chmod", "utime", "link", "symlink"):
            stack.enter_context(patch.object(os, name, side_effect=AssertionError(f"Unexpected os.{name}")))
        for target in ("socket.create_connection", "socket.socket.connect", "socket.socket.connect_ex"):
            stack.enter_context(patch(target, side_effect=AssertionError("Unexpected network access")))
        return reviews.build_run(ROOT, COUNTIES, date(2026, 11, 12), observations)


class RetainedReviewsAcceptance(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        cls.batch = read_json(BATCH)
        cls.first = build_without_side_effects(BATCH)
        cls.second = build_without_side_effects(BATCH)
        cls.files = {name: json.loads(data) for name, data in cls.first[1].items()}
        cls.rows = cls.files["roster.json"]["rows"]
        cls.coverage = cls.files["coverage.json"]
        cls.observations = {o["id"]: o for o in cls.files["observations.json"]}

    def test_every_actual_source_row_is_retained_and_receipts_reconcile(self):
        expected = {}
        expected_counts = {}
        expected_keys = {}
        in_scope = set()
        unresolved = set()
        manifest = read_json(ROOT / REGION / "cms/manifest.json")
        for dataset in ("4pq5-n9py", "6jpm-sxkc"):
            source = manifest["sources"][dataset]
            self.assertTrue(source["complete"], dataset)
            total = 0
            for partition in source["partitions"]:
                self.assertTrue(partition["complete"], dataset)
                count = 0
                for receipt in partition["pages"]:
                    path = REGION / "cms" / receipt["file"]
                    data = (ROOT / path).read_bytes()
                    self.assertEqual(sha256(data).hexdigest(), receipt["sha256"], str(path))
                    raw_rows = json.loads(data)["results"]
                    expected_counts[path.as_posix()] = len(raw_rows)
                    self.assertEqual(len(raw_rows), receipt["rows"], str(path))
                    count += len(raw_rows)
                    for number, raw in enumerate(raw_rows, 1):
                        ref = (path.as_posix(), number)
                        expected[ref] = raw
                        expected_keys[ref] = f"cms-ccn:{raw['cms_certification_number_ccn']}"
                        if (raw.get("countyparish") or "").lower() in COUNTIES:
                            in_scope.add(ref)
                        if not raw.get("countyparish"):
                            unresolved.add(ref)
                self.assertEqual(count, partition["retrieved_rows"])
                self.assertEqual(count, partition["expected_count"])
                total += count
            self.assertEqual(total, source["retained_rows"])

        for county in COUNTIES + [None]:
            names = ("care-units.json", "home-care-firms.json", "ccrc-campuses.json") if county else (
                "unresolved-home-care-counties.json",)
            for name in names:
                path = REGION / "state" / county / name if county else REGION / "state" / name
                raw_rows = read_json(ROOT / path)
                expected_counts[path.as_posix()] = len(raw_rows)
                for number, raw in enumerate(raw_rows, 1):
                    ref = (path.as_posix(), number)
                    expected[ref] = raw
                    identifier = raw.get("official_facility_id") or raw.get("official_registration_id")
                    scheme = "nj-doh" if name == "care-units.json" else "nj-dca-hcsf"
                    expected_keys[ref] = f"{scheme}:{identifier}" if identifier else f"source-row:{path}#{number}"
                    if (raw.get("county") or "").lower() in COUNTIES:
                        in_scope.add(ref)
                    if raw.get("county") is None:
                        unresolved.add(ref)

        self.assertEqual(len(expected), 2094)
        self.assertEqual(len(in_scope), 1783)
        self.assertEqual(len({expected_keys[ref] for ref in in_scope}), 1770)
        self.assertEqual(len(unresolved), 102)
        actual = {(r["source"]["path"], r["source"]["row"]): r["input"] for r in self.rows}
        self.assertEqual(actual, expected)
        self.assertEqual(len(self.rows), len(expected))
        self.assertEqual({(r["source"]["path"], r["source"]["row"]): r["key"] for r in self.rows}, expected_keys)
        self.assertEqual({(r["source"]["path"], r["source"]["row"]) for r in self.rows
                          if r["scope"] == "in-scope"}, in_scope)
        self.assertEqual({(r["source"]["path"], r["source"]["row"]) for r in self.rows
                          if r["geography"]["status"] == "unresolved"}, unresolved)
        self.assertEqual(self.files["roster.json"]["rejectedRows"], [])
        self.assertEqual(self.files["errors.json"], [])
        receipts = self.files["manifest.json"]["rosterInputs"]
        self.assertEqual({i["path"]: i["rows"] for i in receipts}, expected_counts)
        self.assertEqual(sum(i["accepted"] for i in receipts), 2094)
        self.assertTrue(all(i["rejected"] == 0 and i["status"] == "loaded" for i in receipts))
        self.assertCountEqual([r["source"] for r in self.coverage["sourceRows"]],
                              [r["source"] for r in self.rows])

    def test_county_denominators_keep_unresolved_geography_separate(self):
        counties = self.coverage["counties"]
        self.assertEqual([c["county"] for c in counties], [c.title() for c in COUNTIES])
        self.assertEqual(sum(sum(c["rosterRows"].values()) for c in counties), 1783)
        self.assertEqual(sum(c["locations"] for c in counties), 1770)
        self.assertEqual(self.coverage["unresolvedGeography"]["rosterRows"], 102)
        unresolved = [l for l in self.coverage["locations"] if l["geography"]["status"] == "unresolved"]
        self.assertEqual(self.coverage["unresolvedGeography"]["locations"], len(unresolved))
        self.assertTrue(all(l["county"] is None and l["scope"] != "in-scope" for l in unresolved))
        self.assertTrue(all(c["rosterStatus"] == "loaded" and c["missingRosterSources"] == [] for c in counties))
        for county in counties:
            mine = [l for l in self.coverage["locations"]
                    if l["scope"] == "in-scope" and l["county"] == county["county"]]
            self.assertEqual(county["locations"], len(mine))
            self.assertEqual(county["checked"] + county["notChecked"], len(mine))

    def test_historical_ccrc_rows_keep_null_official_identity_and_are_ineligible(self):
        historical = [r for r in self.rows if r["recordKind"] == "historical_ccrc_campus_listing"]
        self.assertEqual(len(historical), 7)
        staged_keys = {r["rosterKey"] for name in ("candidates.json", "provider-facts.json")
                       for r in self.files[name]}
        for row in historical:
            with self.subTest(key=row["key"]):
                self.assertIsNone(row["input"]["official_registration_id"])
                self.assertIsNone(row["identifier"])
                self.assertTrue(row["key"].startswith("source-row:"))
                self.assertEqual(row["identityStatus"], "unresolved-identity")
                self.assertNotIn(row["key"], staged_keys)

    def test_actual_batch_has_no_invalid_observations(self):
        invalid = [{"id": o.get("id"), "rosterKey": o.get("rosterKey"), "reasons": o["reasons"]}
                   for o in self.files["observations.json"] if o["status"] == "invalid"]
        self.assertEqual(invalid, [])
        self.assertEqual(self.files["errors.json"], [])
        self.assertEqual([o["input"] for o in self.files["observations.json"]], self.batch["observations"])

    def test_jewish_home_is_exact_google_candidate_not_a_score(self):
        candidates = self.files["candidates.json"]
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate["rosterKey"], "nj-doh:NJ02A00")
        self.assertEqual(candidate["status"], "awaiting-review")
        self.assertEqual(candidate["sourceFamily"], "google")
        self.assertEqual(candidate["aggregate"], {
            "sourceId": candidate["observationId"], "platform": "MyLivingChoice",
            "sourceFamily": "google", "rating": 4.3, "scale": 5, "count": 11,
            "asOf": None, "scope": "consumer",
        })
        self.assertEqual(candidate["source"]["url"],
                         "https://www.mylivingchoice.com/property/jewish-home-assisted-living")
        observed = self.observations[candidate["observationId"]]
        self.assertEqual(observed["status"], "accepted")
        self.assertEqual(observed["input"]["identity"], {
            "name": "Jewish Home Assisted Living", "street": "685 Westwood Avenue", "city": "River Vale",
            "state": "New Jersey", "zip": "07675", "careSetting": "ASSISTED LIVING RESIDENCE",
            "careUnitText": "Assisted Living", "unit": None,
        })
        location = next(l for l in self.coverage["locations"] if l["rosterKey"] == candidate["rosterKey"])
        self.assertEqual(location["sampleStatus"], "awaiting-review")
        self.assertNotIn("score", candidate)

    def test_agape_exact_office_facts_do_not_infer_price_openings_or_certification(self):
        self.assertEqual(self.files["provider-facts.json"], [{
            "rosterKey": "nj-dca-hcsf:HP0427400", "observationId": "checked-home-HP0427400-provider",
            "url": "https://agapehomecareagency.org/", "checkedAt": "2026-11-12", "sourceClaimDate": None,
            "offerings": ["Personal care", "Home care aide", "Skilled nursing", "Companionship",
                          "Physical/occupational therapy", "Respite care"],
            "prices": {"status": "unknown", "reason": "not listed on the checked page", "items": []},
            "openings": {"status": "unknown", "reason": "not listed on the checked page", "items": []},
        }])
        observation = self.observations["checked-home-HP0427400-provider"]
        self.assertEqual(observation["status"], "accepted")
        identity = observation["input"]["identity"]
        self.assertEqual((identity["name"], identity["street"], identity["city"], identity["zip"],
                          identity["careSetting"]),
                         ("Agape Home Care Agency", "59 Beaverbrook Rd, ste 201C", "Lincoln Park",
                          "07035", "Health Care Services"))
        row = next(r for r in self.rows if r["key"] == "nj-dca-hcsf:HP0427400")
        self.assertIsNone(row["crosswalk"])

    def test_missing_visible_zips_and_summit_population_are_honestly_excluded(self):
        ids = ["checked-pilot-cms-315488-mlc"] + [
            f"checked-union-morris-{identifier}-mlc"
            for identifier in ("NJ90122", "NJ90144", "NJ13A012", "NJ60A001")]
        self.assertEqual(len(ids), 5)
        staged = {r["observationId"] for name in ("candidates.json", "provider-facts.json")
                  for r in self.files[name]}
        for oid in ids + ["checked-union-morris-NJ20A014-mlc"]:
            with self.subTest(observation=oid):
                observation = self.observations[oid]
                self.assertIsNone(observation["input"]["identity"]["zip"])
                self.assertEqual(observation["status"], "excluded")
                self.assertIn("observed zip is missing", observation["reasons"])
                self.assertNotIn(oid, staged)
        summit = self.observations["checked-union-morris-NJ20A014-mlc"]
        self.assertEqual(summit["input"]["population"], "ambiguous")
        self.assertTrue(any("population" in reason for reason in summit["reasons"]), summit["reasons"])

    def test_denied_sources_never_stage_and_raw_provenance_is_verifiable(self):
        manifest = self.files["manifest.json"]
        for receipt in manifest["rosterInputs"] + manifest["dependencyInputs"] + [manifest["observationInput"]]:
            with self.subTest(path=receipt["path"]):
                self.assertEqual(receipt["sha256"], sha256((ROOT / receipt["path"]).read_bytes()).hexdigest())
        dependencies = {i["path"]: i["sha256"] for i in manifest["dependencyInputs"]}
        for row in self.rows:
            self.assertEqual(row["source"]["sha256"], sha256((ROOT / row["source"]["path"]).read_bytes()).hexdigest())
            raw = row["input"]
            for source in ([raw["source"]] if "source" in raw else []) + raw.get("county_reference_sources", []):
                path = (REGION / "state" / source["file"]).as_posix()
                self.assertEqual(dependencies[path], source["sha256"], path)
        for observation in self.batch["observations"]:
            self.assertTrue(observation.get("evidence"), observation["id"])
            for evidence in observation["evidence"]:
                self.assertEqual(evidence["sha256"], sha256((ROOT / evidence["path"]).read_bytes()).hexdigest(),
                                 observation["id"])
        policy = read_json(ROOT / REGION / "reviews/source-access.json")
        denied = {"caring.com", "care-one.com", "seniorcare.com", "yelp.com"}
        for source in policy["sources"]:
            if source.get("retain_as_eligible") is False:
                for field in ("url", "terms_url", "robots_url"):
                    if source.get(field):
                        denied.add(urlsplit(source[field]).hostname.removeprefix("www."))
                if source.get("host"):
                    denied.add(source["host"])
        for name in ("candidates.json", "provider-facts.json"):
            for record in self.files[name]:
                observation = self.observations[record["observationId"]]["input"]
                self.assertEqual(observation["access"]["decision"], "permitted")
                for field in ("url", "canonicalUrl"):
                    host = urlsplit(observation[field]).hostname
                    self.assertFalse(any(host == d or host.endswith("." + d) for d in denied), host)
        gaps = [o for o in self.files["observations.json"] if o["outcome"] == "access-gap"]
        self.assertEqual(len(gaps), 4)
        self.assertTrue(all(o["input"]["reason"] for o in gaps))

    def test_redacted_receipts_bind_each_observation_to_the_public_projection(self):
        rows = read_json(BATCH.with_name("evidence.json"))["rows"]
        batch = self.batch["observations"] + self.batch["leads"]
        self.assertEqual(len(rows), len(batch))
        for index, item in enumerate(batch):
            receipt, = item["evidence"]
            self.assertEqual(receipt["pointer"], f"/rows/{index}")
            row = rows[index]
            self.assertEqual(row["id"], item["id"])
            for k in ("rosterKey","url","rating","identity","sourceFamily","offerings","prices","openings"):
                self.assertEqual(row.get(k),item.get(k))
            self.assertTrue(row["originalReceipts"])
            for original in row["originalReceipts"]:
                self.assertRegex(original["sha256"],r"^[0-9a-f]{64}$")
                self.assertLessEqual(set(original), {"path","pointer","sha256"})

    def test_repeat_build_is_byte_identical_without_any_filesystem_or_network_writes(self):
        self.assertEqual(self.first, self.second)
        self.assertEqual(set(self.first[1]), {
            "manifest.json", "roster.json", "observations.json", "candidates.json",
            "provider-facts.json", "leads.json", "coverage.json", "errors.json",
        })


if __name__ == "__main__":
    unittest.main()
