#!/usr/bin/env python3
"""Behavior checks for the bounded, independently approved review release."""

import copy
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("release_reviews", Path(__file__).with_name("release-reviews.py"))
release = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release
SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.observation_path = "research/north-jersey/reviews/pilot-direct-check.json"
        self.material_path = "research/north-jersey/review-release/checks/independent.md"
        self.url = "https://www.mylivingchoice.com/property/example-home"
        self.observation = {
            "source": "MyLivingChoice", "source_type": "review-platform",
            "source_url": self.url, "inspection": "full-page", "checked_at": "2026-11-12",
            "access_decision": "permitted_low_volume",
            "identity": {
                "observed_name": "Example Home", "observed_address": "151 Madison Avenue",
                "observed_city": "Morristown", "observed_state": "New Jersey",
                "observed_zip": None, "observed_care_unit": "Skilled Nursing / Long Term Care",
            },
            "aggregate": {
                "rating": 4.4, "scale": 5, "review_count": 40,
                "published_as_of": None, "scope": "consumer", "source_family": "google",
            },
        }
        self.providers = [{
            "id": "cms-315488", "name": "EXAMPLE HOME",
            "address": "151 MADISON AVENUE MORRISTOWN, NJ 07960",
            "city": "MORRISTOWN", "state": "NJ", "zip": "07960", "category": "nursing-home",
        }]
        self.crosswalk = [{
            "providerId": "cms-315488", "officialId": "NJ60921",
            "licensedName": "EXAMPLE HOME (NJ60921)",
            "licensedSetting": "LONG TERM CARE FACILITY SNF/NF", "status": "included",
        }]
        self.write("research/north-jersey/runtime/providers.json", self.providers)
        self.write("research/north-jersey/runtime/crosswalk.json", self.crosswalk)
        self.write("research/north-jersey/listing-index/discovery-queue.json", {
            "coverage": [{"providerId": "cms-315488", "status": "scoped_sitemap_no_hit"}],
        })
        self.write_observation()
        material = f"{self.url}\n# Example Home\n151 Madison Avenue Morristown New Jersey\n"
        material += "Skilled Nursing / Long Term Care\n4.4 out of 5 from 40 Google reviews\n"
        self.write(self.material_path, material)
        self.approval = {
            "id": "independent-example", "providerId": "cms-315488", "officialId": "NJ60921",
            "observation": self.reference(self.observation_path, "/direct_observation"),
            "material": self.reference(self.material_path), "url": self.url,
            "checkedAt": "2026-11-12", "access": "full-page", "platform": "MyLivingChoice",
            "identity": {"name": "Example Home", "address": "151 Madison Avenue",
                         "city": "Morristown", "state": "New Jersey", "zip": None,
                         "careUnit": "Skilled Nursing / Long Term Care"},
            "aggregate": {"rating": 4.4, "scale": 5, "count": 40, "asOf": None,
                          "scope": "consumer", "sourceFamily": "google"},
            "reason": "Independent full-page check matches the single official nursing unit.",
        }

    def write(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value.encode() if isinstance(value, str) else release.encoded(value))

    def reference(self, path, pointer=None):
        result = {"path": path, "sha256": release.digest((self.root / path).read_bytes())}
        if pointer is not None:
            result["pointer"] = pointer
        return result

    def write_observation(self):
        self.write(self.observation_path, {
            "checked_at": "2026-11-12", "location": {"official_id": "NJ60921"},
            "direct_observation": self.observation,
        })

    def update_observation(self):
        self.write_observation()
        self.approval["observation"] = self.reference(self.observation_path, "/direct_observation")

    def build(self, approvals=None):
        self.write("research/north-jersey/review-release/approvals.json", {
            "schemaVersion": 1, "assessmentDate": "2026-11-12",
            "approvals": [self.approval] if approvals is None else approvals,
        })
        return release.build(self.root)

    def assert_fails(self, message, approvals=None):
        with self.assertRaisesRegex(release.ReleaseError, message):
            self.build(approvals)

    def acquisition(self, *, family="caring", day="2026-11-13", batch_day="2026-11-13"):
        approval = copy.deepcopy(self.approval)
        approval.update(id="new-acquisition", checkedAt=day, platform="Caring.com",
                        url="https://www.caring.com/senior-living/new-jersey/morristown/example-home")
        approval["aggregate"].update(rating=4.2, count=30, sourceFamily=family)
        receipt = {
            key: copy.deepcopy(approval[key]) for key in
            ("providerId", "officialId", "url", "platform", "checkedAt", "identity", "aggregate")
        }
        receipt.update(sourceType="review-platform", inspection="full-page",
                       access_decision="permitted_public_page", httpStatus=200,
                       evidence=[], reviewSample={
                           "sourceFamily": family, "selection": "all-visible-before-highlighting",
                           "visibleCount": 0, "observations": [],
                       })
        base = str(release.ACQUISITION)
        observation_path = base + "/original-sources/receipts.json"
        material_path = base + "/integration/check.json"
        self.write(observation_path, {"receipts": [receipt]})
        self.write(material_path, receipt)
        approval["observation"] = self.reference(observation_path, "/receipts/0")
        approval["material"] = self.reference(material_path)
        self.write(str(release.ACQUISITION_LEDGER), {
            "schemaVersion": 1,
            "batches": [{"id": "original-batch", "assessmentDate": batch_day, "approvals": [approval]}],
        })
        return approval, receipt

    def test_acquisition_empty_is_byte_identical_and_unlisted_files_are_not_read(self):
        before = self.build()
        self.write(str(release.ACQUISITION / "original-sources/unreviewed.json"), "not valid JSON")
        for batches in ([], [{"id": "empty-batch", "assessmentDate": "2026-11-13", "approvals": []}]):
            self.write(str(release.ACQUISITION_LEDGER), {"schemaVersion": 1, "batches": batches})
            self.assertEqual(release.encoded(before), release.encoded(self.build()))

    def test_acquisition_adds_original_mean_count_without_overwriting_legacy(self):
        before = self.build()
        approval, _ = self.acquisition()
        output = self.build()
        record = output["locationResearch.json"]["cms-315488"]
        old = before["locationResearch.json"]["cms-315488"]
        self.assertIn(old["sources"][0], record["sources"])
        self.assertIn(old["reviewAggregates"][0], record["reviewAggregates"])
        added = next(a for a in record["reviewAggregates"] if a["platform"] == "Caring.com")
        for key, value in approval["aggregate"].items():
            self.assertEqual(added[key], value)
        summary = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertEqual(summary["reviewCount"], 70)
        self.assertEqual(summary["independentSourceCount"], 2)
        self.assertEqual(record["facts"], [])
        self.assertEqual(record["reviews"], [])
        audit = next(a for a in output["approvals-audit.json"]["approvals"]
                     if a["approval"]["id"] == approval["id"])
        self.assertEqual(audit["acquisitionBatch"],
                         {"id": "original-batch", "assessmentDate": "2026-11-13"})
        self.assertEqual(old["sources"][0]["checkedAt"], "2026-11-12")
        self.assertEqual(release.encoded(output), release.encoded(self.build()))
        paths = {r["path"] for r in output["manifest.json"]["inputs"]}
        self.assertTrue({str(release.ACQUISITION_LEDGER), approval["observation"]["path"],
                         approval["material"]["path"]}.issubset(paths))
        self.assertEqual(len(record["sources"]), len({s["id"] for s in record["sources"]}))

    def test_acquisition_batch_dates_do_not_relax_legacy_dates(self):
        self.acquisition()
        self.approval["checkedAt"] = "2026-11-13"
        self.assert_fails("future independent check date")

    def test_acquisition_validates_each_batch_date_independently(self):
        self.acquisition(batch_day="2026-11-12")
        self.assert_fails("exceeds its batch date")
        self.acquisition(batch_day="2999-01-01")
        self.assert_fails("Invalid acquisition batch date")

    def test_acquisition_duplicate_ids_fail_instead_of_overwriting(self):
        approval, _ = self.acquisition()
        approval["id"] = self.approval["id"]
        ledger_path = str(release.ACQUISITION_LEDGER)
        ledger = json.loads((self.root / ledger_path).read_bytes())
        ledger["batches"][0]["approvals"] = [approval]
        self.write(ledger_path, ledger)
        self.assert_fails("Duplicate approval ID")

    def test_acquisition_requires_explicit_ids_and_observed_address(self):
        for field, value, message in (
            ("providerId", None, "explicit exact-unit"),
            ("officialId", None, "explicit exact-unit"),
            ("identity", {**self.approval["identity"], "address": "152 Madison Avenue"}, "identity mismatch"),
        ):
            with self.subTest(field=field):
                approval, receipt = self.acquisition()
                approval[field] = receipt[field] = value
                self.write(approval["observation"]["path"], {"receipts": [receipt]})
                self.write(approval["material"]["path"], receipt)
                approval["observation"] = self.reference(approval["observation"]["path"], "/receipts/0")
                approval["material"] = self.reference(approval["material"]["path"])
                self.write(str(release.ACQUISITION_LEDGER), {
                    "schemaVersion": 1, "batches": [
                        {"id": "exact-unit", "assessmentDate": "2026-11-13", "approvals": [approval]}],
                })
                self.assert_fails(message)

    def test_acquisition_rejects_check_disagreement_access_failures_and_sample_injection(self):
        for field, value, message in (
            ("identity", {**self.approval["identity"], "address": "Wrong"}, "disagrees"),
            ("aggregate", {**self.approval["aggregate"], "count": 99}, "disagrees"),
            ("access_decision", "restricted", "permitted"),
            ("httpStatus", 403, "successful full-page"),
            ("inspection", "search-result", "successful full-page"),
            ("checkedAt", "2026-11-14", "batch date"),
            ("reviews", [], "Malformed acquisition independent check"),
        ):
            with self.subTest(field=field):
                approval, receipt = self.acquisition()
                receipt[field] = value
                self.write(approval["material"]["path"], receipt)
                ledger_path = str(release.ACQUISITION_LEDGER)
                ledger = json.loads((self.root / ledger_path).read_bytes())
                ledger["batches"][0]["approvals"][0]["material"] = self.reference(approval["material"]["path"])
                self.write(ledger_path, ledger)
                self.assert_fails(message)

    def test_acquisition_receipt_and_check_hash_drift_fail(self):
        for field in ("observation", "material"):
            with self.subTest(field=field):
                approval, _ = self.acquisition()
                self.write(approval[field]["path"], "{}")
                self.assert_fails("Source hash drift")

    def test_acquisition_family_dedup_uses_the_real_scorer(self):
        approval, receipt = self.acquisition(family="google")
        receipt.update(platform="MyLivingChoice",
                       url="https://www.mylivingchoice.com/property/example-home-second-reading")
        receipt["aggregate"] = copy.deepcopy(self.approval["aggregate"])
        approval.update(platform=receipt["platform"], url=receipt["url"], aggregate=receipt["aggregate"])
        self.write(approval["observation"]["path"], {"receipts": [receipt]})
        self.write(approval["material"]["path"], receipt)
        approval["observation"] = self.reference(approval["observation"]["path"], "/receipts/0")
        approval["material"] = self.reference(approval["material"]["path"])
        self.write(str(release.ACQUISITION_LEDGER), {
            "schemaVersion": 1,
            "batches": [{"id": "google-repeat", "assessmentDate": "2026-11-13", "approvals": [approval]}],
        })
        output = self.build()
        summary = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertEqual(summary["value"], 8.8)
        self.assertEqual(summary["reviewCount"], 40)
        self.assertEqual(summary["independentSourceCount"], 1)
        self.assertEqual(len(output["exclusions.json"]), 1)

    def test_acquisition_invalid_receipt_pointer_fails(self):
        for pointer in ("/receipts/01", "/receipts/99", "/missing", "/~invalid", 1):
            with self.subTest(pointer=pointer):
                self.acquisition()
                path = str(release.ACQUISITION_LEDGER)
                ledger = json.loads((self.root / path).read_bytes())
                ledger["batches"][0]["approvals"][0]["observation"]["pointer"] = pointer
                self.write(path, ledger)
                self.assert_fails("receipt pointer")

    def acquisition_sample(self, observations):
        approval, receipt = self.acquisition()
        receipt["reviewSample"].update(visibleCount=len(observations), observations=observations)
        self.write(approval["observation"]["path"], {"receipts": [receipt]})
        self.write(approval["material"]["path"], receipt)
        approval["observation"] = self.reference(approval["observation"]["path"], "/receipts/0")
        approval["material"] = self.reference(approval["material"]["path"])
        self.write(str(release.ACQUISITION_LEDGER), {
            "schemaVersion": 1, "batches": [
                {"id": "complete-window", "assessmentDate": "2026-11-13", "approvals": [approval]}],
        })
        return approval, receipt

    def test_acquisition_contrary_majority_withholds_headline_without_changing_votes(self):
        observations = [
            {"id": f"visible-{i}", "date": "2026-10", "sentiment": sentiment}
            for i, sentiment in enumerate(["negative"] * 3 + ["mixed", "positive"])
        ]
        self.acquisition_sample(observations)
        output = self.build()
        record = output["locationResearch.json"]["cms-315488"]
        summary = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertIsNone(summary["value"])
        self.assertEqual(summary["reviewCount"], 70)
        self.assertTrue(any(s["conflicts"] for s in summary["sampleDiagnostics"]))
        self.assertEqual(record["reviewSamples"][0]["observations"], observations)
        self.assertEqual(record["reviews"], [])
        self.assertEqual(release.encoded(output), release.encoded(self.build()))

    def test_acquisition_sample_rejects_incomplete_duplicate_future_and_injected_rows(self):
        row = {"id": "row-one", "date": "2026-10", "sentiment": "mixed"}
        for observations, changes, message in (
            ([row], {"visibleCount": 2}, "complete visible review window"),
            ([row, row], {}, "duplicate acquisition sample"),
            ([{**row, "date": "2026-13"}], {}, "observation date"),
            ([{**row, "date": "2026-11-14"}], {}, "observation date"),
            ([{**row, "sentiment": "critical"}], {}, "sample sentiment"),
            ([{**row, "excerpt": "must not publish"}], {}, "Malformed acquisition sample"),
            ([row], {"sourceFamily": "google"}, "complete visible review window"),
        ):
            with self.subTest(message=message, changes=changes):
                approval, receipt = self.acquisition_sample(observations)
                receipt["reviewSample"].update(changes)
                self.write(approval["observation"]["path"], {"receipts": [receipt]})
                self.write(approval["material"]["path"], receipt)
                approval["observation"] = self.reference(approval["observation"]["path"], "/receipts/0")
                approval["material"] = self.reference(approval["material"]["path"])
                self.write(str(release.ACQUISITION_LEDGER), {
                    "schemaVersion": 1, "batches": [
                        {"id": "invalid-window", "assessmentDate": "2026-11-13", "approvals": [approval]}],
                })
                self.assert_fails(message)

    def test_acquisition_independent_window_disagreement_fails(self):
        approval, receipt = self.acquisition_sample([
            {"id": "visible-one", "date": None, "sentiment": "neutral"},
        ])
        receipt["reviewSample"]["observations"][0]["sentiment"] = "positive"
        self.write(approval["material"]["path"], receipt)
        approval["material"] = self.reference(approval["material"]["path"])
        self.write(str(release.ACQUISITION_LEDGER), {
            "schemaVersion": 1, "batches": [
                {"id": "window-disagreement", "assessmentDate": "2026-11-13", "approvals": [approval]}],
        })
        self.assert_fails("review window disagrees")

    def test_real_typescript_score_and_missing_zip_resolution(self):
        output = self.build()
        record = output["locationResearch.json"]["cms-315488"]
        summary = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertEqual(summary["value"], 8.8)
        self.assertEqual(summary["reviewCount"], 40)
        self.assertEqual(summary["confidence"], "limited")
        self.assertFalse(record["providerDetailsReviewed"])
        self.assertEqual(record["facts"], [])
        self.assertEqual(record["reviews"], [])
        self.assertIsNone(self.approval["identity"]["zip"])
        resolution = output["approvals-audit.json"]["approvals"][0]["identityResolution"]
        self.assertEqual(resolution, {
            "observedZip": None, "officialZip": "07960", "zipResolution": "exact-official-crosswalk",
        })

    def test_no_approval_never_publishes_collected_rating(self):
        output = self.build([])
        self.assertEqual(output["locationResearch.json"], {})
        self.assertTrue(any(row["status"] == "pending-unapproved" for row in output["staging.json"]))

    def test_unknown_provider_fails(self):
        self.approval["providerId"] = "cms-999999"
        self.assert_fails("Unknown runtime identity")

    def test_wrong_official_id_fails(self):
        self.approval["officialId"] = "NJWRONG"
        self.assert_fails("official identity")

    def test_crosswalk_to_wrong_provider_fails(self):
        self.crosswalk[0]["providerId"] = "cms-999999"
        self.write("research/north-jersey/runtime/crosswalk.json", self.crosswalk)
        self.assert_fails("official identity")

    def test_duplicate_official_identity_fails(self):
        self.write("research/north-jersey/runtime/crosswalk.json", self.crosswalk * 2)
        self.assert_fails("ambiguous official identity")

    def test_unknown_observation_pointer_fails(self):
        self.approval["observation"]["pointer"] = "/absent"
        self.assert_fails("Unknown retained observation")

    def test_source_hash_drift_fails(self):
        self.write(self.observation_path, "{}")
        self.assert_fails("Source hash drift")

    def test_material_hash_drift_fails(self):
        self.write(self.material_path, "changed")
        self.assert_fails("Source hash drift")

    def test_missing_material_fails(self):
        (self.root / self.material_path).unlink()
        self.assert_fails("Missing source material")

    def test_material_cannot_be_observation_json(self):
        self.approval["material"] = self.reference(self.observation_path)
        self.assert_fails("cannot be the observation registry")

    def test_material_must_contain_url_name_and_aggregate(self):
        for page in ("Example Home 4.4 40", self.url + "\nWrong Name 4.4 40",
                     self.url + "\nExample Home 4.4 99"):
            with self.subTest(page=page):
                self.write(self.material_path, page)
                self.approval["material"] = self.reference(self.material_path)
                self.assert_fails("page")

    def test_approval_requires_exact_fields(self):
        self.approval["automatic"] = True
        self.assert_fails("Malformed approval")

    def test_invalid_check_date_fails(self):
        for checked in ("2026-11-13", "2026-02-30", None):
            with self.subTest(checked=checked):
                self.approval["checkedAt"] = checked
                self.assert_fails("check date")

    def test_earlier_independent_check_cannot_approve_later_observation(self):
        self.approval["checkedAt"] = "2026-11-11"
        self.assert_fails("chronology")

    def test_approval_cannot_invent_observed_zip(self):
        self.approval["identity"]["zip"] = "07960"
        self.assert_fails("observed identity mismatch")

    def test_wrong_observed_zip_fails_even_if_approved(self):
        self.observation["identity"]["observed_zip"] = "07001"
        self.approval["identity"]["zip"] = "07001"
        self.update_observation()
        self.assert_fails("ZIP identity mismatch")

    def test_exact_observed_zip_is_retained(self):
        self.observation["identity"]["observed_zip"] = "07960"
        self.approval["identity"]["zip"] = "07960"
        self.update_observation()
        output = self.build()
        self.assertEqual(output["approvals-audit.json"]["approvals"][0]
                         ["identityResolution"]["zipResolution"], "observed")

    def test_wrong_street_city_state_and_care_unit_fail(self):
        for observed_key, approval_key, wrong in (
            ("observed_address", "address", "152 Madison Avenue"),
            ("observed_city", "city", "Summit"),
            ("observed_state", "state", "New York"),
            ("observed_care_unit", "careUnit", "Assisted Living"),
        ):
            original = copy.deepcopy(self.observation)
            approval = copy.deepcopy(self.approval)
            with self.subTest(field=observed_key):
                self.observation["identity"][observed_key] = wrong
                self.approval["identity"][approval_key] = wrong
                self.update_observation()
                self.assert_fails("identity mismatch|care unit mismatch")
            self.observation = original
            self.approval = approval

    def test_observed_name_is_not_a_fuzzy_match(self):
        self.observation["identity"]["observed_name"] = "Example Home Annex"
        self.approval["identity"]["name"] = "Example Home Annex"
        self.update_observation()
        self.assert_fails("Observed name")

    def test_missing_zip_requires_unambiguous_unit_not_just_brand(self):
        other = dict(self.providers[0], id="cms-315489", zip="07961",
                     address="151 MADISON AVENUE MORRISTOWN, NJ 07961")
        self.write("research/north-jersey/runtime/providers.json", self.providers + [other])
        self.write("research/north-jersey/runtime/crosswalk.json", self.crosswalk + [{
            **self.crosswalk[0], "officialId": "NJ60922", "providerId": "cms-315489",
        }])
        self.assert_fails("ambiguous official care-unit")

    def test_google_republication_cannot_claim_independent_family(self):
        self.observation["aggregate"]["source_family"] = "mylivingchoice"
        self.approval["aggregate"]["sourceFamily"] = "mylivingchoice"
        self.update_observation()
        self.assert_fails("must use google")

    def test_search_snippet_and_restricted_access_fail(self):
        self.observation["inspection"] = "search-result"
        self.update_observation()
        self.assert_fails("full-page")
        self.observation["inspection"] = "full-page"
        self.observation["access_decision"] = "restricted"
        self.update_observation()
        self.assert_fails("permitted source access")

    def test_rating_must_equal_retained_observation(self):
        self.approval["aggregate"]["rating"] = 5
        self.assert_fails("aggregate mismatch")

    def test_approved_employee_aggregate_is_excluded_not_pending(self):
        self.observation["aggregate"]["scope"] = "employee"
        self.approval["aggregate"]["scope"] = "employee"
        self.update_observation()
        output = self.build()
        self.assertEqual(output["locationResearch.json"], {})
        self.assertEqual(output["approvals-audit.json"]["approvals"][0]["disposition"], "excluded")
        self.assertIn("consumer", output["exclusions.json"][0]["reason"])

    def test_unknown_fractional_zero_counts_and_bad_scales_use_real_scorer_exclusions(self):
        for count, scale in ((None, 5), (0, 5), (1.5, 5), (12, 100)):
            with self.subTest(count=count, scale=scale):
                self.observation["aggregate"].update(review_count=count, scale=scale)
                self.approval["aggregate"].update(count=count, scale=scale)
                self.update_observation()
                self.write(self.material_path, f"{self.url}\nExample Home 4.4 out of {scale} from {count} reviews")
                self.approval["material"] = self.reference(self.material_path)
                output = self.build()
                self.assertEqual(output["locationResearch.json"], {})
                self.assertIn("whole-number", output["exclusions.json"][0]["reason"])

    def test_fewer_than_ten_reviews_is_released_but_unrated(self):
        self.observation["aggregate"]["review_count"] = 9
        self.approval["aggregate"]["count"] = 9
        self.update_observation()
        self.write(self.material_path, f"{self.url}\nExample Home 4.4 out of 5 from 9 Google reviews")
        self.approval["material"] = self.reference(self.material_path)
        output = self.build()
        summary = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertIsNone(summary["value"])
        self.assertEqual(summary["reviewCount"], 9)
        self.assertIn("cms-315488", output["locationResearch.json"])

    def test_twelve_reviews_from_one_family_stays_unrated(self):
        self.observation["aggregate"]["review_count"] = 12
        self.approval["aggregate"]["count"] = 12
        self.update_observation()
        self.write(self.material_path, f"{self.url}\nExample Home 4.4 out of 5 from 12 Google reviews")
        self.approval["material"] = self.reference(self.material_path)
        summary = self.build()["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertIsNone(summary["value"])
        self.assertEqual(summary["reviewCount"], 12)

    def test_duplicate_approvals_do_not_double_count(self):
        duplicate = copy.deepcopy(self.approval)
        duplicate["id"] = "second-independent-check"
        output = self.build([self.approval, duplicate])
        record = output["locationResearch.json"]["cms-315488"]
        summary = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertEqual(len(record["reviewAggregates"]), 1)
        self.assertEqual(summary["reviewCount"], 40)
        self.assertEqual(len(output["exclusions.json"]), 1)

    def test_duplicate_approval_id_fails(self):
        self.assert_fails("Duplicate approval ID", [self.approval, self.approval])

    def test_all_collection_artifacts_are_hashed_and_inventoried(self):
        for folder in ("reviews/remaining", "reviews/union-morris", "reviews/runs/run-one"):
            self.write(f"research/north-jersey/{folder}/observations.json", [{
                "kind": "discovery_search", "official_id": "UNKNOWN-PENDING",
                "result_urls": [{"url": "https://example.com/lead"}],
            }])
        self.write("research/north-jersey/reviews/home-care-direct-checks.json", {
            "locations": [{"official_id": "HP000", "aggregate": None,
                           "direct_pages": [{"url": "https://example.com/office", "eligible": False}]}],
        })
        output = self.build()
        paths = {row["path"] for row in output["manifest.json"]["collectionInventory"]}
        self.assertTrue(all(any(folder in p for p in paths) for folder in
                            ("remaining", "union-morris", "runs/run-one", "home-care-direct-checks")))
        self.assertTrue(any(row["officialId"] == "UNKNOWN-PENDING" for row in output["staging.json"]))

    def test_hashes_and_outputs_are_byte_deterministic(self):
        one, two = self.build(), self.build()
        self.assertEqual(release.encoded(one), release.encoded(two))
        for name, expected in one["manifest.json"]["outputs"].items():
            self.assertEqual(release.digest(release.encoded(one[name])), expected)

    def test_paths_cannot_escape_region(self):
        self.approval["material"]["path"] = "../secrets"
        self.assert_fails("repository-relative")

    def test_duplicate_json_fields_fail(self):
        self.write(self.observation_path, '{"url":"https://example.com","url":"https://wrong.com"}')
        self.approval["observation"] = self.reference(self.observation_path, "/direct_observation")
        self.assert_fails("Duplicate JSON key")

    def test_real_artifact_adapters_match_pilot_and_union_morris(self):
        inputs = release.Inputs(ROOT)
        observations, inventory = release.registry(inputs)
        verified = [o.normalized(inputs) for o in observations.values() if o.value.get("aggregate")]
        self.assertEqual(22, sum(o["observation"]["path"].endswith("review-release/source-observations.json") for o in verified))
        self.assertTrue(all(o["aggregate"]["sourceFamily"] == "google" for o in verified))
        pilot = next(o for o in verified if o["url"].endswith("/careone-at-madison-avenue"))
        self.assertEqual(pilot["aggregate"]["count"],185)
        self.assertIsNone(pilot["identity"]["zip"])
        self.assertEqual(len(inventory),1 + int((ROOT / release.ADDENDUM / "source-observations.json").is_file()))
        self.assertTrue(inventory[0]["path"].endswith("/source-observations.json"))

    def test_listing_addendum_incomplete_fails_closed(self):
        self.write(str(release.ADDENDUM / "approvals.json"),
                   {"schemaVersion":1,"assessmentDate":"2026-11-12","approvals":[]})
        self.assert_fails("Incomplete listing review addendum")

    def test_listing_addendum_uses_same_authority_and_deduplicates_sources(self):
        base = str(release.RELEASE / "source-observations.json")
        extra = str(release.ADDENDUM / "source-observations.json")
        self.write(base, {"observations":[self.observation]})
        self.write(extra, {"observations":[self.observation]})
        self.approval["observation"] = self.reference(base, "/observations/0")
        additional = {**self.approval, "id":"second-check", "observation":self.reference(extra,"/observations/0")}
        self.write(str(release.ADDENDUM / "approvals.json"), {
            "schemaVersion":1,"assessmentDate":"2026-11-12","approvals":[additional]})
        output = self.build()
        self.assertEqual(len(output["approvals-audit.json"]["approvals"]),2)
        score = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertEqual(score["reviewCount"],40)
        self.assertEqual(score["independentSourceCount"],1)

    def test_notes_cannot_resolve_unrelated_brand(self):
        self.approval["reconciliation"] = {"name":"Brand declared equivalent.", "address":None}
        self.observation["identity"]["observed_name"] = "Unrelated Senior Services"
        self.approval["identity"]["name"] = "Unrelated Senior Services"
        self.update_observation()
        self.assert_fails("Observed name")


    def cli(self, *args):
        script = self.root / "scripts/regions/release-reviews.py"
        script.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Path(__file__).with_name("release-reviews.py"), script)
        for folder in ("src", "node_modules"):
            target = self.root / folder
            if not target.exists():
                target.symlink_to(ROOT / folder, target_is_directory=True)
        return subprocess.run([sys.executable, str(script), *args], cwd=self.root,
                              capture_output=True, text=True, timeout=90)

    def test_cli_default_paths_check_mode_and_drift(self):
        self.build()
        result = self.cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.cli("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.write("research/north-jersey/review-release/locationResearch.json", {})
        result = self.cli("--check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale", result.stderr)

    def test_cli_missing_approval_fails_without_writing_outputs(self):
        result = self.cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing source material", result.stderr)
        self.assertFalse((self.root / release.RELEASE / "locationResearch.json").exists())

    def test_cli_rejects_output_outside_release(self):
        result = self.cli("--output-dir", str(self.root / "src/data"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("inside review-release", result.stderr)

    def test_cli_failed_approval_preserves_existing_release(self):
        self.build()
        self.assertEqual(self.cli().returncode, 0)
        output = self.root / release.RELEASE / "locationResearch.json"
        previous = output.read_bytes()
        self.write(self.material_path, "drift")
        result = self.cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(previous, output.read_bytes())


if __name__ == "__main__":
    unittest.main()
