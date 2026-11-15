#!/usr/bin/env python3
import copy
from contextlib import redirect_stdout
import io
import json
import os
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile

SPEC = importlib.util.spec_from_file_location("nj_coreq", Path(__file__).with_name("nj-coreq.py"))
coreq = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(coreq)


WORKBOOK = Path(os.environ.get("HARBOR_COREQ_WORKBOOK", "/tmp/harbor-nj-coreq.xlsx"))
COST_REPORT = Path(os.environ.get("HARBOR_NJ_COST_REPORT", "/tmp/harbor-nj-costreport.xlsx"))
FY26_WORKBOOK = Path(os.environ.get("HARBOR_COREQ_FY26_WORKBOOK", "/tmp/harbor-nj-coreq-fy26.xlsx"))


class CoreqCliTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="harbor-coreq-test-")
        self.addCleanup(directory.cleanup)
        self.output = Path(directory.name) / "combined.json"
        self.current = {
            "source": {"reportingYear": "FY2027"},
            "results": {"315083": {"value": 96}},
        }
        self.combined = {
            **copy.deepcopy(self.current),
            "historical": {
                "source": {"reportingYear": "FY2026"},
                "results": {"315138": {"value": 72, "raw": "0.72"}},
            },
        }

    def write(self, projection):
        body = json.dumps(projection, ensure_ascii=False, indent=2) + "\n"
        self.output.write_text(body)
        return body

    def run_cli(self, *arguments, default_output=False, projection=None):
        argv = [
            str(SPEC.origin), "--workbook", str(WORKBOOK),
            "--cost-report", str(COST_REPORT),
        ]
        if not default_output:
            argv.extend(["--output", str(self.output)])
        argv.extend(arguments)
        with (patch.object(sys, "argv", argv),
              patch.object(coreq, "OUTPUT", self.output if default_output else coreq.OUTPUT),
              patch.object(coreq, "generate", return_value=(
                  copy.deepcopy(self.current if projection is None else projection), {})),
              redirect_stdout(io.StringIO()) as stdout):
            coreq.main()
        return json.loads(stdout.getvalue())

    def test_current_only_check_leaves_identical_current_and_existing_history_untouched(self):
        body = self.write(self.combined)
        self.run_cli("--check", default_output=True)
        self.assertEqual(self.output.read_text(), body)
        changed = copy.deepcopy(self.combined)
        changed["results"]["315083"]["value"] = 95
        body = self.write(changed)
        with self.assertRaisesRegex(ValueError, "Projection differs"):
            self.run_cli("--check", default_output=True)
        self.assertEqual(self.output.read_text(), body)

    def test_current_only_rebuild_requires_workbook_for_unchanged_or_corrupt_history(self):
        histories = {
            "unchanged": self.combined["historical"],
            "changed-score": {
                **self.combined["historical"],
                "results": {"315138": {"value": 99, "raw": "0.72"}},
            },
            "changed-source": {
                **self.combined["historical"],
                "source": {"reportingYear": "FY2027"},
            },
            "missing-results": {"source": {"reportingYear": "FY2026"}},
            "empty": {},
            "null": None,
        }
        for name, historical in histories.items():
            with self.subTest(history=name):
                body = self.write({**self.current, "historical": historical})
                with self.assertRaisesRegex(ValueError, "--historical-workbook"):
                    self.run_cli()
                self.assertEqual(self.output.read_text(), body)

    def test_default_app_output_cannot_be_rebuilt_current_only(self):
        for existing in [self.combined, self.current, None]:
            with self.subTest(existing=existing is not None):
                if existing is None:
                    self.output.unlink()
                    body = None
                else:
                    body = self.write(existing)
                with self.assertRaisesRegex(ValueError, "--historical-workbook"):
                    self.run_cli(default_output=True)
                self.assertEqual(self.output.read_text() if self.output.exists() else None, body)

    def test_explicit_temporary_current_only_output_can_be_created_rebuilt_and_checked(self):
        for arguments in [(), (), ("--check",)]:
            self.run_cli(*arguments)
            self.assertEqual(json.loads(self.output.read_text()), self.current)

    def test_two_workbook_rebuild_replaces_corrupt_history_and_checks_all_results(self):
        self.write({**self.current, "historical": None})
        arguments = ("--historical-workbook", str(FY26_WORKBOOK))
        summary = self.run_cli(*arguments, default_output=True, projection=self.combined)
        self.assertEqual(json.loads(self.output.read_text()), self.combined)
        self.assertEqual(summary["historicalEmitted"], 1)
        self.run_cli(*arguments, "--check", default_output=True, projection=self.combined)
        self.write({**self.current, "historical": None})
        with self.assertRaisesRegex(ValueError, "Projection differs"):
            self.run_cli(*arguments, "--check", default_output=True, projection=self.combined)

    @unittest.skipUnless(WORKBOOK.exists() and COST_REPORT.exists(),
                         "Official workbook must be supplied separately")
    def test_normal_current_only_cli_cannot_overwrite_combined_snapshot(self):
        combined = json.loads(coreq.OUTPUT.read_text())
        self.assertIn("historical", combined)
        for corrupt in [False, True]:
            with self.subTest(corrupt=corrupt):
                snapshot = copy.deepcopy(combined)
                if corrupt:
                    result = next(iter(snapshot["historical"]["results"].values()))
                    result["value"] = -1
                body = self.write(snapshot)
                result = subprocess.run([
                    sys.executable, str(SPEC.origin),
                    "--workbook", str(WORKBOOK), "--cost-report", str(COST_REPORT),
                    "--output", str(self.output),
                ], capture_output=True, text=True, timeout=60)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("--historical-workbook", result.stderr)
                self.assertEqual(self.output.read_text(), body)


class CoreqImportTests(unittest.TestCase):
    def setUp(self):
        self.workbook = [{
            "row": 8, "name": "Acclaim Rehabilitation and Nursing Center",
            "medicaidId": "917532", "setting": "NF",
            "score": {"raw": "0.96", "kind": "n", "format": 9},
        }]
        self.cms = [{
            "cms_certification_number_ccn": "315083",
            "provider_name": "ACCLAIM REHABILITATION AND NURSING CENTER",
            "provider_type": "Medicare and Medicaid",
            "provider_address": "198 STEVENS AVE", "citytown": "JERSEY CITY",
            "state": "NJ", "zip_code": "07305",
        }]
        self.state = [{
            "row": 300, "name": self.cms[0]["provider_name"],
            "facilityId": "60909", "setting": "LONG TERM CARE FACILITY SNF/NF",
            "address": "198 Stevens Ave.", "city": "Jersey City",
            "state": "NJ", "zip": "07305",
        }]

    def project(self):
        return coreq.project(self.workbook, self.cms, self.state)

    def test_real_units_and_identity_evidence(self):
        results, withheld = self.project()
        self.assertEqual(withheld, {})
        self.assertEqual(results["315083"]["value"], 96)
        self.assertEqual(results["315083"]["cell"], "AZ8")
        self.assertEqual(results["315083"]["raw"], "0.96")
        self.assertEqual(results["315083"]["identity"]["medicaidId"], "917532")
        self.assertEqual(results["315083"]["identity"]["stateFacilityId"], "60909")

    def test_identifier_crosswalk_recovers_renames_and_rejects_collisions(self):
        self.workbook[0]["name"] = "Historical facility name"
        mapping = {"917532": ("1154081990", "315083")}
        results, _ = coreq.project(self.workbook, self.cms, [], mapping)
        self.assertEqual(results["315083"]["identity"]["npi"], "1154081990")
        self.workbook.append(dict(self.workbook[0], medicaidId="54321", row=9))
        mapping["54321"] = ("1154081990", "315083")
        self.assertEqual(coreq.project(self.workbook, self.cms, [], mapping)[0], {})

    def test_official_identifier_is_preferred_even_when_names_match(self):
        mapping = {"917532": ("1154081990", "315083")}
        results, _ = coreq.project(self.workbook, self.cms, self.state, mapping)
        self.assertEqual(results["315083"]["identity"]["method"], "NJ-Medicaid-ID-to-NPI-to-CCN")
        self.assertEqual(results["315083"]["identity"]["npi"], "1154081990")

    def test_mixed_identifier_and_name_matches_cannot_overwrite_one_certified_result(self):
        other = copy.deepcopy(self.workbook[0])
        other.update(name="Historical name", medicaidId="54321", row=9)
        self.workbook.append(other)
        mapping = {"54321": ("1154081990", "315083")}
        for score in ["0.5", "NS"]:
            with self.subTest(score=score):
                other["score"]["raw"] = score
                results, withheld = coreq.project(self.workbook, self.cms, self.state, mapping)
                self.assertEqual(results, {})
                self.assertEqual(len(withheld["ambiguous-certified-result"]), 2)

    def test_identifier_matching_still_rejects_wrong_setting_state_ccn_and_conflicts(self):
        mapping = {"917532": ("1154081990", "315083")}
        for row, field, value in [
            (self.workbook[0], "setting", "SCNF"),
            (self.cms[0], "state", "MA"),
            (self.cms[0], "provider_type", "Home Health"),
            (self.cms[0], "cms_certification_number_ccn", "317001"),
        ]:
            with self.subTest(field=field, value=value):
                original = row[field]
                row[field] = value
                self.assertEqual(coreq.project(self.workbook, self.cms, self.state, mapping)[0], {})
                row[field] = original
        for npi, ccn in [("", "315083"), ("1154081990", "317001"), ("1154081990", "225083")]:
            self.assertEqual(coreq.project(self.workbook, self.cms, self.state,
                                          {"917532": (npi, ccn)})[0], {})
        other = dict(self.cms[0], cms_certification_number_ccn="315029", provider_name="Another home")
        self.cms.append(other)
        self.assertEqual(coreq.project(self.workbook, self.cms, self.state,
                                      {"917532": ("1154081990", "315029")})[0], {})

    def test_real_zero_is_not_missing(self):
        self.workbook[0]["score"]["raw"] = "0"
        self.assertEqual(self.project()[0]["315083"]["value"], 0)

    def historical(self, current=None, historical=None, published=None):
        return coreq.project_historical(
            current if current is not None else self.workbook,
            historical if historical is not None else self.workbook,
            self.cms, self.state, {"917532": ("1154081990", "315083")},
            published or {},
        )[0]

    def test_history_keeps_current_suppression_and_real_zero(self):
        old = copy.deepcopy(self.workbook)
        old[0]["score"]["raw"] = "0"
        for code in ["NS", "NA", "N/A", "NE"]:
            with self.subTest(code=code):
                self.workbook[0]["score"] = {"raw": code, "kind": "s", "format": 9}
                result = self.historical(historical=old)["315083"]
                self.assertEqual(result["value"], 0)
                self.assertEqual(result["currentSuppression"]["raw"], code)
                self.assertEqual(result["currentSuppression"]["reportingYear"], "FY2027")
                self.assertEqual(result["currentSuppression"]["cell"], "AZ8")
        for code in ["", "---", "*", "NaN", "0", "0.96"]:
            self.workbook[0]["score"]["raw"] = code
            self.assertEqual(self.historical(historical=old), {})

    def test_published_current_values_including_zero_always_win(self):
        old = copy.deepcopy(self.workbook)
        self.workbook[0]["score"]["raw"] = "NS"
        for value in [0, 96]:
            self.assertEqual(self.historical(historical=old, published={"315083": {"value": value}}), {})

    def test_historical_suppressions_are_not_backfilled(self):
        old = copy.deepcopy(self.workbook)
        self.workbook[0]["score"]["raw"] = "NS"
        for code in ["NS", "NA", "N/A", "NE", "", "---", "*"]:
            old[0]["score"] = {"raw": code, "kind": "s", "format": 9}
            self.assertEqual(self.historical(historical=old), {})

    def test_indeterminate_cross_year_identities_stay_unpublished(self):
        old = copy.deepcopy(self.workbook)
        self.workbook[0]["score"]["raw"] = "NS"
        for changes in [
            {"medicaidId": "999999"}, {"setting": "SCNF"}, {"name": "Different payment unit"},
        ]:
            current = [{**self.workbook[0], **changes}]
            self.assertEqual(self.historical(current=current, historical=old), {})
        for duplicate in [
            dict(self.workbook[0]),
            dict(self.workbook[0], medicaidId="999999"),
            dict(self.workbook[0], name="Another payment unit"),
        ]:
            self.assertEqual(self.historical(current=self.workbook + [duplicate], historical=old), {})
        self.assertEqual(coreq.project_historical(
            self.workbook, old, self.cms, self.state, {}, {})[0], {})
        self.cms[0]["state"] = "NY"
        self.assertEqual(self.historical(historical=old), {})

    def test_history_requires_one_licensed_nursing_unit_at_the_certified_address(self):
        old = copy.deepcopy(self.workbook)
        self.workbook[0]["score"]["raw"] = "NS"
        self.state[0]["name"] = "Renamed licensed nursing home"
        self.assertEqual(self.historical(historical=old)["315083"]["identity"]["stateFacilityId"], "60909")
        assisted = dict(self.state[0], facilityId="AL-ID", setting="ASSISTED LIVING RESIDENCE")
        self.state.append(assisted)
        self.assertIn("315083", self.historical(historical=old))
        self.state.append(dict(self.state[0], facilityId="OTHER-NF"))
        self.assertEqual(self.historical(historical=old), {})
        self.state.pop()
        self.state[0]["address"] = "Wrong street"
        self.assertEqual(self.historical(historical=old), {})
        self.state.clear()
        self.assertEqual(self.historical(historical=old), {})

    def test_sentinels_non_numeric_invalid_units_and_bounds_are_withheld(self):
        for value in ["NS", "NE", "N/A", "NA", "---", "*", "", "NaN", "Infinity",
                      "-0.01", "1.01", "95", "true"]:
            with self.subTest(value=value):
                self.workbook[0]["score"]["raw"] = value
                results, withheld = self.project()
                self.assertEqual(results, {})
                self.assertIn("unreported-or-invalid-composite", withheld)
        self.workbook[0]["score"]["raw"] = "0"
        for kind, number_format in [("s", 9), ("b", 9), ("e", 9), ("n", 0), ("n", 10)]:
            with self.subTest(kind=kind, number_format=number_format):
                self.workbook[0]["score"].update(kind=kind, format=number_format)
                self.assertEqual(self.project()[0], {})

    def test_uniqueness_is_statewide_and_precedes_setting_or_sentinel_filtering(self):
        duplicate = copy.deepcopy(self.workbook[0])
        duplicate.update(row=331, name="ACCLAIM REHABILITATION & NURSING CENTER",
                         medicaidId="999999", setting="SCNF")
        duplicate["score"]["raw"] = "NS"
        self.workbook.append(duplicate)
        # Punctuation is removed, but words such as AND are never guessed.
        self.assertIn("315083", self.project()[0])
        duplicate["name"] = "ACCLAIM REHABILITATION AND NURSING CENTER "
        results, withheld = self.project()
        self.assertEqual(results, {})
        self.assertEqual(len(withheld["ambiguous-workbook-identity"]), 2)

    def test_duplicate_medicaid_ids_and_certified_ccns_are_withheld(self):
        other = copy.deepcopy(self.workbook[0])
        other["name"] = "Another payment unit"
        self.workbook.append(other)
        self.assertEqual(self.project()[0], {})
        self.workbook.pop()
        other = copy.deepcopy(self.cms[0])
        other["provider_name"] = "Another nursing home"
        self.cms.append(other)
        self.assertEqual(self.project()[0], {})

    def test_both_official_name_registries_must_be_unique_even_across_settings(self):
        for collection, name_key in [(self.cms, "provider_name"), (self.state, "name")]:
            duplicate = copy.deepcopy(collection[0])
            duplicate.update(state="NY", setting="ASSISTED LIVING RESIDENCE")
            collection.append(duplicate)
            self.assertEqual(self.project()[0], {})
            collection.pop()
            original = collection[0][name_key]
            collection[0][name_key] = original + " EAST"
            self.assertEqual(self.project()[0], {})
            collection[0][name_key] = original

    def test_wrong_setting_state_ccn_or_address_never_inherits_a_result(self):
        changes = [
            (self.workbook[0], "setting", "SCNF"),
            (self.cms[0], "state", "MA"),
            (self.cms[0], "provider_type", "Home Health"),
            (self.cms[0], "cms_certification_number_ccn", "317001"),
            (self.cms[0], "cms_certification_number_ccn", "225083"),
            (self.state[0], "state", "NY"),
            (self.state[0], "setting", "ASSISTED LIVING RESIDENCE"),
            (self.state[0], "address", "200 STEVENS AVE"),
            (self.state[0], "city", "NEWARK"),
            (self.state[0], "zip", "07101"),
        ]
        for row, field, value in changes:
            with self.subTest(field=field, value=value):
                original = row[field]
                row[field] = value
                self.assertEqual(self.project()[0], {})
                row[field] = original

    @unittest.skipUnless(WORKBOOK.exists() and COST_REPORT.exists(),
                         "Official workbook must be supplied separately")
    def test_official_workbook_cells_definition_and_full_statewide_identity(self):
        path = WORKBOOK
        rows = coreq.read_workbook(path)
        self.assertEqual(len(rows), 370)
        acclaim = next(row for row in rows if row["row"] == 8)
        self.assertEqual(acclaim["name"], "ACCLAIM REHABILITATION AND NURSING CENTER")
        self.assertEqual(acclaim["medicaidId"], "917532")
        self.assertEqual(acclaim["score"], {"raw": "0.96", "kind": "n", "format": 9})
        cover = coreq.xlsx_rows(path, "SFY27 Cover sheet")
        self.assertIn("long-stay residents and their families",
                      coreq.raw(next(row for row in cover if row["row"] == 32), "A"))
        self.assertIn("85%", coreq.raw(next(row for row in cover if row["row"] == 34), "A"))
        projection, withheld = coreq.generate(path, COST_REPORT)
        self.assertEqual(coreq.certified_identities(COST_REPORT)["917532"],
                         ("1154081990", "315083"))
        self.assertEqual(projection["results"]["315083"]["value"], 96)
        self.assertEqual(projection["source"]["unit"], "percent")
        self.assertEqual(projection["source"]["surveyPeriod"], None)
        self.assertEqual(projection["source"]["sampleSize"], None)
        self.assertFalse(any(result["identity"]["workbookName"] == "ALARIS HEALTH AT CEDAR GROVE"
                             for result in projection["results"].values()))
        self.assertTrue(any(row["name"] == "ALARIS HEALTH AT CEDAR GROVE"
                            for row in withheld["ambiguous-workbook-identity"]))
        self.assertEqual(len(projection["results"]) + sum(map(len, withheld.values())), 370)

    @unittest.skipUnless(WORKBOOK.exists() and COST_REPORT.exists() and FY26_WORKBOOK.exists(),
                         "Official FY2026 and FY2027 workbooks must be supplied separately")
    def test_official_history_uses_visible_fy26_release_and_exact_certified_ids(self):
        current, _ = coreq.generate(WORKBOOK, COST_REPORT)
        expanded, _ = coreq.generate(WORKBOOK, COST_REPORT, FY26_WORKBOOK)
        self.assertEqual({key: expanded[key] for key in current}, current)
        self.assertEqual(len(current["results"]), 233)
        expected = {
            "315124": (93, "0.93", 58, "895172", "1689322489", "NA", 58),
            "315138": (72, "0.72", 306, "4491700", "1174707475", "NS", 307),
            "315183": (95, "0.95", 255, "550817", "1669479796", "NA", 256),
            "315224": (86, "0.86", 172, "9032401", "1710974936", "NS", 173),
            "315253": (91, "0.91", 241, "502162", "1063819811", "NS", 242),
            "315376": (92, "0.92", 88, "4463501", "1427047232", "NS", 89),
            "315393": (86, "0.86", 231, "4476701", "1003898636", "NA", 232),
        }
        historical = expanded["historical"]
        self.assertEqual(set(historical["results"]), set(expected))
        self.assertFalse(set(historical["results"]) & set(current["results"]))
        self.assertEqual(historical["source"]["reportingYear"], "FY2026")
        self.assertEqual(historical["source"]["workbook"]["revised"], "2026-06-26")
        with zipfile.ZipFile(FY26_WORKBOOK) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            visible = workbook.findall("{*}sheets/{*}sheet")[1]
            self.assertEqual(visible.get("name"), coreq.FY26_SHEET)
            self.assertIsNone(visible.get("state"))
            cells = {cell.get("r"): cell for cell in
                     ET.fromstring(archive.read("xl/worksheets/sheet2.xml")).findall(".//{*}c")}
        for ccn, (value, raw, row, mid, npi, code, current_row) in expected.items():
            result = historical["results"][ccn]
            self.assertEqual(result["value"], value)
            self.assertEqual(result["raw"], raw)
            self.assertEqual(result["cell"], f"AZ{row}")
            self.assertEqual(cells[f"AZ{row}"].findtext("{*}v"), raw)
            self.assertEqual(cells[f"B{row}"].findtext("{*}v"), mid)
            self.assertEqual(result["identity"]["medicaidId"], mid)
            self.assertEqual(result["identity"]["npi"], npi)
            self.assertEqual(result["currentSuppression"]["raw"], code)
            self.assertEqual(result["currentSuppression"]["cell"], f"AZ{current_row}")
        for ccn, state_id, state_row in [
            ("315138", "NJ61416", 742), ("315376", "NJ60204", 532), ("315393", "NJ60731", 666),
        ]:
            self.assertEqual(historical["results"][ccn]["identity"]["stateFacilityId"], state_id)
            self.assertEqual(historical["results"][ccn]["identity"]["stateRow"], state_row)
        for path, sheet in [(FY26_WORKBOOK, "Cover "), (WORKBOOK, "SFY27 Cover sheet")]:
            cover = {row["row"]: coreq.raw(row, "A") for row in coreq.xlsx_rows(path, sheet)}
            self.assertIn("Three questions rate the facility overall, the staff, and the care received", cover[32])
            self.assertIn("1 (poor), 2 (average), 3 (good), 4 (very good) and 5 (excellent)", cover[33])
            self.assertIn("85%", cover[34])
            self.assertIn('"NS" for No Score', cover[35])
            self.assertIn('"N/A" for Not Applicable', cover[36])
            self.assertIn('"NE" for Not Eligible', cover[37])


if __name__ == "__main__":
    unittest.main()
