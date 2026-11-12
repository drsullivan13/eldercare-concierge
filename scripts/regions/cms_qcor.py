#!/usr/bin/env python3
"""Retain and verify the published CMS QCOR home-health 2567 export."""

import argparse
from collections import Counter
from datetime import date, datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import ssl
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "research/north-jersey/cms/qcor"
LISTING = "https://qcor.cms.gov/HHA_2567_Reports"
EXPORT = "https://qcor.cms.gov/downloadHHA2567"
HHAS = "https://qcor.cms.gov/HHAs"
POS_VERSION = "8b2c0a70-7e47-4b0f-a592-e51eb315cead"
POS_URL = f"https://data.cms.gov/data-api/v1/dataset/{POS_VERSION}/data?" + urlencode({
    "filter[state_cd]": "NJ", "filter[prvdr_type_id]": "3",
    "limit": 500, "size": 500, "offset": 0,
})
COUNTIES = {"003": "Bergen", "013": "Essex", "017": "Hudson",
            "027": "Morris", "031": "Passaic", "039": "Union"}
HEADERS = [
    "CCN", "Facility Name", "Street Address", "City", "State/Territory", "ZIP",
    "CMS Region", "Survey Event ID", "Survey Date", "Survey Type", "Deficiency Tag",
    "Deficiency Description", "Deficiency Tag Type",
    *[f"Statement of Deficiency Text (Part {i})" for i in range(1, 5)],
]
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NOTICE = ("Due to systems migrations, HHA information generated from the Provider, "
          "Survey, and Deficiency Reports on this page is only accurate and/or "
          "available through May 19, 2021.")
LIMITS = [
    "Complete selection of NJ rows in this published export, not all surveys ever.",
    "The default listing selects surveys with deficiencies, not every published survey.",
    "The separate 2567 export includes post-migration records. The HHAs notice does "
    "not establish that this export is a complete current inspection history.",
    "Missing surveys or citations do not establish a clean record.",
    "Memo tags E0000 and G0000 are initial comments, not deficiency citations.",
    "Current POS office counties do not establish historical office location or service areas.",
    "Agencies outside the six office counties may serve these counties. Service coverage "
    "is not established by this collection.",
    "Narratives are exact decoded source cells. Their accuracy, completeness, and any "
    "Excel cell-length truncation remain CMS source limitations.",
    "Report URLs use the source listing's CCN/date parameters, not its event ID. "
    "Retain the separate event ID when distinguishing surveys.",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def retain(url, relative, output):
    path = output / relative
    receipt_path = path.with_name(path.name + ".http.json")
    require(urlparse(url).scheme == "https"
            and urlparse(url).hostname in {"qcor.cms.gov", "data.cms.gov"},
            "Only official CMS HTTPS downloads are allowed")
    if path.exists() or receipt_path.exists():
        require(path.exists() and receipt_path.exists(), f"Incomplete download {relative}")
        receipt = read_json(receipt_path)
        body = path.read_bytes()
        require(receipt["requestedUrl"] == url, f"Cached URL changed for {relative}")
        require(receipt["sha256"] == digest(body) and receipt["bytes"] == len(body),
                f"Cached source hash/length mismatch for {relative}")
        return body, receipt
    cafile = os.environ.get("SSL_CERT_FILE")
    if cafile is None and Path("/etc/ssl/cert.pem").is_file():
        cafile = "/etc/ssl/cert.pem"
    with urlopen(url, context=ssl.create_default_context(cafile=cafile),
                 timeout=180) as response:
        require(urlparse(response.url).hostname == urlparse(url).hostname,
                "CMS download redirected to a different host")
        body = response.read()
        receipt = {
            "requestedUrl": url, "effectiveUrl": response.url,
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
            "status": response.status,
            "headers": {k: v for k, v in response.headers.items()
                        if k.lower() != "set-cookie"},
            "sha256": digest(body), "bytes": len(body),
        }
        length = response.headers.get("Content-Length")
        require(length is None or len(body) == int(length), "Truncated HTTP download")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    write_json(receipt_path, receipt)
    return body, receipt


def workbook_rows(path):
    """Yield worksheet number, physical row number, and exact decoded cell strings."""
    with zipfile.ZipFile(path) as book:
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            strings = ["".join(t.text or "" for t in item.iter(NS + "t"))
                       for item in ET.fromstring(book.read("xl/sharedStrings.xml"))]
        sheets = sorted(name for name in book.namelist()
                        if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name))
        require(bool(sheets), "Workbook has no worksheets")
        for sheet in sheets:
            header = None
            with book.open(sheet) as stream:
                events = ET.iterparse(stream, events=("start", "end"))
                _, root = next(events)
                for event, row in events:
                    if event != "end" or row.tag != NS + "row":
                        continue
                    cells = {}
                    for cell in row.findall(NS + "c"):
                        match = re.fullmatch(r"([A-Z]+)\d+", cell.attrib["r"])
                        require(match is not None, "Invalid XLSX cell address")
                        index = 0
                        for letter in match[1]:
                            index = index * 26 + ord(letter) - ord("A") + 1
                        kind = cell.get("t")
                        if kind == "inlineStr":
                            value = "".join(t.text or "" for t in cell.iter(NS + "t"))
                        else:
                            value = cell.findtext(NS + "v", "")
                            if kind == "s":
                                value = strings[int(value)]
                        cells[index - 1] = value
                    if header is None:
                        header = [cells.get(i, "") for i in range(max(cells) + 1)]
                        require(header == HEADERS, f"Unexpected QCOR headers in {sheet}")
                    else:
                        require(not set(cells) - set(range(len(header))),
                                "XLSX row extends beyond header")
                        yield sheet, int(row.attrib["r"]), {
                            name: cells.get(i, "") for i, name in enumerate(header)
                        }
                    row.clear()
                    root.clear()


def event_key(row):
    ccn = row["CCN"]
    require(re.fullmatch(r"\d{2}[A-Z0-9]{4}", ccn) is not None,
            "CCN must retain six characters including leading zeros")
    require(bool(row["Survey Event ID"]), "Missing survey event ID")
    require(date.fromisoformat(row["Survey Date"]).isoformat() == row["Survey Date"],
            "Survey date must be an ISO date")
    return ccn, row["Survey Event ID"], row["Survey Date"]


def tag_kind(row):
    tag, kind = row["Deficiency Tag"], row["Deficiency Tag Type"]
    require(kind in {"Memo", "Condition", "Standard", "Element"},
            f"Unknown QCOR tag type {kind!r}")
    require(re.fullmatch(r"[EG]\d{4}", tag) is not None, "Invalid deficiency tag")
    require(tag not in {"E0000", "G0000"} or kind == "Memo",
            "Initial-comment tag cannot be a deficiency citation")
    return kind, kind != "Memo"


class ListingParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.stack = []
        self.ignored = 0
        self.text = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "style"}:
            self.ignored += 1
        if tag == "tr":
            self.stack.append({"cells": [], "links": [], "cell": None})
        elif self.stack and tag == "td":
            self.stack[-1]["cell"] = []
        elif self.stack and tag == "a" and "href" in attrs:
            self.stack[-1]["links"].append(urljoin(LISTING, attrs["href"]))

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.ignored = max(0, self.ignored - 1)
        if self.stack and tag == "td" and self.stack[-1]["cell"] is not None:
            self.stack[-1]["cells"].append(" ".join(self.stack[-1]["cell"]).strip())
            self.stack[-1]["cell"] = None
        elif self.stack and tag == "tr":
            self.rows.append(self.stack.pop())

    def handle_data(self, data):
        if not self.ignored:
            self.text.append(data)
            if self.stack and self.stack[-1]["cell"] is not None:
                self.stack[-1]["cell"].append(data.strip())


def parse_listing(body):
    parser = ListingParser()
    parser.feed(body.decode("iso-8859-1"))
    count_match = re.search(r"Total Records:\s*(\d+)", " ".join(parser.text))
    require(count_match is not None, "Missing listing header count")
    surveys = {}
    for row in parser.rows:
        cells = row["cells"]
        match = re.search(r"\b\d{2}[A-Z0-9]{4}\b", cells[0]) if cells else None
        if len(cells) != 10 or match is None:
            continue
        ccn = match[0]
        survey_date = datetime.strptime(cells[6], "%m/%d/%Y").date().isoformat()
        key = ccn, cells[7], survey_date
        require(key not in surveys, "Duplicate event on listing page")
        links = [url for url in row["links"]
                 if urlparse(url).path in {"/HHACombinedReportObject",
                                          "/HHACombinedReportObjectPDF"}]
        require(len(links) == 2, f"Missing combined report links for {key}")
        tags = None
        for url in links:
            params = parse_qs(urlparse(url).query)
            require(params["cmsNumber"] == [ccn] and params["surveyDate"] == [survey_date],
                    "Listing report URL does not match its survey")
            linked_tags = [tag.strip() for tag in params["tag"][0].split(",")]
            require(tags is None or tags == linked_tags, "Report link tags disagree")
            tags = linked_tags
        surveys[key] = {"source_cells": cells, "report_urls": links, "tags": tags}
    return int(count_match[1]), surveys, " ".join(" ".join(parser.text).split())


def retain_pos(output):
    if (output / "pos-source.json").exists():
        return
    pos = ROOT / "research/north-jersey/cms/pos"
    if (pos / "latest.json").exists():
        snapshot = pos / read_json(pos / "latest.json")["snapshot"]
        supplement_path = snapshot / "supplement.json"
        supplement = read_json(supplement_path)
        require(supplement["release"]["dataset_version_id"] == POS_VERSION,
                "Unexpected POS supplement release")
        paths = {r["source"]["file"] for r in supplement["records"]["home_health"]}
        require(len(paths) == 1, "Expected one bounded POS NJ page")
        source_path = paths.pop()
        body = (snapshot / source_path).read_bytes()
        source_receipt = read_json(snapshot / "manifest.json")["receipts"][source_path]
        require(digest(body) == source_receipt["sha256"], "POS supplement raw hash differs")
        relative = "raw/pos-nj-home-health.json"
        (output / relative).write_bytes(body)
        receipt = {
            "requestedUrl": source_receipt["url"],
            "effectiveUrl": source_receipt["effective_url"],
            "retrievedAt": source_receipt["retrieved_at"],
            "status": source_receipt["http_status"],
            "headers": {"Content-Type": source_receipt["content_type"],
                        "Last-Modified": source_receipt["last_modified"],
                        "ETag": source_receipt["etag"]},
            "sha256": digest(body), "bytes": len(body),
        }
        write_json(output / (relative + ".http.json"), receipt)
        provenance = {
            "basis": "Exact raw page reused from the independently retained POS supplement",
            "supplement_file": str(supplement_path.relative_to(ROOT)),
            "supplement_sha256": digest(supplement_path.read_bytes()),
            "release": supplement["release"],
        }
    else:
        retain(POS_URL, "raw/pos-nj-home-health.json", output)
        provenance = {
            "basis": "Direct bounded CMS POS NJ HHA API request",
            "release": {"dataset_version_id": POS_VERSION},
        }
    write_json(output / "pos-source.json", provenance)


def office_records(rows):
    require(len(rows) < 500, "POS page may be truncated")
    offices = {}
    for index, row in enumerate(rows):
        ccn = row["prvdr_num"]
        require(re.fullmatch(r"\d{6}", ccn) is not None, "Invalid POS CCN")
        require(ccn not in offices, "Duplicate POS CCN")
        require(row["state_cd"] == "NJ" and row["prvdr_type_id"] == "3",
                "POS filter did not select NJ home-health agencies")
        require(row["fips_state_cd"] == "34", "POS state FIPS differs from NJ")
        county = COUNTIES.get(row["fips_cnty_cd"])
        certified = row["fed_crtfctn_stus_name"] == "Certified"
        offices[ccn] = {
            "ccn": ccn, "name": row["fac_name"],
            "office_county": county,
            "office_county_fips": "34" + row["fips_cnty_cd"]
                if re.fullmatch(r"\d{3}", row["fips_cnty_cd"]) else None,
            "federal_status": row["fed_crtfctn_stus_name"],
            "selected_current_target_office": certified and county is not None,
            "county_assignment_basis": "Current POS provider office FIPS, not service area",
            "service_counties": None,
            "source": {"file": "raw/pos-nj-home-health.json", "row_index": index},
            "source_record": row,
        }
    return offices


def pull(output):
    retain(EXPORT, "raw/hha-2567.xlsx", output)
    retain(LISTING, "raw/listing.html", output)
    retain(HHAS, "raw/hhas.html", output)
    for name, params in [
        ("national-all", {"deficiencyFilter": "all"}),
        ("national-without", {"deficiencyFilter": "without"}),
        ("nj-with", {"states": "NJ", "deficiencyFilter": "with"}),
        ("nj-without", {"states": "NJ", "deficiencyFilter": "without"}),
    ]:
        retain(LISTING + "?" + urlencode(params), f"raw/{name}.html", output)
    url = LISTING + "?" + urlencode({"states": "NJ", "deficiencyFilter": "all", "page": 1})
    body, _ = retain(url, "raw/nj-all-001.html", output)
    count, _, _ = parse_listing(body)
    for page in range(2, math.ceil(count / 10) + 1):
        url = LISTING + "?" + urlencode({
            "states": "NJ", "deficiencyFilter": "all", "page": page,
        })
        retain(url, f"raw/nj-all-{page:03}.html", output)
    retain_pos(output)
    build(output)


def derive(output):
    receipts = {}
    for path in sorted((output / "raw").glob("*.http.json")):
        relative = str(path.relative_to(output))[:-len(".http.json")]
        receipt = read_json(path)
        body = (output / relative).read_bytes()
        require(digest(body) == receipt["sha256"] and len(body) == receipt["bytes"],
                f"Source hash/length mismatch for {relative}")
        require(receipt["status"] == 200, f"Unsuccessful source response {relative}")
        require(urlparse(receipt["effectiveUrl"]).scheme == "https"
                and urlparse(receipt["effectiveUrl"]).hostname in {"qcor.cms.gov", "data.cms.gov"},
                "Unofficial source")
        require(datetime.fromisoformat(receipt["retrievedAt"]).utcoffset() is not None,
                "Retrieval time must include its timezone")
        receipts[relative] = receipt
    required = {"raw/hha-2567.xlsx": EXPORT, "raw/listing.html": LISTING,
                "raw/hhas.html": HHAS}
    for name, params in [
        ("national-all", {"deficiencyFilter": "all"}),
        ("national-without", {"deficiencyFilter": "without"}),
        ("nj-with", {"states": "NJ", "deficiencyFilter": "with"}),
        ("nj-without", {"states": "NJ", "deficiencyFilter": "without"}),
    ]:
        required[f"raw/{name}.html"] = LISTING + "?" + urlencode(params)
    for name, url in required.items():
        require(receipts.get(name, {}).get("requestedUrl") == url,
                f"Missing official source receipt {name}")
    header_counts = {}
    for name in ("listing", "national-all", "national-without", "nj-with", "nj-without"):
        count, _, _ = parse_listing((output / f"raw/{name}.html").read_bytes())
        header_counts[name] = count
    listings = {}
    first = (output / "raw/nj-all-001.html").read_bytes()
    nj_count, _, _ = parse_listing(first)
    for page in range(1, math.ceil(nj_count / 10) + 1):
        name = f"raw/nj-all-{page:03}.html"
        expected_url = LISTING + "?" + urlencode({
            "states": "NJ", "deficiencyFilter": "all", "page": page,
        })
        require(receipts.get(name, {}).get("requestedUrl") == expected_url,
                f"Missing official NJ page receipt {page}")
        count, surveys, _ = parse_listing((output / name).read_bytes())
        require(count == nj_count, "NJ listing count changed during pagination")
        require(len(surveys) == min(10, nj_count - 10 * (page - 1)),
                f"Truncated NJ listing page {page}")
        require(not set(listings) & set(surveys), "Duplicate paginated NJ survey")
        for key, survey in surveys.items():
            survey["listing_file"] = name
            listings[key] = survey
    require(len(listings) == nj_count, "NJ listing pagination incomplete")
    pos_receipt = receipts.get("raw/pos-nj-home-health.json", {})
    require(pos_receipt.get("requestedUrl") == POS_URL, "Missing bounded POS source receipt")
    require(read_json(output / "pos-source.json")["release"]["dataset_version_id"] == POS_VERSION,
            "Unexpected POS release")
    offices = office_records(read_json(output / "raw/pos-nj-home-health.json"))
    national, nj = {}, {}
    row_count, type_counts, dates = 0, Counter(), []
    for sheet, physical_row, row in workbook_rows(output / "raw/hha-2567.xlsx"):
        key = event_key(row)
        kind, citation = tag_kind(row)
        row_count += 1
        type_counts[kind] += 1
        national[key] = national.get(key, False) or citation
        dates.append(row["Survey Date"])
        if row["State/Territory"] != "NJ":
            continue
        if key not in nj:
            office = offices.get(key[0])
            nj[key] = {
                "ccn": key[0], "survey_event_id": key[1], "survey_date": key[2],
                "survey_type": row["Survey Type"],
                "source_facility_name": row["Facility Name"],
                "current_pos_office_county": office["office_county"] if office else None,
                "current_pos_office_county_fips": office["office_county_fips"] if office else None,
                "selected_current_target_office": (
                    office["selected_current_target_office"] if office else False),
                "office_join_basis": "Exact CCN to current POS, not historical or service geography",
                "service_counties": None,
                "rows": [],
            }
        survey = nj[key]
        require(survey["survey_type"] == row["Survey Type"], "Event survey types disagree")
        survey["rows"].append({
            "source": {"file": "raw/hha-2567.xlsx", "worksheet": sheet,
                       "row_number": physical_row},
            "tag": row["Deficiency Tag"], "tag_type": kind,
            "is_deficiency_citation": citation,
            "source_record": row,
        })
    require(len(national) == header_counts["national-all"],
            "Export survey count differs from national All listing header")
    require(set(nj) == set(listings),
            "Export NJ event identities differ from complete All listing selection")
    for key, survey in nj.items():
        listing = listings[key]
        require({r["tag"] for r in survey["rows"]} == set(listing["tags"]),
                f"Export and listing tags differ for {key}")
        survey["listing_source"] = {
            "file": listing["listing_file"], "source_cells": listing["source_cells"],
        }
        survey["report_urls"] = listing["report_urls"]
        survey["citation_row_count"] = sum(r["is_deficiency_citation"] for r in survey["rows"])
        survey["memo_row_count"] = len(survey["rows"]) - survey["citation_row_count"]
        survey["evidence_status"] = ("published_citation_rows" if survey["citation_row_count"]
                                     else "published_memo_rows_only")
    for ccn, office in offices.items():
        surveys = [s for s in nj.values() if s["ccn"] == ccn]
        office["published_survey_event_ids"] = sorted(s["survey_event_id"] for s in surveys)
        office["published_survey_count"] = len(surveys)
        office["published_citation_row_count"] = sum(s["citation_row_count"] for s in surveys)
        office["evidence_status"] = ("published_rows_available" if surveys
                                     else "no_rows_in_published_export_not_a_clean_record")
    hhas_parser = ListingParser()
    hhas_parser.feed((output / "raw/hhas.html").read_bytes().decode("iso-8859-1"))
    hhas_text = " ".join(" ".join(hhas_parser.text).split())
    require(NOTICE in hhas_text, "CMS migration notice changed")
    source_date = re.search(r"Source:\s*CASPER\s*\(([^)]+)\)", hhas_text)
    with zipfile.ZipFile(output / "raw/hha-2567.xlsx") as book:
        core = ET.fromstring(book.read("docProps/core.xml"))
        core_dates = {node.tag.split("}")[-1]: node.text for node in core
                      if node.tag.split("}")[-1] in {"created", "modified"}}
    selected = [o for o in offices.values() if o["selected_current_target_office"]]
    target_surveys = [s for s in nj.values() if s["selected_current_target_office"]]
    nj_types = Counter(r["tag_type"] for s in nj.values() for r in s["rows"])
    national_with = sum(national.values())
    nj_with = sum(bool(s["citation_row_count"]) for s in nj.values())
    counts = {
        "national_export_rows": row_count, "national_export_surveys": len(national),
        "national_export_surveys_with_citation_rows": national_with,
        "national_export_surveys_with_memo_rows_only": len(national) - national_with,
        "national_export_tag_types": dict(sorted(type_counts.items())),
        "listing_header_counts": {**header_counts, "nj-all": nj_count},
        "national_export_survey_date_min": min(dates),
        "national_export_survey_date_max": max(dates),
        "nj_export_rows": sum(len(s["rows"]) for s in nj.values()),
        "nj_export_surveys": len(nj), "nj_export_ccns": len({k[0] for k in nj}),
        "nj_export_surveys_with_citation_rows": nj_with,
        "nj_export_surveys_with_memo_rows_only": len(nj) - nj_with,
        "nj_export_tag_types": dict(sorted(nj_types.items())),
        "nj_export_survey_date_min": min(k[2] for k in nj),
        "nj_export_survey_date_max": max(k[2] for k in nj),
        "nj_pos_offices": len(offices),
        "nj_pos_certified_offices": sum(o["federal_status"] == "Certified"
                                         for o in offices.values()),
        "target_certified_offices": len(selected),
        "target_certified_office_counties": dict(sorted(Counter(
            o["office_county"] for o in selected).items())),
        "target_offices_with_published_surveys": sum(o["published_survey_count"] > 0
                                                    for o in selected),
        "target_export_surveys": len(target_surveys),
        "target_export_rows": sum(len(s["rows"]) for s in target_surveys),
        "target_citation_rows": sum(s["citation_row_count"] for s in target_surveys),
        "target_memo_rows": sum(s["memo_row_count"] for s in target_surveys),
        "target_export_tag_types": dict(sorted(Counter(
            r["tag_type"] for s in target_surveys for r in s["rows"]).items())),
        "target_ccns_without_published_surveys": sorted(
            o["ccn"] for o in selected if not o["published_survey_count"]),
        "nj_export_ccns_absent_from_pos": sorted({k[0] for k in nj} - set(offices)),
    }
    discrepancies = []
    for scope, with_count, total, with_header, without_header in [
        ("national", national_with, len(national), header_counts["listing"],
         header_counts["national-without"]),
        ("NJ", nj_with, len(nj), header_counts["nj-with"], header_counts["nj-without"]),
    ]:
        if with_count != with_header or total - with_count != without_header:
            discrepancies.append({
                "scope": scope, "export_with_citation_rows": with_count,
                "export_memo_only": total - with_count,
                "listing_with_header": with_header,
                "listing_without_header": without_header,
                "status": "Source filter classification discrepancy, cause unresolved",
            })
    manifest = {
        "schema_version": 1,
        "coverage": "Complete published-export NJ selection, not all surveys ever",
        "county_scope": list(COUNTIES.values()), "county_scope_basis": "Current POS office FIPS",
        "migration_notice": {"url": HHAS, "exact_text": NOTICE,
                             "casper_source_date": source_date[1] if source_date else None},
        "export_workbook_dates": core_dates,
        "pos_provenance": read_json(output / "pos-source.json"),
        "counts": counts, "receipts": receipts,
        "checks": {
            "national_all_header_matches_distinct_export_surveys": True,
            "all_nj_listing_pages_retained": math.ceil(nj_count / 10),
            "nj_listing_and_export_event_identities_match": True,
            "nj_listing_and_export_tag_sets_match": True,
        },
        "unresolved": discrepancies, "limitations": LIMITS,
    }
    return manifest, [nj[k] for k in sorted(nj)], [offices[k] for k in sorted(offices)]


def build(output):
    manifest, surveys, agencies = derive(output)
    write_json(output / "surveys.json", surveys)
    write_json(output / "agencies.json", agencies)
    manifest["artifacts"] = {
        name: {"sha256": digest((output / name).read_bytes()),
               "bytes": (output / name).stat().st_size}
        for name in ("surveys.json", "agencies.json", "pos-source.json")
    }
    write_json(output / "manifest.json", manifest)
    return manifest


def verify(output):
    expected, surveys, agencies = derive(output)
    actual = read_json(output / "manifest.json")
    for key, value in expected.items():
        require(actual.get(key) == value, f"Manifest mismatch at {key}")
    for name, value in (("surveys.json", surveys), ("agencies.json", agencies)):
        require(read_json(output / name) == value, f"Incomplete/changed derived {name}")
    for name, receipt in actual["artifacts"].items():
        body = (output / name).read_bytes()
        require(digest(body) == receipt["sha256"] and len(body) == receipt["bytes"],
                f"Artifact hash/length mismatch at {name}")
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("pull", "build", "verify"))
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    output = args.output.resolve()
    if args.command == "pull":
        pull(output)
        result = read_json(output / "manifest.json")
    elif args.command == "build":
        result = build(output)
    else:
        result = verify(output)
    print(json.dumps({"command": args.command, "output": str(output),
                      "counts": result["counts"], "unresolved": result["unresolved"]},
                     indent=2))


if __name__ == "__main__":
    main()
