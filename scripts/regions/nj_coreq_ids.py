"""Link NJ Medicaid nursing facility payment IDs to CCNs in the state cost report."""

from collections import defaultdict
from hashlib import sha256
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

COST_REPORT_URL = "https://www.nj.gov/humanservices/doas/documents/CY-2024-Nursing-Facility-Medicaid-Cost-Report-Data-FINAL-20260929.xlsx"
COST_REPORT_SHA256 = "20574bc6f03edf7d1aad60c768cc7a638e43ee325b14cff95199510dbcc14f04"


def columns(archive, strings, sheet, expected):
    with archive.open(f"xl/worksheets/sheet{sheet}.xml") as file:
        for _, row in ET.iterparse(file):
            if not row.tag.endswith("}row"):
                continue
            values = {}
            for cell in row.findall("{*}c"):
                col = re.sub(r"\d", "", cell.get("r"))
                value = cell.findtext("{*}v")
                if col in expected and value is not None:
                    values[col] = strings[int(value)] if cell.get("t") == "s" else value
            if row.get("r") == "1":
                if values != expected:
                    raise ValueError("Unexpected state cost report columns")
            else:
                yield values
            row.clear()


def certified_identities(path):
    if sha256(path.read_bytes()).hexdigest() != COST_REPORT_SHA256:
        raise ValueError("Unexpected NJ Medicaid cost report version")
    medicaid = defaultdict(set)
    medicare = defaultdict(set)
    with ZipFile(path) as archive:
        strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        summary = {"B": "Medicaid ID", "D": "NPI", "E": "License Bed Type"}
        for row in columns(archive, strings, 3, summary):
            if row.get("E") == "Nursing Facility" and row.get("B", "").isdigit():
                medicaid[str(int(row["B"]))].add(row.get("D", ""))
        schedule = {"A": "NPI", "D": "CCN", "E": "Bed Type"}
        for row in columns(archive, strings, 9, schedule):
            if row.get("E") == "Nursing Facility":
                medicare[row.get("A", "")].add(row.get("D", ""))
    result = {}
    for mid, npis in medicaid.items():
        if len(npis) == 1:
            npi = next(iter(npis))
            if re.fullmatch(r"\d{10}", npi) and len(medicare[npi]) == 1:
                ccn = next(iter(medicare[npi]))
                if re.fullmatch(r"315\d{3}", ccn):
                    result[mid] = (npi, ccn)
    return result
