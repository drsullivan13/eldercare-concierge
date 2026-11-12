import copy
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

WORK = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ma_review_catalog", WORK / "generate.py")
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)


class MassachusettsCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records, cls.coverage = catalog.build()
        cls.receipts = catalog.read(WORK / "receipts.json")

    def test_feed_matches_real_typescript_contract(self):
        record_keys = {"providerId", "checkedAt", "accounts", "sources", "notes"}
        account_keys = {"id", "sourceId", "sourceFamily", "url", "date",
                        "datePrecision", "relationship", "excerpt", "summary",
                        "representation", "provenance", "nativeReviewId"}
        source_keys = {"id", "publisher", "sourceFamily", "url", "reportedCount",
                       "retainedCount", "previouslyUnseenCount", "pagesChecked",
                       "coverage", "stopReason"}
        for pid, record in self.records.items():
            self.assertEqual(set(record), record_keys)
            self.assertEqual(record["providerId"], pid)
            source_ids = {s["id"] for s in record["sources"]}
            for source in record["sources"]:
                self.assertEqual(set(source) - {"scopeNote"}, source_keys)
                self.assertEqual(source["retainedCount"], len(record["accounts"]))
            for account in record["accounts"]:
                self.assertEqual(set(account), account_keys)
                self.assertIn(account["sourceId"], source_ids)
                self.assertEqual(account["sourceFamily"], "google")
                self.assertEqual(account["datePrecision"], "month")
                self.assertIsNone(account["excerpt"])
                self.assertEqual(account["provenance"], "new-public-page")
                self.assertEqual(account["representation"],
                                 "reviewed-excerpt" if account["summary"] else "link-only")

    def test_every_visible_article_has_an_explicit_publication_decision(self):
        self.assertEqual(len(self.receipts), 26)
        self.assertEqual(sum(len(r["rows"]) for r in self.receipts), 123)
        self.assertEqual(sum(len(r["accounts"]) for r in self.records.values()), 101)
        self.assertEqual(sum(len(s["excluded"]) for s in self.coverage), 22)
        self.assertEqual(sum(bool(a["summary"]) for r in self.records.values()
                             for a in r["accounts"]), 98)

    def test_native_ids_and_dates_agree_with_independent_rendered_receipts(self):
        browser = {r["url"]: r for r in catalog.read(WORK / "browser-pagination.json")}
        for receipt in self.receipts:
            dom = browser[receipt["url"]]
            self.assertEqual(set(dom["reviewIds"]), {
                r["nativeId"].removeprefix("mlc-external-") for r in receipt["rows"]})
            self.assertFalse(dom["buttons"])
            self.assertFalse(dom["paginationLinks"])
            self.assertFalse(receipt["nextLinks"])
        rows = {r["url"]: r for receipt in self.receipts for r in receipt["rows"]}
        for record in self.records.values():
            for account in record["accounts"]:
                self.assertEqual(account["date"], rows[account["url"]]["date"])
                self.assertEqual(account["id"], "google-" + catalog.digest(
                    record["providerId"] + "|" + rows[account["url"]]["originalReviewKey"])[:24])

    def test_actual_38_rating_source_does_not_become_38_nursing_accounts(self):
        record = self.records["cms-225281"]
        self.assertEqual(record["sources"][0]["reportedCount"], 38)
        self.assertEqual(len(record["accounts"]), 4)
        note = record["sources"][0]["scopeNote"]
        self.assertRegex(note, r"38 ratings across North Hill.*Pines Edge")
        self.assertRegex(note, r"four accounts shown.*Pines Edge rehab")
        self.assertRegex(note, r"broader source.*not.*nursing-unit rating.*score")
        self.assertNotRegex(note, r"(?i)release only|do not assign|copy its aggregate")
        self.assertIn(note, record["notes"])
        coverage = next(s for s in self.coverage if s["providerId"] == "cms-225281")
        self.assertIn("mlc-external-301320", {r["nativeId"] for r in coverage["excluded"]})

    def test_wrong_locations_and_professional_accounts_stay_excluded(self):
        excluded = {r["nativeId"] for s in self.coverage for r in s["excluded"]}
        self.assertTrue({"mlc-external-630575", "mlc-external-630605",
                         "mlc-external-630543", "mlc-external-630184",
                         "mlc-external-630158"} <= excluded)
        self.assertFalse(self.records["ma-alr-waterstone-at-wellesley"]["accounts"])
        self.assertNotIn(None, self.records)
        self.assertFalse(any("ezra" in pid for pid in self.records))
        self.assertFalse(self.records["mgb-home-care"]["accounts"])

    def test_two_known_syndicated_matches_are_not_new_accounts(self):
        self.assertEqual(sum(s["previouslyUnseenCount"] for s in self.coverage), 99)
        examples = catalog.merge_examples(self.records)
        self.assertEqual({e["providerId"]: e["distinctMergedAccounts"] for e in examples}, {
            "ma-alr-sunrise-of-newton": 8,
            "ma-alr-the-falls-at-cordingly-dam": 9,
            "ma-alr-adelaide-of-newton-centre": 7,
            "ma-alr-goddard-house": 7,
        })

    def test_parser_never_turns_generated_summary_into_an_account(self):
        target = {"slug": "fixture"}
        raw = {
            "metadata": {"statusCode": 200},
            "effectiveUrl": "https://www.mylivingchoice.com/property/fixture",
            "markdown": (
                "# Fixture\n\n1 Main Street, Newton, Massachusetts\n\n"
                "## What Families Think\n\nAn AI-generated summary of many accounts.\n\n"
                "## Types of Care\n\nAssisted Living\n\n"
                "## Reviews of Fixture\n\n4★ on Google (38)\n\nNo individual articles.\n\n"
                "## Nearby communities\n\nA different property has many reviews."
            ),
        }
        receipt = catalog.parse_receipt(raw, target)
        self.assertEqual(receipt["reportedCount"], 38)
        self.assertFalse(receipt["rows"])
        self.assertNotIn("AI-generated", json.dumps(receipt))

    def test_new_pagination_controls_fail_closed(self):
        original_read = catalog.read
        browser = copy.deepcopy(original_read(WORK / "browser-pagination.json"))
        browser[0]["buttons"] = [{"text": "Load more", "disabled": False}]

        def modified_read(path):
            return browser if path == WORK / "browser-pagination.json" else original_read(path)

        with patch.object(catalog, "read", side_effect=modified_read):
            with self.assertRaisesRegex(AssertionError, "Visible pagination"):
                catalog.build()

    def test_receipts_contain_hashes_not_author_names_or_medical_narratives(self):
        for receipt in self.receipts:
            for row in receipt["rows"]:
                self.assertEqual(set(row), {"nativeId", "originalReviewKey", "url", "date",
                                            "datePrecision", "bodySha256", "hasText"})
                self.assertRegex(row["bodySha256"], r"^[a-f0-9]{64}$")
        for record in self.records.values():
            for account in record["accounts"]:
                self.assertNotRegex(account["summary"] or "",
                                    r"(?i)alzheimer|dementia|cancer|diagnos|medicat|stroke|surgery|hospice|sepsis")


if __name__ == "__main__":
    unittest.main()
