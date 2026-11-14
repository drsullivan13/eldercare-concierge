#!/usr/bin/env python3
"""Compare clinical fragments with original CMS pages, not generated expectations."""

from collections import Counter
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
CMS = ROOT / "research/north-jersey/cms"
OUT = ROOT / "research/north-jersey/clinical"
CCN = "cms_certification_number_ccn"


def load(path):
    return json.loads(path.read_bytes())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def original_key(row):
    return json.dumps(row, sort_keys=True)


def source_number(raw):
    if raw is None or raw.strip() in {"", "-", "NA", "N/A", "Not Available", "Not Applicable"}:
        return None
    return float(raw.replace(",", ""))


def walk_metrics(value):
    if isinstance(value, dict):
        if "sourceColumn" in value:
            yield value
        else:
            for item in value.values():
                yield from walk_metrics(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_metrics(item)


class OriginalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = load(CMS / "manifest.json")
        cls.emitted = load(OUT / "manifest.json")
        cls.inspection = load(OUT / "inspection-history.json")
        cls.hh = load(OUT / "home-health-evidence.json")
        cls.nursing = load(OUT / "nursing-evidence-by-ccn.json")
        cls.summaries = load(OUT / "nursing-cms-by-ccn.json")
        cls.agencies = load(OUT / "home-health-agency-evidence.json")["agenciesByCcn"]
        cls.offices = load(OUT / "home-health-certified-offices.json")
        cls.service = load(OUT / "home-health-service-only.json")
        cls.edges = load(OUT / "home-health-service-zip-edges.json")
        cls.pages, cls.originals, cls.page_hashes = {}, {}, {}
        cls.labels = {}
        for dataset_id, source in cls.manifest["sources"].items():
            rows, labels = {}, {}
            for partition in source["partitions"]:
                for receipt in partition["pages"]:
                    path = CMS / receipt["file"]
                    payload = load(path)
                    cls.pages[str(path.relative_to(ROOT))] = payload["results"]
                    cls.page_hashes[str(path.relative_to(ROOT))] = sha(path)
                    for schema in payload["schema"].values():
                        labels.update({key: field["description"] for key, field in schema["fields"].items()})
                    for row in payload["results"]:
                        rows[original_key(row)] = row
            cls.originals[dataset_id] = list(rows.values())
            cls.labels[dataset_id] = labels
        cls.targets = {r[CCN]: r for r in cls.originals["4pq5-n9py"]
                       if r["countyparish"] in cls.manifest["target_counties"]}
        cls.pos_root = CMS / "pos" / load(CMS / "pos/latest.json")["snapshot"]
        cls.pos_manifest = load(cls.pos_root / "manifest.json")
        cls.pos = {
            family: [r for page in pages for r in load(cls.pos_root / page["file"])]
            for family, pages in cls.pos_manifest["pos_pages"].items()
        }

    def test_all_139_ccns_match_original_roster(self):
        self.assertEqual(139, len(self.targets))
        for result in (self.nursing, self.summaries, self.inspection["facilities"]):
            self.assertEqual(set(self.targets), set(result))
        self.assertEqual({"Bergen": 29, "Essex": 32, "Hudson": 15, "Morris": 21,
                          "Passaic": 19, "Union": 23},
                         dict(Counter(r["countyparish"] for r in self.targets.values())))

    def test_every_output_and_consumed_input_hash(self):
        for name, reference in self.emitted["outputs"].items():
            self.assertEqual(reference["sha256"], sha(OUT / name), name)
            self.assertEqual(reference["bytes"], (OUT / name).stat().st_size)
        for name, reference in self.emitted["consumedArtifacts"].items():
            self.assertEqual(reference["sha256"], sha(ROOT / name), name)
            self.assertEqual(reference["bytes"], (ROOT / name).stat().st_size)
        self.assertEqual(set(self.manifest["sources"]), set(self.emitted["datasetIds"]))
        self.assertEqual(17, len(self.emitted["datasetIds"]))
        self.assertEqual(362, self.emitted["counts"]["verifiedCmsArtifacts"])

    def test_every_nursing_evidence_row_matches_original_and_provenance(self):
        observed = Counter()
        for ccn, facility in self.nursing.items():
            for dataset_id, rows in facility["datasets"].items():
                for item in rows:
                    self.assertEqual(ccn, item["raw"][CCN])
                    self.assertTrue(item["sourceRows"])
                    for source in item["sourceRows"]:
                        self.assertEqual(item["raw"], self.pages[source["file"]][source["rowIndex"]])
                        self.assertEqual(source["sha256"], self.page_hashes[source["file"]])
                    observed[dataset_id] += 1
        expected = {
            key: sum(row.get(CCN) in self.targets for row in rows)
            for key, rows in self.originals.items()
        }
        self.assertEqual({k: n for k, n in expected.items() if n}, dict(observed))
        self.assertEqual(3256, observed["r5ix-sfxw"])
        self.assertEqual(2293, observed["ifjz-ge4w"])
        self.assertEqual(107, observed["g6vv-u9sr"])
        self.assertEqual(1161, observed["svdt-c123"])

    def test_facility_specific_dates_ratings_staffing_and_missing(self):
        columns = {
            "overall": "overall_rating", "inspections": "health_inspection_rating",
            "staffing": "staffing_rating", "quality": "qm_rating",
            "totalNurseHours": "reported_total_nurse_staffing_hours_per_resident_per_day",
            "rnHours": "reported_rn_staffing_hours_per_resident_per_day",
            "turnover": "total_nursing_staff_turnover", "fines": "number_of_fines",
            "fineAmount": "total_amount_of_fines_in_dollars", "paymentDenials": "number_of_payment_denials",
            "healthDeficiencies": "rating_cycle_1_total_number_of_health_deficiencies",
        }
        seen_dates = set()
        missing = 0
        for ccn, raw in self.targets.items():
            summary = self.summaries[ccn]
            for field, column in columns.items():
                self.assertEqual(source_number(raw[column]), summary[field], (ccn, field))
                missing += summary[field] is None
            expected = raw["rating_cycle_1_standard_survey_health_date"] or None
            self.assertEqual(expected, summary.get("lastInspection"), ccn)
            seen_dates.add(expected)
            self.assertEqual(raw["abuse_icon"] == "Y", summary["abuse"])
            self.assertEqual(raw["special_focus_status"] or None, summary["specialFocus"])
        self.assertGreater(len(seen_dates), 50)
        self.assertGreater(missing, 0)
        self.assertEqual("2026-03-30", self.summaries["315005"]["lastInspection"])
        self.assertEqual(3.44981, self.summaries["315005"]["totalNurseHours"])

    def test_bounded_citations_preserve_original_findings_and_dates(self):
        for ccn, result in self.inspection["facilities"].items():
            source = [r for r in self.originals["r5ix-sfxw"] if r[CCN] == ccn]
            self.assertEqual(len(source), result["healthCitations"]["total"])
            self.assertEqual(min(25, len(source)), len(result["healthCitations"]["records"]))
            by_findings = {(r["survey_date"], "F" + r["deficiency_tag_number"],
                            r["deficiency_description"], r["scope_severity_code"] or None): r for r in source}
            for citation in result["healthCitations"]["records"]:
                key = (citation["surveyDate"], citation["tag"], citation["description"], citation["scopeSeverityCode"])
                raw = by_findings[key]
                for target, column in (("correctionDate", "correction_date"), ("correctionStatus", "deficiency_corrected"),
                                       ("inspectionCycle", "inspection_cycle"), ("surveyFootnote", "survey_footnote"),
                                       ("processingDate", "processing_date")):
                    self.assertEqual(raw[column] or None, citation[target])
                for target, column in (("standard", "standard_deficiency"), ("complaint", "complaint_deficiency"),
                                       ("infectionControl", "infection_control_inspection_deficiency"),
                                       ("underIDR", "citation_under_idr"), ("underIIDR", "citation_under_iidr")):
                    self.assertEqual(None if not raw[column] else raw[column] == "Y", citation[target])
            returned_dates = [r["surveyDate"] for r in result["healthCitations"]["records"]]
            self.assertEqual(sorted(returned_dates, reverse=True), returned_dates)
            self.assertEqual(sorted((r["survey_date"] for r in source), reverse=True)[:25], returned_dates)

    def test_penalties_preserve_amounts_denials_and_complete_totals(self):
        for ccn, facility in self.inspection["facilities"].items():
            rows = [r for r in self.originals["g6vv-u9sr"] if r[CCN] == ccn]
            result = facility["penalties"]
            self.assertEqual(len(rows), result["total"])
            self.assertEqual(sum(r["penalty_type"] == "Fine" for r in rows), result["fineCount"])
            self.assertEqual(sum(r["penalty_type"] == "Payment Denial" for r in rows), result["paymentDenialCount"])
            for event in result["records"]:
                matches = [r for r in rows if r["penalty_date"] == event["date"] and r["penalty_type"] == event["type"]
                           and (r["fine_id"] or None) == event["fineId"]
                           and source_number(r["fine_amount"]) == event["fineAmount"]
                           and source_number(r["payment_denial_length_in_days"]) == event["paymentDenialLengthDays"]
                           and (r["payment_denial_start_date"] or None) == event["paymentDenialStartDate"]]
                self.assertTrue(matches, (ccn, event))
                self.assertEqual(matches[0]["processing_date"] or None, event["processingDate"])
        self.assertGreater(sum(not f["penalties"]["total"] for f in self.inspection["facilities"].values()), 0)

    def test_certified_18_offices_derive_from_original_fips_not_service_zips(self):
        fips = set(self.manifest["target_counties"].values())
        selected = {r["prvdr_num"]: r for r in self.pos["home_health"]
                    if r["fed_crtfctn_stus_name"] == "Certified"
                    and r["fips_state_cd"] + r["fips_cnty_cd"] in fips}
        self.assertEqual(18, len(selected))
        self.assertEqual(set(selected), set(self.offices["officesByCcn"]))
        self.assertEqual(set(selected), {a["ccn"] for a in self.hh["agencies"]})
        for ccn, row in selected.items():
            emitted = self.offices["officesByCcn"][ccn]
            self.assertEqual(row, emitted["source_record"])
            self.assertEqual(self.manifest["target_counties"][emitted["office_county"]],
                             row["fips_state_cd"] + row["fips_cnty_cd"])
        self.assertIn("317058", selected)
        self.assertEqual("No", selected["317058"]["cmplnc_stus_cd"])
        self.assertNotIn("317004", selected)

    def test_every_agency_exact_ccn_and_original_rows(self):
        q = {r[CCN]: r for r in self.originals["6jpm-sxkc"]}
        s = {r[CCN]: r for r in self.originals["ccn4-8vby"]}
        self.assertEqual(43, len(self.agencies))
        self.assertEqual(set(q), set(self.agencies))
        for ccn, record in self.agencies.items():
            self.assertEqual(q[ccn], record["qualitySource"]["raw"])
            self.assertEqual(s[ccn], record["surveySource"]["raw"])
            for key in ("qualitySource", "surveySource"):
                for source in record[key]["sourceRows"]:
                    self.assertEqual(record[key]["raw"], self.pages[source["file"]][source["rowIndex"]])
            agency = record["evidence"]
            self.assertEqual("cms-" + ccn, agency["organizationId"])
            self.assertEqual(q[ccn]["provider_name"], agency["cmsProviderName"])
            self.assertEqual(q[ccn]["state"], agency["cmsAddress"]["state"])
            self.assertEqual(q[ccn]["zip_code"], agency["cmsAddress"]["zip"])

    def test_every_metric_raw_value_status_and_original_footnote(self):
        missing = 0
        for record in self.agencies.values():
            for section, source_key, dataset in (
                ("qualityOfPatientCare", "qualitySource", "6jpm-sxkc"),
                ("patientExperience", "surveySource", "ccn4-8vby")):
                raw = record[source_key]["raw"]
                source_notes = [value for key, value in raw.items() if "footnote" in key]
                for metric in walk_metrics(record["evidence"][section]):
                    col = metric["sourceColumn"]
                    if col == "not published in source":
                        self.assertIsNone(metric["value"])
                        self.assertIsNone(metric["rawValue"])
                        continue
                    self.assertEqual(raw[col], metric["rawValue"])
                    self.assertEqual(source_number(raw[col]), metric["value"])
                    self.assertEqual("published" if metric["value"] is not None else "not published", metric["status"])
                    self.assertTrue(metric["rawFootnote"] == "" or metric["rawFootnote"] in source_notes)
                    if metric["rawFootnote"].isdigit():
                        self.assertEqual([metric["rawFootnote"]], metric["footnoteCodes"])
                    elif metric["rawFootnote"] not in ("", "-"):
                        self.assertEqual([], metric["footnoteCodes"])
                    missing += metric["value"] is None
        self.assertGreater(missing, 0)
        suppressed = self.agencies["397481"]["evidence"]["qualityOfPatientCare"]["components"]
        walking = next(c for c in suppressed if c["id"] == "walking")
        self.assertEqual("-", walking["rate"]["rawValue"])
        self.assertIsNone(walking["rate"]["value"])
        self.assertIn("too small", walking["rate"]["rawFootnote"])

    def test_clinical_17_measures_have_published_counts_not_fabricated_denominators(self):
        counts = 0
        for record in self.agencies.values():
            raw = record["qualitySource"]["raw"]
            components = record["evidence"]["qualityOfPatientCare"]["components"]
            self.assertEqual(17, len(components))
            for component in components:
                for field in ("publishedNumerator", "publishedDenominator"):
                    metric = component[field]
                    if metric["sourceColumn"] == "not published in source":
                        self.assertEqual("medicare-spending", component["id"])
                        self.assertEqual("publishedNumerator", field)
                        self.assertIsNone(metric["value"])
                    else:
                        self.assertEqual(source_number(raw[metric["sourceColumn"]]), metric["value"])
                        counts += 1
                if component["id"] in ("discharge-community", "preventable-readmission", "preventable-hospitalization"):
                    for field in ("observedRate", "riskStandardizedLowerLimit", "riskStandardizedUpperLimit"):
                        metric = component[field]
                        self.assertEqual(source_number(raw[metric["sourceColumn"]]), metric["value"])
            self.assertEqual({key: None for key in ("professional", "communication", "specific-care", "overall-care", "recommend")},
                             record["surveyMeasureDenominators"])
        self.assertEqual(43 * 33, counts)
        timely = self.agencies["317002"]["evidence"]["qualityOfPatientCare"]["components"][0]
        self.assertEqual(3186, timely["publishedNumerator"]["value"])
        self.assertEqual(3194, timely["publishedDenominator"]["value"])
        self.assertEqual(99.75, timely["rate"]["value"])

    def test_consumer_components_are_percent_and_spending_ratio_is_retained(self):
        for agency in self.hh["agencies"]:
            components = agency["qualityOfPatientCare"]["components"]
            complete = self.agencies[agency["ccn"]]["evidence"]["qualityOfPatientCare"]["components"]
            self.assertEqual(16, len(components))
            self.assertEqual(components, [c for c in complete if c["rate"]["unit"] == "percent"])
            ratios = [c["id"] for c in complete if c["rate"]["unit"] == "ratio"]
            self.assertEqual(["medicare-spending"], ratios)

    def test_source_specific_clinical_survey_and_staffing_periods(self):
        periods = {r["measure_name"]: r["measure_date_range"] for r in self.originals["c886-nwpj"]}
        survey_periods = {r["measure_date_range"] for r in self.originals["fa88-6ff2"]}
        self.assertEqual({"April 1, 2025 to March 31, 2026"}, survey_periods)
        for record in self.agencies.values():
            for component in record["evidence"]["qualityOfPatientCare"]["components"]:
                source_range = periods[component["dateSourceMeasureName"]]
                self.assertEqual(source_range, component["dateSourceRawRange"])
                parts = source_range.split("-", 1)
                days = [datetime.strptime(s.strip(), "%B %d, %Y").date().isoformat() for s in parts]
                self.assertEqual(days, [component["period"]["start"], component["period"]["end"]])
            survey = record["evidence"]["patientExperience"]["period"]
            self.assertEqual(("2025-04-01", "2026-03-31"), (survey["start"], survey["end"]))
        definitions = load(OUT / "source-periods-and-definitions.json")
        staffing = {r["raw"]["measure_code"]: r["raw"] for r in definitions["qmdc-9999"]}
        self.assertEqual(("04/01/2026", "06/30/2026"),
                         tuple(staffing["STAFFING_LEVELS"][k] for k in
                               ("data_collection_period_from_date", "data_collection_period_through_date")))
        self.assertEqual(("04/01/2025", "03/31/2026"),
                         tuple(staffing["STAFFING_TURNOVER"][k] for k in
                               ("data_collection_period_from_date", "data_collection_period_through_date")))

    def test_comparators_have_retained_nj_and_national_source_rows(self):
        refs = self.hh["patientExperienceComparators"]
        self.assertEqual({"state", "national"}, set(refs))
        self.assertEqual("NJ", refs["state"]["code"])
        for key, dataset, identity in (("state", "m5jg-jg7i", ("state", "NJ")),
                                       ("national", "vxub-6swi", ("country", "Nation"))):
            capture = load(OUT / f"sources/{dataset}.rows.json")
            metadata = load(OUT / f"sources/{dataset}.metadata.json")["body"]
            rows = capture["body"]["results"]
            self.assertEqual(1, len(rows))
            self.assertEqual(identity[1], rows[0][identity[0]])
            self.assertEqual(self.hh["releasedAt"], metadata["released"])
            self.assertEqual(refs[key]["sourceFile"], str((OUT / f"sources/{dataset}.rows.json").relative_to(ROOT)))
            for metric in walk_metrics(refs[key]):
                self.assertEqual(rows[0][metric["sourceColumn"]], metric["rawValue"])
                self.assertEqual(source_number(metric["rawValue"]), metric["value"])
            self.assertEqual(5, len(refs[key]["measures"]))
        self.assertEqual(14477, refs["state"]["completedSurveys"]["value"])
        self.assertEqual(993300, refs["national"]["completedSurveys"]["value"])

    def test_service_only_8_agencies_never_enter_office_fragment(self):
        original_edges = load(CMS / "home_health_service_zip_edges.json")
        self.assertEqual(original_edges, self.edges["edges"])
        service_ccns = {e["ccn"] for e in original_edges if e["target_county_candidates"]}
        offices = set(self.offices["officesByCcn"])
        self.assertEqual(26, len(service_ccns))
        self.assertEqual(service_ccns - offices, set(self.service["agencyCcns"]))
        self.assertEqual(8, len(self.service["agencyCcns"]))
        self.assertEqual(set(self.service["agenciesByCcn"]), set(self.service["agencyCcns"]))
        self.assertIn("397736", self.service["agencyCcns"])
        self.assertNotIn("397736", offices)
        self.assertEqual("PA", self.service["agenciesByCcn"]["397736"]["evidence"]["cmsAddress"]["state"])
        self.assertEqual(1246, len(original_edges))
        self.assertEqual(234, sum(e["county"] is None for e in original_edges))
        for edge in original_edges:
            if edge["county"] is None:
                self.assertTrue(edge["target_county_candidates"])
                self.assertGreater(len(edge["crosswalk_county_fips"]), 1)

    def test_source_definitions_preserve_all_original_rows(self):
        definitions = load(OUT / "source-periods-and-definitions.json")
        for key, rows in definitions.items():
            self.assertEqual({original_key(r) for r in self.originals[key]},
                             {original_key(r["raw"]) for r in rows})
            for row in rows:
                for source in row["sourceRows"]:
                    self.assertEqual(row["raw"], self.pages[source["file"]][source["rowIndex"]])

    def test_runtime_fragments_pass_existing_strict_builder_schemas(self):
        spec = importlib.util.spec_from_file_location("clinical_builder_test", ROOT / "scripts/regions/build-region.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        builder.INSPECTION(self.inspection, "inspectionHistory")
        builder.HOME_HEALTH(self.hh, "homeHealthEvidence")
        for ccn, value in self.summaries.items():
            builder.CMS(value, ccn)

    def test_deterministic_default_cli_from_outside_checkout(self):
        result = subprocess.run(
            [sys.executable, "-B", str(ROOT / "scripts/regions/clinical-nj.py"), "--check"],
            cwd=OUT, capture_output=True, text=True, timeout=120)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual("check", json.loads(result.stdout)["mode"])

    def test_generation_preserves_every_released_byte_including_manifest(self):
        spec = importlib.util.spec_from_file_location("clinical_generation_test", ROOT / "scripts/regions/clinical-nj.py")
        transform = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(transform)
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            with patch.object(transform, "OUTPUT", destination), patch.object(
                    sys, "argv", ["clinical-nj.py"]):
                transform.main()
            expected = set(self.emitted["outputs"]) | {"manifest.json"}
            self.assertEqual(expected, {path.name for path in destination.iterdir()})
            for name in sorted(expected):
                with self.subTest(artifact=name):
                    self.assertEqual((OUT / name).read_bytes(), (destination / name).read_bytes())

    def test_numeric_and_text_footnotes_and_missing_boundary(self):
        spec = importlib.util.spec_from_file_location("clinical_transform_test", ROOT / "scripts/regions/clinical-nj.py")
        transform = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(transform)
        self.assertEqual(["11"], transform.metric({"score": "-", "note": "11"}, "score", "percent", "note")["footnoteCodes"])
        value = transform.metric({"score": "-", "note": "less than 6 months"}, "score", "percent", "note")
        self.assertEqual([], value["footnoteCodes"])
        self.assertIsNone(value["value"])
        self.assertIsNone(transform.metric({}, None, "episodes")["value"])
        self.assertEqual(0, transform.number("0"))
        for raw in ("unknown", "NaN", "Infinity", "12%"):
            with self.assertRaises(ValueError):
                transform.number(raw)
        with self.assertRaises(ValueError):
            transform.metric({}, "missing", "percent")


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False).result
    if result.wasSuccessful():
        report = {
            "status": "passed", "testsRun": result.testsRun,
            "command": "PYTHONDONTWRITEBYTECODE=1 python3 scripts/regions/clinical-nj-test.py",
            "existingChecksUsed": ["build-region.py INSPECTION, HOME_HEALTH, CMS"],
            "newChecks": [name for name in dir(OriginalSourceTests) if name.startswith("test_")],
        }
        (OUT / "python-test-results.json").write_text(json.dumps(report, indent=2) + "\n")
    sys.exit(0 if result.wasSuccessful() else 1)
