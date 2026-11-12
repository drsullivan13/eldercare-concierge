#!/usr/bin/env python3
"""Behavioral checks for the North Jersey Facebook kit against the actual retained snapshot."""

import contextlib
import copy
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/regions/facebook-kit.py"
spec = importlib.util.spec_from_file_location("facebook_kit", SCRIPT)
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
RESEARCH = ROOT / "research/north-jersey"
TSX = ROOT / "node_modules/.bin/tsx"
AS_OF = "2026-11-12T23:59:59Z"


def original_assignment_ids():
    ids = []
    for name in ("first-facility-assignments.csv", "campus-and-office-assignments.csv"):
        with open(RESEARCH / "facebook" / name, newline="", encoding="utf-8") as stream:
            ids += [row["assignment_id"] for row in csv.DictReader(stream)]
    return ids


def cli(*args):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return kit.main(list(args))


def crosswalk_row(data, **match):
    rows = [r for r in data["crosswalk"] if all(r.get(k) == v for k, v in match.items())]
    assert len(rows) == 1, match
    return rows[0]


class SnapshotCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assignments, cls.data = kit.load(RESEARCH, kit.APP_CATALOG)
        cls.files = kit.build()
        cls.manifest = json.loads(cls.files["assignment-manifest.json"])
        cls.results = {r["assignmentId"]: r["result"] for r in cls.manifest["assignments"]}

    def fresh(self):
        return copy.deepcopy(self.data)

    def resolve(self, data, assignment_id, assignments=None):
        records = kit.reconcile(assignments or self.assignments, data)
        return {r["assignmentId"]: r["result"] for r in records}[assignment_id]

    def assertUnresolved(self, result, reason):
        self.assertEqual((result["status"], result.get("reason")), ("unresolved", reason), result)
        self.assertNotIn("providerId", result)


class ActualSnapshotTests(SnapshotCase):
    def test_all_twenty_original_assignments_are_accounted_for(self):
        ids = original_assignment_ids()
        self.assertEqual(len(ids), 20)
        self.assertEqual([r["assignmentId"] for r in self.manifest["assignments"]], ids)
        for result in self.results.values():
            if result["status"] == "exact":
                self.assertTrue(result["providerId"])
            else:
                self.assertEqual(result["status"], "unresolved")
                self.assertTrue(result["reason"] and result["detail"])
        summary = self.manifest["summary"]
        self.assertEqual(summary["exact"] + summary["unresolved"], 20)

    def test_exact_ids_are_published_records_at_the_assigned_physical_address(self):
        published = {p["id"]: p for m in json.loads(kit.APP_CATALOG.read_text()) if m["id"] == "north-jersey"
                     for p in m["providers"]}
        exact = {aid: r["providerId"] for aid, r in self.results.items() if r["status"] == "exact"}
        self.assertEqual(len(set(exact.values())), len(exact))
        for record in self.manifest["assignments"]:
            if record["result"]["status"] != "exact":
                continue
            provider = published[record["result"]["providerId"]]
            self.assertEqual(" ".join(provider["address"].split()).upper(), record["address"].upper())
            self.assertEqual(provider["zip"], record["zip"][:5])
            ccn = (provider.get("cms") or {}).get("ccn")
            if record["kind"] == "licensed_care_unit":
                expected = f"cms-{ccn}" if ccn else f"north-jersey-doh-{record['officialId'].lower()}"
                self.assertEqual(provider["id"], expected)
            elif record["kind"] == "cms_home_health_office":
                self.assertEqual(provider["id"], f"cms-{record['officialId']}")
            else:
                self.assertIsNone(ccn)

    def test_evidence_cites_the_retained_source_bytes(self):
        for record in self.manifest["assignments"]:
            source = record["result"].get("evidence", {}).get("stateSource")
            if source:
                digest = hashlib.sha256((RESEARCH / source["file"]).read_bytes()).hexdigest()
                self.assertEqual(source["sha256"], digest)

    def test_denville_assisted_living_and_nursing_units_stay_distinct(self):
        al, snf = self.results["nj-doh-NJ60A002"], self.results["nj-doh-NJ61424"]
        self.assertEqual(al["providerId"], "north-jersey-doh-nj60a002")
        self.assertEqual(snf["providerId"], "cms-315329")
        self.assertEqual(snf["evidence"]["cms"]["address"], "21 POCONO ROAD")

    def test_bayada_morristown_registration_is_not_the_cranford_cms_agency(self):
        branch, agency = self.results["nj-reg-HP0015347"], self.results["nj-hha-317020"]
        self.assertEqual(branch["providerId"], "north-jersey-hp-hp0015347")
        self.assertNotEqual(agency.get("providerId"), branch["providerId"])
        if agency["status"] == "unresolved":
            self.assertEqual(agency["reason"], "cms_agency_not_in_runtime_catalog")
            self.assertEqual(agency["candidateProviderId"], "cms-317020")
        else:
            self.assertEqual(agency["providerId"], "cms-317020")

    def test_campus_does_not_inherit_a_care_unit_identity(self):
        self.assertEqual(self.results["nj-campus-lantern-hill"]["providerId"], "north-jersey-campus-lantern-hill-07974")
        self.assertEqual(self.results["nj-campus-cedar-crest-village"]["providerId"],
                         "north-jersey-campus-cedar-crest-village-07444")

    def test_templates_are_header_only(self):
        for name in ("observations.csv", "coverage.csv"):
            rows = list(csv.reader(io.StringIO(self.files[name])))
            self.assertEqual(len(rows), 1, name)
        kit_rows = list(csv.DictReader(io.StringIO(self.files["kit.csv"])))
        self.assertEqual({r["assignment_id"] for r in kit_rows},
                         {aid for aid, r in self.results.items() if r["status"] == "exact"})
        self.assertNotIn("status", kit_rows[0])


class MismatchTests(SnapshotCase):
    def test_bad_crosswalk_id_is_not_trusted(self):
        data = self.fresh()
        crosswalk_row(data, officialId="NJ60A002")["providerId"] = "cms-315329"
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ60A002"), "provisional_id_unstable")

    def test_ambiguous_crosswalk_rows_are_not_resolved(self):
        data = self.fresh()
        data["crosswalk"].append(dict(crosswalk_row(data, officialId="NJ90A120")))
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ90A120"), "crosswalk_ambiguous")

    def test_denville_assisted_living_cannot_borrow_the_nursing_ccn(self):
        data = self.fresh()
        crosswalk_row(data, officialId="NJ60A002").update(
            {"cmsCcn": "315329", "cmsDataset": "4pq5-n9py", "cmsAddress": "21 POCONO ROAD", "providerId": "cms-315329"})
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ60A002"), "cms_category_mismatch")
        self.assertEqual(self.resolve(data, "nj-doh-NJ61424")["providerId"], "cms-315329")

    def test_assisted_living_cannot_acquire_a_nursing_ccn_even_at_the_same_address(self):
        data = self.fresh()
        assignment = copy.deepcopy(next(a for a in self.assignments if a["officialId"] == "NJ60A002"))
        nursing = next(a for a in self.assignments if a["officialId"] == "NJ61424")
        assignment["address"] = nursing["address"]
        data["ltc"]["NJ60A002"]["ADDRESS"] = data["ltc"]["NJ61424"]["ADDRESS"]
        link = crosswalk_row(data, officialId="NJ61424")
        crosswalk_row(data, officialId="NJ60A002").update(
            {key: value for key, value in link.items() if key.startswith("cms") or key == "providerId"})
        data["providers"]["cms-315329"]["category"] = "assisted-living"
        data["published"]["cms-315329"] = copy.deepcopy(data["providers"]["cms-315329"])
        self.assertUnresolved(kit.resolve(assignment, data), "cms_category_mismatch")

    def test_nursing_cms_link_requires_the_authoritative_match_basis(self):
        for basis in ("brand_name_only", None, ""):
            with self.subTest(basis=basis):
                data = self.fresh()
                crosswalk_row(data, officialId="NJ61424")["cmsMatchBasis"] = basis
                self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), "cms_match_basis_unverified")

    def test_retained_cms_identity_must_match_the_licensed_unit(self):
        changes = {
            "provider_name": ("ANOTHER NURSING UNIT", "cms_name_mismatch"),
            "provider_address": ("19 POCONO ROAD", "cms_address_mismatch"),
            "citytown": ("CHATHAM", "cms_address_mismatch"),
            "state": ("NY", "cms_address_mismatch"),
            "zip_code": ("07928", "cms_address_mismatch"),
        }
        for field, (value, reason) in changes.items():
            with self.subTest(field=field):
                data = self.fresh()
                data["cmsNursing"]["4pq5-n9py"]["315329"][0]["row"][field] = value
                crosswalk = crosswalk_row(data, officialId="NJ61424")
                if field == "provider_name":
                    crosswalk["cmsName"] = value
                elif field == "provider_address":
                    crosswalk["cmsAddress"] = value
                self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), reason)

    def test_crosswalk_cms_name_and_street_must_equal_the_retained_row(self):
        for field, value, reason in (("cmsName", "OAKS AT DENVILLE", "cms_name_mismatch"),
                                     ("cmsAddress", "19 POCONO ROAD", "cms_address_mismatch")):
            with self.subTest(field=field):
                data = self.fresh()
                crosswalk_row(data, officialId="NJ61424")[field] = value
                self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), reason)

    def test_cms_source_reference_must_match_the_retained_file_row_and_bytes(self):
        for field, value in (("cmsSourceFile", "state/raw/ltc.xlsx"), ("cmsSourceRowIndex", -1),
                             ("cmsSourceSha256", "0" * 64)):
            with self.subTest(field=field):
                data = self.fresh()
                crosswalk_row(data, officialId="NJ61424")[field] = value
                self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), "cms_source_provenance_mismatch")
            with self.subTest(missing_field=field):
                data = self.fresh()
                crosswalk_row(data, officialId="NJ61424").pop(field)
                self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), "cms_source_provenance_mismatch")

    def test_cms_source_without_crosswalk_reference_still_retains_provenance(self):
        data = self.fresh()
        row = crosswalk_row(data, officialId="NJ61424")
        expected = {key: row.pop("cmsSource" + suffix)
                    for key, suffix in (("file", "File"), ("rowIndex", "RowIndex"), ("sha256", "Sha256"))}
        result = self.resolve(data, "nj-doh-NJ61424")
        self.assertEqual(result["providerId"], "cms-315329")
        self.assertEqual({key: result["evidence"]["cms"][key] for key in expected}, expected)

    def test_runtime_address_change_is_unresolved(self):
        data = self.fresh()
        data["providers"]["north-jersey-doh-nj60a002"]["address"] = "21 POCONO ROAD DENVILLE, NJ 07834"
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ60A002"), "runtime_address_mismatch")

    def test_suite_number_is_part_of_the_physical_identity(self):
        data = self.fresh()
        data["providers"]["north-jersey-hp-hp0254700"]["address"] = "2424 MORRIS AVENUE, SUITE 108"
        self.assertUnresolved(self.resolve(data, "nj-reg-HP0254700"), "runtime_address_mismatch")
        data = self.fresh()
        row = crosswalk_row(data, officialId="HP0254700")["sourceRow"]
        data["firms"][row]["Business Address"] = "2424 MORRIS AVENUE, SUITE 108"
        self.assertUnresolved(self.resolve(data, "nj-reg-HP0254700"), "state_source_address_mismatch")

    def test_matching_name_at_another_address_is_not_a_campus_match(self):
        data = self.fresh()
        for record in data["ccrc"]["state/union/ccrc-campuses.json"]:
            if record["name"] == "Lantern Hill":
                record["address"] = "537 Mountain Avenue, New Providence, NJ 07974"
        self.assertUnresolved(self.resolve(data, "nj-campus-lantern-hill"), "state_campus_record_missing")

    def test_campus_requires_included_historical_status(self):
        for status in ("excluded", "included", None):
            with self.subTest(status=status):
                data = self.fresh()
                crosswalk_row(data, campusName="Lantern Hill")["status"] = status
                self.assertUnresolved(self.resolve(data, "nj-campus-lantern-hill"), "campus_status_mismatch")

    def test_campus_cannot_have_an_official_care_unit_id(self):
        data = self.fresh()
        crosswalk_row(data, campusName="Lantern Hill")["officialId"] = "NJ20A005"
        self.assertUnresolved(self.resolve(data, "nj-campus-lantern-hill"), "campus_official_id_present")

    def test_changed_source_hash_is_unresolved(self):
        data = self.fresh()
        crosswalk_row(data, officialId="NJ61407")["sourceSha256"] = "0" * 64
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ61407"), "source_hash_mismatch")

    def test_registered_branch_never_resolves_to_a_certified_agency(self):
        data = self.fresh()
        crosswalk_row(data, officialId="HP0015347")["providerId"] = "cms-317020"
        self.assertUnresolved(self.resolve(data, "nj-reg-HP0015347"), "registered_office_not_certified_agency")
        data = self.fresh()
        crosswalk_row(data, officialId="HP0015347")["cmsCcn"] = "317020"
        self.assertUnresolved(self.resolve(data, "nj-reg-HP0015347"), "registered_office_not_certified_agency")
        data = self.fresh()
        data["providers"]["north-jersey-hp-hp0015347"]["cms"] = {"ccn": "317020"}
        self.assertUnresolved(self.resolve(data, "nj-reg-HP0015347"), "registered_office_not_certified_agency")

    def test_two_assignments_never_share_one_provider_id(self):
        twin = dict(next(a for a in self.assignments if a["assignmentId"] == "nj-doh-NJ90A120"),
                    assignmentId="nj-doh-NJ90A120-copy")
        results = {r["assignmentId"]: r["result"] for r in kit.reconcile(self.assignments + [twin], self.fresh())}
        self.assertUnresolved(results["nj-doh-NJ90A120"], "provider_id_shared")
        self.assertUnresolved(results["nj-doh-NJ90A120-copy"], "provider_id_shared")


class CmsTransitionTests(SnapshotCase):
    def publish(self, data, provider):
        data["providers"][provider["id"]] = provider
        data["published"][provider["id"]] = copy.deepcopy(provider)

    def release_agency(self, ccn):
        inputs = json.loads((RESEARCH / "runtime/home-health-release-inputs.json").read_text())
        return next(p for p in inputs["providers"] if p["id"] == f"cms-{ccn}")

    def test_certified_agency_resolves_once_published_and_branch_stays_separate(self):
        data = self.fresh()
        self.publish(data, self.release_agency("317020"))
        self.assertEqual(self.resolve(data, "nj-hha-317020")["providerId"], "cms-317020")
        self.assertEqual(self.resolve(data, "nj-reg-HP0015347")["providerId"], "north-jersey-hp-hp0015347")

    def test_certified_agency_in_runtime_only_is_not_yet_an_app_id(self):
        data = self.fresh()
        data["providers"]["cms-317020"] = self.release_agency("317020")
        data["published"].pop("cms-317020", None)
        self.assertUnresolved(self.resolve(data, "nj-hha-317020"), "not_in_published_app_catalog")

    def test_published_agency_at_another_office_is_unresolved(self):
        data = self.fresh()
        agency = self.release_agency("317020")
        agency["address"] = "32 MAPLE AVENUE,1ST FL"
        self.publish(data, agency)
        self.assertUnresolved(self.resolve(data, "nj-hha-317020"), "runtime_address_mismatch")

    def test_provisional_unit_switches_to_cms_id_only_with_an_exact_authoritative_link(self):
        data = self.fresh()
        row = crosswalk_row(data, officialId="NJ61424")
        certified_link = copy.deepcopy(row)
        certified = data["providers"].pop("cms-315329")
        data["published"].pop("cms-315329")
        provisional = {key: value for key, value in certified.items() if key != "cms"}
        provisional["id"] = "north-jersey-doh-nj61424"
        for key in list(row):
            if key.startswith("cms"):
                row.pop(key)
        row["providerId"] = provisional["id"]
        self.publish(data, provisional)
        result = self.resolve(data, "nj-doh-NJ61424")
        self.assertEqual((result["providerId"], result["basis"]),
                         ("north-jersey-doh-nj61424", "licensed_unit_provisional"))

        row.clear()
        row.update(certified_link)
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), "runtime_provider_missing")
        data["providers"].pop(provisional["id"])
        data["published"].pop(provisional["id"])
        data["providers"][certified["id"]] = certified
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), "not_in_published_app_catalog")
        self.publish(data, certified)
        result = self.resolve(data, "nj-doh-NJ61424")
        self.assertEqual((result["providerId"], result["basis"]), ("cms-315329", "licensed_unit_cms_certified"))

    def test_cms_link_without_runtime_cms_detail_is_unresolved(self):
        data = self.fresh()
        data["providers"]["cms-315329"].pop("cms")
        self.assertUnresolved(self.resolve(data, "nj-doh-NJ61424"), "runtime_cms_identity_mismatch")


class GeneratorCliTests(unittest.TestCase):
    def test_regeneration_is_byte_identical_and_check_detects_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "kit"
            self.assertEqual(cli("--output", str(output)), 0)
            first = {p.name: p.read_bytes() for p in output.iterdir()}
            self.assertEqual(set(first), {"kit.csv", "assigned.json", "assignment-manifest.json",
                                          "observations.csv", "coverage.csv"})
            self.assertEqual(cli("--output", str(output)), 0)
            self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, first)
            self.assertEqual(cli("--output", str(output), "--check"), 0)
            (output / "kit.csv").write_text("provider_id\n")
            self.assertEqual(cli("--output", str(output), "--check"), 1)

    def test_generated_kit_matches_the_current_local_snapshot(self):
        self.assertEqual(cli("--check"), 0)

    def test_changed_cms_source_bytes_invalidate_the_crosswalk_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            research = Path(tmp) / "research"
            crosswalk = json.loads((RESEARCH / "runtime/crosswalk.json").read_text())
            row = next(r for r in crosswalk if r.get("officialId") == "NJ61424")
            source = Path(row["cmsSourceFile"])
            for depth, part in enumerate(source.parts):
                original = RESEARCH.joinpath(*source.parts[:depth])
                target = research.joinpath(*source.parts[:depth])
                target.mkdir()
                for entry in original.iterdir():
                    if entry.name != part:
                        (target / entry.name).symlink_to(entry)
            (research / source).write_bytes((RESEARCH / source).read_bytes() + b"\n")
            output = Path(tmp) / "kit"
            self.assertEqual(cli("--research", str(research), "--output", str(output)), 0)
            manifest = json.loads((output / "assignment-manifest.json").read_text())
            result = next(r["result"] for r in manifest["assignments"] if r["assignmentId"] == "nj-doh-NJ61424")
            self.assertEqual((result["status"], result["reason"]), ("unresolved", "cms_source_provenance_mismatch"))

    def test_runtime_providers_must_match_the_reviewed_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            research = Path(tmp) / "research"
            research.mkdir()
            for entry in RESEARCH.iterdir():
                if entry.name != "runtime-manifest.json":
                    (research / entry.name).symlink_to(entry)
            manifest = json.loads((RESEARCH / "runtime-manifest.json").read_text())
            manifest["markets"][0]["artifacts"]["providers"]["sha256"] = "0" * 64
            (research / "runtime-manifest.json").write_text(json.dumps(manifest))
            output = Path(tmp) / "kit"
            self.assertEqual(cli("--research", str(research), "--output", str(output)), 1)
            self.assertFalse(output.exists())


@unittest.skipUnless(TSX.exists(), "node_modules/.bin/tsx is not installed")
class ImporterConsumptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.output = Path(cls.tmp) / "kit"
        assert cli("--output", str(cls.output)) == 0
        cls.assigned = json.loads((cls.output / "assigned.json").read_text())

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_importer(self, coverage, catalog=None):
        result = subprocess.run(
            [str(TSX), "scripts/import-research.ts", "--observations", str(self.output / "observations.csv"),
             "--coverage", str(coverage), "--catalog", str(catalog or self.output / "kit.csv"),
             "--assigned", str(self.output / "assigned.json"), "--as-of", AS_OF],
            cwd=ROOT, capture_output=True, text=True, timeout=120)
        return result.returncode, result.stdout, result.stderr

    def test_blank_templates_pass_scope_and_only_lack_a_run_and_coverage_rows(self):
        code, stdout, _ = self.run_importer(self.output / "coverage.csv")
        report = json.loads(stdout)
        count = len(self.assigned["providerIds"])
        self.assertEqual(code, 1)
        self.assertEqual(report["scope"]["kitProviders"], count)
        self.assertEqual(report["scope"]["assignedProviders"], count)
        self.assertEqual(report["scope"]["geography"]["state"], "NJ")
        self.assertEqual({e["code"] for e in report["errors"]}, {"assignment_mismatch", "run_mismatch"})
        self.assertEqual((report["counts"]["inputObservations"], report["counts"]["coverageRows"]), (0, 0))
        self.assertEqual(report["artifacts"], [])

    def test_kit_imports_once_a_collector_supplies_coverage(self):
        coverage = Path(self.tmp) / "filled-coverage.csv"
        header = (self.output / "coverage.csv").read_text()
        coverage.write_text(header + "".join(f"kit-test,{pid},,[],[],not_searched,0,,\n"
                                             for pid in self.assigned["providerIds"]))
        code, stdout, _ = self.run_importer(coverage)
        report = json.loads(stdout)
        self.assertEqual((code, report["ok"], report["dryRun"], report["artifacts"]), (0, True, True, []))

    def test_importer_rejects_a_forged_kit_identity(self):
        forged = Path(self.tmp) / "forged.csv"
        forged.write_text((self.output / "kit.csv").read_text().replace("SUITE 107", "SUITE 108"))
        code, stdout, stderr = self.run_importer(self.output / "coverage.csv", forged)
        self.assertEqual((code, stdout), (1, ""))
        self.assertIn("Research import failed before staging", stderr)


if __name__ == "__main__":
    unittest.main()
