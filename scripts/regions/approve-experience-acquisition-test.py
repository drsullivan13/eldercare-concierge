#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "approve_acquisition", Path(__file__).with_name("approve-experience-acquisition.py"))
APPROVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APPROVE)


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.copy(APPROVE.INDEX)
        self.index = self.load(APPROVE.INDEX)
        self.copy(self.index["baselineAliases"]["path"])
        for reference in self.index["batches"]:
            self.copy(reference["path"])
            batch = self.load(reference["path"])
            for key in ("proposals", "reviewed", "access", "aliases"):
                if key in batch:
                    self.copy(batch[key]["path"])
            for key in ("sources", "checks", "identities"):
                for evidence in batch.get(key, {}).values():
                    self.copy(evidence["path"])
            for evidence in batch.get("evidence", []):
                self.copy(evidence["path"])
            proposals = self.load(batch["proposals"]["path"])
            proposals = (proposals["batches"][0]["approvals"] if batch["mode"] == "released"
                         else proposals["approvals"])
            for proposal in proposals:
                for key in ("streetCorroboration", "careUnitCorroboration"):
                    if key not in proposal:
                        continue
                    self.copy(proposal[key]["path"])
                    proof = self.load(proposal[key]["path"])
                    for primary in proof["primarySources"]:
                        self.copy(primary["path"])
        self.second_ref = self.index["batches"][1]
        self.second = self.load(self.second_ref["path"])

    def copy(self, relative):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(APPROVE.ROOT / relative, target)

    def load(self, relative):
        return json.loads((self.root / relative).read_bytes())

    def write(self, relative, value):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(APPROVE.release.encoded(value))

    def reference(self, relative):
        return {"path": str(relative), "sha256": APPROVE.release.digest((self.root / relative).read_bytes())}

    def mutate(self, reference, change):
        value = self.load(reference["path"])
        change(value)
        self.write(reference["path"], value)
        reference.update(self.reference(reference["path"]))
        self.write(self.second_ref["path"], self.second)
        self.second_ref.update(self.reference(self.second_ref["path"]))
        self.write(APPROVE.INDEX, self.index)

    def approvals(self, outputs):
        return json.loads(outputs[APPROVE.release.ACQUISITION_LEDGER])["batches"]

    def test_public_inputs_reproduce_checks_without_private_captures(self):
        outputs = APPROVE.build(self.root)
        self.assertEqual(outputs, APPROVE.build(self.root))
        for path, data in outputs.items():
            self.assertEqual(data, (APPROVE.ROOT / path).read_bytes(), str(path))
        batches = self.approvals(outputs)
        self.assertEqual({b["id"]: len(b["approvals"]) for b in batches}, {
            "mylivingchoice-avalon-cupola": 1, "mylivingchoice-direct-review": 11,
            "mylivingchoice-second-wave": 21, "mylivingchoice-sinai-newark": 1,
            "mylivingchoice-third-wave-clinical": 1, "mylivingchoice-six-sites": 2,
            "mylivingchoice-four-nj-nursing": 2,
        })
        first = next(b for b in batches if b["id"] == "mylivingchoice-direct-review")
        self.assertEqual(sum(a["aggregate"]["count"] for a in first["approvals"]), 1359)
        sinai_batch = next(b for b in batches if b["id"] == "mylivingchoice-sinai-newark")
        sinai = sinai_batch["approvals"][0]
        self.assertEqual(sinai["providerId"], "north-jersey-doh-nj60713")
        self.assertEqual(sinai["officialId"], "NJ60713")
        self.assertEqual(sinai["identity"], {
            "name": "Sinai Post-Acute Nursing & Rehab Center",
            "address": "65 Jay Street", "city": "Newark", "state": "New Jersey",
            "zip": "07103", "careUnit": "Skilled Nursing / Long Term Care",
        })
        self.assertEqual(sinai["aggregate"]["count"], 131)
        checks = [json.loads(data) for path, data in outputs.items()
                  if path.parent.name == "independent-checks"]
        self.assertEqual(sum(c["reviewSample"]["visibleCount"] for c in checks), 185)
        for check in checks:
            if check["providerId"] == "cms-317009":
                self.assertEqual(check["identity"]["zip"], "07018")
                self.assertEqual(check["identity"]["publishedCcn"], "317009")
            elif check["providerId"] == "north-jersey-doh-nj60713":
                self.assertEqual(check["identity"], sinai["identity"])
                self.assertEqual(check["officialId"], "NJ60713")
                self.assertEqual(check["aggregate"]["count"], 131)
                self.assertEqual(check["reviewSample"]["visibleCount"], 5)
            elif check["providerId"] == "cms-315291":
                self.assertEqual(check["identity"]["address"], "2020 NJ-23")
                self.assertEqual(check["identity"]["zip"], "07470")
                self.assertEqual(check["aggregate"]["rating"], 4.5)
                self.assertEqual(check["aggregate"]["count"], 149)
                self.assertEqual(check["reviewSample"]["observations"], [
                    {"id": "mlc-google-" + rid, "date": month, "sentiment": "positive"}
                    for rid, month in [
                        ("312150", "2026-05"), ("312151", "2026-05"), ("312148", "2026-04"),
                        ("312152", "2026-04"), ("312149", "2026-03"),
                    ]
                ])
            elif check["providerId"] in {"north-jersey-doh-nj70a002", "north-jersey-doh-nj60729"}:
                self.assertEqual(check["identity"]["zip"],
                                 "07470" if check["providerId"].endswith("nj70a002") else "07009")
            elif check["providerId"] in {"north-jersey-doh-nj60708", "north-jersey-doh-nj60228"}:
                self.assertEqual(check["identity"]["zip"],
                                 "07039" if check["providerId"].endswith("nj60708") else "07652")
            else:
                self.assertIsNone(check["identity"]["zip"])
            self.assertIsNone(check["aggregate"]["asOf"])
            self.assertEqual(check["aggregate"]["sourceFamily"], "google")
            self.assertNotIn("reviews", check)

    def test_four_nj_preserves_original_aggregates_care_units_and_complete_windows(self):
        reference = next(r for r in self.index["batches"] if "/four-nj-nursing/" in r["path"])
        batch = self.load(reference["path"])
        decisions = self.load(batch["reviewed"]["path"])
        independent = self.load(decisions["independentReview"]["path"])
        by_url = {row["url"]: row for row in independent["results"]}
        expected = {
            "elizabeth-nursing-and-rehab-center": (4.8, 358, "07202"),
            "inglemoor-rehabilitation-and-care-center": (4.2, 65, "07039"),
            "new-jersey-veterans-memorial-home-at-paramus": (3.8, 38, "07652"),
            "livingston-post-acute-care": (4.3, 526, "07039"),
        }
        self.assertEqual(set(batch["sources"]), set(expected))
        for slug, reference in batch["sources"].items():
            with self.subTest(slug=slug):
                source = self.load(reference["path"])
                collection = self.load(source["collection"]["path"])
                page = collection["page"]
                window = page["visibleReviewWindow"]
                self.assertTrue(window["complete"])
                self.assertEqual(window["rowCount"], 5)
                self.assertEqual(window["htmlArticleCount"], 5)
                self.assertEqual(window["unparsedArticleCount"], 0)
                self.assertEqual(source["identity"]["careUnit"], "Skilled Nursing / Long Term Care")
                self.assertEqual(source["listingAnnotations"]["careTypes"],
                                 ["Skilled Nursing / Long Term Care"])
                self.assertEqual(source["identity"],
                                 {**page["sourceIdentity"], "careUnit": "Skilled Nursing / Long Term Care"})
                self.assertEqual((source["aggregate"]["rating"], source["aggregate"]["count"],
                                  source["identity"]["zip"]), expected[slug])
                self.assertEqual(source["aggregate"]["rating"], page["aggregate"]["rating"])
                self.assertEqual(source["aggregate"]["count"], page["aggregate"]["count"])
                self.assertEqual(source["aggregate"]["sourceFamily"], "google")
                self.assertIsNone(source["aggregate"]["asOf"])
                self.assertEqual([(r["id"], r["date"]) for r in source["population"]["rows"]],
                                 [("mlc-google-" + r["sourceReviewId"], r["datePublished"])
                                  for r in window["rows"]])
                editorial = by_url[source["url"]]
                self.assertEqual([(r["id"], r["date"], r["sentiment"], r["relationship"])
                                  for r in source["population"]["rows"]],
                                 [("mlc-google-" + r["id"], r["date"], r["sentiment"], r["relationship"])
                                  for r in editorial["visibleAccounts"]])
                self.assertEqual([r["sourceReviewUrl"] for r in window["rows"]],
                                 [r["originalReviewUrl"] for r in editorial["visibleAccounts"]])
                self.assertEqual(source["scopeHold"] is None, editorial["recipientProviderId"] is not None)

    def test_four_nj_holds_do_not_disappear_after_identity_corroboration(self):
        reference = next(r for r in self.index["batches"] if "/four-nj-nursing/" in r["path"])
        batch = self.load(reference["path"])
        decisions = self.load(batch["reviewed"]["path"])
        self.assertEqual({r[1] for r in decisions["approvals"]},
                         {"north-jersey-doh-nj60708", "north-jersey-doh-nj60228"})
        held = {r["providerId"]: r for r in decisions["withheld"]}
        self.assertEqual(set(held), {"north-jersey-doh-nj62007x", "north-jersey-doh-njnh07001"})
        self.assertEqual(held["north-jersey-doh-nj62007x"]["blockers"][0]["gate"], "population")
        self.assertEqual(held["north-jersey-doh-njnh07001"]["blockers"][0]["gate"],
                         "historical-license-and-unit")
        independent = self.load(decisions["independentReview"]["path"])
        by_slug = {r["url"].split("/")[-1]: r for r in independent["results"]}
        elizabeth = by_slug["elizabeth-nursing-and-rehab-center"]["additionalPrimaryPopulationConcern"]
        self.assertTrue(elizabeth["notInMirrorWindow"])
        self.assertEqual(elizabeth["includedIn358"], "unknown")
        livingston = by_slug["livingston-post-acute-care"]
        self.assertEqual(livingston["visibleAccounts"][2]["sentiment"], "negative")
        self.assertEqual(livingston["visibleAccounts"][4]["sentiment"], "mixed")
        self.assertIn("solicitationConcern", livingston["visibleAccounts"][4])
        self.second_ref, self.second = reference, batch
        batch["evidence"] = [batch["reviewed"] if r["path"] == batch["reviewed"]["path"] else r
                             for r in batch["evidence"]]
        held_row = held["north-jersey-doh-njnh07001"]
        identity = held_row["identity"]
        row = [held_row["slug"], held_row["providerId"], identity["name"], identity["address"],
               identity["city"], identity["careUnit"], identity["zip"], 4.3, 526,
               [[r["id"].removeprefix("mlc-google-"), r["date"], r["sentiment"]]
                for r in held_row["rows"]]]
        def approve_held(document):
            document["withheld"] = [r for r in document["withheld"]
                                    if r["providerId"] != held_row["providerId"]]
            document["approvals"].append(row)
        self.mutate(batch["reviewed"], approve_held)
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "unresolved source hold"):
            APPROVE.build(self.root)

    def test_four_nj_primary_identity_and_held_material_are_hash_bound(self):
        reference = next(r for r in self.index["batches"] if "/four-nj-nursing/" in r["path"])
        batch = self.load(reference["path"])
        evidence = {r["path"]: r for r in batch["evidence"]}
        for identity in batch["identities"].values():
            witness = self.load(identity["path"])
            cms = witness["cmsSource"]["retainedFields"]
            state = witness["stateSource"]
            self.assertEqual(cms["cms_certification_number_ccn"], witness["cmsCcn"])
            self.assertEqual(cms["telephone_number"], state["phone"])
            self.assertEqual(int(cms["number_of_certified_beds"]), state["licensedBeds"])
            self.assertEqual(cms["zip_code"], state["zip"])
            self.assertEqual(state["sourceUrl"].split("=")[-1], witness["officialId"])
            self.assertEqual(witness["httpStatus"], 200)
            self.assertEqual(witness["inspection"], "full-page")
        paths = [r["path"] for r in batch["identities"].values()]
        paths.extend(r["path"] for r in batch["sources"].values())
        paths.extend(r["path"] for r in batch["evidence"] if
                     "/collection/" in r["path"] or r["path"].endswith("nursing-editorial.json"))
        for path in paths:
            with self.subTest(path=path):
                self.assertIn(path, evidence)
                original = (self.root / path).read_bytes()
                self.write(path, {})
                with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Source hash drift"):
                    APPROVE.build(self.root)
                (self.root / path).write_bytes(original)

    def test_four_nj_public_notes_are_concise_and_do_not_replace_provenance(self):
        reference = next(r for r in self.index["batches"] if "/four-nj-nursing/" in r["path"])
        batch = self.load(reference["path"])
        decisions = self.load(batch["reviewed"]["path"])
        outputs = APPROVE.build(self.root)
        compiled = next(b for b in self.approvals(outputs) if b["id"] == batch["id"])
        self.assertEqual(len(compiled["approvals"]), 2)
        for approval in compiled["approvals"]:
            slug = approval["url"].split("/")[-1]
            note = approval["reason"]
            self.assertEqual(note, decisions["publicPopulationNotes"][slug])
            self.assertLessEqual(len(note.split()), 90)
            self.assertNotRegex(note, r"mlc-google-|609\d{3}|threshold|730|gate|north-jersey-doh-")
            self.assertIn("five", note)
            self.assertIn("unknown", note)
            self.assertIn("unverified", note)
            material = json.loads(outputs[Path(approval["material"]["path"])])
            self.assertIn(decisions["independentReview"], material["evidence"])
            self.assertEqual(material["reviewSample"]["visibleCount"], 5)
        self.second_ref, self.second = reference, batch
        batch["evidence"] = [batch["reviewed"] if r["path"] == batch["reviewed"]["path"] else r
                             for r in batch["evidence"]]
        self.mutate(batch["reviewed"], lambda d: d["publicPopulationNotes"].__setitem__(
            "inglemoor-rehabilitation-and-care-center", ""))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Missing public population note"):
            APPROVE.build(self.root)

    def test_four_nj_addition_preserves_every_prior_compiled_approval_and_alias(self):
        full = APPROVE.build(self.root)
        self.write(APPROVE.INDEX, {**self.index, "batches": [
            r for r in self.index["batches"] if "/four-nj-nursing/" not in r["path"]]})
        before = APPROVE.build(self.root)
        after_batches = {b["id"]: b for b in self.approvals(full)}
        for batch in self.approvals(before):
            self.assertEqual(batch, after_batches[batch["id"]])
        for path, data in before.items():
            if path not in (APPROVE.ALIASES, APPROVE.release.ACQUISITION_LEDGER):
                self.assertEqual(data, full[path], str(path))
        before_aliases = json.loads(before[APPROVE.ALIASES])
        new_aliases = [r for r in json.loads(full[APPROVE.ALIASES]) if r not in before_aliases]
        self.assertEqual({r["providerId"] for r in new_aliases},
                         {"north-jersey-doh-nj60708", "north-jersey-doh-nj60228"})

    def test_all_first_wave_approval_meaning_is_preserved(self):
        batch = self.load(self.index["batches"][0]["path"])
        original = self.load(batch["proposals"]["path"])["batches"][0]
        current = next(b for b in self.approvals(APPROVE.build(self.root)) if b["id"] == original["id"])
        self.assertEqual(original["id"], current["id"])
        for before, after in zip(original["approvals"], current["approvals"], strict=True):
            for key in before.keys() - {"observation", "material"}:
                self.assertEqual(before[key], after[key], key)

    def test_avalon_cupola_decisions_cover_complete_independent_populations(self):
        reference = next(r for r in self.index["batches"] if "/avalon-cupola/" in r["path"])
        batch = self.load(reference["path"])
        decisions = self.load(batch["reviewed"]["path"])
        self.assertEqual([row[1] for row in decisions["approvals"]], ["cms-315291"])
        self.assertEqual([row["providerId"] for row in decisions["withheld"]],
                         ["north-jersey-doh-nj5a000"])
        held = decisions["withheld"][0]
        self.assertEqual(held["identity"]["address"], "W. 100 W Ridgewood Ave")
        self.assertEqual(held["aggregate"]["scope"], "ambiguous")
        self.assertEqual(held["aggregate"]["count"], 59)
        independent = self.load(decisions["independentReview"]["path"])
        populations = {row["providerId"]: row for row in independent["locations"]}
        self.assertEqual([r["relationship"] for r in populations["cms-315291"]["rows"]],
                         ["resident", "family", "family", "resident", "resident"])
        self.assertEqual([r["relationship"] for r in populations["north-jersey-doh-nj5a000"]["rows"]],
                         ["family", "unknown", "unknown", "staff", "unknown"])
        for slug, reference in batch["sources"].items():
            source = self.load(reference["path"])
            collection = self.load(source["collection"]["path"])
            window = collection["page"]["visibleReviewWindow"]
            self.assertTrue(window["complete"])
            self.assertEqual(window["rowCount"], 5)
            self.assertEqual(window["unparsedArticleCount"], 0)
            self.assertEqual([("mlc-google-" + r["sourceReviewId"], r["datePublished"])
                              for r in window["rows"]],
                             [(r["id"], r["date"]) for r in source["population"]["rows"]])

    def test_immutable_primary_witness_hash_is_checked_by_compiler(self):
        reference = next(r for r in self.index["batches"] if "/avalon-cupola/" in r["path"])
        batch = self.load(reference["path"])
        proposal = self.load(batch["proposals"]["path"])["approvals"][0]
        proof = self.load(proposal["streetCorroboration"]["path"])
        self.write(proof["primarySources"][0]["path"], {})
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Source hash drift"):
            APPROVE.build(self.root)

    def test_six_sites_preserve_all_rows_independent_readings_and_held_access(self):
        reference = next(r for r in self.index["batches"] if "/six-sites/" in r["path"])
        batch = self.load(reference["path"])
        decisions = self.load(batch["reviewed"]["path"])
        self.assertEqual({row[1] for row in decisions["approvals"]},
                         {"north-jersey-doh-nj70a002", "north-jersey-doh-nj60729"})
        self.assertEqual({row["providerId"] for row in decisions["withheld"]}, {
            "north-jersey-doh-nj30a002", "north-jersey-doh-nj60a003", "cms-315091", "cms-315530",
        })
        independent = {}
        for reference in decisions["independentReviews"]:
            document = self.load(reference["path"])
            if isinstance(document, list):
                for row in document:
                    independent[row["source"]["url"]] = [
                        ("mlc-google-" + r["rowId"], r["month"], r["sentiment"], r["role"])
                        for r in row["rows"]]
            else:
                self.assertEqual(document["results"][0]["operatorAccess"]["decision"],
                                 "restricted; exclude operator reads from eligible corroboration")
                for row in document["results"]:
                    independent[row["url"]] = [
                        ("mlc-google-" + r["id"], r["date"], r["sentiment"], r["relationship"])
                        for r in row["visibleAccounts"]]
        for reference in batch["sources"].values():
            source = self.load(reference["path"])
            collection = self.load(source["collection"]["path"])
            window = collection["page"]["visibleReviewWindow"]
            self.assertTrue(window["complete"])
            self.assertEqual(window["unparsedArticleCount"], 0)
            self.assertEqual(window["rowCount"], 5)
            rows = source["population"]["rows"]
            self.assertEqual([(r["id"], r["date"]) for r in rows],
                             [("mlc-google-" + r["sourceReviewId"], r["datePublished"])
                              for r in window["rows"]])
            self.assertEqual([(r["id"], r["date"], r["sentiment"], r["relationship"]) for r in rows],
                             independent[source["url"]])
            self.assertEqual(source["identity"]["address"], collection["page"]["sourceIdentity"]["address"])
            self.assertEqual(source["listingAnnotations"]["careTypes"],
                             collection["page"]["structural"]["careTypes"])
            self.assertEqual(source["aggregate"]["count"], collection["page"]["aggregate"]["count"])
            self.assertEqual(source["aggregate"]["rating"], collection["page"]["aggregate"]["rating"])
            self.assertIsNone(source["aggregate"]["asOf"])
        override = decisions["coordinatorOverride"]
        self.assertEqual(override["rowId"], "629196")
        self.assertTrue(self.load(override["proof"]["path"])["reviewerNameMatchesPublishedAdministrator"])

    def test_six_sites_hold_and_dedicated_residence_evidence_are_hash_bound(self):
        reference = next(r for r in self.index["batches"] if "/six-sites/" in r["path"])
        batch = self.load(reference["path"])
        paths = [batch["sources"]["arden-courts-whippany"]["path"]]
        proposal = next(p for p in self.load(batch["proposals"]["path"])["approvals"]
                        if "careUnitCorroboration" in p)
        proof = self.load(proposal["careUnitCorroboration"]["path"])
        paths.extend(p["path"] for p in proof["primarySources"])
        for path in paths:
            with self.subTest(path=path):
                original = (self.root / path).read_bytes()
                self.write(path, {})
                with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Source hash drift"):
                    APPROVE.build(self.root)
                (self.root / path).write_bytes(original)

    def test_held_collection_hash_is_checked_without_a_publication(self):
        reference = next(r for r in self.index["batches"] if "/avalon-cupola/" in r["path"])
        batch = self.load(reference["path"])
        held = self.load(batch["sources"]["careone-at-the-cupola"]["path"])
        self.write(held["collection"]["path"], {})
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Source hash drift"):
            APPROVE.build(self.root)

    def test_cupola_population_hold_cannot_be_overridden_by_an_approval(self):
        reference = next(r for r in self.index["batches"] if "/avalon-cupola/" in r["path"])
        batch = self.load(reference["path"])
        decisions = self.load(batch["reviewed"]["path"])
        held = decisions["withheld"].pop()
        identity, aggregate = held["identity"], held["aggregate"]
        decisions["approvals"].append([
            held["slug"], held["providerId"], identity["name"], identity["address"], identity["city"],
            identity["careUnit"], identity["zip"], aggregate["rating"], aggregate["count"],
            [[r["id"].removeprefix("mlc-google-"), r["date"], r["sentiment"]] for r in held["rows"]],
        ])
        self.write(batch["reviewed"]["path"], decisions)
        batch["reviewed"].update(self.reference(batch["reviewed"]["path"]))
        self.write(reference["path"], batch)
        reference.update(self.reference(reference["path"]))
        self.write(APPROVE.INDEX, self.index)
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "unresolved source hold"):
            APPROVE.build(self.root)

    def test_rebound_historical_receipt_must_match_released_hash(self):
        reference = self.index["batches"][0]
        batch = self.load(reference["path"])
        source_reference = next(iter(batch["sources"].values()))
        source = self.load(source_reference["path"])
        source["receipts"][0]["access_decision"] = "restricted"
        self.write(source_reference["path"], source)
        for item in batch["sources"].values():
            item.update(self.reference(item["path"]))
        self.write(reference["path"], batch)
        reference.update(self.reference(reference["path"]))
        self.write(APPROVE.INDEX, self.index)
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "original release hashes"):
            APPROVE.build(self.root)

    def test_collector_replacement_has_no_effect(self):
        expected = APPROVE.build(self.root)
        mutable = APPROVE.BASE / "mylivingchoice"
        self.write(mutable / "proposed-approvals.json", {"approvals": []})
        self.write(mutable / "access-evidence.json", [])
        self.write(mutable / "source-checks/acclaim-rehabilitation-and-nursing-center.json", {})
        self.assertEqual(expected, APPROVE.build(self.root))

    def test_new_batch_is_additive_and_order_independent(self):
        full = APPROVE.build(self.root)
        self.write(APPROVE.INDEX, {**self.index, "batches": self.index["batches"][:1]})
        first = APPROVE.build(self.root)
        self.assertEqual(self.approvals(first)[0], next(
            b for b in self.approvals(full) if b["id"] == self.approvals(first)[0]["id"]))
        for path, data in first.items():
            if path not in (APPROVE.ALIASES, APPROVE.release.ACQUISITION_LEDGER):
                self.assertEqual(data, full[path])
        self.write(APPROVE.INDEX, {**self.index, "batches": list(reversed(self.index["batches"]))})
        self.assertEqual(full, APPROVE.build(self.root))

    def test_changed_frozen_bytes_fail_without_reapproval(self):
        self.write(self.second["reviewed"]["path"], {})
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Source hash drift"):
            APPROVE.build(self.root)

    def test_edited_mean_cannot_become_a_publication(self):
        self.mutate(self.second["reviewed"], lambda d: d["approvals"][0].__setitem__(6, 5.0))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "reading disagrees"):
            APPROVE.build(self.root)

    def test_omitted_critical_row_cannot_become_a_publication(self):
        self.mutate(self.second["reviewed"], lambda d: d["approvals"][0][8].pop(0))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "reading disagrees"):
            APPROVE.build(self.root)

    def test_duplicate_approval_fails(self):
        self.mutate(self.second["reviewed"], lambda d: d["approvals"].append(d["approvals"][0]))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Duplicate"):
            APPROVE.build(self.root)

    def test_all_proposals_require_a_decision(self):
        self.mutate(self.second["reviewed"], lambda d: d["withheld"].pop())
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "unreviewed"):
            APPROVE.build(self.root)

    def test_source_hold_is_not_overridden_by_approval(self):
        reference = self.second["sources"]["acclaim-rehabilitation-and-nursing-center"]
        self.mutate(reference, lambda d: d.__setitem__("scopeHold", "unresolved population"))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "unresolved source hold"):
            APPROVE.build(self.root)

    def test_restricted_access_cannot_become_a_permitted_label(self):
        self.mutate(self.second["access"],
                    lambda rows: [r.__setitem__("decision", "restricted") for r in rows])
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "not permitted"):
            APPROVE.build(self.root)

    def test_missing_identity_witness_fails(self):
        reference = self.second["identities"]["acclaim-rehabilitation-and-nursing-center"]
        (self.root / reference["path"]).unlink()
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "Missing source material"):
            APPROVE.build(self.root)

    def test_unrelated_identity_witness_cannot_authorize_alias(self):
        reference = self.second["identities"]["acclaim-rehabilitation-and-nursing-center"]
        self.mutate(reference, lambda d: d.__setitem__("sourceUrl", "https://example.com/unrelated"))
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "care-unit alias"):
            APPROVE.build(self.root)

    def test_overlapping_immutable_batches_fail(self):
        duplicate = copy.deepcopy(self.second)
        duplicate["id"] = "third-wave"
        path = APPROVE.ARCHIVE / "batches/third-wave/batch.json"
        self.write(path, duplicate)
        self.index["batches"].append(self.reference(path))
        self.write(APPROVE.INDEX, self.index)
        with self.assertRaisesRegex(APPROVE.release.ReleaseError, "across immutable batches"):
            APPROVE.build(self.root)

    def test_public_minimal_inputs_replay_canonical_release(self):
        outputs = APPROVE.build(self.root)
        for path, data in outputs.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        manifest_path = APPROVE.release.RELEASE / "manifest.json"
        manifest = json.loads((APPROVE.ROOT / manifest_path).read_bytes())
        for item in manifest["inputs"]:
            path = Path(item["path"])
            if not (self.root / path).exists():
                self.copy(path)
        self.copy(APPROVE.release.REGION / "runtime/providers.json")
        self.assertFalse((self.root / APPROVE.BASE / "mylivingchoice").exists())
        actual = APPROVE.release.build(self.root)
        for name, document in actual.items():
            expected = (APPROVE.ROOT / APPROVE.release.RELEASE / name).read_bytes()
            self.assertEqual(APPROVE.release.encoded(document), expected, name)
        after = actual["experience-verification.json"]["releasedOutput"]
        sinai = after["north-jersey-doh-nj60713"]
        self.assertEqual(sinai["value"], 6.2)
        self.assertEqual(sinai["reviewCount"], 131)
        self.assertEqual(sinai["independentSourceCount"], 1)
        self.assertNotIn("cms-315236", after)
        self.assertEqual(after["cms-315291"]["value"], 9.0)
        self.assertEqual(after["cms-315291"]["reviewCount"], 149)
        self.assertEqual(after["cms-315291"]["independentSourceCount"], 1)
        self.assertNotIn("north-jersey-doh-nj5a000", after)
        self.assertEqual(after["north-jersey-doh-nj70a002"]["value"], 9.4)
        self.assertEqual(after["north-jersey-doh-nj60729"]["value"], 7.2)
        self.assertNotIn("cms-315204", after)
        for pid, rating, count, value in [
                ("north-jersey-doh-nj60708", 4.2, 65, 8.4),
                ("north-jersey-doh-nj60228", 3.8, 38, 7.6)]:
            self.assertEqual(after[pid]["value"], value)
            self.assertEqual(after[pid]["reviewCount"], count)
            self.assertEqual(after[pid]["independentSourceCount"], 1)
            approvals = [a for b in self.approvals(outputs) for a in b["approvals"]
                         if a["providerId"] == pid]
            self.assertEqual(len(approvals), 1)
            self.assertEqual(approvals[0]["aggregate"]["rating"], rating)
            self.assertEqual(actual["locationResearch.json"][pid]["reviewAggregates"][0]["notes"][0],
                             approvals[0]["reason"])
            self.assertEqual(after[pid]["confidence"], "limited")
        self.assertFalse(after["north-jersey-doh-nj60708"]["selectedConcerns"])
        self.assertTrue(after["north-jersey-doh-nj60228"]["selectedConcerns"])
        self.assertEqual(after["north-jersey-doh-nj60228"]["sampleDiagnostics"][0]["visible"], 5)
        self.assertEqual(after["north-jersey-doh-nj60228"]["sampleDiagnostics"][0]["eligible"], 4)
        for pid in ("cms-315322", "cms-315346", "cms-315106", "cms-315526",
                    "north-jersey-doh-nj62007x", "north-jersey-doh-njnh07001",
                    "north-jersey-doh-nj07nh000", "north-jersey-doh-nj07a022"):
            self.assertNotIn(pid, after)
        paramus = next(json.loads(data) for path, data in outputs.items()
                       if path.name == "new-jersey-veterans-memorial-home-at-paramus.json")
        self.assertEqual([(r["date"], r["sentiment"]) for r in
                          paramus["reviewSample"]["observations"]],
                         [("2026-02", "negative"), ("2025-10", "positive"),
                          ("2025-06", "mixed"), ("2025-01", "positive"),
                          ("2023-02", "positive")])
        before_batch = self.load(self.index["batches"][0]["path"])
        before = self.load(before_batch["proposals"]["path"])["batches"][0]["approvals"]
        self.assertTrue(all(after[a["providerId"]]["value"] is not None for a in before))
        decisions = self.load(self.second["reviewed"]["path"])
        for row in decisions["approvals"]:
            self.assertIsNotNone(after[row[1]]["value"])
        for row in decisions["withheld"]:
            self.assertNotIn(row["providerId"], after)

    def test_actual_runtime_gains_21_and_preserves_all_67_existing_scores(self):
        baseline = json.loads((APPROVE.ROOT / APPROVE.ARCHIVE / "score-fingerprints.json").read_bytes())
        result = subprocess.run([
            "node", "--import", "tsx",
            str(APPROVE.ROOT / "tests/nj-experience-acquisition.test.ts"),
            "--snapshot", baseline["assessmentDate"],
        ], cwd=APPROVE.ROOT, capture_output=True, text=True, check=True, timeout=60)
        current = {p["providerId"]: p for p in json.loads(result.stdout)["runtimeProviders"]}
        historic_ids = json.loads((APPROVE.ROOT / "tests/fixtures/nj-experience-baseline.json").read_bytes())["providers"]
        self.assertTrue(historic_ids.keys() <= current.keys())
        current = {pid: current[pid] for pid in historic_ids}
        self.assertEqual(hashlib.sha256(json.dumps(
            sorted(current), sort_keys=True, separators=(",", ":"), ensure_ascii=True,
        ).encode("utf-8")).hexdigest(), baseline["activeProviderIdsSha256"])
        self.assertEqual(len(current), 974)
        self.assertEqual(len(baseline["scoredProviders"]), 67)
        for provider_id, expected in baseline["scoredProviders"].items():
            self.assertEqual(hashlib.sha256(json.dumps(
                current[provider_id]["experience"], sort_keys=True,
                separators=(",", ":"), ensure_ascii=True,
            ).encode("utf-8")).hexdigest(), expected, provider_id)
        before_scored = set(baseline["scoredProviders"])
        new_scored = {pid for pid, p in current.items()
                      if p["experience"]["value"] is not None and pid not in before_scored}
        decisions = self.load(self.second["reviewed"]["path"])
        self.assertEqual(new_scored, {row[1] for row in decisions["approvals"]})
        self.assertEqual(len(new_scored), 21)
        for row in decisions["withheld"]:
            self.assertIsNone(current[row["providerId"]]["experience"]["value"])

    def test_actual_runtime_releases_only_avalon_at_its_assessment_date(self):
        result = subprocess.run([
            "node", "--import", "tsx",
            str(APPROVE.ROOT / "tests/nj-experience-acquisition.test.ts"),
            "--snapshot", "2026-11-15",
        ], cwd=APPROVE.ROOT, capture_output=True, text=True, check=True, timeout=60)
        current = {p["providerId"]: p for p in json.loads(result.stdout)["runtimeProviders"]}
        avalon = current["cms-315291"]
        self.assertEqual(avalon["experience"]["value"], 9.0)
        self.assertEqual(avalon["experience"]["reviewCount"], 149)
        self.assertEqual(avalon["experience"]["independentSourceCount"], 1)
        self.assertEqual(len(avalon["reviewAggregates"]), 1)
        self.assertEqual(avalon["reviewAggregates"][0]["rating"], 4.5)
        self.assertIsNone(avalon["reviewAggregates"][0]["asOf"])
        cupola = current["north-jersey-doh-nj5a000"]
        self.assertIsNone(cupola["experience"]["value"])
        self.assertEqual(cupola["reviewAggregates"], [])

    def test_actual_six_site_delta_preserves_102_scores_and_has_one_nursing_recipient(self):
        path = APPROVE.ARCHIVE / "batches/six-sites/before-runtime-fingerprints.json"
        baseline = json.loads((APPROVE.ROOT / path).read_bytes())
        result = subprocess.run([
            "node", "--import", "tsx", str(APPROVE.ROOT / "tests/nj-experience-acquisition.test.ts"),
            "--snapshot", baseline["assessmentDate"],
        ], cwd=APPROVE.ROOT, capture_output=True, text=True, check=True, timeout=60)
        rows = json.loads(result.stdout)["runtimeProviders"]
        current = {r["providerId"]: r for r in rows}
        def fingerprint(value):
            return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                             ensure_ascii=True).encode()).hexdigest()
        self.assertEqual(len(current), baseline["providerCount"])
        self.assertEqual(fingerprint(sorted(current)), baseline["providerIdsSha256"])
        self.assertEqual(len(baseline["scoredProviders"]), 102)
        for pid, expected in baseline["scoredProviders"].items():
            self.assertEqual(fingerprint({key: current[pid][key] for key in
                                          ("experience", "reviewAggregates", "sources")}), expected, pid)
        scored = {pid for pid, row in current.items() if row["experience"]["value"] is not None}
        self.assertEqual(scored - baseline["scoredProviders"].keys()
                         - {"north-jersey-doh-nj60708", "north-jersey-doh-nj60228"},
                         {"north-jersey-doh-nj70a002", "north-jersey-doh-nj60729"})
        for pid, rating, count, value in [
                ("north-jersey-doh-nj70a002", 4.7, 53, 9.4),
                ("north-jersey-doh-nj60729", 3.6, 83, 7.2)]:
            row = current[pid]
            self.assertEqual(row["experience"]["value"], value)
            self.assertEqual(row["experience"]["independentSourceCount"], 1)
            self.assertEqual(row["experience"]["reviewCount"], count)
            self.assertEqual(len(row["reviewAggregates"]), 1)
            self.assertEqual(row["reviewAggregates"][0]["rating"], rating)
        recipients = [r["providerId"] for r in rows
                      if any("canterbury-at-cedar-grove" in a["sourceId"] for a in r["reviewAggregates"])]
        self.assertEqual(recipients, ["north-jersey-doh-nj60729"])
        for pid in ("cms-315204", "cms-315091", "cms-315530", "north-jersey-doh-nj30a002",
                    "north-jersey-doh-nj60a003", "north-jersey-doh-nj20c003",
                    "north-jersey-doh-nj14c014", "north-jersey-doh-nj60a010"):
            self.assertIsNone(current[pid]["experience"]["value"], pid)
            self.assertEqual(current[pid]["reviewAggregates"], [], pid)
        for reference in baseline["originalInputs"]:
            self.assertEqual(APPROVE.release.digest((APPROVE.ROOT / reference["path"]).read_bytes()),
                             reference["sha256"], reference["path"])


if __name__ == "__main__":
    unittest.main()
