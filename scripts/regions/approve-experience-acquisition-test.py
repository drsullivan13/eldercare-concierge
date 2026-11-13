#!/usr/bin/env python3
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "approve_acquisition", Path(__file__).with_name("approve-experience-acquisition.py"))
APPROVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APPROVE)


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.copy(APPROVE.INDEX)
        self.index = self.load(APPROVE.INDEX)
        self.copy(self.index["baselineAliases"]["path"])
        for reference in self.index["batches"]:
            self.copy(reference["path"])
            batch = self.load(reference["path"])
            for key in ("proposals", "reviewed", "access", "aliases"):
                if key in batch:
                    self.copy(batch[key]["path"])
            for key in ("sources", "checks", "identities"):
                for evidence in batch.get(key, {}).values():
                    self.copy(evidence["path"])
        self.second_ref = self.index["batches"][1]
        self.second = self.load(self.second_ref["path"])

    def copy(self, relative):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(APPROVE.ROOT / relative, target)

    def load(self, relative):
        return json.loads((self.root / relative).read_bytes())

    def write(self, relative, value):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(APPROVE.release.encoded(value))

    def reference(self, relative):
        return {"path": str(relative), "sha256": APPROVE.release.digest((self.root / relative).read_bytes())}

    def mutate(self, reference, change):
        value = self.load(reference["path"])
        change(value)
        self.write(reference["path"], value)
        reference.update(self.reference(reference["path"]))
        self.write(self.second_ref["path"], self.second)
        self.second_ref.update(self.reference(self.second_ref["path"]))
        self.write(APPROVE.INDEX, self.index)

    def approvals(self, outputs):
        return json.loads(outputs[APPROVE.release.ACQUISITION_LEDGER])["batches"]

    def test_public_inputs_reproduce_checks_without_private_captures(self):
        outputs = APPROVE.build(self.root)
        self.assertEqual(outputs, APPROVE.build(self.root))
        for path, data in outputs.items():
            self.assertEqual(data, (APPROVE.ROOT / path).read_bytes(), str(path))
        batches = self.approvals(outputs)
        self.assertEqual([len(b["approvals"]) for b in batches], [11, 21])
        self.assertEqual(sum(a["aggregate"]["count"] for a in batches[0]["approvals"]), 1359)
        checks = [json.loads(data) for path, data in outputs.items()
                  if path.parent.name == "independent-checks"]
        self.assertEqual(sum(c["reviewSample"]["visibleCount"] for c in checks), 150)
        for check in checks:
            self.assertIsNone(check["identity"]["zip"])
            self.assertIsNone(check["aggregate"]["asOf"])
            self.assertEqual(check["aggregate"]["sourceFamily"], "google")
            self.assertNotIn("reviews", check)

    def test_all_first_wave_approval_meaning_is_preserved(self):
        batch = self.load(self.index["batches"][0]["path"])
        original = self.load(batch["proposals"]["path"])["batches"][0]
        current = self.approvals(APPROVE.build(self.root))[0]
        self.assertEqual(original["id"], current["id"])
        for before, after in zip(original["approvals"], current["approvals"], strict=True):
            for key in before.keys() - {"observation", "material"}:
                self.assertEqual(before[key], after[key], key)

    def test_rebound_historical_receipt_must_match_released_hash(self):
        reference = self.index["batches"][0]
        batch = self.load(reference["path"])
        source_reference = next(iter(batch["sources"].values()))
        source = self.load(source_reference["path"])
        source["receipts"][0]["access_decision"] = "restricted"
        self.write(source_reference["path"], source)
        for item in batch["sources"].values():
            item.update(self.reference(item["path"]))
        self.write(reference["path"], batch)
        reference.update(self.reference(reference["path"]))
        self.write(APPROVE.INDEX, self.index)
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "original release hashes"):
            APPROVE.build(self.root)

    def test_collector_replacement_has_no_effect(self):
        expected = APPROVE.build(self.root)
        mutable = APPROVE.BASE / "mylivingchoice"
        self.write(mutable / "proposed-approvals.json", {"approvals": []})
        self.write(mutable / "access-evidence.json", [])
        self.write(mutable / "source-checks/acclaim-rehabilitation-and-nursing-center.json", {})
        self.assertEqual(expected, APPROVE.build(self.root))

    def test_new_batch_is_additive_and_order_independent(self):
        full = APPROVE.build(self.root)
        self.write(APPROVE.INDEX, {**self.index, "batches": self.index["batches"][:1]})
        first = APPROVE.build(self.root)
        self.assertEqual(self.approvals(first)[0], self.approvals(full)[0])
        for path, data in first.items():
            if path not in (APPROVE.ALIASES, APPROVE.release.ACQUISITION_LEDGER):
                self.assertEqual(data, full[path])
        self.write(APPROVE.INDEX, {**self.index, "batches": list(reversed(self.index["batches"]))})
        self.assertEqual(full, APPROVE.build(self.root))

    def test_changed_frozen_bytes_fail_without_reapproval(self):
        self.write(self.second["reviewed"]["path"], {})
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Source hash drift"):
            APPROVE.build(self.root)

    def test_edited_mean_cannot_become_a_publication(self):
        self.mutate(self.second["reviewed"], lambda d: d["approvals"][0].__setitem__(6, 5.0))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "reading disagrees"):
            APPROVE.build(self.root)

    def test_omitted_critical_row_cannot_become_a_publication(self):
        self.mutate(self.second["reviewed"], lambda d: d["approvals"][0][8].pop(0))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "reading disagrees"):
            APPROVE.build(self.root)

    def test_duplicate_approval_fails(self):
        self.mutate(self.second["reviewed"], lambda d: d["approvals"].append(d["approvals"][0]))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Duplicate"):
            APPROVE.build(self.root)

    def test_all_proposals_require_a_decision(self):
        self.mutate(self.second["reviewed"], lambda d: d["withheld"].pop())
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "unreviewed"):
            APPROVE.build(self.root)

    def test_source_hold_is_not_overridden_by_approval(self):
        reference = self.second["sources"]["acclaim-rehabilitation-and-nursing-center"]
        self.mutate(reference, lambda d: d.__setitem__("scopeHold", "unresolved population"))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "unresolved source hold"):
            APPROVE.build(self.root)

    def test_restricted_access_cannot_become_a_permitted_label(self):
        self.mutate(self.second["access"],
                    lambda rows: [r.__setitem__("decision", "restricted") for r in rows])
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "not permitted"):
            APPROVE.build(self.root)

    def test_missing_identity_witness_fails(self):
        reference = self.second["identities"]["acclaim-rehabilitation-and-nursing-center"]
        (self.root / reference["path"]).unlink()
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Missing source material"):
            APPROVE.build(self.root)

    def test_unrelated_identity_witness_cannot_authorize_alias(self):
        reference = self.second["identities"]["acclaim-rehabilitation-and-nursing-center"]
        self.mutate(reference, lambda d: d.__setitem__("sourceUrl", "https://example.com/unrelated"))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "care-unit alias"):
            APPROVE.build(self.root)

    def test_overlapping_immutable_batches_fail(self):
        duplicate = copy.deepcopy(self.second)
        duplicate["id"] = "third-wave"
        path = APPROVE.ARCHIVE / "batches/third-wave/batch.json"
        self.write(path, duplicate)
        self.index["batches"].append(self.reference(path))
        self.write(APPROVE.INDEX, self.index)
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "across immutable batches"):
            APPROVE.build(self.root)

    def test_public_minimal_inputs_replay_canonical_release(self):
        outputs = APPROVE.build(self.root)
        for path, data in outputs.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        manifest_path = APPROVE.release.RELEASE / "manifest.json"
        manifest = json.loads((APPROVE.ROOT / manifest_path).read_bytes())
        for item in manifest["inputs"]:
            path = Path(item["path"])
            if not (self.root / path).exists():
                self.copy(path)
        self.copy(APPROVE.release.REGION / "runtime/providers.json")
        self.assertFalse((self.root / APPROVE.BASE / "mylivingchoice").exists())
        actual = APPROVE.release.build(self.root)
        for name, document in actual.items():
            expected = (APPROVE.ROOT / APPROVE.release.RELEASE / name).read_bytes()
            self.assertEqual(APPROVE.release.encoded(document), expected, name)
        after = actual["experience-verification.json"]["releasedOutput"]
        before_batch = self.load(self.index["batches"][0]["path"])
        before = self.load(before_batch["proposals"]["path"])["batches"][0]["approvals"]
        self.assertTrue(all(after[a["providerId"]]["value"] is not None for a in before))
        decisions = self.load(self.second["reviewed"]["path"])
        for row in decisions["approvals"]:
            self.assertIsNotNone(after[row[1]]["value"])
        for row in decisions["withheld"]:
            self.assertNotIn(row["providerId"], after)

    def test_actual_runtime_gains_21_and_preserves_all_67_existing_scores(self):
        baseline = json.loads((APPROVE.ROOT / APPROVE.ARCHIVE / "score-baseline.json").read_bytes())
        result = subprocess.run([
            str(APPROVE.ROOT / "node_modules/.bin/tsx"),
            str(APPROVE.ROOT / "tests/nj-experience-acquisition.test.ts"),
            "--snapshot", baseline["assessmentDate"],
        ], cwd=APPROVE.ROOT, capture_output=True, text=True, check=True, timeout=60)
        current = {p["providerId"]: p for p in json.loads(result.stdout)["runtimeProviders"]}
        self.assertEqual(set(current), set(baseline["activeProviderIds"]))
        self.assertEqual(len(current), 974)
        self.assertEqual(len(baseline["scoredProviders"]), 67)
        for provider in baseline["scoredProviders"]:
            self.assertEqual(provider["experience"], current[provider["providerId"]]["experience"],
                             provider["providerId"])
        before_scored = {p["providerId"] for p in baseline["scoredProviders"]}
        new_scored = {pid for pid, p in current.items()
                      if p["experience"]["value"] is not None and pid not in before_scored}
        decisions = self.load(self.second["reviewed"]["path"])
        self.assertEqual(new_scored, {row[1] for row in decisions["approvals"]})
        self.assertEqual(len(new_scored), 21)
        for row in decisions["withheld"]:
            self.assertIsNone(current[row["providerId"]]["experience"]["value"])


if __name__ == "__main__":
    unittest.main()
