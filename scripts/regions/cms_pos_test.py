#!/usr/bin/env python3
"""Offline POS regressions against retained official CMS responses."""

import copy
import io
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import cms_pos as cms


class TransportTests(unittest.TestCase):
    def test_default_user_agent_verified_system_ca_and_exact_bytes(self):
        url = cms.METADATA
        response = io.BytesIO(b'{"zip":"07960","missing":"Not Available"}\n')
        response.url = url
        response.status = 200
        response.headers = {"Content-Type": "application/json"}
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {}, clear=True), patch(
                "cms_pos.urlopen", return_value=response
            ) as open_url:
                body, receipt = cms.fetch(url, "raw/source.json", Path(directory))
            args, kwargs = open_url.call_args
            self.assertEqual(args, (url,))
            self.assertEqual(kwargs["context"].verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(kwargs["context"].check_hostname)
            self.assertGreater(len(kwargs["context"].get_ca_certs()), 0)
            self.assertEqual((Path(directory) / receipt["file"]).read_bytes(), body)
            self.assertEqual(receipt["sha256"], cms.sha256(body))
            self.assertEqual(receipt["bytes"], len(body))
            self.assertEqual(receipt["http_status"], 200)

    def test_explicit_ca_is_honored_without_insecure_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"SSL_CERT_FILE": directory + "/missing.pem"}), patch(
                "cms_pos.urlopen"
            ) as open_url:
                with self.assertRaises(FileNotFoundError):
                    cms.fetch(cms.METADATA, "raw/source.json", Path(directory))
                open_url.assert_not_called()

    def test_forbidden_response_is_not_retried_or_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("cms_pos.urlopen", side_effect=HTTPError(
                cms.METADATA, 403, "Forbidden", {}, None
            )) as open_url:
                with self.assertRaises(HTTPError):
                    cms.fetch(cms.METADATA, "raw/source.json", Path(directory))
                self.assertEqual(open_url.call_count, 1)
                self.assertFalse((Path(directory) / "raw/source.json").exists())


class RetainedSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = cms.OUTPUT / json.loads(
            (cms.OUTPUT / "latest.json").read_text()
        )["snapshot"]
        cls.manifest = json.loads((cls.snapshot / "manifest.json").read_text())
        cls.pos_rows, cls.pdc_rows = {}, {}
        for family in cms.FAMILIES:
            cls.pos_rows[family] = [
                (row, {"file": page["file"], "row_index": index})
                for page in cls.manifest["pos_pages"][family]
                for index, row in enumerate(json.loads(
                    (cls.snapshot / page["file"]).read_text()
                ))
            ]
            cls.pdc_rows[family] = [
                row for page in cls.manifest["pdc_pages"][family]
                for row in json.loads((cls.snapshot / page["file"]).read_text())["results"]
            ]
        cls.headers = json.loads((cls.snapshot / "raw/schema.json").read_text())["meta"]["headers"]

    def test_offline_verify_never_uses_transport(self):
        with patch("cms_pos.urlopen", side_effect=AssertionError("network forbidden")):
            result = cms.verify(self.snapshot)
        self.assertEqual(result["counts"]["home_health"]["all_nj_pos_records"], 75)
        self.assertEqual(result["counts"]["home_health"]["federal_status_counts"],
                         {"Certified": 38, "Terminated": 37})
        self.assertEqual(result["counts"]["home_health"]["certified_target_office_counties"],
                         {"Bergen": 5, "Essex": 4, "Hudson": 3,
                          "Morris": 3, "Passaic": 2, "Union": 1})
        self.assertEqual(len(result["reconciliation"]["home_health"]["matched_certified_ccns"]), 38)

    def test_fresh_process_default_verify_entrypoint(self):
        run = subprocess.run([sys.executable, str(Path(cms.__file__)), "verify"],
                             cwd="/", capture_output=True, text=True, timeout=30)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertEqual(result["reconciliation"]["home_health"]["pdc_nj_count"], 38)

    def test_exact_source_strings_and_pos_county_are_preserved(self):
        result = cms.derive(self.pos_rows, self.pdc_rows)
        for family, rows in self.pos_rows.items():
            original = {row["prvdr_num"]: row for row, _ in rows}
            for record in result["records"][family]:
                self.assertEqual(record["source_record"], original[record["ccn"]])
        record = next(r for r in result["records"]["home_health"] if r["ccn"] == "317002")
        self.assertEqual(record["office_county"], "Morris")
        self.assertEqual(record["office_county_fips"], "34027")
        self.assertEqual(record["source_record"]["zip_cd"], "07960")
        self.assertEqual(record["source_record"]["orgnl_prtcptn_dt"], "1966-07-01")
        self.assertEqual(record["source_record"]["trmntn_exprtn_dt"], "Not Available")

    def test_terminated_records_never_enter_certified_selection(self):
        result = cms.derive(self.pos_rows, self.pdc_rows)
        terminated = [r for r in result["records"]["home_health"]
                      if r["source_record"]["fed_crtfctn_stus_name"] == "Terminated"]
        self.assertEqual(len(terminated), 37)
        self.assertTrue(any(r["office_county"] for r in terminated))
        self.assertTrue(all(r["selection"] == "not_certified_not_selected" for r in terminated))

    def test_survey_compliance_no_does_not_erase_certification(self):
        result = cms.derive(self.pos_rows, self.pdc_rows)
        record = next(r for r in result["records"]["home_health"] if r["ccn"] == "317022")
        self.assertEqual(record["source_record"]["cmplnc_stus_cd"], "No")
        self.assertEqual(record["source_record"]["fed_crtfctn_stus_name"], "Certified")
        self.assertTrue(record["selection"].startswith("certified_"))

    def test_missing_county_is_not_inferred_from_zip_or_pdc(self):
        for missing in ["", "Not Available", "000", "27"]:
            with self.subTest(missing=missing):
                rows = copy.deepcopy(self.pos_rows)
                row = rows["nursing"][0][0]
                row["fips_cnty_cd"] = missing
                result = cms.derive(rows, self.pdc_rows)
                record = next(r for r in result["records"]["nursing"] if r["ccn"] == row["prvdr_num"])
                self.assertIsNone(record["office_county"])
                self.assertEqual(record["source_record"]["fips_cnty_cd"], missing)
                if missing != "000":
                    self.assertIsNone(record["office_county_fips"])

    def test_leading_zero_ccn_is_not_normalized(self):
        rows, pdc = copy.deepcopy(self.pos_rows), copy.deepcopy(self.pdc_rows)
        old = rows["nursing"][0][0]["prvdr_num"]
        rows["nursing"][0][0]["prvdr_num"] = "005001"
        for row in pdc["nursing"]:
            if row[cms.PDC_CCN] == old:
                row[cms.PDC_CCN] = "005001"
        result = cms.derive(rows, pdc)
        self.assertIn("005001", result["reconciliation"]["nursing"]["matched_certified_ccns"])
        self.assertNotIn("5001", result["reconciliation"]["nursing"]["matched_certified_ccns"])
        cms.validate_pos([rows["nursing"][0][0]], "nursing", self.headers)

    def test_hha_equal_counts_do_not_hide_wrong_ccn(self):
        pdc = copy.deepcopy(self.pdc_rows)
        pdc["home_health"][0][cms.PDC_CCN] = "999999"
        with self.assertRaisesRegex(ValueError, "exactly reconcile"):
            cms.derive(self.pos_rows, pdc)

    def test_nursing_roster_disagreement_remains_an_explicit_gap(self):
        pdc = copy.deepcopy(self.pdc_rows)
        removed = pdc["nursing"].pop()
        result = cms.derive(self.pos_rows, pdc)
        self.assertIn(removed[cms.PDC_CCN],
                      result["reconciliation"]["nursing"]["pos_certified_absent_from_pdc"])

    def test_nursing_county_disagreement_is_not_forced_to_match(self):
        pdc = copy.deepcopy(self.pdc_rows)
        next(r for r in pdc["nursing"] if r[cms.PDC_CCN] == "315531")["countyparish"] = "Morris"
        result = cms.derive(self.pos_rows, pdc)
        self.assertIn({"ccn": "315531", "pos_office_county": "Passaic", "pdc_county": "Morris"},
                      result["reconciliation"]["nursing"]["target_office_county_disagreements"])

    def test_duplicate_ccn_is_rejected(self):
        rows = copy.deepcopy(self.pos_rows)
        rows["nursing"].append(copy.deepcopy(rows["nursing"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate POS CCN"):
            cms.derive(rows, self.pdc_rows)

    def test_status_schema_and_source_types_are_checked(self):
        for field, value in [("fed_crtfctn_stus_id", "4"),
                             ("fed_crtfctn_stus_name", "Unknown"),
                             ("zip_cd", 7960), ("state_cd", "NY")]:
            with self.subTest(field=field):
                row = copy.deepcopy(self.pos_rows["home_health"][0][0])
                row[field] = value
                with self.assertRaises(ValueError):
                    cms.validate_pos([row], "home_health", self.headers)

    def test_source_hash_and_byte_count_tampering_are_rejected(self):
        for field, value in [("sha256", "0" * 64), ("bytes", 0)]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                snapshot = Path(directory) / "snapshot"
                shutil.copytree(self.snapshot, snapshot)
                manifest = copy.deepcopy(self.manifest)
                manifest["receipts"]["raw/home_health/pos-00000.json"][field] = value
                cms.write_json(snapshot / "manifest.json", manifest)
                with self.assertRaisesRegex(ValueError, "hash/size mismatch"):
                    cms.verify(snapshot)

    def test_derived_projection_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "snapshot"
            shutil.copytree(self.snapshot, snapshot)
            result = json.loads((snapshot / "supplement.json").read_text())
            result["records"]["home_health"][0]["office_county"] = "Union"
            cms.write_json(snapshot / "supplement.json", result)
            with self.assertRaisesRegex(ValueError, "Derived supplement differs"):
                cms.verify(snapshot)

    def test_discovery_rejects_new_version_or_dataset_type(self):
        metadata = json.loads((self.snapshot / "raw/metadata.json").read_text())
        resources = json.loads((self.snapshot / "raw/resources.json").read_text())
        latest = json.loads((self.snapshot / "raw/latest-resources.json").read_text())
        for change in ["version", "type"]:
            with self.subTest(change=change):
                discovery = json.loads((self.snapshot / "raw/discovery.json").read_text())
                if change == "version":
                    discovery["data"][0]["id"] = "different"
                else:
                    discovery["data"][0]["relationships"]["field_dataset_type"]["data"]["id"] = "different"
                with self.assertRaises(ValueError):
                    cms.validate_discovery(discovery, metadata, resources, latest)

    def test_missing_terminal_pos_page_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "snapshot"
            shutil.copytree(self.snapshot, snapshot)
            manifest = copy.deepcopy(self.manifest)
            manifest["pos_pages"]["home_health"].pop()
            cms.write_json(snapshot / "manifest.json", manifest)
            with self.assertRaisesRegex(ValueError, "terminal empty page"):
                cms.verify(snapshot)


if __name__ == "__main__":
    unittest.main()
