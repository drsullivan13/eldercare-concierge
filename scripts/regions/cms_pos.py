#!/usr/bin/env python3
"""Retain and offline-verify the bounded North Jersey CMS iQIES supplement."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "research/north-jersey/cms/pos"
VERSION = "8b2c0a70-7e47-4b0f-a592-e51eb315cead"
TYPE_ID = "086e48c4-87a6-4be1-8823-29e8da8f225b"
RELEASE = "Q3 2026"
PAGE = ("https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/"
        "provider-of-services-file-internet-quality-improvement-and-evaluation-system")
DOCS = PAGE + "/api-docs"
DICTIONARY = ("https://data.cms.gov/sites/default/files/2026-10/"
              "1fea27a3-7603-4fd2-bc2a-3e868934a9bf/"
              "iQIES%20POS%20Data%20Dictionary%20Oct2026.xlsx")
COUNTIES = {"003": "Bergen", "013": "Essex", "017": "Hudson",
            "027": "Morris", "031": "Passaic", "039": "Union"}
EXPECTED_HHA = {"Bergen": 5, "Essex": 4, "Hudson": 3,
                "Morris": 3, "Passaic": 2, "Union": 1}
PDC_CCN = "cms_certification_number_ccn"
FAMILIES = {
    "home_health": {"type_code": "3", "type_name": "Home Health Agency", "pdc": "6jpm-sxkc"},
    "nursing": {"type_code": "20", "type_name": "Nursing Home", "pdc": "4pq5-n9py"},
}
DISCOVERY = "https://data.cms.gov/jsonapi/node/dataset?" + urlencode({
    "filter[field_dataset_type.id]": TYPE_ID, "filter[status]": "1",
    "sort": "-field_dataset_version", "page[limit]": 1,
})
METADATA = f"https://data.cms.gov/jsonapi/node/dataset/{VERSION}"
RESOURCES = f"https://data.cms.gov/data-api/v1/dataset/{VERSION}/resources"
LATEST_RESOURCES = f"https://data.cms.gov/data-api/v1/dataset/{TYPE_ID}/resources"
PAGE_SIZE = 500
SCHEMA_URL = f"https://data.cms.gov/data-api/v1/dataset/{VERSION}/data-viewer?" + urlencode({
    "filter[state_cd]": "NJ", "filter[prvdr_type_id]": "3", "size": 1, "offset": 0,
})


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def fetch(url, relative, root=OUTPUT):
    require(urlparse(url).scheme == "https" and urlparse(url).hostname == "data.cms.gov",
            "Only official data.cms.gov HTTPS sources are allowed")
    cafile = os.environ.get("SSL_CERT_FILE")
    if cafile is None and Path("/etc/ssl/cert.pem").is_file():
        cafile = "/etc/ssl/cert.pem"
    context = ssl.create_default_context(cafile=cafile)
    for attempt in range(4):
        try:
            with urlopen(url, timeout=120, context=context) as response:
                require(urlparse(response.url).hostname == "data.cms.gov",
                        "Redirect left data.cms.gov")
                body = response.read()
                receipt = {
                    "url": url, "effective_url": response.url,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "http_status": response.status,
                    "last_modified": response.headers.get("Last-Modified"),
                    "etag": response.headers.get("ETag"),
                    "content_type": response.headers.get("Content-Type"),
                    "sha256": sha256(body), "bytes": len(body), "file": relative,
                }
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return body, receipt
        except (HTTPError, URLError, TimeoutError) as error:
            if isinstance(error, HTTPError) and error.code not in {429, 500, 502, 503, 504}:
                raise
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def dictionary_rows(body):
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(body)) as book:
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            strings = ["".join(node.itertext()) for node in
                       ET.fromstring(book.read("xl/sharedStrings.xml")).findall("s:si", ns)]
        sheets = {}
        for name in sorted(book.namelist()):
            if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
                continue
            rows = []
            for row in ET.fromstring(book.read(name)).findall(".//s:row", ns):
                values = []
                for cell in row.findall("s:c", ns):
                    value = cell.find("s:v", ns)
                    text = value.text if value is not None else ""
                    if cell.get("t") == "s":
                        text = strings[int(text)]
                    elif cell.get("t") == "inlineStr":
                        text = "".join(cell.find("s:is", ns).itertext())
                    values.append(text)
                rows.append(values)
            sheets[name] = rows
        return sheets


def validate_discovery(discovery, metadata, resources, latest_resources):
    latest = discovery["data"]
    require(len(latest) == 1 and latest[0]["id"] == VERSION,
            "Latest published iQIES version is no longer pinned Q3 2026; review before collecting")
    node = metadata["data"]
    require(node["id"] == VERSION, "Wrong pinned metadata version")
    for item in [latest[0], node]:
        require(item["relationships"]["field_dataset_type"]["data"]["id"] == TYPE_ID,
                "Wrong dataset type in discovery")
        require(item["attributes"]["status"] is True, "Dataset is not published")
        require(item["attributes"]["field_dataset_version"] == "2026-07-01",
                "Unexpected quarterly release")
    require(resources["meta"]["success"] is True and latest_resources["meta"]["success"] is True,
            "Resources lookup failed")
    primary = [x for x in resources["data"] if x["type"] == "Primary"]
    current = [x for x in latest_resources["data"] if x["type"] == "Primary"]
    require(len(primary) == len(current) == 1, "Missing unique primary data file")
    require(primary[0]["file_url"] == current[0]["file_url"]
            and primary[0]["title"] == current[0]["title"],
            "Latest iQIES primary file changed; review the pinned release")
    require("Q3 2026" in primary[0]["title"], "Wrong primary release label")
    require(any(x.get("file_url") == DICTIONARY for x in resources["data"]),
            "Official pinned dictionary changed")
    attrs = node["attributes"]
    return {
        "dataset_type_id": TYPE_ID, "dataset_version_id": VERSION, "release": RELEASE,
        "release_period_start": attrs["field_dataset_version"],
        "page_created_date": attrs["field_created_date"],
        "page_modified_date": attrs["field_last_updated_date"],
        "metadata_revision_timestamp": attrs["revision_timestamp"],
        "primary_download_url": primary[0]["file_url"],
        "documentation_url": DOCS, "dictionary_url": DICTIONARY,
    }


def pos_url(type_code, offset):
    return f"https://data.cms.gov/data-api/v1/dataset/{VERSION}/data?" + urlencode({
        "filter[state_cd]": "NJ", "filter[prvdr_type_id]": type_code,
        "limit": PAGE_SIZE, "size": PAGE_SIZE, "offset": offset,
    })


def pdc_url(dataset, offset):
    return f"https://data.cms.gov/provider-data/api/1/datastore/query/{dataset}/0?" + urlencode({
        "conditions[0][property]": "state", "conditions[0][operator]": "=",
        "conditions[0][value]": "NJ", "limit": PAGE_SIZE, "offset": offset,
        "count": "true", "results": "true",
        "sorts[0][property]": PDC_CCN, "sorts[0][order]": "asc",
    })


def validate_pos(rows, family, headers):
    require(isinstance(rows, list) and len(rows) <= PAGE_SIZE, "Invalid POS page")
    for row in rows:
        require(isinstance(row, dict) and set(row) == set(headers), "POS schema changed")
        require(all(isinstance(v, str) for v in row.values()), "POS source values must remain text")
        require(row["state_cd"] == "NJ"
                and row["prvdr_type_id"] == FAMILIES[family]["type_code"],
                "POS returned records outside requested NJ provider type")
        require(re.fullmatch(r"[A-Za-z0-9]{6}", row["prvdr_num"]), "Invalid POS CCN")
        require(row["fips_state_cd"] == "34", "NJ record has a conflicting FIPS state")
        require(row["fed_crtfctn_stus_name"] in {"Certified", "Terminated"},
                "New federal certification status needs review")
        require(row["fed_crtfctn_stus_id"] == {
            "Certified": "3", "Terminated": "4",
        }[row["fed_crtfctn_stus_name"]], "Certification status ID/name conflict")


def validate_pdc(page, offset, expected=None):
    require(isinstance(page.get("results"), list), "Missing PDC results")
    count = page.get("count")
    require(type(count) is int and count >= 0, "Missing PDC count")
    require(expected is None or count == expected, "PDC count changed during pagination")
    query = page.get("query", {})
    require(query.get("offset") == offset and query.get("limit") == PAGE_SIZE,
            "PDC pagination not honored")
    require(query.get("conditions") == [{"property": "state", "operator": "=", "value": "NJ"}],
            "PDC filter not honored")
    require(query.get("sorts") == [{"property": PDC_CCN, "order": "asc"}],
            "PDC ordering not honored")
    require(len(page["results"]) == min(PAGE_SIZE, max(0, count - offset)),
            "PDC page truncated")
    for row in page["results"]:
        require(row.get("state") == "NJ", "PDC record outside NJ")
        require(isinstance(row.get(PDC_CCN), str)
                and re.fullmatch(r"\d{6}", row[PDC_CCN]), "Invalid PDC CCN")
    return count


def derive(pos_rows, pdc_rows):
    records, reconciliation, counts = {}, {}, {}
    for family in FAMILIES:
        rows, pdc = pos_rows[family], pdc_rows[family]
        require(len({r["prvdr_num"] for r, _ in rows}) == len(rows), "Duplicate POS CCN")
        require(len({r[PDC_CCN] for r in pdc}) == len(pdc), "Duplicate PDC CCN")
        pdc_by_ccn = {r[PDC_CCN]: r for r in pdc}
        certified = {r["prvdr_num"] for r, _ in rows
                     if r["fed_crtfctn_stus_name"] == "Certified"}
        projected = []
        for row, source in rows:
            county = COUNTIES.get(row["fips_cnty_cd"])
            active = row["fed_crtfctn_stus_name"] == "Certified"
            selection = ("certified_target_office_county" if county else
                         "certified_other_or_unknown_office_county") if active else \
                        "not_certified_not_selected"
            projected.append({
                "ccn": row["prvdr_num"], "family": family, "selection": selection,
                "office_county": county,
                "office_county_fips": row["fips_state_cd"] + row["fips_cnty_cd"]
                    if re.fullmatch(r"\d{3}", row["fips_cnty_cd"]) else None,
                "county_assignment_basis": "POS reported provider location FIPS, not service area",
                "present_in_current_pdc_nj_roster": row["prvdr_num"] in pdc_by_ccn,
                "source": source, "source_record": row,
            })
        records[family] = sorted(projected, key=lambda r: r["ccn"])
        pdc_ccns = set(pdc_by_ccn)
        reconciliation[family] = {
            "pdc_dataset_id": FAMILIES[family]["pdc"],
            "pos_certified_count": len(certified), "pdc_nj_count": len(pdc),
            "matched_certified_ccns": sorted(certified & pdc_ccns),
            "pos_certified_absent_from_pdc": sorted(certified - pdc_ccns),
            "pdc_absent_from_pos_certified": sorted(pdc_ccns - certified),
            "noncertified_pos_present_in_pdc": [
                {"ccn": r["prvdr_num"], "federal_status": r["fed_crtfctn_stus_name"],
                 "termination_date": r["trmntn_exprtn_dt"]}
                for r, _ in rows if r["prvdr_num"] in pdc_ccns and r["prvdr_num"] not in certified
            ],
            "certified_with_survey_compliance_no": sorted(
                r["prvdr_num"] for r, _ in rows if r["prvdr_num"] in certified
                and r["cmplnc_stus_cd"] == "No"),
            "target_office_county_disagreements": [
                {"ccn": r["ccn"], "pos_office_county": r["office_county"],
                 "pdc_county": pdc_by_ccn[r["ccn"]]["countyparish"]}
                for r in records[family]
                if r["selection"] == "certified_target_office_county"
                and r["ccn"] in pdc_by_ccn
                and "countyparish" in pdc_by_ccn[r["ccn"]]
                and r["office_county"] != pdc_by_ccn[r["ccn"]]["countyparish"]
            ],
        }
        counts[family] = {
            "all_nj_pos_records": len(rows),
            "federal_status_counts": dict(sorted(Counter(
                r["fed_crtfctn_stus_name"] for r, _ in rows).items())),
            "certified_target_office_counties": {
                name: sum(r["office_county"] == name
                          and r["selection"] == "certified_target_office_county"
                          for r in projected) for name in COUNTIES.values()
            },
            "selection_counts": dict(sorted(Counter(r["selection"] for r in projected).items())),
        }
    require(counts["home_health"]["all_nj_pos_records"] == 75, "Q3 NJ HHA count differs from 75")
    require(counts["home_health"]["federal_status_counts"].get("Certified") == 38,
            "Q3 certified NJ HHA count differs from 38")
    require(counts["home_health"]["certified_target_office_counties"] == EXPECTED_HHA,
            "Q3 certified HHA office-county baseline changed")
    home_health = reconciliation["home_health"]
    require(home_health["pdc_nj_count"] == 38
            and len(home_health["matched_certified_ccns"]) == 38
            and not home_health["pos_certified_absent_from_pdc"]
            and not home_health["pdc_absent_from_pos_certified"],
            "Certified NJ HHA CCNs do not exactly reconcile with the 38-record PDC roster")
    return {"records": records, "counts": counts, "reconciliation": reconciliation}


def pull():
    snapshot = OUTPUT / "snapshots" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    snapshot.mkdir(parents=True, exist_ok=False)
    receipts = {}

    def retain(url, relative):
        body, receipt = fetch(url, relative, snapshot)
        receipts[relative] = receipt
        return body

    discovery = json.loads(retain(DISCOVERY, "raw/discovery.json"))
    metadata = json.loads(retain(METADATA, "raw/metadata.json"))
    resources = json.loads(retain(RESOURCES, "raw/resources.json"))
    latest = json.loads(retain(LATEST_RESOURCES, "raw/latest-resources.json"))
    release = validate_discovery(discovery, metadata, resources, latest)
    retain(DOCS, "raw/api-docs.html")
    dictionary = retain(DICTIONARY, "raw/dictionary.xlsx")
    sheets = dictionary_rows(dictionary)
    schema = json.loads(retain(SCHEMA_URL, "raw/schema.json"))
    headers = schema["meta"]["headers"]
    require(len(headers) == len(set(headers)) == 186, "Unexpected API schema")
    for spec in FAMILIES.values():
        require([spec["type_code"], spec["type_name"]]
                in sheets["xl/worksheets/sheet2.xml"], "Provider type dictionary changed")
    pages, pdc_pages, pdc_metadata = {}, {}, {}
    for family, spec in FAMILIES.items():
        pages[family], pdc_pages[family] = [], []
        offset = 0
        while offset < 10000:
            relative = f"raw/{family}/pos-{offset:05d}.json"
            rows = json.loads(retain(pos_url(spec["type_code"], offset), relative))
            validate_pos(rows, family, headers)
            pages[family].append({"file": relative, "offset": offset, "rows": len(rows)})
            if not rows:
                break
            offset += len(rows)
        else:
            raise ValueError("POS bounded pagination exceeded 10000 NJ records")
        relative = f"raw/{family}/pdc-metadata.json"
        retain(f"https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/{spec['pdc']}",
               relative)
        pdc_metadata[family] = relative
        expected, offset = None, 0
        while True:
            relative = f"raw/{family}/pdc-{offset:05d}.json"
            page = json.loads(retain(pdc_url(spec["pdc"], offset), relative))
            expected = validate_pdc(page, offset, expected)
            require(expected <= 10000, "PDC bounded NJ count exceeded 10000")
            pdc_pages[family].append({"file": relative, "offset": offset,
                                      "rows": len(page["results"])})
            offset += len(page["results"])
            if offset == expected:
                break
    manifest = {"schema_version": 1, "release": release, "receipts": receipts,
                "pos_pages": pages, "pdc_pages": pdc_pages, "pdc_metadata": pdc_metadata}
    write_json(snapshot / "manifest.json", manifest)
    result = verify(snapshot, check_derived=False)
    write_json(snapshot / "supplement.json", result)
    verify(snapshot)
    write_json(OUTPUT / "latest.json", {"snapshot": str(snapshot.relative_to(OUTPUT))})


def verify(snapshot=None, check_derived=True):
    if snapshot is None:
        relative = json.loads((OUTPUT / "latest.json").read_text())["snapshot"]
        snapshot = OUTPUT / relative
        require(snapshot.resolve().is_relative_to(OUTPUT.resolve()), "Snapshot path escapes POS")
    manifest = json.loads((snapshot / "manifest.json").read_text())
    require(manifest["schema_version"] == 1, "Unsupported manifest schema")
    receipts = manifest["receipts"]
    bodies = {}
    for relative, receipt in receipts.items():
        path = snapshot / relative
        require(path.resolve().is_relative_to(snapshot.resolve()), "Receipt path escapes snapshot")
        body = path.read_bytes()
        require(receipt["file"] == relative and sha256(body) == receipt["sha256"]
                and len(body) == receipt["bytes"], f"Response hash/size mismatch: {relative}")
        for field in ["url", "effective_url"]:
            parsed = urlparse(receipt[field])
            require(parsed.scheme == "https" and parsed.hostname == "data.cms.gov",
                    "Receipt source is not official CMS HTTPS")
        require(receipt["http_status"] == 200, "Source request was not successful")
        require(datetime.fromisoformat(receipt["retrieved_at"]).utcoffset() is not None,
                "Missing retrieval timezone")
        bodies[relative] = body

    def source(relative, url):
        require(receipts[relative]["url"] == url, f"Unexpected source URL: {relative}")
        return json.loads(bodies[relative])

    release = validate_discovery(source("raw/discovery.json", DISCOVERY),
                                 source("raw/metadata.json", METADATA),
                                 source("raw/resources.json", RESOURCES),
                                 source("raw/latest-resources.json", LATEST_RESOURCES))
    require(release == manifest["release"], "Release metadata differs from source")
    require(receipts["raw/api-docs.html"]["url"] == DOCS, "Missing docs page")
    require(receipts["raw/dictionary.xlsx"]["url"] == DICTIONARY, "Wrong dictionary URL")
    sheets = dictionary_rows(bodies["raw/dictionary.xlsx"])
    schema = source("raw/schema.json", SCHEMA_URL)
    require(schema["meta"]["success"] is True, "API schema lookup failed")
    headers = schema["meta"]["headers"]
    require(len(headers) == len(set(headers)) == 186, "Unexpected POS API schema")
    dictionary_fields = [r[0] for r in sheets["xl/worksheets/sheet1.xml"][1:]]
    pos_rows, pdc_rows, pdc_release = {}, {}, {}
    for family, spec in FAMILIES.items():
        require([spec["type_code"], spec["type_name"]]
                in sheets["xl/worksheets/sheet2.xml"], "Wrong POS provider type code")
        pos_rows[family], pdc_rows[family] = [], []
        offset = 0
        pages = manifest["pos_pages"][family]
        require(bool(pages) and pages[-1]["rows"] == 0, "Missing POS terminal empty page")
        for index, page in enumerate(pages):
            require(page["offset"] == offset, "POS page gap or overlap")
            rows = source(page["file"], pos_url(spec["type_code"], offset))
            validate_pos(rows, family, headers)
            require(len(rows) == page["rows"], "POS page row count mismatch")
            require(bool(rows) or index == len(pages) - 1, "Premature POS empty page")
            pos_rows[family].extend((row, {
                "file": page["file"], "row_index": i,
                "response_sha256": receipts[page["file"]]["sha256"],
                "dataset_version_id": VERSION,
            }) for i, row in enumerate(rows))
            offset += len(rows)
        expected, offset = None, 0
        for page in manifest["pdc_pages"][family]:
            require(page["offset"] == offset, "PDC page gap or overlap")
            payload = source(page["file"], pdc_url(spec["pdc"], offset))
            expected = validate_pdc(payload, offset, expected)
            require(len(payload["results"]) == page["rows"], "PDC page row count mismatch")
            pdc_rows[family].extend(payload["results"])
            offset += len(payload["results"])
        require(expected is not None and offset == expected, "Incomplete PDC extraction")
        metadata = source(manifest["pdc_metadata"][family],
                          f"https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/{spec['pdc']}")
        require(metadata["identifier"] == spec["pdc"], "Wrong PDC metadata dataset")
        pdc_release[family] = {
            key: metadata.get(key) for key in
            ["identifier", "title", "modified", "issued", "released", "nextUpdateDate", "temporal"]
        }
    result = {
        "release": release, "pdc_release": pdc_release,
        "dictionary_schema_differences": {
            "api_only_fields": sorted(set(headers) - set(dictionary_fields)),
            "dictionary_only_fields": sorted(set(dictionary_fields) - set(headers)),
            "duplicate_dictionary_fields": sorted(k for k, n in Counter(dictionary_fields).items()
                                                if n > 1),
        },
        **derive(pos_rows, pdc_rows),
    }
    if check_derived:
        require(json.loads((snapshot / "supplement.json").read_text()) == result,
                "Derived supplement differs from retained sources")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["pull", "verify"])
    args = parser.parse_args()
    if args.command == "pull":
        pull()
    result = verify()
    print(json.dumps({key: result[key] for key in ["release", "counts", "reconciliation"]}, indent=2))


if __name__ == "__main__":
    main()
