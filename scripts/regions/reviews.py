#!/usr/bin/env python3
"""Stage North Jersey consumer-review and provider-offering observations against frozen rosters.

Reads actual roster files and manually supplied, tool-checked observations. It never fetches
pages and never computes a score. See scripts/regions/reviews.md for the contract.
"""

import argparse
import csv
import hashlib
import io
import json
import math
import re
import shutil
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
REGION = Path("research/north-jersey")
TARGET_COUNTIES = ["union", "morris", "essex", "bergen", "hudson", "passaic"]
NJ_COUNTIES = {
    key: key.title() if key != "capemay" else "Cape May"
    for key in [
        "atlantic", "bergen", "burlington", "camden", "capemay", "cumberland", "essex",
        "gloucester", "hudson", "hunterdon", "mercer", "middlesex", "monmouth", "morris",
        "ocean", "passaic", "salem", "somerset", "sussex", "union", "warren",
    ]
}
CMS_DATASETS = {"4pq5-n9py": "nursing-home", "6jpm-sxkc": "home-health"}
CMS_EXPORTS = {"nursing-homes": "nursing-home", "home-health": "home-health"}
STATE_FILES = {
    "care-units.json": ("nj-doh", "licensed_care_unit"),
    "home-care-firms.json": ("nj-dca-hcsf", "home_care_firm_registration"),
    "ccrc-campuses.json": ("nj-dca-ccrc", "historical_ccrc_campus_listing"),
}
STATEWIDE_STATE_FILES = {"unresolved-home-care-counties.json": ("nj-dca-hcsf", "home_care_firm_registration")}
EXPLICIT_COUNTY_BASES = {"Explicit DOH source COUNTY field", "Explicit DCA directory county heading"}
DERIVED_COUNTY_BASES = {
    "NJ municipality name match", "NJ locality name match",
    "NJ municipality name match disambiguated by DOH city and ZIP county",
    "NJ locality name match disambiguated by DOH city and ZIP county",
}
FORBIDDEN_HOSTS = {"caring.com", "care-one.com", "seniorcare.com", "yelp.com"}
ALIASES = {
    "ccn": {"cmscertificationnumberccn", "cmscertificationnumber", "federalprovidernumber", "ccn"},
    "stateId": {
        "officialfacilityid", "officialregistrationid", "licensenumber", "licenseno", "stateid",
        "facilityid", "registrationnumber",
    },
    "name": {"providername", "facilityname", "name"},
    "street": {"provideraddress", "address", "streetaddress", "address1", "addressline1", "street"},
    "city": {"citytown", "providercity", "city", "municipality"},
    "state": {"state", "providerstate"},
    "zip": {"zipcode", "providerzipcode", "zip", "postalcode"},
    "county": {"countyparish", "providercountyname", "countyname", "county"},
    "setting": {"setting", "caresetting", "officialtype", "licensetype", "facilitytype"},
    "unit": {"unit", "careunit", "unitname"},
}
IDENTITY_FIELDS = ["name", "street", "city", "state", "zip", "county"]
STREET_WORDS = {
    "avenue": "ave", "av": "ave", "street": "st", "road": "rd", "drive": "dr",
    "boulevard": "blvd", "lane": "ln", "place": "pl", "court": "ct", "parkway": "pkwy",
    "highway": "hwy", "route": "rt", "rte": "rt", "terrace": "ter", "turnpike": "tpke",
    "north": "n", "south": "s", "east": "e", "west": "w", "suite": "ste", "mount": "mt",
}
# Mirrors familyFor in src/lib/experience-score.ts.
APFM_FAMILY = {"aplaceformom", "apfm", "senioradvisor", "senioradvisorcom"}
SEARCH_HOST = re.compile(r"(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|search\.brave\.com)$")
REVIEW_SOURCE_TYPES = {"review-platform", "public-discussion"}
PRICE_PERIODS = {"hour", "day", "week", "month", "year", "one-time"}
MIN_REPORTED_REVIEWS = 10
MAX_CHECKED_AGE_DAYS = 180
MAX_SNAPSHOT_AGE_DAYS = 365
INVENTORY_MEANING = "all-status/historical roster inventory, not a current-provider catalog"
OUTPUT_FILES = [
    "manifest.json", "roster.json", "observations.json", "candidates.json",
    "provider-facts.json", "leads.json", "coverage.json", "errors.json",
]


class InputError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def token(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def name_key(value, identifier=""):
    if identifier:
        value = re.sub(r"\s*\(" + re.escape(identifier) + r"\)\s*$", "", value)
    words = re.sub(r"[^a-z0-9]+", " ", value.lower().replace("&", " and ")).split()
    return "".join(word for word in words if word not in ("the", "inc", "llc"))


def street_key(value):
    # DOH care-unit addresses put city, state and ZIP on a second line.
    first_line = value.strip().splitlines()[0] if value.strip() else ""
    return " ".join(STREET_WORDS.get(word, word) for word in re.sub(r"[^a-z0-9]+", " ", first_line.lower()).split())


def county_key(value):
    key = token(value)
    return key[: -len("county")] if key.endswith("county") and key != "county" else key


def text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def parse_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def http_url(value):
    if not isinstance(value, str):
        return None
    try:
        parts = urlsplit(value)
        parts.port
        return parts if parts.scheme in ("http", "https") and parts.hostname else None
    except ValueError:
        return None


def host_key(value):
    if not isinstance(value, str):
        return None
    host = value.lower().rstrip(".")
    if len(host) > 253 or not all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")
    ):
        return None
    return host.removeprefix("www.")


def is_int(value):
    return type(value) is int


def is_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def county_order(key):
    return (0, TARGET_COUNTIES.index(key)) if key in TARGET_COUNTIES else (1, key or "~")


def read_table(path, data):
    try:
        body = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise InputError("parse-error", f"not UTF-8: {exc}")
    if path.suffix == ".csv":
        reader = csv.reader(io.StringIO(body, newline=""))
        try:
            header = next(reader, None)
            if not header:
                raise InputError("parse-error", "CSV has no header row")
            records = []
            for values in reader:
                if not values:
                    continue
                if len(values) != len(header):
                    raise InputError(
                        "parse-error",
                        f"line {reader.line_num} has {len(values)} fields; header has {len(header)}",
                    )
                records.append((reader.line_num, dict(zip(header, values))))
        except csv.Error as exc:
            raise InputError("parse-error", f"CSV error: {exc}")
        if len(set(header)) != len(header):
            raise InputError("unknown-schema", f"duplicate CSV headers: {header}")
        return header, records
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise InputError("parse-error", f"JSON error: {exc}")
    items = parsed.get("records", parsed.get("results")) if isinstance(parsed, dict) else parsed
    if not isinstance(items, list):
        raise InputError("unknown-schema", "JSON roster must be an array of records or an object with records or results")
    if not all(isinstance(item, dict) for item in items):
        raise InputError("parse-error", "every JSON roster record must be an object")
    keys = sorted({key for item in items for key in item})
    return keys, [(index, item) for index, item in enumerate(items, 1)]


def resolve(keys, fields):
    mapping, problems = {}, []
    for key in keys:
        for field in fields:
            if token(key) in ALIASES[field]:
                if field in mapping:
                    problems.append(f"{field} matches both {mapping[field]!r} and {key!r}")
                else:
                    mapping[field] = key
    return mapping, problems


def parse_row(raw, mapping, required, optional, spec, counties, upstream_hash):
    values, reasons, identity_gaps = {}, [], []
    firm = spec.get("recordKind") == "home_care_firm_registration"
    for field in required + optional:
        value = raw.get(mapping[field]) if field in mapping else None
        if value is None or (isinstance(value, str) and not value.strip()):
            if field in required:
                reasons.append(f"missing {field}")
        elif not isinstance(value, str):
            reasons.append(f"{field} must be a string so identifiers stay lossless")
        else:
            values[field] = value.strip()
    if spec.get("recordKind") and raw.get("record_kind") != spec["recordKind"]:
        reasons.append(f"record_kind must be {spec['recordKind']}")
    license_status = raw.get("license_status")
    if license_status is not None and not isinstance(license_status, str):
        reasons.append("license_status must be a string or null")
    basis = raw.get("county_basis")
    references = raw.get("county_reference_sources", [])
    derived = firm and basis in DERIVED_COUNTY_BASES
    if derived:
        expected = {"raw/municipalities.json", "raw/localities.html"}
        if "DOH" in basis:
            expected.add("raw/ltc.xlsx")
        if not isinstance(references, list) or not references or not all(isinstance(r, dict) for r in references):
            reasons.append("derived county requires official county reference sources")
            references = []
        if not expected <= {r.get("file") for r in references}:
            reasons.append("derived county requires the documented official municipality/locality reference files")
    if isinstance(references, list):
        for reference in references:
            if not isinstance(reference, dict):
                reasons.append("official county reference must be an object")
                continue
            url = http_url(reference.get("url"))
            if (url is None or url.hostname.lower() not in ("data.nj.gov", "www.nj.gov", "nj.gov", "healthapps.nj.gov")
                    or not text(reference.get("sha256"))
                    or upstream_hash(reference.get("file")) != reference["sha256"]):
                reasons.append("official county reference file is missing, unverified or its hash does not match")
    if not derived and "county_basis" in raw and basis not in EXPLICIT_COUNTY_BASES and values.get("county"):
        reasons.append(f"county basis {basis!r} is not a county published by the source")
    upstream = raw.get("source")
    if isinstance(upstream, dict) and "sha256" in upstream:
        expected_hash = upstream.get("sha256")
        if (not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash)
                or upstream_hash(upstream.get("file")) != expected_hash):
            reasons.append("upstream source file is missing or its hash does not match")
    if reasons:
        return "rejected", reasons
    state = values.get("state")
    outside_state = state is not None and token(state) not in ("nj", "newjersey")
    county = county_key(values["county"]) if values.get("county") else None
    if county is not None and county not in NJ_COUNTIES and not outside_state:
        return "rejected", [f"county {values['county']!r} is not a New Jersey county"]
    if spec.get("county") and county is not None and county != spec["county"]:
        return "rejected", [f"county {values['county']!r} differs from the roster file's county"]
    scheme = spec["scheme"]
    identifier = values.get("ccn" if scheme == "cms-ccn" else "stateId")
    if "ccn" in values and not re.fullmatch(r"[0-9A-Z]{6}", values["ccn"]):
        reasons.append("CCN must be exactly six characters as published")
    if values.get("zip") and not re.fullmatch(r"\d{5}(-\d{4})?", values["zip"]):
        identity_gaps.append(f"ZIP {values['zip']!r} is not a five-digit or ZIP+4 value; do not repair or stage it")
    if reasons:
        return "rejected", reasons
    county_label = values.get("county") if outside_state else NJ_COUNTIES.get(county)
    scope = "out-of-scope" if outside_state or (county is not None and county not in counties) else (
        "unresolved-geography" if county is None else "in-scope")
    setting = spec["setting"] or values.get("setting")
    identity_gaps += [f"missing {f}" for f in ("name", "street", "city", "state", "zip") if not values.get(f)]
    if identifier is None:
        identity_gaps.append("no official identifier; historical source-row identity requires exact-unit review")
    if setting is None:
        identity_gaps.append("care setting is not published in this source row")
    return "accepted", {
        "key": f"{scheme}:{identifier}" if identifier is not None else None,
        "identifier": {"scheme": scheme, "value": identifier} if identifier is not None else None,
        "name": values["name"],
        "address": {field: values.get(field) for field in ("street", "city", "state", "zip")},
        "county": county_label,
        "countyKey": county,
        "setting": setting,
        "unit": values.get("unit"),
        "crosswalk": {"cms-ccn": values["ccn"]} if scheme != "cms-ccn" and "ccn" in values else None,
        "scope": scope, "identityStatus": "unresolved-identity" if identity_gaps else "resolved",
        "identityReasons": identity_gaps, "sourceDate": raw.get("source_date"),
        "recordKind": spec.get("recordKind"),
        "licenseStatus": license_status,
        "geography": {
            "status": "unresolved" if county is None else ("derived" if derived else "explicit"),
            "county": county_label, "basis": basis,
            "meaning": "physical-office" if firm or spec["setting"] == "home-health" else "physical-location",
            "referenceSources": references,
        },
    }


def roster_files(root, counties, errors):
    region = root / REGION
    specs = []
    cms = region / "cms"
    if not cms.is_dir():
        errors.append({"code": "missing-directory", "path": rel(root, cms), "message": "cms roster directory is missing"})
    else:
        manifest_path = next((cms / n for n in ("manifest.json", "manifest.partial.json") if (cms / n).is_file()), None)
        sources = {}
        if manifest_path is None:
            errors.append({"code": "missing-roster", "path": rel(root, cms / "manifest.json"), "message": "CMS collection manifest is missing"})
        else:
            try:
                sources = json.loads(manifest_path.read_bytes()).get("sources", {})
            except (ValueError, AttributeError) as exc:
                errors.append({"code": "parse-error", "path": rel(root, manifest_path), "message": f"CMS manifest: {exc}"})
        for dataset, setting in CMS_DATASETS.items():
            entry = sources.get(dataset) if isinstance(sources, dict) else None
            partitions = entry.get("partitions") if isinstance(entry, dict) else None
            complete = (isinstance(entry, dict) and entry.get("complete") is True and bool(partitions)
                        and all(p.get("complete") is True for p in partitions))
            if not complete:
                if manifest_path is not None:
                    errors.append({"code": "incomplete-roster", "path": rel(root, manifest_path),
                                   "message": f"CMS dataset {dataset} ({setting}) is not complete in the manifest"})
                continue
            for partition in partitions:
                for page in partition.get("pages", []):
                    specs.append((cms / page["file"], {"source": "cms", "scheme": "cms-ccn", "setting": setting,
                                                       "sha256": page["sha256"]}))
        for directory, setting in CMS_EXPORTS.items():
            if (cms / directory).is_dir():
                for path in sorted((cms / directory).iterdir()):
                    if path.suffix in (".csv", ".json"):
                        specs.append((path, {"source": "cms", "scheme": "cms-ccn", "setting": setting}))
    state = region / "state"
    if not state.is_dir():
        errors.append({"code": "missing-directory", "path": rel(root, state), "message": "state roster directory is missing"})
    else:
        for county in counties:
            for name, (scheme, kind) in STATE_FILES.items():
                path = state / NJ_COUNTIES[county].lower().replace(" ", "-") / name
                if path.is_file():
                    specs.append((path, {"source": "state", "scheme": scheme, "setting": None, "recordKind": kind, "county": county}))
                else:
                    errors.append({"code": "missing-roster", "path": rel(root, path),
                                   "message": f"{NJ_COUNTIES[county]} state roster {name} is missing"})
        for name, (scheme, kind) in STATEWIDE_STATE_FILES.items():
            if (state / name).is_file():
                specs.append((state / name, {"source": "state", "scheme": scheme, "setting": None, "recordKind": kind}))
    return specs


def load_rosters(root, counties):
    inputs, rows, rejected, errors = [], [], [], []
    dependencies = {}

    def upstream_hash(source, relative):
        if not isinstance(relative, str):
            return None
        directory = (root / REGION / source).resolve()
        path = (directory / relative).resolve()
        if not path.is_relative_to(directory):
            return None
        key = rel(root, path)
        if key not in dependencies:
            data = path.read_bytes() if path.is_file() else None
            dependencies[key] = {"path": key, "sha256": sha256(data) if data is not None else None}
        return dependencies[key]["sha256"]

    cms = root / REGION / "cms"
    manifest = next((cms / name for name in ("manifest.json", "manifest.partial.json") if (cms / name).is_file()), None)
    if manifest:
        upstream_hash("cms", manifest.name)

    for path, spec in roster_files(root, counties, errors):
        if not path.is_file():
            errors.append({"code": "missing-roster", "path": rel(root, path), "message": "manifest lists a roster page that is missing"})
            continue
        data = path.read_bytes()
        record = {
            "path": rel(root, path), "sha256": sha256(data), "bytes": len(data), "source": spec["source"],
            "scheme": spec["scheme"], "rows": 0, "accepted": 0, "outOfScope": 0, "rejected": 0,
            "unresolvedGeography": 0, "unresolvedIdentity": 0, "status": "invalid",
            "county": spec.get("county"),
        }
        inputs.append(record)
        if spec.get("sha256") and spec["sha256"] != record["sha256"]:
            errors.append({"code": "hash-mismatch", "path": record["path"], "message": "file hash differs from the CMS manifest receipt"})
            continue
        try:
            keys, records = read_table(path, data)
        except InputError as exc:
            errors.append({"code": exc.code, "path": record["path"], "message": str(exc)})
            continue
        historical = spec.get("recordKind") == "historical_ccrc_campus_listing"
        firm = spec.get("recordKind") == "home_care_firm_registration"
        required = (["ccn"] if spec["scheme"] == "cms-ccn" else ["stateId"]) + IDENTITY_FIELDS
        required += ["setting"] if spec["setting"] is None else []
        nullable_columns = {"stateId", "city", "state", "zip", "setting"} if historical else (
            {"county", "setting"} if firm else ({"county"} if spec["setting"] == "home-health" else set()))
        optional = ["unit"] + (["ccn"] if spec["scheme"] != "cms-ccn" else []) + [
            field for field in required if field in nullable_columns]
        required = [field for field in required if field not in nullable_columns]
        mapping, problems = resolve(keys, required + optional)
        missing = [field for field in required if field not in mapping] if records else []
        if problems or missing:
            detail = "; ".join(problems + [f"no column for {field}" for field in missing])
            errors.append({"code": "unknown-schema", "path": record["path"], "message": f"{detail}; columns: {list(keys)}"})
            record["rows"] = record["rejected"] = len(records)
            for number, raw in records:
                rejected.append({"source": {"path": record["path"], "sha256": record["sha256"], "row": number},
                                 "identity": {}, "input": raw, "reasons": [detail]})
            continue
        record["status"] = "loaded"
        for number, raw in records:
            record["rows"] += 1
            outcome, value = parse_row(raw, mapping, required, optional, spec, counties,
                                       lambda relative: upstream_hash(spec["source"], relative))
            ref = {"path": record["path"], "sha256": record["sha256"], "row": number}
            if outcome == "accepted":
                record["accepted"] += 1
                record["outOfScope"] += value["scope"] == "out-of-scope"
                record["unresolvedGeography"] += value["geography"]["status"] == "unresolved"
                record["unresolvedIdentity"] += value["identityStatus"] == "unresolved-identity"
                if value["key"] is None:
                    value["key"] = f"source-row:{record['path']}#{number}"
                rows.append({**value, "source": ref, "input": raw})
            else:
                record["rejected"] += 1
                identity = {field: raw.get(mapping[field]) for field in ("ccn", "stateId", "name", "county") if field in mapping}
                rejected.append({"source": ref, "identity": identity, "input": raw, "reasons": value})
    return inputs, rows, rejected, errors, sorted(dependencies.values(), key=lambda d: d["path"])


def rel(root, path):
    return path.resolve().relative_to(root.resolve()).as_posix()


def identity_tuple(row):
    address = row["address"]
    return (
        name_key(row["name"], row["identifier"]["value"] if row["identifier"] else ""),
        street_key(address["street"] or ""), token(address["city"] or ""),
        token(address["state"] or ""), (address["zip"] or "")[:5],
        row["countyKey"], token(row["setting"] or ""), token(row["unit"] or ""),
    )


def build_locations(rows):
    by_key = {}
    for row in sorted(rows, key=lambda r: (r["source"]["path"], r["source"]["row"])):
        by_key.setdefault(row["key"], []).append(row)
    locations, issues = {}, []
    for key, group in by_key.items():
        first = group[0]
        conflict = len({identity_tuple(row) for row in group}) > 1
        license_statuses = list(dict.fromkeys(row["licenseStatus"] for row in group))
        status_conflict = len(license_statuses) > 1
        identity_gaps = sorted({reason for row in group for reason in row["identityReasons"]})
        if len(group) > 1:
            issues.append({
                "type": "duplicate-identifier", "key": key, "conflicting": conflict,
                "licenseStatuses": license_statuses, "licenseStatusConflict": status_conflict,
                "rows": [row["source"] for row in group],
            })
        locations[key] = {
            "rosterKey": key, "identifier": first["identifier"]["value"] if first["identifier"] else None, "name": first["name"],
            "address": first["address"], "county": first["county"],
            "countyKey": first["countyKey"], "setting": first["setting"], "unit": first["unit"],
            "identityConflict": conflict, "sourceRows": [row["source"] for row in group],
            "crosswalk": sorted({row["crosswalk"]["cms-ccn"] for row in group if row["crosswalk"]}),
            "scope": first["scope"], "geography": first["geography"],
            "identityStatus": "unresolved-identity" if conflict or identity_gaps else "resolved",
            "identityReasons": identity_gaps + (["roster rows disagree"] if conflict else []),
            "sourceDate": first["sourceDate"], "recordKind": first["recordKind"],
            "licenseStatuses": license_statuses, "licenseStatusConflict": status_conflict,
            "licenseStatusRows": [{"licenseStatus": row["licenseStatus"], "source": row["source"]} for row in group],
        }
    shared = {}
    for key, location in locations.items():
        address = location["address"]
        if address["street"] and address["zip"]:
            shared.setdefault((street_key(address["street"]), address["zip"][:5]), []).append(key)
    for (street, zip5), keys in sorted(shared.items()):
        if len(keys) > 1:
            issues.append({"type": "shared-address", "street": street, "zip": zip5, "keys": sorted(keys)})
    for key, location in sorted(locations.items()):
        for ccn in location["crosswalk"]:
            issues.append({
                "type": "crosswalk", "key": key, "cmsKey": f"cms-ccn:{ccn}",
                "cmsKeyInRoster": f"cms-ccn:{ccn}" in locations,
            })
    return locations, issues


def identity_reasons(observed, location):
    if not isinstance(observed, dict):
        return ["identity evidence is missing"]
    if location["identityConflict"]:
        return ["roster rows for this identifier disagree; resolve the duplicate before staging"]
    if location["identityStatus"] != "resolved":
        return ["roster exact-unit identity is unresolved; review identity before staging"] + location["identityReasons"]
    address = location["address"]
    identifier = location["identifier"]
    checks = [
        ("name", lambda v: name_key(v, identifier), location["name"]),
        ("street", street_key, address["street"]),
        ("city", token, address["city"]),
        ("zip", lambda v: v[:5], address["zip"]),
        ("careSetting", token, location["setting"]),
        ("unit", token, location["unit"] or ""),
    ]
    reasons = []
    for field, normalize, expected in checks:
        value = (observed.get(field) or "") if field == "unit" else observed.get(field)
        if not isinstance(value, str):
            reasons.append(f"observed {field} is missing")
        elif normalize(value) != normalize(expected):
            reasons.append(f"observed {field} {value!r} does not match roster {expected!r}")
    if not text(observed.get("careUnitText")):
        reasons.append("careUnitText must quote the page's care-unit or category label")
    return reasons


def source_access(root, errors):
    path = root / REGION / "reviews/source-access.json"
    policy = {
        "permitted": {}, "forbidden": {host: "known forbidden host" for host in FORBIDDEN_HOSTS},
        "valid": False,
    }
    receipt = {"path": rel(root, path), "sha256": None}
    if not path.is_file():
        errors.append({"code": "missing-access-registry", "path": receipt["path"],
                       "message": "source-access registry is missing; permitted access cannot be established"})
        return receipt, policy
    try:
        data = path.read_bytes()
        receipt["sha256"] = sha256(data)
        sources = json.loads(data)["sources"]
        if not isinstance(sources, list) or not all(isinstance(s, dict) for s in sources):
            raise ValueError("sources must be an array of access decisions")
        for index, source in enumerate(sources, 1):
            decision, basis = source.get("access_decision"), text(source.get("basis"))
            if not text(decision) or basis is None:
                raise ValueError(f"source {index} requires a string access_decision and a basis")
            if "retain_as_eligible" in source and type(source["retain_as_eligible"]) is not bool:
                raise ValueError(f"source {index} retain_as_eligible must be boolean")
            hosts = set()
            if source.get("host") is not None:
                host = host_key(source["host"])
                if host is None:
                    raise ValueError(f"source {index} host must be a DNS hostname")
                hosts.add(host)
            for field in ("url", "terms_url", "robots_url"):
                if source.get(field) is not None:
                    parts = http_url(source[field])
                    host = host_key(parts.hostname) if parts else None
                    if host is None:
                        raise ValueError(f"source {index} {field} must be an http(s) URL with a DNS hostname")
                    hosts.add(host)
            denied = decision.startswith(("restricted", "excluded", "disabled", "authentication"))
            if not hosts and not denied:
                raise ValueError(f"source {index} requires host, terms_url, robots_url or url; source labels are not hosts")
            if decision.startswith("permitted"):
                policy["permitted"].update({host: basis for host in hosts})
            elif denied:
                policy["forbidden"].update({host: basis for host in hosts})
        policy["valid"] = True
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        errors.append({"code": "parse-error", "path": receipt["path"], "message": f"source access decisions: {exc}"})
    return receipt, policy


def page_reasons(obs, checked, as_of, policy):
    reasons = []
    if obs.get("inspection") != "full-page":
        reasons.append("not a direct full-page observation; search snippets and summaries are excluded")
    for field in ("url", "canonicalUrl"):
        parts = http_url(obs.get(field))
        host = host_key(parts.hostname) if parts else None
        if host is None:
            reasons.append(f"{field} must be an http(s) URL")
        elif SEARCH_HOST.search(host):
            reasons.append(f"{field} is a search-engine page, not the source page")
        elif any(host == denied or host.endswith("." + denied) for denied in policy["forbidden"]):
            reasons.append(f"{field} is excluded by source-access policy, regardless of the supplied permitted label")
        elif not policy["valid"]:
            reasons.append(f"{field} has no validated source-access registry; observed pages cannot be staged")
        elif not any(host == permitted or host.endswith("." + permitted) for permitted in policy["permitted"]):
            reasons.append(f"{field} host has no permitted source-access entry; a permitted access assessment is required")
    access = obs.get("access") if isinstance(obs.get("access"), dict) else {}
    if access.get("decision") != "permitted" or not text(access.get("basis")):
        reasons.append("access and terms decision is not an explicit permitted decision with a basis")
    if checked > as_of:
        reasons.append("checkedAt is after the run's as-of date")
    return reasons


def listing_reasons(obs, checked, as_of):
    reasons = []
    if obs.get("sourceType") not in REVIEW_SOURCE_TYPES:
        reasons.append("source is not a review platform or public discussion; provider-selected testimonials are excluded")
    if obs.get("population") != "consumer":
        reasons.append("population is not the exact location's consumer population")
    if (as_of - checked).days > MAX_CHECKED_AGE_DAYS:
        reasons.append(f"checkedAt is more than {MAX_CHECKED_AGE_DAYS} days before the as-of date")
    rating = obs.get("rating") if isinstance(obs.get("rating"), dict) else {}
    if rating.get("kind") != "consumer-average":
        reasons.append("not a published consumer review average; proprietary scores and recommendation rates are excluded")
    scale, value, count = rating.get("scale"), rating.get("value"), rating.get("count")
    if not (is_int(scale) and scale in (5, 10)):
        reasons.append("rating scale must be 5 or 10")
    elif not (is_number(value) and 0 <= value <= scale):
        reasons.append("rating value must be a number between zero and the scale")
    if not (is_int(count) and count > 0):
        reasons.append("review count must be a positive whole number")
    if rating.get("asOf") is not None:
        snapshot = parse_date(rating.get("asOf"))
        if snapshot is None:
            reasons.append("rating asOf must be a valid YYYY-MM-DD date or null")
        elif snapshot > checked:
            reasons.append("rating asOf is after checkedAt")
        elif (as_of - snapshot).days > MAX_SNAPSHOT_AGE_DAYS:
            reasons.append(f"rating asOf is more than {MAX_SNAPSHOT_AGE_DAYS} days before the as-of date")
    syndication = obs.get("syndication") if isinstance(obs.get("syndication"), dict) else {}
    if syndication.get("status") not in ("original", "syndicated"):
        reasons.append("syndication status must be known: original or syndicated")
    elif syndication["status"] == "syndicated" and not text(syndication.get("family")):
        reasons.append("syndicated listings must name the family they republish")
    if not text(obs.get("sourceFamily")):
        reasons.append("sourceFamily is required")
    return reasons


def source_family(obs):
    syndication = obs["syndication"]
    declared = token(syndication["family"] if syndication["status"] == "syndicated" else obs["sourceFamily"])
    platform = token(obs.get("platform") or "")
    if declared in APFM_FAMILY or platform in APFM_FAMILY:
        return "aplaceformom"
    if "caringcom" in (declared, platform):
        return "caring"
    return declared


def dated_claim_reasons(item, field):
    if field not in item:
        return [f"{field} must be present as a date or null"]
    if item[field] is not None and parse_date(item[field]) is None:
        return [f"{field} must be a valid YYYY-MM-DD date or null"]
    return []


def provider_reasons(obs):
    reasons = []
    if obs.get("sourceType") != "provider-website":
        reasons.append("provider facts must come from the provider's own website")
    reasons += dated_claim_reasons(obs, "sourceClaimDate")
    offerings = obs.get("offerings")
    if not isinstance(offerings, list) or not all(text(item) for item in offerings):
        reasons.append("offerings must be a list of quoted offering labels")
    prices = obs.get("prices")
    if prices != "not-listed":
        if not isinstance(prices, list) or not prices:
            reasons.append("prices must be 'not-listed' or a non-empty list; an unlisted price is unknown, not zero")
        else:
            for index, item in enumerate(prices, 1):
                item = item if isinstance(item, dict) else {}
                if not (is_number(item.get("amount")) and item["amount"] > 0):
                    reasons.append(f"price {index} amount must be positive")
                if item.get("currency") != "USD":
                    reasons.append(f"price {index} currency must be USD")
                if item.get("period") not in PRICE_PERIODS:
                    reasons.append(f"price {index} period must be one of {sorted(PRICE_PERIODS)}")
                if not text(item.get("label")):
                    reasons.append(f"price {index} needs the page's label")
                reasons += [f"price {index} {r}" for r in dated_claim_reasons(item, "claimDate")]
    openings = obs.get("openings")
    if openings != "not-listed":
        if not isinstance(openings, list) or not openings:
            reasons.append("openings must be 'not-listed' or a non-empty list; an unlisted opening is unknown, not no vacancy")
        else:
            for index, item in enumerate(openings, 1):
                item = item if isinstance(item, dict) else {}
                if not text(item.get("claim")):
                    reasons.append(f"opening {index} needs the quoted claim")
                reasons += [f"opening {index} {r}" for r in dated_claim_reasons(item, "claimDate")]
    return reasons


def stated(values):
    if values == "not-listed":
        return {"status": "unknown", "reason": "not listed on the checked page", "items": []}
    return {"status": "listed", "items": values}


def assess(obs, locations, as_of, seen, policy):
    if not isinstance(obs, dict):
        return {"status": "invalid", "reasons": ["observation must be an object"], "input": obs}, None
    oid, key, outcome = text(obs.get("id")), obs.get("rosterKey"), obs.get("outcome")
    checked, platform = parse_date(obs.get("checkedAt")), text(obs.get("platform"))
    entry = {
        "id": oid, "rosterKey": key, "outcome": outcome, "kind": obs.get("kind"), "platform": platform,
        "checkedAt": obs.get("checkedAt"), "inspection": obs.get("inspection"), "access": obs.get("access"),
        "input": obs,
    }
    invalid = []
    if oid is None:
        invalid.append("id is required")
    elif oid in seen:
        invalid.append("id is duplicated")
    if key not in locations:
        invalid.append("rosterKey is not in this run's frozen roster; record unmatched providers as discovery leads")
    if outcome not in ("observed", "not-listed", "access-gap"):
        invalid.append("outcome must be observed, not-listed or access-gap")
    if checked is None:
        invalid.append("checkedAt must be a valid YYYY-MM-DD date")
    if platform is None:
        invalid.append("platform is required")
    if outcome == "observed" and obs.get("kind") not in ("consumer-listing", "provider-page"):
        invalid.append("observed kind must be consumer-listing or provider-page")
    if outcome == "not-listed" and not text(obs.get("method")):
        invalid.append("not-listed outcomes must describe the search method")
    if outcome == "access-gap" and not text(obs.get("reason")):
        invalid.append("access-gap outcomes must give the retrieval failure")
    if oid is not None:
        seen.add(oid)
    if invalid:
        return {**entry, "status": "invalid", "reasons": invalid}, None
    if outcome != "observed":
        reasons = ["checkedAt is after the run's as-of date"] if checked > as_of else []
        return {**entry, "status": "excluded" if reasons else "accepted", "reasons": reasons}, None
    location = locations[key]
    reasons = page_reasons(obs, checked, as_of, policy) + identity_reasons(obs.get("identity"), location)
    if location["recordKind"] == "historical_ccrc_campus_listing":
        reasons.append("historical_ccrc_campus_listing records cannot stage consumer candidates or provider facts")
    if location["scope"] == "out-of-scope":
        reasons.append("roster location is out of scope for this run")
    listing = obs["kind"] == "consumer-listing"
    reasons += listing_reasons(obs, checked, as_of) if listing else provider_reasons(obs)
    if reasons:
        return {**entry, "status": "excluded", "reasons": reasons}, None
    if listing:
        rating = obs["rating"]
        family = source_family(obs)
        staged = {
            "rosterKey": key, "observationId": oid, "status": "awaiting-review", "sourceFamily": family,
            "aggregate": {
                "sourceId": oid, "platform": platform, "sourceFamily": family, "rating": rating["value"],
                "scale": rating["scale"], "count": rating["count"], "asOf": rating.get("asOf"), "scope": "consumer",
            },
            "source": {
                "id": oid, "url": obs["canonicalUrl"], "kind": obs["sourceType"],
                "checkedAt": obs["checkedAt"], "access": "full-page",
            },
            "syndication": obs["syndication"],
        }
    else:
        staged = {
            "rosterKey": key, "observationId": oid, "url": obs["canonicalUrl"], "checkedAt": obs["checkedAt"],
            "sourceClaimDate": obs["sourceClaimDate"], "offerings": obs["offerings"],
            "prices": stated(obs["prices"]), "openings": stated(obs["openings"]),
        }
    return {**entry, "status": "accepted", "reasons": []}, staged


def assess_leads(leads, errors):
    staged, seen = [], set()
    for index, lead in enumerate(leads, 1):
        lead = lead if isinstance(lead, dict) else {}
        reasons = []
        lid = text(lead.get("id"))
        if lid is None or lid in seen:
            reasons.append("lead id is missing or duplicated")
        if not text(lead.get("name")):
            reasons.append("lead name is required")
        if http_url(lead.get("url")) is None:
            reasons.append("lead url must be http(s)")
        if parse_date(lead.get("foundAt")) is None:
            reasons.append("lead foundAt must be a valid YYYY-MM-DD date")
        seen.add(lid)
        if reasons:
            errors.append({"code": "invalid-lead", "index": index, "message": "; ".join(reasons)})
        else:
            staged.append({**lead, "status": "discovery-only"})
    return staged


def sample_status(candidates):
    if not candidates:
        return "no-eligible-aggregate"
    # The policy keeps at most one aggregate per family, so this sum bounds the eligible count from above.
    largest = {}
    for candidate in candidates:
        family = candidate["sourceFamily"]
        largest[family] = max(largest.get(family, 0), candidate["aggregate"]["count"])
    return "insufficient-sample" if sum(largest.values()) < MIN_REPORTED_REVIEWS else "awaiting-review"


def build_coverage(counties, locations, rows, observations, candidates, inputs, errors, rejected):
    ordered = sorted(
        locations.values(),
        key=lambda l: (county_order(l["countyKey"]), token(l["setting"] or ""), name_key(l["name"], l["identifier"] or ""), l["rosterKey"]),
    )
    per_location = []
    for position, location in enumerate(ordered, 1):
        outcomes = [
            {field: o[field] for field in ("id", "outcome", "kind", "platform", "checkedAt", "status", "reasons")}
            for o in observations if o.get("rosterKey") == location["rosterKey"]
        ]
        checked = any(o["status"] != "invalid" for o in outcomes)
        own = [c for c in candidates if c["rosterKey"] == location["rosterKey"]]
        per_location.append({
            "queuePosition": position, "rosterKey": location["rosterKey"], "county": location["county"],
            "setting": location["setting"], "name": location["name"], "address": location["address"],
            "unit": location["unit"], "crosswalk": location["crosswalk"],
            "identifier": location["identifier"], "identityStatus": location["identityStatus"],
            "identityReasons": location["identityReasons"], "geography": location["geography"],
            "scope": location["scope"], "sourceDate": location["sourceDate"], "sourceRows": location["sourceRows"],
            "recordKind": location["recordKind"],
            "licenseStatuses": location["licenseStatuses"], "licenseStatusConflict": location["licenseStatusConflict"],
            "licenseStatusRows": location["licenseStatusRows"],
            "status": "checked" if checked else "not-checked",
            "sampleStatus": sample_status(own) if checked else None,
            "outcomes": outcomes,
        })
    summaries = []
    loaded = {i["path"] for i in inputs if i["status"] == "loaded"}
    cms_prefix = (REGION / "cms").as_posix()
    cms_ready = any(i["source"] == "cms" and i["status"] == "loaded" for i in inputs) and not any(
        e.get("path", "").startswith(cms_prefix) for e in errors)
    for county in counties:
        mine = [l for l in per_location if l["scope"] == "in-scope" and county_key(l["county"]) == county]
        county_rows = [row for row in rows if row["scope"] == "in-scope" and row["countyKey"] == county]
        sources = {"cms": 0, "state": 0}
        for row in county_rows:
            sources["cms" if row["identifier"] and row["identifier"]["scheme"] == "cms-ccn" else "state"] += 1
        settings = {}
        for location in mine:
            counts = settings.setdefault(location["setting"] or "unknown", {
                "locations": 0, "checked": 0, "notChecked": 0, "awaitingReview": 0,
                "insufficientSample": 0, "noEligibleAggregate": 0,
            })
            counts["locations"] += 1
            counts["checked" if location["status"] == "checked" else "notChecked"] += 1
            label = {"awaiting-review": "awaitingReview", "insufficient-sample": "insufficientSample",
                     "no-eligible-aggregate": "noEligibleAggregate"}.get(location["sampleStatus"])
            if label:
                counts[label] += 1
        row_statuses = Counter(row["licenseStatus"] if row["licenseStatus"] is not None else "not-reported"
                               for row in county_rows)
        location_statuses = Counter(status if status is not None else "not-reported"
                                    for location in mine for status in location["licenseStatuses"])
        row_kinds = Counter(row["recordKind"] or "not-reported" for row in county_rows)
        location_kinds = Counter(location["recordKind"] or "not-reported" for location in mine)
        historical = "historical_ccrc_campus_listing"
        state_ready = all((REGION / "state" / NJ_COUNTIES[county].lower().replace(" ", "-") / name).as_posix() in loaded
                          for name in STATE_FILES)
        missing = [source for source, ready in (("cms", cms_ready), ("state", state_ready)) if not ready]
        any_loaded = any(i["status"] == "loaded" and (i["source"] == "cms" or i["county"] == county) for i in inputs)
        summaries.append({
            "county": NJ_COUNTIES[county],
            "rosterStatus": "loaded" if not missing else ("partial-roster" if any_loaded else "missing-roster"),
            "rosterRows": sources,
            "inventoryMeaning": INVENTORY_MEANING,
            "missingRosterSources": missing,
            "locations": len(mine),
            "nonHistoricalLocations": len(mine) - location_kinds[historical],
            "historicalCCRC": {"rosterRows": row_kinds[historical], "locations": location_kinds[historical]},
            "licenseStatuses": {
                status: {"rosterRows": row_statuses[status], "locations": location_statuses[status]}
                for status in sorted(row_statuses.keys() | location_statuses.keys())
            },
            "licenseStatusConflicts": sum(location["licenseStatusConflict"] for location in mine),
            "geography": {
                status: {"rosterRows": sum(row["geography"]["status"] == status for row in county_rows),
                         "locations": sum(location["geography"]["status"] == status for location in mine)}
                for status in ("explicit", "derived", "unresolved")
            },
            "recordKinds": {
                kind: {"rosterRows": row_kinds[kind], "locations": location_kinds[kind]}
                for kind in sorted(row_kinds.keys() | location_kinds.keys())
            },
            "checked": sum(1 for l in mine if l["status"] == "checked"),
            "notChecked": sum(1 for l in mine if l["status"] == "not-checked"),
            "unresolvedIdentity": sum(1 for l in mine if l["identityStatus"] == "unresolved-identity"),
            "settings": settings,
        })
    checks = {l["rosterKey"]: l["status"] for l in per_location}
    source_rows = [
        {"source": row["source"], "rosterKey": row["key"], "scope": row["scope"],
         "recordKind": row["recordKind"], "licenseStatus": row["licenseStatus"],
         "identityStatus": row["identityStatus"], "geographyStatus": row["geography"]["status"],
         "status": checks[row["key"]]} for row in rows
    ] + [
        {"source": row["source"], "rosterKey": None, "scope": "unresolved-identity",
         "recordKind": row["input"].get("record_kind"), "licenseStatus": row["input"].get("license_status"),
         "identityStatus": "rejected", "geographyStatus": "unresolved", "status": "not-checked",
         "reasons": row["reasons"]} for row in rejected
    ]
    unresolved = [l for l in per_location if l["geography"]["status"] == "unresolved"]
    return {
        "inventoryMeaning": INVENTORY_MEANING,
        "counties": summaries, "locations": per_location, "sourceRows": source_rows,
        "unresolvedGeography": {
            "locations": len(unresolved), "rosterRows": sum(r["geography"]["status"] == "unresolved" for r in rows),
            "checked": sum(l["status"] == "checked" for l in unresolved),
            "notChecked": sum(l["status"] == "not-checked" for l in unresolved),
            "outOfScope": sum(l["scope"] == "out-of-scope" for l in unresolved),
        },
        "outOfScope": {"locations": sum(l["scope"] == "out-of-scope" for l in per_location),
                       "rosterRows": sum(r["scope"] == "out-of-scope" for r in rows)},
    }


def load_observations(root, path):
    try:
        resolved = path.resolve()
        relative = resolved.relative_to(root.resolve()).as_posix()
    except ValueError:
        raise InputError("usage", "observations file must be inside the repository root")
    try:
        data = resolved.read_bytes()
        parsed = json.loads(data.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InputError("usage", f"cannot read observations {relative}: {exc}")
    if not isinstance(parsed, dict) or parsed.get("schemaVersion") != 1:
        raise InputError("usage", "observations file must be an object with schemaVersion 1")
    observations, leads = parsed.get("observations", []), parsed.get("leads", [])
    if not isinstance(observations, list) or not isinstance(leads, list):
        raise InputError("usage", "observations and leads must be arrays")
    return {"path": relative, "sha256": sha256(data), "bytes": len(data)}, observations, leads


def build_run(root, counties, as_of, observations_path):
    inputs, rows, rejected, errors, dependencies = load_rosters(root, counties)
    access_input, policy = source_access(root, errors)
    if access_input:
        dependencies.append(access_input)
    locations, issues = build_locations(rows)
    observation_input, raw_observations, raw_leads = None, [], []
    if observations_path is not None:
        observation_input, raw_observations, raw_leads = load_observations(root, observations_path)
    observations, candidates, facts, seen = [], [], [], set()
    for obs in raw_observations:
        entry, staged = assess(obs, locations, as_of, seen, policy)
        observations.append(entry)
        if entry["status"] == "invalid":
            errors.append({"code": "invalid-observation", "id": entry.get("id"), "message": "; ".join(entry["reasons"])})
        if staged is not None:
            (candidates if entry.get("kind") == "consumer-listing" else facts).append(staged)
    leads = assess_leads(raw_leads, errors)
    coverage = build_coverage(counties, locations, rows, observations, candidates, inputs, errors, rejected)
    tool = Path(__file__).read_bytes()
    identity = {
        "asOf": as_of.isoformat(), "counties": counties, "tool": sha256(tool),
        "inputs": [[i["path"], i["sha256"]] for i in inputs]
        + [[i["path"], i["sha256"]] for i in dependencies]
        + ([[observation_input["path"], observation_input["sha256"]]] if observation_input else []),
    }
    run_id = f"{as_of.isoformat()}-{sha256(encoded(identity))[:12]}"
    for row in rows:
        del row["countyKey"]
    manifest = {
        "schemaVersion": 2, "runId": run_id, "asOf": as_of.isoformat(),
        "counties": [NJ_COUNTIES[c] for c in counties],
        "inventoryMeaning": INVENTORY_MEANING,
        "tool": {"path": "scripts/regions/reviews.py", "sha256": identity["tool"]},
        "rosterInputs": inputs, "dependencyInputs": dependencies, "observationInput": observation_input,
        "rejectedRowsByReason": dict(sorted(Counter(r for row in rejected for r in row["reasons"]).items())),
        "counts": {
            "rosterRows": len(rows), "rejectedRows": len(rejected), "locations": len(locations),
            "observations": len(observations), "candidates": len(candidates), "providerFacts": len(facts),
            "leads": len(leads), "errors": len(errors),
            "inScopeRows": sum(r["scope"] == "in-scope" for r in rows),
            "outOfScopeRows": sum(r["scope"] == "out-of-scope" for r in rows),
            "unresolvedGeographyRows": sum(r["geography"]["status"] == "unresolved" for r in rows),
            "unresolvedIdentityRows": sum(r["identityStatus"] == "unresolved-identity" for r in rows),
        },
    }
    files = {
        "manifest.json": manifest,
        "roster.json": {"rows": rows, "rejectedRows": rejected, "issues": issues},
        "observations.json": observations,
        "candidates.json": candidates,
        "provider-facts.json": facts,
        "leads.json": leads,
        "coverage.json": coverage,
        "errors.json": errors,
    }
    inputs_all = [i["path"] for i in inputs + dependencies] + ([observation_input["path"]] if observation_input else [])
    return run_id, {name: encoded(files[name]) for name in OUTPUT_FILES}, errors, inputs_all


def write_run(root, run_id, files, input_paths):
    runs = root / REGION / "reviews" / "runs"
    runs_rel = rel(root, runs) if runs.exists() else (REGION / "reviews" / "runs").as_posix()
    for path in input_paths:
        if path == runs_rel or path.startswith(runs_rel + "/"):
            raise InputError("refused", f"input {path} lives under {runs_rel}; inputs must stay outside run output")
    target = runs / run_id
    if target.exists():
        existing = {p.name: p.read_bytes() for p in target.iterdir()} if target.is_dir() else None
        if existing == files:
            return "unchanged", target
        raise InputError("refused", f"{rel(root, target)} exists with different content; refusing to overwrite")
    staging = runs / f".tmp-{run_id}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    for name, data in files.items():
        (staging / name).write_bytes(data)
    staging.rename(target)
    return "created", target


def parse_counties(value):
    keys = []
    for part in value.split(","):
        key = county_key(part)
        if key not in NJ_COUNTIES:
            raise InputError("usage", f"unknown New Jersey county {part!r}")
        if key not in keys:
            keys.append(key)
    return sorted(keys, key=county_order)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("inventory", "freeze rosters and write the not-checked queue"),
                            ("stage", "validate observations against the frozen roster")):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--as-of", required=True, help="assessment date, YYYY-MM-DD")
        command.add_argument("--counties", default=",".join(TARGET_COUNTIES))
        command.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
        if name == "stage":
            command.add_argument("--observations", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        as_of = parse_date(args.as_of)
        if as_of is None:
            raise InputError("usage", "--as-of must be a valid YYYY-MM-DD date")
        root = args.root.resolve()
        observations = getattr(args, "observations", None)
        if observations is not None and not observations.is_absolute():
            observations = Path.cwd() / observations
        run_id, files, errors, input_paths = build_run(root, parse_counties(args.counties), as_of, observations)
        status, target = write_run(root, run_id, files, input_paths)
    except InputError as exc:
        print(json.dumps({"status": exc.code, "message": str(exc)}), file=sys.stderr)
        return 3 if exc.code == "refused" else 2
    print(json.dumps({"status": status, "runDir": rel(root, target), "errors": len(errors)}))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
