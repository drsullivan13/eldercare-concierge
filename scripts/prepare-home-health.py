#!/usr/bin/env python3
"""Validate/rebuild the exact seven-unit evidence snapshot from retained CMS inputs.
Research normalization is retained, never synthesized at request time. Every
numeric/raw survey and quality field is checked against its original CMS row.
Run: python scripts/prepare-home-health.py (offline, standard library only).
"""

import hashlib, json, re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "src/data/inputs/home-health"
EXPECTED = {
    "vna-care": ["227068", "227098"],
    "south-shore-vna": ["227082"],
    "mgb-home-care": ["227207"],
    "croi-health": ["227241"],
    "all-care": ["227263"],
    "bilh-at-home": ["227495"],
}


def load(name):
    return json.loads((INPUT / name).read_text())


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def numeric(raw):
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "")
    if text in {"", "-", "NA", "N/A", "Not Available"}:
        return None
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", text):
        raise ValueError("Unexpected CMS numeric field: " + repr(raw))
    n = float(text)
    return int(n) if n.is_integer() else n


def check_footnote(raw, codes, expected):
    if not isinstance(expected, str) or (
        expected.strip() not in {"", "-"}
        and not re.fullmatch(r"\d+(?:\s*[,;]\s*\d+)*", expected.strip())
    ):
        raise ValueError("Unexpected CMS footnote format")
    if raw != expected or codes != re.findall(r"\d+", expected):
        raise ValueError("Footnote mismatch")


def metric_footnote(column, row):
    # CMS does not use a consistent prefix for its survey star footnotes.
    exceptions = {
        "HHCAHPS Survey Summary Star Rating": "HHCAHPS Survey Summary Star Rating Footnote",
        "Star Rating for health team gave care in a professional way": "Footnote for Star Rating for gave care in a professional way",
        "Star Rating for health team communicated well with them": "Footnote for Star Rating for communicated well with them",
        "Star Rating team discussed medicines, pain, and home safety": "Footnote Star Rating discussed medicines, pain, home safety",
        "Star Rating for how patients rated overall care from agency": "Footnote for Star Rating for overall care from agency",
    }
    if column in exceptions:
        return row[exceptions[column]]

    def normalize(text):
        return re.sub(r"\s+", "", text).lower()

    expected = {normalize("Footnote for " + column), normalize("Footnote " + column)}
    matches = [value for key, value in row.items() if normalize(key) in expected]
    if len(matches) > 1:
        raise ValueError("Ambiguous metric footnote: " + column)
    # The published numerator/denominator and comparator columns have no footnotes.
    return matches[0] if matches else ""


def check_metric(metric, row):
    if metric is None:
        return
    column = metric["sourceColumn"]
    if (
        column not in row
        or metric["rawValue"] != row[column]
        or metric["value"] != numeric(row[column])
    ):
        raise ValueError("Metric mismatch: " + column)
    if metric["status"] != (
        "published" if metric["value"] is not None else "not published"
    ):
        raise ValueError("Status mismatch")
    check_footnote(
        metric["rawFootnote"], metric["footnoteCodes"], metric_footnote(column, row)
    )


def check_metrics(value, row):
    """Check every retained metric, including supplemental clinical values."""
    metric_fields = {
        "starRating",
        "summaryStarRating",
        "completedSurveys",
        "responseRate",
        "percent",
        "rate",
        "publishedNumerator",
        "publishedDenominator",
        "observedRate",
        "riskStandardizedLowerLimit",
        "riskStandardizedUpperLimit",
    }
    if isinstance(value, list):
        for item in value:
            check_metrics(item, row)
    elif isinstance(value, dict):
        if "sourceColumn" in value:
            check_metric(value, row)
        else:
            for key, item in value.items():
                if key in metric_fields:
                    check_metric(item, row)
                else:
                    check_metrics(item, row)


def main():
    snapshot = load("normalized-unit-evidence.json")
    quality = {
        r["CMS Certification Number (CCN)"]: r for r in load("matched-6jpm-sxkc.json")
    }
    survey = {
        r["CMS Certification Number (CCN)"]: r for r in load("matched-ccn4-8vby.json")
    }
    found = {key: [] for key in EXPECTED}
    clinical_dates = {
        r["Measure Name"]: r["Measure Date Range"]
        for r in load("matched-c886-nwpj.json")
    }
    survey_ranges = {r["Measure Date Range"] for r in load("matched-fa88-6ff2.json")}
    if len(survey_ranges) != 1:
        raise ValueError("Mixed survey date ranges require review")
    survey_dates = next(iter(survey_ranges)).split(" to ")
    survey_iso = [
        datetime.strptime(date.strip(), "%B %d, %Y").date().isoformat()
        for date in survey_dates
    ]
    survey_period = {
        "start": survey_iso[0],
        "end": survey_iso[1],
        "label": "\u2013".join(
            datetime.fromisoformat(day).strftime("%B ")
            + str(datetime.fromisoformat(day).day)
            + datetime.fromisoformat(day).strftime(", %Y")
            for day in survey_iso
        ),
    }
    for unit in snapshot["units"]:
        org = unit["organizationId"]
        ccn = unit["ccn"]
        if org not in EXPECTED or ccn not in EXPECTED[org]:
            raise ValueError("Unverified organization/CCN match")
        found[org].append(ccn)
        q = quality[ccn]
        s = survey[ccn]
        if unit["cmsProviderName"] != q["Provider Name"]:
            raise ValueError("CMS entity-name mismatch")
        if (
            unit["cmsAddress"]["street"] != q["Address"]
            or unit["cmsAddress"]["zip"] != q["ZIP Code"]
        ):
            raise ValueError("CMS address mismatch")
        check_metrics(unit["qualityOfPatientCare"], q)
        check_metrics(unit["patientExperience"], s)
        if unit["patientExperience"]["period"] != survey_period:
            raise ValueError("Survey period mismatch")
        check_footnote(
            unit["patientExperience"]["rawGeneralFootnote"],
            unit["patientExperience"]["generalFootnoteCodes"],
            s["Footnote Number"],
        )
        for measure in unit["qualityOfPatientCare"].get("components", []):
            raw_range = clinical_dates[measure["dateSourceMeasureName"]]
            if measure["dateSourceRawRange"] != raw_range:
                raise ValueError("Clinical raw period mismatch")
            clinical_iso = [
                datetime.strptime(date.strip(), "%B %d, %Y").date().isoformat()
                for date in raw_range.split("-", 1)
            ]
            if [measure["period"][key] for key in ["start", "end"]] != clinical_iso:
                raise ValueError("Clinical period mismatch")
            if [
                unit["qualityOfPatientCare"]["starComponentPeriod"][key]
                for key in ["start", "end"]
            ] != clinical_iso:
                raise ValueError("Star-component period mismatch")
    for org, ccns in EXPECTED.items():
        if sorted(found[org]) != sorted(ccns):
            raise ValueError("Missing/duplicate reporting unit for " + org)
    comparators = snapshot["patientExperienceComparators"]
    if set(comparators) != {"massachusetts", "national"}:
        raise ValueError("Missing/unexpected survey comparator")
    for key, dataset, identity in [
        ("massachusetts", "m5jg-jg7i", ("State", "MA")),
        ("national", "vxub-6swi", ("Country", "Nation")),
    ]:
        reference = comparators[key]
        filename = "matched-" + dataset + ".json"
        rows = load(filename)
        if len(rows) != 1 or rows[0].get(identity[0]) != identity[1]:
            raise ValueError("Comparator reporting identity mismatch: " + key)
        raw = rows[0]
        if (
            reference["sourceFile"] != filename
            or reference["releasedAt"]
            != load("metadata-" + dataset + ".json")["released"]
            or reference["period"] != survey_period
        ):
            raise ValueError("Comparator provenance mismatch: " + key)
        columns = [
            measure["percent"]["sourceColumn"] for measure in reference["measures"]
        ]
        expected_columns = {
            column for column in raw if column.startswith("Percent of patients")
        }
        if (
            len(columns) != len(expected_columns)
            or set(columns) != expected_columns
            or any(
                measure.get("starRating") is not None
                for measure in reference["measures"]
            )
        ):
            raise ValueError("Comparator measure coverage mismatch: " + key)
        for field, column, unit in [
            ("completedSurveys", "Number of completed Surveys", "completed surveys"),
            ("responseRate", "Survey response rate", "percent"),
        ]:
            if (
                reference[field]["sourceColumn"] != column
                or reference[field]["unit"] != unit
            ):
                raise ValueError("Comparator metric identity mismatch: " + key)
        if any(
            measure["percent"]["unit"] != "percent" for measure in reference["measures"]
        ):
            raise ValueError("Comparator measure unit mismatch: " + key)
        check_metrics(reference, raw)
    # Preserve actual date-file labels separately; a survey period is not a clinical period.
    sources = []
    for dataset in [
        "6jpm-sxkc",
        "ccn4-8vby",
        "c886-nwpj",
        "fa88-6ff2",
        "m5jg-jg7i",
        "vxub-6swi",
    ]:
        metadata = load("metadata-" + dataset + ".json")
        distribution = metadata["distribution"][0]
        sources.append(
            {
                "datasetId": dataset,
                "title": metadata["title"],
                "url": (
                    metadata["landingPage"]["accessURL"]
                    if isinstance(metadata["landingPage"], dict)
                    else metadata["landingPage"]
                ),
                "downloadUrl": distribution["downloadURL"],
                "publisher": "Centers for Medicare & Medicaid Services",
                "checkedAt": snapshot["checkedAt"],
                "releasedAt": metadata["released"],
                "modified": metadata.get("modified"),
            }
        )
    out = {
        "schemaVersion": snapshot["schemaVersion"],
        "retrieved": snapshot["checkedAt"],
        "releasedAt": snapshot["releasedAt"],
        "sources": sources,
        "agencies": snapshot["units"],
        "clinicalMeasureDateRanges": [
            {"measure": r["Measure Name"], "rawPeriod": r["Measure Date Range"]}
            for r in load("matched-c886-nwpj.json")
        ],
        "surveyMeasureDateRanges": [
            {"measure": r["Measure Name"], "rawPeriod": r["Measure Date Range"]}
            for r in load("matched-fa88-6ff2.json")
        ],
        "patientExperienceComparators": snapshot["patientExperienceComparators"],
        "footnoteDefinitions": snapshot["footnoteDefinitions"],
        "interpretationRules": snapshot["interpretationRules"],
    }
    dest = ROOT / "src/data/home-health-evidence.json"
    write_json(dest, out)
    manifest = {
        p.name: {
            "bytes": p.stat().st_size,
            "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
        }
        for p in sorted(INPUT.iterdir())
        if p.is_file() and p.name != "source-hashes.json"
    }
    write_json(INPUT / "source-hashes.json", manifest)
    print(
        "Validated 6 catalog organizations / 7 distinct CMS reporting units; preserved raw values and separate survey/quality data."
    )


if __name__ == "__main__":
    main()
