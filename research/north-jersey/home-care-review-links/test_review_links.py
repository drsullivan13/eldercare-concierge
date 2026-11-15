import importlib.util
import json
from copy import deepcopy
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("review_links_validator", HERE / "validate.py")
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)
PID = "north-jersey-hp-hp0000001"
URL = "https://www.yelp.com/biz/example-local-office"


def fixture():
    catalog = {PID: {
        "category": "home-care", "address": "1 MAIN STREET",
        "officialRegistrationId": "HP0000001", "county": "Bergen",
    }}
    reviewed = {PID: {
        "catalogAddress": "1 MAIN STREET", "officialRegistrationId": "HP0000001",
        "officeName": "Example local office", "county": "Bergen", "checkedAt": "2026-01-02",
        "identity": {
            "recordId": "example-local", "recordsFile": "../home-care-first-party/records.json",
            "checkedAt": "2026-01-01", "registeredAddress": "1 MAIN STREET ",
            "registeredCity": "EXAMPLE", "registeredState": "NJ", "registeredZip": "07001",
            "observedAddress": "1 Main Street, Example NJ 07001",
        },
        "reviewLinks": [{
            "publisher": "Yelp", "url": URL, "originalUrl": URL,
            "discoveryReceipt": "discovery/search.json",
            "identityBasis": "Exact local office street address in search title.",
        }],
    }}
    first_party = [{
        "record_id": "example-local", "provider_id": PID,
        "official_registration_id": "HP0000001", "county": "Bergen",
        "registered_address": "1 MAIN STREET ", "checked_at": "2026-01-01",
        "registered_city": "EXAMPLE", "registered_state": "NJ", "registered_zip": "07001",
        "observed_address": "1 Main Street, Example NJ 07001",
    }]
    receipt = {
        "query": '"Example local office" "1 Main Street" reviews',
        "checkedAt": "2026-01-02",
        "results": [{"url": URL, "title": "Example local office, 1 Main Street"}],
    }
    coverage = [{
        "providerId": PID, "county": "Bergen", "status": "accepted",
        "queries": [receipt["query"]], "acceptedUrls": [URL],
        "withheldCandidates": [], "reason": "Exact local office destination.",
    }]
    return catalog, reviewed, first_party, receipt, coverage


class ReviewLinksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve() / "home-care-review-links"
        self.base.mkdir()
        (self.base / "discovery").mkdir()
        (self.base.parent / "home-care-first-party").mkdir()
        (self.base.parent / "runtime").mkdir()
        self.catalog, self.reviewed, self.first_party, self.receipt, self.coverage = fixture()
        self.write_fixture()

    def write_fixture(self):
        files = {
            self.base / "review-links.json": self.reviewed,
            self.base / "coverage.json": self.coverage,
            self.base / "discovery/search.json": self.receipt,
            self.base.parent / "home-care-first-party/records.json": self.first_party,
            self.base.parent / "runtime/providers.json": [
                {"id": pid, **row} for pid, row in self.catalog.items()
            ],
            self.base.parent / "runtime/crosswalk.json": [{
                "providerId": pid, "officialId": row["officialRegistrationId"],
                "county": row["county"], "status": "included",
            } for pid, row in self.catalog.items()],
        }
        for path, value in files.items():
            path.write_text(json.dumps(value))

    def assert_invalid(self):
        self.write_fixture()
        report = validator.validate(self.base, self.catalog)
        self.assertFalse(report["valid"], report)
        self.assertTrue(report["errors"])

    def test_valid_fixture_and_read_only_cli(self):
        (self.base / "portal-links.json").write_text(json.dumps({"schemaVersion": 1, "links": [{
            "providerId": PID, "publisher": "Yelp", "url": URL,
            "checkedAt": self.reviewed[PID]["checkedAt"], "catalogAddress": self.catalog[PID]["address"],
        }]}))
        before = {p: p.read_bytes() for p in self.base.parent.rglob("*") if p.is_file()}
        result = subprocess.run([
            sys.executable, "-B", str(HERE / "validate.py"),
            "--directory", str(self.base),
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["valid"])
        self.assertEqual(report["emptyMapProviders"], 1)
        self.assertEqual(report["links"], 1)
        after = {p: p.read_bytes() for p in self.base.parent.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_verified_service_witness_checks_suite_and_phone(self):
        source = self.base.parent / "home-care-pay-services/verified-office-services.json"
        source.parent.mkdir()
        identity = self.reviewed[PID]["identity"]
        identity.update(recordId=PID, recordsFile="../home-care-pay-services/verified-office-services.json")
        office = self.catalog[PID]
        office.update(name="Example LLC", city="EXAMPLE", zip="07001", phone="2015550101")
        witness = {"providerId": PID, "name": office["name"], "street": identity["registeredAddress"],
                   "city": office["city"], "zip": office["zip"], "phone": office["phone"],
                   "observedAddress": identity["observedAddress"], "checkedAt": identity["checkedAt"]}
        self.write_fixture()
        source.write_text(json.dumps([witness]))
        self.assertTrue(validator.validate(self.base, self.catalog)["valid"])
        for field, wrong_value in (("street", "1 MAIN STREET UNIT B"), ("phone", "2015550102")):
            source.write_text(json.dumps([{**witness, field: wrong_value}]))
            self.assertFalse(validator.validate(self.base, self.catalog)["valid"])

    def test_empty_location_map_gets_only_public_shell(self):
        result = validator.merge_links({}, self.catalog, self.reviewed)
        self.assertEqual(result, {PID: {
            "providerId": PID, "sources": [], "reviews": [],
            "reviewLinks": [{"publisher": "Yelp", "url": URL}],
        }})

    def test_preserve_old_decisions_scores_links_and_inputs(self):
        old_link = {"publisher": "Original label", "url": URL}
        other_link = {"publisher": "Earlier publisher", "url": "https://example.com/old"}
        records = {
            PID: {"providerId": PID, "sources": [{"url": "https://example.com/source"}],
                  "reviews": [{"decision": "withheld"}], "score": 7.5,
                  "reviewAggregates": [{"rating": 4, "count": 2}],
                  "reviewLinks": [old_link, other_link]},
            "unrelated": {"providerId": "unrelated", "decision": "preserve"},
        }
        before = deepcopy((records, self.catalog, self.reviewed))
        result = validator.merge_links(records, self.catalog, self.reviewed)
        self.assertEqual(result, records)
        self.assertEqual((records, self.catalog, self.reviewed), before)
        result[PID]["reviews"].append({"decision": "new"})
        self.assertEqual((records, self.catalog, self.reviewed), before)

    def test_append_deduplicates_and_merge_is_idempotent(self):
        old = {"publisher": "Earlier", "url": "https://example.com/old"}
        records = {PID: {"providerId": PID, "reviewLinks": [old], "score": None}}
        result = validator.merge_links(records, self.catalog, self.reviewed)
        self.assertEqual(result[PID]["reviewLinks"], [old, {"publisher": "Yelp", "url": URL}])
        self.assertIsNone(result[PID]["score"])
        self.assertEqual(validator.merge_links(result, self.catalog, self.reviewed), result)

    def test_merge_rejects_wrong_catalog_identity_without_mutating(self):
        for field, value in (
            ("category", "home-health"), ("address", "2 MAIN STREET"),
            ("officialRegistrationId", "HP0000002"), ("county", "Essex"),
        ):
            with self.subTest(field=field):
                catalog = deepcopy(self.catalog)
                catalog[PID][field] = value
                records = {"other": {"score": 9}}
                with self.assertRaises(ValueError):
                    validator.merge_links(records, catalog, self.reviewed)
                self.assertEqual(records, {"other": {"score": 9}})
        self.reviewed[PID]["identity"]["registeredAddress"] = "2 MAIN STREET"
        with self.assertRaises(ValueError):
            validator.merge_links({}, self.catalog, self.reviewed)

    def test_reject_wrong_first_party_identity(self):
        original = deepcopy(self.first_party)
        for field in (
            "record_id", "provider_id", "official_registration_id", "county",
            "registered_address", "registered_city", "registered_state", "registered_zip",
            "observed_address", "checked_at",
        ):
            with self.subTest(field=field):
                self.first_party = deepcopy(original)
                self.first_party[0][field] = "wrong identity"
                self.assert_invalid()

    def test_registered_street_matches_runtime_address_with_collapsed_whitespace(self):
        identity = self.reviewed[PID]["identity"]
        for field, first_party_field, value in (
            ("registeredAddress", "registered_address", " 1  MAIN STREET \t"),
            ("registeredCity", "registered_city", " EXAMPLE "),
            ("registeredState", "registered_state", " NJ "),
            ("registeredZip", "registered_zip", " 07001 "),
        ):
            identity[field] = value
            self.first_party[0][first_party_field] = value
        self.write_fixture()
        self.assertTrue(validator.validate(self.base, self.catalog)["valid"])
        self.assertEqual(len(validator.merge_links({}, self.catalog, self.reviewed)), 1)

    def test_merge_requires_registered_address_provenance(self):
        original = deepcopy(self.reviewed)
        for field in ("registeredAddress", "registeredCity", "registeredState", "registeredZip"):
            for value in ("", None):
                with self.subTest(field=field, value=value):
                    reviewed = deepcopy(original)
                    reviewed[PID]["identity"][field] = value
                    with self.assertRaises(ValueError):
                        validator.merge_links({}, self.catalog, reviewed)
            reviewed = deepcopy(original)
            del reviewed[PID]["identity"][field]
            with self.assertRaises(ValueError):
                validator.merge_links({}, self.catalog, reviewed)

    def test_catalog_address_must_not_append_city_state_or_zip(self):
        self.catalog[PID]["address"] = "1 MAIN STREET EXAMPLE NJ 07001"
        self.reviewed[PID]["catalogAddress"] = "1 MAIN STREET EXAMPLE NJ 07001"
        self.assert_invalid()
        with self.assertRaises(ValueError):
            validator.merge_links({}, self.catalog, self.reviewed)

    def test_reject_duplicate_first_party_record(self):
        self.first_party.append(deepcopy(self.first_party[0]))
        self.assert_invalid()

    def test_missing_receipt_and_receipt_path_escape(self):
        for value in ("discovery/missing.json", "../home-care-first-party/records.json",
                      str(self.base / "discovery/search.json")):
            with self.subTest(value=value):
                self.reviewed[PID]["reviewLinks"][0]["discoveryReceipt"] = value
                self.assert_invalid()

    def test_receipt_symlink_escape(self):
        outside = self.base.parent / "outside.json"
        outside.write_text(json.dumps(self.receipt))
        (self.base / "discovery/escape.json").symlink_to(outside)
        self.reviewed[PID]["reviewLinks"][0]["discoveryReceipt"] = "discovery/escape.json"
        self.assert_invalid()

    def test_unrelated_original_or_public_url_is_rejected(self):
        for field in ("originalUrl", "url"):
            with self.subTest(field=field):
                self.reviewed = fixture()[1]
                self.reviewed[PID]["reviewLinks"][0][field] = "https://example.com/not-discovered"
                self.assert_invalid()

    def test_canonical_google_destinations_need_only_original_in_receipt(self):
        cases = (
            ("https://search.google.com/local/writereview?placeid=ChIJ_test-123",
             "https://www.google.com/maps/search/?api=1&query=Home%20care&query_place_id=ChIJ_test-123"),
            ("https://www.google.com/maps/reviews/data=!4m8!1sReview!2m1!1s0x0:0xed4ceaed69cd9a80!3m1!1sReview",
             "https://maps.google.com/?cid=17099300190622161536"),
            ("https://www.google.com/maps/reviews/data=!1s0x0:0xff!3m1",
             "https://maps.google.com/?cid=255"),
            ("https://www.google.com/maps/reviews/data=!1s0x0:0xffffffffffffffff!3m1",
             "https://maps.google.com/?cid=18446744073709551615"),
            ("https://maps.google.com/?cid=7840194762121509347&g_mp=Example",
             "https://maps.google.com/?cid=7840194762121509347"),
            ("https://maps.google.com/?cid=14301743824129099011&g_mp=Example&hl=en&gl=US&source=embed",
             "https://maps.google.com/?cid=14301743824129099011"),
        )
        for original, public in cases:
            with self.subTest(original=original):
                self.reviewed[PID]["reviewLinks"][0].update(
                    publisher="Google Maps", originalUrl=original, url=public)
                self.receipt["results"] = [{"url": original, "title": "Exact office profile"}]
                self.coverage[0]["acceptedUrls"] = [public]
                self.assertEqual(validator.canonical_url(original), public)
                self.write_fixture()
                report = validator.validate(self.base, self.catalog)
                self.assertTrue(report["valid"], report)
                before = deepcopy(self.reviewed)
                merged = validator.merge_links({}, self.catalog, self.reviewed)
                self.assertEqual(merged[PID]["reviewLinks"], [
                    {"publisher": "Google Maps", "url": public},
                ])
                self.assertEqual(self.reviewed, before)
                self.receipt["results"][0]["url"] = public
                self.assert_invalid()

    def test_reject_relabels_even_when_both_urls_are_in_receipt(self):
        cases = (
            (URL, "https://example.com/arbitrary"),
            ("https://search.google.com/local/writereview?placeid=ChIJ_original",
             "https://www.google.com/maps/search/?api=1&query=Home%20care&query_place_id=ChIJ_other"),
            ("https://search.google.com/local/writereview?placeid=ChIJ_original",
             "https://www.google.com/maps/search/?api=1&query=Senior%20Helpers&query_place_id=ChIJ_original"),
            ("https://www.google.com/maps/reviews/data=!1s0x0:0xff!3m1",
             "https://maps.google.com/?cid=256"),
            ("https://maps.google.com/?cid=123&g_mp=Example",
             "https://maps.google.com/?cid=124"),
        )
        for original, public in cases:
            with self.subTest(original=original, public=public):
                self.reviewed[PID]["reviewLinks"][0].update(originalUrl=original, url=public)
                self.receipt["results"] = [
                    {"url": original, "title": "Original"},
                    {"url": public, "title": "Other"},
                ]
                self.coverage[0]["acceptedUrls"] = [public]
                self.assert_invalid()
                with self.assertRaises(ValueError):
                    validator.merge_links({}, self.catalog, self.reviewed)

    def test_canonical_url_leaves_unrecognized_or_ambiguous_forms_unchanged(self):
        for original in (
            URL, "https://www.google.com/maps/place/Example",
            "https://search.google.com.evil.example/local/writereview?placeid=ChIJ_test",
            "https://search.google.com/local/writereview?placeid=ChIJ_one&placeid=ChIJ_two",
            "https://search.google.com/local/writereview?placeid=",
            "https://search.google.com/local/writereview?placeid=ChIJ_one&other=ChIJ_two",
            "https://search.google.com/local/writereview?placeid=ChIJ%26other",
            "https://search.google.com:444/local/writereview?placeid=ChIJ_one",
            "https://search.google.com/local/writereview?placeid=ChIJ_one#other",
            "https://maps.google.com/?cid=123&cid=124&g_mp=Example",
            "https://maps.google.com/?cid=not-a-number&g_mp=Example",
            "https://maps.google.com/?cid=123&other=124",
            "https://www.google.com/maps/reviews/data=!1s0x0:0xff!1s0x0:0xfe!",
            "https://www.google.com/maps/reviews/data=!1s0x0:0xfffxyz!",
            "https://www.google.com/maps/place/data=!1s0x0:0xff!",
        ):
            with self.subTest(original=original):
                self.assertEqual(validator.canonical_url(original), original)

    def test_duplicate_review_urls_and_coverage_urls(self):
        self.reviewed[PID]["reviewLinks"] *= 2
        self.assert_invalid()
        self.reviewed = fixture()[1]
        second = deepcopy(self.reviewed[PID]["reviewLinks"][0])
        second["url"] = "https://example.com/different-canonical"
        self.reviewed[PID]["reviewLinks"].append(second)
        self.assert_invalid()
        self.reviewed = fixture()[1]
        self.coverage[0]["acceptedUrls"] *= 2
        self.assert_invalid()

    def test_unreferenced_receipts_still_enforce_link_only_policy(self):
        extra = {"results": [{"url": URL, "title": "Example", "rating": 4.5}]}
        (self.base / "discovery/unused.json").write_text(json.dumps(extra))
        self.assert_invalid()

    def test_duplicate_json_keys_are_rejected(self):
        (self.base / "review-links.json").write_text('{"duplicate": {}, "duplicate": {}}')
        report = validator.validate(self.base, self.catalog)
        self.assertFalse(report["valid"])
        self.assertIn("duplicate key", report["errors"][0])

    def test_reject_unsafe_urls(self):
        for url in (
            "ftp://example.com/reviews", "javascript:alert(1)", "//example.com/reviews",
            "https://user:password@example.com/reviews", "https://example.com/a b",
            "https://example.com/?api_key=hidden", "https://example.com/?access_token=hidden",
            "https://example.com/?%74oken=hidden", "https://example.com/#token=hidden",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validator.public_url(url)
        validator.public_url("https://maps.google.com/?cid=123&hl=en")

    def test_coverage_exact_match_and_catalog_office_county(self):
        original = deepcopy(self.coverage)
        variants = [
            [], [{**original[0], "acceptedUrls": []}],
            [{**original[0], "county": "Essex"}], original * 2,
            [{**original[0], "acceptedUrls": ["https://example.com/unreviewed"]}],
        ]
        for coverage in variants:
            with self.subTest(coverage=coverage):
                self.coverage = coverage
                self.assert_invalid()

    def test_link_only_invariant_rejects_content_fields(self):
        for field in ("score", "rating", "count", "quote", "narrative", "reviews"):
            with self.subTest(field=field):
                self.reviewed = fixture()[1]
                self.reviewed[PID]["reviewLinks"][0][field] = "must not be retained"
                self.assert_invalid()
        self.reviewed = fixture()[1]
        self.receipt["results"][0]["description"] = "must not be retained"
        self.assert_invalid()

    def test_reject_numeric_review_content_in_metadata(self):
        for value in ("Rated 4.8", "Example office 4.8 stars", "Example office 95 reviews",
                      "Example office 5 reviews"):
            with self.subTest(value=value):
                self.receipt["results"][0]["title"] = value
                self.assert_invalid()

    def test_first_party_outgoing_receipt_and_restricted_page_rejection(self):
        self.receipt = {
            "url": "https://example.com/local-office", "checkedAt": "2026-01-02",
            "officeAddress": self.reviewed[PID]["identity"]["observedAddress"],
            "links": [{"url": URL, "label": "Yelp"}],
        }
        self.write_fixture()
        self.assertTrue(validator.validate(self.base, self.catalog)["valid"])
        for url in ("https://yelp.com/biz/office", "https://m.caring.com/office"):
            self.receipt["url"] = url
            self.assert_invalid()

    def test_first_party_receipt_optional_identity_metadata(self):
        self.receipt = {
            "url": "https://example.com/local-office", "checkedAt": "2026-01-02",
            "officeAddress": self.reviewed[PID]["identity"]["observedAddress"],
            "links": [{"url": URL, "label": "Yelp"}],
            "identityReference": "example-local",
            "addressEvidenceSource": "Dated first-party identity record.",
        }
        self.write_fixture()
        report = validator.validate(self.base, self.catalog)
        self.assertTrue(report["valid"], report)
        for field in ("identityReference", "addressEvidenceSource"):
            for value in ([], "", "Office 5 reviews"):
                with self.subTest(field=field, value=value):
                    receipt = deepcopy(self.receipt)
                    receipt[field] = value
                    with self.assertRaises(ValueError):
                        validator.receipt_urls(receipt, set())

    def test_policy_denial_blocks_first_party_capture_but_not_destination(self):
        policy_dir = self.base.parent / "reviews"
        policy_dir.mkdir()
        (policy_dir / "source-access.json").write_text(json.dumps({"sources": [{
            "host": "example.com", "access_decision": "restricted_no_automation",
        }]}))
        self.receipt = {
            "url": "https://branch.example.com/office", "checkedAt": "2026-01-02",
            "officeAddress": "1 Main Street", "links": [{"url": URL, "label": "Yelp"}],
        }
        self.assert_invalid()
        self.receipt = fixture()[3]
        self.write_fixture()
        self.assertTrue(validator.validate(self.base, self.catalog)["valid"])

    def test_invalid_date_and_unknown_fields_fail(self):
        for field, value in (("checkedAt", "2026-02-30"), ("score", 8)):
            with self.subTest(field=field):
                self.reviewed = fixture()[1]
                self.reviewed[PID][field] = value
                self.assert_invalid()

    def test_cli_failure_is_json_and_does_not_leak_input_content(self):
        (self.base / "review-links.json").write_text('{"private narrative": invalid JSON}')
        result = subprocess.run([
            sys.executable, "-B", str(HERE / "validate.py"), "--directory", str(self.base),
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)["valid"])
        self.assertNotIn("private narrative", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
