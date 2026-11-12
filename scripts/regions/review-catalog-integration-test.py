import copy
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("review_catalog_integration", Path(__file__).with_name("review-catalog.py"))
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)


class EditorialIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = catalog.editorial_release()
        cls.plan = catalog.plan()
        pages = {p["requestedUrl"]: p for path in (catalog.WORK / "pages").glob("*.json") for p in [catalog.read(path)]}
        cls.output, cls.coverage = catalog.build(cls.plan, pages)

    def test_each_released_paraphrase_reaches_its_exact_provider_source_and_original_receipt(self):
        released = 0
        for page in self.release["pages"]:
            provider = self.output[page["providerId"]]
            source = next(s for s in provider["sources"] if s["url"] == page["url"])
            accounts = {catalog.canonical_review(a["url"]): a for a in provider["accounts"] if a["sourceId"] == source["id"]}
            for row in page["rows"]:
                key = catalog.canonical_review(row["originalReviewKey"])
                if row["publication"] != "released":
                    self.assertNotIn(key, accounts)
                    continue
                released += 1
                account = accounts[key]
                self.assertEqual(account["summary"], row["paraphrase"])
                self.assertIsNone(account["excerpt"])
                self.assertEqual(account["url"], row["originalReviewKey"])
                self.assertEqual(account["date"], row["publishedAt"])
                self.assertEqual(account["datePrecision"], row["datePrecision"])
                self.assertEqual(account["relationship"], row["role"])
                self.assertEqual(account["nativeReviewId"], row["id"])
                expected = catalog.account(page["providerId"], source, {"url": row["originalReviewKey"], "date": row["publishedAt"]}, "new-public-page")
                self.assertEqual(account["id"], expected["id"])
            self.assertEqual(source["retainedCount"], len(accounts))
        self.assertEqual(released, self.release["counts"]["releasedRows"])
        self.assertGreater(released, 0)

    def test_approved_artifact_cannot_change_provider_original_receipt_or_body_hash(self):
        original_read = catalog.read
        for field, value in [("providerId", "cms-225001"), ("originalReviewKey", "https://example.org/wrong-review"), ("bodySha256", "0" * 64)]:
            release = copy.deepcopy(self.release)
            if field == "providerId":
                release["pages"][0][field] = value
            else:
                release["pages"][0]["rows"][0][field] = value
            with self.subTest(field=field), patch.object(catalog, "read", side_effect=lambda path: release if path.name == "overlay.json" else original_read(path)):
                with self.assertRaisesRegex(ValueError, "fingerprint mismatch|receipt"):
                    catalog.editorial_release()

    def test_default_release_validation_never_reads_private_original_pages(self):
        read_bytes, read_text = Path.read_bytes, Path.read_text

        def guarded(method):
            def read(path, *args, **kwargs):
                self.assertFalse(any(part in {"raw", "cache", "discovery"} for part in path.parts), str(path))
                return method(path, *args, **kwargs)
            return read

        with patch.object(Path, "read_bytes", guarded(read_bytes)), patch.object(Path, "read_text", guarded(read_text)):
            self.assertEqual(catalog.editorial_release(), self.release)

    def test_cross_provider_or_source_plan_mismatches_fail_closed(self):
        target = next(t for t in self.plan["targets"] if "editorial" in t)
        for field, value in [("providerId", "cms-225001"), ("url", "https://example.org/wrong-location")]:
            changed = copy.deepcopy(target)
            changed["editorial"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "provider or source receipt mismatch"):
                catalog.build({"targets": [changed]}, {})

    def test_no_overlay_target_claims_pagination_exhaustion_without_a_crawl(self):
        target = next(t for t in self.plan["targets"] if "editorial" in t)
        output, coverage = catalog.build({"targets": [target]}, {})
        source = output[target["providerId"]]["sources"][0]
        self.assertEqual(source["coverage"], "partial")
        self.assertEqual(source["pagesChecked"], 1)
        self.assertEqual(source["stopReason"], "editorial-page-reviewed-pagination-not-assessed")
        self.assertEqual(coverage[0]["pendingUrls"], [])


if __name__ == "__main__":
    unittest.main()
