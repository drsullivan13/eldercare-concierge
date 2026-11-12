import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nursing_staffing", ROOT / "scripts/prepare-nursing-staffing.py")
staffing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staffing)


class StaffingBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.codes = {str(code): f"Official explanation {code}" for code in (1, 6, 7, 9, 10, 13, 21, 23, 24, 25, 26, 27, 28)}

    def test_missing_never_becomes_zero(self):
        for raw in (None, "", "-", "NA", "N/A", "Not Available", "Not Applicable"):
            with self.subTest(raw=raw):
                result = staffing.metric(raw, None, self.codes)
                self.assertEqual(result["status"], "unavailable")
                self.assertIsNone(result["value"])
        self.assertEqual(staffing.metric("0", None, self.codes)["value"], 0)

    def test_suppression_overrides_numeric_value_and_keeps_reason(self):
        for code in (6, 7, 9, 21, 25, 26, 27):
            with self.subTest(code=code):
                result = staffing.metric("3.5", str(code), self.codes)
                self.assertEqual(result["status"], "suppressed")
                self.assertIsNone(result["value"])
                self.assertIn(f"Official explanation {code}", result["footnote"])

    def test_missing_submission_is_not_a_zero_or_suppressed_measure(self):
        for code in (1, 10, 23):
            result = staffing.metric("", str(code), self.codes)
            self.assertEqual(result["status"], "unavailable")
            self.assertIsNone(result["value"])

    def test_qualification_does_not_suppress_reported_value(self):
        for code in (13, 24, 28):
            result = staffing.metric("1.23456", str(code), self.codes)
            self.assertEqual(result["status"], "reported")
            self.assertEqual(result["value"], 1.23456)
            self.assertIn(str(code), result["footnote"])

    def test_invalid_values_and_unknown_footnotes_require_review(self):
        for raw in ("NaN", "Infinity", "-1", "abc", True, "3 hours"):
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    staffing.metric(raw, None, self.codes)
        with self.assertRaisesRegex(ValueError, "Unreviewed CMS footnote"):
            staffing.metric("2", "99", self.codes)

    def assert_changed_archive_rejected(self, relative, change, expected):
        source = ROOT / relative
        payload = json.loads(source.read_bytes())
        change(payload)
        body = staffing.encode(payload)
        receipt_path = source.with_name(source.name + ".receipt.json")
        receipt = json.loads(receipt_path.read_bytes())
        receipt.update(sha256=staffing.digest(body), bytes=len(body))
        replacements = {source: body, receipt_path: staffing.encode(receipt)}
        original = Path.read_bytes

        def read(path):
            return replacements[path] if path in replacements else original(path)

        with patch.object(Path, "read_bytes", read):
            with self.assertRaisesRegex(ValueError, expected):
                staffing.build()

    def test_period_processing_date_must_match_provider_release(self):
        def change(payload):
            for row in payload["results"]:
                if row["measure_code"] == "STAFFING_LEVELS":
                    row["processing_date"] = "20260901"

        self.assert_changed_archive_rejected(
            "research/north-jersey/cms/raw/qmdc-9999/primary/page-0000000.json",
            change, "No matching period")

    def test_truncated_retained_response_is_not_coverage(self):
        self.assert_changed_archive_rejected(
            "research/north-jersey/cms/raw/4pq5-n9py/primary/page-0000000.json",
            lambda payload: payload["results"].pop(), "Incomplete source page")

    def test_duplicate_measure_period_is_ambiguous(self):
        def change(payload):
            row = next(row for row in payload["results"] if row["measure_code"] == "STAFFING_LEVELS")
            payload["results"].append(row)
            payload["count"] += 1

        self.assert_changed_archive_rejected(
            "research/north-jersey/cms/raw/qmdc-9999/primary/page-0000000.json",
            change, "Ambiguous period")


if __name__ == "__main__":
    unittest.main()
