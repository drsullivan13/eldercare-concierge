#!/usr/bin/env python3
"""Synthetic behavioral tests. Run python3 -B scripts/regions/listing-index.test.py."""

import copy
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.error import HTTPError

sys.dont_write_bytecode = True
CLI = Path(__file__).with_name("listing-index.py")
SPEC = importlib.util.spec_from_file_location("listing_index", CLI)
INDEX = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INDEX)
AS_OF = date(2026, 11, 12)
REGION = "research/north-jersey"
BASE = f"{REGION}/listing-index"
PROVIDER = {"id": "synthetic-office", "name": "Synthetic Office",
            "address": "10 Sample Avenue Summit, NJ 07901", "city": "Summit",
            "state": "NJ", "zip": "07901", "category": "home-care", "locationKind": "zip"}
OBSERVATION = {
    "providerId": PROVIDER["id"], "source": "Synthetic Reviews", "status": "exact",
    "url": "https://reviews.example/synthetic-office", "observedAt": "2026-11-12",
    "inspection": "full-page", "sourceType": "review-platform",
    "access": {"decision": "permitted"},
    "identity": {"name": "Synthetic Office", "address": "10 Sample Ave Summit NJ 07901",
                 "careSetting": "home-care", "careUnitText": "Home-care office",
                 "scopeConfirmed": True, "evidence": "SYNTHETIC exact office, not entire brand"},
    "aggregate": {"value": 4, "count": 10, "scale": 5, "family": "synthetic",
                  "asOf": None, "scope": "consumer", "kind": "consumer-average"},
}
POLICY = {"source": "Synthetic Reviews", "family": "synthetic",
          "hosts": ["reviews.example"], "allowedPaths": ["/"],
          "termsAllowed": True, "robotsAllowed": True, "checkedAt": "2026-11-12",
          "termsUrl": "https://reviews.example/terms", "robotsUrl": "https://reviews.example/robots.txt",
          "robotsText": "User-agent: *\nAllow: /", "basis": "SYNTHETIC permitted terms"}
REQUEST = {"source": "Synthetic Reviews", "url": OBSERVATION["url"]}


def write(root, relative, data):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else INDEX.encoded(data))
    return path


def fixture(root, observations=None, count=6):
    providers, crosswalk = [], []
    for i in range(count):
        county = INDEX.COUNTIES[i % len(INDEX.COUNTIES)]
        p = {**PROVIDER, "id": f"synthetic-{i}", "name": f"Synthetic Office {i}"}
        providers.append(p)
        crosswalk.append({"providerId": p["id"], "officialId": f"TEST{i}",
                          "county": county, "status": "included"})
    write(root, f"{REGION}/runtime/providers.json", providers)
    write(root, f"{REGION}/runtime/crosswalk.json", crosswalk)
    write(root, f"{REGION}/reviews/source-access.json", {"sources": []})
    if observations is not None:
        write(root, f"{BASE}/discovery/observations.json", {"schemaVersion": 1, "observations": observations})
    return providers, crosswalk


def run(root, *args):
    return subprocess.run([sys.executable, "-B", str(CLI), *args, "--root", str(root)],
                          capture_output=True, text=True)


def assessed(obs=None):
    return INDEX.assess(PROVIDER, obs or copy.deepcopy(OBSERVATION), [], AS_OF)


class IdentityAndScore(unittest.TestCase):
    def test_exact_office_is_distinct_from_eligibility(self):
        result = assessed()
        self.assertEqual(result["status"], "exact")
        self.assertTrue(result["harborEligibility"]["eligibleAggregate"])
        score = INDEX.eligibility([result])
        self.assertEqual(score["value"], 8)
        self.assertEqual(score["confidence"], "limited")

    def test_name_address_and_scope_all_required(self):
        for field, value in (("name", "Synthetic Office North"), ("address", "11 Sample Ave Summit NJ 07901"),
                             ("careSetting", "assisted-living"), ("scopeConfirmed", False),
                             ("evidence", None), ("careUnitText", None)):
            with self.subTest(field=field):
                obs = copy.deepcopy(OBSERVATION)
                obs["identity"][field] = value
                result = assessed(obs)
                self.assertEqual(result["status"], "candidate")
                self.assertIsNone(INDEX.eligibility([result])["value"])

    def test_missing_identity_snippet_and_future_never_exact(self):
        for field, value in (("identity", {}), ("inspection", "search-snippet"),
                             ("observedAt", "2026-11-13"), ("url", "not a url")):
            obs = copy.deepcopy(OBSERVATION)
            obs[field] = value
            self.assertEqual(assessed(obs)["status"], "candidate")

    def test_address_word_boundaries_and_named_units_are_not_erased(self):
        provider = {**PROVIDER, "address": "1 23 Road Summit NJ 07901",
                    "name": "Synthetic Office (Unit2)"}
        obs = copy.deepcopy(OBSERVATION)
        obs["identity"].update(name=provider["name"], address="12 3 Road Summit NJ 07901")
        result = INDEX.assess(provider, obs, [], AS_OF)
        self.assertFalse(result["identityChecks"]["address"])
        obs["identity"].update(address=provider["address"], name="Synthetic Office")
        result = INDEX.assess(provider, obs, [], AS_OF)
        self.assertFalse(result["identityChecks"]["name"])

    def test_human_confirmed_name_alias_still_requires_address_and_scope(self):
        obs = copy.deepcopy(OBSERVATION)
        obs["identity"].update(name="Synthetic Renamed Office", nameConfirmed=True,
                               nameBasis="SYNTHETIC retained office name-change evidence")
        self.assertEqual(assessed(obs)["status"], "exact")
        obs["identity"]["address"] = "99 Wrong Street"
        self.assertEqual(assessed(obs)["status"], "candidate")

    def test_alias_requires_confirmation_and_nonempty_recorded_basis(self):
        for confirmed, basis in ((False, "Retained evidence"), (True, None), (True, ""), (True, " ")):
            obs = copy.deepcopy(OBSERVATION)
            obs["identity"].update(name="Different Office", nameConfirmed=confirmed, nameBasis=basis)
            self.assertEqual(assessed(obs)["status"], "candidate")

    def test_published_street_city_state_override_missing_zip_full_address(self):
        obs = copy.deepcopy(OBSERVATION)
        obs["identity"].update(address="10 Sample Ave, Summit, New Jersey",
                               street="10 Sample Ave", city="Summit", state="New Jersey", zip=None)
        self.assertEqual(assessed(obs)["status"], "exact")
        self.assertIsNone(assessed(obs)["identity"]["zip"])
        for key, wrong in (("street", "11 Sample Ave"), ("city", "Newark"),
                           ("state", "NY"), ("zip", "07902"), ("zip", "")):
            bad = copy.deepcopy(obs)
            bad["identity"][key] = wrong
            self.assertEqual(assessed(bad)["status"], "candidate", key)

    def test_official_state_and_zip_may_come_from_official_address(self):
        provider = {k: v for k, v in PROVIDER.items() if k not in {"state", "zip"}}
        obs = copy.deepcopy(OBSERVATION)
        obs["identity"].update(street="10 Sample Ave", city="Summit", state="NJ", zip=None)
        self.assertEqual(INDEX.assess(provider, obs, [], AS_OF)["status"], "exact")
        provider["address"] += "-1234"
        obs["identity"]["zip"] = "07901"
        self.assertEqual(INDEX.assess(provider, obs, [], AS_OF)["status"], "exact")
        obs["identity"]["zip"] = "07901-9999"
        self.assertEqual(INDEX.assess(provider, obs, [], AS_OF)["status"], "candidate")

    def test_prohibited_underlying_family_cannot_score_through_permitted_host(self):
        for underlying in ("Yelp", "Yelp.com", "Caring", "Caring.com"):
            obs = copy.deepcopy(OBSERVATION)
            obs.update(source="MyLivingChoice", url="https://www.mylivingchoice.com/property/synthetic")
            obs["aggregate"]["family"] = underlying
            result = assessed(obs)
            self.assertEqual(result["status"], "exact")
            self.assertEqual(result["aggregate"]["count"], 10)
            self.assertIn("underlying_family_restricted", result["harborEligibility"]["reasons"])
            self.assertIsNone(INDEX.eligibility([result])["value"])

    def test_unknown_mixed_family_is_not_independent_host_family(self):
        for underlying in (None, "unknown", "mixed", "combined"):
            obs = copy.deepcopy(OBSERVATION)
            obs["source"] = "MyLivingChoice"
            obs["aggregate"]["family"] = underlying
            result = assessed(obs)
            self.assertIsNone(result["aggregate"]["family"])
            self.assertIsNone(INDEX.eligibility([result])["value"])

    def test_search_page_cannot_be_a_listing_even_with_claimed_full_inspection(self):
        obs = copy.deepcopy(OBSERVATION)
        obs["url"] = "https://www.google.com/search?q=synthetic"
        self.assertEqual(assessed(obs)["status"], "candidate")

    def test_zero_is_preserved_but_missing_stays_null(self):
        for value, count, expected in ((0, 10, 0), (None, 10, None), (4, 0, None), (4, None, None)):
            obs = copy.deepcopy(OBSERVATION)
            obs["aggregate"].update(value=value, count=count)
            result = assessed(obs)
            self.assertEqual(result["aggregate"]["value"], value)
            self.assertEqual(result["aggregate"]["count"], count)
            self.assertEqual(INDEX.eligibility([result])["value"], expected)

    def test_thresholds_match_harbor(self):
        for count, eligible in ((1, False), (9, False), (10, True)):
            obs = copy.deepcopy(OBSERVATION)
            obs["aggregate"]["count"] = count
            self.assertEqual(INDEX.eligibility([assessed(obs)])["eligible"], eligible)

    def test_invalid_numeric_types_and_scope_are_excluded(self):
        for field, value in (("count", True), ("count", 10.5), ("scale", 100),
                             ("value", float("nan")), ("family", None),
                             ("scope", "employee"), ("kind", "proprietary-score")):
            obs = copy.deepcopy(OBSERVATION)
            obs["aggregate"][field] = value
            self.assertFalse(assessed(obs)["harborEligibility"]["eligibleAggregate"])

    def test_check_and_snapshot_age_boundaries(self):
        for checked, snapshot, expected in (
                ("2026-05-16", None, True), ("2026-05-15", None, False),
                ("2026-11-12", "2025-11-12", True), ("2026-11-12", "2025-11-11", False),
                ("2026-11-12", "2026-11-13", False), ("2026-02-30", None, False)):
            obs = copy.deepcopy(OBSERVATION)
            obs["observedAt"], obs["aggregate"]["asOf"] = checked, snapshot
            self.assertEqual(assessed(obs)["harborEligibility"]["eligibleAggregate"], expected)

    def test_syndicated_aliases_count_once_and_newest_not_highest_wins(self):
        a, b = copy.deepcopy(OBSERVATION), copy.deepcopy(OBSERVATION)
        a.update(source="A Place for Mom", observedAt="2026-11-11")
        b.update(source="SeniorAdvisor.com", url="https://other.example/location")
        a["aggregate"].update(family="APFM", value=5, count=9)
        b["aggregate"].update(family="SeniorAdvisor.com", value=2, count=7)
        score = INDEX.eligibility([assessed(a), assessed(b)])
        self.assertFalse(score["eligible"])
        self.assertEqual(score["reviewCount"], 7)
        self.assertEqual(score["independentSourceCount"], 1)
        self.assertEqual(len(score["excludedSources"]), 1)

    def test_transitive_page_family_deduplication(self):
        observations = [copy.deepcopy(OBSERVATION) for _ in range(3)]
        observations[1]["aggregate"]["family"] = "second"
        observations[2]["aggregate"]["family"] = "second"
        observations[2]["url"] = "https://other.example/location"
        self.assertEqual(INDEX.eligibility([assessed(o) for o in observations])["independentSourceCount"], 1)

    def test_known_platform_family_overrides_independence_claim(self):
        a, b = copy.deepcopy(OBSERVATION), copy.deepcopy(OBSERVATION)
        a.update(source="A Place for Mom", url="https://first.example/location")
        b.update(source="SeniorAdvisor.com", url="https://second.example/location")
        a["aggregate"]["family"], b["aggregate"]["family"] = "first", "second"
        self.assertEqual(INDEX.eligibility([assessed(a), assessed(b)])["independentSourceCount"], 1)

    def test_independent_families_moderate_threshold(self):
        a, b = copy.deepcopy(OBSERVATION), copy.deepcopy(OBSERVATION)
        b.update(source="Other", url="https://other.example/location")
        b["aggregate"].update(family="other", count=20, value=8, scale=10)
        score = INDEX.eligibility([assessed(a), assessed(b)])
        self.assertEqual((score["value"], score["confidence"], score["reviewCount"]), (8, "moderate", 30))

    def test_no_hit_requires_actual_dated_search(self):
        obs = {"source": "Synthetic Reviews", "status": "no_hit"}
        self.assertEqual(assessed(obs)["status"], "unattempted")
        obs.update(observedAt="2026-11-12", method="SYNTHETIC name and address search")
        self.assertEqual(assessed(obs)["status"], "no_hit")

    def test_restricted_sources_keep_aggregate_but_never_score(self):
        obs = copy.deepcopy(OBSERVATION)
        obs["source"] = "Caring.com"
        result = assessed(obs)
        self.assertEqual(result["status"], "access_restricted")
        self.assertEqual(result["aggregate"]["value"], 4)
        self.assertFalse(result["harborEligibility"]["eligibleAggregate"])
        obs.update(source="Renamed Source", url="https://www.caring.com/location")
        self.assertEqual(assessed(obs)["status"], "access_restricted")

    def test_retained_property_page_preserves_unknown_zip_and_population_exclusion(self):
        provider = {**PROVIDER, "category": "assisted-living"}
        raw = {
            "kind": "property_page_check", "source": "MyLivingChoice",
            "official_type": "ASSISTED LIVING RESIDENCE", "checked_at": "2026-11-12",
            "canonical_url": "https://www.mylivingchoice.com/property/synthetic-office",
            "http_status": 200, "access_decision": "permitted_low_volume",
            "identity": {"observed_name": provider["name"], "observed_street": "10 Sample Ave",
                         "observed_city": "Summit", "observed_state": "New Jersey",
                         "observed_care_unit": "Assisted Living", "care_unit_match": True,
                         "match_result": "exact_location_single_license",
                         "match_reasoning": "SYNTHETIC direct unit confirmation", "name_match": True},
            "aggregate": {"rating": 4, "review_count": 20, "scale": 5, "published_as_of": None,
                          "underlying_source_families": [{"family": "google"}], "ambiguity": "none_for_unit_identity"},
        }
        result = INDEX.assess(provider, INDEX.retained_observation(raw), [], AS_OF)
        self.assertEqual(result["status"], "exact")
        self.assertIsNone(result["identity"]["zip"])
        self.assertEqual(INDEX.eligibility([result])["value"], 8)
        raw["aggregate"]["ambiguity"] = "reviewer_ambiguity"
        result = INDEX.assess(provider, INDEX.retained_observation(raw), [], AS_OF)
        self.assertEqual(result["status"], "exact")
        self.assertEqual(result["aggregate"]["count"], 20)
        self.assertIsNone(INDEX.eligibility([result])["value"])


class CrosswalkCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_complete_county_order_and_offices_without_evidence(self):
        fixture(self.root)
        result = run(self.root, "build", "--as-of", "2026-11-12", "--expected-count", "6", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["providerCount"], 6)
        self.assertEqual([p["county"] for p in output["providers"]], INDEX.COUNTIES)
        self.assertTrue(all(p["locationKind"] == "zip" for p in output["providers"]))
        self.assertTrue(all(s["status"] == "unattempted" for p in output["providers"]
                            for s in p["sources"] if s["source"] == "MyLivingChoice"))
        self.assertFalse((self.root / BASE).exists())

    def test_denominator_drift_fails_before_writes(self):
        fixture(self.root)
        result = run(self.root, "build", "--as-of", "2026-11-12", "--expected-count", "942")
        self.assertEqual(result.returncode, 2)
        self.assertIn("denominator drift", result.stderr)
        self.assertFalse((self.root / BASE / "runs").exists())

    def test_default_tracks_960_roster_and_retains_942_baseline_and_input_hashes(self):
        fixture(self.root, count=960)
        result = run(self.root, "build", "--as-of", "2026-11-12")
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        directory = self.root / output["runDir"]
        manifest = json.loads((directory / "manifest.json").read_bytes())
        crosswalk = json.loads((directory / "crosswalk.json").read_bytes())
        summary = crosswalk["rosterSummary"]
        self.assertEqual((crosswalk["providerCount"], summary["actualCountyRosterCount"]), (960, 960))
        self.assertEqual((summary["historicalCountyRosterBaseline"], summary["differenceFromBaseline"]), (942, 18))
        self.assertIsNone(manifest["expectedCount"])
        self.assertEqual(manifest["rosterSummary"], summary)
        self.assertEqual([s["count"] for s in summary["sources"]], [960, 960])
        for source in summary["sources"]:
            data = json.loads((self.root / source["path"]).read_bytes())
            self.assertEqual(source["canonicalJsonSha256"], INDEX.digest(INDEX.encoded(data)))
            retained = next(i for i in manifest["inputs"] if i["path"] == source["path"])
            self.assertEqual(retained["sha256"], INDEX.digest((self.root / source["path"]).read_bytes()))
        self.assertEqual(run(self.root, "verify", "--run", str(directory)).returncode, 0)
        rejected = run(self.root, "build", "--as-of", "2026-11-12", "--expected-count", "942")
        self.assertEqual(rejected.returncode, 2)
        self.assertIn("expected 942, found 960", rejected.stderr)

    def test_cms_only_exclusion_is_explicit_and_optional(self):
        providers, crosswalk = fixture(self.root)
        crosswalk[-1]["status"] = "included_cms_only"
        write(self.root, f"{REGION}/runtime/crosswalk.json", crosswalk)
        result = run(self.root, "build", "--as-of", "2026-11-12", "--expected-count", "5", "--dry-run")
        output = json.loads(result.stdout)
        self.assertEqual(output["providerCount"], 5)
        self.assertEqual(output["excludedRuntimeProviders"][0]["providerId"], providers[-1]["id"])
        result = run(self.root, "build", "--as-of", "2026-11-12", "--denominator", "runtime",
                     "--expected-count", "6", "--dry-run")
        self.assertEqual(json.loads(result.stdout)["providerCount"], 6)

    def test_build_verify_reuses_retained_inputs_and_detects_tamper(self):
        fixture(self.root)
        args = ("build", "--as-of", "2026-11-12", "--expected-count", "6")
        built = run(self.root, *args)
        self.assertEqual(built.returncode, 0, built.stderr)
        output = json.loads(built.stdout)
        self.assertEqual(run(self.root, *args).stdout, built.stdout)
        directory = self.root / output["runDir"]
        write(self.root, f"{REGION}/runtime/providers.json", [])
        checked = run(self.root, "verify", "--run", str(directory))
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(json.loads(checked.stdout)["providerCount"], 6)
        (directory / "crosswalk.json").write_text("{}")
        checked = run(self.root, "verify", "--run", str(directory))
        self.assertEqual(checked.returncode, 2)
        self.assertIn("does not reproduce", checked.stderr)

    def test_retained_review_observation_is_not_trusted_as_preapproved(self):
        providers, _ = fixture(self.root)
        obs = copy.deepcopy(OBSERVATION)
        obs["providerId"] = providers[0]["id"]
        obs["identity"]["name"] = providers[0]["name"]
        write(self.root, f"{REGION}/reviews/runs/synthetic/observations.json", [{"input": obs, "status": "accepted"}])
        write(self.root, f"{REGION}/reviews/runs/synthetic/candidates.json", [{"providerId": providers[0]["id"]}])
        output = json.loads(run(self.root, "build", "--as-of", "2026-11-12",
                                "--expected-count", "6", "--dry-run").stdout)
        self.assertEqual(output["providers"][0]["harborEligibility"]["value"], 8)
        self.assertEqual(len(output["unlinkedEvidence"]), 1)

    def test_sitemap_candidates_never_become_exact_or_no_hit(self):
        fixture(self.root)
        write(self.root, f"{BASE}/discovery/sitemap.json", {
            "retrievedAt": "2026-11-12T10:00:00Z",
            "markdown": "https://www.mylivingchoice.com/property/synthetic-office-02026-11-12T10:00:00Zweekly"})
        result = json.loads(run(self.root, "build", "--as-of", "2026-11-12",
                                "--expected-count", "6", "--dry-run").stdout)
        row = next(s for s in result["providers"][0]["sources"] if s["source"] == "MyLivingChoice")
        self.assertEqual(row["status"], "candidate")
        self.assertEqual(row["listings"][0]["url"], "https://www.mylivingchoice.com/property/synthetic-office-0")
        self.assertIsNone(row["listings"][0]["aggregate"])
        row = next(s for s in result["providers"][1]["sources"] if s["source"] == "MyLivingChoice")
        self.assertEqual(row["status"], "unattempted")

    def test_candidate_aggregate_is_retained_without_identity_promotion(self):
        providers, _ = fixture(self.root)
        write(self.root, f"{REGION}/reviews/runs/synthetic/candidates.json", [{
            "providerId": providers[0]["id"], "status": "awaiting-review",
            "aggregate": {"platform": "Synthetic Reviews", "sourceFamily": "synthetic",
                          "rating": 4, "scale": 5, "count": 185, "asOf": None, "scope": "consumer"},
            "source": {"url": OBSERVATION["url"], "checkedAt": "2026-11-12",
                       "kind": "review-platform", "access": "full-page"}}])
        result = json.loads(run(self.root, "build", "--as-of", "2026-11-12",
                                "--expected-count", "6", "--dry-run").stdout)
        row = next(s for s in result["providers"][0]["sources"] if s["source"] == "Synthetic Reviews")
        self.assertEqual(row["status"], "candidate")
        self.assertEqual(row["listings"][0]["aggregate"]["count"], 185)
        self.assertIsNone(result["providers"][0]["harborEligibility"]["value"])

    def test_later_refresh_restriction_excludes_previously_retained_exact(self):
        providers, _ = fixture(self.root)
        obs = copy.deepcopy(OBSERVATION)
        obs["providerId"], obs["identity"]["name"] = providers[0]["id"], providers[0]["name"]
        write(self.root, f"{BASE}/discovery/observations.json", {"observations": [obs]})
        write(self.root, f"{BASE}/refresh-state.json", {
            "stopped": {"Synthetic Reviews": "http_429", "reviews.example": "http_429"},
            "lastRequest": {}})
        result = json.loads(run(self.root, "build", "--as-of", "2026-11-12",
                                "--expected-count", "6", "--dry-run").stdout)
        row = next(s for s in result["providers"][0]["sources"] if s["source"] == "Synthetic Reviews")
        self.assertEqual(row["status"], "access_restricted")
        self.assertEqual(row["listings"][0]["aggregate"]["count"], 10)
        self.assertIsNone(result["providers"][0]["harborEligibility"]["value"])
        self.assertNotIn("reviews.example", result["sources"])

    def test_pilot_uses_official_identity_without_refetching(self):
        providers, _ = fixture(self.root)
        write(self.root, f"{REGION}/reviews/pilot-direct-check.json", {
            "checked_at": "2026-11-12",
            "location": {"official_id": "TEST0", "postal_code": "07901"},
            "direct_observation": {
                "source": "MyLivingChoice", "canonical_url": "https://www.mylivingchoice.com/property/synthetic-office",
                "inspection": "full-page", "source_type": "review-platform", "access_decision": "permitted_low_volume",
                "identity": {"observed_name": providers[0]["name"], "observed_address": "10 Sample Avenue",
                             "observed_city": "Summit", "observed_state": "New Jersey", "care_unit_match": True,
                             "observed_care_unit": "Nursing Home", "evidence": "SYNTHETIC unit evidence"},
                "aggregate": {"rating": 4, "scale": 5, "review_count": 185,
                              "source_family": "google", "scope": "consumer"}}})
        # The pilot adapter's retained SNF scope must not be assigned to a home-care office.
        result = json.loads(run(self.root, "build", "--as-of", "2026-11-12",
                                "--expected-count", "6", "--dry-run").stdout)
        row = next(s for s in result["providers"][0]["sources"] if s["source"] == "MyLivingChoice")
        self.assertEqual(row["status"], "candidate")
        self.assertEqual(row["listings"][0]["aggregate"]["count"], 185)

    def test_retained_searches_and_home_care_offices_are_reused(self):
        fixture(self.root)
        write(self.root, f"{REGION}/reviews/union-morris/observations.json", {
            "observations": [{"kind": "discovery_search", "official_id": "TEST0",
                              "checked_at": "2026-11-12", "query": "SYNTHETIC name and street search",
                              "exact_property_lead": None, "error": None}]})
        write(self.root, f"{REGION}/reviews/home-care-direct-checks.json", {
            "checked_at": "2026-11-12", "locations": [{
                "official_id": "TEST1", "queries": ["SYNTHETIC actual office search"],
                "review_outcome": "no_exact_MyLivingChoice_listing_discovered",
                "discovered_urls": ["https://www.aplaceformom.com/agency/synthetic-office"]}]})
        result = json.loads(run(self.root, "build", "--as-of", "2026-11-12",
                                "--expected-count", "6", "--dry-run").stdout)
        for provider in result["providers"][:2]:
            source = next(s for s in provider["sources"] if s["source"] == "MyLivingChoice")
            self.assertEqual(source["status"], "no_hit")
        source = next(s for s in result["providers"][1]["sources"] if s["source"] == "A Place for Mom")
        self.assertEqual(source["status"], "candidate")
        self.assertIsNone(source["listings"][0]["aggregate"])

    def test_output_path_guard_rejects_escape_and_symlink(self):
        with self.assertRaises(ValueError):
            INDEX.write(self.root, self.root / "outside.json", b"{}")
        target = self.root / BASE
        target.parent.mkdir(parents=True)
        target.symlink_to(self.root / "outside")
        # A symlinked namespace is refused rather than redefining the allowed root.
        with self.assertRaises(ValueError):
            INDEX.write(self.root, target / "output.json", b"{}")


class FakeResponse:
    status = 200

    def __init__(self, data=b"Public synthetic page"):
        self.data = data

    def read(self, size):
        return self.data[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    def __init__(self, responses=None):
        self.responses = list(responses or [FakeResponse()])
        self.calls = []

    def open(self, request, timeout):
        self.calls.append(request.full_url)
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class BrokenResponse(FakeResponse):
    def read(self, size):
        raise OSError("SYNTHETIC interrupted response")


class AccessAndRefresh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        fixture(self.root)
        self.now = datetime(2026, 11, 12, tzinfo=timezone.utc).timestamp()
        self.sleeps = []

    def tearDown(self):
        self.tmp.cleanup()

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds

    def refresh(self, opener, requests=None, policies=None, allowlist=None):
        return INDEX.refresh(self.root, requests or [REQUEST], policies or [copy.deepcopy(POLICY)],
                             allowlist if allowlist is not None else ["Synthetic Reviews"],
                             opener=opener, clock=lambda: self.now, sleep=self.sleep)

    def test_allowlist_and_policy_fail_closed_without_network(self):
        variants = [({}, []), ({"termsAllowed": False}, ["Synthetic Reviews"]),
                    ({"robotsAllowed": False}, ["Synthetic Reviews"]),
                    ({"robotsText": "User-agent: *\nDisallow: /"}, ["Synthetic Reviews"]),
                    ({"checkedAt": "2026-09-01"}, ["Synthetic Reviews"]),
                    ({"hosts": ["other.example"]}, ["Synthetic Reviews"]),
                    ({"allowedPaths": ["/not-this/"]}, ["Synthetic Reviews"]),
                    ({"family": None}, ["Synthetic Reviews"]),
                    ({"family": "Yelp"}, ["Synthetic Reviews"])]
        for changes, allowlist in variants:
            opener = FakeOpener()
            policy = {**POLICY, **changes}
            result = self.refresh(opener, policies=[policy], allowlist=allowlist)
            self.assertEqual(result["results"][0]["status"], "access_restricted")
            self.assertEqual(opener.calls, [])

    def test_retained_restriction_overrides_explicit_allow(self):
        write(self.root, f"{REGION}/reviews/source-access.json", {"sources": [
            {"source": "Synthetic Reviews", "access_decision": "restricted_no_automation"}]})
        opener = FakeOpener()
        self.refresh(opener)
        self.assertEqual(opener.calls, [])

    def test_prohibited_host_and_family_alias_cannot_be_relabelled(self):
        policy = {**POLICY, "hosts": ["www.caring.com"]}
        reason = INDEX.fetch_permission("Synthetic Reviews", "https://www.caring.com/location",
                                        policy, [], ["Synthetic Reviews"], AS_OF)
        self.assertEqual(reason, "prohibited_host")
        self.assertEqual(INDEX.fetch_permission("Caring.com", REQUEST["url"], POLICY, [],
                                               ["Caring.com"], AS_OF), "prohibited_source_or_family")
        retained = [{"source": "Blocked", "robots_url": "https://reviews.example/robots.txt",
                     "access_decision": "excluded_ai_crawler_restriction"}]
        self.assertEqual(INDEX.fetch_permission("Synthetic Reviews", REQUEST["url"], POLICY, retained,
                                               ["Synthetic Reviews"], AS_OF), "prohibited_host")

    def test_ai_specific_robots_restriction_is_not_bypassed_by_custom_agent_name(self):
        policy = {**POLICY, "robotsText": "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /"}
        opener = FakeOpener()
        result = self.refresh(opener, policies=[policy])
        self.assertEqual(opener.calls, [])
        self.assertEqual(result["results"][0]["reason"], "robots_disallow")

    def test_cache_reuse_and_corruption_detection(self):
        opener = FakeOpener()
        first = self.refresh(opener)
        self.assertEqual(len(opener.calls), 1)
        second = self.refresh(opener)
        self.assertEqual(len(opener.calls), 1)
        self.assertTrue(second["results"][0]["cacheReused"])
        raw = self.root / BASE / "raw" / first["results"][0]["sha256"]
        raw.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.refresh(opener)

    def test_explicit_revalidation_retains_both_raw_observations(self):
        opener = FakeOpener([FakeResponse(b"first public page"), FakeResponse(b"second public page")])
        first = self.refresh(opener)["results"][0]
        second = INDEX.refresh(self.root, [REQUEST], [POLICY], ["Synthetic Reviews"],
                               opener=opener, clock=lambda: self.now, sleep=self.sleep,
                               revalidate=True)["results"][0]
        self.assertEqual(len(opener.calls), 2)
        self.assertEqual(self.sleeps, [10])
        self.assertNotEqual(first["sha256"], second["sha256"])
        self.assertEqual(len(list((self.root / BASE / "cache/history").glob("*.json"))), 2)
        self.assertEqual((self.root / BASE / "raw" / first["sha256"]).read_bytes(), b"first public page")
        self.assertEqual(self.refresh(opener)["results"][0]["sha256"], second["sha256"])

    def test_materialized_html_is_consumed_by_discovery_and_crosswalk(self):
        spec = importlib.util.spec_from_file_location("listing_discover", CLI.with_name("listing-index-discover.py"))
        discover = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(discover)
        provider = {**PROVIDER, "category": "assisted-living"}
        url = "https://www.mylivingchoice.com/property/synthetic-office"
        html = b"""<html><head><title>Wrong heading</title><style>Wrong Street</style></head>
<body><h1>Synthetic <span>Office</span></h1>
<address>10 Sample Ave, Summit, New Jersey</address>
<script>4.9 on Google (999)</script><div hidden>Wrong Street</div>
<div aria-hidden="true">Wrong Office</div><div style="display:none">Fake</div>
<h2>Types of Care</h2><ul><li>Assisted Living</li></ul>
<h2>Reviews</h2><p>4.0 on Google (20)</p>
<a href="/property/other">Other listing</a></body></html>"""
        policy = {**POLICY, "source": "MyLivingChoice", "hosts": ["www.mylivingchoice.com"]}
        request = {"source": "MyLivingChoice", "url": url}
        opener = FakeOpener([FakeResponse(html)])
        result = self.refresh(opener, requests=[request], policies=[policy], allowlist=["MyLivingChoice"])
        page_path = self.root / result["results"][0]["retainedPage"]
        page = json.loads(page_path.read_bytes())
        self.assertIn("# Synthetic Office\n", page["markdown"])
        self.assertIn("## Types of Care\n", page["markdown"])
        self.assertIn("[Other listing](https://www.mylivingchoice.com/property/other)", page["markdown"])
        for forbidden in ("Wrong", "999", "Fake", "<script"):
            self.assertNotIn(forbidden, page["markdown"])
        extracted = discover.extract_page(page, url)
        assessed_page = discover.page_assessment(provider, extracted, {"assisted-living"})
        observation = {**OBSERVATION, **assessed_page, "source": "MyLivingChoice",
                       "url": url, "observedAt": extracted["observedAt"],
                       "aggregate": extracted["aggregates"][0]}
        listing = INDEX.assess(provider, observation, [], AS_OF)
        self.assertEqual(listing["status"], "exact")
        self.assertIsNone(listing["identity"]["zip"])
        self.assertEqual(INDEX.eligibility([listing])["value"], 8)
        self.assertEqual(run(self.root, "materialize").returncode, 0)
        self.assertEqual(self.refresh(opener, requests=[request], policies=[policy],
                                     allowlist=["MyLivingChoice"])["results"][0]["retainedPage"],
                         result["results"][0]["retainedPage"])
        self.assertEqual(len(opener.calls), 1)
        providers, _ = fixture(self.root)
        for row in providers:
            row["category"] = "assisted-living"
        providers[0]["name"] = "Synthetic Office"
        write(self.root, f"{REGION}/runtime/providers.json", providers)
        write(self.root, f"{REGION}/reviews/source-access.json", {"sources": [{
            "source": "MyLivingChoice", "access_decision": "permitted_low_volume"}]})
        for number in range(7):
            write(self.root, f"{BASE}/discovery/properties-{number}.json",
                  {"markdown": url, "retrievedAt": "2026-11-12"})
        write(self.root, f"{BASE}/discovery/nj-directory.json", {"markdown": ""})
        ingested = subprocess.run([sys.executable, "-B", str(CLI.with_name("listing-index-discover.py")),
                                  "ingest", "--root", str(self.root), "--expected-count", "6"],
                                 capture_output=True, text=True)
        self.assertEqual(ingested.returncode, 0, ingested.stderr)
        built = run(self.root, "build", "--as-of", "2026-11-12", "--dry-run")
        self.assertEqual(built.returncode, 0, built.stderr)
        actual = next(p for p in json.loads(built.stdout)["providers"] if p["providerId"] == providers[0]["id"])
        self.assertEqual(actual["harborEligibility"]["value"], 8)
        exact = [listing for source in actual["sources"] for listing in source["listings"]
                 if listing["status"] == "exact"]
        self.assertTrue(exact)
        self.assertTrue(all(listing["identity"]["zip"] is None for listing in exact))

    def test_existing_fetchurl_page_reused_without_cache_or_network(self):
        path = write(self.root, f"{BASE}/discovery/pages/coordinator.json", {
            "effectiveUrl": REQUEST["url"], "retrievedAt": "2026-11-12",
            "markdown": "# Synthetic Office\n10 Sample Ave, Summit, NJ\n",
            "metadata": {"statusCode": 200}, "source": "Synthetic Reviews"})
        original = path.read_bytes()
        opener = FakeOpener([])
        result = self.refresh(opener, requests=[REQUEST, REQUEST])
        self.assertEqual(opener.calls, [])
        self.assertTrue(all(r["cacheReused"] for r in result["results"]))
        self.assertEqual(path.read_bytes(), original)
        self.assertFalse((self.root / BASE / "cache").exists())

    def test_retained_direct_pilot_and_property_observations_are_not_refetched(self):
        pilot = {"checked_at": "2026-11-12", "direct_observation": {
            "source": "Synthetic Reviews", "canonical_url": REQUEST["url"],
            "inspection": "full-page", "access_decision": "permitted_low_volume"}}
        write(self.root, f"{REGION}/reviews/pilot-direct-check.json", pilot)
        other = {**REQUEST, "url": "https://reviews.example/other"}
        write(self.root, f"{REGION}/reviews/union/observations.json", {"observations": [{
            "kind": "property_page_check", "source": "Synthetic Reviews",
            "canonical_url": other["url"], "http_status": 200,
            "checked_at": "2026-11-12", "access_decision": "permitted_low_volume"}]})
        opener = FakeOpener([])
        result = self.refresh(opener, requests=[REQUEST, other])
        self.assertEqual(opener.calls, [])
        self.assertTrue(all(r["cacheReused"] for r in result["results"]))

    def test_duplicate_batch_urls_are_fetched_once_even_when_revalidating(self):
        for revalidate in (False, True):
            opener = FakeOpener()
            result = INDEX.refresh(self.root, [REQUEST, REQUEST], [POLICY], ["Synthetic Reviews"],
                                   opener=opener, clock=lambda: self.now, sleep=self.sleep,
                                   revalidate=revalidate)
            self.assertLessEqual(len(opener.calls), 1)
            self.assertTrue(result["results"][1]["cacheReused"])

    def test_unsuccessful_retained_pages_do_not_prevent_permitted_fetch(self):
        write(self.root, f"{BASE}/discovery/pages/denied.json", {
            "effectiveUrl": REQUEST["url"], "retrievedAt": "2026-11-12",
            "markdown": "Access denied", "metadata": {"statusCode": 403}})
        opener = FakeOpener()
        self.refresh(opener)
        self.assertEqual(opener.calls, [REQUEST["url"]])

    def test_source_and_host_rate_limit_persists_across_calls(self):
        opener = FakeOpener([FakeResponse(), FakeResponse(), FakeResponse()])
        self.refresh(opener)
        self.refresh(opener, requests=[{**REQUEST, "url": "https://reviews.example/second"}])
        self.refresh(opener, requests=[{**REQUEST, "source": "Other", "url": "https://reviews.example/third"}],
                     policies=[{**POLICY, "source": "Other", "robotsText": "User-agent: *\nAllow: /\nCrawl-delay: 12"}],
                     allowlist=["Other"])
        self.assertEqual(self.sleeps, [10, 12])

    def test_robots_request_rate_and_encoded_path_rules_are_honored(self):
        opener = FakeOpener([FakeResponse(), FakeResponse()])
        policy = {**POLICY, "robotsText": "User-agent: *\nAllow: /\nRequest-rate: 1/60"}
        self.refresh(opener, policies=[policy])
        self.refresh(opener, requests=[{**REQUEST, "url": "https://reviews.example/second"}], policies=[policy])
        self.assertEqual(self.sleeps, [60])
        reason = INDEX.fetch_permission("Synthetic Reviews", "https://reviews.example/property/%2e%2e/private",
                                        {**POLICY, "allowedPaths": ["/property/"]}, [],
                                        ["Synthetic Reviews"], AS_OF)
        self.assertEqual(reason, "path_traversal_not_permitted")

    def test_429_challenge_and_redirect_stop_further_source_and_host_requests(self):
        for response in (HTTPError(REQUEST["url"], 429, "limited", {}, io.BytesIO(b"limited")),
                         FakeResponse(b"Verify you are human"),
                         HTTPError(REQUEST["url"], 302, "redirect", {}, io.BytesIO(b"redirect"))):
            with self.subTest(response=response), tempfile.TemporaryDirectory() as tmp:
                self.root = Path(tmp)
                fixture(self.root)
                opener = FakeOpener([response])
                result = self.refresh(opener, requests=[REQUEST, {**REQUEST, "url": "https://reviews.example/next"}])
                self.assertEqual(len(opener.calls), 1)
                self.assertEqual(result["results"][0]["status"], "access_restricted")
                self.assertEqual(result["results"][1]["reason"], "source_or_host_stopped")
                self.refresh(opener, requests=[{**REQUEST, "source": "Other"}],
                             policies=[{**POLICY, "source": "Other"}], allowlist=["Other"])
                self.assertEqual(len(opener.calls), 1)

    def test_partial_response_does_not_become_a_successful_empty_observation(self):
        opener = FakeOpener([BrokenResponse()])
        result = self.refresh(opener, requests=[REQUEST, {**REQUEST, "url": "https://reviews.example/second"}])
        self.assertEqual(len(opener.calls), 1)
        self.assertEqual(result["results"][0]["status"], "access_restricted")
        self.assertEqual(result["results"][1]["reason"], "source_or_host_stopped")

    def test_transport_retry_preserves_other_sources_and_http_denials(self):
        path = write(self.root, f"{BASE}/refresh-state.json", {
            "lastRequest": {}, "stopped": {"Synthetic Reviews": "transport_error: URLError",
            "reviews.example": "http_429", "other.example": "transport_error: URLError"}})
        opener = FakeOpener()
        result = INDEX.refresh(self.root, [REQUEST], [POLICY], ["Synthetic Reviews"],
                               opener=opener, clock=lambda: self.now, sleep=self.sleep, retry_transport=True)
        self.assertEqual(len(opener.calls), 0)
        self.assertEqual(result["results"][0]["reason"], "source_or_host_stopped")
        self.assertIn("other.example", result["stopped"])

    def test_minimum_rate_cannot_be_disabled(self):
        with self.assertRaises(ValueError):
            INDEX.refresh(self.root, [], [], [], interval=0)

    def test_cli_refresh_policy_denial_does_not_fetch_or_write(self):
        requests = write(self.root, f"{BASE}/discovery/requests.json", {"requests": [REQUEST]})
        policy = write(self.root, f"{BASE}/discovery/policy.json",
                       {"sources": [{**POLICY, "termsAllowed": False}]})
        result = run(self.root, "refresh", "--requests", str(requests), "--policy", str(policy),
                     "--allow-source", "Synthetic Reviews")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["results"][0]["status"], "access_restricted")
        self.assertFalse((self.root / BASE / "cache").exists())


if __name__ == "__main__":
    unittest.main()
