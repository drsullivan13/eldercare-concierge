#!/usr/bin/env python3
"""Behavior checks for exact-source QCOR collection and retained NJ evidence."""

from collections import Counter
from copy import deepcopy
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlencode
import xml.etree.ElementTree as ET
import zipfile

import cms_qcor as qcor


def source_row(**changes):
    row = dict.fromkeys(qcor.HEADERS, "")
    row.update({
        "CCN": "017009", "Facility Name": "Source agency", "State/Territory": "NJ",
        "ZIP": "07001", "Survey Event ID": "EVENT1", "Survey Date": "2025-06-18",
        "Survey Type": "Complaint", "Deficiency Tag": "G0000",
        "Deficiency Description": "Initial Comments - Not A Deficiency Citation",
        "Deficiency Tag Type": "Memo",
        "Statement of Deficiency Text (Part 1)": " First line\n  second line & <literal> ",
    })
    row.update(changes)
    return row


def xlsx(rows, shared=False):
    root = ET.Element(qcor.NS + "worksheet")
    data = ET.SubElement(root, qcor.NS + "sheetData")
    strings = []
    for number, values in enumerate([dict(zip(qcor.HEADERS, qcor.HEADERS)), *rows], 1):
        row = ET.SubElement(data, qcor.NS + "row", r=str(number))
        for index, name in enumerate(qcor.HEADERS):
            value = values.get(name, "")
            if not value:
                continue
            cell = ET.SubElement(row, qcor.NS + "c", r=f"{chr(65 + index)}{number}",
                                 t="s" if shared else "inlineStr")
            if shared:
                strings.append(value)
                ET.SubElement(cell, qcor.NS + "v").text = str(len(strings) - 1)
            else:
                ET.SubElement(ET.SubElement(cell, qcor.NS + "is"), qcor.NS + "t").text = value
    body = io.BytesIO()
    with zipfile.ZipFile(body, "w") as book:
        book.writestr("xl/worksheets/sheet1.xml", ET.tostring(root))
        if shared:
            table = ET.Element(qcor.NS + "sst")
            for value in strings:
                ET.SubElement(ET.SubElement(table, qcor.NS + "si"), qcor.NS + "t").text = value
            book.writestr("xl/sharedStrings.xml", ET.tostring(table))
    body.seek(0)
    return body


class ParserTests(unittest.TestCase):
    def test_inline_cells_keep_leading_zeros_narratives_and_sparse_columns(self):
        row = source_row()
        parsed = list(qcor.workbook_rows(xlsx([row])))
        self.assertEqual(parsed, [("xl/worksheets/sheet1.xml", 2, row)])
        self.assertEqual(parsed[0][2]["CCN"], "017009")
        self.assertEqual(parsed[0][2]["ZIP"], "07001")

    def test_shared_strings_keep_exact_source_text(self):
        row = source_row()
        self.assertEqual(list(qcor.workbook_rows(xlsx([row], shared=True)))[0][2], row)

    def test_event_identity_includes_event_id_not_only_ccn_and_date(self):
        first = source_row()
        second = source_row(**{"Survey Event ID": "EVENT2"})
        self.assertNotEqual(qcor.event_key(first), qcor.event_key(second))
        self.assertEqual(qcor.event_key(first), ("017009", "EVENT1", "2025-06-18"))

    def test_malformed_ccn_is_not_silently_repaired(self):
        with self.assertRaisesRegex(ValueError, "six characters"):
            qcor.event_key(source_row(CCN="17009"))

    def test_national_alphanumeric_ccns_are_not_dropped(self):
        self.assertEqual(qcor.event_key(source_row(CCN="05K002")),
                         ("05K002", "EVENT1", "2025-06-18"))

    def test_memo_is_not_a_deficiency(self):
        for tag in ("E0000", "G0000"):
            row = source_row(**{"Deficiency Tag": tag})
            self.assertEqual(qcor.tag_kind(row), ("Memo", False))

    def test_condition_standard_and_element_stay_distinct(self):
        for kind in ("Condition", "Standard", "Element"):
            row = source_row(**{"Deficiency Tag": "G0570", "Deficiency Tag Type": kind})
            self.assertEqual(qcor.tag_kind(row), (kind, True))

    def test_initial_comments_cannot_be_classified_as_citations(self):
        row = source_row(**{"Deficiency Tag Type": "Condition"})
        with self.assertRaisesRegex(ValueError, "Initial-comment"):
            qcor.tag_kind(row)

    def test_unknown_tag_types_fail_instead_of_inventing_a_finding(self):
        with self.assertRaisesRegex(ValueError, "Unknown QCOR tag type"):
            qcor.tag_kind(source_row(**{"Deficiency Tag Type": "Severity"}))

    def test_listing_preserves_source_report_links_and_event_id(self):
        params = urlencode({"cmsNumber": "017009", "surveyDate": "2025-06-18",
                            "tag": "G0000, G0570"})
        links = "".join(f'<a href="{endpoint}?{params}">Report</a>'
                        for endpoint in ("HHACombinedReportObject", "HHACombinedReportObjectPDF"))
        cells = ["▼ 017009", "Source agency", "1 Street", "City", "NJ", "2 (New York)",
                 "06/18/2025", "EVENT1", "Complaint", links]
        body = ('Total Records: 1<table><tr>' +
                "".join(f"<td>{cell}</td>" for cell in cells) + "</tr></table>").encode()
        count, surveys, _ = qcor.parse_listing(body)
        self.assertEqual(count, 1)
        survey = surveys[("017009", "EVENT1", "2025-06-18")]
        self.assertEqual(survey["tags"], ["G0000", "G0570"])
        self.assertEqual(survey["report_urls"][0],
                         "https://qcor.cms.gov/HHACombinedReportObject?" + params)

    def test_office_county_is_not_a_service_area(self):
        row = {"prvdr_num": "317002", "fac_name": "Agency", "state_cd": "NJ",
               "prvdr_type_id": "3", "fips_state_cd": "34", "fips_cnty_cd": "027",
               "fed_crtfctn_stus_name": "Certified"}
        other = {**row, "prvdr_num": "317003", "fips_cnty_cd": "035"}
        terminated = {**row, "prvdr_num": "317004", "fed_crtfctn_stus_name": "Terminated"}
        offices = qcor.office_records([row, other, terminated])
        self.assertTrue(offices["317002"]["selected_current_target_office"])
        self.assertEqual(offices["317002"]["office_county"], "Morris")
        self.assertIsNone(offices["317002"]["service_counties"])
        self.assertFalse(offices["317003"]["selected_current_target_office"])
        self.assertFalse(offices["317004"]["selected_current_target_office"])
        self.assertEqual(offices["317004"]["office_county"], "Morris")

    def test_cached_download_checks_exact_hash_without_network(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            body = b"exact source bytes\r\n"
            (output / "source").write_bytes(body)
            receipt = {"requestedUrl": qcor.EXPORT, "sha256": qcor.digest(body),
                       "bytes": len(body)}
            qcor.write_json(output / "source.http.json", receipt)
            with patch.object(qcor, "urlopen", side_effect=AssertionError("Unexpected network")):
                self.assertEqual(qcor.retain(qcor.EXPORT, "source", output), (body, receipt))
                (output / "source").write_bytes(body + b"changed")
                with self.assertRaisesRegex(ValueError, "hash/length mismatch"):
                    qcor.retain(qcor.EXPORT, "source", output)


@unittest.skipUnless((qcor.OUTPUT / "manifest.json").exists(), "Run cms_qcor.py pull first")
class RetainedEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = qcor.verify(qcor.OUTPUT)
        cls.surveys = qcor.read_json(qcor.OUTPUT / "surveys.json")
        cls.offices = qcor.read_json(qcor.OUTPUT / "agencies.json")

    def test_actual_export_and_listing_counts(self):
        counts = self.manifest["counts"]
        self.assertEqual(counts["national_export_rows"], 95296)
        self.assertEqual(counts["national_export_surveys"], 21531)
        self.assertEqual(counts["listing_header_counts"]["listing"], 11919)
        self.assertEqual(counts["listing_header_counts"]["national-all"], 21531)
        self.assertEqual(counts["nj_export_rows"], 506)
        self.assertEqual(counts["nj_export_surveys"], 131)
        self.assertEqual(counts["nj_export_ccns"], 39)
        self.assertEqual(self.manifest["checks"]["all_nj_listing_pages_retained"], 14)
        self.assertEqual(counts["target_export_surveys"], 60)
        self.assertEqual(counts["target_export_rows"], 262)
        self.assertEqual(counts["target_citation_rows"], 167)
        self.assertEqual(counts["target_memo_rows"], 95)
        self.assertEqual(counts["target_export_tag_types"],
                         {"Condition": 6, "Element": 81, "Memo": 95, "Standard": 80})
        receipt = self.manifest["receipts"]["raw/hha-2567.xlsx"]
        self.assertEqual(receipt["sha256"],
                         "cc1c1c0bda911386d26beb565fa53c733c3a65a67dfd830506af114b210aae47")
        self.assertEqual(receipt["bytes"], 65769232)
        self.assertEqual(int(receipt["headers"]["Content-Length"]), receipt["bytes"])

    def test_all_nj_event_identities_and_physical_source_rows_are_unique(self):
        keys = {(s["ccn"], s["survey_event_id"], s["survey_date"]) for s in self.surveys}
        self.assertEqual(len(keys), 131)
        self.assertEqual(len({s["survey_event_id"] for s in self.surveys}), 131)
        rows = [r["source"]["row_number"] for s in self.surveys for r in s["rows"]]
        self.assertEqual(len(set(rows)), 506)
        for survey in self.surveys:
            for row in survey["rows"]:
                self.assertEqual(qcor.event_key(row["source_record"]),
                                 (survey["ccn"], survey["survey_event_id"], survey["survey_date"]))

    def test_all_eighteen_current_target_offices_have_explicit_coverage(self):
        selected = [o for o in self.offices if o["selected_current_target_office"]]
        self.assertEqual(len(self.offices), 75)
        self.assertEqual(sum(o["federal_status"] == "Certified" for o in self.offices), 38)
        self.assertEqual(Counter(o["office_county"] for o in selected),
                         {"Bergen": 5, "Essex": 4, "Hudson": 3,
                          "Morris": 3, "Passaic": 2, "Union": 1})
        self.assertEqual(len(selected), 18)
        self.assertEqual(self.manifest["counts"]["target_ccns_without_published_surveys"],
                         ["317022"])
        missing = next(o for o in selected if o["ccn"] == "317022")
        self.assertEqual(missing["evidence_status"],
                         "no_rows_in_published_export_not_a_clean_record")
        self.assertTrue(all(o["service_counties"] is None for o in self.offices))
        for office in selected:
            matches = [s for s in self.surveys if s["ccn"] == office["ccn"]]
            self.assertEqual(office["published_survey_count"], len(matches))
            self.assertEqual(office["source_record"]["fips_cnty_cd"],
                             office["office_county_fips"][2:])
            self.assertEqual(office["source_record"]["fed_crtfctn_stus_name"], "Certified")

    def test_memos_and_narratives_are_preserved_without_invented_citations(self):
        tags = Counter()
        for survey in self.surveys:
            self.assertIsNone(survey["service_counties"])
            for row in survey["rows"]:
                tags[row["tag_type"]] += 1
                self.assertEqual(row["tag"], row["source_record"]["Deficiency Tag"])
                self.assertEqual(row["is_deficiency_citation"], row["tag_type"] != "Memo")
                if row["tag"] in {"E0000", "G0000"}:
                    self.assertFalse(row["is_deficiency_citation"])
                self.assertEqual(set(row["source_record"]), set(qcor.HEADERS))
        self.assertEqual(dict(sorted(tags.items())), self.manifest["counts"]["nj_export_tag_types"])
        self.assertTrue(any(r["source_record"]["Statement of Deficiency Text (Part 1)"]
                            for s in self.surveys for r in s["rows"]))

    def test_source_dates_do_not_become_a_complete_history_claim(self):
        counts = self.manifest["counts"]
        self.assertEqual(counts["nj_export_survey_date_min"], "2018-01-09")
        self.assertEqual(counts["nj_export_survey_date_max"], "2026-09-10")
        self.assertEqual(self.manifest["migration_notice"]["exact_text"], qcor.NOTICE)
        self.assertIn("not all surveys ever", self.manifest["coverage"])
        self.assertTrue(self.manifest["unresolved"])
        self.assertEqual(self.manifest["unresolved"][0]["export_with_citation_rows"], 11905)
        self.assertEqual(self.manifest["unresolved"][0]["listing_with_header"], 11919)
        self.assertEqual(self.manifest["export_workbook_dates"]["created"], "2026-11-11T04:50:32Z")

    def test_offline_verifier_rejects_an_incomplete_filtered_selection(self):
        actual_read = qcor.read_json
        missing = deepcopy(self.surveys[:-1])

        def changed_read(path):
            return missing if path == qcor.OUTPUT / "surveys.json" else actual_read(path)

        with patch.object(qcor, "read_json", side_effect=changed_read):
            with self.assertRaisesRegex(ValueError, "Incomplete/changed derived surveys"):
                qcor.verify(qcor.OUTPUT)


if __name__ == "__main__":
    unittest.main()
