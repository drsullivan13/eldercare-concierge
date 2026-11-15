#!/usr/bin/env python3
import copy
import os
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("nj_coreq", Path(__file__).with_name("nj-coreq.py"))
coreq = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(coreq)


WORKBOOK = Path(os.environ.get("HARBOR_COREQ_WORKBOOK", "/tmp/harbor-nj-coreq.xlsx"))
COST_REPORT = Path(os.environ.get("HARBOR_NJ_COST_REPORT", "/tmp/harbor-nj-costreport.xlsx"))


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

    def test_real_zero_is_not_missing(self):
        self.workbook[0]["score"]["raw"] = "0"
        self.assertEqual(self.project()[0]["315083"]["value"], 0)

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
        self.assertEqual(projection["results"]["315083"]["value"], 96)
        self.assertEqual(projection["source"]["unit"], "percent")
        self.assertEqual(projection["source"]["surveyPeriod"], None)
        self.assertEqual(projection["source"]["sampleSize"], None)
        self.assertFalse(any(result["identity"]["workbookName"] == "ALARIS HEALTH AT CEDAR GROVE"
                             for result in projection["results"].values()))
        self.assertTrue(any(row["name"] == "ALARIS HEALTH AT CEDAR GROVE"
                            for row in withheld["ambiguous-workbook-identity"]))
        self.assertEqual(len(projection["results"]) + sum(map(len, withheld.values())), 370)


if __name__ == "__main__":
    unittest.main()
