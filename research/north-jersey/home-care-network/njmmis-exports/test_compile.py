import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("office_exports", ROOT / "compile.py")
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class ExportTests(unittest.TestCase):
    def test_page_continuation_keeps_suite_phone_and_specialty_in_their_record(self):
        heading = "Personal Care Assistance - Aged & Disabled"
        text = (heading + "\nALPHA LLC , Status: Open To New Patients\n100 FIRST ROAD\n"
                "SUITE 4\nCLIFTON\nCLIFTON NJ 07013-0000\nPhone: 2015550123\n"
                "9735550123\nSpecialties: Personal Care Assistance -\f" + heading +
                "\nAged & Disabled\nBETA LLC , Status: Canceled - No Activity\n20 OAK RD\n"
                "NEWARK NJ 07101\nPhone: 2015550456\nSpecialties: Private Duty Nursing\f")
        records, pages = compiler.page_records(text, heading)
        self.assertEqual(pages, 2)
        alpha, beta = map(compiler.parse_record, records)
        self.assertEqual(alpha["sourceOffice"]["address"], "100 FIRST ROAD SUITE 4")
        self.assertEqual(alpha["sourceOffice"]["phone"], "2015550123")
        self.assertEqual(alpha["specialtyPages"], {heading: [1, 2]})
        self.assertEqual(beta["sourceSpecialties"], ["Private Duty Nursing"])
        self.assertEqual(beta["status"], "Canceled - No Activity")

    def test_conflict_holds_the_specialty_across_duplicate_exports(self):
        roster, registrations, _ = compiler.inputs()
        bundle = json.loads((ROOT / "receipts.json").read_text())
        reference = json.loads((ROOT / "verified.json").read_text())[0]
        row = next(r for r in bundle["receipts"] if r["receiptId"] in reference["receiptIds"])
        duplicate = {**row, "receiptId": "conflict", "status": "Canceled - No Activity"}
        test_bundle = {**bundle, "receipts": [row, duplicate], "excludedCounts": {}}
        verified, audit = compiler.project(test_bundle, roster, registrations)
        self.assertEqual(verified, [])
        self.assertEqual(set(audit["counts"]["statusHolds"]), {"conflicting_statuses"})

    def test_suite_and_floor_collisions_and_invalid_phone(self):
        self.assertNotEqual(compiler.street_key("20 Main St Ste 2"),
                            compiler.street_key("20 Main St Ste 3"))
        self.assertNotEqual(compiler.street_key("20 Main St 3rd floor"),
                            compiler.street_key("20 Main St"))
        self.assertIsNone(compiler.phone_key("000-000-0000"))


if __name__ == "__main__":
    unittest.main()
