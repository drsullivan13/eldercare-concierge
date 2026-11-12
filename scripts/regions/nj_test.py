#!/usr/bin/env python3
"""Verify the retained NJ state collection through its collector and outputs."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

import nj_collect as nj


class StateCollectionTests(unittest.TestCase):
    def test_all_retained_sources_match_capture_hashes(self):
        for path in (nj.OUTPUT / "raw").glob("*.json"):
            if not path.name.endswith((".xlsx.json", ".pdf.json", ".html.json", ".json.json")):
                continue
            metadata = json.loads(path.read_text())
            source = nj.OUTPUT / metadata["file"]
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), metadata["sha256"])
            self.assertEqual(source.stat().st_size, metadata["bytes"])

    def test_full_firm_export_matches_actual_portal_total(self):
        rows = nj.workbook_rows(nj.OUTPUT / "raw/firms.xlsx")
        metadata = json.loads((nj.OUTPUT / "raw/firms.xlsx.json").read_text())
        self.assertEqual(len(rows), metadata["displayed_rows"])
        self.assertEqual(len(rows), metadata["exported_rows"])
        self.assertLess(len(rows), 5000)
        self.assertEqual(rows[-1]["License/Registration"], "HP0382300")

    def test_every_unit_matches_independent_live_doh_result(self):
        report = json.loads((nj.OUTPUT / "live-doh-verification.json").read_text())
        self.assertEqual(report["status"], "passed")
        self.assertEqual(set(report["counties"]), set(nj.COUNTIES))
        disagreements = [
            row for county in report["counties"].values() for row in county["field_disagreements"]
        ]
        self.assertEqual(
            [(row["official_facility_id"], row["fields"]) for row in disagreements],
            [("NJ5A003", ["name"])],
        )
        for county in nj.COUNTIES:
            live = json.loads((nj.OUTPUT / f"raw/doh-{county.lower()}.json").read_text())
            units = json.loads((nj.OUTPUT / county.lower() / "care-units.json").read_text())
            self.assertEqual(
                sorted(unit["official_facility_id"] for unit in units),
                sorted(unit["id"] for unit in live["units"]),
            )
            for unit in units:
                observed = next(row for row in live["units"] if row["id"] == unit["official_facility_id"])
                if observed["name"] not in unit["name"]:
                    discrepancy = next(
                        row for row in disagreements if row["official_facility_id"] == unit["official_facility_id"]
                    )
                    self.assertEqual(discrepancy["workbook_name"], unit["name"])
                    self.assertEqual(discrepancy["live_name"], observed["name"])
                self.assertIn(unit["zip"], observed["row_text"])
                street = unit["address"].splitlines()[0].strip().casefold()
                self.assertIn(street, observed["row_text"].casefold())

    def test_unit_identity_is_not_campus_or_name_identity(self):
        rows = json.loads((nj.OUTPUT / "morris/care-units.json").read_text())
        terraces = [row for row in rows if "THE TERRACES AT FLORHAM PARK" in row["name"]]
        self.assertEqual(
            {row["official_facility_id"] for row in terraces}, {"NJ60A010", "NJ14C014"}
        )
        self.assertEqual(len({row["official_type"] for row in terraces}), 2)
        union = json.loads((nj.OUTPUT / "union/care-units.json").read_text())
        self.assertEqual(len(union), 12)
        self.assertEqual(len(rows), 30)

    def test_all_source_rows_keep_exact_official_identifiers_and_fields(self):
        source_units = {row["source_row"]: row for row in nj.workbook_rows(nj.OUTPUT / "raw/ltc.xlsx")}
        source_firms = {row["source_row"]: row for row in nj.workbook_rows(nj.OUTPUT / "raw/firms.xlsx")}
        for county in nj.COUNTIES:
            for filename, source in (("care-units.json", source_units), ("home-care-firms.json", source_firms)):
                for row in json.loads((nj.OUTPUT / county.lower() / filename).read_text()):
                    self.assertEqual(row["source_fields"], source[row["source"]["row"]])
                    if filename == "care-units.json":
                        self.assertEqual(row["official_facility_id"], row["source_fields"]["FacID"])
                        self.assertEqual(row["official_license_id"], row["source_fields"]["LIC#"])
                    else:
                        self.assertEqual(
                            row["official_registration_id"], row["source_fields"]["License/Registration"]
                        )

    def test_ccrc_historical_dates_ids_and_county_headings(self):
        expected = {"Union": 1, "Morris": 2, "Essex": 2, "Bergen": 0, "Hudson": 1, "Passaic": 1}
        for county, count in expected.items():
            records = json.loads((nj.OUTPUT / county.lower() / "ccrc-campuses.json").read_text())
            self.assertEqual(len(records), count)
            for row in records:
                self.assertEqual(row["source_date"], "2018-01")
                self.assertIsNone(row["official_registration_id"])
                self.assertIsNone(row["license_status"])
                self.assertIn(row["name"], row["source_text"])
                self.assertIn(row["address"], row["source_text"])

    def test_non_dementia_license_does_not_claim_memory_care(self):
        for county in nj.COUNTIES:
            for row in json.loads((nj.OUTPUT / county.lower() / "care-units.json").read_text()):
                self.assertEqual(
                    row["memory_care_basis"] == "Explicit residential dementia care license type",
                    row["official_type"] == "RESIDENTIAL DEMENTIA CARE HOME",
                )

    def test_county_assignment_rejects_ambiguous_and_unknown_names(self):
        refs = nj.county_references(nj.workbook_rows(nj.OUTPUT / "raw/ltc.xlsx"))
        self.assertEqual(nj.assign_county("Cranford", "07016", refs)[0], "Union")
        self.assertEqual(nj.assign_county("Whippany", "07981", refs)[0], "Morris")
        self.assertIsNone(nj.assign_county("Washington Township", "00000", refs)[0])
        self.assertIsNone(nj.assign_county("Elizabeith", "07202", refs)[0])
        unresolved = json.loads((nj.OUTPUT / "unresolved-home-care-counties.json").read_text())
        self.assertTrue(any(row["city"] == "Elizabeith" for row in unresolved))
        self.assertTrue(all(row["county"] is None for row in unresolved))

    def test_duplicate_registrations_and_status_disagreements_are_not_dropped(self):
        rows = json.loads((nj.OUTPUT / "morris/home-care-firms.json").read_text())
        active = [row for row in rows if row["license_status"] == "Active"]
        self.assertGreater(len(active), len({row["official_registration_id"] for row in active}))
        all_rows = [
            row for county in nj.COUNTIES
            for row in json.loads((nj.OUTPUT / county.lower() / "home-care-firms.json").read_text())
        ]
        self.assertTrue(any(row["license_status"] == "Revoked" for row in all_rows))
        self.assertTrue(any(
            row["license_status"] == "Active"
            and row["license_expires"] < row["source"]["retrieved_at"][:10]
            for row in all_rows if row["license_expires"]
        ))

    def test_workbook_keeps_sparse_cells_and_leading_zero_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.xlsx"
            with ZipFile(path, "w") as archive:
                archive.writestr("xl/worksheets/sheet.xml", """
                    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                    <sheetData><row r="1">
                    <c r="A1" t="inlineStr"><is><t>ID</t></is></c>
                    <c r="B1" t="inlineStr"><is><t>Gap</t></is></c>
                    <c r="C1" t="inlineStr"><is><t>ZIP</t></is></c></row>
                    <row r="2"><c r="A2" t="inlineStr"><is><t>00123</t></is></c>
                    <c r="C2" t="inlineStr"><is><t>07016</t></is></c></row>
                    </sheetData></worksheet>
                """)
            self.assertEqual(
                nj.workbook_rows(path), [{"source_row": 2, "ID": "00123", "Gap": "", "ZIP": "07016"}]
            )

    def test_modified_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw").mkdir()
            (root / "raw/source.xlsx").write_bytes(b"changed")
            (root / "raw/source.xlsx.json").write_text(json.dumps({"sha256": "wrong"}))
            with patch.object(nj, "OUTPUT", root):
                nj.provenance.cache_clear()
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    nj.provenance("source.xlsx")
        nj.provenance.cache_clear()

    def test_real_cli_rebuild_is_deterministic(self):
        paths = [
            path for county in nj.COUNTIES
            for path in (nj.OUTPUT / county.lower()).glob("*.json")
        ] + [nj.OUTPUT / "coverage.json", nj.OUTPUT / "unresolved-home-care-counties.json"]
        before = {path: path.read_bytes() for path in paths}
        subprocess.run(
            [sys.executable, str(Path(nj.__file__))],
            check=True, capture_output=True, text=True, cwd=nj.ROOT,
        )
        self.assertEqual(before, {path: path.read_bytes() for path in paths})


if __name__ == "__main__":
    unittest.main(verbosity=2)
