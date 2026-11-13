import importlib.util
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("review_catalog", Path(__file__).with_name("review-catalog.py"))
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)
URL = "https://www.mylivingchoice.com/property/example"
TARGET = {"providerId": "cms-315001", "id": "source", "url": URL,
          "identity": {"address": "1 Main Street", "city": "Union"}}


def fetched(body="", tail="", count=39, url=URL, review_id="CiOriginal"):
    return {
        "requestedUrl": url, "effectiveUrl": url, "checkedAt": "2026-11-12",
        "metadata": {"statusCode": 200},
        "markdown": (
            "# Example\n\n[1 Main Street, Union, New Jersey](https://example.org)\n\n"
            "## Reviews of Example\n\n4.6overall · 39 ratings combined\n\n"
            f"4.6★ on Google ({count})\n\n"
            "Private Author\n\nJul 2026\n\n"
            f"[via Google ↗](https://www.google.com/maps/reviews/data=!1s{review_id}!2m1!1s0x1:0x2)"
            "· [Report](https://www.mylivingchoice.com/reviews/report/external/123)\n\n"
            + body + "\n\n" + tail + "\n\n## Request information\n\nNo review here"
        ),
    }


class CatalogTests(unittest.TestCase):
    def test_retains_links_dates_ids_without_author_or_narratives(self):
        result = catalog.parse_page(fetched("Private medical narrative. A private telephone."), TARGET)
        encoded = json.dumps(result)
        self.assertNotIn("Private Author", encoded)
        self.assertNotIn("Private medical", encoded)
        self.assertNotIn("telephone", encoded)
        self.assertEqual(result["rows"][0]["date"], "2026-07")
        self.assertEqual(result["rows"][0]["nativeId"], "123")
        self.assertEqual(result["reportedCount"], 39)
        self.assertEqual(result["stopReason"], "no-public-next-link")

    def test_ignores_automated_summaries_and_nearby_listing_counts(self):
        r = fetched()
        r["markdown"] = r["markdown"].replace("## Reviews of Example", "## Automated summary\n\n999 Google reviews\n\n## Reviews of Example")
        self.assertEqual(catalog.parse_page(r, TARGET)["reportedCount"], 39)

    def test_follows_only_explicit_public_same_location_next_links(self):
        result = catalog.parse_page(fetched(tail=f"[Next]({URL}?page=2)"), TARGET)
        self.assertEqual(result["nextUrls"], [URL + "?page=2"])
        for href in ["/api/reviews/123", "https://attacker.example/property/example", "/property/different?page=2",
                     URL + "?page=21", URL + "?token=secret"]:
            r = catalog.parse_page(fetched(tail=f"[Next]({href})"), TARGET)
            self.assertEqual(r["nextUrls"], [])
            self.assertEqual(r["stopReason"], "pagination-outside-permitted-location")

    def test_numbered_public_pages_are_followed_without_backtracking(self):
        tail = f"[1]({URL}) [2]({URL}?page=2) [3]({URL}?page=3)"
        self.assertEqual(catalog.parse_page(fetched(tail=tail), TARGET)["nextUrls"],
                         [URL + "?page=2", URL + "?page=3"])
        tail = f"[1]({URL}) [2]({URL}?page=2) [3]({URL}?page=3)"
        result = catalog.parse_page(fetched(tail=tail, url=URL + "?page=2"), TARGET)
        self.assertEqual(result["nextUrls"], [URL + "?page=3"])
        self.assertFalse(catalog.allowed_page(URL + "?page=2&token=", URL))

    def test_partly_unparsed_population_is_a_limit_not_exhaustion(self):
        r = fetched(tail="[Report](https://www.mylivingchoice.com/reviews/report/external/999)")
        result = catalog.parse_page(r, TARGET)
        self.assertEqual(result["stopReason"], "review-parser-mismatch")

    def test_saved_receipts_cannot_transfer_an_original_account_between_providers(self):
        original = catalog.parse_page(fetched(), TARGET)
        target = {**TARGET, "permitted": True}
        for field, value in [("providerId", "cms-225001"), ("sourceId", "other-source"),
                             ("requestedUrl", URL + "-other")]:
            receipt = copy.deepcopy(original)
            receipt[field] = value
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                work = Path(directory)
                catalog.write(work / "pages/receipt.json", receipt)
                with patch.object(catalog, "WORK", work):
                    with self.assertRaisesRegex(ValueError, "mismatched provider, source or URL"):
                        catalog.load_pages({"targets": [target]})

    def test_receipts_reject_raw_body_fields_and_non_review_links(self):
        original = catalog.parse_page(fetched(), TARGET)
        for field, value in [("body", "private narrative"), ("url", "https://www.google.com/maps/contrib/123"),
                             ("nativeId", "invented"), ("date", "2026-99")]:
            receipt = copy.deepcopy(original)
            receipt["rows"][0][field] = value
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                work = Path(directory)
                catalog.write(work / "pages/receipt.json", receipt)
                with patch.object(catalog, "WORK", work), self.assertRaises(ValueError):
                    catalog.load_pages({"targets": [{**TARGET, "permitted": True}]})

    def test_wrong_location_redirect_and_failed_fetch_do_not_acquire_rows(self):
        cases = [
            {**fetched(), "effectiveUrl": URL + "-wrong"},
            {**fetched(), "metadata": {"statusCode": 403}},
            {**fetched(), "markdown": fetched()["markdown"].replace("1 Main Street", "999 Other Road")},
        ]
        for result in cases:
            self.assertEqual(catalog.parse_page(result, TARGET)["rows"], [])

    def test_professional_account_is_explicitly_excluded(self):
        r = catalog.parse_page(fetched("I work at this business."), TARGET)
        self.assertTrue(r["rows"][0]["exclusionReasons"])

    def test_original_google_identity_survives_different_wrappers(self):
        a = "https://www.google.com/maps/reviews/data=!4m6!1sCiOriginal!2m1!1s0x1:0x2"
        b = "https://www.google.com/maps/reviews/data=!4m8!1sCiOriginal!2m1!1s0x0:0x2?hl=en"
        self.assertEqual(catalog.canonical_review(a), catalog.canonical_review(b))
        self.assertNotEqual(catalog.canonical_review(a), catalog.canonical_review(a.replace("CiOriginal", "CiOther")))

    def test_date_precision_is_not_invented(self):
        for value, expected in [(None, "unknown"), ("2026", "year"), ("2026-07", "month"), ("2026-07-03", "day")]:
            self.assertEqual(catalog.precision(value), expected)
        for value in ["2026-13", "2026-02-30"]:
            with self.assertRaises(ValueError):
                catalog.precision(value)

    def test_pagination_reaches_total_without_guessing_more_pages(self):
        first = catalog.parse_page(fetched(tail=f"[Next]({URL}?page=2)", count=2), TARGET)
        second = catalog.parse_page(fetched(count=2, url=URL + "?page=2", review_id="CiSecond"), TARGET)
        pages, pending, stop = catalog.crawl_state(TARGET, {URL: first, URL + "?page=2": second})
        self.assertEqual(len(pages), 2)
        self.assertEqual(pending, [])
        self.assertEqual(stop, "reported-total-reached")

    def test_pending_page_and_repeated_ids_have_explicit_end_conditions(self):
        first = catalog.parse_page(fetched(tail=f"[Next]({URL}?page=2)"), TARGET)
        self.assertEqual(catalog.crawl_state(TARGET, {URL: first})[1], [URL + "?page=2"])
        second = catalog.parse_page(fetched(url=URL + "?page=2", tail=f"[Next]({URL}?page=3)"), TARGET)
        self.assertEqual(catalog.crawl_state(TARGET, {URL: first, URL + "?page=2": second})[2], "no-new-review-ids")

    def test_repeated_content_url_errors_and_page_cap_are_not_exhaustion(self):
        first = catalog.parse_page(fetched(tail=f"[Next]({URL}?page=2)"), TARGET)
        second = {**first, "requestedUrl": URL + "?page=2"}
        self.assertEqual(catalog.crawl_state(TARGET, {URL: first, URL + "?page=2": second})[2], "repeated-page-content")
        first["nextUrls"] = [URL]
        self.assertEqual(catalog.crawl_state(TARGET, {URL: first})[2], "repeated-url")
        first["nextUrls"] = [URL + "?page=2"]
        second["stopReason"] = "fetch-error"
        self.assertEqual(catalog.crawl_state(TARGET, {URL: first, URL + "?page=2": second})[2], "fetch-error")
        chain = {}
        for n in range(1, 22):
            u = URL if n == 1 else URL + f"?page={n}"
            chain[u] = {"requestedUrl": u, "pageSha256": str(n), "stopReason": None,
                        "reportedCount": 100, "rows": [{"url": f"https://example.org/review/{n}"}],
                        "nextUrls": [URL + f"?page={n+1}"]}
        pages, pending, stop = catalog.crawl_state(TARGET, chain)
        self.assertEqual(len(pages), 20)
        self.assertEqual(pending, [])
        self.assertEqual(stop, "page-limit")

    def test_real_released_replay_has_no_raw_text_fields(self):
        plan = catalog.plan()
        pages = {p["requestedUrl"]: p for path in (catalog.WORK / "pages").glob("*.json") for p in [catalog.read(path)]}
        output, coverage = catalog.build(plan, pages)
        for record in output.values():
            ids = [a["id"] for a in record["accounts"]]
            self.assertEqual(len(ids), len(set(ids)))
            for a in record["accounts"]:
                if a["representation"] == "link-only":
                    self.assertIsNone(a["excerpt"])
                    self.assertIsNone(a["summary"])
                else:
                    if a["representation"] == "original-summary":
                        self.assertEqual(record["providerId"], "cms-315120")
                        self.assertIsNone(a["excerpt"])
                        self.assertLessEqual(len(a["summary"]), 240)
                        continue
                    self.assertEqual(a["representation"], "reviewed-excerpt")
                    if a["provenance"] == "new-public-page":
                        self.assertIsNone(a["excerpt"])
                        self.assertTrue(a["summary"])
                        self.assertLessEqual(len(a["summary"]), 240)
                    else:
                        self.assertEqual(a["provenance"], "retained-reviewed")
                        self.assertLessEqual(len(a["excerpt"]), 240)
            for source in record["sources"]:
                self.assertEqual(source["retainedCount"], sum(a["sourceId"] == source["id"] for a in record["accounts"]))
            self.assertEqual(len(record["sources"]), len({s["id"] for s in record["sources"]}))
        self.assertTrue(any(c["market"] == "massachusetts" for c in coverage))
        self.assertTrue(any(c["market"] != "massachusetts" for c in coverage))


if __name__ == "__main__":
    unittest.main()
