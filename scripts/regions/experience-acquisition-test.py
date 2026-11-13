#!/usr/bin/env python3
import copy
import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "experience_acquisition", Path(__file__).with_name("experience-acquisition.py"),
)
ACQUISITION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACQUISITION)


def provider(pid="cms-315005", score=8.4, county="Union"):
    return {
        "providerId": pid, "marketId": "north-jersey", "name": "Exact care unit",
        "address": "1 Main St", "city": "Town", "state": "NJ", "zip": "07001",
        "category": "nursing-home", "locationKind": "facility", "county": county,
        "ccn": "315005" if pid == "cms-315005" else None,
        "officialIdentities": [{"officialId": "NJ12345", "license": "12345"}],
        "coverage": {"status": "scored" if score is not None else "no-rating-evidence",
                     "nextAction": "Find an exact care-unit aggregate."},
        "experience": {
            "value": score, "reason": "Real scorer diagnostic.",
            "includedSources": [], "excludedSources": [],
        },
        "reviewAggregates": [], "sources": [],
    }


def snapshot(providers=None):
    return {
        "scope": "all-active-registered-NJ-providers", "asOfDate": "2026-11-13",
        "inputHashes": {"src/lib/experience-score.ts": "fixed-policy"},
        "runtimeProviders": providers if providers is not None else [provider()],
    }


class ComparisonTests(unittest.TestCase):
    def test_preserves_every_existing_score(self):
        before = snapshot()
        report = ACQUISITION.compare(before, copy.deepcopy(before), [])
        self.assertTrue(report["passed"])
        self.assertEqual(report["unchangedExistingScores"], 1)

    def test_rejects_score_loss_reason_count_weight_or_source_change(self):
        before = snapshot()
        for field, value in (
            ("value", None), ("value", 9.1), ("reason", "New reason"),
            ("includedSources", [{"sourceId": "new", "sourceFamily": "google", "weight": 1, "count": 99}]),
            ("excludedSources", [{"sourceId": "x", "reason": "new exclusion"}]),
        ):
            with self.subTest(field=field, value=value):
                after = copy.deepcopy(before)
                after["runtimeProviders"][0]["experience"][field] = value
                self.assertFalse(ACQUISITION.compare(before, after, [])["passed"])
        after = copy.deepcopy(before)
        after["runtimeProviders"][0]["sources"] = [{"id": "new-source"}]
        self.assertFalse(ACQUISITION.compare(before, after, [])["passed"])

    def test_only_exact_before_after_review_can_authorize_change(self):
        before = snapshot()
        after = copy.deepcopy(before)
        after["runtimeProviders"][0]["experience"]["value"] = None
        decision = {
            "decision_id": "review-1", "provider_id": "cms-315005",
            "before_sha256": ACQUISITION.evidence_digest(before["runtimeProviders"][0]),
            "after_sha256": ACQUISITION.evidence_digest(after["runtimeProviders"][0]),
            "reviewer": "Named reviewer", "reviewed_at": "2026-11-13",
            "decision": "approve-score-change", "justification": "Exact care-unit correction.",
            "evidence": "retained-review-receipt.json",
        }
        self.assertTrue(ACQUISITION.compare(before, after, [decision])["passed"])
        for key in ("provider_id", "before_sha256", "after_sha256", "reviewer", "justification", "evidence"):
            bad = {**decision, key: ""}
            self.assertFalse(ACQUISITION.compare(before, after, [bad])["passed"])

    def test_rejects_population_identity_date_and_policy_drift(self):
        before = snapshot()
        variants = []
        after = copy.deepcopy(before)
        after["runtimeProviders"] = []
        variants.append(after)
        after = copy.deepcopy(before)
        after["runtimeProviders"][0]["county"] = "Bergen"
        variants.append(after)
        after = copy.deepcopy(before)
        after["asOfDate"] = "2026-11-14"
        variants.append(after)
        after = copy.deepcopy(before)
        after["inputHashes"]["src/lib/experience-score.ts"] = "looser-thresholds"
        variants.append(after)
        for after in variants:
            self.assertFalse(ACQUISITION.compare(before, after, [])["passed"])

    def test_new_scores_are_reported_without_masking_existing_scores(self):
        before = snapshot([provider(score=None), provider("north-jersey-hcsf-hp001", county="Bergen")])
        after = copy.deepcopy(before)
        after["runtimeProviders"][0]["experience"]["value"] = 8.2
        report = ACQUISITION.compare(before, after, [])
        self.assertTrue(report["passed"])
        self.assertEqual(report["unchangedExistingScores"], 1)
        self.assertEqual(report["changes"][0]["after"], 8.2)


class InventoryTests(unittest.TestCase):
    def inventory(self, value, providers=None):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "source-observations.json"
            path.write_text(json.dumps(value))
            return ACQUISITION.candidate_inventory(snapshot(providers), [path], root=root)

    def test_explicit_official_and_roster_identifiers_link_to_active_provider(self):
        value = {"observations": [
            {"providerId": "cms-315005", "url": "https://caring.com/senior-living/nj/town/exact"},
            {"official_id": "NJ12345", "url": "https://seniorly.com/exact"},
            {"rosterKey": "cms-ccn:315005", "url": "https://aplaceformom.com/community/exact-123"},
        ]}
        result = self.inventory(value)
        self.assertEqual(len(result["sourceCandidates"]), 3)
        self.assertTrue(all(c["providerIds"] == ["cms-315005"] for c in result["sourceCandidates"]))

    def test_dca_roster_and_keyed_provider_links_are_not_lost(self):
        item = provider("north-jersey-hcsf-hp0424700", score=None)
        item["officialIdentities"] = [{"officialId": "HP0424700", "license": "HP0424700"}]
        result = self.inventory({
            "observations": [{"rosterKey": "nj-dca-hcsf:HP0424700", "url": "https://example.org/office"}],
            item["providerId"]: {"reviewLinks": [{"url": "https://caring.com/office"}]},
        }, [item])
        self.assertEqual(len(result["sourceCandidates"]), 2)
        self.assertTrue(all(c["providerIds"] == [item["providerId"]] for c in result["sourceCandidates"]))

    def test_unknown_identity_is_not_guessed_from_name_or_url(self):
        result = self.inventory({"officialId": "not-active", "name": "Exact care unit",
                                 "url": "https://example.org/exact-care-unit"})
        self.assertEqual(result["sourceCandidates"][0]["providerIds"], [])
        self.assertEqual(len(result["unmatchedIdentifiers"]), 1)

    def test_candidates_receipts_and_review_decisions_remain_separate(self):
        result = self.inventory({
            "providerId": "cms-315005", "url": "https://mylivingchoice.com/property/exact",
            "checkedAt": "2026-11-12", "inspection": "full-page",
            "aggregate": {"value": 4.8, "scale": 5, "count": 150, "family": "google"},
            "identity": {"name": "Exact care unit", "zip": None},
            "receipt": {"path": "retained.json", "sha256": "evidence-hash"},
        })
        candidate = result["sourceCandidates"][0]
        self.assertEqual(candidate["sourceFamilies"], ["google"])
        self.assertEqual(candidate["observedIdentities"][0]["identity"]["zip"], None)
        self.assertEqual(len(result["retrievalReceipts"]), 1)
        self.assertEqual(result["reviewedPublicationDecisions"], [])
        self.assertEqual(candidate["runtimeProviderIds"], [])

    def test_deduplicates_urls_but_preserves_competing_provider_references(self):
        a = provider()
        b = provider("north-jersey-other-office", score=None, county="Essex")
        result = self.inventory([
            {"providerId": a["providerId"], "url": "https://www.example.org/office/?utm_source=x"},
            {"providerId": b["providerId"], "url": "http://example.org/office"},
        ], [a, b])
        self.assertEqual(len(result["sourceCandidates"]), 1)
        candidate = result["sourceCandidates"][0]
        self.assertEqual(len(candidate["references"]), 2)
        self.assertEqual(len(candidate["providerIds"]), 2)
        self.assertEqual(candidate["identityStatus"], "multiple-provider-references-review-care-unit")

    def test_skips_excluded_content_and_sitemaps_not_location_evidence(self):
        result = self.inventory({
            "providerId": "cms-315005", "url": "https://example.org/office",
            "description": {"url": "https://do-not-read.invalid/"},
            "facebookResearch": {"url": "https://do-not-read.invalid/"},
            "sitemapEvidence": [{"url": "https://mylivingchoice.com/sitemaps/properties-0.xml"}],
        })
        self.assertEqual(len(result["sourceCandidates"]), 1)
        self.assertIsNone(ACQUISITION.normalize_url("https://fb.com/location"))

    def test_retains_no_result_or_failed_search_receipts(self):
        result = self.inventory({
            "official_id": "NJ12345", "checked_at": "2026-11-12",
            "tool": "WebSearch", "result_urls": [], "error": "search unavailable",
        })
        self.assertEqual(result["sourceCandidates"], [])
        self.assertEqual(len(result["retrievalReceipts"]), 1)
        self.assertEqual(result["retrievalReceipts"][0]["error"], "search unavailable")
        self.assertEqual(result["retrievalReceipts"][0]["providerIds"], ["cms-315005"])

    def test_full_unscored_population_gets_queue_even_without_links(self):
        providers = [provider(score=None), provider("north-jersey-other-office", score=None, county="Essex")]
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            summary = ACQUISITION.inventory_write(snapshot(providers), directory, [])
            rows = json.loads((directory / "unscored-crosswalk.json").read_text())
            tasks = json.loads((directory / "discovery-queue.json").read_text())
            self.assertEqual(len(rows), 2)
            self.assertEqual(summary["unscoredWithoutKnownLinks"], 2)
            self.assertEqual({row["providerId"] for row in tasks}, {p["providerId"] for p in providers})
            self.assertTrue(all(row["action"] == "discover-exact-provider-source" for row in tasks))

    def test_csv_is_spreadsheet_safe_and_round_trips_multiline_fields(self):
        text = ACQUISITION.csv_text(
            [{"name": " =HYPERLINK(\"bad\")", "value": 'line 1\n"line 2", done'}],
            ["name", "value"],
        )
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertTrue(rows[0]["name"].startswith("'"))
        self.assertEqual(rows[0]["value"], 'line 1\n"line 2", done')

    def test_baseline_digest_detects_corruption_and_exclusive_write_rejects_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            path = directory / "baseline.json"
            ACQUISITION.dump(path, snapshot(), exclusive=True)
            ACQUISITION.dump(directory / "baseline-manifest.json", {"sha256": ACQUISITION.file_sha(path)})
            self.assertEqual(ACQUISITION.baseline_read(directory), snapshot())
            with self.assertRaises(FileExistsError):
                ACQUISITION.dump(path, {"different": True}, exclusive=True)
            path.write_text("{}")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                ACQUISITION.baseline_read(directory)

    def test_artifacts_cover_real_frozen_population_and_preserve_every_score(self):
        baseline = ACQUISITION.baseline_read(ACQUISITION.INVENTORY)
        current = json.loads((ACQUISITION.INVENTORY / "current.json").read_text())
        providers = baseline["runtimeProviders"]
        self.assertEqual(len(providers), 974)
        self.assertEqual(ACQUISITION.totals(providers)["scored"], 56)
        self.assertEqual(len({row["county"] for row in providers}), 6)
        crosswalk = json.loads((ACQUISITION.INVENTORY / "unscored-crosswalk.json").read_text())
        self.assertEqual(
            {row["providerId"] for row in crosswalk},
            {row["providerId"] for row in current["runtimeProviders"] if row["experience"]["value"] is None},
        )
        self.assertTrue(ACQUISITION.compare(baseline, current, [])["passed"])


if __name__ == "__main__":
    unittest.main()
