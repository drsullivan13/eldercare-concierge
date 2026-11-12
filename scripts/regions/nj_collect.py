#!/usr/bin/env python3
"""Collect public New Jersey state care records without publishing them."""

import argparse
import hashlib
import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import cache
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "research/north-jersey/state"
SOURCES = {
    "ltc": "https://healthapps.nj.gov/facilities/documents2/All_LTC.xlsx",
    "ccrc": "https://www.nj.gov/dca/codes/publications/pdf_ccrc/ccrc2011.pdf",
    "firms": "https://rgbportal.dca.njoag.gov/public-view/",
    "municipalities": "https://data.nj.gov/resource/k9xb-zgh4.json?%24limit=1000",
    "localities": "https://www.nj.gov/cgi-bin/infobank/localsearch.pl",
}
COUNTIES = ("Union", "Morris", "Essex", "Bergen", "Hudson", "Passaic")
CARE_TYPES = {
    "ASSISTED LIVING RESIDENCE",
    "ASSISTED LIVING PROGRAM",
    "COMPREHENSIVE PERSONAL CARE HOME",
    "RESIDENTIAL DEMENTIA CARE HOME",
}
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def file_metadata(path, **details):
    body = path.read_bytes()
    metadata = {
        **details,
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "file": str(path.relative_to(OUTPUT)),
    }
    write_json(path.with_suffix(path.suffix + ".json"), metadata)
    return metadata


def download(url, path):
    request = Request(url, headers={"User-Agent": "Harbor public state records research"})
    with urlopen(request, timeout=90) as response:
        body = response.read()
        details = {
            "url": url,
            "effective_url": response.url,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "last_modified": response.headers.get("Last-Modified"),
            "content_type": response.headers.get("Content-Type"),
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return file_metadata(path, **details)


@contextmanager
def browser_session():
    env = os.environ.copy()
    if not env.get("AGENT_BROWSER_SESSION"):
        env["AGENT_BROWSER_SESSION"] = subprocess.check_output(
            ["agent-browser", "session", "id", "--scope", "worktree", "--prefix", "nj-collector"],
            text=True, cwd=ROOT,
        ).strip()

    def browser(*args):
        return subprocess.check_output(["agent-browser", *args], env=env, text=True, cwd=ROOT).strip()

    try:
        yield browser
    finally:
        browser("close")


def collect_firms():
    path = OUTPUT / "raw/firms.xlsx"
    with browser_session() as browser:
        browser("open", SOURCES["firms"])
        browser("fill", 'input[name="0"]', "HP*")
        browser("click", ".btn-entitylist-filter-submit")
        browser("wait", "--fn", """document.querySelector(
            '.view-grid tbody tr td:nth-child(2)'
        )?.innerText.toUpperCase().startsWith('HP')""")
        count_text = json.loads(browser(
            "eval", 'document.querySelector(".view-grid").previousElementSibling.innerText'
        ))
        count = int(re.search(r"(\d+) records found", count_text).group(1))
        if count >= 5000:
            raise ValueError("Portal search reached its 5000-record cap. Partition the query before collecting.")
        browser("download", ".entitylist-download", str(path))
        actual = len(workbook_rows(path))
        if actual != count:
            raise ValueError(f"Portal reports {count} rows but exported {actual}")
        return file_metadata(
            path, url=SOURCES["firms"],
            retrieved_at=datetime.now(timezone.utc).isoformat(),
            query={"License/Registration Number": "HP*", "other_filters": "blank"},
            displayed_rows=count, exported_rows=actual,
            method="Public portal search and its Click Here to Download XLSX export",
            source_date=None,
        )


def verify_live(counties):
    results = {}
    report_path = OUTPUT / "live-doh-verification.json"
    write_json(report_path, {"status": "running", "expected_counties": counties, "counties": results})
    with browser_session() as browser:
        for county in counties:
            browser("open", "https://healthapps.nj.gov/facilities/fsSetSearch.aspx?by=county")
            browser("select", "#middleContent_ddlCounty", county)
            for code in ("ALR", "CPCH", "ALP", "DCH"):
                browser("check", f'input[type="checkbox"][value="{code}"]')
            browser("click", "#middleContent_btnGetList")
            browser("wait", "--text", "Long-Term Care Facility Search Results")
            observed = json.loads(browser("eval", """JSON.stringify({
                url:location.href,
                text:document.body.innerText,
                units:[...document.querySelectorAll('a[href*="fsFacilityDetails.aspx?item="]')].map(a=>({
                    id:new URL(a.href).searchParams.get('item'),
                    name:a.innerText,
                    url:a.href,
                    row_text:a.closest('tr').innerText
                }))
            })"""))
            if isinstance(observed, str):
                observed = json.loads(observed)
            observed["query"] = {"county": county, "facility_types": ["ALR", "CPCH", "ALP", "DCH"]}
            observed["retrieved_at"] = datetime.now(timezone.utc).isoformat()
            path = OUTPUT / "raw" / f"doh-{county.lower()}.json"
            write_json(path, observed)
            file_metadata(path, url=observed["url"], retrieved_at=observed["retrieved_at"], query=observed["query"])
            expected = json.loads((OUTPUT / county.lower() / "care-units.json").read_text())
            actual_ids = sorted(unit["id"] for unit in observed["units"])
            expected_ids = sorted(unit["official_facility_id"] for unit in expected)
            match = re.search(r"Your search generated (\d+) matches", observed["text"])
            if not match or int(match[1]) != len(actual_ids) or actual_ids != expected_ids:
                raise ValueError(f"{county} live DOH search differs from workbook. Review {path}")
            disagreements = []
            for unit in expected:
                live_unit = next(row for row in observed["units"] if row["id"] == unit["official_facility_id"])
                fields = []
                if live_unit["name"] not in unit["name"]:
                    fields.append("name")
                if unit["zip"] not in live_unit["row_text"]:
                    fields.append("zip")
                street = unit["address"].splitlines()[0].strip().casefold()
                if street not in live_unit["row_text"].casefold():
                    fields.append("street")
                if fields:
                    disagreements.append({
                        "official_facility_id": unit["official_facility_id"],
                        "fields": fields,
                        "workbook_name": unit["name"],
                        "workbook_address": unit["address"],
                        "live_name": live_unit["name"],
                        "live_row_text": live_unit["row_text"],
                    })
            results[county] = {
                "live_rows": len(actual_ids),
                "exact_facility_id_set_match": True,
                "field_disagreements": disagreements,
            }
            write_json(report_path, {"status": "running", "expected_counties": counties, "counties": results})
    write_json(report_path, {"status": "passed", "expected_counties": counties, "counties": results})
    print(json.dumps(results, indent=2))


def workbook_rows(path):
    with ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = [
                "".join(node.itertext())
                for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))
            ]
        sheets = [
            name for name in archive.namelist()
            if name.startswith("xl/worksheets/") and name.endswith(".xml")
        ]
        if len(sheets) != 1:
            raise ValueError(f"Expected one source worksheet, found {sheets}")
        rows = []
        for row in ET.fromstring(archive.read(sheets[0])).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row:
                column = re.sub(r"\d", "", cell.attrib["r"])
                value = cell.find("s:v", NS)
                if cell.get("t") == "s":
                    text = shared[int(value.text)]
                elif cell.get("t") == "inlineStr":
                    text = "".join(cell.find("s:is", NS).itertext())
                else:
                    text = value.text if value is not None else ""
                cells[column] = text
            rows.append((int(row.attrib["r"]), cells))
    headers = rows[0][1]
    return [
        {"source_row": number, **{header: cells.get(col, "") for col, header in headers.items()}}
        for number, cells in rows[1:] if any(cells.values())
    ]


def excel_date(value):
    return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat() if value else None


@cache
def provenance(filename):
    path = OUTPUT / "raw" / filename
    metadata = json.loads(path.with_suffix(path.suffix + ".json").read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest() != metadata["sha256"]:
        raise ValueError(f"Source hash mismatch for {path}")
    return {
        "url": metadata["url"],
        "file": metadata["file"],
        "sha256": metadata["sha256"],
        "retrieved_at": metadata["retrieved_at"],
        "http_last_modified": metadata.get("last_modified"),
    }


def care_units(rows):
    result = []
    for row in rows:
        county = row["COUNTY"].title()
        if row["FACILITY_TYPE"] not in CARE_TYPES or county not in COUNTIES:
            continue
        result.append({
            "record_kind": "licensed_care_unit",
            "official_facility_id": row["FacID"],
            "official_license_id": row["LIC#"],
            "name": row["LICENSED_NAME"],
            "official_type": row["FACILITY_TYPE"],
            "address": row["ADDRESS"],
            "address_line_2": row["FAC_ADDR_2"],
            "city": row["FAC_CITY"],
            "state": row["FAC_ST"],
            "zip": row["ZIP"],
            "county": county,
            "county_basis": "Explicit DOH source COUNTY field",
            "license_expires": excel_date(row["Lic_Expires"]),
            "license_status": None,
            "licensed_beds_slots": int(row["Lic_Beds_Slots"]),
            "source_date": excel_date(row["RunDate"]),
            "memory_care_basis": (
                "Explicit residential dementia care license type"
                if row["FACILITY_TYPE"] == "RESIDENTIAL DEMENTIA CARE HOME"
                else "Not established by this listing"
            ),
            "source": {**provenance("ltc.xlsx"), "row": row["source_row"]},
            "official_detail_url": (
                "https://healthapps.nj.gov/facilities/fsFacilityDetails.aspx?item=" + row["FacID"]
            ),
            "source_fields": row,
        })
    return result


class TableRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = []
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th"):
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row:
            self.rows.append(self.row)


def place_key(value):
    value = value.upper().strip()
    value = re.sub(r"\bMT[.]?(?=\s)", "MOUNT", value)
    value = re.sub(r"\b(TOWNSHIP|TWP[.]?|BOROUGH|BORO[.]?|VILLAGE|TOWN)\b", "", value)
    return re.sub(r"[^A-Z0-9]", "", value)


def county_references(ltc_rows):
    municipalities = defaultdict(set)
    municipality_rows = json.loads((OUTPUT / "raw/municipalities.json").read_text())
    if len(municipality_rows) >= 1000:
        raise ValueError("Municipality source reached its request limit. Paginate before collecting.")
    for row in municipality_rows:
        county = row["county_name_common"].removesuffix(" County")
        for field in ("municipality_name_common", "municipality_name_nj_1040", "municipality_name_dca"):
            municipalities[place_key(row[field])].add(county)
    parser = TableRows()
    locality_html = (OUTPUT / "raw/localities.html").read_text()
    parser.feed(locality_html)
    localities = defaultdict(set)
    counties = {value for values in municipalities.values() for value in values}
    for row in parser.rows:
        if len(row) == 3 and row[2] in counties:
            localities[place_key(row[0])].add(row[2])
    match = re.search(r"Your search\s+generated (\d+) matches", locality_html)
    if (
        not match or not parser.rows or parser.rows[0] != ["Local Name", "Municipality", "County"]
        or len(parser.rows) - 1 != int(match[1])
    ):
        raise ValueError("State locality table differs from its reported result count")
    postal = defaultdict(set)
    for row in ltc_rows:
        postal[(place_key(row["FAC_CITY"]), row["ZIP"][:5])].add(row["COUNTY"].title())
    return municipalities, localities, postal


def assign_county(city, zip_code, references):
    municipalities, localities, postal = references
    key = place_key(city)
    candidates = municipalities.get(key) or localities.get(key) or set()
    basis = "NJ municipality name match" if key in municipalities else "NJ locality name match"
    if len(candidates) == 1:
        return next(iter(candidates)), basis, sorted(candidates)
    postal_counties = postal.get((key, zip_code[:5]), set())
    narrowed = candidates & postal_counties
    if len(narrowed) == 1:
        return next(iter(narrowed)), basis + " disambiguated by DOH city and ZIP county", sorted(candidates)
    return None, "Unresolved county. No unique official name match.", sorted(candidates)


def firm_records(rows, references):
    included, unresolved = [], []
    for row in rows:
        if not row["License/Registration"].upper().startswith("HP"):
            raise ValueError("Export contains records outside the HP query")
        if row["Business USA State"].upper().strip() != "NJ":
            continue
        county, basis, candidates = assign_county(row["Business City"], row["Business Zipcode"], references)
        record = {
            "record_kind": "home_care_firm_registration",
            "official_registration_id": row["License/Registration"],
            "name": row["Business Name"],
            "dba": row["DBAs"],
            "official_type": row["License Type"],
            "license_status": row["License Status"],
            "license_expires": excel_date(row["Expiration Date"]),
            "address": row["Business Address"],
            "city": row["Business City"],
            "state": row["Business USA State"],
            "zip": row["Business Zipcode"],
            "county": county,
            "county_basis": basis,
            "county_candidates": candidates,
            "county_reference_sources": [provenance("municipalities.json"), provenance("localities.html")],
            "source_date": None,
            "source": {**provenance("firms.xlsx"), "row": row["source_row"]},
            "source_fields": row,
        }
        if "DOH" in basis:
            record["county_reference_sources"].append(provenance("ltc.xlsx"))
        if county in COUNTIES:
            included.append(record)
        elif county is None:
            unresolved.append(record)
    return included, unresolved


def ccrc_records():
    path = OUTPUT / "raw/ccrc.pdf"
    text = subprocess.check_output(["pdftotext", "-layout", str(path), "-"], text=True)
    (OUTPUT / "raw/ccrc.txt").write_text(text)
    if "(Revised January 2018)" not in text:
        raise ValueError("CCRC source revision changed. Review the guide before updating its source date.")
    result = []
    county = None
    in_directory = False
    for page_number, page in enumerate(text.split("\f"), 1):
        if "APPENDIX VII\n" in page:
            in_directory = True
        if "APPENDIX VIII" in page and in_directory:
            break
        if not in_directory:
            continue
        lines = page.splitlines()
        printed_page = next((line.strip() for line in reversed(lines) if re.fullmatch(r"\s*\d+\s*", line)), None)
        for index, line in enumerate(lines):
            heading = re.fullmatch(r"\s*([A-Z ]+) COUNTY:?\s*", line)
            if heading:
                county = heading[1].title()
            if "" not in line or county not in COUNTIES:
                continue
            block = []
            for following in lines[index + 1:]:
                if "" in following or re.fullmatch(r"\s*[A-Z ]+ COUNTY:?\s*", following):
                    break
                if following.strip():
                    block.append(following.strip())
                if following.strip().startswith("Website:"):
                    break
            address = block[0]
            if not re.search(r"\bNJ \d{5}\b", address):
                raise ValueError(f"CCRC address not parsed at page {page_number}: {block}")
            result.append({
                "record_kind": "historical_ccrc_campus_listing",
                "official_registration_id": None,
                "official_id_limitation": "DCA guide does not publish certificate or registration IDs",
                "name": line.split("", 1)[1].strip(),
                "address": address,
                "county": county,
                "county_basis": "Explicit DCA directory county heading",
                "source_date": "2018-01",
                "license_status": None,
                "source": {
                    **provenance("ccrc.pdf"), "pdf_page": page_number, "printed_page": printed_page,
                },
                "source_text": "\n".join([line.strip(), *block]),
            })
    if not result:
        raise ValueError("CCRC directory parser produced no target records")
    return result


def build(counties):
    provenance.cache_clear()
    ltc_rows = workbook_rows(OUTPUT / "raw/ltc.xlsx")
    firms_rows = workbook_rows(OUTPUT / "raw/firms.xlsx")
    firms_meta = json.loads((OUTPUT / "raw/firms.xlsx.json").read_text())
    if len(firms_rows) != firms_meta["displayed_rows"]:
        raise ValueError("Firm export count differs from retained portal result count")
    units = care_units(ltc_rows)
    firms, unresolved = firm_records(firms_rows, county_references(ltc_rows))
    campuses = ccrc_records()
    groups = {"care-units": units, "ccrc-campuses": campuses, "home-care-firms": firms}
    report = {
        "counties": counties,
        "sources": {name: provenance(filename) for name, filename in (
            ("ltc", "ltc.xlsx"), ("firms", "firms.xlsx"), ("ccrc", "ccrc.pdf"),
            ("municipalities", "municipalities.json"), ("localities", "localities.html"),
        )},
        "statewide_ltc_source_rows": len(ltc_rows),
        "statewide_ltc_type_counts": dict(sorted(Counter(row["FACILITY_TYPE"] for row in ltc_rows).items())),
        "statewide_firm_source_rows": len(firms_rows),
        "statewide_firm_status_counts": dict(sorted(Counter(row["License Status"] for row in firms_rows).items())),
        "unresolved_nj_firm_county_rows": len(unresolved),
        "county_counts": {},
        "limitations": [
            "DOH workbook is a listing, not a real-time license status check. Expiration does not establish status.",
            "AL residences and programs do not establish memory care availability. Only residential dementia license type is explicit.",
            "CCRC guide revision is January 2018, not its HTTP modification date or retrieval date. Current completeness is unknown.",
            "No CCRC certificates or official IDs appear in the guide. Do not substitute DOH unit IDs for campus IDs.",
            "Bergen has no entry in this historical guide. That is not evidence of no present-day CCRC campuses.",
            "HP registry includes historical and duplicate registration rows. Rows are not brands or unique agencies.",
            "Home-care county is derived from official municipality or locality names, not supplied by the firm registry.",
            "Ambiguous names need city and ZIP support from DOH or remain unresolved. Postal geography can cross county boundaries.",
            "Firm business location does not establish county service area, private-pay acceptance, availability, or Medicare certification.",
            "All statuses are retained. Active in the portal can coexist with a past expiration date. Do not silently correct either.",
        ],
    }
    for county in counties:
        selected = {key: [row for row in values if row["county"] == county] for key, values in groups.items()}
        for key, records in selected.items():
            write_json(OUTPUT / county.lower() / f"{key}.json", records)
        registrations = selected["home-care-firms"]
        report["county_counts"][county] = {
            "care_unit_rows": len(selected["care-units"]),
            "care_unit_types": dict(sorted(Counter(row["official_type"] for row in selected["care-units"]).items())),
            "historical_ccrc_campuses": len(selected["ccrc-campuses"]),
            "home_care_registration_rows": len(registrations),
            "home_care_unique_registration_ids": len({row["official_registration_id"] for row in registrations}),
            "home_care_status_counts": dict(sorted(Counter(row["license_status"] for row in registrations).items())),
            "home_care_active_unique_registration_ids": len({
                row["official_registration_id"] for row in registrations if row["license_status"] == "Active"
            }),
        }
    write_json(OUTPUT / "unresolved-home-care-counties.json", unresolved)
    write_json(OUTPUT / "coverage.json", report)
    print(json.dumps(report["county_counts"], indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--collect-firms", action="store_true")
    parser.add_argument("--verify-live", action="store_true")
    parser.add_argument("--counties", nargs="+", choices=COUNTIES, default=list(COUNTIES))
    args = parser.parse_args()
    if args.download:
        for key, extension in (("ltc", "xlsx"), ("ccrc", "pdf"), ("municipalities", "json"), ("localities", "html")):
            print(json.dumps(download(SOURCES[key], OUTPUT / "raw" / f"{key}.{extension}")))
    if args.collect_firms:
        print(json.dumps(collect_firms()))
    build(args.counties)
    if args.verify_live:
        verify_live(args.counties)


if __name__ == "__main__":
    main()
