#!/usr/bin/env python3
"""Original excerpt validation and normal release integration with synthetic public text."""

import copy
from html import escape
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


base = load("excerpt_release_fixtures", "release-reviews-test.py")
release = base.release
normalizer = load("excerpt_normalizer", "normalize-nj.py")
builder = load("excerpt_builder", "build-region.py")


class ExcerptTests(unittest.TestCase):
    def setUp(self):
        self.fixture = base.ReleaseTests(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.path = release.EXCERPTS.as_posix()
        self.capture = "research/north-jersey/review-excerpts/captures/example.md"
        self.receipt = self.capture + ".receipt.json"
        self.row = {
            "id": "row-positive", "articleId": "article-1",
            "reviewUrl": None, "publishedAt": None, "role": "unknown",
            "sentiment": "positive", "experienceStage": "unknown",
            "originalExcerpt": "The common areas were clean and welcoming.",
            "paraphrase": "The reviewer describes welcoming common areas.",
            "exclusionReasons": [], "privacyRelease": {
                "reviewed": True, "containsNames": False, "containsMedicalInformation": False,
                "containsIdentifiers": False, "publicConsumerReview": True,
            },
        }
        self.bodies = {"row-positive": "The common areas were clean and welcoming."}
        self.page = {
            "id": "example-page", "providerId": "cms-315488", "officialId": "NJ60921",
            "source": "MyLivingChoice", "sourceFamily": "google", "url": self.fixture.url,
            "checkedAt": "2026-11-12",
            "identity": {**self.fixture.approval["identity"], "zip": "07960"},
            "retainedPage": {}, "receipt": {},
            "population": {"scope": "all-review-rows-in-retained-page", "complete": True,
                           "retainedRowCount": 1}, "rows": [self.row],
        }
        self.document = {"schemaVersion": 1, "assessmentDate": "2026-11-12", "pages": [self.page]}
        self.fixture.write("research/north-jersey/reviews/source-access.json", {
            "sources": [{"source": "MyLivingChoice", "access_decision": "permitted_low_volume",
                         "terms_url": "https://www.mylivingchoice.com/terms-of-service"}],
        })
        self.capture_input()

    def capture_input(self):
        for page in self.document["pages"]:
            text = "<html><body><h1>" + escape(page["identity"]["name"]) + "</h1><p>"
            text += escape(" ".join(str(v) for v in page["identity"].values())) + "</p>"
            for index, row in enumerate(page["rows"], 1):
                row["articleId"] = f"article-{index}"
                text += '<article><p class="author">Unreleased author sentinel</p>'
                text += '<a href="/reviews/report/external/' + str(1000 + index) + '">Report</a>'
                if row["publishedAt"]:
                    text += '<time datetime="' + escape(row["publishedAt"]) + '"></time>'
                if row["reviewUrl"]:
                    text += '<a href="' + escape(row["reviewUrl"]) + '">Google</a>'
                text += '<p class="mt-3 text-sm leading-6 text-stone-600">'
                text += escape(self.bodies[row["id"]]) + "</p></article>"
            text += "</body></html>"
            capture = self.capture if page is self.page else self.capture + "." + page["id"]
            receipt = capture + ".receipt.json"
            self.fixture.write(capture, text)
            page["retainedPage"] = self.fixture.reference(capture)
            self.fixture.write(receipt, {
                "url": page["url"], "observedAt": page["checkedAt"] + "T12:00:00+00:00", "httpStatus": 200,
                "source": page["source"], "sha256": page["retainedPage"]["sha256"],
                "bytes": len(text.encode()), "status": "candidate",
            })
            page["receipt"] = self.fixture.reference(receipt)
            page["population"]["retainedRowCount"] = len(page["rows"])
        self.write_input()

    def write_input(self):
        self.fixture.write(self.path, self.document)

    def replace_capture(self, old, new):
        text = (self.root / self.capture).read_text().replace(old, new)
        self.fixture.write(self.capture, text)
        self.page["retainedPage"] = self.fixture.reference(self.capture)
        receipt = json.loads((self.root / self.receipt).read_bytes())
        receipt.update(sha256=self.page["retainedPage"]["sha256"], bytes=len(text.encode()))
        self.fixture.write(self.receipt, receipt)
        self.page["receipt"] = self.fixture.reference(self.receipt)

    def build(self, approvals=None):
        self.write_input()
        return self.fixture.build(approvals)

    def assert_fails(self, message):
        with self.assertRaisesRegex(release.ReleaseError, message):
            self.build()

    def selected(self, output):
        return output["locationResearch.json"]["cms-315488"]["reviews"]

    def add_row(self, row_id, text, sentiment="positive", published=None):
        row = {**copy.deepcopy(self.row), "id": row_id,
               "originalExcerpt": text, "sentiment": sentiment, "publishedAt": published}
        self.bodies[row_id] = text
        self.page["rows"].append(row)
        return row

    def test_visible_sample_precedes_editorial_highlight_selection(self):
        older = self.add_row("older-positive", "The meals were good.", published="2025-02")
        staff = self.add_row("employee", "Staff statement.", published="2025-01")
        staff.update(role="staff", sentiment="unknown", originalExcerpt=None, paraphrase=None,
                     exclusionReasons=["not-consumer"])
        staff["privacyRelease"]["publicConsumerReview"] = False
        self.capture_input()
        record = self.build()["locationResearch.json"]["cms-315488"]
        sample, = record["reviewSamples"]
        self.assertEqual(sample["sourceId"], record["reviewAggregates"][0]["sourceId"])
        self.assertEqual((sample["selection"], sample["visibleCount"]), ("all-visible-before-highlighting", 3))
        self.assertEqual({r["id"] for r in sample["observations"]}, {self.row["id"], older["id"]})
        self.assertIn({"id": older["id"], "date": "2025-02", "sentiment": "positive"}, sample["observations"])
        self.assertEqual(len(record["reviews"]), 1)

    def test_original_and_paraphrase_remain_distinct_and_unscored(self):
        output = self.build()
        review = self.selected(output)[0]
        self.assertEqual(review["excerpt"], self.row["originalExcerpt"])
        self.assertEqual(review["summary"], self.row["paraphrase"])
        self.assertEqual(review["date"], self.row["publishedAt"])
        self.assertIsNone(review["rating"])
        before = output["experience-verification.json"]["approvedInput"]["cms-315488"]
        after = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        for key in ("value", "reviewCount", "platformCount", "independentSourceCount", "includedSources"):
            self.assertEqual(before[key], after[key])
        metadata = output["excerpt-audit.json"]["rows"][0]
        self.assertEqual(metadata["sourceFamily"], "google")
        self.assertEqual(metadata["retainedPage"], self.page["retainedPage"])
        self.assertEqual(metadata["identity"]["careUnit"], self.page["identity"]["careUnit"])
        self.assertFalse(any("research/" in note or note.startswith("{") for note in review["notes"]))
        builder.LOCATION(output["locationResearch.json"]["cms-315488"], "research")

    def test_excerpt_only_provider_stays_unrated(self):
        output = self.build([])
        self.assertEqual(len(self.selected(output)), 1)
        score = output["experience-verification.json"]["releasedOutput"]["cms-315488"]
        self.assertIsNone(score["value"])
        self.assertEqual(score["reviewCount"], 0)
        self.assertEqual(score["independentSourceCount"], 0)

    def test_paraphrase_cannot_replace_original(self):
        self.row["originalExcerpt"] = self.row["paraphrase"]
        self.assert_fails("quoted substring")

    def test_forged_quote_and_injected_body_fail(self):
        self.row["originalExcerpt"] = "Invented praise."
        self.assert_fails("quoted substring")
        self.row["text"] = "Invented praise."
        self.assert_fails("Malformed excerpt candidate")

    def test_only_whitespace_normalization_is_allowed(self):
        self.row["originalExcerpt"] = "The common areas\nwere clean and welcoming."
        self.assertEqual(self.selected(self.build())[0]["excerpt"], self.bodies[self.row["id"]])
        self.row["originalExcerpt"] = "The common areas were clean & welcoming."
        self.assert_fails("quoted substring")

    def test_visible_html_entities_and_line_breaks_preserve_original_words(self):
        self.bodies[self.row["id"]] = "The lounge was clean & welcoming. It was bright."
        self.row["originalExcerpt"] = self.bodies[self.row["id"]]
        self.capture_input()
        self.replace_capture("The lounge was clean &amp; welcoming. It was bright.",
                             "The lounge&nbsp;was clean &amp; welcoming.<br>It was bright.")
        self.assertEqual(self.selected(self.build())[0]["excerpt"], self.row["originalExcerpt"])

    def test_length_and_word_caps_include_boundaries(self):
        for quote, valid in [
            ("a" * 240, True), ("a" * 241, False),
            (" ".join(["a"] * 40), True), (" ".join(["a"] * 41), False),
        ]:
            with self.subTest(characters=len(quote), words=len(quote.split())):
                self.bodies[self.row["id"]] = self.row["originalExcerpt"] = quote
                self.capture_input()
                if valid:
                    self.assertEqual(self.selected(self.build())[0]["excerpt"], quote)
                else:
                    self.assert_fails("exceeds cap")

    def test_forbidden_source_and_unestablished_family_fail(self):
        self.page["source"] = "Caring.com"
        self.assert_fails("Forbidden excerpt source")
        self.page["source"] = "MyLivingChoice"
        self.page["sourceFamily"] = "independent-mylivingchoice"
        self.assert_fails("family is not established")

    def test_policy_denial_overrides_claimed_public_access(self):
        for changes in [
            {"access_decision": "restricted_no_automation"},
            {"access_decision": "permitted_low_volume", "retain_as_eligible": False},
        ]:
            self.fixture.write("research/north-jersey/reviews/source-access.json", {
                "sources": [{"source": "MyLivingChoice", **changes}],
            })
            self.assert_fails("Forbidden excerpt source")

    def test_source_host_identity_and_care_unit_fail_closed(self):
        original = copy.deepcopy(self.page)
        for key, value, message in [
            ("url", "https://forged.example/reviews", "host mismatch"),
            ("providerId", "cms-000000", "Unknown runtime identity"),
            ("officialId", "NJ99999", "official identity"),
        ]:
            self.page[key] = value
            self.assert_fails(message)
            self.page[key] = original[key]
        self.page["identity"]["careUnit"] = "Assisted Living"
        self.assert_fails("care unit mismatch")

    def test_capture_hash_receipt_and_identity_evidence_are_checked(self):
        self.fixture.write(self.capture, "changed private capture")
        self.assert_fails("hash drift")
        self.capture_input()
        receipt = json.loads((self.root / self.receipt).read_bytes())
        receipt["httpStatus"] = 403
        self.fixture.write(self.receipt, receipt)
        self.page["receipt"] = self.fixture.reference(self.receipt)
        self.assert_fails("receipt mismatch")
        self.capture_input()
        body = (self.root / self.capture).read_text().replace("151 Madison Avenue", "999 Other Road")
        self.fixture.write(self.capture, body)
        self.page["retainedPage"] = self.fixture.reference(self.capture)
        receipt["httpStatus"] = 200
        receipt["sha256"] = self.page["retainedPage"]["sha256"]
        receipt["bytes"] = len(body.encode())
        self.fixture.write(self.receipt, receipt)
        self.page["receipt"] = self.fixture.reference(self.receipt)
        self.assert_fails("identity evidence")

    def test_population_completeness_and_candidate_fields_are_required(self):
        self.page["population"]["retainedRowCount"] = 2
        self.assert_fails("Incomplete excerpt candidate population")
        self.page["population"]["retainedRowCount"] = 1
        self.page["population"]["complete"] = False
        self.assert_fails("Incomplete excerpt candidate population")
        self.page["population"]["complete"] = True
        self.row["originalExcerpt"] = None
        self.assert_fails("separate original excerpt and paraphrase")

    def test_omitted_visible_article_cannot_be_hidden_by_a_declared_count(self):
        self.add_row("another-row", "The entrance was tidy.")
        self.capture_input()
        self.page["rows"].pop()
        self.page["population"]["retainedRowCount"] = 1
        self.assert_fails("every retained article")

    def test_quotes_cannot_use_author_hidden_or_other_article_text(self):
        self.add_row("another-row", "The entrance was tidy.")
        self.capture_input()
        self.replace_capture("</article>", '<p hidden>Hidden invented praise.</p></article>')
        for quote in ["Unreleased author sentinel", "The entrance was tidy.", "Hidden invented praise."]:
            self.row["originalExcerpt"] = quote
            self.assert_fails("quoted substring")

    def test_recommended_location_text_cannot_replace_exact_page_heading(self):
        self.replace_capture("<h1>Example Home</h1>", "<h1>Unrelated Location</h1>")
        self.assert_fails("location heading mismatch")

    def test_original_permalink_is_bound_to_its_article(self):
        self.row["reviewUrl"] = "https://www.google.com/maps/reviews/data=original"
        self.capture_input()
        self.assertEqual(self.selected(self.build())[0]["url"], self.row["reviewUrl"])
        self.row["reviewUrl"] = "https://www.google.com/maps/reviews/data=forged"
        self.assert_fails("differs from original article")

    def test_month_precision_survives_without_an_invented_day(self):
        self.row["publishedAt"] = "2026-10"
        self.capture_input()
        output = self.build()
        review = self.selected(output)[0]
        self.assertEqual(review["date"], "2026-10")
        self.assertIn("Published month 2026-10.", review["notes"])
        self.assertEqual(output["excerpt-audit.json"]["rows"][0]["publishedAt"], "2026-10")
        self.row["publishedAt"] = "2026-10-01"
        self.assert_fails("precision differs")

    def test_builder_preserves_month_precision_in_review_dates(self):
        sample = {"reviewSamples": [{"observations": [{"date": "2026-10"}]}]}
        builder.dates(sample, "2026-11-12", "research")
        builder.dates({"reviews": [{"date": "2026-10"}]}, "2026-11-12", "research")
        with self.assertRaisesRegex(ValueError, "source date after snapshot"):
            builder.dates(sample, "2026-09-30", "research")
        with self.assertRaisesRegex(ValueError, "invalid calendar date"):
            builder.dates({"reviewSamples": [{"observations": [{"date": "2026-13"}]}]},
                          "2026-11-12", "research")

    def test_public_receipt_without_raw_html_rejects_changed_identity_and_fragment(self):
        inputs = release.Inputs(release.ROOT)
        document = inputs.json(release.EXCERPTS.as_posix())
        index = inputs.json((release.EXCERPTS.parent / "source-checks-manifest.json").as_posix())
        page = document["pages"][0]
        ref = index["pages"][page["id"]]
        articles = release.public_excerpt_articles(inputs, page, ref)
        self.assertEqual(len(articles), page["population"]["retainedRowCount"])
        self.assertNotIn(page["retainedPage"]["path"], inputs.bytes)
        for field, value in (("id", "mlc-external-wrong"), ("originalExcerpt", "Unverified text"),
                             ("publishedAt", "1900-01"), ("reviewUrl", "https://example.com/unverified")):
            changed = copy.deepcopy(page)
            changed["rows"][0][field] = value
            with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                release.public_excerpt_articles(inputs, changed, ref)
        with self.assertRaises(release.ReleaseError):
            release.public_excerpt_articles(inputs, page, {**ref, "sha256": "0" * 64})

    def test_unknown_dates_remain_unknown_and_future_dates_fail(self):
        self.row["publishedAt"] = "2026-12"
        self.assert_fails("Invalid review published date")
        self.row["publishedAt"] = "not-a-date"
        self.assert_fails("Invalid review published date")

    def test_null_observed_zip_uses_official_care_unit_without_inventing_observation(self):
        self.page["identity"]["zip"] = None
        self.capture_input()
        output = self.build()
        self.assertIsNone(output["excerpt-audit.json"]["rows"][0]["identity"]["zip"])
        self.assertEqual(len(self.selected(output)), 1)

    def test_excluded_aggregate_does_not_delete_valid_original_excerpt(self):
        self.fixture.observation["aggregate"]["scope"] = "staff"
        self.fixture.approval["aggregate"]["scope"] = "staff"
        self.fixture.update_observation()
        output = self.build()
        self.assertEqual(len(self.selected(output)), 1)
        self.assertEqual(output["locationResearch.json"]["cms-315488"]["reviewAggregates"], [])
        self.assertEqual(output["experience-verification.json"]["releasedOutput"]["cms-315488"]["reviewCount"], 0)

    def test_newest_per_stratum_uses_every_eligible_retained_row(self):
        self.add_row("old-positive", "The gardens were pleasant.", published="2026-09-01")
        self.add_row("new-positive", "The lounge was welcoming.", published="2026-11-01")
        self.add_row("critical-row", "The reception was unhelpful.", "critical", "2026-10-01")
        self.add_row("mixed-row", "The lobby was tidy but noisy.", "mixed", "2026-08-01")
        self.capture_input()
        output = self.build()
        selected = {r["id"] for r in self.selected(output)}
        self.assertEqual(selected, {"review-excerpt-new-positive", "review-excerpt-critical-row",
                                    "review-excerpt-mixed-row"})
        rows = {r["rowId"]: r for r in output["excerpt-audit.json"]["rows"]}
        self.assertEqual(rows["row-positive"]["selection"]["rank"], 3)
        self.assertEqual(rows["old-positive"]["reasons"], ["older-in-stratum"])

    def test_selection_is_global_across_pages_and_stable_on_ties(self):
        page = copy.deepcopy(self.page)
        page.update(id="another-page", url=self.fixture.url + "-second")
        page["rows"][0].update(id="aaa-positive",
                               originalExcerpt="The entrance was welcoming.")
        self.bodies["aaa-positive"] = "The entrance was welcoming."
        self.document["pages"].append(page)
        self.capture_input()
        first = self.build()
        self.assertEqual(self.selected(first)[0]["id"], "review-excerpt-aaa-positive")
        self.document["pages"].reverse()
        self.page["rows"].reverse()
        again = self.build()
        self.assertEqual(first["locationResearch.json"], again["locationResearch.json"])
        self.assertEqual(first["excerpt-audit.json"], again["excerpt-audit.json"])

    def test_privacy_and_excluded_rows_never_leak_full_capture_text(self):
        private = self.add_row("excluded-row", "Private capture sentinel, do not publish.")
        private.update(originalExcerpt=None, paraphrase=None, exclusionReasons=["privacy"])
        private["privacyRelease"]["containsNames"] = True
        self.capture_input()
        output = self.build()
        self.assertNotIn("Private capture sentinel", release.encoded(output).decode())
        row = next(r for r in output["excerpt-audit.json"]["rows"] if r["rowId"] == "excluded-row")
        self.assertEqual(row["disposition"], "excluded")
        self.assertEqual(row["reasons"], ["privacy"])
        self.assertNotIn("Unreleased author sentinel", release.encoded(output).decode())
        self.row["privacyRelease"]["containsNames"] = True
        self.assert_fails("privacy release attestation")

    def test_obvious_identifiers_and_medical_information_fail_screening(self):
        for text in ["Email person@example.test for details.", "Call 555-123-4567 for details.",
                     "The medication was changed.", "The cancer treatment was discussed."]:
            self.bodies[self.row["id"]] = self.row["originalExcerpt"] = text
            self.capture_input()
            self.assert_fails("privacy screening")

    def test_role_and_stage_use_reviewed_vocabulary_and_staff_rows_are_excluded(self):
        self.row["role"] = "invented"
        self.assert_fails("Unsupported excerpt role")
        self.row["role"] = "unknown"
        self.row["experienceStage"] = "resident-family"
        self.assert_fails("Unsupported excerpt role")
        self.row["role"] = "staff"
        self.row["experienceStage"] = "unknown"
        self.assert_fails("Staff review requires exclusion")
        self.row["exclusionReasons"] = ["not-consumer"]
        self.row["originalExcerpt"] = self.row["paraphrase"] = None
        self.assertEqual(self.build()["locationResearch.json"]["cms-315488"]["reviews"], [])

    def test_duplicates_do_not_compete_as_independent_candidates(self):
        duplicate = copy.deepcopy(self.row)
        duplicate["id"] = "duplicate-row"
        self.bodies["duplicate-row"] = self.bodies[self.row["id"]]
        self.page["rows"].append(duplicate)
        self.capture_input()
        self.assert_fails("Duplicate eligible review body")
        duplicate["exclusionReasons"] = ["duplicate-review"]
        duplicate["originalExcerpt"] = duplicate["paraphrase"] = None
        output = self.build()
        self.assertEqual(len(self.selected(output)), 1)
        self.assertEqual(len(output["excerpt-audit.json"]["rows"]), 2)

    def test_repeat_runs_are_byte_identical_and_all_new_inputs_are_hashed(self):
        first, second = self.build(), self.build()
        self.assertEqual(release.encoded(first), release.encoded(second))
        paths = {r["path"] for r in first["manifest.json"]["inputs"]}
        self.assertTrue({self.path, self.capture, self.receipt,
                         "research/north-jersey/reviews/source-access.json"} <= paths)
        self.assertEqual(first["manifest.json"]["outputs"]["excerpt-audit.json"],
                         release.digest(release.encoded(first["excerpt-audit.json"])))

    def test_optional_input_removal_releases_no_stale_excerpts_or_audit_rows(self):
        self.build()
        self.assertEqual(self.fixture.cli().returncode, 0)
        (self.root / self.path).unlink()
        self.assertEqual(self.fixture.cli().returncode, 0)
        record = json.loads((self.root / release.RELEASE / "locationResearch.json").read_bytes())
        audit = json.loads((self.root / release.RELEASE / "excerpt-audit.json").read_bytes())
        self.assertEqual(record["cms-315488"]["reviews"], [])
        self.assertEqual(audit["rows"], [])

    def test_normal_release_cli_normalizer_merge_and_region_build_preserve_original(self):
        self.build()
        result = self.fixture.cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.fixture.cli("--check").returncode, 0)
        self.fixture.write("research/north-jersey/offerings/locationResearch.json", {})
        self.fixture.write("research/north-jersey/review-excerpts/reviewed.json", {})
        self.fixture.write("research/north-jersey/offerings/manifest.json", {
            "outputs": {"locationResearch.json": {"sha256": release.digest(release.encoded({}))}},
        })
        roster = {"cms-315488": {"county": "Morris"}}
        merged = normalizer.released_research(
            normalizer.Inputs(self.root / release.REGION), roster, ("Morris",))
        builder.LOCATION(merged["cms-315488"], "locationResearch")
        files, manifest = normalizer.normalize(normalizer.RESEARCH, normalizer.COUNTIES)
        research = json.loads(files["locationResearch.json"])
        research["cms-315488"] = merged["cms-315488"]
        files["locationResearch.json"] = normalizer.encode(research)
        ref = manifest["markets"][0]["artifacts"]["locationResearch"]
        ref.update(sha256=normalizer.digest(files["locationResearch.json"]), count=len(research))
        markets = normalizer.validate_release(files, manifest)
        actual = markets[0]["locationResearch"]["cms-315488"]["reviews"][0]
        self.assertEqual(actual["excerpt"], self.row["originalExcerpt"])
        self.assertEqual(actual["summary"], self.row["paraphrase"])


class FetchUrlTests(unittest.TestCase):
    def setUp(self):
        self.context = ExcerptTests(methodName="runTest")
        self.context.setUp()
        self.addCleanup(self.context.doCleanups)
        self.context.row.update(publishedAt="2026-10",
                                reviewUrl="https://www.google.com/maps/reviews/data=first")

    def capture(self):
        ctx = self.context
        lines = ["# " + ctx.page["identity"]["name"],
                 " ".join(str(v) for v in ctx.page["identity"].values()),
                 "## AI Summary", "Summary sentinel that is not a review.",
                 "## Reviews of " + ctx.page["identity"]["name"],
                 "Summary inside reviews is not original text."]
        for index, row in enumerate(ctx.page["rows"], 1):
            row["articleId"] = f"article-{index}"
            month = row["publishedAt"] or "2026-10"
            month = release.date.fromisoformat(month + "-01").strftime("%b %Y")
            lines.extend(["![](https://lh3.googleusercontent.com/a/fixture)",
                          "Unreleased author sentinel", month,
                          f'[via Google ↗]({row["reviewUrl"]})· '
                          f'[Report](https://www.mylivingchoice.com/reviews/report/external/{1000 + index})',
                          ctx.bodies[row["id"]]])
        lines.extend(["## FAQ", "FAQ sentinel that is not original text."])
        self.fetched = {"markdown": "\n\n".join(lines), "effectiveUrl": ctx.page["url"],
                        "metadata": {"url": ctx.page["url"], "statusCode": 200, "error": None}}
        ctx.page["population"]["retainedRowCount"] = len(ctx.page["rows"])
        self.save()

    def save(self):
        ctx = self.context
        text = json.dumps(self.fetched)
        ctx.fixture.write(ctx.capture, text)
        ctx.page["retainedPage"] = ctx.fixture.reference(ctx.capture)
        ctx.fixture.write(ctx.receipt, {
            "url": ctx.page["url"], "observedAt": ctx.page["checkedAt"] + "T12:00:00+00:00",
            "httpStatus": 200, "source": ctx.page["source"], "sha256": release.digest(text.encode()),
            "bytes": len(text.encode()), "format": "fetchurl-json",
        })
        ctx.page["receipt"] = ctx.fixture.reference(ctx.receipt)

    def test_real_json_format_is_auto_detected_and_multiline_is_verbatim(self):
        ctx = self.context
        ctx.bodies[ctx.row["id"]] = "The common areas\nwere clean and welcoming.\nThe lounge was bright."
        self.capture()
        output = ctx.build()
        self.assertEqual(ctx.selected(output)[0]["excerpt"], ctx.row["originalExcerpt"])
        self.assertEqual(output["excerpt-audit.json"]["rows"][0]["sourceReviewId"], "1001")
        self.assertEqual(output["excerpt-audit.json"]["rows"][0]["publishedAt"], "2026-10")

    def test_only_original_body_can_supply_a_quote(self):
        self.capture()
        for text in ["Unreleased author sentinel", "Summary sentinel that is not a review.",
                     "Summary inside reviews is not original text.", "FAQ sentinel that is not original text."]:
            with self.subTest(text=text):
                self.context.row["originalExcerpt"] = text
                self.context.assert_fails("quoted substring")

    def test_malformed_and_duplicate_blocks_fail_closed(self):
        self.capture()
        original = self.fetched["markdown"]
        for old, new in [
            ("[Report]", "[Flag]"), ("[via Google ↗]", "[Other]"),
            ("Oct 2026", "Invented date"), ("![](", "![missing]("),
            ("/external/1001", "/external/not-native"),
            ("## Reviews of Example Home", "## Reviews of Other Home"),
        ]:
            with self.subTest(old=old):
                self.fetched["markdown"] = original.replace(old, new)
                self.save()
                self.context.assert_fails("Markdown")

    def test_original_result_status_requested_and_effective_url_are_independent_of_receipt(self):
        self.capture()
        original = copy.deepcopy(self.fetched)
        for target, key, value in [
            ("metadata", "statusCode", 403), ("metadata", "statusCode", True),
            ("metadata", "error", "blocked"), ("metadata", "url", "https://example.test/other"),
            (None, "effectiveUrl", "https://www.mylivingchoice.com/property/other"),
        ]:
            with self.subTest(key=key, value=value):
                self.fetched = copy.deepcopy(original)
                (self.fetched[target] if target else self.fetched)[key] = value
                self.save()
                self.context.assert_fails("Unverified original FetchUrl")

    def test_missing_row_and_cross_review_link_swap_fail(self):
        ctx = self.context
        second = ctx.add_row("second-row", "The lounge was bright.", published="2026-09")
        second["reviewUrl"] = "https://www.google.com/maps/reviews/data=second"
        self.capture()
        first_url, second_url = ctx.row["reviewUrl"], second["reviewUrl"]
        ctx.row["reviewUrl"], second["reviewUrl"] = second_url, first_url
        ctx.assert_fails("differs from original article")
        ctx.row["reviewUrl"], second["reviewUrl"] = first_url, second_url
        ctx.page["rows"].pop()
        ctx.page["population"]["retainedRowCount"] = 1
        ctx.assert_fails("every retained article")

    def test_visible_empty_body_is_excluded_but_counted(self):
        ctx = self.context
        ctx.bodies[ctx.row["id"]] = ""
        ctx.row.update(originalExcerpt=None, paraphrase=None, exclusionReasons=["no-safe-excerpt"])
        self.capture()
        output = ctx.build()
        self.assertEqual(ctx.selected(output), [])
        self.assertEqual(output["excerpt-audit.json"]["rows"][0]["reasons"], ["no-safe-excerpt"])
        self.assertEqual(output["locationResearch.json"]["cms-315488"]["reviewSamples"][0]["visibleCount"], 1)
        ctx.row["exclusionReasons"] = ["privacy"]
        ctx.assert_fails("Empty original body")

    def test_capture_hash_and_separate_acquisition_receipt_are_required(self):
        self.capture()
        ctx = self.context
        ctx.fixture.write(ctx.capture, "{}")
        ctx.assert_fails("hash drift")
        self.save()
        ctx.page["receipt"] = ctx.page["retainedPage"]
        ctx.assert_fails("separate from capture")

    def test_body_links_are_preserved_without_rendering_or_rewording(self):
        ctx = self.context
        body = "The [common areas](https://example.test/lounge) were welcoming."
        ctx.bodies[ctx.row["id"]] = body
        ctx.row.update(originalExcerpt=None, paraphrase=None, exclusionReasons=["privacy"])
        self.capture()
        original = release.original_excerpt_articles(release.Inputs(ctx.root), ctx.page, "nursing-home")
        self.assertEqual(original["article-1"]["text"], body)

    def test_actual_retained_fetchurl_captures_read_only(self):
        expected = {
            "morristown-post-acute-rehab-and-nursing-center": ["608661", "608657", "608665", "608663", "608659"],
            "cornell-hall-care-rehabilitation-center": ["608546", "608549", "608547", "608548", "608550"],
        }
        for slug, native_ids in expected.items():
            with self.subTest(slug=slug):
                path = ROOT / release.REGION / "listing-index/raw" / f"excerpts-2026-11-12-fetchurl-{slug}.json"
                self.assertTrue(path.is_file())
                fetched = release.parse_json(path.read_bytes())
                markdown = fetched["markdown"]
                name = re.search(r"^## Reviews of (.+)$", markdown, re.M)[1]
                rows = release.markdown_excerpt_articles(markdown, name)
                self.assertEqual([r["sourceReviewId"] for r in rows.values()], native_ids)
                self.assertEqual(len(rows), 5)
                for row in rows.values():
                    self.assertRegex(row["publishedAt"], r"^\d{4}-\d{2}$")
                    self.assertIn(row["text"], release.normalized_whitespace(markdown))
                    self.assertIn(row["reviewUrl"], markdown)


if __name__ == "__main__":
    unittest.main()
