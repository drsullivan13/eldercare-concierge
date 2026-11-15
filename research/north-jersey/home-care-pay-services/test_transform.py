import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import transform


BASE = Path(__file__).resolve().parent
SOURCE = BASE / "sources/hh-agencies-2025.txt"
PAGE_COUNTS = {2: 5, 3: 5, 4: 6, 5: 5, 6: 4, 7: 6, 8: 6,
               9: 6, 10: 6, 11: 5, 12: 6, 13: 5, 14: 5, 15: 2}


def provider(provider_id="office-1", **changes):
    row = {
        "provider_id": provider_id,
        "official_registration_id": "HP123",
        "registered_name": "TEST COMPANIONS LLC",
        "dba": "Test Companions",
        "runtime_name": "Test Companions",
        "registered_address": "30 Tinc Road",
        "address": "30 Tinc Road",
        "city": "Flanders",
        "license_status": "Active",
        "license_expires": "2027-09-30",
        "source": {"url": "https://registry.example/", "row": 42, "sha256": "registry-hash"},
        "registration_source_rows": [42],
    }
    row.update(changes)
    return row


def raw_registry(row, phone="(862) 772-7047"):
    return {
        "official_registration_id": row["official_registration_id"],
        "license_status": "Active",
        "address": row["registered_address"],
        "city": row["city"],
        "source": {"url": "https://registry.example/", "row": 42},
        "source_fields": {"Business Phone": phone},
    }


def review(entry_id="morris-2025-001", provider_id="office-1", decision="accepted"):
    return {
        "entry_id": entry_id, "provider_id": provider_id, "decision": decision,
        "limitations": ["Historical county listing."],
        "identity_basis": ["Reviewer confirmed the exact office address."],
    }


class SourceCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")
        cls.entries = transform.parse_entries(cls.text)

    def test_all_72_offices_and_physical_pages(self):
        self.assertEqual(len(self.entries), 72)
        self.assertEqual(dict(transform.Counter(row["page"] for row in self.entries)), PAGE_COUNTS)
        self.assertEqual(
            [row["entry_id"] for row in self.entries],
            [f"morris-2025-{number:03d}" for number in range(1, 73)],
        )
        self.assertEqual(self.entries[0]["name"], "Always Best Care Senior Services")
        self.assertEqual(self.entries[-1]["name"], "Visiting Nurse Association of Somerset Hills")

    def test_source_blocks_are_exact_page_substrings_and_cover_every_address(self):
        pages = self.text.split("\f")
        for entry in self.entries:
            with self.subTest(entry=entry["entry_id"]):
                self.assertIn(entry["source_text"], pages[entry["page"] - 1])
                self.assertNotIn("Updated 2025", entry["source_text"])
                self.assertTrue(entry["phone_numbers"])
                for field in ("services_text", "accepts_text"):
                    if entry[field] is not None:
                        self.assertIn(entry[field], entry["source_text"])
        addresses = [
            line.strip() for page in pages for line in page.split("\n")
            if transform.ADDRESS.match(line)
        ]
        self.assertEqual(len(addresses), 72)
        for address in addresses:
            self.assertEqual(sum(address in row["source_text"] for row in self.entries), 1, address)

    def test_address_only_bayada_office_is_separate(self):
        rows = [row for row in self.entries if row["name"] == "Bayada Assistive Care-State Programs"]
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["page"] for row in rows], [3, 3])
        self.assertIn("383 W. Blackwell", rows[0]["address_text"])
        self.assertIn("32 Maple Avenue", rows[1]["address_text"])
        self.assertIn("9738673000", rows[1]["phone_numbers"])
        self.assertNotIn("Bayada", rows[1]["source_text"])
        self.assertIn("Homemaker; Live-in; Companion", rows[1]["services_text"])
        self.assertNotEqual(rows[0]["entry_id"], rows[1]["entry_id"])

    def test_home_helpers_without_services_or_accepts_is_retained(self):
        row = next(row for row in self.entries if row["name"] == "Home Helpers Cared-4")
        self.assertEqual(row["page"], 8)
        self.assertEqual(row["address_text"], "830 Morris Turnpike, 4th Floor, Ste. 408\nShort Hills, NJ 07078")
        self.assertEqual(row["phone_numbers"], ["7325015793"])
        self.assertIsNone(row["services_text"])
        self.assertIsNone(row["accepts_text"])
        self.assertIn("59053@homehelpershomecare.com", row["source_text"])

    def test_inline_labels_inline_phone_and_multiline_name(self):
        by_name = {row["name"]: row for row in self.entries}
        self.assertEqual(by_name["Home Care/Assistance"]["services_text"],
                         "Certified Nurses Aide; Certified Home Health Aide")
        self.assertIn("Homemaker", by_name["ComForCare Home Care"]["services_text"])
        self.assertEqual(by_name["Delight Care Home Health Agency"]["phone_numbers"], ["7323390050"])
        self.assertIn(
            "Visiting Nurse Association of Northern New Jersey (Affiliated Health Services, Inc.)",
            by_name,
        )
        self.assertEqual(by_name["My Girls Home Care"]["address_text"],
                         "34B Speedwell Ave., Morristown, NJ 07960")
        self.assertIn("Jessica Purzycki", by_name["My Girls Home Care"]["source_text"])

    def test_blank_physical_pages_do_not_shift_entries(self):
        block = self.entries[0]["source_text"]
        row = transform.parse_entries("Cover\f\f" + block + "\fBack cover")[0]
        self.assertEqual(row["page"], 3)
        self.assertEqual(row["source_text"], block)


class OutputTests(unittest.TestCase):
    def setUp(self):
        self.text = SOURCE.read_text(encoding="utf-8")
        self.provider = provider()
        self.raw = raw_registry(self.provider)

    def outputs(self, reviews=None, inventory=None, raw=None):
        return transform.transform(
            self.text,
            inventory if inventory is not None else [self.provider],
            raw if raw is not None else [self.raw],
            reviews or [],
            source_pdf_sha256="f" * 64,
        )

    def test_candidates_include_raw_phone_and_never_auto_promote(self):
        outputs = self.outputs()
        first = outputs["candidate-matches.json"][0]["candidates"][0]
        self.assertEqual(first["provider_id"], "office-1")
        self.assertEqual(first["official_registration_id"], "HP123")
        self.assertEqual(first["registered_name"], self.provider["registered_name"])
        self.assertEqual(first["dba"], self.provider["dba"])
        self.assertEqual(first["phones"], ["8627727047"])
        self.assertEqual(
            {signal["kind"] for signal in first["match_signals"]},
            {"phone", "house_number_city"},
        )
        self.assertEqual(first["registry_source"], self.provider["source"])
        self.assertEqual(outputs["observations.json"], [])
        coverage = outputs["coverage.json"]
        self.assertEqual(coverage["county_entry_count"], 72)
        self.assertEqual(coverage["accepted_entry_count"], 0)
        self.assertEqual(coverage["unresolved_entry_count"], 72)

    def test_each_matching_route_and_inactive_exclusion(self):
        phone_only = provider("phone", registered_address="1 Other Street", city="Union")
        name_only = provider("name", registered_name="Always Best Care Senior Services LLC",
                             registered_address="2 Other Street", city="Union",
                             official_registration_id="HP456")
        address_only = provider("address", official_registration_id="HP789")
        inactive = provider("inactive", license_status="Expired")
        outputs = self.outputs(
            inventory=[phone_only, name_only, address_only, inactive],
            raw=[raw_registry(phone_only), raw_registry(inactive, "(999) 999-9999")],
        )
        candidates = outputs["candidate-matches.json"][0]["candidates"]
        actual = {
            row["provider_id"]: {signal["kind"] for signal in row["match_signals"]}
            for row in candidates
        }
        self.assertEqual(actual, {
            "phone": {"phone"}, "name": {"strong_name"}, "address": {"house_number_city"},
        })

    def test_registry_phone_cannot_leak_between_offices_or_inactive_rows(self):
        other = dict(self.raw, address="99 Elsewhere", city="Union")
        inactive = dict(self.raw, license_status="Expired")
        row = provider(registered_address="1 Other Street", city="Dover")
        outputs = self.outputs(inventory=[row], raw=[other, inactive])
        self.assertFalse(outputs["candidate-matches.json"][0]["candidates"])

    def test_generic_names_and_shared_house_numbers_do_not_match(self):
        row = provider(registered_name="Home Care Services", dba="", runtime_name="",
                       registered_address="30 Some Road", city="Union")
        self.assertFalse(self.outputs(inventory=[row], raw=[])["candidate-matches.json"][0]["candidates"])
        self.assertFalse(transform.strong_name("Home Care", "Other Home Care"))
        self.assertFalse(transform.strong_name("Home Care", "Home Care"))
        self.assertTrue(transform.strong_name("Companion Willow", "Companion Willow LLC"))

    def test_city_matching_handles_registry_spacing_and_suite_before_city(self):
        cases = [
            ("Home Helpers Cared-4", "830 Morris Turnpike", "SHORTHILLS"),
            ("Comfort Keepers", "181 New Road", "PARSIPPANY"),
            ("Hilda’s Helping Hands", "45 S. Park Place", "MORRISTOWN"),
        ]
        entries = transform.parse_entries(self.text)
        for name, address, city in cases:
            with self.subTest(name=name):
                entry = next(row for row in entries if row["name"] == name)
                row = provider(registered_name="Unrelated Firm", dba="", runtime_name="",
                               registered_address=address, city=city)
                registry = transform.build_registry([row], [])
                candidates = transform.candidate_matches([entry], registry)[0]["candidates"]
                self.assertEqual(len(candidates), 1)
                self.assertEqual(candidates[0]["match_signals"][0]["kind"], "house_number_city")

    def test_only_accepted_reviews_emit_exact_office_facts(self):
        reviews = [
            review(),
            review("morris-2025-002", None, "rejected"),
            review("morris-2025-003", None, "unresolved"),
        ]
        outputs = self.outputs(reviews)
        self.assertEqual(len(outputs["observations.json"]), 1)
        fact = outputs["observations.json"][0]
        self.assertEqual(fact["scope"], "exact_office")
        self.assertEqual(fact["registry_record"], self.provider)
        self.assertEqual(fact["registry_rows"], [self.raw])
        self.assertEqual(fact["limitations"], reviews[0]["limitations"])
        self.assertEqual(fact["identity_basis"], reviews[0]["identity_basis"])
        self.assertEqual(fact["county_source"]["page_url"], transform.SOURCE_URL + "#page=2")
        self.assertEqual(fact["county_source"]["checked_at"], "2026-11-14")
        self.assertEqual(fact["county_source"]["year"], 2025)
        self.assertEqual(len(fact["county_source"]["text_sha256"]), 64)
        self.assertEqual(fact["county_source"]["pdf_sha256"], "f" * 64)
        self.assertNotIn("registration_status_caveat", fact)
        self.assertIn("Private pay", fact["private_pay_text"])
        self.assertEqual(fact["nonmedical_services"], [])
        self.assertEqual(fact["served_territories"], [])
        coverage = outputs["coverage.json"]
        self.assertEqual(coverage["reviewed_entry_count"], 3)
        self.assertEqual(coverage["accepted_entry_count"] + coverage["unresolved_entry_count"], 72)
        self.assertEqual(len(coverage["unresolved_cases"]), 71)

    def test_missing_facts_stay_missing_after_acceptance(self):
        entry = next(row for row in transform.parse_entries(self.text) if row["name"] == "Home Helpers Cared-4")
        fact = self.outputs([review(entry["entry_id"])])["observations.json"][0]
        self.assertIsNone(fact["private_pay_text"])
        self.assertEqual(fact["nonmedical_services"], [])
        self.assertIsNone(fact["county_office"]["services_text"])

    def test_nonmedical_preserves_source_words_not_aide_nurse_or_therapy_claims(self):
        text = (
            "Registered Nurse; Certified Home Health Aide; Certified Nurses Aide; "
            "Homemaker; Companion; Live-in; Physical Therapy; "
            "Assistance in hygiene, Meal preparation, light\nHousekeeping, Errands and Shopping; "
            "Certified Home Health Aides Live-in; Private Duty / Shift Nursing"
        )
        result = transform.nonmedical_services(text)
        self.assertEqual(result, [
            "Homemaker", "Companion", "Assistance in hygiene", "Meal preparation",
            "light\nHousekeeping", "Errands and Shopping",
        ])
        self.assertTrue(all(value in text for value in result))
        self.assertEqual(transform.nonmedical_services(
            "Home Health Aide; Live-in; Registered Nurse; Occupational Therapy"
        ), [])
        self.assertEqual(transform.nonmedical_services("Nursing and Companion care"), [])
        self.assertEqual(transform.nonmedical_services("P.T. Companion care"), [])

    def test_invalid_reviews_fail_closed(self):
        bad_rows = [
            review("unknown"), review(provider_id="unknown"), review(decision="maybe"),
            review(provider_id=None), review(provider_id="office-1", decision="rejected"),
            review(provider_id="office-1", decision="unresolved"),
            {key: value for key, value in review().items() if key != "provider_id"},
            dict(review(), identity_basis=[]), dict(review(), limitations="none"),
            dict(review(), identity_basis=[12]),
        ]
        for row in bad_rows:
            with self.subTest(row=row), self.assertRaises(ValueError):
                self.outputs([row])
        with self.assertRaises(ValueError):
            self.outputs([review(), review()])

    def test_elapsed_active_registration_is_historical_caveat(self):
        expired = provider(license_expires="2025-06-30")
        raw = raw_registry(expired)
        fact = self.outputs([review()], inventory=[expired], raw=[raw])["observations.json"][0]
        self.assertEqual(fact["decision"], "accepted")
        self.assertEqual(fact["registration_status_caveat"], {
            "portal_status": "Active",
            "license_expires": "2025-06-30",
            "checked_at": "2026-11-14",
            "observation_scope": "historical",
            "current_eligibility_asserted": False,
            "reason": (
                "The portal reports Active, but the listed license expiration date "
                "elapsed before this check."
            ),
        })


class CliTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, "-B", str(BASE / "transform.py"), *map(str, args)],
            cwd=BASE.parent,
            text=True, capture_output=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            timeout=30,
        )

    def test_real_inputs_without_reviews_are_deterministic(self):
        with tempfile.TemporaryDirectory(dir=BASE, prefix=".transform-test-") as directory:
            root = Path(directory)
            args = ("--output-dir", root, "--reviewed-matches", root / "absent.json")
            first = self.run_cli(*args)
            self.assertEqual(first.returncode, 0, first.stderr)
            before = {path.name: path.read_bytes() for path in root.iterdir()}
            self.assertEqual(set(before), {
                "county-entries.json", "candidate-matches.json", "observations.json", "coverage.json",
            })
            second = self.run_cli(*args)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(before, {path.name: path.read_bytes() for path in root.iterdir()})
            coverage = json.loads(before["coverage.json"])
            self.assertEqual(coverage["county_entry_count"], 72)
            self.assertGreater(coverage["candidate_pair_count"], 0)
            self.assertEqual(json.loads(before["observations.json"]), [])
            candidates = json.loads(before["candidate-matches.json"])
            entries = json.loads(before["county-entries.json"])
            for address, expected_provider in (
                ("383 W. Blackwell", "north-jersey-hp-hp0015325"),
                ("32 Maple Avenue", "north-jersey-hp-hp0015347"),
            ):
                entry = next(row for row in entries if address in row["address_text"])
                matches = next(row["candidates"] for row in candidates if row["entry_id"] == entry["entry_id"])
                match = next(row for row in matches if row["provider_id"] == expected_provider)
                self.assertTrue(match["phones"])
                self.assertIn("phone", {signal["kind"] for signal in match["match_signals"]})

    def test_reviewed_cli_and_rejected_review_do_not_leave_stale_observations(self):
        with tempfile.TemporaryDirectory(dir=BASE, prefix=".transform-test-") as directory:
            root = Path(directory)
            (root / "inventory.json").write_text(json.dumps([provider()]))
            state = root / "state/morris"
            state.mkdir(parents=True)
            (state / "home-care-firms.json").write_text(json.dumps([raw_registry(provider())]))
            reviewed = root / "reviewed.json"
            reviewed.write_text(json.dumps([review()]))
            args = ("--output-dir", root / "out", "--inventory", root / "inventory.json",
                    "--state-dir", root / "state", "--reviewed-matches", reviewed)
            result = self.run_cli(*args)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(json.loads((root / "out/observations.json").read_text())), 1)
            reviewed.write_text(json.dumps([review(provider_id=None, decision="rejected")]))
            result = self.run_cli(*args)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads((root / "out/observations.json").read_text()), [])

    def test_optional_supplements_append_and_all_input_hashes_are_recorded(self):
        with tempfile.TemporaryDirectory(dir=BASE, prefix=".transform-test-") as directory:
            root = Path(directory)
            base_provider = provider("base", official_registration_id="HPBASE")
            supplement_provider = provider("supplement", official_registration_id="HPSUPP")
            inventory = root / "inventory.json"
            inventory_supplement = root / "inventory-supplement.json"
            inventory.write_text(json.dumps([base_provider]))
            inventory_supplement.write_text(json.dumps([supplement_provider]))
            state = root / "state/morris"
            state.mkdir(parents=True)
            state_file = state / "home-care-firms.json"
            state_file.write_text(json.dumps([raw_registry(base_provider, "(999) 999-9999")]))
            state_supplement = root / "state-supplement.json"
            state_supplement.write_text(json.dumps([raw_registry(supplement_provider)]))
            reviewed = root / "reviewed.json"
            reviewed.write_text(json.dumps([review(provider_id="supplement")]))
            output = root / "out"
            result = self.run_cli(
                "--output-dir", output,
                "--inventory", inventory,
                "--inventory-supplement", inventory_supplement,
                "--state-dir", root / "state",
                "--state-supplement", state_supplement,
                "--reviewed-matches", reviewed,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            observation = json.loads((output / "observations.json").read_text())[0]
            self.assertEqual(observation["provider_id"], "supplement")
            expected_pdf_hash = hashlib.sha256(
                (BASE / "sources/hh-agencies-2025.pdf").read_bytes()
            ).hexdigest()
            expected_text_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
            self.assertEqual(observation["county_source"]["pdf_sha256"], expected_pdf_hash)
            self.assertEqual(observation["county_source"]["text_sha256"], expected_text_hash)
            coverage = json.loads((output / "coverage.json").read_text())
            self.assertEqual(coverage["county_entry_count"], 72)
            self.assertEqual(coverage["active_inventory_count"], 2)
            provenance = coverage["provenance"]
            self.assertEqual(len(provenance["inventory"]), 2)
            self.assertEqual(len(provenance["state"]), 2)
            for record in provenance["inventory"] + provenance["state"]:
                self.assertEqual(len(record["sha256"]), 64)
            self.assertEqual(provenance["county_pdf"]["sha256"], expected_pdf_hash)
            self.assertEqual(provenance["county_text"]["sha256"], expected_text_hash)

    def test_invalid_reviews_write_nothing(self):
        with tempfile.TemporaryDirectory(dir=BASE, prefix=".transform-test-") as directory:
            root = Path(directory)
            reviewed = root / "reviewed.json"
            reviewed.write_text(json.dumps([review("unknown", None)]))
            output = root / "out"
            result = self.run_cli("--output-dir", output, "--reviewed-matches", reviewed)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())

    def test_outside_output_directory_is_rejected(self):
        result = self.run_cli("--output-dir", BASE.parent)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must stay within", result.stderr)

    def test_output_symlink_cannot_write_outside_directory(self):
        with tempfile.TemporaryDirectory(dir=BASE, prefix=".transform-test-") as directory:
            root = Path(directory)
            (root / "coverage.json").symlink_to(BASE.parent / "not-written.json")
            result = self.run_cli("--output-dir", root, "--reviewed-matches", root / "absent.json")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual([path.name for path in root.iterdir()], ["coverage.json"])


if __name__ == "__main__":
    unittest.main()
