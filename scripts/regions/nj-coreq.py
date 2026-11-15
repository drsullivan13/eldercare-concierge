#!/usr/bin/env python3
"""Project FY2027 NJ DHS CoreQ composites without changing other snapshots."""

import argparse
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET
import zipfile
from nj_coreq_ids import certified_identities, COST_REPORT_SHA256, COST_REPORT_URL

ROOT = Path(__file__).resolve().parents[2]
CMS = ROOT / "research/north-jersey/cms/raw/4pq5-n9py/primary/page-0000000.json"
STATE = ROOT / "research/north-jersey/state/raw/ltc.xlsx"
OUTPUT = ROOT / "src/data/nj-coreq.json"
WORKBOOK_SHA256 = "95482f38a3f9707cda3d0507049d180fa362fc4c643cdf639034ef957a1ae8db"
WORKBOOK_URL = "https://www.nj.gov/humanservices/doas/documents/FY27%20NH%20Rates%20FFS%20Residents%20%20NF%20QIPP%20UPTD%20073026%20R2.4.2.2%20Final.xlsx"
DEFINITION_URL = "https://www.nj.gov/humanservices/doas/resources/nursing/"
SHEET = "SFY27FFS Rate-NFQIPP70726 R2.4"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
NURSING_TYPES = {
    "LONG TERM CARE FACILITY SNF/NF",
    "LONG TERM CARE FACILITY - HOME FOR THE AGED SNF/NF",
    "HOSPITAL BASED - LONG TERM CARE FACILITY SNF/NF",
    "HOSPITAL BASED - LONG TERM CARE SUB ACUTE FACILITY SNF",
    "LONG TERM CARE FACILITY S/NF DP",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalize(value):
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def xlsx_rows(path, sheet_name):
    with zipfile.ZipFile(path) as archive:
        strings = [
            "".join(node.itertext())
            for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))
        ] if "xl/sharedStrings.xml" in archive.namelist() else []
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = next(node for node in workbook.findall("s:sheets/s:sheet", NS)
                     if node.attrib["name"] == sheet_name)
        relationship = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(node.attrib["Target"] for node in relationships
                      if node.attrib["Id"] == relationship)
        filename = str(PurePosixPath("xl") / target) if not target.startswith("/") else target[1:]
        styles = ET.fromstring(archive.read("xl/styles.xml")).find("s:cellXfs", NS)
        result = []
        for row in ET.fromstring(archive.read(filename)).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row.findall("s:c", NS):
                value = cell.find("s:v", NS)
                raw = value.text if value is not None else ""
                kind = cell.attrib.get("t", "n")
                if kind == "s":
                    raw = strings[int(raw)]
                elif kind == "inlineStr":
                    raw = "".join(cell.find("s:is", NS).itertext())
                cells[re.sub(r"\d", "", cell.attrib["r"])] = {
                    "raw": raw, "kind": kind,
                    "format": int(styles[int(cell.attrib.get("s", "0"))].attrib["numFmtId"]),
                }
            result.append({"row": int(row.attrib["r"]), "cells": cells})
        return result


def raw(row, column):
    return row["cells"].get(column, {}).get("raw", "")


def read_workbook(path):
    rows = xlsx_rows(path, SHEET)
    header = next(row for row in rows if row["row"] == 5)
    require([raw(header, col) for col in ("A", "B", "C", "AZ")] ==
            ["Facility Name", "Gainwell #", "Facility Type", "CoreQ Composite Score"],
            "Unexpected FY2027 CoreQ columns")
    return [{
        "row": row["row"], "name": raw(row, "A").strip(),
        "medicaidId": raw(row, "B"), "setting": raw(row, "C"),
        "score": row["cells"].get("AZ", {}),
    } for row in rows if raw(row, "B").isdigit()]


def read_state(path):
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet_name = workbook.find("s:sheets/s:sheet", NS).attrib["name"]
    rows = xlsx_rows(path, sheet_name)
    header = rows[0]
    require(raw(header, "D") == "LICENSED_NAME" and raw(header, "A") == "FACILITY_TYPE",
            "Unexpected statewide NJ DOH roster")
    return [{
        "row": row["row"], "name": re.sub(r"\s*\([^()]*\)\s*$", "", raw(row, "D")),
        "facilityId": raw(row, "B"), "setting": raw(row, "A"),
        "address": raw(row, "F").split("\n")[0].strip(), "city": raw(row, "H"),
        "state": raw(row, "I"), "zip": raw(row, "J")[:5],
    } for row in rows[1:]]


def index(rows, key):
    result = defaultdict(list)
    for row in rows:
        result[key(row)].append(row)
    return result


def composite(cell):
    if cell.get("kind") != "n" or cell.get("format") != 9:
        return None
    try:
        value = Decimal(cell.get("raw", ""))
    except InvalidOperation:
        return None
    if not value.is_finite() or not 0 <= value <= 1:
        return None
    return float(value * 100)


def project(workbook, cms, state, payment_ids=None):
    payment_ids = payment_ids or {}
    by_ccn = index(cms, lambda row: row["cms_certification_number_ccn"])
    linked_units = Counter(payment_ids.get(row["medicaidId"], (None, None))[1] for row in workbook if row["setting"] == "NF")
    names = Counter(normalize(row["name"]) for row in workbook)
    medicaid_ids = Counter(row["medicaidId"] for row in workbook)
    cms_names = index(cms, lambda row: normalize(row["provider_name"]))
    cms_ccns = Counter(row["cms_certification_number_ccn"] for row in cms)
    state_names = index(state, lambda row: normalize(row["name"]))
    state_ids = Counter(row["facilityId"] for row in state)
    results, withheld = {}, defaultdict(list)
    for row in workbook:
        key = normalize(row["name"])
        federal, licensed = cms_names[key], state_names[key]
        reason = None
        if names[key] != 1 or medicaid_ids[row["medicaidId"]] != 1:
            reason = "ambiguous-workbook-identity"
        elif row["setting"] != "NF":
            reason = "non-NF-payment-unit"
        elif len(federal) != 1:
            reason = "no-unique-exact-CMS-name"
        elif (federal[0]["state"] != "NJ"
              or not re.fullmatch(r"315\d{3}", federal[0]["cms_certification_number_ccn"])
              or cms_ccns[federal[0]["cms_certification_number_ccn"]] != 1
              or federal[0].get("provider_type") not in {"Medicare", "Medicare and Medicaid"}):
            reason = "invalid-certified-NJ-nursing-identity"
        elif len(licensed) != 1:
            reason = "no-unique-exact-state-name"
        elif (licensed[0]["setting"] not in NURSING_TYPES
              or licensed[0]["state"] != "NJ"
              or state_ids[licensed[0]["facilityId"]] != 1):
            reason = "state-setting-or-identity-conflict"
        elif (normalize(licensed[0]["address"]) != normalize(federal[0]["provider_address"])
              or normalize(licensed[0]["city"]) != normalize(federal[0]["citytown"])
              or licensed[0]["zip"] != federal[0]["zip_code"][:5]):
            reason = "official-address-conflict"
        link = payment_ids.get(row["medicaidId"])
        verified_npi = None
        if link and row["setting"] == "NF":
            npi, mapped_ccn = link
            units = by_ccn[mapped_ccn]
            if (len(units) != 1 or linked_units[mapped_ccn] != 1
                    or medicaid_ids[row["medicaidId"]] != 1):
                reason = "ambiguous-payment-unit"
            elif (units[0]["state"] != "NJ"
                  or units[0].get("provider_type") not in {"Medicare", "Medicare and Medicaid"}
                  or (len(federal) == 1 and federal[0]["cms_certification_number_ccn"] != mapped_ccn)):
                reason = "conflicting-payment-unit"
            elif reason is not None:
                reason = None
                verified_npi = npi
                federal = units
        value = composite(row["score"])
        if reason is None and value is None:
            reason = "unreported-or-invalid-composite"
        if reason:
            withheld[reason].append({
                "name": row["name"], "medicaidId": row["medicaidId"],
                "cell": f"AZ{row['row']}", "raw": row["score"].get("raw", ""),
            })
            continue
        federal = federal[0]
        ccn = federal["cms_certification_number_ccn"]
        results[ccn] = {
            "value": value,
            "identity": {
                "method": "statewide-unique-exact-name-and-DOH-address",
                "workbookName": row["name"], "medicaidId": row["medicaidId"],
                "nameCell": f"A{row['row']}", "medicaidIdCell": f"B{row['row']}",
                "cmsName": federal["provider_name"], **({"method": "NJ-Medicaid-ID-to-NPI-to-CCN", "npi": verified_npi}
                   if verified_npi else {"stateFacilityId": licensed[0]["facilityId"],
                                         "stateRow": licensed[0]["row"]}),
                "address": federal["provider_address"], "city": federal["citytown"],
                "state": "NJ", "zip": federal["zip_code"][:5],
            },
            "cell": f"AZ{row['row']}", "raw": row["score"]["raw"],
        }
    return dict(sorted(results.items())), dict(sorted(withheld.items()))


def fingerprint(path, url):
    return {"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def generate(workbook, cost_report):
    require(hashlib.sha256(workbook.read_bytes()).hexdigest() == WORKBOOK_SHA256,
            "Workbook differs from the verified official FY2027 release")
    payload = json.loads(CMS.read_text())
    require(len(payload["results"]) == payload["count"] and payload["count"] == 348,
            "CMS identity checks require the complete retained statewide roster")
    for path, suffix in ((CMS, ".receipt.json"), (STATE, ".json")):
        receipt = json.loads(path.with_name(path.name + suffix).read_text())
        require(hashlib.sha256(path.read_bytes()).hexdigest() == receipt["sha256"],
                f"Retained official input hash mismatch: {path}")
    rows = read_workbook(workbook)
    require(len(rows) == 370, "Expected all 370 statewide payment rows")
    results, withheld = project(rows, payload["results"], read_state(STATE), certified_identities(cost_report))
    source = {
        "publisher": "New Jersey Department of Human Services",
        "title": "FY2027 NF QIPP CoreQ long-stay resident/family satisfaction composite",
        "reportingYear": "FY2027", "yearMeaning": "reporting/payment year, not survey year",
        "unit": "percent", "measure": "CoreQ Composite Score",
        "population": "Long-stay nursing-home residents and their families",
        "definitionUrl": DEFINITION_URL,
        "definition": "Three questions rate the facility overall, staff and care received. Responses range from 1 (poor) to 5 (excellent). The QIPP composite benchmark is 85%.",
        "surveyPeriod": None, "sampleSize": None,
        "workbook": {**fingerprint(workbook, WORKBOOK_URL), "sheet": SHEET,
                     "headerCell": "AZ5", "numberFormat": "0%", "numberFormatId": 9,
                     "definitionCells": "'SFY27 Cover sheet'!A32:A37"},
        "cms": {**fingerprint(CMS, "https://data.cms.gov/provider-data/dataset/4pq5-n9py"),
                "file": str(CMS.relative_to(ROOT)), "statewideRows": len(payload["results"])},
        "state": {**fingerprint(STATE, "https://healthapps.nj.gov/facilities/documents2/All_LTC.xlsx"),
                  "file": str(STATE.relative_to(ROOT))},
        "costReport": {"url": COST_REPORT_URL, "sha256": COST_REPORT_SHA256, "sheets": ["Data Summary", "Schedule A-8"]},
        "identityPolicy": "Unique Medicaid ID to NPI to CCN through the CY2024 NJ Medicaid cost report, or unique normalized exact names across all workbook, CMS NJ and DOH statewide records, plus exact DOH/CMS street, city and ZIP. No fuzzy names or campus inheritance. Gainwell IDs are retained, not treated as CCNs.",
        "workbookRows": len(rows),
    }
    return {"source": source, "results": results}, withheld


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--cost-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    projection, withheld = generate(args.workbook, args.cost_report)
    body = json.dumps(projection, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        require(args.output.read_text() == body, f"Projection differs: {args.output}")
    else:
        require(args.output.resolve() not in {args.workbook.resolve(), args.cost_report.resolve(), CMS.resolve(), STATE.resolve()},
                "Output cannot overwrite source evidence")
        args.output.write_text(body)
    print(json.dumps({
        "emitted": len(projection["results"]),
        "withheld": {key: {"count": len(rows), "examples": rows[:3]}
                     for key, rows in withheld.items()},
        "sha256": hashlib.sha256(body.encode()).hexdigest(),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
