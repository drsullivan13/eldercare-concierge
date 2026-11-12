#!/usr/bin/env python3
"""Reconcile the fixed North Jersey Facebook assignments to current market application IDs."""

import argparse
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
normalizer_spec = importlib.util.spec_from_file_location("normalize_nj", ROOT / "scripts/regions/normalize-nj.py")
normalizer = importlib.util.module_from_spec(normalizer_spec)
normalizer_spec.loader.exec_module(normalizer)
RESEARCH = ROOT / "research/north-jersey"
APP_CATALOG = ROOT / "src/data/regional-markets.json"
IMPORTER = ROOT / "src/lib/research-pipeline/import.ts"
OUTPUT = RESEARCH / "facebook/kit"
MARKET = "north-jersey"
ASSIGNMENT_COUNT = 20
FACILITY_CSV = "facebook/first-facility-assignments.csv"
CAMPUS_OFFICE_CSV = "facebook/campus-and-office-assignments.csv"
KIT_COLUMNS = ("provider_id", "assignment_id", "name", "care_category", "address", "city", "state", "zip")
PUBLISHED_FIELDS = ("name", "category", "address", "city", "state", "zip")
CATEGORY_BY_SETTING = {
    "ASSISTED LIVING RESIDENCE": "assisted-living",
    "COMPREHENSIVE PERSONAL CARE HOME": "assisted-living",
    "LONG TERM CARE FACILITY SNF/NF": "nursing-home",
}
DOH_SOURCE = "NJ DOH All_LTC"
HP_SOURCE = "NJ HP registry"
CCRC_SOURCE = "NJ DCA historical CCRC directory"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


class Unresolved(Exception):
    def __init__(self, reason, detail, candidate=None):
        super().__init__(detail)
        self.reason, self.detail, self.candidate = reason, detail, candidate


def require(condition, reason, detail, candidate=None):
    if not condition:
        raise Unresolved(reason, detail, candidate)


def single(rows, what, detail):
    require(rows, f"{what}_missing", f"No {detail}.")
    require(len(rows) == 1, f"{what}_ambiguous", f"{len(rows)} candidates for {detail}.")
    return rows[0]


def clean(value):
    return " ".join(str(value or "").split())


def same(a, b):
    return clean(a).upper() == clean(b).upper()


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def workbook_rows(body):
    with ZipFile(io.BytesIO(body)) as archive:
        names = archive.namelist()
        shared = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))] \
            if "xl/sharedStrings.xml" in names else []
        sheets = [name for name in names if re.fullmatch(r"xl/worksheets/[^/]+\.xml", name)]
        if len(sheets) != 1:
            raise ValueError("Expected exactly one worksheet.")
        records = []
        for row in ET.fromstring(archive.read(sheets[0])).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row:
                value = cell.findtext("s:v", "", NS)
                if cell.get("t") == "s":
                    value = shared[int(value)]
                elif cell.get("t") == "inlineStr":
                    value = "".join(cell.find("s:is", NS).itertext())
                cells[re.sub(r"\d", "", cell.attrib["r"])] = value
            records.append((int(row.attrib["r"]), cells))
    headers = records[0][1]
    return [{"source_row": number, **{name: cells.get(col, "") for col, name in headers.items()}}
            for number, cells in records[1:] if any(cells.values())]


def importer_columns(text, name):
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", text, re.S)
    if not match:
        raise ValueError(f"Importer does not declare {name}.")
    return re.findall(r'"([a-z_]+)"', match.group(1))


class Reader:
    def __init__(self, research):
        self.research = research
        self.hashes = {}

    def bytes(self, relative):
        data = (self.research / relative).read_bytes()
        self.hashes[relative] = sha256(data)
        return data

    def json(self, relative):
        return json.loads(self.bytes(relative))

    def receipted(self, relative):
        data = self.bytes(relative)
        if self.json(relative + ".json")["sha256"] != self.hashes[relative]:
            raise ValueError(f"Retained source does not match its receipt: {relative}")
        return data

    def pages(self, pattern):
        return {path.relative_to(self.research).as_posix(): self.json(path.relative_to(self.research).as_posix())
                for path in sorted(self.research.glob(pattern)) if re.fullmatch(r"[a-z]+-\d+\.json", path.name)}


def parse_assignments(reader):
    assignments = []
    for relative in (FACILITY_CSV, CAMPUS_OFFICE_CSV):
        text = reader.bytes(relative).decode("utf-8")
        for number, row in enumerate(csv.DictReader(io.StringIO(text)), start=2):
            aid = row["assignment_id"]
            kind = next((k for k in KINDS if aid.startswith(k.prefix)), None)
            if kind is None:
                raise ValueError(f"Unknown assignment kind: {aid}")
            official = aid[len(kind.prefix):]
            facility = relative == FACILITY_CSV
            assignment = {
                "assignmentId": aid,
                "kind": kind.name,
                "file": relative,
                "row": number,
                "officialId": row["nj_facility_id"] if facility else (None if kind.name == "ccrc_campus" else official),
                "license": row.get("license"),
                "name": row["licensed_name" if facility else "source_name"],
                "address": row["address_as_published" if facility else "source_address"],
                "municipality": row["municipality"],
                "zip": row["zip"],
                "county": row["county"],
                "setting": row["licensed_care_setting" if facility else "scope"],
                "identityBasis": row.get("identity_basis"),
                "sourceUrl": row["source_url"],
            }
            if facility and assignment["officialId"] != official:
                raise ValueError(f"Assignment ID disagrees with facility ID: {aid}")
            if kind.name in ("registered_office", "cms_home_health_office") and official not in row["identity_basis"]:
                raise ValueError(f"Assignment ID disagrees with identity basis: {aid}")
            assignments.append({k: v for k, v in assignment.items() if v is not None})
    ids = [a["assignmentId"] for a in assignments]
    if len(ids) != ASSIGNMENT_COUNT or len(set(ids)) != len(ids):
        raise ValueError(f"Expected {ASSIGNMENT_COUNT} unique fixed assignments, found {len(set(ids))} of {len(ids)}.")
    return assignments


def load(research, app_catalog):
    reader = Reader(research)
    assignments = parse_assignments(reader)
    markets = [m for m in reader.json("runtime-manifest.json").get("markets", []) if m.get("id") == MARKET]
    if len(markets) != 1:
        raise ValueError("Runtime manifest must contain exactly one North Jersey market.")
    market = markets[0]
    providers_path = "runtime/providers.json"
    providers = reader.json(providers_path)
    if reader.hashes[providers_path] != market["artifacts"]["providers"]["sha256"]:
        raise ValueError("runtime/providers.json does not match runtime-manifest.json; rerun after the NJ release completes.")
    crosswalk = reader.json("runtime/crosswalk.json")
    home_health = reader.json("runtime/home-health-release-inputs.json")
    ltc = workbook_rows(reader.receipted("state/raw/ltc.xlsx"))
    firms = workbook_rows(reader.receipted("state/raw/firms.xlsx"))
    reader.receipted("state/raw/ccrc.pdf")
    ccrc = {path.relative_to(research).as_posix(): reader.json(path.relative_to(research).as_posix())
            for path in sorted(research.glob("state/*/ccrc-campuses.json"))}
    cms_nursing = {}
    for dataset in sorted({r["cmsDataset"] for r in crosswalk if r.get("cmsDataset")}):
        index = cms_nursing.setdefault(dataset, {})
        for relative, page in reader.pages(f"cms/raw/{dataset}/primary/page-*.json").items():
            for number, row in enumerate(page["results"]):
                index.setdefault(row["cms_certification_number_ccn"], []).append(
                    {"row": row, "file": relative, "rowIndex": number, "sha256": reader.hashes[relative]})
    snapshot = "cms/pos/" + reader.json("cms/pos/latest.json")["snapshot"]
    pos, pdc = {}, {}
    for page in reader.pages(f"{snapshot}/raw/home_health/pos-*.json").values():
        for row in page:
            pos.setdefault(row["prvdr_num"], []).append(row)
    for page in reader.pages(f"{snapshot}/raw/home_health/pdc-*.json").values():
        for row in page["results"]:
            pdc.setdefault(row["cms_certification_number_ccn"], []).append(row)
    published_bytes = app_catalog.read_bytes()
    published = {}
    for registered in json.loads(published_bytes):
        if registered.get("id") == MARKET:
            published = {p["id"]: p for p in registered["providers"]}
    return assignments, {
        "providers": {p["id"]: p for p in providers},
        "published": published,
        "crosswalk": crosswalk,
        "homeHealthCrosswalk": home_health.get("crosswalk", []),
        "homeHealthStatus": home_health.get("status"),
        "ltc": {row["FacID"]: row for row in ltc},
        "firms": {row["source_row"]: row for row in firms},
        "ccrc": ccrc,
        "cmsNursing": cms_nursing,
        "pos": pos,
        "pdc": pdc,
        "posSnapshot": snapshot,
        "hashes": reader.hashes,
        "appCatalogSha256": sha256(published_bytes),
    }


def runtime_provider(data, pid, category, a, zip_code, ccn):
    provider = data["providers"].get(pid)
    require(provider, "runtime_provider_missing", f"{pid} is not in runtime/providers.json.", pid)
    require(provider["category"] == category, "runtime_category_mismatch",
            f"{pid} is {provider['category']}, assignment setting requires {category}.", pid)
    require(same(provider["address"], a["address"]) and same(provider["city"], a["municipality"])
            and provider["zip"] == zip_code, "runtime_address_mismatch",
            f"{pid} is at {provider['address']}, {provider['city']} {provider['zip']}.", pid)
    runtime_ccn = (provider.get("cms") or {}).get("ccn")
    require(runtime_ccn == ccn, "runtime_cms_identity_mismatch",
            f"{pid} CMS CCN is {runtime_ccn}, expected {ccn}.", pid)


def resolve_licensed_unit(a, data):
    facid = a["officialId"]
    row = single([r for r in data["crosswalk"] if r.get("source") == DOH_SOURCE
                  and r.get("officialId") == facid and r.get("status") == "included"],
                 "crosswalk", f"included DOH crosswalk row for {facid}")
    identity = (a["license"], a["name"], a["setting"], a["county"])
    require((row["license"], row["licensedName"], row["licensedSetting"], row["county"]) == identity,
            "crosswalk_identity_mismatch", f"Crosswalk license, name, setting or county differs for {facid}.")
    sha = data["hashes"]["state/raw/ltc.xlsx"]
    require(row["sourceFile"] == "state/raw/ltc.xlsx" and row["sourceSha256"] == sha, "source_hash_mismatch",
            "Crosswalk does not cite the retained DOH workbook bytes.")
    raw = data["ltc"].get(facid)
    require(raw and raw["source_row"] == row["sourceRow"], "state_source_row_missing",
            f"Retained DOH workbook row {row['sourceRow']} is not {facid}.")
    require((raw["LIC#"], raw["LICENSED_NAME"], raw["FACILITY_TYPE"], raw["COUNTY"].title()) == identity,
            "state_source_identity_mismatch", f"Retained DOH row differs from the assignment for {facid}.")
    require(clean(raw["ADDRESS"]) == a["address"] and raw["ZIP"][:5] == a["zip"],
            "state_source_address_mismatch", f"Retained DOH address is {clean(raw['ADDRESS'])}.")
    category = CATEGORY_BY_SETTING.get(a["setting"])
    require(category, "setting_without_category", f"No runtime category for {a['setting']}.")
    evidence = {"crosswalk": {"source": DOH_SOURCE, "sourceRow": row["sourceRow"]},
                "stateSource": {"file": "state/raw/ltc.xlsx", "row": raw["source_row"], "sha256": sha}}
    ccn = row.get("cmsCcn")
    if ccn:
        pid = f"cms-{ccn}"
        require(category == "nursing-home", "cms_category_mismatch",
                f"{facid} is licensed as {category}, not a nursing home.")
        require(row.get("cmsMatchBasis") == "unique_nursing_unit_normalized_name_street_and_zip",
                "cms_match_basis_unverified", f"{facid} does not have the authoritative exact nursing-unit match basis.")
        require(row["providerId"] == pid, "cms_link_unverified", f"CCN {ccn} crosswalks to {row['providerId']}.")
        dataset = row.get("cmsDataset")
        require(dataset == "4pq5-n9py", "cms_link_unverified", f"{dataset} is not CMS nursing home provider information.")
        source = single(data["cmsNursing"].get(dataset, {}).get(ccn, []), "cms_source_row",
                        f"retained CMS {dataset} row for CCN {ccn}")
        reference = {"cmsSourceFile": source["file"], "cmsSourceRowIndex": source["rowIndex"],
                     "cmsSourceSha256": source["sha256"]}
        if any(key in row for key in reference):
            require(all(row.get(key) == value for key, value in reference.items()), "cms_source_provenance_mismatch",
                    f"CCN {ccn} crosswalk does not cite the retained CMS file, row index and bytes.", pid)
        cms = source["row"]
        require(cms["cms_certification_number_ccn"] == ccn, "cms_link_unverified",
                f"Retained CMS row is not CCN {ccn}.", pid)
        licensed_name = re.sub(r"\s*\(" + re.escape(facid) + r"\)$", "", raw["LICENSED_NAME"])
        require(row.get("cmsName") == cms["provider_name"]
                and normalizer.name_key(licensed_name) == normalizer.name_key(cms["provider_name"]),
                "cms_name_mismatch", f"CMS CCN {ccn} name differs from the licensed unit or crosswalk.", pid)
        require(row.get("cmsAddress") == cms["provider_address"]
                and same(cms["provider_address"], raw["ADDRESS"].splitlines()[0])
                and same(cms["citytown"], raw["FAC_CITY"]) and same(cms["citytown"], a["municipality"])
                and cms["state"] == "NJ" and cms["zip_code"] == a["zip"], "cms_address_mismatch",
                f"CMS CCN {ccn} is at {cms['provider_address']}, {cms['citytown']}, {cms['state']} {cms['zip_code']}.", pid)
        evidence["cms"] = {"dataset": dataset, "ccn": ccn, "name": cms["provider_name"],
                           "address": cms["provider_address"], "city": cms["citytown"],
                           "state": cms["state"], "zip": cms["zip_code"], "matchBasis": row["cmsMatchBasis"],
                           **{key: source[key] for key in ("file", "rowIndex", "sha256")}}
        basis = "licensed_unit_cms_certified"
    else:
        pid = f"{MARKET}-doh-{slug(facid)}"
        require(row["providerId"] == pid, "provisional_id_unstable",
                f"Crosswalk ID {row['providerId']} is not the stable provisional ID {pid}.")
        basis = "licensed_unit_provisional"
    runtime_provider(data, pid, category, a, a["zip"], ccn)
    return pid, basis, evidence


def resolve_registered_office(a, data):
    reg = a["officialId"]
    row = single([r for r in data["crosswalk"] if r.get("source") == HP_SOURCE
                  and r.get("officialId") == reg and r.get("status") == "included"],
                 "crosswalk", f"included HP crosswalk row for {reg}")
    pid = f"{MARKET}-hp-{slug(reg)}"
    certified = row.get("cmsCcn") or row["providerId"].startswith("cms-") \
        or (data["providers"].get(row["providerId"]) or {}).get("cms")
    require(not certified, "registered_office_not_certified_agency",
            f"Registration {reg} must not resolve to the CMS-certified agency {row['providerId']}.")
    require(row["providerId"] == pid, "provisional_id_unstable",
            f"Crosswalk ID {row['providerId']} is not the stable registration ID {pid}.")
    require(row["county"] == a["county"], "crosswalk_identity_mismatch", f"Crosswalk county is {row['county']}.")
    sha = data["hashes"]["state/raw/firms.xlsx"]
    require(row["sourceSha256"] == sha, "source_hash_mismatch", "Crosswalk does not cite the retained HP export bytes.")
    raw = data["firms"].get(row["sourceRow"])
    require(raw and raw["License/Registration"] == reg, "state_source_row_missing",
            f"Retained HP export row {row['sourceRow']} is not {reg}.")
    require(raw["Business Name"] == a["name"], "state_source_identity_mismatch",
            f"Retained HP export name is {raw['Business Name']}.")
    require(raw["License Status"] == "Active", "registration_not_active", f"{reg} status is {raw['License Status']}.")
    require(clean(raw["Business Address"]) == a["address"] and same(raw["Business City"], a["municipality"])
            and raw["Business Zipcode"] == a["zip"], "state_source_address_mismatch",
            f"Retained HP address is {clean(raw['Business Address'])}, {raw['Business City']} {raw['Business Zipcode']}.")
    runtime_provider(data, pid, "home-care", a, a["zip"][:5], None)
    return pid, "registered_office", {
        "crosswalk": {"source": HP_SOURCE, "sourceRow": row["sourceRow"]},
        "stateSource": {"file": "state/raw/firms.xlsx", "row": raw["source_row"], "sha256": sha}}


def resolve_campus(a, data):
    county_file = f"state/{a['county'].lower()}/ccrc-campuses.json"
    listed = f"{a['address']}, {a['municipality']}, NJ {a['zip']}"
    record = single([r for r in data["ccrc"].get(county_file, []) if r["address"] == listed],
                    "state_campus_record", f"retained campus listing at {listed}")
    require(record["name"] == a["name"], "state_source_identity_mismatch", f"Campus listing name is {record['name']}.")
    sha = data["hashes"]["state/raw/ccrc.pdf"]
    page = record["source"]["pdf_page"]
    require(record["source"]["sha256"] == sha, "source_hash_mismatch", "Campus listing does not cite the retained guide bytes.")
    row = single([r for r in data["crosswalk"] if r.get("source") == CCRC_SOURCE and r.get("sourceFile") == county_file
                  and r.get("sourcePdfPage") == page and r.get("campusName") == record["name"]],
                 "crosswalk", f"campus crosswalk row for page {page} of the guide")
    require(row.get("status") == "included_historical", "campus_status_mismatch",
            "Campus crosswalk must be included as a historical listing.")
    require(row.get("officialId") is None, "campus_official_id_present",
            "A historical campus listing must not have an official care-unit ID.")
    pid = f"{MARKET}-campus-{slug(record['name'])}-{a['zip']}"
    require(not row.get("cmsCcn") and row["providerId"] == pid, "provisional_id_unstable",
            f"Crosswalk ID {row['providerId']} is not the stable campus ID {pid}.")
    require(row["sourceSha256"] == sha and row["county"] == a["county"], "crosswalk_identity_mismatch",
            "Campus crosswalk hash or county differs from the retained listing.")
    runtime_provider(data, pid, "life-plan", a, a["zip"], None)
    return pid, "historical_campus_listing", {
        "crosswalk": {"source": CCRC_SOURCE, "sourceFile": county_file, "pdfPage": page},
        "stateSource": {"file": "state/raw/ccrc.pdf", "pdfPage": page, "sha256": sha,
                        "sourceDate": record["source_date"]}}


def resolve_home_health(a, data):
    ccn = a["officialId"]
    pid = f"cms-{ccn}"
    for name, rows, street, city, zip_field in (("pos", data["pos"], "st_adr", "city_name", "zip_cd"),
                                                ("pdc", data["pdc"], "address", "citytown", "zip_code")):
        source = single(rows.get(ccn, []), f"cms_{name}_row", f"retained CMS {name.upper()} row for CCN {ccn}")
        require(same(source[street], a["address"]) and same(source[city], a["municipality"])
                and source[zip_field] == a["zip"], "cms_address_mismatch",
                f"CMS {name.upper()} office is {source[street]}, {source[city]} {source[zip_field]}.")
    rows = [r for r in data["crosswalk"] + data["homeHealthCrosswalk"] if r.get("cmsCcn") == ccn]
    mapped = sorted({r["providerId"] for r in rows})
    require(mapped, "crosswalk_missing", f"No crosswalk row for CCN {ccn}.")
    require(mapped == [pid], "crosswalk_identity_mismatch", f"CCN {ccn} crosswalks to {', '.join(mapped)}.")
    for row in rows:
        require(not row.get("sourceFile") or data["hashes"].get(row["sourceFile"]) == row.get("sourceSha256"),
                "source_hash_mismatch", f"Crosswalk for CCN {ccn} cites bytes other than the retained CMS snapshot.")
    statuses = sorted({r["status"] for r in rows})
    require(pid in data["providers"], "cms_agency_not_in_runtime_catalog",
            f"CMS office verified in POS and PDC, but {pid} is not in runtime/providers.json "
            f"(crosswalk status: {', '.join(statuses)}).", pid)
    runtime_provider(data, pid, "home-health", a, a["zip"], None)
    return pid, "cms_certified_agency", {"crosswalk": [{"source": r["source"], "status": r["status"]} for r in rows],
                                         "cmsSource": {"ccn": ccn, "snapshot": data["posSnapshot"]}}


class Kind:
    def __init__(self, prefix, name, resolve):
        self.prefix, self.name, self.resolve = prefix, name, resolve


KINDS = (
    Kind("nj-doh-", "licensed_care_unit", resolve_licensed_unit),
    Kind("nj-reg-", "registered_office", resolve_registered_office),
    Kind("nj-campus-", "ccrc_campus", resolve_campus),
    Kind("nj-hha-", "cms_home_health_office", resolve_home_health),
)
RESOLVERS = {kind.name: kind.resolve for kind in KINDS}


def resolve(a, data):
    try:
        pid, basis, evidence = RESOLVERS[a["kind"]](a, data)
        provider, published = data["providers"][pid], data["published"].get(pid)
        require(published, "not_in_published_app_catalog", f"{pid} is not in the published app catalog.", pid)
        require(all(published.get(f) == provider.get(f) for f in PUBLISHED_FIELDS), "published_app_record_mismatch",
                f"Published {pid} identity differs from runtime/providers.json.", pid)
        return {"status": "exact", "providerId": pid, "basis": basis, "evidence": evidence}
    except Unresolved as error:
        result = {"status": "unresolved", "reason": error.reason, "detail": error.detail}
        if error.candidate:
            result["candidateProviderId"] = error.candidate
        return result
    except (KeyError, TypeError, AttributeError, ValueError) as error:
        return {"status": "unresolved", "reason": "source_shape_invalid", "detail": f"{type(error).__name__}: {error}"}


def reconcile(assignments, data):
    results = [resolve(a, data) for a in assignments]
    shared = {}
    for result in results:
        if result["status"] == "exact":
            shared.setdefault(result["providerId"], []).append(result)
    for pid, group in shared.items():
        if len(group) > 1:
            for result in group:
                result.clear()
                result.update({"status": "unresolved", "reason": "provider_id_shared",
                               "detail": f"{len(group)} assignments resolve to {pid}.", "candidateProviderId": pid})
    return [{**a, "result": r} for a, r in zip(assignments, results)]


def csv_text(columns, rows=()):
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return buffer.getvalue()


def encode(value):
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def build(research=RESEARCH, app_catalog=APP_CATALOG, importer=IMPORTER):
    assignments, data = load(research, app_catalog)
    importer_text = importer.read_text("utf-8")
    observation_columns = importer_columns(importer_text, "OBSERVATION_COLUMNS")
    coverage_columns = importer_columns(importer_text, "COVERAGE_COLUMNS")
    records = reconcile(assignments, data)
    exact = [r for r in records if r["result"]["status"] == "exact"]
    kit_rows = []
    for record in exact:
        p = data["published"][record["result"]["providerId"]]
        kit_rows.append([p["id"], record["assignmentId"], p["name"], p["category"], p["address"], p["city"], p["state"], p["zip"]])
    ids = sorted(r["result"]["providerId"] for r in exact)
    reasons = {}
    for record in records:
        if record["result"]["status"] == "unresolved":
            reasons[record["result"]["reason"]] = reasons.get(record["result"]["reason"], 0) + 1
    manifest = {
        "schemaVersion": 1,
        "market": MARKET,
        "publication": "none",
        "purpose": "Exact identity reconciliation for the fixed Facebook research assignments. Contains no observations, coverage statuses or research findings.",
        "summary": {"assignments": len(records), "exact": len(exact), "unresolved": len(records) - len(exact),
                    "unresolvedReasons": reasons},
        "inputs": {"research": dict(sorted(data["hashes"].items())),
                   "appCatalogSha256": data["appCatalogSha256"],
                   "importerSha256": sha256(importer_text.encode())},
        "assignments": records,
    }
    return {
        "kit.csv": csv_text(KIT_COLUMNS, kit_rows),
        "assigned.json": encode({"geography": {"state": "NJ", "zips": sorted({row[-1] for row in kit_rows})},
                                 "providerIds": ids}),
        "assignment-manifest.json": encode(manifest),
        "observations.csv": csv_text(observation_columns),
        "coverage.csv": csv_text(coverage_columns),
    }


def write(output, files):
    output.mkdir(parents=True, exist_ok=True)
    changed = []
    for name, content in files.items():
        target = output / name
        if target.exists() and target.read_text("utf-8") == content:
            continue
        handle, temporary = tempfile.mkstemp(dir=output, prefix=f".{name}.", suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
                stream.write(content)
            os.chmod(temporary, 0o644)
            os.replace(temporary, target)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        changed.append(name)
    return changed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research", type=Path, default=RESEARCH)
    parser.add_argument("--app-catalog", type=Path, default=APP_CATALOG)
    parser.add_argument("--importer", type=Path, default=IMPORTER)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true", help="Compare generated bytes without writing.")
    args = parser.parse_args(argv)
    try:
        files = build(args.research, args.app_catalog, args.importer)
        summary = json.loads(files["assignment-manifest.json"])["summary"]
        if args.check:
            stale = [name for name, content in files.items()
                     if not (args.output / name).exists() or (args.output / name).read_text("utf-8") != content]
            if stale:
                print(f"facebook-kit: stale outputs: {', '.join(stale)}", file=sys.stderr)
                return 1
            changed = []
        else:
            changed = write(args.output, files)
    except (OSError, ValueError, KeyError) as error:
        print(f"facebook-kit: {error}", file=sys.stderr)
        return 1
    print(json.dumps({**summary, "changed": changed}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
