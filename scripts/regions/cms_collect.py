#!/usr/bin/env python3
"""Collect or verify retained official CMS evidence for North Jersey."""

import argparse
from collections import Counter, defaultdict
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
OUTPUT = ROOT / "research/north-jersey/cms"
API = "https://data.cms.gov/provider-data/api/1"
CATALOG = API + "/metastore/schemas/dataset/items"
CCN = "cms_certification_number_ccn"
COUNTIES = {
    "Bergen": "34003", "Essex": "34013", "Hudson": "34017",
    "Morris": "34027", "Passaic": "34031", "Union": "34039",
}
REVISION = "10943335a9088114d94b215e5b174bb050b8fd95"
CROSSWALK_BASE = f"https://raw.githubusercontent.com/CMSgov/qpp-eu-data/{REVISION}"
REGISTRY = {
    "4pq5-n9py": {"role": "nursing_roster_and_pbj_summary", "family": "nursing", "scope": "state"},
    "r5ix-sfxw": {"role": "health_deficiencies", "family": "nursing", "scope": "state"},
    "ifjz-ge4w": {"role": "fire_safety_deficiencies", "family": "nursing", "scope": "state"},
    "g6vv-u9sr": {"role": "penalties", "family": "nursing", "scope": "state"},
    "djen-97ju": {"role": "mds_quality", "family": "nursing", "scope": "state"},
    "ijh5-nb2v": {"role": "claims_quality", "family": "nursing", "scope": "state"},
    "tbry-pc2d": {"role": "survey_summary", "family": "nursing", "scope": "state"},
    "svdt-c123": {"role": "inspection_dates", "family": "nursing", "scope": "ccn_range"},
    "fykj-qjee": {"role": "snf_qrp_quality", "family": "nursing", "scope": "state"},
    "qmdc-9999": {"role": "measure_and_staffing_periods", "family": "nursing", "scope": "national"},
    "tagd-9999": {"role": "citation_dictionary", "family": "nursing", "scope": "national"},
    "hicp-9999": {"role": "inspection_rating_cutpoints", "family": "nursing", "scope": "state"},
    "6jpm-sxkc": {"role": "home_health_roster_and_clinical", "family": "home_health", "scope": "state"},
    "ccn4-8vby": {"role": "hhcahps", "family": "home_health", "scope": "ccn_range"},
    "m5eg-upu5": {"role": "home_health_service_zips", "family": "home_health", "scope": "service_zip"},
    "c886-nwpj": {"role": "home_health_measure_periods", "family": "home_health", "scope": "national"},
    "fa88-6ff2": {"role": "hhcahps_measure_periods", "family": "home_health", "scope": "national"},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(body):
    return hashlib.sha256(body).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def official_url(url):
    parsed = urlparse(url)
    return parsed.scheme == "https" and not parsed.username and not parsed.password and (
        parsed.hostname in {"data.cms.gov", "www.cms.gov", "cms.gov"}
        or (parsed.hostname == "raw.githubusercontent.com"
            and parsed.path.startswith("/CMSgov/qpp-eu-data/"))
    )


def fetch(url, path, root, refresh=False):
    require(official_url(url), f"Not an approved official source: {url}")
    receipt_path = path.with_name(path.name + ".receipt.json")
    if receipt_path.exists() and not refresh:
        receipt = json.loads(receipt_path.read_text())
        if receipt["url"] == url and "transport" not in receipt:
            return verify_receipt(root, receipt), receipt
    cafile = os.environ.get("SSL_CERT_FILE")
    if cafile is None and Path("/etc/ssl/cert.pem").is_file():
        cafile = "/etc/ssl/cert.pem"
    context = ssl.create_default_context(cafile=cafile)
    for attempt in range(4):
        try:
            with urlopen(url, timeout=120, context=context) as response:
                require(official_url(response.url), "Redirect left approved official sources")
                body = response.read()
                receipt = {
                    "url": url, "effective_url": response.url, "retrieved_at": now(),
                    "last_modified": response.headers.get("Last-Modified"),
                    "content_type": response.headers.get("Content-Type"),
                    "etag": response.headers.get("ETag"),
                    "sha256": digest(body), "bytes": len(body),
                    "file": str(path.relative_to(root)),
                }
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            write_json(receipt_path, receipt)
            path.with_name(path.name + ".transport.json").unlink(missing_ok=True)
            return body, receipt
        except (HTTPError, URLError, TimeoutError) as error:
            if isinstance(error, HTTPError) and error.code not in {429, 500, 502, 503, 504}:
                raise
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def condition(field, operator, value):
    return {"property": field, "operator": operator, "value": value}


def range_conditions(field, start, end):
    return [condition(field, ">=", start), condition(field, "<=", end)]


def required_partitions(dataset_id, foreign_ccns=()):
    primary = {
        "state": [condition("state", "=", "NJ")],
        "ccn_range": range_conditions(CCN, "310000", "319999"),
        "service_zip": range_conditions("zip_code", "07000", "08999"),
        "national": [],
    }[REGISTRY[dataset_id]["scope"]]
    partitions = {"primary": primary}
    if dataset_id == "m5eg-upu5":
        partitions["nj-offices"] = [condition("state", "=", "NJ")]
    if dataset_id in ("6jpm-sxkc", "ccn4-8vby"):
        partitions.update({
            "service-office-" + ccn: [condition(CCN, "=", ccn)]
            for ccn in sorted(foreign_ccns)
        })
    return partitions


def query_url(dataset_id, conditions, limit, offset, sorts=()):
    params = {"limit": limit, "offset": offset, "count": "true", "results": "true"}
    for index, item in enumerate(conditions):
        for key, value in item.items():
            params[f"conditions[{index}][{key}]"] = value
    for index, field in enumerate(sorts):
        params[f"sorts[{index}][property]"] = field
        params[f"sorts[{index}][order]"] = "asc"
    return f"{API}/datastore/query/{dataset_id}/0?" + urlencode(params)


def validate_page(page, conditions, limit, offset, expected_count=None, sorts=()):
    require(isinstance(page.get("results"), list), "Missing API results")
    count = page.get("count")
    require(isinstance(count, int) and count >= 0, "Missing integer API count")
    require(expected_count is None or count == expected_count, "API count changed during pagination")
    query = page.get("query", {})
    require(query.get("offset") == offset and query.get("limit") == limit, "API changed pagination")
    require(query.get("conditions", []) == conditions, "API did not echo requested filters")
    expected_sorts = [{"property": field, "order": "asc"} for field in sorts]
    require(query.get("sorts", []) == expected_sorts, "API did not echo requested ordering")
    require(len(page["results"]) == min(limit, max(0, count - offset)), "Truncated API page")
    for row in page["results"]:
        require(isinstance(row, dict), "API row is not an object")
        for item in conditions:
            value = row.get(item["property"])
            require(isinstance(value, str), "Missing text filter field")
            target, operator = item["value"], item["operator"]
            require(
                (operator == "=" and value == target)
                or (operator == ">=" and value >= target)
                or (operator == "<=" and value <= target),
                "API returned a row outside requested filters",
            )
        if CCN in row:
            require(isinstance(row[CCN], str) and re.fullmatch(r"\d{6}", row[CCN]),
                    "CCN must remain six-character text")
    return count


def pull(root, dataset_id, name, conditions, page_size):
    directory = root / "raw" / dataset_id / name
    probe_body, probe_receipt = fetch(
        query_url(dataset_id, conditions, 1, 0), directory / "probe.json", root, refresh=True)
    probe = json.loads(probe_body)
    expected = validate_page(probe, conditions, 1, 0)
    fields = list(next(iter(probe["schema"].values()))["fields"])
    sorts = fields if len(fields) <= 10 else [
        field for field in fields if field == CCN or re.search(
            r"measure_code|survey_date|type_of_survey|survey_cycle|inspection_cycle|"
            r"deficiency_tag|deficiency_prefix|penalty|fine_amount|payment_denial", field)
    ]
    require(sorts, "No stable source ordering fields")
    rows, pages = [], []
    for offset in range(0, max(1, expected), page_size):
        body, receipt = fetch(
            query_url(dataset_id, conditions, page_size, offset, sorts),
            directory / f"page-{offset:07d}.json", root)
        page = json.loads(body)
        validate_page(page, conditions, page_size, offset, expected, sorts)
        rows.extend(page["results"])
        pages.append({**receipt, "offset": offset, "rows": len(page["results"])})
    end_body, end_receipt = fetch(
        query_url(dataset_id, conditions, 1, 0), directory / "count-after.json", root, refresh=True)
    validate_page(json.loads(end_body), conditions, 1, 0, expected)
    require(len(rows) == expected, "Paginated count does not match API count")
    return rows, {
        "name": name, "conditions": conditions, "sorts": sorts, "page_size": page_size,
        "expected_count": expected, "retrieved_rows": len(rows), "complete": True,
        "probe": probe_receipt, "count_after": end_receipt, "pages": pages,
    }


def crosswalk_rows(body):
    namespace = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(item.itertext()) for item in
                      ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", namespace)]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        headers = None
        result = []
        for row in sheet.findall(".//s:sheetData/s:row", namespace):
            cells = {}
            for cell in row.findall("s:c", namespace):
                column = re.match(r"[A-Z]+", cell.attrib["r"])[0]
                value = cell.find("s:v", namespace)
                text = value.text if value is not None else ""
                if cell.attrib.get("t") == "s":
                    text = shared[int(text)]
                elif cell.attrib.get("t") == "inlineStr":
                    text = "".join(cell.find("s:is", namespace).itertext())
                cells[column] = text
            if headers is None:
                headers = {column: value.strip().lower() for column, value in cells.items()}
                require("county" in headers.values() and "zip" in headers.values(),
                        "Unexpected CMS-hosted HUD crosswalk columns")
                continue
            record = {headers[column]: value for column, value in cells.items() if column in headers}
            if record.get("county") and record.get("zip"):
                record["county"] = record["county"].zfill(5)
                record["zip"] = record["zip"].zfill(5)
                result.append(record)
        return result


def service_edges(rows, crosswalk):
    by_zip = defaultdict(set)
    for record in crosswalk:
        by_zip[record["zip"]].add(record["county"])
    names = {fips: name for name, fips in COUNTIES.items()}
    edges = []
    for row in rows:
        counties = sorted(by_zip.get(row["zip_code"], set()))
        target = [names[fips] for fips in counties if fips in names]
        if target:
            edges.append({
                "ccn": row[CCN], "office_state": row["state"], "service_zip": row["zip_code"],
                "crosswalk_county_fips": counties, "target_county_candidates": target,
                "county": target[0] if len(counties) == 1 else None,
                "county_status": "single_county_zip_2025Q3" if len(counties) == 1
                else "ambiguous_zip_not_assigned",
                "source_dataset_id": "m5eg-upu5",
                "crosswalk_artifact": "raw/reference/COUNTY_ZIP_092025.xlsx",
                "meaning": "CMS-reported service ZIP; not countywide service or current availability",
            })
    return sorted(edges, key=lambda row: (row["ccn"], row["service_zip"]))


def unique_rows(rows):
    seen = set()
    result = []
    for row in rows:
        key = json.dumps(row, sort_keys=True)
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result


def county_counts(rows, roster):
    county_by_ccn = {row[CCN]: row["countyparish"] for row in roster}
    counts = Counter(county_by_ccn.get(row.get(CCN)) for row in rows)
    return {county: counts[county] for county in COUNTIES}


def derive(datasets, crosswalk):
    nursing = datasets["4pq5-n9py"]
    target = [row for row in nursing if row["countyparish"] in COUNTIES]
    home_health = [
        {"ccn": row[CCN], "office_state": row["state"], "office_county": None,
         "office_county_status": "unknown_not_in_cms_home_health_schema",
         "source_dataset_id": "6jpm-sxkc", "raw": row}
        for row in datasets["6jpm-sxkc"]
    ]
    edges = service_edges(datasets["m5eg-upu5"], crosswalk)
    target_ccns = {row[CCN] for row in target}
    report = {
        "nursing_nj": len(nursing), "nursing_target": len(target),
        "nursing_counties": dict(Counter(row["countyparish"] for row in target)),
        "home_health_nj_offices": sum(row["office_state"] == "NJ" for row in home_health),
        "home_health_other_state_offices": sum(row["office_state"] != "NJ" for row in home_health),
        "home_health_unknown_office_county": len(home_health),
        "service_zip_target_candidate_edges": len(edges),
        "service_zip_unambiguous_edges": sum(row["county"] is not None for row in edges),
        "service_zip_ambiguous_edges": sum(row["county"] is None for row in edges),
        "home_health_unmatched_service_ccns": sorted(
            {row[CCN] for row in datasets["m5eg-upu5"]}
            - {row[CCN] for row in datasets["6jpm-sxkc"]}),
        "service_zip_counties": {
            county: {"edges": sum(row["county"] == county for row in edges),
                     "agencies": len({row["ccn"] for row in edges if row["county"] == county})}
            for county in COUNTIES
        },
        "evidence": {},
    }
    for dataset_id, spec in REGISTRY.items():
        rows = datasets[dataset_id]
        report["evidence"][dataset_id] = {
            "role": spec["role"], "retained_rows": len(rows),
            "target_nursing_rows": sum(row.get(CCN) in target_ccns for row in rows)
            if spec["family"] == "nursing" else None,
            "county_rows_via_roster_ccn": county_counts(rows, nursing)
            if spec["family"] == "nursing" and any(CCN in row for row in rows) else None,
            "active_target_ccns_without_source_rows": sorted(
                target_ccns - {row.get(CCN) for row in rows})
            if spec["family"] == "nursing" and any(CCN in row for row in rows) else None,
        }
    nursing_evidence = {key: [row for row in datasets[key] if row.get(CCN) in target_ccns]
                        for key, spec in REGISTRY.items()
                        if spec["family"] == "nursing" and spec["scope"] != "national"}
    return {"nursing_roster": target, "home_health_roster": home_health,
            "home_health_service_zip_edges": edges, "nursing_evidence": nursing_evidence,
            "coverage": report}


def release_check(metadata):
    families = {}
    for dataset_id, spec in REGISTRY.items():
        item = metadata[dataset_id]
        require(item.get("released") and item.get("modified"), "Missing source release dates")
        require(item["modified"] <= item["released"], "Modified date is after release")
        families.setdefault(spec["family"], set()).add(item["released"])
    require(all(len(releases) == 1 for releases in families.values()),
            "Inconsistent release dates within a source family")
    return {family: sorted(releases) for family, releases in families.items()}


def collect(root, page_size):
    require(not (root / "manifest.json").exists(),
            "Output already has a manifest. Use a new --output directory to preserve the prior run.")
    root.mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version": 1, "started_at": now(), "status": "collecting",
                "target_counties": COUNTIES, "registry": REGISTRY, "sources": {}, "references": []}
    write_json(root / "manifest.partial.json", manifest)
    body, manifest["catalog"] = fetch(CATALOG, root / "raw/catalog.json", root, refresh=True)
    catalog = {item["identifier"]: item for item in json.loads(body)}
    relevant = [item for item in catalog.values()
                if any(re.search("Nursing homes|Home health", theme, re.I)
                       for theme in item.get("theme", []))]
    write_json(root / "catalog-discovery.json", [
        {"id": item["identifier"], "title": item["title"], "released": item.get("released"),
         "modified": item.get("modified"), "collected": item["identifier"] in REGISTRY,
         "reason": "Selected evidence registry" if item["identifier"] in REGISTRY
         else "Not selected: ownership, benchmarks, swing beds or separate value-based payment program"}
        for item in relevant
    ])
    cross_body, cross_receipt = fetch(
        CROSSWALK_BASE + "/staging/2025/COUNTY_ZIP_092025.xlsx",
        root / "raw/reference/COUNTY_ZIP_092025.xlsx", root)
    manifest["references"].append({**cross_receipt, "role": "zip_county_crosswalk",
                                   "vintage": "2025Q3", "revision": REVISION,
                                   "released": None, "modified": None})
    for filename in ("README.md", "DEVELOPMENT.md"):
        _, receipt = fetch(CROSSWALK_BASE + "/" + filename,
                           root / "raw/reference" / filename, root)
        manifest["references"].append({**receipt, "role": "crosswalk_provenance"})
    crosswalk_path = root / "crosswalk.json"
    if crosswalk_path.exists():
        cached = json.loads(crosswalk_path.read_text())
        require(cached["source_sha256"] == digest(cross_body), "Crosswalk cache source changed")
        crosswalk = cached["rows"]
    else:
        crosswalk = [row for row in crosswalk_rows(cross_body) if "07000" <= row["zip"] <= "08999"]
        write_json(crosswalk_path, {"source_sha256": digest(cross_body), "rows": crosswalk})
    target_zips = {row["zip"] for row in crosswalk if row["county"] in COUNTIES.values()}
    require(target_zips and all("07000" <= code <= "08999" for code in target_zips),
            "Target crosswalk ZIPs extend beyond the collection range")
    datasets, metadata, dictionary_urls = {}, {}, set()
    for dataset_id, spec in REGISTRY.items():
        print(f"Collecting {dataset_id} {spec['role']}", flush=True)
        metadata_path = root / "raw" / dataset_id / "metadata.json"
        if metadata_path.exists():
            require(json.loads(metadata_path.read_text()) == catalog[dataset_id],
                    "Cached source release changed. Collect into a new --output directory.")
        body, metadata_receipt = fetch(CATALOG + "/" + dataset_id,
                                      metadata_path, root, refresh=True)
        item = metadata[dataset_id] = json.loads(body)
        require(item == catalog[dataset_id], "Catalog and per-ID metadata differ")
        for distribution in item.get("distribution", []):
            if distribution.get("describedBy"):
                dictionary_urls.add(distribution["describedBy"])
        conditions = required_partitions(dataset_id)["primary"]
        rows, partition = pull(root, dataset_id, "primary", conditions, page_size)
        partitions = [partition]
        if dataset_id == "m5eg-upu5":
            nj_rows, nj_partition = pull(
                root, dataset_id, "nj-offices", [condition("state", "=", "NJ")], page_size)
            rows = unique_rows(rows + nj_rows)
            partitions.append(nj_partition)
        datasets[dataset_id] = rows
        manifest["sources"][dataset_id] = {
            **spec, "title": item["title"], "metadata_url": CATALOG + "/" + dataset_id,
            "landing_url": item["landingPage"], "distribution": item["distribution"],
            "modified": item["modified"], "released": item["released"],
            "retrieved_at": metadata_receipt["retrieved_at"], "metadata": metadata_receipt,
            "partitions": partitions, "retained_rows": len(rows), "complete": True,
        }
        write_json(root / "manifest.partial.json", manifest)
    foreign_ccns = sorted({row[CCN] for row in datasets["m5eg-upu5"] if row["state"] != "NJ"})
    for dataset_id in ("6jpm-sxkc", "ccn4-8vby"):
        for ccn in foreign_ccns:
            rows, partition = pull(root, dataset_id, "service-office-" + ccn,
                                   [condition(CCN, "=", ccn)], page_size)
            datasets[dataset_id].extend(rows)
            manifest["sources"][dataset_id]["partitions"].append(partition)
        manifest["sources"][dataset_id]["retained_rows"] = len(datasets[dataset_id])
    for index, url in enumerate(sorted(dictionary_urls)):
        _, receipt = fetch(url, root / "raw/reference" / f"dictionary-{index}.payload", root)
        manifest["references"].append({**receipt, "role": "data_dictionary_and_footnotes"})
    manifest["release_consistency"] = release_check(metadata)
    for dataset_id, item in metadata.items():
        body, receipt = fetch(CATALOG + "/" + dataset_id,
                              root / "raw" / dataset_id / "metadata-after.json", root, refresh=True)
        require(json.loads(body) == item, "Source metadata changed during collection")
        manifest["sources"][dataset_id]["metadata_after"] = receipt
        write_json(root / "datasets" / f"{dataset_id}.json", datasets[dataset_id])
    derived = derive(datasets, crosswalk)
    edges = derived["home_health_service_zip_edges"]
    for dataset_id, source in manifest["sources"].items():
        if source["family"] == "nursing":
            source["county_coverage"] = derived["coverage"]["evidence"][dataset_id][
                "county_rows_via_roster_ccn"]
        else:
            ccns = {row.get(CCN) for row in datasets[dataset_id]}
            source["county_coverage"] = {
                county: {"office_county": "unknown_not_in_source",
                         "ccns_with_single_county_service_zip": len({
                             edge["ccn"] for edge in edges
                             if edge["county"] == county and edge["ccn"] in ccns})}
                for county in COUNTIES
            }
    for name, value in derived.items():
        write_json(root / f"{name}.json", value)
    manifest["gaps"] = [
        "Home-health office county is absent from CMS PDC. Root office counties remain unknown; see the separately collected pos/ supplement for source county codes and exact-CCN reconciliation.",
        "ZIP county crosswalk is CMS-hosted HUD 2025Q3, not a 2026 service-area boundary.",
        "Multi-county ZIPs are candidates only, never assigned as exact service counties.",
        "Single-county ZIP association does not establish countywide service or current acceptance.",
        "Office state in service ZIP records is not a restriction on service geography.",
        "No PDC standalone daily PBJ dataset was found. Provider Information retains PBJ-derived staffing, turnover, ratings and all footnotes; daily PBJ records are not collected.",
        "PDC citations and penalties are bounded reporting windows, not lifetime histories or original survey statements.",
        "CCN-range pulls cover New Jersey certification numbers, including records absent from the active roster. No brand matching.",
        "Suppression markers, blank values, footnotes, abuse and special-focus warnings are retained without reinterpretation.",
    ]
    manifest["completed_at"] = now()
    manifest["status"] = "complete"
    if (root / "pending-request.json").exists():
        (root / "pending-request.json").unlink()
    manifest["artifacts"] = [
        {"file": str(path.relative_to(root)), "sha256": digest(path.read_bytes()),
         "bytes": path.stat().st_size}
        for path in sorted([
            *(path for directory in ("raw", "datasets")
              for path in (root / directory).rglob("*") if path.is_file()),
            *(root / name for name in ("catalog-discovery.json", "crosswalk.json")),
            *(root / (name + ".json") for name in derived),
        ])
    ]
    write_json(root / "manifest.json", manifest)
    (root / "manifest.partial.json").unlink()
    report = verify(root)
    write_json(root / "verification.json", report)
    print(json.dumps(report, indent=2), flush=True)


def verify_receipt(root, receipt):
    path = root / receipt["file"]
    require(path.is_relative_to(root) and ".." not in path.parts, "Artifact path escapes output")
    body = path.read_bytes()
    require(digest(body) == receipt["sha256"], f"SHA256 mismatch: {path}")
    require(len(body) == receipt["bytes"], f"Byte count mismatch: {path}")
    if "url" in receipt:
        require(official_url(receipt["url"]) and official_url(receipt["effective_url"]),
                "Nonofficial source URL")
        require(bool(receipt["retrieved_at"]), "Missing retrieval timestamp")
    return body


def verify(root):
    root = root.resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    require(manifest["status"] == "complete", "Collection is incomplete")
    require(manifest["registry"] == REGISTRY and manifest["target_counties"] == COUNTIES,
            "Registry or county scope differs")
    require(manifest["sources"].keys() == REGISTRY.keys(), "Source registry IDs differ")
    for dataset_id, spec in REGISTRY.items():
        source = manifest["sources"][dataset_id]
        require(all(source.get(key) == value for key, value in spec.items()),
                f"Source registry role, family or scope differs: {dataset_id}")
        partitions = source["partitions"]
        names = [partition["name"] for partition in partitions]
        require(len(names) == len(set(names)), f"Duplicate partition: {dataset_id}")
        expected = required_partitions(dataset_id, {
            name.removeprefix("service-office-") for name in names
            if re.fullmatch(r"service-office-\d{6}", name)
        })
        require({part["name"]: part["conditions"] for part in partitions} == expected,
                f"Required partition coverage or filters differ: {dataset_id}")
        for partition in partitions:
            size = partition["page_size"]
            require(type(size) is int and 1 <= size <= 5000,
                    "Page size must be an integer between 1 and 5000")
    for receipt in manifest["artifacts"]:
        verify_receipt(root, receipt)
    catalog = {item["identifier"]: item for item in
               json.loads(verify_receipt(root, manifest["catalog"]))}
    datasets, metadata = {}, {}
    pages_checked = 0
    for dataset_id, spec in REGISTRY.items():
        source = manifest["sources"][dataset_id]
        item = json.loads(verify_receipt(root, source["metadata"]))
        metadata[dataset_id] = item
        require(item == catalog[dataset_id], "Catalog metadata does not match per-ID metadata")
        require(item == json.loads(verify_receipt(root, source["metadata_after"])),
                "Source changed during collection")
        require(source["released"] == item["released"] and source["modified"] == item["modified"],
                "Release dates differ from raw metadata")
        require(source["complete"] is True, "Incomplete source")
        records = []
        for partition in source["partitions"]:
            conditions, size = partition["conditions"], partition["page_size"]
            expected = partition["expected_count"]
            for key in ("probe", "count_after"):
                require(partition[key]["url"] == query_url(dataset_id, conditions, 1, 0),
                        f"Partition request URL differs: {dataset_id}/{partition['name']}/{key}")
                validate_page(json.loads(verify_receipt(root, partition[key])),
                              conditions, 1, 0, expected)
            rows = []
            offsets = list(range(0, max(1, expected), size))
            require([page["offset"] for page in partition["pages"]] == offsets,
                    "Missing or repeated page offsets")
            for receipt in partition["pages"]:
                require(receipt["url"] == query_url(
                    dataset_id, conditions, size, receipt["offset"], partition["sorts"]),
                    f"Partition request URL differs: {dataset_id}/{partition['name']}/page")
                page = json.loads(verify_receipt(root, receipt))
                validate_page(page, conditions, size, receipt["offset"], expected, partition["sorts"])
                require(receipt["rows"] == len(page["results"]), "Page receipt count mismatch")
                rows.extend(page["results"])
                pages_checked += 1
            require(len(rows) == expected == partition["retrieved_rows"], "Incomplete pagination")
            require(partition["complete"] is True, "Incomplete partition")
            records.extend(rows)
        if dataset_id == "m5eg-upu5":
            records = unique_rows(records)
        saved = json.loads((root / "datasets" / f"{dataset_id}.json").read_text())
        require(records == saved, f"Raw page projection differs: {dataset_id}")
        require(len(records) == source["retained_rows"], "Source row count mismatch")
        datasets[dataset_id] = records
    foreign_ccns = {row[CCN] for row in datasets["m5eg-upu5"] if row["state"] != "NJ"}
    partitions_checked = 0
    for dataset_id in REGISTRY:
        expected = required_partitions(dataset_id, foreign_ccns)
        actual = {partition["name"]: partition["conditions"]
                  for partition in manifest["sources"][dataset_id]["partitions"]}
        require(actual == expected, f"Required partition coverage or filters differ: {dataset_id}")
        partitions_checked += len(expected)
    require(release_check(metadata) == manifest["release_consistency"], "Release report mismatch")
    cross_receipt = next(item for item in manifest["references"]
                         if item["role"] == "zip_county_crosswalk")
    crosswalk = crosswalk_rows(verify_receipt(root, cross_receipt))
    require(json.loads((root / "crosswalk.json").read_text()) == {
        "source_sha256": cross_receipt["sha256"],
        "rows": [row for row in crosswalk if "07000" <= row["zip"] <= "08999"],
    }, "Crosswalk projection differs from official workbook")
    for receipt in manifest["references"]:
        verify_receipt(root, receipt)
    derived = derive(datasets, crosswalk)
    for name, expected in derived.items():
        require(json.loads((root / f"{name}.json").read_text()) == expected,
                f"Derived artifact differs: {name}")
    roster_ccns = {row[CCN] for row in datasets["6jpm-sxkc"]}
    services = datasets["m5eg-upu5"]
    require({row[CCN] for row in services} <= roster_ccns, "Service ZIP has no exact-CCN roster record")
    return {"status": "passed", "checked_at": now(), "datasets_checked": len(REGISTRY),
            "required_partitions_checked": partitions_checked,
            "service_office_ccns_checked": sorted(foreign_ccns),
            "api_pages_checked": pages_checked, "hashes_checked": len(manifest["artifacts"]),
            "release_consistency": manifest["release_consistency"], **derived["coverage"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("collect", "verify"))
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--page-size", type=int, default=1000)
    args = parser.parse_args()
    require(1 <= args.page_size <= 5000, "Page size must be between 1 and 5000")
    if args.command == "collect":
        collect(args.output.resolve(), args.page_size)
    else:
        print(json.dumps(verify(args.output), indent=2))


if __name__ == "__main__":
    main()
