import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("editorial", HERE / "build.py")
EDITORIAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EDITORIAL)
PRIVATE_AVAILABLE = (EDITORIAL.BASE / "listing-index/raw" /
                     EDITORIAL.load(HERE / "overlay.json")["pages"][0]["retainedPage"]["sha256"]).is_file()
private_evidence = unittest.skipUnless(PRIVATE_AVAILABLE, "Private original HTML is not installed")


class PublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = EDITORIAL.validate_public_release(EDITORIAL.load(HERE / "overlay.json"))
        cls.decisions = EDITORIAL.load(HERE / "decisions.json")

    def altered_input(self, relative, change):
        original = EDITORIAL.load
        target = EDITORIAL.BASE / relative

        def replacement(path):
            value = original(path)
            if path == target:
                value = copy.deepcopy(value)
                change(value)
            return value

        return patch.object(EDITORIAL, "load", side_effect=replacement)

    def test_retained_overlay_is_exactly_reproducible(self):
        self.assertEqual((HERE / "overlay.json").read_bytes(), EDITORIAL.encoded(self.result))
        self.assertEqual(EDITORIAL.encoded(self.result),
                         EDITORIAL.encoded(EDITORIAL.validate_public_release(copy.deepcopy(self.result))))

    @private_evidence
    def test_private_originals_reproduce_the_public_release(self):
        self.assertEqual(EDITORIAL.encoded(self.result), EDITORIAL.encoded(EDITORIAL.build()))

    def test_every_visible_account_has_a_publication_decision(self):
        rows = [r for p in self.result["pages"] for r in p["rows"]]
        self.assertEqual(len(rows), self.result["counts"]["reviewedRows"])
        self.assertEqual(len({r["originalReviewKey"] for r in rows}), len(rows))

    @private_evidence
    def test_private_omitted_article_decision_fails(self):
        decisions = copy.deepcopy(self.decisions)
        decisions["pages"]["maple-glen-center"].pop("305870")
        with self.assertRaisesRegex(ValueError, "complete displayed article population"):
            EDITORIAL.build(decisions)

    def test_withheld_accounts_never_have_readable_text(self):
        rows = [r for p in self.result["pages"] for r in p["rows"] if r["publication"] == "withheld"]
        self.assertTrue(rows)
        for row in rows:
            self.assertNotIn("paraphrase", row)
            self.assertNotIn("originalExcerpt", row)
            self.assertTrue(row["exclusionReasons"])
        sensitive = next(r for r in rows if r["id"] == "mlc-external-608468")
        self.assertEqual(sensitive["exclusionReasons"], ["sensitive-multi-provider-narrative"])

    def test_no_full_bodies_or_author_fields_are_published(self):
        for page in self.result["pages"]:
            for row in page["rows"]:
                self.assertFalse({"author", "authorName", "body", "text", "originalExcerpt"} & row.keys())
                self.assertRegex(row["bodySha256"], r"^[0-9a-f]{64}$")
                self.assertRegex(row["publishedAt"], r"^\d{4}-\d{2}$")
                if row["publication"] == "released":
                    self.assertEqual(row["representation"], "editorial-paraphrase")
                    EDITORIAL.publication_text(row["paraphrase"])

    def test_both_sides_of_mixed_accounts_and_revisions_are_retained(self):
        rows = {r["sourceReviewId"]: r for p in self.result["pages"] for r in p["rows"]}
        self.assertIn("repeated falls", rows["547823"]["paraphrase"])
        self.assertIn("additional private aide", rows["547823"]["paraphrase"])
        self.assertIn("praises daily care", rows["547823"]["paraphrase"])
        self.assertIn("updated account", rows["628561"]["paraphrase"])
        self.assertIn("limited communication", rows["628561"]["paraphrase"])
        self.assertIn("improved meals", rows["305870"]["paraphrase"])
        self.assertIn("supervision", rows["305870"]["paraphrase"])
        self.assertIn("do not assess care quality", rows["655970"]["paraphrase"])
        self.assertIn("another resident", rows["609214"]["paraphrase"])
        self.assertEqual(rows["609458"]["sentiment"], "positive")

    @private_evidence
    def test_existing_reviewed_pages_cannot_be_replaced(self):
        decisions = copy.deepcopy(self.decisions)
        decisions["pages"]["alaris-health-at-belgrove"] = {}
        with self.assertRaisesRegex(ValueError, "existing 41"):
            EDITORIAL.build(decisions)

    @private_evidence
    def test_previously_held_page_cannot_be_admitted(self):
        decisions = copy.deepcopy(self.decisions)
        decisions["pages"]["phoenix-center-for-rehabilitation-and-pediatrics"] = {}
        with self.assertRaisesRegex(ValueError, "Previously held"):
            EDITORIAL.build(decisions)

    @private_evidence
    def test_previously_excluded_row_stays_blocked(self):
        def add_block(value):
            value["pages"][0]["rows"].append(
                {"id": "mlc-external-501024", "exclusionReasons": ["privacy"]})

        with self.altered_input("review-excerpts/observations.json", add_block):
            with self.assertRaisesRegex(ValueError, "Previously excluded"):
                EDITORIAL.build()

    @private_evidence
    def test_access_policy_denial_blocks_release(self):
        def deny(value):
            for source in value["sources"]:
                if source["source"] == "MyLivingChoice":
                    source["access_decision"] = "restricted_no_automation"

        with self.altered_input("reviews/source-access.json", deny):
            with self.assertRaisesRegex(ValueError, "policy no longer permits"):
                EDITORIAL.build()

    @private_evidence
    def test_excluded_original_link_stays_blocked_after_native_id_changes(self):
        original_key = self.result["pages"][0]["rows"][0]["originalReviewKey"]

        def add_block(value):
            value["pages"][0]["rows"].append(
                {"id": "different-native-id", "reviewUrl": original_key, "exclusionReasons": ["privacy"]})

        with self.altered_input("review-excerpts/observations.json", add_block):
            with self.assertRaisesRegex(ValueError, "excluded original review permalink"):
                EDITORIAL.build()

    @private_evidence
    def test_baseline_account_cannot_be_counted_again_on_another_page(self):
        original_key = self.result["pages"][0]["rows"][0]["originalReviewKey"]

        def add_existing(value):
            value["pages"][0]["rows"].append(
                {"id": "different-native-id", "reviewUrl": original_key, "exclusionReasons": []})

        with self.altered_input("review-excerpts/observations.json", add_existing):
            with self.assertRaisesRegex(ValueError, "already exists in the baseline"):
                EDITORIAL.build()

    @private_evidence
    def test_source_hash_tampering_blocks_release(self):
        original = Path.read_bytes
        raw = EDITORIAL.ROOT / self.result["pages"][0]["retainedPage"]["path"]

        def altered(path):
            data = original(path)
            return data + b"changed" if path == raw else data

        with patch.object(Path, "read_bytes", altered):
            with self.assertRaisesRegex(ValueError, "HTML hash mismatch"):
                EDITORIAL.build()

    @private_evidence
    def test_wrong_street_or_unit_in_source_cannot_be_admitted(self):
        def change_street(value):
            self.assertIn("545 Tappan Road", value["markdown"])
            value["markdown"] = value["markdown"].replace("545 Tappan Road", "999 Wrong Road")

        with self.altered_input("listing-index/discovery/pages/arbor-terrace-norwood.json", change_street):
            with self.assertRaisesRegex(ValueError, "corroborate published identity"):
                EDITORIAL.build()

    @private_evidence
    def test_missing_official_crosswalk_blocks_release(self):
        def remove(value):
            value[:] = [r for r in value if r.get("providerId") != "north-jersey-doh-nj02a026"]

        with self.altered_input("runtime/crosswalk.json", remove):
            with self.assertRaisesRegex(ValueError, "unique exact official"):
                EDITORIAL.build()

    def test_privacy_and_length_boundaries(self):
        for text in [
            "A reviewer names Jane Smith.",
            "A reviewer reports diabetes.",
            "A reviewer lists person@example.com.",
            "A reviewer lists 201-555-0123.",
            "A reviewer says " + "helpful " * 40,
            "A reviewer says " + "x" * 230,
            "A reviewer includes <script>.",
        ]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    EDITORIAL.publication_text(text)
        EDITORIAL.publication_text("A reviewer praises kind staff but criticizes slow replies.")

    def test_counts_are_derived_from_the_readable_accounts(self):
        pages = self.result["pages"]
        released = [r for p in pages for r in p["rows"] if r["publication"] == "released"]
        self.assertEqual(len(pages), self.result["counts"]["additionalPages"])
        self.assertEqual(len(released), self.result["counts"]["releasedRows"])
        self.assertGreater(len([r for r in released if r["sentiment"] == "critical"]), 0)
        self.assertGreater(len([r for r in released if r["sentiment"] == "mixed"]), 0)
        self.assertEqual(self.result["counts"]["combinedPages"],
                         self.result["counts"]["baselinePages"] + len(pages))
        self.assertLessEqual(max(len(r["paraphrase"]) for r in released), 240)
        self.assertLessEqual(max(len(r["paraphrase"].split()) for r in released), 40)

    def test_public_provider_identity_tampering_fails(self):
        result = copy.deepcopy(self.result)
        result["pages"][0]["providerId"] = "cms-315005"
        with self.assertRaisesRegex(ValueError, "fingerprint mismatch"):
            EDITORIAL.validate_public_release(result)

    def test_public_original_link_tampering_fails(self):
        result = copy.deepcopy(self.result)
        result["pages"][0]["rows"][0]["originalReviewKey"] += "-changed"
        with self.assertRaisesRegex(ValueError, "fingerprint mismatch"):
            EDITORIAL.validate_public_release(result)

    def test_public_body_hash_tampering_fails(self):
        result = copy.deepcopy(self.result)
        result["pages"][0]["rows"][0]["bodySha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "fingerprint mismatch"):
            EDITORIAL.validate_public_release(result)

    def test_public_receipt_fingerprint_tampering_fails(self):
        original = EDITORIAL.load

        def altered(path):
            value = original(path)
            if path == HERE / "release-fingerprint.json":
                value["sourceReceipts"]["sha256"] = "0" * 64
            return value

        with patch.object(EDITORIAL, "load", side_effect=altered):
            with self.assertRaisesRegex(ValueError, "source receipt fingerprint mismatch"):
                EDITORIAL.validate_public_release(self.result)

    def test_public_validation_does_not_read_private_files(self):
        original_bytes, original_text = Path.read_bytes, Path.read_text

        def guard(path):
            text = str(path)
            if "/listing-index/raw/" in text or "/listing-index/cache/" in text or "/listing-index/discovery/pages/" in text:
                self.fail("Public validation tried to read a private capture")

        def read_bytes(path):
            guard(path)
            return original_bytes(path)

        def read_text(path, *args, **kwargs):
            guard(path)
            return original_text(path, *args, **kwargs)

        with patch.object(Path, "read_bytes", read_bytes), patch.object(Path, "read_text", read_text):
            EDITORIAL.validate_public_release(copy.deepcopy(self.result))


if __name__ == "__main__":
    unittest.main()
