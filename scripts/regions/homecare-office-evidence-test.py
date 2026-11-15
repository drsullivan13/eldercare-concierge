#!/usr/bin/env python3
"""Offline acceptance and input-mutation tests. Fixtures stay in memory."""

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "homecare_evidence", Path(__file__).with_name("homecare-office-evidence.py"))
E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E)


class MemoryInputs(E.Inputs):
    def __init__(self, files):
        super().__init__(E.ROOT)
        self.files = files

    def read(self, relative):
        name = Path(relative).as_posix()
        if name not in self.files:
            raise FileNotFoundError(name)
        body = self.files[name]
        digest = hashlib.sha256(body).hexdigest()
        E.require(self.hashes.get(name, digest) == digest, f"Input changed: {name}")
        self.hashes[name] = digest
        return body

    def verify(self):
        for name, digest in self.hashes.items():
            E.require(hashlib.sha256(self.files[name]).hexdigest() == digest, f"Input changed: {name}")


class OfficeEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prior_outputs = E.build(include_new=False)
        validation = json.loads(cls.prior_outputs["validation.json"])
        cls.retained = {name: (E.ROOT / name).read_bytes() for name in validation["inputSha256"]}
        cls.rows, _, _ = E.registry(MemoryInputs(dict(cls.retained)))

    def setUp(self):
        self.files = dict(self.retained)

    def load(self, path):
        return json.loads(self.files[str(path)])

    def store(self, path, value):
        self.files[str(path)] = E.encode(value)

    def build(self):
        memory = MemoryInputs(self.files)
        exists = Path.is_file
        new_path = E.ROOT / E.BASE / "new-branches.json"
        with patch.object(E, "Inputs", return_value=memory), patch.object(
                Path, "is_file", lambda p: str(E.BASE / "new-branches.json") in self.files
                if p == new_path else exists(p)):
            return {name: json.loads(body) for name, body in E.build().items()}

    def synthetic(self, hp="HP0289000", branch_phone="7322715100"):
        row = self.rows[hp]
        website = "https://www.homeinstead.com/home-care/usa/nj/somerset-county/596/"
        office = "Home Instead Somerset"
        if hp in {"HP0374000", "HP0166900"}:
            website = "https://www.visitingangels.com/somersetnj/contact-us"
            office = "Visiting Angels Hillsborough"
        receipt = {
            "url": website, "effective_url": website, "checked_at": "2026-11-15",
            "status": 200, "title": office,
            "excerpts": [
                {"line": 1, "text": "# " + office},
                {"line": 10, "text": row["Business Address"]},
                {"line": 11, "text": row["Business City"] + ", NJ " + row["Business Zipcode"]},
                {"line": 12, "text": "Phone: " + branch_phone},
                {"line": 30, "text": "We provide companion care and personal care to older adults in their homes."},
                {"line": 40, "text": "We offer home care throughout Somerset and Middlesex Counties, including Edison."},
            ],
        }
        ref = f"receipts/test-{hp.lower()}.json"
        record = {
            "registrationID": hp, "county": "Somerset", "officeName": office,
            "observedAddress": f"{row['Business Address'].strip()}, {row['Business City']}, NJ {row['Business Zipcode'][:5]}",
            "facts": {
                "website": {"value": website, "receipt": ref, "lines": [1, 10, 11]},
                "services": {"value": ["Companion care", "Personal care"], "receipt": ref, "lines": [30]},
                "serviceArea": {"value": "Somerset County; Middlesex County; Edison", "receipt": ref, "lines": [40]},
                "phone": {"value": branch_phone, "receipt": ref, "lines": [12]},
            },
        }
        self.store(E.BASE / ref, receipt)
        self.store(E.BASE / "new-branches.json", {"records": [record], "attempts": []})
        return record, receipt, E.BASE / ref

    def replace_new(self, record):
        self.store(E.BASE / "new-branches.json", {"records": [record], "attempts": []})

    def test_reconciles_all_prior_records_without_new_file(self):
        result = self.build()
        self.assertEqual(result["validation.json"]["registryRows"], 3628)
        self.assertEqual(result["validation.json"]["priorRecordsReconciled"], 39)
        self.assertEqual(len(result["reconciliation.json"]["records"]), 39)
        self.assertEqual(result["validation.json"]["newBranches"], "absent_treated_as_empty")
        self.assertEqual(result["validation.json"]["newRecords"], 0)

    def test_prior_build_is_byte_reproducible_and_does_not_write_inputs(self):
        before = dict(self.files)
        self.assertEqual(E.build(include_new=False), self.prior_outputs)
        self.assertEqual(self.files, before)

    def test_every_published_field_has_hashed_retained_lines(self):
        result = self.build()
        audits = {r["providerID"]: r for r in result["reconciliation.json"]["records"]}
        for pid, provider in result["release.json"]["byProviderID"].items():
            self.assertRegex(pid, r"^north-jersey-hp-hp\d{7}$")
            self.assertLessEqual(set(provider), {"website", "serviceArea", "services", "phone", "sources"})
            self.assertEqual(audits[pid]["currentRegistry"]["status"], "Active")
            for field, value in provider.items():
                if field == "sources" or not value:
                    continue
                self.assertIn(field, audits[pid]["publishedFields"])
                for evidence in audits[pid]["publishedFields"][field]:
                    body = self.files[evidence["receipt"]]
                    self.assertEqual(hashlib.sha256(body).hexdigest(), evidence["sha256"])
                    retained = {e["line"] for e in json.loads(body)["excerpts"]}
                    self.assertTrue(set(evidence["lines"]) <= retained)
                    self.assertTrue(evidence["lines"])
            for source in provider["sources"]:
                self.assertEqual(set(source), {"title", "publisher", "url", "kind", "checkedAt", "supports"})
                self.assertEqual(source["kind"], "provider")
                self.assertTrue(source["supports"])

    def test_no_brand_locator_or_generic_service_page_becomes_website(self):
        patches = self.build()["release.json"]["byProviderID"]
        for provider in patches.values():
            if "website" in provider:
                self.assertTrue(E.local_url(provider["website"]))
        for hp in ("HP0285900", "HP0342800", "HP0257500"):
            self.assertNotIn("website", patches.get("north-jersey-hp-" + hp.lower(), {}))

    def test_registry_anomalies_are_explicit_not_silently_dropped(self):
        registry = self.build()["reconciliation.json"]["registry"]
        self.assertEqual(registry["rows"], 3628)
        reasons = {r["reason"] for r in registry["exceptions"]}
        self.assertIn("malformed_registration_not_matchable", reasons)
        self.assertIn("identical_duplicate_rows", reasons)
        life = next(r for r in registry["exceptions"] if r.get("registrationID") == "HP0365500")
        self.assertEqual({r["License Status"] for r in life["sourceRows"]}, {"Expired", "Active"})
        self.assertEqual(life["reason"], "unique_active_variant_selected_inactive_variants_retained")

    def test_named_phone_conflicts_prefer_branch_and_retain_registry(self):
        for hp, branch, registry in (
                ("HP0289000", "7322715100", "9736321908"),
                ("HP0374000", "9082627374", "9734773398")):
            with self.subTest(hp=hp):
                self.synthetic(hp, branch)
                result = self.build()
                pid = "north-jersey-hp-" + hp.lower()
                self.assertEqual(result["release.json"]["byProviderID"][pid]["phone"], branch)
                audit = next(r for r in result["reconciliation.json"]["records"] if r["registrationID"] == hp)
                self.assertEqual(E.phone_key(audit["phoneConflict"]["registryPhone"]), registry)
                self.assertEqual(audit["phoneConflict"]["publishedBranchPhone"], branch)
                self.assertTrue(audit["phoneConflict"]["warning"])
                self.assertEqual(audit["currentRegistry"]["phone"], self.rows[hp]["Business Phone"])

    def test_inactive_predecessor_stays_separate_and_unpublished(self):
        self.synthetic("HP0166900", "9082627374")
        result = self.build()
        self.assertNotIn("north-jersey-hp-hp0166900", result["release.json"]["byProviderID"])
        self.assertNotIn("north-jersey-hp-hp0374000", result["release.json"]["byProviderID"])
        audit = result["reconciliation.json"]["records"][-1]
        self.assertIn("registration_not_active", audit["gaps"])
        predecessor = result["reconciliation.json"]["separateRegistrations"][0]
        self.assertEqual(predecessor["notRematchedTo"], "HP0374000")

    def test_prior_changed_legal_identity_is_not_rematched(self):
        records = self.load(E.PRIOR / "records.json")
        records[0]["registered_name"] = "Unrelated Corporation"
        self.store(E.PRIOR / "records.json", records)
        result = self.build()
        self.assertNotIn(records[0]["provider_id"], result["release.json"]["byProviderID"])
        self.assertIn("current_registry_registered_name_changed", result["reconciliation.json"]["records"][0]["gaps"])

    def test_new_office_identity_and_address_mutations_are_withheld(self):
        for field, value in (
                ("officeName", "An Unrelated Agency"),
                ("observedAddress", "221 Davidson Avenue, Suite 98, Somerset, NJ 08873"),
                ("observedAddress", "220 Davidson Avenue, Suite 99, Somerset, NJ 08873"),
                ("observedAddress", "220 Davidson Avenue, Suite 98, Edison, NJ 08873"),
                ("observedAddress", "220 Davidson Avenue, Suite 98, Somerset, NJ 08874")):
            with self.subTest(field=field, value=value):
                record, _, _ = self.synthetic()
                record[field] = value
                self.replace_new(record)
                self.assertNotIn("north-jersey-hp-hp0289000", self.build()["release.json"]["byProviderID"])

    def test_receipt_wrong_house_number_or_suite_cannot_prove_identity(self):
        for address in ("1220 DAVIDSON AVENUE, SUITE 98", "220 DAVIDSON AVENUE, SUITE 99"):
            with self.subTest(address=address):
                _, receipt, path = self.synthetic()
                receipt["excerpts"][1]["text"] = address
                self.store(path, receipt)
                self.assertNotIn("north-jersey-hp-hp0289000", self.build()["release.json"]["byProviderID"])

    def test_missing_receipt_fails_closed(self):
        _, _, path = self.synthetic()
        del self.files[str(path)]
        with self.assertRaises(FileNotFoundError):
            self.build()

    def test_missing_or_failed_receipt_status_fails_closed(self):
        for status in (None, 404, "200", True):
            with self.subTest(status=status):
                _, receipt, path = self.synthetic()
                receipt["status"] = status
                self.store(path, receipt)
                with self.assertRaisesRegex(ValueError, "successful HTTP status"):
                    self.build()

    def test_missing_evidence_lines_fail_closed(self):
        record, _, _ = self.synthetic()
        record["facts"]["services"]["lines"] = [9999]
        self.replace_new(record)
        with self.assertRaisesRegex(ValueError, "Missing evidence lines"):
            self.build()

    def test_duplicate_excerpt_lines_fail_closed(self):
        _, receipt, path = self.synthetic()
        receipt["excerpts"].append(deepcopy(receipt["excerpts"][0]))
        self.store(path, receipt)
        with self.assertRaisesRegex(ValueError, "duplicate excerpt"):
            self.build()

    def test_prior_source_receipt_metadata_must_match(self):
        records = self.load(E.PRIOR / "records.json")
        records[0]["sources"][0]["checked_at"] = "2026-11-14"
        self.store(E.PRIOR / "records.json", records)
        with self.assertRaisesRegex(ValueError, "metadata mismatch"):
            self.build()

    def test_navigation_form_and_review_text_do_not_support_services(self):
        for text in (
                "- [Companion care](https://example.com/services/companion-care)",
                "Please select your services from these form options: companion care and personal care.",
                "My mother received companion care and personal care. Thank you for your help.",
                "We do not provide companion care or personal care."):
            with self.subTest(text=text):
                _, receipt, path = self.synthetic()
                receipt["excerpts"][4]["text"] = text
                self.store(path, receipt)
                provider = self.build()["release.json"]["byProviderID"]["north-jersey-hp-hp0289000"]
                self.assertEqual(provider["services"], [])

    def test_private_pay_clinical_staffing_and_invented_service_claims_are_not_published(self):
        for value in ("Private-pay accepted", "Skilled nursing", "Medical staffing",
                      "Companion care and dragon rides", "Care capacity available"):
            with self.subTest(value=value):
                record, _, _ = self.synthetic()
                record["facts"]["services"]["value"] = [value]
                self.replace_new(record)
                provider = self.build()["release.json"]["byProviderID"]["north-jersey-hp-hp0289000"]
                self.assertEqual(provider["services"], [])

    def test_phone_not_in_excerpt_is_not_published(self):
        record, _, _ = self.synthetic()
        record["facts"]["phone"]["value"] = "2125559999"
        self.replace_new(record)
        provider = self.build()["release.json"]["byProviderID"]["north-jersey-hp-hp0289000"]
        self.assertNotIn("phone", provider)

    def test_different_branch_receipt_cannot_supply_services(self):
        record, receipt, _ = self.synthetic()
        receipt["url"] = receipt["effective_url"] = "https://www.homeinstead.com/home-care/usa/nj/teaneck/735/"
        self.store(E.BASE / "receipts/wrong-branch.json", receipt)
        record["facts"]["services"]["receipt"] = "receipts/wrong-branch.json"
        self.replace_new(record)
        with self.assertRaisesRegex(ValueError, "branch differs"):
            self.build()

    def test_duplicate_registration_cannot_overwrite_prior_record(self):
        record, _, _ = self.synthetic()
        record["registrationID"] = "HP0065000"
        self.replace_new(record)
        with self.assertRaisesRegex(ValueError, "Duplicate registration"):
            self.build()

    def test_registry_hash_and_row_count_are_checked(self):
        path = str(E.WORKBOOK) + ".json"
        for field, value in (("sha256", "0" * 64), ("displayed_rows", 3627), ("exported_rows", 3627)):
            with self.subTest(field=field):
                metadata = json.loads(self.retained[path])
                metadata[field] = value
                self.store(path, metadata)
                with self.assertRaises(ValueError):
                    self.build()

    def test_current_release_cli_check(self):
        result = subprocess.run(
            [sys.executable, str(E.ROOT / "scripts/regions/homecare-office-evidence.py"), "--check"],
            cwd=E.ROOT, text=True, capture_output=True,
            env={**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1"}, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
