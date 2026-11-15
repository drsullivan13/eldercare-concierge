#!/usr/bin/env python3
"""Synthetic boundary, replay and CLI tests. No fixture is release evidence."""

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("home-care-reviews.py")
spec = importlib.util.spec_from_file_location("home_care_reviews", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
PID = "north-jersey-hp-hp9999999"
URL = "https://www.mylivingchoice.com/property/synthetic-test-office"
REVIEW = "https://www.google.com/maps/reviews/data=!1sCiSyntheticAccount!2m1!1ssynthetic-place"
RAW = b"SYNTHETIC OFFICIAL ROSTER, NOT EVIDENCE"


def dump(root, path, value):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(release.encoded(value))


def fixture(root):
    provider = {
        "id": PID, "name": "SYNTHETIC TEST HOME CARE", "address": "1 TEST STREET",
        "city": "MORRISTOWN", "state": "NJ", "zip": "07960", "category": "home-care",
        "locationKind": "office", "lat": 40.796, "lng": -74.48, "description": "Synthetic only",
        "services": [], "sources": [], "warnings": [], "limitations": [], "officialRecord": True,
    }
    research = {
        "providerId": PID, "checkedAt": None, "providerDetailsReviewed": False,
        "sources": [], "facts": [], "reviews": [], "reviewAggregates": [], "notes": ["Synthetic baseline"],
        "availability": {"status": "not-published", "text": "Synthetic unknown",
                         "sourceId": None, "asOf": None},
    }
    market = {"id": "north-jersey", "label": "North Jersey", "state": "NJ", "defaultZip": "07960",
              "zips": {"07960": {"city": "MORRISTOWN", "lat": 40.796, "lng": -74.48}},
              "meta": {"asOf": "2026-11-14"}, "providers": [provider], "locationResearch": {PID: research}}
    dump(root, "src/data/regional-markets.json", [market])
    source = {"url": "https://rgbportal.dca.njoag.gov/public-view/", "file": "raw/firms.xlsx",
              "sha256": hashlib.sha256(RAW).hexdigest(), "row": 1}
    row = {k: provider[k] for k in ("name", "address", "city", "state", "zip")}
    row.update(record_kind="home_care_firm_registration", official_registration_id="HP9999999",
               license_status="Active", source=source, county="Morris")
    dump(root, "research/north-jersey/state/morris/home-care-firms.json", [row])
    raw = root / "research/north-jersey/state/raw/firms.xlsx"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(RAW)
    dump(root, "research/north-jersey/runtime/crosswalk.json", [{
        "providerId": PID, "officialId": "HP9999999", "status": "included", "county": "Morris",
        "sourceFile": "state/morris/home-care-firms.json", "sourceRow": 1,
        "sourceSha256": source["sha256"],
    }])
    dump(root, "research/north-jersey/reviews/source-access.json", {"sources": [{
        "host": "mylivingchoice.com", "access_decision": "permitted_low_volume",
        "basis": "Synthetic test permission, not a real assessment",
    }]})
    account = {
        "id": "synthetic-account", "url": REVIEW, "nativeReviewId": "synthetic-native-1",
        "date": "2026-10", "datePrecision": "month", "authorObserved": True,
        "relationship": "family", "text": "SYNTHETIC protected narrative must not be retained.",
        "textPresent": True, "privacyReviewed": False,
    }
    obs = {
        "id": "synthetic-observation", "providerId": PID, "officialId": "HP9999999",
        "checkedAt": "2026-11-14", "checkedUrl": URL, "canonicalUrl": URL, "effectiveUrl": URL,
        "originalUrl": "https://www.google.com/maps?cid=9999999",
        "publisher": "Synthetic MyLivingChoice", "sourceFamily": "Google Maps",
        "syndication": {"status": "syndicated", "family": "google"}, "sourceType": "review-platform",
        "population": "consumer", "inspection": "full-page",
        "access": {"decision": "permitted", "assessedAt": "2026-11-14",
                   "basis": "Synthetic access check", "evidenceSha256": "a" * 64, "metadata": "permitted"},
        "textRights": {"decision": "no-rights", "assessedAt": "2026-11-14",
                       "basis": "No narrative rights in synthetic test", "evidenceSha256": None},
        "identity": {"checkedAt": "2026-11-14", "url": URL, "evidenceSha256": "b" * 64,
                     "officialId": "HP9999999", "careUnit": "home-care-office",
                     **{k: provider[k] for k in ("name", "address", "city", "state", "zip")}},
        "aggregate": {"kind": "consumer-average", "rating": 5, "scale": 5, "count": 6, "asOf": None},
        "accounts": [account],
        "window": {"selection": "all-visible-before-highlighting", "visibleCount": 1, "pagesChecked": 1,
                   "coverage": "exhausted-visible-pages", "stopReason": "Synthetic complete visible window",
                   "observations": [{"id": account["id"], "date": account["date"],
                                     "datePrecision": "month", "sentiment": "positive"}]},
    }
    batch = {"schemaVersion": 1, "batchId": "synthetic-test-not-release-evidence", "asOf": "2026-11-14",
             "independentReview": True, "observations": [obs]}
    dump(root, "synthetic-input.json", batch)
    return batch


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="harbor-home-care-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.batch = fixture(self.root)

    def run_cli(self, batch=None, *args):
        command = [sys.executable, "-B", str(SCRIPT), "--root", str(self.root)]
        if batch is not None:
            dump(self.root, "synthetic-input.json", batch)
            command += ["--input", str(self.root / "synthetic-input.json")]
        return subprocess.run(command + list(args), capture_output=True, text=True)

    def published(self):
        return json.loads((self.root / release.OUTPUT).read_bytes())

    def rejected(self, change):
        batch = deepcopy(self.batch)
        change(batch["observations"][0])
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertFalse((self.root / release.OUTPUT).exists(), result.stderr)

    def test_cli_redaction_replay_bytes_and_idempotence(self):
        result = self.run_cli(self.batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        before = {str(p.relative_to(self.root)): p.read_bytes()
                  for p in (self.root / release.AREA).rglob("*") if p.is_file()}
        output = (self.root / release.OUTPUT).read_bytes()
        self.assertNotIn(b"SYNTHETIC protected narrative", b"".join(before.values()) + output)
        self.assertEqual(len(self.published()["providers"][PID]["catalog"]["accounts"]), 1)
        (self.root / "synthetic-input.json").unlink()
        for args in [(), ("--check",), ()]:
            result = self.run_cli(None, *args)
            self.assertEqual(result.returncode, 0, result.stderr)
        after = {str(p.relative_to(self.root)): p.read_bytes()
                 for p in (self.root / release.AREA).rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(output, (self.root / release.OUTPUT).read_bytes())
        manifest = json.loads((self.root / release.AREA / "manifest.json").read_bytes())
        for path, digest in manifest["outputs"].items():
            self.assertEqual(hashlib.sha256((self.root / path).read_bytes()).hexdigest(), digest)
        self.assertEqual(manifest["inputs"]["originalInputSha256"],
                         hashlib.sha256(release.encoded(self.batch)).hexdigest())

    def test_missing_author_date_and_staff_exclude_accounts_with_reasons(self):
        for key, value, reason in [
            ("authorObserved", False, "missing-observed-author"),
            ("date", None, "missing-observed-date"),
            ("relationship", "staff", "staff-not-consumer"),
        ]:
            with self.subTest(key=key):
                batch = deepcopy(self.batch)
                account = batch["observations"][0]["accounts"][0]
                account[key] = value
                if key == "date":
                    account["datePrecision"] = "unknown"
                    batch["observations"][0]["window"]["observations"][0].update(
                        date=None, datePrecision="unknown")
                result = self.run_cli(batch)
                self.assertEqual(result.returncode, 0, result.stderr)
                patch = self.published()["providers"][PID]
                self.assertEqual(patch["catalog"]["accounts"], [])
                decisions = (self.root / release.AREA / "decisions.json").read_text()
                self.assertIn(reason, decisions)

    def test_explicit_text_rights_and_privacy_are_separate(self):
        batch = deepcopy(self.batch)
        obs = batch["observations"][0]
        obs["textRights"].update(decision="original-summary", evidenceSha256="c" * 64)
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(self.published()["providers"][PID]["catalog"]["accounts"][0]["summary"])
        obs["accounts"][0].update(privacyReviewed=True, text="Synthetic reviewed original summary.")
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        account = self.published()["providers"][PID]["catalog"]["accounts"][0]
        self.assertEqual(account["summary"], "Synthetic reviewed original summary.")
        self.assertEqual(account["date"], "2026-10")
        self.assertEqual(account["datePrecision"], "month")
        self.assertEqual(account["representation"], "original-summary")

    def test_unknown_text_rights_withholds_account_without_raw_text(self):
        batch = deepcopy(self.batch)
        batch["observations"][0]["textRights"]["decision"] = "unknown"
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.published()["providers"][PID]["catalog"]["accounts"], [])

    def test_no_aggregate_is_inferred_from_accounts(self):
        batch = deepcopy(self.batch)
        batch["observations"][0]["aggregate"] = None
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.published()["providers"][PID]["reviewAggregates"], [])

    def test_empty_batch_has_no_provider_patch(self):
        batch = deepcopy(self.batch)
        batch["observations"] = []
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.published()["providers"], {})

    def test_unapproved_collector_adapter_records_holds_without_publishing_or_inventing_approval(self):
        obs = self.batch["observations"][0]
        row = {key: None for key in (
            "aggregate", "googlePanelUrl", "identityMatch", "populationAssessment", "registry",
            "registryCandidates", "sourceFamily", "sourceIdentity", "structural", "visibleReviewWindow",
        )}
        row.update(providerId=PID, sourceUrl=URL, disposition="held",
                   observedAt="2026-11-14T12:00:00+00:00",
                   holdReasons=["ambiguous-population-window"],
                   currentEvidence={"bodySha256": "a" * 64, "receiptSha256": "b" * 64})
        collector = {
            "schemaVersion": 1, "collectedAt": "2026-11-14T12:01:00+00:00", "sourceFamily": "Google",
            "publisher": "MyLivingChoice", "publicationStatus": "requires-independent-review",
            "methodology": {"collectorVersion": "sanitized-html-v1"}, "accessEvidence": [],
            "records": [], "held": [row], "coverage": {}, "audit": {},
        }
        result = self.run_cli(collector)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.published()["providers"], {})
        manifest = json.loads((self.root / release.AREA / "manifest.json").read_bytes())
        public = json.loads((self.root / manifest["inputs"]["reviewedInput"]["path"]).read_bytes())
        self.assertIs(public["independentReview"], False)
        self.assertEqual(public["observations"], [])
        intake = json.loads((self.root / public["intake"]["path"]).read_bytes())
        self.assertEqual(intake["held"][0]["reasons"],
                         ["ambiguous-population-window", "requires-independent-review"])
        self.assertNotIn("aggregate", intake["held"][0])
        result = self.run_cli(None, "--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(obs["aggregate"]["count"], 6)
        self.assertEqual(self.run_cli(self.batch).returncode, 0)
        published = self.published()
        self.assertTrue(published["providers"])
        self.assertEqual(self.run_cli(collector).returncode, 0)
        self.assertEqual(self.published(), published)
        self.assertEqual(self.run_cli(None, "--check").returncode, 0)

    def test_unapproved_batch_cannot_promote_observations(self):
        batch = deepcopy(self.batch)
        batch["independentReview"] = False
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / release.OUTPUT).exists())

    def test_access_unknown_denied_and_metadata_fail_closed(self):
        for key, value in [("decision", "unknown"), ("decision", "denied"),
                           ("metadata", "unknown"), ("metadata", "denied")]:
            with self.subTest(key=key, value=value):
                self.rejected(lambda o: o["access"].update({key: value}))

    def test_wrong_identity_components_and_population_fail_closed(self):
        for key in ("name", "address", "city", "state", "zip", "officialId", "careUnit"):
            with self.subTest(key=key):
                self.rejected(lambda o: o["identity"].update({key: "WRONG"}))
        for population in ("staff", "provider-selected", "brand", "campus", "wrong-office"):
            with self.subTest(population=population):
                self.rejected(lambda o: o.update(population=population))
        self.rejected(lambda o: o.update(sourceType="provider-website"))

    def test_denied_unknown_lookalike_and_redirect_hosts(self):
        for host in ("caring.com", "care-one.com", "seniorcare.com", "yelp.com",
                     "unknown.example", "mylivingchoice.com.attacker.example"):
            with self.subTest(host=host):
                self.rejected(lambda o: o.update(checkedUrl=f"https://{host}/property/synthetic-office"))
        self.rejected(lambda o: o.update(effectiveUrl="https://caring.com/property/synthetic-office"))
        self.rejected(lambda o: o.update(checkedUrl=URL + "?redirect=https://caring.com"))
        self.rejected(lambda o: o.update(originalUrl="https://www.google.com/search?q=office"))
        self.rejected(lambda o: o["accounts"][0].update(url="https://www.google.com/"))

    def test_denial_overrides_permission_in_historical_registry(self):
        path = self.root / "research/north-jersey/reviews/source-access.json"
        policy = json.loads(path.read_bytes())
        policy["sources"].append({"host": "mylivingchoice.com", "access_decision": "restricted_no_automation",
                                  "basis": "Synthetic overriding denial"})
        dump(self.root, str(path.relative_to(self.root)), policy)
        self.rejected(lambda _: None)

    def test_denied_caring_aggregate_cannot_replace_any_released_evidence(self):
        self.assertEqual(self.run_cli(self.batch).returncode, 0)
        before = {p: p.read_bytes() for p in (self.root / release.AREA).rglob("*") if p.is_file()}
        before[self.root / release.OUTPUT] = (self.root / release.OUTPUT).read_bytes()
        policy_path = "research/north-jersey/reviews/source-access.json"
        policy = json.loads((self.root / policy_path).read_bytes())
        policy["sources"].append({
            "host": "caring.com", "access_decision": "restricted_no_automation",
            "basis": "Synthetic denial, matching the production source gate",
        })
        dump(self.root, policy_path, policy)
        batch = deepcopy(self.batch)
        obs = batch["observations"][0]
        caring = "https://www.caring.com/senior-care/new-jersey/morristown/synthetic-office"
        obs.update(checkedUrl=caring, canonicalUrl=caring, effectiveUrl=caring,
                   originalUrl=None, publisher="Caring.com", sourceFamily="caring",
                   syndication={"status": "original", "family": None}, accounts=[])
        obs["identity"]["url"] = caring
        obs["window"].update(visibleCount=0, observations=[], coverage="partial",
                             stopReason="Synthetic aggregate-only observation")
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 2)
        self.assertIn("excluded by source-access policy", result.stderr)
        after = {p: p.read_bytes() for p in (self.root / release.AREA).rglob("*") if p.is_file()}
        after[self.root / release.OUTPUT] = (self.root / release.OUTPUT).read_bytes()
        self.assertEqual(before, after)

    def test_missing_and_malformed_access_registry(self):
        path = self.root / "research/north-jersey/reviews/source-access.json"
        path.unlink()
        self.rejected(lambda _: None)
        path.write_text('{"sources":null}')
        self.rejected(lambda _: None)

    def test_non_consumer_invalid_and_selected_averages_rejected(self):
        for key, value in [("kind", "selected-average"), ("count", 0), ("count", True),
                           ("rating", 6), ("scale", 100), ("asOf", "2027-01-01")]:
            with self.subTest(key=key, value=value):
                self.rejected(lambda o: o["aggregate"].update({key: value}))
        self.rejected(lambda o: o.update(sourceFamily="independent-mirror"))
        self.rejected(lambda o: o["syndication"].update(family="apfm"))

    def test_dates_precision_and_complete_windows(self):
        for update in [{"visibleCount": 2}, {"selection": "selected-highlights"}]:
            self.rejected(lambda o: o["window"].update(update))
        self.rejected(lambda o: o["accounts"][0].update(date="2026-02-30", datePrecision="day"))
        self.rejected(lambda o: o["accounts"][0].update(date="2026-10-01"))
        self.rejected(lambda o: o.update(checkedAt="2027-01-01"))
        self.rejected(lambda o: o["identity"].update(checkedAt="2020-01-01"))

    def test_duplicate_canonical_page_and_unknown_fields(self):
        batch = deepcopy(self.batch)
        second = deepcopy(batch["observations"][0])
        second.update(id="synthetic-duplicate", canonicalUrl=URL + "/", effectiveUrl=URL + "/")
        batch["observations"].append(second)
        self.assertEqual(self.run_cli(batch).returncode, 2)
        self.assertFalse((self.root / release.OUTPUT).exists())
        self.rejected(lambda o: o["accounts"][0].update(author="Do not retain author identities"))
        self.rejected(lambda o: o.update(facts=[]))

    def test_duplicate_json_keys_nonfinite_and_invalid_root(self):
        for raw in ['{"schemaVersion":1,"schemaVersion":1}', '{"rating":NaN}', "null"]:
            (self.root / "bad.json").write_text(raw)
            result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--root", str(self.root),
                                     "--input", str(self.root / "bad.json")], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertFalse((self.root / release.OUTPUT).exists())

    def test_output_drift_never_overwrites_user_work(self):
        result = self.run_cli(self.batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        path = self.root / release.OUTPUT
        path.write_bytes(b"USER WORK\n")
        for args in [(), ("--check",)]:
            result = self.run_cli(None, *args)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(path.read_bytes(), b"USER WORK\n")

    def test_unknown_preexisting_output_is_preserved(self):
        path = self.root / release.OUTPUT
        path.write_bytes(b"UNKNOWN USER WORK\n")
        result = self.run_cli(self.batch)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(path.read_bytes(), b"UNKNOWN USER WORK\n")
        self.assertFalse((self.root / release.AREA / "batches").exists())

    def test_immutable_reviewed_input_and_dependency_drift(self):
        result = self.run_cli(self.batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.root / release.AREA / "manifest.json").read_bytes())
        path = self.root / manifest["inputs"]["reviewedInput"]["path"]
        path.write_bytes(path.read_bytes() + b" ")
        result = self.run_cli(None, "--check")
        self.assertEqual(result.returncode, 2)
        self.assertIn("hash drift", result.stderr)

    def test_official_raw_provenance_is_bound(self):
        (self.root / "research/north-jersey/state/raw/firms.xlsx").write_bytes(b"DRIFT")
        self.rejected(lambda _: None)

    def test_account_year_precision_is_not_promoted_to_day(self):
        batch = deepcopy(self.batch)
        obs = batch["observations"][0]
        obs["accounts"][0].update(date="2025", datePrecision="year")
        obs["window"]["observations"][0].update(date="2025", datePrecision="year")
        result = self.run_cli(batch)
        self.assertEqual(result.returncode, 0, result.stderr)
        account = self.published()["providers"][PID]["catalog"]["accounts"][0]
        self.assertEqual((account["date"], account["datePrecision"]), ("2025", "year"))


class ReleasedEvidenceTests(unittest.TestCase):
    def test_initial_immutable_batch_and_every_released_item_are_preserved(self):
        root = SCRIPT.resolve().parents[2]
        digest = "9ee38a254d29849c1397f4095d39cb48964de8923c972c7aee0f33f6f94627ff"
        raw = (root / release.AREA / "batches" / (digest + ".json")).read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), digest)
        initial = release.parse(raw)
        inputs = release.Inputs(root)
        offices = release.office_roster(inputs)
        errors = []
        old = release.historical()
        _, policy = old.source_access(root, errors)
        self.assertEqual(errors, [])
        _, expected, _ = release.validate_batch(initial, offices, policy, old)
        manifest = inputs.read(release.AREA / "manifest.json")
        current = inputs.read(manifest["inputs"]["reviewedInput"]["path"])
        self.assertEqual(hashlib.sha256(inputs.data(manifest["inputs"]["reviewedInput"]["path"])).hexdigest(),
                         manifest["inputs"]["reviewedInput"]["sha256"])
        for observation in initial["observations"]:
            self.assertIn(observation, current["observations"])
        published = inputs.read(release.OUTPUT)["providers"]
        for pid, patch in expected.items():
            self.assertEqual(published[pid]["identity"], patch["identity"])
            for key in ("sources", "reviewAggregates", "reviews", "reviewSamples", "notes"):
                for item in patch[key]:
                    self.assertIn(item, published[pid][key], (pid, key))
            for key in ("accounts", "sources", "notes"):
                for item in patch["catalog"][key]:
                    self.assertIn(item, published[pid]["catalog"][key], (pid, "catalog", key))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture":
        fixture(Path(sys.argv[2]))
    else:
        unittest.main()
