#!/usr/bin/env python3
"""Rebuild North Jersey clinical fragments offline from retained CMS responses."""

import argparse
from collections import defaultdict
from datetime import date, datetime
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
CMS = ROOT / "research/north-jersey/cms"
OUTPUT = ROOT / "research/north-jersey/clinical"
CCN = "cms_certification_number_ccn"
CAP = 25
SUMMARY_COLUMNS = {
    "overall": "overall_rating", "inspections": "health_inspection_rating",
    "staffing": "staffing_rating", "quality": "qm_rating",
    "totalNurseHours": "reported_total_nurse_staffing_hours_per_resident_per_day",
    "rnHours": "reported_rn_staffing_hours_per_resident_per_day",
    "turnover": "total_nursing_staff_turnover", "fines": "number_of_fines",
    "fineAmount": "total_amount_of_fines_in_dollars",
    "paymentDenials": "number_of_payment_denials",
    "healthDeficiencies": "rating_cycle_1_total_number_of_health_deficiencies",
}
CLINICAL = [
    ("timely-care", "how_often_the_home_health_team_began_their_patients_care_in_d440", "How often the home health team began their patients' care in a timely manner", "higher"),
    ("flu-shot", "how_often_the_home_health_team_determined_whether_patients__4505", "How often the home health team made sure that their patients have received a flu shot for the current flu season", "higher"),
    ("walking", "how_often_patients_got_better_at_walking_or_moving_around", "How often patients got better at walking or moving around", "higher"),
    ("transferring", "how_often_patients_got_better_at_getting_in_and_out_of_bed", "How often patients got better at getting in and out of bed", "higher"),
    ("bathing", "how_often_patients_got_better_at_bathing", "How often patients got better at bathing", "higher"),
    ("breathing", "how_often_patients_breathing_improved", "How often patients' breathing improved", "higher"),
    ("oral-medications", "how_often_patients_got_better_at_taking_their_drugs_correct_bd88", "How often patients got better at taking their drugs correctly by mouth", "higher"),
    ("pressure-injury", "changes_in_skin_integrity_postacute_care_pressure_ulcerinjury", "Changes in skin integrity post-acute care: pressure ulcer/injury", "lower"),
    ("medication-review", "how_often_physicianrecommended_actions_to_address_medicatio_cc88", "How often the home health team checked patients' medications and got doctor's orders for medication issues in a timely manner", "higher"),
    ("major-injury-falls", "percent_of_residents_experiencing_one_or_more_falls_with_ma_34b8", "How often a patient had one or more falls with a major injury", "lower"),
    ("discharge-function", "discharge_function_score", "Discharge Function Score", "higher"),
    ("transfer-provider", "transfer_of_health_information_to_the_provider", "Transfer of Health Information to the Provider", "higher"),
    ("transfer-patient", "transfer_of_health_information_to_the_patient", "Transfer of Health Information to the Patient", "higher"),
    ("discharge-community", "dtc_riskstandardized_rate", "How often patients remained at home within 31 days of being discharged from home health", "higher"),
    ("preventable-readmission", "ppr_riskstandardized_rate", "How often home health patients, who have had a recent hospital stay, had a preventable hospital readmission within 30 days of discharge from home health", "lower"),
    ("preventable-hospitalization", "pph_riskstandardized_rate", "How often patients were admitted to the hospital for a potentially-preventable condition while receiving home health care", "lower"),
    ("medicare-spending", "how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6", "Average Medicare spending associated with an agency's home health episodes compared with all home health episodes nationally - agency score", "lower"),
]
SURVEY = [
    ("professional", "percent_of_patients_who_reported_that_their_home_health_tea_c7be", "star_rating_for_health_team_gave_care_in_a_professional_way", "footnote_for_star_rating_for_gave_care_in_a_professional_way"),
    ("communication", "percent_of_patients_who_reported_that_their_home_health_tea_7896", "star_rating_for_health_team_communicated_well_with_them", "footnote_for_star_rating_for_communicated_well_with_them"),
    ("specific-care", "percent_of_patients_who_reported_that_their_home_health_tea_7ba5", "star_rating_team_discussed_medicines_pain_and_home_safety", "footnote_star_rating_discussed_medicines_pain_home_safety"),
    ("overall-care", "percent_of_patients_who_gave_their_home_health_agency_a_rat_187c", "star_rating_for_how_patients_rated_overall_care_from_agency", "footnote_for_star_rating_for_overall_care_from_agency"),
    ("recommend", "percent_of_patients_who_reported_yes_they_would_definitely__2707", None, None),
]
FOOTNOTES = {
    "1": "This agency provides services under a federal waiver program to non-traditional, chronic long term population.",
    "2": "This agency provides services to a special needs population.",
    "3": "Not Available.",
    "4": "The number of patient episodes for this measure is too small to report.",
    "5": "This measure currently does not have data or provider has been certified/recertified for less than 6 months.",
    "6": "The national average for this measure is not provided because of state-to-state differences in data collection.",
    "7": "Medicare is not displaying rates for this measure for any home health agency, because of an issue with the data.",
    "8": "There were problems with the data and they are being corrected.",
    "9": "Zero, or very few, patients met the survey's rules for inclusion. The scores shown, if any, reflect a very small number of surveys and may not accurately tell how an agency is doing.",
    "10": "Survey results are based on less than 12 months of data.",
    "11": "Fewer than 70 patients completed the survey. Use the scores shown, if any, with caution as the number of surveys may be too low to accurately tell how an agency is doing.",
    "12": "No survey results are available for this period.",
    "13": "Data suppressed by CMS for one or more quarters.",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2,
                       allow_nan=False) + "\n").encode()


def digest(body):
    return hashlib.sha256(body).hexdigest()


def row_key(row):
    return json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def row_id(row):
    return digest(row_key(row).encode())[:20]


def number(raw):
    if raw is None or str(raw).strip() in {"", "-", "NA", "N/A", "Not Available", "Not Applicable"}:
        return None
    value = str(raw).strip().replace(",", "")
    require(bool(re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", value)),
            f"Unexpected numeric source value {raw!r}")
    result = float(value)
    require(math.isfinite(result), "Nonfinite source number")
    return int(result) if result.is_integer() else result


def iso(raw):
    if raw in (None, ""):
        return None
    return date.fromisoformat(raw).isoformat()


def flag(raw):
    require(raw in (None, "", "Y", "N"), f"Unexpected flag {raw!r}")
    return None if raw in (None, "") else raw == "Y"


def period(raw):
    parts = re.split(r"\s+to\s+|(?<=\d)-(?=[A-Z])", raw)
    require(len(parts) == 2, f"Unrecognized measure interval {raw!r}")
    days = [datetime.strptime(p.strip(), "%B %d, %Y").date().isoformat() for p in parts]
    require(days[0] <= days[1], "Reversed measure interval")
    return {"start": days[0], "end": days[1], "label": raw}


def load_builder():
    spec = importlib.util.spec_from_file_location("clinical_region_schema", ROOT / "scripts/regions/build-region.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Archive:
    def __init__(self, root=CMS, output=OUTPUT):
        self.root, self.output = root, output
        self.consumed = {}
        self.cache = {}
        self.manifest = self.read(root / "manifest.json")
        require(self.manifest["status"] == "complete", "CMS collection is incomplete")
        self.verified = {}
        for item in self.manifest["artifacts"]:
            path = root / item["file"]
            require(path.resolve().is_relative_to(root.resolve()), "CMS artifact escapes source directory")
            body = path.read_bytes()
            require(len(body) == item["bytes"] and digest(body) == item["sha256"],
                    f"CMS artifact hash mismatch {path}")
            self.verified[path] = item["sha256"]
        self.datasets, self.provenance, self.labels = {}, {}, {}
        for dataset_id, source in self.manifest["sources"].items():
            require(source["complete"], f"Incomplete dataset {dataset_id}")
            rows = self.read(root / f"datasets/{dataset_id}.json")
            original = defaultdict(list)
            labels = {}
            for partition in source["partitions"]:
                require(partition["complete"], f"Incomplete partition {dataset_id}")
                pages = partition["pages"]
                require([p["offset"] for p in pages] ==
                        list(range(0, max(1, partition["expected_count"]), partition["page_size"])),
                        f"Missing source page {dataset_id}")
                retained_count = 0
                for receipt in pages:
                    path = root / receipt["file"]
                    relative = self.relative(path)
                    payload = self.read(path)
                    require(self.consumed[relative]["sha256"] == receipt["sha256"],
                            f"Receipt mismatch {path}")
                    require(payload["count"] == partition["expected_count"], f"Count drift {dataset_id}")
                    require(payload["query"].get("conditions", []) == partition["conditions"],
                            f"Query partition drift {dataset_id}")
                    require(len(payload["results"]) == receipt["rows"], f"Row count drift {dataset_id}")
                    retained_count += len(payload["results"])
                    for schema in payload["schema"].values():
                        labels.update({k: v["description"] for k, v in schema["fields"].items()})
                    for index, row in enumerate(payload["results"]):
                        original[row_key(row)].append({
                            "file": relative, "rowIndex": index,
                            "sha256": receipt["sha256"], "datasetId": dataset_id,
                            "partition": partition["name"],
                        })
                require(retained_count == partition["expected_count"], f"Truncated dataset {dataset_id}")
            require({row_key(r) for r in rows} == set(original), f"Original/dataset mismatch {dataset_id}")
            require(len(rows) == len(original), f"Duplicate dataset rows {dataset_id}")
            self.datasets[dataset_id] = rows
            self.provenance[dataset_id] = original
            self.labels[dataset_id] = labels
        self.latest = self.read(root / "pos/latest.json")
        self.pos_root = root / "pos" / self.latest["snapshot"]
        require(self.pos_root.resolve().is_relative_to((root / "pos/snapshots").resolve()),
                "POS snapshot escapes archive")
        self.pos_manifest = self.read(self.pos_root / "manifest.json")
        for name, receipt in self.pos_manifest["receipts"].items():
            path = self.pos_root / name
            body = path.read_bytes()
            require(len(body) == receipt["bytes"] and digest(body) == receipt["sha256"],
                    f"POS hash mismatch {name}")
            self.consumed[self.relative(path)] = {"sha256": digest(body), "bytes": len(body)}
        self.pos = self.read(self.pos_root / "supplement.json")
        require(self.pos["release"] == self.pos_manifest["release"], "POS release mismatch")
        for family, entries in self.pos["records"].items():
            for entry in entries:
                origin = entry["source"]
                path = self.pos_root / origin["file"]
                raw = self.read(path)[origin["row_index"]]
                require(raw == entry["source_record"] and raw["prvdr_num"] == entry["ccn"],
                        f"POS source row mismatch {entry['ccn']}")
                require(self.consumed[self.relative(path)]["sha256"] == origin["response_sha256"],
                        "POS row receipt mismatch")
                county_fips = raw["fips_state_cd"] + raw["fips_cnty_cd"]
                county = next((name for name, fips in self.manifest["target_counties"].items()
                               if fips == county_fips), None)
                require(entry["office_county"] == county, "POS county projection mismatch")
                selection = ("not_certified_not_selected"
                             if raw["fed_crtfctn_stus_name"] != "Certified" else
                             "certified_target_office_county" if county else
                             "certified_other_or_unknown_office_county")
                require(entry["selection"] == selection, "POS certification selection mismatch")
        self.checked = self.manifest["completed_at"][:10]
        self.target_counties = self.manifest["target_counties"]

    def relative(self, path):
        return str(path.relative_to(ROOT))

    def read(self, path):
        if path in self.cache:
            return self.cache[path]
        data = path.read_bytes()
        ref = self.relative(path)
        expected = self.consumed.get(ref)
        require(expected is None or expected["sha256"] == digest(data), f"Input changed {path}")
        if hasattr(self, "verified") and path in self.verified:
            require(digest(data) == self.verified[path], f"Input changed {path}")
        self.consumed[ref] = {"sha256": digest(data), "bytes": len(data)}
        self.cache[path] = json.loads(data)
        return self.cache[path]

    def retained(self, dataset_id, row):
        return {"id": row_id(row), "raw": row,
                "sourceRows": self.provenance[dataset_id][row_key(row)]}

    def source(self, dataset_id, inspection=False):
        meta = self.manifest["sources"][dataset_id]
        common = {"datasetId": dataset_id, "title": meta["title"], "url": meta["landing_url"],
                  "downloadUrl": meta["distribution"][0]["downloadURL"], "modified": meta["modified"]}
        if inspection:
            return {**common, "released": meta["released"]}
        return {**common, "publisher": "Centers for Medicare & Medicaid Services",
                "checkedAt": meta["retrieved_at"][:10], "releasedAt": meta["released"]}

    def unchanged(self):
        for name, receipt in self.consumed.items():
            require(digest((ROOT / name).read_bytes()) == receipt["sha256"], f"Input changed {name}")


def citations(row):
    require(row["survey_type"] == "Health" and row["deficiency_prefix"] == "F",
            "Nonhealth row in health history")
    require(bool(re.fullmatch(r"\d{4}", row["deficiency_tag_number"])), "Invalid citation tag")
    severity = row["scope_severity_code"] or None
    require(severity is None or severity in list("ABCDEFGHIJKL"), "Invalid scope/severity")
    require(bool(row["deficiency_description"].strip()), "Missing citation description")
    return {
        "id": row_id(row), "surveyDate": iso(row["survey_date"]),
        "tag": row["deficiency_prefix"] + row["deficiency_tag_number"],
        "category": row["deficiency_category"], "description": row["deficiency_description"],
        "scopeSeverityCode": severity, "standard": flag(row.get("standard_deficiency")),
        "complaint": flag(row.get("complaint_deficiency")),
        "infectionControl": flag(row.get("infection_control_inspection_deficiency")),
        "correctionStatus": row.get("deficiency_corrected") or None,
        "correctionDate": iso(row.get("correction_date")),
        "inspectionCycle": row.get("inspection_cycle") or None,
        "underIDR": flag(row.get("citation_under_idr")), "underIIDR": flag(row.get("citation_under_iidr")),
        "surveyFootnote": row.get("survey_footnote") or None,
        "processingDate": iso(row.get("processing_date")),
    }


def penalty(row):
    require(row["penalty_type"] in ("Fine", "Payment Denial"), "Unrecognized penalty")
    return {
        "id": row_id(row), "date": iso(row.get("penalty_date")), "type": row["penalty_type"],
        "fineId": row.get("fine_id") or None, "fineAmount": number(row.get("fine_amount")),
        "paymentDenialStartDate": iso(row.get("payment_denial_start_date")),
        "paymentDenialLengthDays": number(row.get("payment_denial_length_in_days")),
        "processingDate": iso(row.get("processing_date")),
    }


def latest(rows, key):
    return sorted(rows, key=lambda r: (-(date.fromisoformat(r[key]).toordinal()) if r[key] else 0, r["id"]))


def nursing(archive):
    target = {r[CCN]: r for r in archive.datasets["4pq5-n9py"]
              if r["state"] == "NJ" and r["countyparish"] in archive.target_counties}
    require(len(target) == 139, "Expected 139 target nursing CCNs")
    certified = {r["ccn"]: r for r in archive.pos["records"]["nursing"]
                 if r["selection"] == "certified_target_office_county"}
    require(set(certified) == set(target), "Nursing certification/PDC identity mismatch")
    indexed = {}
    for dataset_id, rows in archive.datasets.items():
        by_ccn = defaultdict(list)
        for row in rows:
            if row.get(CCN) in target:
                require(row.get("state", "NJ") == "NJ", "Foreign nursing row")
                by_ccn[row[CCN]].append(row)
        indexed[dataset_id] = by_ccn
    histories, summaries, evidence = {}, {}, {}
    for ccn, row in sorted(target.items()):
        require(certified[ccn]["office_county"] == row["countyparish"], "Nursing county mismatch")
        health = latest([citations(r) for r in indexed["r5ix-sfxw"][ccn]], "surveyDate")
        penalties = latest([penalty(r) for r in indexed["g6vv-u9sr"][ccn]], "date")
        histories[ccn] = {
            "healthCitations": {"total": len(health), "records": health[:CAP]},
            "penalties": {"total": len(penalties), "records": penalties[:CAP],
                          "fineCount": sum(r["type"] == "Fine" for r in penalties),
                          "paymentDenialCount": sum(r["type"] == "Payment Denial" for r in penalties)},
        }
        summary = {key: number(row[col]) for key, col in SUMMARY_COLUMNS.items()}
        require(row["abuse_icon"] in ("Y", "N"), "Missing abuse flag cannot become false")
        summary.update(ccn=ccn, abuse=flag(row["abuse_icon"]),
                       specialFocus=row["special_focus_status"] or None,
                       dataAsOf=archive.manifest["sources"]["4pq5-n9py"]["released"])
        inspection_date = iso(row["rating_cycle_1_standard_survey_health_date"])
        if inspection_date:
            summary["lastInspection"] = inspection_date
        summaries[ccn] = summary
        evidence[ccn] = {
            "providerId": "cms-" + ccn, "officeCounty": row["countyparish"],
            "cms": summary, "certification": certified[ccn],
            "datasets": {key: [archive.retained(key, r) for r in index[ccn]]
                         for key, index in indexed.items() if index[ccn]},
            "collectionAvailability": {
                key: {"status": "complete retained extract", "rows": len(index[ccn]),
                      "meaning": "No rows means no published rows in this source window, not a lifetime clean record."}
                for key, index in indexed.items() if archive.manifest["sources"][key]["family"] == "nursing"
                and archive.manifest["sources"][key]["scope"] not in ("national",)
            },
        }
    refs = [r for r in archive.manifest["references"]
            if r["role"] == "data_dictionary_and_footnotes" and "nursing_home" in r["url"]]
    require(len(refs) == 1, "Missing nursing dictionary")
    snapshot = {"version": 1, "retrieved": archive.checked, "maxRecordsPerCollection": CAP,
                "dictionaryUrl": refs[0]["url"],
                "sources": [archive.source(i, inspection=True) for i in ("r5ix-sfxw", "g6vv-u9sr")],
                "facilities": histories}
    return snapshot, summaries, evidence


def normalized_label(label):
    return re.sub(r"[^a-z0-9]", "", label.lower())


def related_column(labels, label, prefix):
    expected = normalized_label(prefix + label)
    matches = [col for col, text in labels.items() if normalized_label(text) == expected]
    require(len(matches) <= 1, f"Ambiguous source column {label}")
    return matches[0] if matches else None


def metric(row, column, unit, footnote=None):
    require(column is None or column in row, f"Missing source column {column}")
    raw = row[column] if column is not None else None
    raw_note = row[footnote] if footnote is not None else ""
    require(isinstance(raw_note, str), "Footnote must remain source text")
    codes = re.findall(r"\d+", raw_note) if re.fullmatch(r"\d+(?:\s*[,;]\s*\d+)*", raw_note) else []
    value = number(raw)
    return {"value": value, "unit": unit, "sourceColumn": column or "not published in source",
            "rawValue": raw, "rawFootnote": raw_note, "footnoteCodes": codes,
            "status": "published" if value is not None else "not published"}


def survey_measures(row, labels, include_stars):
    result = []
    for mid, col, star, note in SURVEY:
        footnote = related_column(labels, labels[col], "Footnote for ")
        item = {"id": mid, "label": labels[col], "percent": metric(row, col, "percent", footnote)}
        if include_stars:
            item["starRating"] = metric(row, star, "stars", note) if star else None
        result.append(item)
    return result


def hh_components(row, labels, dates):
    result = []
    for mid, col, date_name, direction in CLINICAL:
        label = labels[col]
        raw_period = dates[date_name]
        footnote = related_column(labels, label, "Footnote for ") or related_column(labels, label, "Footnote ")
        item = {
            "id": mid, "label": label, "rate": metric(row, col, "ratio" if mid == "medicare-spending" else "percent", footnote),
            "betterDirection": direction, "period": period(raw_period),
            "dateSourceMeasureName": date_name, "dateSourceRawRange": raw_period,
            "calculationNote": "Published rate retained, not recomputed from counts. Counts are measure-specific, not survey denominators.",
        }
        if col.startswith(("dtc_", "ppr_", "pph_")):
            prefix = col.split("_", 1)[0]
            num_col, den_col = prefix + "_numerator", prefix + "_denominator"
            for key, suffix in (("observedRate", "_observed_rate"),
                                ("riskStandardizedLowerLimit", "_riskstandardized_rate_lower_limit"),
                                ("riskStandardizedUpperLimit", "_riskstandardized_rate_upper_limit")):
                item[key] = metric(row, prefix + suffix, "percent")
            item["cmsPerformanceCategorization"] = row[prefix + "_performance_categorization"]
        else:
            num_col = related_column(labels, label, "Numerator for ")
            den_col = related_column(labels, label, "Denominator for ")
        if mid == "medicare-spending":
            den_col = "no_of_episodes_to_calc_how_much_medicare_spends_per_episode_4f4e"
            item["calculationNote"] = "The denominator is CMS's published episode count for spending. No numerator is published. The rate is a spending ratio, not a percentage."
        item["publishedNumerator"] = metric(row, num_col, "episodes")
        item["publishedDenominator"] = metric(row, den_col, "episodes")
        result.append(item)
    return result


def supplemental_comparators(archive, survey_period, released):
    comparators, sources = {}, []
    receipts = archive.read(archive.output / "sources/capture-receipts.json")["sha256"]
    for key, dataset_id, identity in (("state", "m5jg-jg7i", ("state", "NJ")),
                                      ("national", "vxub-6swi", ("country", "Nation"))):
        path = archive.output / f"sources/{dataset_id}.rows.json"
        capture = archive.read(path)
        metadata_path = archive.output / f"sources/{dataset_id}.metadata.json"
        meta_capture = archive.read(metadata_path)
        for captured_path in (path, metadata_path):
            require(receipts[captured_path.name] == archive.consumed[archive.relative(captured_path)]["sha256"],
                    f"Comparator capture hash mismatch {captured_path.name}")
        api = "https://data.cms.gov/provider-data/api/1/"
        expected_query = ("?limit=100&conditions%5B0%5D%5Bproperty%5D=state&conditions%5B0%5D%5Bvalue%5D=NJ&conditions%5B0%5D%5Boperator%5D=%3D"
                          if key == "state" else "?limit=10")
        require(capture["url"] == api + "datastore/query/" + dataset_id + "/0" + expected_query
                and meta_capture["url"] == api + "metastore/schemas/dataset/items/" + dataset_id,
                f"Unexpected comparator source URL {dataset_id}")
        meta = meta_capture["body"]
        payload = capture["body"]
        require(capture["statusCode"] == meta_capture["statusCode"] == 200, "Failed comparator capture")
        require(meta["identifier"] == dataset_id and meta["released"] == released,
                "Comparator release differs from archived HHCAHPS")
        require(len(payload["results"]) == payload["count"] == 1, "Ambiguous comparator")
        row = payload["results"][0]
        require(row[identity[0]] == identity[1], "Wrong comparator identity")
        labels = {k: v["description"] for schema in payload["schema"].values()
                  for k, v in schema["fields"].items()}
        value = {
            "period": survey_period, "releasedAt": meta["released"],
            "measures": survey_measures(row, labels, False),
            "completedSurveys": metric(row, "number_of_completed_surveys", "completed surveys"),
            "responseRate": metric(row, "survey_response_rate", "percent"),
            "sourceFile": archive.relative(path),
        }
        if key == "state":
            value.update(code="NJ", label="New Jersey")
        comparators[key] = value
        sources.append({
            "datasetId": dataset_id, "title": meta["title"], "url": meta["landingPage"],
            "downloadUrl": meta["distribution"][0]["downloadURL"], "modified": meta["modified"],
            "publisher": "Centers for Medicare & Medicaid Services", "releasedAt": meta["released"],
            "checkedAt": capture["checkedAt"],
        })
    return comparators, sources


def home_health(archive):
    quality = {r[CCN]: r for r in archive.datasets["6jpm-sxkc"]}
    surveys = {r[CCN]: r for r in archive.datasets["ccn4-8vby"]}
    require(len(quality) == len(archive.datasets["6jpm-sxkc"]), "Duplicate quality CCN")
    require(len(surveys) == len(archive.datasets["ccn4-8vby"]), "Duplicate survey CCN")
    require(set(quality) == set(surveys), "Unmatched quality/survey reporting unit")
    certified = {r["ccn"]: r for r in archive.pos["records"]["home_health"]
                 if r["source_record"]["fed_crtfctn_stus_name"] == "Certified"}
    require(set(certified) == {ccn for ccn, r in quality.items() if r["state"] == "NJ"},
            "Certified NJ offices do not match clinical roster")
    target = {ccn for ccn, r in certified.items() if r["office_county"] in archive.target_counties}
    require(len(target) == 18, "Expected 18 certified target offices")
    clinical_dates = {r["measure_name"]: r["measure_date_range"] for r in archive.datasets["c886-nwpj"]}
    survey_ranges = {r["measure_date_range"] for r in archive.datasets["fa88-6ff2"]}
    require(len(survey_ranges) == 1, "Mixed HHCAHPS periods require per-measure review")
    survey_period = period(next(iter(survey_ranges)))
    release = archive.manifest["sources"]["ccn4-8vby"]["released"]
    comparators, comparator_sources = supplemental_comparators(archive, survey_period, release)
    sources = [archive.source(i) for i in ("6jpm-sxkc", "ccn4-8vby", "c886-nwpj", "fa88-6ff2")] + comparator_sources
    labels, slabels = archive.labels["6jpm-sxkc"], archive.labels["ccn4-8vby"]
    agencies, retained = {}, {}
    for ccn, q in sorted(quality.items()):
        require(bool(re.fullmatch(r"\d{6}", ccn)), "Malformed reporting CCN")
        s = surveys[ccn]
        components = hh_components(q, labels, clinical_dates)
        star_periods = {row_key(c["period"]) for c in components if c["id"] in
                        {"timely-care", "walking", "transferring", "bathing", "breathing", "oral-medications"}}
        require(len(star_periods) == 1, "Mixed star-component intervals require review")
        warnings = [
            "Agency-level clinical evidence is not branch-specific evidence, an endorsement, or current availability.",
            "HHCAHPS completed surveys are not measure-specific response denominators. Those denominators are not published in this extract.",
        ]
        if ccn in certified and certified[ccn]["source_record"]["cmplnc_stus_cd"] != "Yes":
            warnings.append("iQIES reports Certified and compliance " + certified[ccn]["source_record"]["cmplnc_stus_cd"] + ". These are separate source facts.")
        if any(c["rate"]["value"] is None for c in components):
            warnings.append("Some clinical values are not published. Retained raw markers and footnotes explain the source limits.")
        agency = {
            "ccn": ccn, "organizationId": "cms-" + ccn, "organizationName": q["provider_name"],
            "cmsProviderName": q["provider_name"],
            "cmsAddress": {"street": q["address"], "city": q["citytown"], "state": q["state"], "zip": q["zip_code"]},
            "scope": "Exact CMS-certified reporting agency. Office geography and CMS-reported service ZIPs are separate.",
            "releasedAt": archive.manifest["sources"]["6jpm-sxkc"]["released"],
            "checkedAt": archive.checked,
            "qualityOfPatientCare": {
                "starRating": metric(q, "quality_of_patient_care_star_rating", "stars", "footnote_for_quality_of_patient_care_star_rating"),
                "starComponentPeriod": json.loads(next(iter(star_periods))),
                "components": components, "datasetId": "6jpm-sxkc",
                "measurementPeriodNote": "The common OASIS component interval is shown separately. Each measure retains its own period. Release dates are not measurement dates. No star rating is recalculated.",
                "measureDateRangesFile": "research/north-jersey/cms/datasets/c886-nwpj.json",
                "rawUnitRowFile": "research/north-jersey/clinical/home-health-agency-evidence.json#/agenciesByCcn/" + ccn + "/qualitySource",
            },
            "patientExperience": {
                "datasetId": "ccn4-8vby", "period": survey_period,
                "summaryStarRating": metric(s, "hhcahps_survey_summary_star_rating", "stars", "hhcahps_survey_summary_star_rating_footnote"),
                "completedSurveys": metric(s, "number_of_completed_surveys", "completed surveys", "footnote_for_number_of_completed_surveys"),
                "responseRate": metric(s, "survey_response_rate", "percent", "footnote_for_survey_response_rate"),
                "generalFootnoteCodes": re.findall(r"\d+", s["footnote_number"]),
                "rawGeneralFootnote": s["footnote_number"],
                "measures": survey_measures(s, slabels, True),
                "rawUnitRowFile": "research/north-jersey/clinical/home-health-agency-evidence.json#/agenciesByCcn/" + ccn + "/surveySource",
            },
            "sources": sources[:2], "warnings": warnings,
        }
        # The current consumer displays component rates with a percent suffix.
        # Preserve the spending ratio in retained evidence with its original unit.
        agencies[ccn] = {**agency, "qualityOfPatientCare": {
            **agency["qualityOfPatientCare"], "components": [c for c in components if c["rate"]["unit"] == "percent"]}}
        retained[ccn] = {
            "evidence": agency, "qualitySource": archive.retained("6jpm-sxkc", q),
            "surveySource": archive.retained("ccn4-8vby", s), "certification": certified.get(ccn),
            "surveyMeasureDenominators": {mid: None for mid, *_ in SURVEY},
            "officeRole": "certified-target-office" if ccn in target else "outside-target-office",
        }
    edges = archive.read(archive.root / "home_health_service_zip_edges.json")
    service_ccns = {e["ccn"] for e in edges if e["target_county_candidates"]}
    require(service_ccns <= set(agencies), "Service agency lacks clinical roster identity")
    service_only = sorted(service_ccns - target)
    common = {
        "schemaVersion": 1, "retrieved": archive.checked,
        "releasedAt": archive.manifest["sources"]["6jpm-sxkc"]["released"], "sources": sources,
        "clinicalMeasureDateRanges": [{"measure": r["measure_name"], "rawPeriod": r["measure_date_range"]}
                                      for r in archive.datasets["c886-nwpj"]],
        "surveyMeasureDateRanges": [{"measure": r["measure_name"], "rawPeriod": r["measure_date_range"]}
                                    for r in archive.datasets["fa88-6ff2"]],
        "patientExperienceComparators": comparators, "footnoteDefinitions": FOOTNOTES,
        "interpretationRules": [
            "Clinical measures, HHCAHPS patient experience, certification, and consumer reviews have separate meanings.",
            "Missing or suppressed values remain null with original markers and footnotes, never zero.",
            "Clinical denominators are the published counts for that measure. No HHCAHPS item denominator is inferred from completed surveys.",
            "Reported service ZIPs are not office county, countywide service, current acceptance, or availability.",
            "Footnote definitions are transcribed from retained HHS Data Dictionary version 14.0, Table 14, page 47. Codes 14 through 16 apply only to HHVBP and are not used here.",
        ],
    }
    return ({**common, "agencies": [agencies[c] for c in sorted(target)]},
            {"agenciesByCcn": retained},
            {"officesByCcn": {c: certified[c] for c in sorted(target)},
             "otherCertifiedOfficesByCcn": {c: certified[c] for c in sorted(set(certified) - target)}},
            {"agencyCcns": service_only, "agenciesByCcn": {c: retained[c] for c in service_only}},
            {"edges": edges, "targetServiceAgencyCcns": sorted(service_ccns),
             "serviceOnlyAgencyCcns": service_only,
             "meaning": "County candidates and ambiguity are retained from the 2025Q3 CMSgov-hosted HUD crosswalk. These edges never select offices."})


def generate():
    archive = Archive()
    inspection, summaries, evidence = nursing(archive)
    hh, hh_retained, offices, service_only, edges = home_health(archive)
    builder = load_builder()
    builder.INSPECTION(inspection, "inspectionHistory")
    builder.HOME_HEALTH(hh, "homeHealthEvidence")
    for ccn, summary in summaries.items():
        builder.CMS(summary, "nursingCmsByCcn." + ccn)
    artifacts = {
        "inspection-history.json": inspection, "home-health-evidence.json": hh,
        "nursing-cms-by-ccn.json": summaries, "nursing-evidence-by-ccn.json": evidence,
        "home-health-agency-evidence.json": hh_retained, "home-health-certified-offices.json": offices,
        "home-health-service-only.json": service_only, "home-health-service-zip-edges.json": edges,
        "source-periods-and-definitions.json": {
            key: [archive.retained(key, row) for row in archive.datasets[key]]
            for key in ("qmdc-9999", "tagd-9999", "hicp-9999", "c886-nwpj", "fa88-6ff2")
        },
    }
    counts = {
        "nursingCcns": len(summaries), "certifiedTargetHomeHealthOffices": len(hh["agencies"]),
        "allHomeHealthClinicalAgencies": len(hh_retained["agenciesByCcn"]),
        "serviceTargetAgencies": len(edges["targetServiceAgencyCcns"]),
        "serviceOnlyAgencies": len(service_only["agencyCcns"]),
        "serviceZipEdges": len(edges["edges"]),
        "targetCandidateEdges": sum(bool(e["target_county_candidates"]) for e in edges["edges"]),
        "healthCitations": sum(f["healthCitations"]["total"] for f in inspection["facilities"].values()),
        "retainedRuntimeCitations": sum(len(f["healthCitations"]["records"]) for f in inspection["facilities"].values()),
        "penalties": sum(f["penalties"]["total"] for f in inspection["facilities"].values()),
        "verifiedCmsArtifacts": len(archive.verified), "cmsDatasets": len(archive.datasets),
    }
    manifest = {
        "schemaVersion": 1, "counts": counts,
        "cmsManifest": archive.relative(CMS / "manifest.json"),
        "posSnapshot": archive.relative(archive.pos_root),
        "datasetIds": sorted(archive.datasets),
        "supplementalDatasetIds": ["m5jg-jg7i", "vxub-6swi"],
        "consumedArtifacts": archive.consumed,
        "outputs": {name: {"sha256": digest(encode(value)), "bytes": len(encode(value))}
                    for name, value in artifacts.items()},
        "runtimeArtifactReferences": {
            key: {"path": "clinical/" + name, "sha256": digest(encode(artifacts[name])), "count": count}
            for key, name, count in (
                ("inspectionHistory", "inspection-history.json", len(inspection["facilities"])),
                ("homeHealthEvidence", "home-health-evidence.json", len(hh["agencies"])))
        },
    }
    archive.unchanged()
    return artifacts | {"manifest.json": manifest}, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare deterministic output without writing")
    args = parser.parse_args()
    outputs, counts = generate()
    for name, value in outputs.items():
        path = OUTPUT / name
        require(not path.is_symlink(), "Output must not be a symlink")
        body = encode(value)
        if args.check:
            require(path.read_bytes() == body, f"Generated output differs {name}")
        else:
            OUTPUT.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
    print(json.dumps({"mode": "check" if args.check else "generate", **counts}, sort_keys=True))


if __name__ == "__main__":
    main()
