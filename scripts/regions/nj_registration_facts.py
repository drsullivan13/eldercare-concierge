#!/usr/bin/env python3
"""Compile source-listed NJ registration business facts for published home-care agencies."""

import argparse
from collections import defaultdict
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_collect import excel_date, workbook_rows  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "src/data/regional-markets.json"
WORKBOOK = "research/north-jersey/home-care-supply/source/firms.xlsx"
OUTPUT = ROOT / "src/data/nj-registration-facts.json"
PROVIDER_ID = re.compile(r"^north-jersey-hp-(hp\d+)$")
# Only business facts leave the workbook. Address, phone, country and
# foreign-province columns are never read into the output.
FIELDS = {
    "Business Name": "businessName",
    "DBAs": "dbas",
    "License Type": "licenseType",
    "License Status": "status",
    "Expiration Date": "expiresOn",
}


def catalog_agencies():
    agencies = {}
    for market in json.loads(CATALOG.read_text()):
        for provider in market["providers"]:
            match = PROVIDER_ID.match(provider["id"])
            if not match:
                continue
            if market["id"] != "north-jersey" or provider["category"] != "home-care" or provider["state"] != "NJ":
                raise ValueError(f"{provider['id']} is not a North Jersey home-care agency")
            agencies[provider["id"]] = (match[1].upper(), provider["name"])
    return agencies


def source_metadata():
    path = ROOT / WORKBOOK
    metadata = json.loads(path.with_suffix(".xlsx.json").read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest() != metadata["sha256"]:
        raise ValueError(f"Source hash mismatch for {WORKBOOK}")
    return {
        "title": "NJ health care service firm registration",
        "publisher": "New Jersey Division of Consumer Affairs",
        "url": metadata["url"],
        "file": WORKBOOK,
        "sha256": metadata["sha256"],
        "retrievedAt": metadata["retrieved_at"],
        "checkedAt": metadata["retrieved_at"][:10],
        "sourceDate": metadata["source_date"],
    }


def facts(rows):
    values = {
        tuple(
            excel_date(row[column]) if column == "Expiration Date" else row[column].strip()
            for column in FIELDS
        )
        for row in rows
    }
    # Duplicate rows for one agency are published only when every business fact agrees.
    if len(values) != 1:
        raise ValueError(f"Conflicting workbook rows {[row['source_row'] for row in rows]}")
    record = dict(zip(FIELDS.values(), values.pop()))
    if not record["dbas"]:
        del record["dbas"]
    if not record["expiresOn"]:
        record["expiresOn"] = None
    return record


def compile_facts():
    source = source_metadata()
    by_registration = defaultdict(list)
    for row in workbook_rows(ROOT / WORKBOOK):
        by_registration[(row["License/Registration"], row["Business Name"])].append(row)
    providers = {}
    for provider_id, (registration, name) in sorted(catalog_agencies().items()):
        matched = by_registration.get((registration, name))
        if not matched:
            raise ValueError(f"No workbook row for {registration} {name}")
        providers[provider_id] = {
            "registration": registration,
            **facts(matched),
            "sourceRows": sorted(row["source_row"] for row in matched),
        }
    return {"schemaVersion": 1, "source": source, "providers": providers}


def render(value):
    return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the generated file differs")
    args = parser.parse_args()
    body = render(compile_facts())
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != body:
            sys.exit(f"{OUTPUT.relative_to(ROOT)} is out of date. Run {Path(__file__).name}.")
        print(f"{OUTPUT.relative_to(ROOT)} matches {WORKBOOK}.")
        return
    OUTPUT.write_text(body)
    print(f"Wrote {OUTPUT.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
