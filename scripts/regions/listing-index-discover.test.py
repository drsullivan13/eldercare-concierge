#!/usr/bin/env python3
"""Behavioral tests for offline sitemap discovery and retained page ingestion."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

SCRIPT = Path(__file__).with_name("listing-index-discover.py")
spec = importlib.util.spec_from_file_location("listing_discover", SCRIPT)
discover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(discover)
HOST = "https://www.mylivingchoice.com/property/"


class DiscoveryTests(unittest.TestCase):
    def test_concatenated_sitemap_dates_preserve_numeric_slugs(self):
        text = (HOST + "avenue-812026-10-14T07:33:30.052Zweekly" +
                HOST + "prn-care-home-22026-07-29T19:44:08Zweekly" +
                HOST + "home-20262026-11-12T00:00:00+00:00weekly")
        self.assertEqual(discover.property_urls(text),
                         [HOST + "avenue-81", HOST + "home-2026", HOST + "prn-care-home-2"])

    def test_markdown_xml_and_plain_urls(self):
        text = (f"[Example]({HOST}home-2) <loc>{HOST}home-3</loc> " +
                HOST + "home-4\n")
        self.assertEqual(discover.property_urls(text),
                         [HOST + "home-2", HOST + "home-3", HOST + "home-4"])

    def test_city_overlap_alone_is_not_a_name_match(self):
        provider = {"name": "Sunrise of Summit", "city": "Summit"}
        self.assertIsNone(discover.candidate_reason(provider, "addington-place-of-lees-summit"))
        self.assertIsNotNone(discover.candidate_reason(provider, "sunrise-of-summit"))
        self.assertIsNone(discover.candidate_reason(
            {"name": "Home Instead", "city": "Union"}, "home-instead-boston"))

    def test_long_names_without_city_are_only_candidates(self):
        provider = {"name": "Cornell Hall Care Rehabilitation Center", "city": "Union"}
        reason = discover.candidate_reason(provider, "cornell-hall-care-rehabilitation-center")
        self.assertIn("identity unverified", reason)

    def test_extracts_target_not_nearby_cms_or_reviewers(self):
        text = """# Target Care

[1600 US-22 Ste 301, Union, New Jersey](https://maps.example/)

## Quick Facts
Medicare rating3 of 5
## Types of Care at Target Care
Home Health
## Reviews of Target Care
4.9overall · 98 ratings combined
4.9★ on Google (98)
[Write a review](https://example.test)
Private Reviewer
I saw 1 out of 5 rating from 999 Google reviews.
## Frequently Asked Questions
Target Care carries a 4.9 out of 5 rating from 98 Google reviews.
## Compare with similar communities nearby
## Reviews of Other Care
4.2 out of 5 rating from 24 Google reviews.
"""
        page = discover.extract_page({"markdown": text, "retrievedAt": "2026-11-12"}, HOST + "target")
        self.assertEqual(page["identity"]["city"], "Union")
        self.assertEqual(page["identity"]["street"], "1600 US-22 Ste 301")
        self.assertEqual(page["identity"]["careUnitText"], "Home Health")
        self.assertFalse(page["identity"]["scopeConfirmed"])
        self.assertEqual({(r["value"], r["count"], r["family"]) for r in page["aggregates"]},
                         {(4.9, 98, "google")})
        self.assertNotIn("Private Reviewer", json.dumps(page))
        self.assertNotIn("I saw", json.dumps(page))

    def test_unattributed_combined_aggregate_keeps_null_family(self):
        result = discover.aggregates("## Reviews\n4.1overall · 149 ratings combined\n")
        self.assertEqual(result[0]["value"], 4.1)
        self.assertIsNone(result[0]["family"])
        self.assertIsNone(result[0]["syndicated"])
        self.assertEqual(discover.aggregates("# Target\n4.1(149 ratings)\n"), [])

    def test_office_scope_is_not_assumed_from_care_type(self):
        page = discover.extract_page({"markdown": """# Agency
[10 Main Street, Morristown, New Jersey](https://maps.example)
Office location: Morristown. Service area is Morris County.
## Types of Care at Agency
At-Home Care
"""}, HOST + "agency")
        self.assertIn("Morris County", page["identity"]["officeScope"])
        self.assertFalse(page["identity"]["scopeConfirmed"])
        self.assertIsNone(page["identity"]["careSetting"])
        self.assertIsNone(page["identity"]["zip"])

    def test_redirect_or_restriction_cannot_supply_aggregate(self):
        text = "# Target\n## Reviews\n4.9 out of 5 rating from 98 Google reviews.\n"
        for extra in [{"effectiveUrl": HOST + "other"},
                      {"metadata": {"statusCode": 403}}]:
            page = discover.extract_page({"markdown": text, **extra}, HOST + "target")
            self.assertEqual(page["aggregates"], [])

    def test_cli_queue_and_ingest_are_deterministic_and_schema_compatible(self):
        with tempfile.TemporaryDirectory(prefix="discover-test-") as directory:
            root = Path(directory)
            region = root / "research/north-jersey"
            discovery = root / discover.BASE / "discovery"
            discovery.mkdir(parents=True)
            (region / "runtime").mkdir()
            providers = [{"id": "m", "name": "Sunrise of Morristown", "city": "Morristown",
                          "category": "assisted-living", "locationKind": "facility"},
                         {"id": "u", "name": "HomeWell Care Services", "city": "Union",
                          "category": "home-care", "locationKind": "office"},
                         {"id": "e", "name": "Unlisted Example", "city": "Newark"}]
            (region / "runtime/providers.json").write_text(json.dumps(providers))
            (region / "runtime/crosswalk.json").write_text(json.dumps([
                {"providerId": p, "county": c, "status": "included"}
                for p, c in [("m", "Morris"), ("u", "Union"), ("e", "Essex")]]))
            for number in range(7):
                (discovery / f"properties-{number}.json").write_text(json.dumps({
                    "markdown": HOST + "sunrise-of-morristown2026-11-12T00:00:00Zweekly" +
                    HOST + "homewell-care-services-union2026-11-12T00:00:00Zweekly"}))
            (discovery / "nj-directory.json").write_text(json.dumps({
                "markdown": "[Union2](https://www.mylivingchoice.com/properties/best-senior-living/union/new-jersey)"}))
            def run(command):
                result = subprocess.run([sys.executable, "-B", str(SCRIPT), command,
                                         "--root", str(root), "--expected-count", "3"],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            run("queue")
            queue_path = root / discover.BASE / "discovery-queue.json"
            first = queue_path.read_bytes()
            run("queue")
            self.assertEqual(first, queue_path.read_bytes())
            queued = json.loads(first)
            self.assertEqual([r["county"] for r in queued["requests"]], ["Union", "Morris"])
            missing = next(r for r in queued["coverage"] if r["providerId"] == "e")
            self.assertEqual(missing["status"], "scoped_sitemap_no_hit")
            self.assertTrue(queued["coverage"][0]["cityDirectoryUrl"].endswith("/union/new-jersey"))
            pages = discovery / "pages"
            pages.mkdir()
            (pages / "homewell-care-services-union.json").write_text(json.dumps({
                "retrievedAt": "2026-11-12T00:00:00Z",
                "markdown": "# HomeWell Care Services\n[1600 US-22 Ste 301, Union, New Jersey](https://maps.example)\n"
                            "## Reviews\n4.9★ on Google (98)\n"}))
            run("ingest")
            output = json.loads((discovery / "normalized-observations.json").read_text())
            self.assertEqual(output["schemaVersion"], 1)
            self.assertEqual(len(output["observations"]), 3)
            obs = output["observations"][0]
            self.assertEqual(obs["providerId"], "u")
            self.assertEqual(obs["status"], "candidate")
            self.assertEqual(obs["aggregate"]["family"], "google")
            self.assertFalse(obs["identity"]["scopeConfirmed"])
            self.assertIsNone(output["observations"][1]["aggregate"])
            self.assertEqual(output["observations"][2]["status"], "unattempted")
            sibling_path = SCRIPT.with_name("listing-index.py")
            if sibling_path.exists():
                sibling_spec = importlib.util.spec_from_file_location("listing_index", sibling_path)
                sibling = importlib.util.module_from_spec(sibling_spec)
                sibling_spec.loader.exec_module(sibling)
                assessed = sibling.assess({
                    "name": "HomeWell Care Services",
                    "address": "1600 US-22 Ste 301 Union, NJ 07083",
                    "category": "home-care",
                }, obs, [], date(2026, 11, 12))
                self.assertEqual(assessed["status"], "candidate")
                self.assertFalse(assessed["harborEligibility"]["eligibleAggregate"])


class AssessmentTests(unittest.TestCase):
    def provider(self, **overrides):
        return {"id": "care", "name": "Exact Care", "address": "10 Main Street, Union, NJ 07083",
                "city": "Union", "state": "NJ", "zip": "07083", "category": "nursing-home",
                "locationKind": "facility", **overrides}

    def page(self, name="Exact Care", street="10 Main St", city="Union", state="New Jersey",
             postal="", care="Skilled Nursing / Long Term Care", extra="", **overrides):
        return discover.extract_page({
            "markdown": f"# {name}\n[{street}, {city}, {state}{postal}](https://maps.example)\n"
                        f"{extra}\n## Types of Care\n{care}\n"
                        "## Reviews\n4.2★ on Google (30)\n",
            "retrievedAt": "2026-11-12T00:00:00Z", "effectiveUrl": HOST + "unrelated-slug",
            **overrides,
        }, HOST + "unrelated-slug")

    def test_missing_published_zip_is_null_and_street_city_state_prove_identity(self):
        result = discover.page_assessment(self.provider(), self.page())
        self.assertEqual(result["status"], "exact")
        self.assertIsNone(result["identity"]["zip"])
        self.assertNotIn("address", result["identity"])
        self.assertEqual(result["identity"]["publishedAddress"], "10 Main St, Union, New Jersey")
        self.assertEqual(result["identity"]["careSetting"], "nursing-home")
        self.assertNotIn("07083", result["identity"]["evidence"])
        self.assertEqual(discover.page_assessment(
            self.provider(), self.page(postal=" 07083"))["status"], "exact")
        self.assertEqual(discover.page_assessment(
            self.provider(zip="07083-1234"), self.page(postal=" 07083"))["status"], "exact")

    def test_address_mismatch_never_promotes_even_with_exact_name(self):
        for override in [{"street": "11 Main Street"}, {"street": "10 Main St Ste 2"},
                         {"city": "Newark"}, {"state": "New York"}, {"postal": " 07084"}]:
            with self.subTest(override=override):
                result = discover.page_assessment(self.provider(), self.page(**override))
                self.assertEqual(result["status"], "candidate")
                self.assertFalse(result["identityChecks"]["address"])
        street_only = self.provider(address="10 Main Street")
        self.assertEqual(discover.page_assessment(street_only, self.page())["status"], "exact")

    def test_scope_requires_one_compatible_published_setting(self):
        for care in ["Assisted Living", "", "Skilled Nursing / Long Term CareAdult Day Care",
                     "Skilled Nursing / Long Term CareAssisted Living",
                     "Skilled Nursing / Long Term CareIndependent Living"]:
            with self.subTest(care=care):
                result = discover.page_assessment(self.provider(), self.page(care=care))
                self.assertEqual(result["status"], "candidate")
                self.assertFalse(result["identity"]["scopeConfirmed"])
        assisted = self.provider(category="assisted-living")
        self.assertEqual(discover.page_assessment(
            assisted, self.page(care="Assisted Living"))["status"], "exact")
        self.assertEqual(discover.page_assessment(
            assisted, self.page(care="Assisted LivingSkilled Nursing"))["status"], "candidate")
        self.assertEqual(discover.page_assessment(
            assisted, self.page(care="Assisted LivingIndependent Living"))["status"], "candidate")
        self.assertEqual(discover.page_assessment(
            self.provider(), self.page(), {"nursing-home", "assisted-living"})["status"], "candidate")
        self.assertEqual(discover.page_assessment(
            self.provider(category="life-plan"), self.page())["status"], "candidate")

    def test_home_care_matches_registered_office_without_expanding_official_limits(self):
        provider = self.provider(category="home-care", locationKind="zip",
                                 address="10 Main Street", services=["Pediatric staffing only"],
                                 limitations=["Registration is not Medicare certification."])
        for care in ["Home Care", "At-Home Care", "Home Health", "Home HealthAt-Home Care"]:
            with self.subTest(care=care):
                page = self.page(care=care)
                self.assertEqual(discover.page_assessment(provider, page)["status"], "candidate")
                page["aggregates"] = [{"family": "google", "locationSpecific": True,
                                       "evidence": "Location-specific published score for the assigned office"}]
                result = discover.page_assessment(provider, page)
                self.assertEqual(result["status"], "exact")
                scope = result["identity"]["officialScope"]
                self.assertEqual(scope["services"], ["Pediatric staffing only"])
                self.assertEqual(scope["limitations"], provider["limitations"])
        for care in ["Assisted Living", "Home HealthAssisted Living", "Hospice"]:
            self.assertEqual(discover.page_assessment(
                provider, self.page(care=care))["status"], "candidate")

    def test_exact_heading_or_explicit_legal_alias_not_suffix_or_similarity(self):
        self.assertEqual(discover.page_assessment(
            self.provider(name="EXACT & CARE"), self.page(name="Exact and Care"))["status"], "exact")
        for name in ["Exact Care: Nursing Home in NJ", "Exact Care Center", "Exakt Care"]:
            with self.subTest(name=name):
                result = discover.page_assessment(self.provider(), self.page(name=name))
                self.assertEqual(result["status"], "candidate")
                self.assertNotIn("nameConfirmed", result["identity"])
        result = discover.page_assessment(
            self.provider(), self.page(name="Consumer Brand", extra="Legal name: Exact Care"))
        self.assertEqual(result["status"], "exact")
        self.assertEqual(result["identity"]["name"], "Consumer Brand")
        self.assertEqual(result["identity"]["nameBasis"], "Legal name: Exact Care")
        self.assertTrue(result["identity"]["nameConfirmed"])
        result = discover.page_assessment(
            self.provider(name="Legal Corporation DBA Exact Care"), self.page())
        self.assertEqual(result["status"], "exact")
        self.assertIn("Legal Corporation DBA Exact Care", result["identity"]["nameBasis"])
        result = discover.page_assessment(
            self.provider(), self.page(name="Consumer Brand", extra="Also called Exact Care by families."))
        self.assertEqual(result["status"], "candidate")

    def test_page_restrictions_redirects_and_missing_dates_prevent_exact(self):
        for override in [{"effectiveUrl": HOST + "other"}, {"metadata": {"statusCode": 403}},
                         {"retrievedAt": None}, {"retrievedAt": "not-a-date"}]:
            with self.subTest(override=override):
                self.assertEqual(discover.page_assessment(
                    self.provider(), self.page(**override))["status"], "candidate")

    def test_strong_names_without_municipality_are_candidates_only(self):
        for name, city, slug in [
            ("CareOne at Hanover", "Whippany", "careone-hanover"),
            ("CareOne at Hanover", "Whippany", "careone-at-hanover"),
            ("Exact Care", "Union", "exact-care"),
            ("Home Instead", "Union", "home-instead"),
            ("Bright & Clear LLC", "Union", "bright-and-clear-llc"),
        ]:
            with self.subTest(name=name, slug=slug):
                reason = discover.candidate_reason({"name": name, "city": city}, slug)
                self.assertIsNotNone(reason)
                self.assertIn("identity unverified", reason)


class RosterCliTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="listing-crosswalk-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.region = self.root / "research/north-jersey"
        self.discovery = self.root / discover.BASE / "discovery"
        self.discovery.mkdir(parents=True)
        (self.region / "runtime").mkdir()

    def dump(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def fixture(self, county_count=1, cms_count=0):
        providers, crosswalk = [], []
        for number in range(county_count + cms_count):
            provider = AssessmentTests().provider(
                id=f"p{number}", name="Exact Care" if number == 0 else f"Missing Organization {number}")
            providers.append(provider)
            crosswalk.append({
                "providerId": provider["id"], "county": "Union",
                "status": "included_cms_only" if number >= county_count else
                          "included_historical" if number == 1 else "included",
            })
        self.dump(self.region / "runtime/providers.json", providers)
        self.dump(self.region / "runtime/crosswalk.json", crosswalk)
        self.dump(self.region / "reviews/source-access.json",
                  {"sources": [{"source": "MyLivingChoice", "access_decision": "permitted_low_volume"}]})
        for number in range(7):
            self.dump(self.discovery / f"properties-{number}.json", {
                "retrievedAt": "2026-11-12T00:00:00Z",
                "effectiveUrl": f"https://www.mylivingchoice.com/sitemaps/properties-{number}.xml",
                "markdown": HOST + "exact-care",
            })
        self.dump(self.discovery / "nj-directory.json", {"markdown": ""})
        return providers

    def run_cli(self, command, *args, expected=0):
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), command,
                                 "--root", str(self.root), *args], capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stderr)
        return json.loads(result.stdout) if expected == 0 else result.stderr

    def test_default_942_county_roster_excludes_14_cms_additions_and_runtime_is_optional(self):
        self.fixture(942, 14)
        county = self.run_cli("queue", "--dry-run")
        self.assertEqual(county["providerCount"], 942)
        self.assertEqual(len(county["excludedRuntimeProviders"]), 14)
        self.assertEqual(len(county["coverage"]), 942)
        self.assertIn("p1", {r["providerId"] for r in county["coverage"]})
        runtime = self.run_cli("queue", "--denominator", "runtime", "--expected-count", "956", "--dry-run")
        self.assertEqual(runtime["providerCount"], 956)
        self.assertEqual(runtime["excludedRuntimeProviders"], [])
        self.assertIn("denominator drift", self.run_cli(
            "queue", "--denominator", "runtime", "--expected-count", "942", "--dry-run", expected=2))
        self.assertFalse((self.root / discover.BASE / "discovery-queue.json").exists())

    def test_normalized_exact_name_index_does_not_require_shared_word_boundaries(self):
        self.fixture()
        providers = [self.fixture_provider()]
        providers[0]["id"] = "p0"
        providers[0]["name"] = "ExactCare"
        self.dump(self.region / "runtime/providers.json", providers)
        output = self.run_cli("queue", "--expected-count", "1", "--dry-run")
        self.assertEqual(len(output["requests"]), 1)
        self.assertIn("fully normalized full name", output["requests"][0]["reason"])

    def test_scoped_no_hit_has_all_evidence_and_unknown_aggregate_not_zero(self):
        self.fixture(2)
        output = self.run_cli("assess", "--expected-count", "2", "--dry-run")
        no_hit = next(o for o in output["observations"] if o["providerId"] == "p1")
        self.assertEqual(no_hit["status"], "no_hit")
        self.assertEqual(no_hit["inspection"], "sitemap-only")
        self.assertEqual(len(no_hit["evidence"]), 7)
        self.assertTrue(all(e["url"].startswith("https://www.mylivingchoice.com/sitemaps/")
                            and e["observedAt"] and e["sha256"] for e in no_hit["evidence"]))
        self.assertEqual(no_hit["observedAt"], "2026-11-12T00:00:00Z")
        self.assertIn("not an Internet-wide", no_hit["method"])
        self.assertIn("does not establish", no_hit["limitation"])
        self.assertIsNone(no_hit["aggregate"])
        sibling = self.sibling()
        assessed = sibling.assess(self.fixture_provider(), no_hit, [], date(2026, 11, 12))
        self.assertEqual(assessed["status"], "no_hit")
        self.assertFalse(assessed["harborEligibility"]["eligibleAggregate"])

    def fixture_provider(self):
        return AssessmentTests().provider()

    def sibling(self):
        spec = importlib.util.spec_from_file_location("listing_index", SCRIPT.with_name("listing-index.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_unqueued_retained_page_matches_by_actual_identity_and_keeps_active_files(self):
        self.fixture()
        retained = {
            "retrievedAt": "2026-11-12T00:00:00Z", "effectiveUrl": HOST + "unrelated-slug",
            "markdown": "# Exact Care\n[10 Main St, Union, New Jersey](https://maps.example)\n"
                        "## Types of Care\nSkilled Nursing / Long Term Care\n"
                        "## Reviews\n4.2★ on Google (30)\n",
        }
        self.dump(self.discovery / "pages/known-source.json", retained)
        queue_path = self.root / discover.BASE / "discovery-queue.json"
        normalized = self.discovery / "normalized-observations.json"
        queue_path.write_text("parent's actively fetched queue")
        normalized.write_text("parent's actively maintained observations")
        output = self.run_cli("assess", "--expected-count", "1", "--dry-run")
        exact = next(o for o in output["observations"] if o["status"] == "exact")
        self.assertEqual(exact["url"], HOST + "unrelated-slug")
        self.assertEqual(exact["aggregate"]["family"], "google")
        self.assertIsNone(exact["identity"]["zip"])
        self.assertEqual(queue_path.read_text(), "parent's actively fetched queue")
        self.assertEqual(normalized.read_text(), "parent's actively maintained observations")
        self.run_cli("ingest", "--expected-count", "1")
        self.assertEqual(queue_path.read_text(), "parent's actively fetched queue")
        assessed = self.sibling().assess(self.fixture_provider(), exact, [], date(2026, 11, 12))
        self.assertTrue(assessed["identityChecks"]["name"])
        self.assertTrue(assessed["identityChecks"]["scope"])
        self.assertTrue(assessed["identityChecks"]["address"])
        self.assertEqual(assessed["status"], "exact")
        self.assertTrue(assessed["harborEligibility"]["eligibleAggregate"])

    def test_page_cache_never_reuses_effective_url_identity_for_a_different_request(self):
        self.fixture()
        self.dump(self.discovery / "pages/exact-care.json", {
            "retrievedAt": "2026-11-12", "effectiveUrl": HOST + "redirect-destination",
            "markdown": "# Exact Care\n[10 Main St, Union, New Jersey](https://maps.example)\n"
                        "## Types of Care\nSkilled Nursing / Long Term Care\n"
                        "## Reviews\n4.2★ on Google (30)\n",
        })
        observations = self.run_cli("assess", "--expected-count", "1", "--dry-run")["observations"]
        requested = next(o for o in observations if o["url"] == HOST + "exact-care")
        self.assertEqual(requested["status"], "candidate")
        self.assertFalse(requested["pageAccess"]["samePage"])
        self.assertIsNone(requested["aggregate"])
        direct = next(o for o in observations if o["url"] == HOST + "redirect-destination")
        self.assertEqual(direct["status"], "exact")
        self.assertEqual(direct["aggregate"]["family"], "google")

    def test_exact_with_published_zip_passes_independent_sibling_and_candidates_keep_aggregates(self):
        self.fixture()
        page_path = self.discovery / "pages/exact-care.json"
        data = {"retrievedAt": "2026-11-12", "effectiveUrl": HOST + "exact-care",
                "markdown": "# Exact Care\n[10 Main St, Union, New Jersey 07083](https://maps.example)\n"
                            "## Types of Care\nSkilled Nursing / Long Term Care\n"
                            "## Reviews\n4.2★ on Google (30)\n"}
        self.dump(page_path, data)
        output = self.run_cli("ingest", "--expected-count", "1", "--dry-run")
        observation = output["observations"][0]
        assessed = self.sibling().assess(self.fixture_provider(), observation, [], date(2026, 11, 12))
        self.assertEqual(assessed["status"], "exact")
        self.assertTrue(assessed["harborEligibility"]["eligibleAggregate"])
        data["markdown"] = data["markdown"].replace("# Exact Care\n", "# Exact Care: Nursing Home in NJ\n")
        self.dump(page_path, data)
        observation = self.run_cli("assess", "--expected-count", "1", "--dry-run")["observations"][0]
        self.assertEqual(observation["status"], "candidate")
        self.assertEqual(observation["aggregate"]["family"], "google")
        self.assertEqual(observation["aggregate"]["count"], 30)
        self.assertFalse(self.sibling().assess(
            self.fixture_provider(), observation, [], date(2026, 11, 12))["harborEligibility"]["eligibleAggregate"])

    def test_unattributed_and_shared_family_aggregates_do_not_become_host_reviews(self):
        result = discover.aggregates(
            "## Reviews\n4.0 out of 5 from 25 A Place for Mom reviews.\n"
            "4.0 out of 5 from 25 SeniorAdvisor.com reviews.\n")
        self.assertEqual({a["family"] for a in result}, {"aplaceformom"})
        self.assertTrue(all(a["syndicated"] for a in result))
        result = discover.aggregates("## Reviews\n4.0overall · 25 ratings combined\n")
        self.assertIsNone(result[0]["family"])
        self.assertIsNone(result[0]["syndicated"])

    def test_roster_campus_ambiguity_blocks_exact_even_with_single_page_setting(self):
        providers = self.fixture(2)
        providers[1]["category"] = "assisted-living"
        self.dump(self.region / "runtime/providers.json", providers)
        self.dump(self.discovery / "pages/exact-care.json", {
            "retrievedAt": "2026-11-12", "effectiveUrl": HOST + "exact-care",
            "markdown": "# Exact Care\n[10 Main St, Union, New Jersey](https://maps.example)\n"
                        "## Types of Care\nSkilled Nursing / Long Term Care\n"
                        "## Reviews\n4.2★ on Google (30)\n",
        })
        observation = self.run_cli("assess", "--expected-count", "2", "--dry-run")["observations"][0]
        self.assertEqual(observation["status"], "candidate")
        self.assertFalse(observation["identity"]["scopeConfirmed"])
        self.assertEqual(observation["aggregate"]["count"], 30)

    def test_exact_unattributed_aggregate_remains_score_ineligible(self):
        self.fixture()
        self.dump(self.discovery / "pages/exact-care.json", {
            "retrievedAt": "2026-11-12", "effectiveUrl": HOST + "exact-care",
            "markdown": "# Exact Care\n[10 Main St, Union, New Jersey](https://maps.example)\n"
                        "## Types of Care\nSkilled Nursing / Long Term Care\n"
                        "## Reviews\n4.0overall · 25 ratings combined\n",
        })
        observation = self.run_cli("assess", "--expected-count", "1", "--dry-run")["observations"][0]
        self.assertEqual(observation["status"], "exact")
        self.assertIsNone(observation["aggregate"]["family"])
        assessed = self.sibling().assess(self.fixture_provider(), observation, [], date(2026, 11, 12))
        self.assertEqual(assessed["status"], "exact")
        self.assertFalse(assessed["harborEligibility"]["eligibleAggregate"])
        self.assertIn("family_or_url_missing", assessed["harborEligibility"]["reasons"])


if __name__ == "__main__":
    unittest.main()
