#!/usr/bin/env python3
"""Checks for reviewed NJ qualitative findings, exclusions, and source privacy."""

from collections import Counter
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"),
                                                ROOT / "scripts/regions" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load("facebook-release")
normalizer = load("normalize-nj")
CEDAR = "north-jersey-campus-cedar-crest-village-07444"
LANTERN = "north-jersey-campus-lantern-hill-07974"


class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = json.loads((release.OUTPUT / "reviewed-coverage.json").read_bytes())
        cls.audit = json.loads((release.OUTPUT / "release-audit.json").read_bytes())

    def test_all_source_rows_have_one_safe_disposition(self):
        rows = self.audit["rows"]
        self.assertEqual(len(rows), 84)
        self.assertEqual(len({row["observationId"] for row in rows}), 84)
        self.assertEqual(Counter(row["disposition"] for row in rows),
                         {"excluded": 55, "withheld": 2, "published": 8, "quarantined": 7, "unassigned": 12})
        self.assertEqual(sum(bool(row["providerId"]) for row in rows), 65)
        self.assertEqual(Counter(row["batch"] for row in rows if row["providerId"]),
                         {"original": 47, "followup": 18})
        self.assertTrue(all(row["scoreEligible"] is False
                            and row["underlyingSourceVerified"] == (row["disposition"] == "published")
                            and row["firstPersonPostCareVerified"] == (row["disposition"] == "published")
                            for row in rows))
        self.assertTrue(all(not row["providerId"] for row in rows
                            if row["disposition"] in {"quarantined", "unassigned"}))
        self.assertEqual(self.audit["aggregateCandidates"]["count"], 4)
        self.assertEqual(self.audit["aggregateCandidates"]["distinctLocations"], 2)
        self.assertEqual(self.audit["aggregateCandidates"]["disposition"], "excluded")

    def test_cedar_candidates_are_grouped_not_independent_findings(self):
        rows = [row for row in self.audit["rows"] if row["providerId"] == CEDAR]
        self.assertEqual(len(rows), 16)
        self.assertEqual(Counter(row["disposition"] for row in rows), {"excluded": 9, "published": 7})
        self.assertEqual(sorted(Counter(row["threadGroup"] for row in rows).values()), [1, 1, 1, 1, 12])
        published = [row for row in rows if row["disposition"] == "published"]
        self.assertEqual(len({row["threadGroup"] for row in published}), 1)
        findings = self.dataset["locations"][CEDAR]["findings"]
        self.assertEqual(len(findings), 1)
        self.assertEqual(set(findings[0]["sourceObservationIds"]), {row["observationId"] for row in published})
        self.assertEqual(findings[0]["sourceObservationIds"],
                         [f"fb-njfu-b-{n:03}" for n in (3, 4, 5, 6, 10, 12, 13)])
        self.assertNotIn("fb-njfu-b-011", findings[0]["sourceObservationIds"])
        excluded = next(row for row in rows if row["observationId"] == "fb-njfu-b-011")
        self.assertEqual((excluded["disposition"], excluded["reason"]),
                         ("excluded", "firsthand_relationship_unverified"))
        self.assertEqual(findings[0]["date"], "2022-06-06")
        self.assertEqual(findings[0]["threadUrl"],
                         "https://facebook.com/groups/226332979096/permalink/10161753433779097/")
        self.assertIn("2022", findings[0]["summary"])
        self.assertIn("public-browser", self.dataset["locations"][CEDAR]["coverageExplanation"].lower())
        lantern = [row for row in self.audit["rows"] if row["providerId"] == LANTERN]
        self.assertEqual(len(lantern), 2)
        self.assertEqual(len({row["threadGroup"] for row in lantern}), 1)
        self.assertTrue(all(row["disposition"] == "excluded" and row["reason"] == "index_only"
                            for row in lantern))

    def test_victoria_group_thread_and_atria_personal_profile_have_distinct_dispositions(self):
        locations = self.dataset["locations"]
        victoria = locations["north-jersey-doh-nj60a004"]
        finding, = victoria["findings"]
        self.assertEqual((finding["sourceObservationIds"], finding["date"]), (["fb-njm-a-012"], "2026-10-06"))
        self.assertEqual(victoria["searchedAt"], "2026-11-12")
        self.assertEqual(finding["sourceUrl"], "https://www.facebook.com/groups/765406577175744/permalink/2904082416641472/")
        self.assertEqual(finding["sourceUrl"], finding["threadUrl"])
        self.assertIn("16 of the 22", " ".join(finding["limitations"]))
        atria = locations["north-jersey-doh-nj82472"]
        self.assertEqual((atria["status"], atria["findings"]), ("withheld", []))
        self.assertIn("personal-profile", atria["coverageExplanation"])
        self.assertCountEqual([row["observationId"] for row in self.audit["rows"]
                               if row["reason"] == "personal_profile_permalink_withheld"],
                              ["fb-nju-b-001", "fb-nju-b-002"])

    def test_twenty_exact_assignments_have_honest_coverage(self):
        locations = self.dataset["locations"]
        self.assertEqual(len(locations), 20)
        self.assertEqual(Counter(row["status"] for row in locations.values()),
                         {"withheld": 8, "findings-available": 2, "partial": 2, "no-relevant-result": 8})
        self.assertEqual(sum(row["foundCount"] for row in locations.values()), 65)
        self.assertEqual(sum(row["publishedObservationCount"] for row in locations.values()), 8)
        self.assertEqual(sum(row["withheldCount"] for row in locations.values()), 57)
        self.assertEqual({pid for pid, row in locations.items() if row["findings"]}, {CEDAR, "north-jersey-doh-nj60a004"})
        self.assertTrue(all(row["foundCount"] == row["withheldCount"] + row["publishedObservationCount"]
                            for row in locations.values()))
        self.assertEqual(locations["north-jersey-doh-nj60a002"]["status"], "partial")
        self.assertEqual(locations["cms-315329"]["status"], "no-relevant-result")
        self.assertEqual(locations["north-jersey-hp-hp0015347"]["status"], "partial")
        self.assertEqual(locations["cms-317020"]["status"], "no-relevant-result")
        self.assertNotIn("nj-u-08", locations)

    def test_classifier_does_not_trust_firsthand_or_public_labels(self):
        base = {"provider_id": "exact-assignment", "match_status": "exact", "relationship": "family",
                "account_type": "firsthand", "experience_stage": "previous_care", "source_visibility": "public"}
        self.assertEqual(release.disposition(base, CEDAR),
                         ("withheld", "underlying_first_person_source_unverified"))
        for change in ({"relationship": "other"}, {"relationship": "staff"}, {"account_type": "provider_promotion"},
                       {"experience_stage": "employment"}, {"account_type": "recommendation_without_detail"},
                       {"experience_stage": "touring"}, {"relationship": "unknown"}):
            with self.subTest(change=change):
                self.assertEqual(release.disposition({**base, **change}, CEDAR)[0], "excluded")
        self.assertEqual(release.disposition({**base, "provider_id": ""}, "")[0], "unassigned")
        self.assertEqual(release.disposition(base, "")[0], "quarantined")
        self.assertEqual(release.disposition({**base, "match_status": "probable"}, CEDAR)[0], "quarantined")
        self.assertEqual(release.disposition({**base, "observation_id": "fb-njfu-a-001"}, LANTERN),
                         ("excluded", "index_only"))

    def test_normalizer_rejects_unreviewed_or_mismatched_inputs(self):
        inputs = normalizer.Inputs(release.RESEARCH)
        providers = json.loads((release.RESEARCH / "runtime/providers.json").read_bytes())
        baseline = normalizer.reviewed_facebook(inputs, providers)
        self.assertEqual(baseline, self.dataset)
        for target in ("facebook/kit/kit.csv", "facebook/reconciliation/reviewed-coverage.json",
                       "facebook/reconciliation/release-audit.json", release.APPROVAL, release.RECEIPT):
            broken = normalizer.Inputs(release.RESEARCH)
            broken.bodies[target] = b"changed"
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "Facebook .*hash mismatch"):
                normalizer.reviewed_facebook(broken, providers)
        changed = deepcopy(providers)
        next(row for row in changed if row["id"] == CEDAR)["address"] = "Unreviewed address"
        with self.assertRaisesRegex(ValueError, "Facebook provider identity changed"):
            normalizer.reviewed_facebook(normalizer.Inputs(release.RESEARCH), changed)

    def test_resealed_findings_cannot_bypass_reviewed_selection(self):
        inputs = normalizer.Inputs(release.RESEARCH)
        name = "facebook/reconciliation/reviewed-coverage.json"
        dataset = deepcopy(self.dataset)
        dataset["locations"][CEDAR]["findings"] = [{"summary": "Unreviewed"}]
        body = release.encode(dataset)
        manifest = inputs.json("facebook/reconciliation/release-manifest.json")
        manifest["outputs"]["reviewed-coverage.json"] = release.sha(body)
        inputs.bodies[name] = body
        inputs.bodies["facebook/reconciliation/release-manifest.json"] = release.encode(manifest)
        providers = json.loads((release.RESEARCH / "runtime/providers.json").read_bytes())
        with self.assertRaisesRegex(ValueError, "differs from reviewed selection"):
            normalizer.reviewed_facebook(inputs, providers)

    def test_resealed_receipt_cannot_claim_invisible_or_authenticated_source_access(self):
        providers = json.loads((release.RESEARCH / "runtime/providers.json").read_bytes())
        name = "facebook/reconciliation/cedar-crest-public-source-check-2026-11-12.json"
        for field, value in (("renderedBrowser", "unavailable"), ("authenticationUsed", True),
                             ("privateGroupAccessUsed", True), ("commentPaginationExpanded", False),
                             ("retainedExcerptMatchedRenderedSource", False)):
            inputs = normalizer.Inputs(release.RESEARCH)
            receipt = inputs.json(name)
            receipt["checks"][field] = value
            body = release.encode(receipt)
            manifest = inputs.json("facebook/reconciliation/release-manifest.json")
            manifest["trustedInputs"][name] = release.sha(body)
            inputs.bodies[name] = body
            inputs.bodies["facebook/reconciliation/release-manifest.json"] = release.encode(manifest)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "pinned review hash mismatch"):
                normalizer.reviewed_facebook(inputs, providers)

    def test_reviewed_selection_still_requires_exact_firsthand_family_rows(self):
        selections, receipt = release.approved_inputs(lambda name: (release.RESEARCH / name).read_bytes())
        rows = deepcopy(self.audit["rows"])
        raw = {}
        coverage = {}
        for pid, selection in selections.items():
            aid = "nj-campus-cedar-crest-village" if pid == CEDAR else "nj-doh-NJ60A004"
            coverage[aid] = {"status": "evidence_found", "sources_checked": selection["coverageMarkers"]}
            for oid in selection["sourceObservationIds"]:
                raw[oid] = {"provider_id": aid, "match_status": "exact", "relationship": "family",
                            "account_type": "firsthand", "experience_stage": "previous_care",
                            "duplicate_of": "", "thread_url": selection["threadUrl"], "source_url": selection["threadUrl"],
                            "source_visibility": "public", "concern_type": "none",
                            "posted_at": selection["date"], "retrieved_at_utc": "2026-11-12T16:13:00Z"}
                next(row for row in rows if row["observationId"] == oid)["disposition"] = "withheld"
        notes = "complete (13/13)"
        self.assertEqual(set(release.reviewed_threads(
            selections, receipt, raw, deepcopy(rows), coverage, notes)), set(selections))
        for key, value in (("account_type", "provider_promotion"), ("relationship", "other"),
                           ("relationship", "staff"),
                           ("experience_stage", "employment"), ("experience_stage", "touring"),
                           ("source_visibility", "private"), ("posted_at", "2021-01-01"),
                           ("source_url", "https://facebook.com/example/posts/1"),
                           ("match_status", "probable"), ("duplicate_of", "another-row"),
                           ("thread_url", "https://example.test/unrelated")):
            changed = deepcopy(raw)
            changed["fb-njfu-b-003"][key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, "not_exact_firsthand"):
                release.reviewed_threads(selections, receipt, changed, deepcopy(rows), coverage, notes)
        with self.assertRaisesRegex(ValueError, "direct_comment_access_unverified"):
            release.reviewed_threads(selections, receipt, raw, deepcopy(rows), coverage, "")

    def test_resealed_approval_cannot_expand_publication(self):
        providers = json.loads((release.RESEARCH / "runtime/providers.json").read_bytes())
        for change in ("extra_row", "extra_provider", "summary", "identity"):
            inputs = normalizer.Inputs(release.RESEARCH)
            selections = inputs.json(release.APPROVAL)
            if change == "extra_row":
                selections[CEDAR]["sourceObservationIds"].append("fb-njfu-b-011")
            elif change == "extra_provider":
                selections["north-jersey-doh-nj60a004"] = deepcopy(selections[CEDAR])
            elif change == "summary":
                selections[CEDAR]["summary"] = "Unreviewed care-quality claim."
            else:
                selections["another-campus"] = selections.pop(CEDAR)
            body = release.encode(selections)
            manifest = inputs.json("facebook/reconciliation/release-manifest.json")
            manifest["trustedInputs"][release.APPROVAL] = release.sha(body)
            inputs.bodies[release.APPROVAL] = body
            inputs.bodies["facebook/reconciliation/release-manifest.json"] = release.encode(manifest)
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "pinned review hash mismatch"):
                    normalizer.reviewed_facebook(inputs, providers)
                with self.assertRaisesRegex(ValueError, "pinned review hash mismatch"):
                    release.approved_inputs(inputs.read)

    def test_resealed_non_cedar_finding_and_scoring_are_rejected(self):
        providers = json.loads((release.RESEARCH / "runtime/providers.json").read_bytes())
        for filename in ("reviewed-coverage.json", "release-audit.json"):
            inputs = normalizer.Inputs(release.RESEARCH)
            name = "facebook/reconciliation/" + filename
            value = inputs.json(name)
            if filename == "reviewed-coverage.json":
                value["locations"]["north-jersey-doh-nj60a004"]["findings"] = deepcopy(
                    self.dataset["locations"][CEDAR]["findings"])
            else:
                value["rows"][0]["scoreEligible"] = True
            body = release.encode(value)
            manifest = inputs.json("facebook/reconciliation/release-manifest.json")
            manifest["outputs"][filename] = release.sha(body)
            inputs.bodies[name] = body
            inputs.bodies["facebook/reconciliation/release-manifest.json"] = release.encode(manifest)
            with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, "differs from reviewed selection"):
                normalizer.reviewed_facebook(inputs, providers)

    def test_release_rebuild_is_redacted_and_deterministic(self):
        available = subprocess.run(["git", "-C", str(ROOT), "cat-file", "-e", release.CORRECTION],
                                   capture_output=True).returncode == 0
        if not available:
            self.skipTest("Private source Git objects are not retained in this checkout")
        files = release.build()
        self.assertEqual(files, release.build())
        for name, body in files.items():
            self.assertEqual(body, (release.OUTPUT / name).read_bytes())
        combined = b"".join(files.values())
        self.assertFalse(any(value in combined for value in
                             [b"supporting_public_excerpt", b"source_url",
                              b"candidate_provider_name", b"independence_notes"]))
        self.assertNotIn(b"facebook.com/", files["release-audit.json"])
        selected_threads = {finding["threadUrl"] for row in self.dataset["locations"].values()
                            for finding in row["findings"]}
        for commit, filename in [(release.ORIGINAL, "observations.csv"),
                                 (release.FOLLOWUP, release.FOLLOWUP_PATH + "observations.csv")]:
            body = release.batch.git_body(commit, filename)
            headers = next(iter(body.splitlines())).split(",")
            rows = release.batch.parse_csv(body, headers)
            self.assertTrue(all(row["source_url"].encode() not in combined for _, _, row in rows
                                if row["source_url"] and row["source_url"] not in selected_threads),
                            "Unselected private source URL leaked")
            self.assertTrue(all(row["supporting_public_excerpt"].encode() not in combined
                                for _, _, row in rows if row["supporting_public_excerpt"]),
                            "Private source excerpt leaked")


if __name__ == "__main__":
    unittest.main()
