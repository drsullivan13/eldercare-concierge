#!/usr/bin/env python3
"""Project exact published nursing-home CCNs from retained CMS evidence offline."""

import argparse
from collections import Counter
from datetime import date, datetime
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path("research/north-jersey/cms")
CCN = "cms_certification_number_ccn"
DATASET = "https://data.cms.gov/provider-data/dataset/4pq5-n9py"
PERIODS = "https://data.cms.gov/provider-data/dataset/qmdc-9999"
HOURS = "hours per resident-day"
DEFINITIONS = {
    "total": ("reported_total_nurse_staffing_hours_per_resident_per_day", HOURS, "reported_staffing_footnote"),
    "rn": ("reported_rn_staffing_hours_per_resident_per_day", HOURS, "reported_staffing_footnote"),
    "lpn": ("reported_lpn_staffing_hours_per_resident_per_day", HOURS, "reported_staffing_footnote"),
    "aide": ("reported_nurse_aide_staffing_hours_per_resident_per_day", HOURS, "reported_staffing_footnote"),
    "weekendTotal": ("total_number_of_nurse_staff_hours_per_resident_per_day_on_t_4a14", HOURS, "reported_staffing_footnote"),
    "weekendRn": ("registered_nurse_hours_per_resident_per_day_on_the_weekend", HOURS, "reported_staffing_footnote"),
    "totalTurnover": ("total_nursing_staff_turnover", "percent", "total_nursing_staff_turnover_footnote"),
    "rnTurnover": ("registered_nurse_turnover", "percent", "registered_nurse_turnover_footnote"),
    "census": ("average_number_of_residents_per_day", "residents per day", "average_number_of_residents_per_day_footnote"),
}
MISSING = {None, "", "-", "NA", "N/A", "Not Available", "Not Applicable"}
NONBLOCKING = {"13", "24", "28"}
UNAVAILABLE = {"1", "2", "10", "23"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode()


def metric(raw, code, definitions):
    code = str(code or "").strip()
    require(not code or code in definitions, f"Unreviewed CMS footnote {code!r}")
    note = f"CMS footnote {code}: {definitions[code]}" if code else None
    if code and code not in NONBLOCKING:
        return {"value": None, "status": "unavailable" if code in UNAVAILABLE else "suppressed",
                "footnote": note}
    if raw in MISSING:
        return {"value": None, "status": "unavailable", "footnote": note}
    require(not isinstance(raw, bool), "Boolean staffing value")
    text = str(raw).strip()
    require(bool(re.fullmatch(r"\d+(?:\.\d+)?", text)), f"Invalid staffing number {raw!r}")
    value = float(text)
    require(math.isfinite(value) and value >= 0, "Invalid staffing value")
    return {"value": int(value) if value.is_integer() else value,
            "status": "reported", "footnote": note}


def build(root=ROOT):
    inputs = {}

    def read(relative, binary=False):
        path = root / relative
        body = path.read_bytes()
        inputs[str(relative)] = {"sha256": digest(body), "bytes": len(body)}
        return body if binary else json.loads(body)

    def archived(relative):
        path = ARCHIVE / relative
        receipt = read(str(path) + ".receipt.json")
        body = read(path, binary=True)
        require(digest(body) == receipt["sha256"] and len(body) == receipt["bytes"],
                f"Source receipt mismatch {path}")
        require(receipt["url"].startswith("https://data.cms.gov/provider-data/"),
                "Unofficial CMS source")
        payload = json.loads(body)
        require(payload["count"] == len(payload["results"]), f"Incomplete source page {path}")
        return payload["results"], {
            "file": str(path), "sha256": digest(body),
            "retrievedAt": receipt["retrieved_at"], "url": receipt["url"],
        }

    providers = read("src/data/providers.json")
    for market in read("src/data/regional-markets.json"):
        providers.extend(market["providers"])
    nursing_homes = [p for p in providers if p["category"] == "nursing-home" and p["state"] in {"MA", "NJ"}]
    selected = [p for p in nursing_homes if p.get("cms", {}).get("ccn")]
    require(len({p["id"] for p in selected}) == len(selected), "Duplicate published provider ID")
    ma_path = "src/data/inputs/boston-region-providers.json"
    ma = read(ma_path)
    nj, nj_source = archived("raw/4pq5-n9py/primary/page-0000000.json")
    periods, period_source = archived("raw/qmdc-9999/primary/page-0000000.json")
    footnotes = read("research/daily-life/nursing-staffing/footnotes.json")
    dictionary = read(footnotes["sourceFile"], binary=True)
    require(digest(dictionary) == footnotes["sourceSha256"], "CMS dictionary changed; review footnotes")
    sources = {"ma": {"file": ma_path, "sha256": inputs[ma_path]["sha256"]},
               "nj": nj_source, "periods": period_source}
    rows = {}
    for index, row in enumerate(ma):
        if row["type"] != "nursing_home":
            continue
        source = row["source"]
        require(source["datasetId"] == "4pq5-n9py" and source["datasetUrl"] == DATASET,
                "MA source is not CMS Provider Information")
        raw = {**row["staffing"], **row["footnotes"],
               "average_number_of_residents_per_day": row.get("averageResidentsPerDay")}
        ccn = row["cmsCertificationNumber"]
        require(ccn not in rows, f"Duplicate MA CCN {ccn}")
        rows[ccn] = (raw, {
            "ccn": ccn, "providerName": row["name"], "state": row["state"],
            "processingDate": source["processingDate"], "retrievedAt": source["retrieved"],
            "sourceUrl": source["datasetUrl"], "sourceId": "ma", "sourceRow": index,
        })
    for index, row in enumerate(nj):
        ccn = row[CCN]
        require(row["state"] == "NJ" and ccn not in rows, f"Invalid or duplicate NJ CCN {ccn}")
        rows[ccn] = (row, {
            "ccn": ccn, "providerName": row["provider_name"], "state": row["state"],
            "processingDate": row["processing_date"], "retrievedAt": nj_source["retrievedAt"],
            "sourceUrl": DATASET, "sourceId": "nj", "sourceRow": index,
        })
    period_index = {}
    for row in periods:
        if row["measure_code"] not in {"STAFFING_LEVELS", "STAFFING_TURNOVER"}:
            continue
        processing = datetime.strptime(row["processing_date"], "%Y%m%d").date().isoformat()
        key = processing + "/" + row["measure_code"]
        require(key not in period_index, f"Ambiguous period {key}")
        start = datetime.strptime(row["data_collection_period_from_date"], "%m/%d/%Y").date().isoformat()
        end = datetime.strptime(row["data_collection_period_through_date"], "%m/%d/%Y").date().isoformat()
        require(start <= end <= processing, "Invalid CMS measurement interval")
        period_index[key] = {"startDate": start, "endDate": end, "label": row["measure_description"],
                             "sourceUrl": PERIODS}
    records = {}
    for provider in selected:
        ccn = provider.get("cms", {}).get("ccn")
        require(ccn and re.fullmatch(r"\d{6}", ccn) and provider["id"] == f"cms-{ccn}",
                "Published nursing home needs exact CMS CCN identity")
        require(ccn in rows, f"No retained CMS evidence for {ccn}; capture official endpoint before rebuild")
        raw, record = rows[ccn]
        require(record["state"] == provider["state"], f"Source state mismatch {ccn}")
        date.fromisoformat(record["processingDate"])
        for suffix in ("STAFFING_LEVELS", "STAFFING_TURNOVER"):
            require(record["processingDate"] + "/" + suffix in period_index, f"No matching period for {ccn}")
        metrics = {}
        for key, (field, _, footnote_field) in DEFINITIONS.items():
            require(field in raw, f"Source column missing {ccn}/{field}")
            metrics[key] = metric(raw[field], raw.get(footnote_field), footnotes["codes"])
        rating_code = raw.get("staffing_rating_footnote") or None
        require(not rating_code or str(rating_code) in footnotes["codes"], "Unreviewed staffing rating footnote")
        records[provider["id"]] = {
            **record, "metrics": metrics,
            "staffingRatingNote": f"CMS footnote {rating_code}: {footnotes['codes'][str(rating_code)]}" if rating_code else None,
        }
    require(len(records) == len(selected), "Incomplete published nursing staffing coverage")
    return {
        "schemaVersion": 1, "datasetId": "4pq5-n9py", "periodDatasetId": "qmdc-9999",
        "dictionaryUrl": footnotes["sourceUrl"], "inputs": inputs, "sources": sources,
        "metricDefinitions": {key: {"sourceField": field, "unit": unit} for key, (field, unit, _) in DEFINITIONS.items()},
        "periods": period_index, "providers": records,
        "coverage": dict(Counter(p["state"] for p in selected)),
        "excluded": {p["id"]: "No published exact CMS CCN; no name or campus matching."
                     for p in nursing_homes if not p.get("cms", {}).get("ccn")},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "src/data/nursing-staffing.json")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    body = encode(build())
    if args.check:
        require(args.output.read_bytes() == body, "Staffing artifact differs from retained sources")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(body)
    snapshot = json.loads(body)
    print(json.dumps({"coverage": snapshot["coverage"], "providers": len(snapshot["providers"]),
                      "sha256": digest(body), "checked": args.check}))


if __name__ == "__main__":
    main()
