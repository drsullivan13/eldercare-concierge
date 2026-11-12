#!/usr/bin/env python3
"""Private reconciliation behavior tests. Assertions never display source rows."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("facebook_batch", ROOT / "scripts/regions/facebook-batch.py")
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


class BatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.trusted, cls.exact, cls.headers, cls.hashes, cls.provenance = batch.load_kit(batch.KIT)
        cls.bodies = {n: batch.git_body(batch.COMMIT, n) for n in [
            "assignments.csv", "supplied-first-facility-assignments.csv", "batch-manifest.json",
            "coverage.csv", "observations.csv", "aggregate-candidates.csv"]}
        cls.report = batch.reconcile(cls.trusted, cls.exact, cls.headers, cls.bodies)

    def audit(self, bodies):
        return batch.reconcile(self.trusted, self.exact, self.headers, bodies)

    def changed_csv(self, name, change):
        bodies = dict(self.bodies)
        columns = {"assignments.csv": batch.ASSIGNMENT_COLUMNS,
                   "aggregate-candidates.csv": batch.AGGREGATE_COLUMNS,
                   "supplied-first-facility-assignments.csv": batch.SUPPLIED_COLUMNS}.get(name, self.headers.get(name))
        rows = [r for _, _, r in batch.parse_csv(bodies[name], columns)]
        change(rows)
        bodies[name] = batch.csv_text(columns, [[r[k] for k in columns] for r in rows])
        return bodies

    def invalid(self, bodies, reason):
        with self.assertRaises(batch.Invalid) as caught:
            self.audit(bodies)
        self.assertEqual(str(caught.exception), reason)

    def test_real_artifact_counts_are_not_forced_to_seven(self):
        not_accepted = [a for a in self.trusted if a not in self.report["acceptedAssignmentIds"]]
        actionable = sum(self.trusted[a]["result"]["status"] == "exact" for a in not_accepted)
        self.assertEqual(self.report["summary"], {
            "trustedAssignments": 20, "trustedExact": len(self.exact), "batchAssignments": 17,
            "suppliedAssignmentRows": 12, "manifestProviderRows": 17,
            "coverageRows": 17, "observationRows": 65, "aggregateRows": 2,
            "acceptedAssignmentAndCoverageIds": 13, "followups": 7, "actionableFollowups": actionable,
            "blockedFollowups": 7 - actionable, "coverageCountDiscrepancies": 6, "unassignedObservationRows": 11})
        self.assertEqual(len(self.report["ledger"]), 130)
        self.assertEqual(len(self.report["identityMismatches"]), 4)
        self.assertEqual(set(self.report["acceptedAssignmentIds"]),
                         {a for a, r in self.trusted.items() if r["kind"] == "licensed_care_unit"} | {"nj-hha-317002"})

    def test_positive_exact_identity_and_coverage_join(self):
        rows = [r for r in self.report["ledger"] if r["assignmentId"] == "nj-doh-NJ61424"]
        self.assertTrue(all(r["providerId"] == "cms-315329" for r in rows))
        self.assertTrue(all(r["disposition"] == "identity_only" for r in rows))
        self.assertTrue(any(r["file"] == "coverage.csv" for r in rows))

    def test_every_source_row_has_physical_line_reference(self):
        for name, body in self.bodies.items():
            rows = [r for r in self.report["ledger"] if r["file"] == name]
            self.assertTrue(bool(rows))
            self.assertEqual([r["row"] for r in rows], list(range(1, len(rows) + 1)))
            self.assertTrue(all(1 <= r["firstLine"] <= r["lastLine"] <= len(body.splitlines()) for r in rows))
        parsed = batch.parse_csv('a,b\n"x\ny",z\n', ["a", "b"])
        self.assertEqual([(first, last) for first, last, _ in parsed], [(2, 3)])

    def test_unknown_ids_never_map_by_name_or_address(self):
        rows = [r for r in self.report["ledger"] if r["assignmentId"] in {
            "nj-u-08", "nj-u-09", "nj-u-10", "nj-m-10"}]
        self.assertTrue(all(not r["providerId"] for r in rows))
        self.assertTrue(all("unknown_assignment_id" in r["reasons"] for r in rows))
        self.assertEqual(batch.identity("unknown", next(iter(self.exact)), self.trusted, self.exact),
                         ("", ["unknown_assignment_id"]))

    def test_campus_and_office_context_is_not_a_mapping(self):
        issues = {r["sourceAssignmentId"]: r for r in self.report["identityMismatches"]}
        self.assertEqual(issues["nj-u-08"]["reason"], "campus_unit_confusion")
        self.assertTrue("537" in issues["nj-u-08"]["organizationIdentityMetadata"]["address_as_published"])
        self.assertTrue("535" in issues["nj-u-08"]["trustedScopeContextNotMapping"][0]["address"])
        self.assertTrue("6 Commerce" in issues["nj-u-09"]["organizationIdentityMetadata"]["address_as_published"])
        self.assertTrue("55 Madison" in issues["nj-m-10"]["organizationIdentityMetadata"]["address_as_published"])

    def test_followups_are_exact_set_difference_with_blocked_separate(self):
        expected = set(self.trusted) - set(self.report["acceptedAssignmentIds"])
        followups = self.report["followups"]
        self.assertEqual({r["assignmentId"] for r in followups}, expected)
        actionable = [r for r in followups if r["status"] == "actionable"]
        blocked = [r for r in followups if r["status"] == "blocked"]
        self.assertEqual({r["assignmentId"] for r in actionable},
                         {a for a in expected if self.trusted[a]["result"]["status"] == "exact"})
        self.assertEqual({r["assignmentId"] for r in blocked},
                         {a for a in expected if self.trusted[a]["result"]["status"] == "unresolved"})
        self.assertTrue(all(r["providerId"] in self.exact for r in actionable))
        self.assertTrue(all(not r["providerId"] for r in blocked))
        prompt = batch.followup_prompt(followups)
        self.assertTrue(all(r["providerId"] in prompt for r in actionable))
        self.assertTrue(all(r["assignmentId"] in prompt for r in blocked))
        for r in blocked:
            line = next(l for l in prompt.splitlines() if r["assignmentId"] in l)
            self.assertNotIn("->", line)
        self.assertIn("internal_review_pending", prompt)

    def test_content_and_aggregate_never_accepted_for_publication(self):
        self.assertTrue(all(r["disposition"] in {"private_review_only", "quarantine"}
                            for r in self.report["ledger"] if r["file"] == "observations.csv"))
        self.assertTrue(all(r["disposition"] == "excluded"
                            for r in self.report["ledger"] if r["file"] == "aggregate-candidates.csv"))
        self.assertTrue(all(r["disposition"] == "quarantine"
                            for r in self.report["ledger"] if "unassigned_observation" in r["reasons"]))

    def test_provider_id_disagreement_does_not_fall_back(self):
        aid = "nj-doh-NJ60A002"
        self.assertEqual(batch.identity(aid, "cms-315329", self.trusted, self.exact),
                         ("", ["provider_id_disagreement"]))
        unresolved = next((a for a, r in self.trusted.items() if r["result"]["status"] == "unresolved"), None)
        if unresolved:
            claimed = self.trusted[unresolved]["result"].get("candidateProviderId", "")
            self.assertEqual(batch.identity(unresolved, claimed, self.trusted, self.exact),
                             ("", ["trusted_identity_unresolved"]))

    def test_assignment_metadata_mismatch_quarantines_all_linked_rows(self):
        bodies = self.changed_csv("assignments.csv", lambda rows: rows[0].update(zip="00000"))
        manifest = json.loads(bodies["batch-manifest.json"])
        manifest["providers"][0]["zip"] = "00000"
        bodies["batch-manifest.json"] = batch.encode(manifest)
        supplied = [r for _, _, r in batch.parse_csv(bodies["supplied-first-facility-assignments.csv"], batch.SUPPLIED_COLUMNS)]
        supplied[0]["zip"] = "00000"
        bodies["supplied-first-facility-assignments.csv"] = batch.csv_text(
            batch.SUPPLIED_COLUMNS, [[r[k] for k in batch.SUPPLIED_COLUMNS] for r in supplied])
        report = self.audit(bodies)
        self.assertNotIn("nj-doh-NJ90A120", report["acceptedAssignmentIds"])
        self.assertTrue(all(not r["providerId"] for r in report["ledger"] if r["assignmentId"] == "nj-doh-NJ90A120"))

    def test_invalid_csv_headers_widths_and_duplicate_json_keys(self):
        bodies = dict(self.bodies)
        bodies["coverage.csv"] = "wrong,header\n"
        self.invalid(bodies, "csv_header_invalid")
        bodies["coverage.csv"] = self.bodies["coverage.csv"] + "invalid\n"
        self.invalid(bodies, "csv_width_invalid")
        with self.assertRaises(batch.Invalid):
            batch.unique_json('{"a":1,"a":2}')

    def test_manifest_count_and_id_disagreement_fail_closed(self):
        bodies = dict(self.bodies)
        value = json.loads(bodies["batch-manifest.json"])
        value["providers"].pop()
        bodies["batch-manifest.json"] = batch.encode(value)
        self.invalid(bodies, "batch_manifest_count_disagreement")
        value = json.loads(self.bodies["batch-manifest.json"])
        value["providers"][0]["provider_id"] = "cms-315329"
        bodies["batch-manifest.json"] = batch.encode(value)
        self.invalid(bodies, "batch_manifest_provider_id_disagreement")

    def test_missing_duplicate_and_orphan_coverage_fail_closed(self):
        self.invalid(self.changed_csv("coverage.csv", lambda rows: rows.pop()), "coverage_count_disagreement")
        self.invalid(self.changed_csv("coverage.csv", lambda rows: rows[0].update(provider_id=rows[1]["provider_id"])),
                     "coverage_link_invalid")
        self.invalid(self.changed_csv("coverage.csv", lambda rows: rows[0].update(provider_id="not-assigned")),
                     "coverage_link_invalid")

    def test_invalid_coverage_status_array_and_count_fail_closed(self):
        for update, reason in [
            ({"status": "invalid"}, "coverage_status_invalid"),
            ({"queries_used": "{}"}, "coverage_array_invalid"),
            ({"observations_found": "-1"}, "coverage_observation_count_invalid")]:
            self.invalid(self.changed_csv("coverage.csv", lambda rows: rows[0].update(update)), reason)

    def test_orphan_observation_duplicate_and_publication_attempt_fail_closed(self):
        for update, reason in [
            ({"provider_id": "not-assigned"}, "observation_coverage_link_invalid"),
            ({"duplicate_of": "not-present"}, "observation_duplicate_link_invalid"),
            ({"use_status": "published"}, "observation_private_review_contract_invalid")]:
            self.invalid(self.changed_csv("observations.csv", lambda rows: rows[0].update(update)), reason)

    def test_aggregate_and_supplied_assignment_links_fail_closed(self):
        self.invalid(self.changed_csv("aggregate-candidates.csv", lambda rows: rows[0].update(assignment_id="unknown")),
                     "aggregate_assignment_link_invalid")
        self.invalid(self.changed_csv("supplied-first-facility-assignments.csv", lambda rows: rows[0].update(zip="00000")),
                     "supplied_assignment_disagreement")
        self.invalid(self.changed_csv("aggregate-candidates.csv", lambda rows: rows[0].update(review_count="-1")),
                     "aggregate_count_invalid")
        self.invalid(self.changed_csv("aggregate-candidates.csv", lambda rows: rows[0].update(rating_scale="NaN")),
                     "aggregate_numeric_shape_invalid")

    def test_redaction_does_not_copy_any_observation_text(self):
        bodies = self.changed_csv("observations.csv", lambda rows: [
            row.update(summary="PRIVATE_SENTINEL", source_url="PRIVATE_SENTINEL",
                       supporting_public_excerpt="PRIVATE_SENTINEL", candidate_provider_name="PRIVATE_SENTINEL")
            for row in rows])
        self.assertNotIn("PRIVATE_SENTINEL", batch.encode(self.audit(bodies)))
        permitted = set(batch.LEDGER_COLUMNS)
        self.assertTrue(all(set(row) == permitted for row in self.report["ledger"]))

    def test_cli_regeneration_check_stale_and_safe_errors(self):
        positive = {**self.report, "summary": {**self.report["summary"], "coverageCountDiscrepancies": 0}}
        files = {"audit.json": batch.encode(positive), "test-redacted.txt": "redacted\n"}
        with tempfile.TemporaryDirectory(dir=batch.OUTPUT, prefix="test-") as directory:
            output = Path(directory)
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(batch, "build", return_value=files), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(batch.main(["--output", str(output)]), 0)
                before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in output.iterdir()}
                self.assertEqual(batch.main(["--output", str(output)]), 0)
                self.assertEqual(batch.main(["--output", str(output), "--check"]), 0)
                self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in output.iterdir()})
                (output / "test-redacted.txt").write_text("stale")
                self.assertEqual(batch.main(["--output", str(output), "--check"]), 1)
                self.assertEqual((output / "test-redacted.txt").read_text(), "stale")
            with patch.object(batch, "build", side_effect=ValueError("PRIVATE_SENTINEL")), \
                    contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(batch.main(["--output", str(output)]), 1)
            self.assertNotIn("PRIVATE_SENTINEL", stdout.getvalue() + stderr.getvalue())

    def test_cli_emits_audit_but_blocks_unverifiable_source_counts(self):
        with tempfile.TemporaryDirectory(dir=batch.OUTPUT, prefix="test-") as directory:
            output = Path(directory)
            with patch.object(batch, "build", return_value={"audit.json": batch.encode(self.report)}), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(batch.main(["--output", str(output)]), 2)
                self.assertEqual(batch.main(["--output", str(output), "--check"]), 2)
            self.assertTrue((output / "audit.json").is_file())

    def test_cli_structural_error_writes_nothing(self):
        with tempfile.TemporaryDirectory(dir=batch.OUTPUT, prefix="test-") as directory:
            output = Path(directory)
            with patch.object(batch, "build", side_effect=batch.Invalid("csv_width_invalid")), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(batch.main(["--output", str(output)]), 1)
            self.assertEqual(list(output.iterdir()), [])

    def test_aggregate_claimed_provider_disagreement_is_excluded(self):
        bodies = self.changed_csv("aggregate-candidates.csv", lambda rows: rows[1].update(harbor_id="cms-315329"))
        rows = [r for r in self.audit(bodies)["ledger"] if r["file"] == "aggregate-candidates.csv" and r["row"] == 2]
        self.assertTrue(all(not r["providerId"] and "provider_id_disagreement" in r["reasons"] for r in rows))

    def test_trusted_artifact_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for name in self.hashes:
                (path / name).write_bytes((batch.KIT / name).read_bytes())
            assigned = json.loads((path / "assigned.json").read_text())
            assigned["providerIds"][0] = "forged"
            (path / "assigned.json").write_text(batch.encode(assigned))
            with self.assertRaises(batch.Invalid) as caught:
                batch.load_kit(path)
            self.assertEqual(str(caught.exception), "trusted_allowlist_invalid")

    def test_unresolved_cms_records_are_blocked_not_researched(self):
        cms_ids = [a for a, r in self.trusted.items() if r["kind"] == "cms_home_health_office"]
        self.assertEqual(len(cms_ids), 2)
        trusted = json.loads(json.dumps(self.trusted))
        for aid in cms_ids:
            trusted[aid]["result"] = {"status": "unresolved", "reason": "cms_agency_not_in_runtime_catalog",
                                      "candidateProviderId": "cms-" + trusted[aid]["officialId"]}
        exact = {r["result"]["providerId"]: r for r in trusted.values() if r["result"]["status"] == "exact"}
        report = batch.reconcile(trusted, exact, self.headers, self.bodies)
        blocked = [r for r in report["followups"] if r["status"] == "blocked"]
        self.assertEqual({r["assignmentId"] for r in blocked}, set(cms_ids))
        self.assertTrue(all(not r["providerId"] for r in blocked))
        self.assertEqual(report["summary"]["actionableFollowups"], 6)
        self.assertEqual(report["summary"]["blockedFollowups"], 2)
        prompt = batch.followup_prompt(report["followups"])
        actionable_section = prompt.split("## Actionable exact kit assignments")[1].split("## Blocked")[0]
        self.assertTrue(all(("cms-" + trusted[aid]["officialId"]) not in actionable_section for aid in cms_ids))

    def test_eighteen_id_kit_baseline_remains_supported(self):
        cms_ids = {"nj-hha-317020", "nj-hha-317002"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for name in self.hashes:
                (path / name).write_bytes((batch.KIT / name).read_bytes())
            manifest = json.loads((path / "assignment-manifest.json").read_text())
            for a in manifest["assignments"]:
                if a["assignmentId"] in cms_ids:
                    a["result"] = {"status": "unresolved", "reason": "cms_agency_not_in_runtime_catalog",
                                   "candidateProviderId": "cms-" + a["officialId"]}
            manifest["summary"] = {"assignments": 20, "exact": 18, "unresolved": 2,
                                   "unresolvedReasons": {"cms_agency_not_in_runtime_catalog": 2}}
            (path / "assignment-manifest.json").write_text(batch.encode(manifest))
            header = batch.KIT_COLUMNS
            rows = [r for _, _, r in batch.parse_csv((path / "kit.csv").read_text(), header)
                    if r["assignment_id"] not in cms_ids]
            (path / "kit.csv").write_text(batch.csv_text(header, [[r[k] for k in header] for r in rows]))
            (path / "assigned.json").write_text(batch.encode({
                "providerIds": sorted(r["provider_id"] for r in rows),
                "geography": {"state": "NJ", "zips": sorted({r["zip"] for r in rows})}}))
            trusted, exact, _, _, provenance = batch.load_kit(path)
            self.assertEqual(len(exact), 18)
            self.assertEqual(len(trusted), 20)
            self.assertEqual(provenance["sourceKitSummary"]["exact"], 18)


if __name__ == "__main__":
    unittest.main()
