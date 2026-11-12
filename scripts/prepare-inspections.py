"""Prepare a bounded, source-preserving CMS evidence snapshot for the POC.

Run from the repository root. The source is an actual downloaded CMS extract;
no facility findings, dates, amounts, or ratings are generated.
"""
from pathlib import Path
from datetime import date
import argparse
import hashlib
import gzip
import json
import re

MAX_RECORDS = 25
ROOT = Path(__file__).resolve().parents[1]


def iso_date(value):
    if value in (None, ""):
        return None
    date.fromisoformat(value)
    return value


def published_number(value):
    if value in (None, ""):
        return None
    result = float(value)
    if result < 0 or result == float("inf") or result != result:
        raise ValueError(f"Invalid published amount: {value}")
    return int(result) if result.is_integer() else result


def flag(value):
    if value in (None, ""):
        return None
    if value not in ("Y", "N"):
        raise ValueError(f"Unexpected source flag: {value}")
    return value == "Y"


def event_id(row):
    return hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()[:20]


def validate_ccn(row, ccn):
    if row.get("cms_certification_number_ccn") != ccn or row.get("state") != "MA":
        raise ValueError(f"Foreign or mismatched CMS row under {ccn}")


def prepare(source_path, output_path):
    raw = source_path.read_bytes()
    if source_path.suffix == ".gz":
        raw = gzip.decompress(raw)
    source = json.loads(raw)
    providers = json.loads((ROOT / "src/data/providers.json").read_text())
    known = {p["cms"]["ccn"] for p in providers if p["category"] == "nursing-home" and p.get("cms")}
    sources = []
    for dataset_id in ("r5ix-sfxw", "g6vv-u9sr"):
        meta = source["sources"][dataset_id]
        assert meta["identifier"] == dataset_id
        sources.append({"datasetId": dataset_id, "title": meta["title"], "url": meta["landingPage"], "downloadUrl": meta["distribution"][0]["downloadURL"], "modified": iso_date(meta["modified"]), "released": iso_date(meta["released"])})
    facilities = {}
    for ccn in sorted(known):
        if not re.fullmatch(r"\d{6}", ccn):
            raise ValueError(f"Invalid catalog CCN: {ccn}")
        facility = source["facilities"].get(ccn)
        if facility is None:
            # Missing extract coverage is unknown, never zero findings.
            facilities[ccn] = {"healthCitations": None, "penalties": None}
            continue
        assert facility["cmsCertificationNumber"] == ccn
        citations = []
        for row in facility["healthDeficiencies"]:
            validate_ccn(row, ccn)
            assert row["survey_type"] == "Health"
            assert row["deficiency_prefix"] == "F"
            assert re.fullmatch(r"\d{4}", row["deficiency_tag_number"])
            severity = row.get("scope_severity_code") or None
            if severity is not None and not re.fullmatch(r"[A-L]", severity):
                raise ValueError(f"Invalid scope/severity code: {severity}")
            description = row["deficiency_description"]
            if not description.strip():
                raise ValueError("Missing official citation description")
            citations.append({"id": event_id(row), "surveyDate": iso_date(row["survey_date"]), "tag": row["deficiency_prefix"] + row["deficiency_tag_number"], "category": row["deficiency_category"], "description": description, "scopeSeverityCode": severity, "standard": flag(row.get("standard_deficiency")), "complaint": flag(row.get("complaint_deficiency")), "infectionControl": flag(row.get("infection_control_inspection_deficiency")), "correctionStatus": row.get("deficiency_corrected") or None, "correctionDate": iso_date(row.get("correction_date")), "inspectionCycle": row.get("inspection_cycle") or None, "underIDR": flag(row.get("citation_under_idr")), "underIIDR": flag(row.get("citation_under_iidr")), "surveyFootnote": row.get("survey_footnote") or None, "processingDate": iso_date(row.get("processing_date"))})
        citations.sort(key=lambda r: (-(date.fromisoformat(r["surveyDate"]).toordinal()) if r["surveyDate"] else 0, r["tag"], r["id"]))
        penalties = []
        for row in facility["penaltyEvents"]:
            validate_ccn(row, ccn)
            if row["penalty_type"] not in ("Fine", "Payment Denial"):
                raise ValueError(f"Unknown penalty type: {row['penalty_type']}")
            penalties.append({"id": event_id(row), "date": iso_date(row.get("penalty_date")), "type": row["penalty_type"], "fineId": row.get("fine_id") or None, "fineAmount": published_number(row.get("fine_amount")), "paymentDenialStartDate": iso_date(row.get("payment_denial_start_date")), "paymentDenialLengthDays": published_number(row.get("payment_denial_length_in_days")), "processingDate": iso_date(row.get("processing_date"))})
        penalties.sort(key=lambda r: (-(date.fromisoformat(r["date"]).toordinal()) if r["date"] else 0, r["id"]))
        facilities[ccn] = {"healthCitations": {"total": len(citations), "records": citations[:MAX_RECORDS]}, "penalties": {"total": len(penalties), "fineCount": sum(r["type"] == "Fine" for r in penalties), "paymentDenialCount": sum(r["type"] == "Payment Denial" for r in penalties), "records": penalties[:MAX_RECORDS]}}
    result = {"version": 1, "retrieved": iso_date(source["retrieved"]), "maxRecordsPerCollection": MAX_RECORDS, "sourceFileSha256": hashlib.sha256(raw).hexdigest(), "dictionaryUrl": "https://data.cms.gov/provider-data/sites/default/files/data_dictionaries/nursing_home/NH_Data_Dictionary.pdf", "sources": sources, "facilities": facilities}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Prepared {len(facilities)} known CMS providers; {sum(len(f['healthCitations']['records']) if f['healthCitations'] else 0 for f in facilities.values())} actual citations; {output_path.stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "src/data/inputs/cms-inspection-details.json.gz")
    parser.add_argument("--output", type=Path, default=ROOT / "src/data/inspection-history.json")
    args = parser.parse_args()
    prepare(args.source, args.output)
