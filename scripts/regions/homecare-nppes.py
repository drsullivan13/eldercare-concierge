#!/usr/bin/env python3
"""Acquire and replay official NPPES organization evidence without publishing it."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import ssl
import sys
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "research/north-jersey/home-care-nppes"
SOURCES = (
    "src/data/regional-markets.json",
    "research/north-jersey/home-care-supply/providers.json",
)
API = "https://npiregistry.cms.hhs.gov/api/"
IDENTITY = ("id", "name", "address", "city", "state", "zip", "phone", "locationKind")
SCHEMA = 1
DISCLAIMER = (
    "NPPES organization identity and source-reported practice contact/taxonomy only. "
    "An NPI does not establish licensing, certification, service territories, payor "
    "acceptance, availability, clinical quality, or review scores. Missing evidence is unknown."
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_bytes())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = encode(value)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def utc():
    return datetime.now(timezone.utc).isoformat()


def words(value):
    return re.findall(r"[A-Z0-9]+", unicodedata.normalize("NFKD", str(value or "")).upper())


def phone(value):
    digits = re.sub(r"\D", "", re.sub(r"(?i)(?:ext(?:ension)?\.?|x)\s*\d+\s*$", "", str(value or "")))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 and digits != "0000000000" else ""


def name_parts(value):
    return [x.strip() for x in re.split(r"\bD\s*[/\.]?\s*B\s*[/\.]?\s*A\b|"
                                       r"\bDOING BUSINESS AS\b", value, flags=re.I) if x.strip()]


def name_key(value):
    tokens = words(value.replace("&", " AND "))
    expanded = []
    for token in tokens:
        expanded.extend({"HOMECARE": ["HOME", "CARE"], "HEALTHCARE": ["HEALTH", "CARE"]}.get(token, [token]))
    text = " ".join(expanded)
    suffix = r"(?: LIMITED LIABILITY COMPANY| LIMITED LIABILITY CORPORATION| INCORPORATED| CORPORATION| COMPANY| LIMITED| LLC| PLLC| INC| CORP| LTD| CO| L L C)$"
    while re.search(suffix, text):
        text = re.sub(suffix, "", text).strip()
    return text


def name_keys(value):
    return {name_key(x) for x in name_parts(value)} - {""}


ADDRESS_ALIASES = {
    "STREET": "ST", "AVENUE": "AVE", "BOULEVARD": "BLVD", "ROAD": "RD",
    "DRIVE": "DR", "LANE": "LN", "PLACE": "PL", "COURT": "CT",
    "TURNPIKE": "TPKE", "PARKWAY": "PKWY", "HIGHWAY": "HWY",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "SECOND": "2ND", "THIRD": "3RD", "FIRST": "1ST", "FOURTH": "4TH",
}
UNIT = re.compile(r"(?<!\w)(?:(\d+(?:ST|ND|RD|TH)?|FIRST|SECOND|THIRD|FOURTH)\s+"
                  r"(?:FLOOR|FLR|FL)\b|(?:FLOOR|FLR|FL)\b\s+([A-Z0-9]+)\b|"
                  r"(SUITE|STE|UNIT|APT|APARTMENT|ROOM|RM|BUILDING|BLDG)\b\.?\s*|(#)\s*)")


def address_key(value):
    text = unicodedata.normalize("NFKD", str(value or "")).upper()
    matches = list(UNIT.finditer(text))
    base = text[:matches[0].start()] if matches else text
    units = {}
    for i, match in enumerate(matches):
        if match.group(1) or match.group(2):
            kind, content = "floor", match.group(1) or match.group(2)
            content = ADDRESS_ALIASES.get(content, content)
            content = re.sub(r"(ST|ND|RD|TH)$", "", content)
            content += " " + text[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)]
        else:
            label = match.group(3) or "#"
            kind = "building" if label in ("BUILDING", "BLDG") else "unit"
            content = text[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)]
        content = " ".join(ADDRESS_ALIASES.get(x, x) for x in re.findall(r"[A-Z0-9]+|[-/&]", content))
        if kind in units and units[kind] != content:
            units[kind] += "|" + content
        else:
            units[kind] = content
    normalized = " ".join(ADDRESS_ALIASES.get(x, x) for x in words(base))
    return {"street": normalized, "units": units,
            "po_box": bool(re.search(r"\bP\s*\.?\s*O\s*\.?\s*BOX\b|\bPOST OFFICE BOX\b", text))}


def identity(row):
    return {field: row.get(field) for field in IDENTITY}


def normalized_identity(row):
    return {
        "id": row["id"], "name": sorted(name_keys(row["name"])),
        "address": address_key(row.get("address")),
        "city": " ".join(words(row.get("city"))), "state": row.get("state"),
        "zip": str(row.get("zip", ""))[:5], "phone": phone(row.get("phone")),
    }


def current_roster(root):
    raw = {p: (root / p).read_bytes() for p in SOURCES}
    markets = json.loads(raw[SOURCES[0]])
    market = next(x for x in markets if x["id"] == "north-jersey")
    app = {x["id"]: x for x in market["providers"] if x["category"] == "home-care"}
    supply_rows = json.loads(raw[SOURCES[1]])
    require(len(app) == len([x for x in market["providers"] if x["category"] == "home-care"]),
            "Duplicate app provider ID")
    supply = {x["id"]: x for x in supply_rows}
    require(len(supply) == len(supply_rows), "Duplicate supply provider ID")
    require(all(x["category"] == "home-care" for x in supply.values()), "Unexpected supply category")
    offices = {}
    for pid in sorted(app.keys() | supply.keys()):
        source_rows = {label: identity(rows[pid]) for label, rows in
                       (("app", app), ("supply", supply)) if pid in rows}
        chosen = app.get(pid, supply.get(pid))
        differences = {}
        conflicts = {}
        if pid in app and pid in supply:
            a, b = normalized_identity(app[pid]), normalized_identity(supply[pid])
            differences = {f: [app[pid].get(f), supply[pid].get(f)] for f in IDENTITY
                           if app[pid].get(f) != supply[pid].get(f)}
            conflicts = {f: [a[f], b[f]] for f in a if a[f] != b[f]}
        offices[pid] = {
            "identity": identity(chosen), "identity_sha256": sha(encode(identity(chosen))),
            "in_app": pid in app, "in_supply": pid in supply,
            "identity_source": "app" if pid in app else "supply",
            "source_identities": source_rows,
            "source_identity_sha256": {k: sha(encode(v)) for k, v in source_rows.items()},
            "differences": differences, "conflicts": conflicts,
            "roster_warnings": chosen.get("warnings", []),
        }
    return {
        "schema": SCHEMA, "sources": {p: {"sha256": sha(data)} for p, data in raw.items()},
        "reconciliation": {
            "app_count": len(app), "supply_count": len(supply), "union_count": len(offices),
            "intersection_count": len(app.keys() & supply.keys()),
            "app_only": sorted(app.keys() - supply.keys()),
            "supply_only": sorted(supply.keys() - app.keys()),
            "different_identity_fields": [p for p, x in offices.items() if x["differences"]],
            "substantive_identity_conflicts": [p for p, x in offices.items() if x["conflicts"]],
            "precedence": "Current app identity wins for shared IDs. Substantive conflicts are withheld.",
        },
        "offices": offices,
    }


def query_id(query):
    return sha(encode(query))[:24]


def make_plan(roster):
    queries, office_queries = {}, {}
    for pid, office in roster["offices"].items():
        row = office["identity"]
        specs = []
        for part in name_parts(row["name"]):
            tokens = words(part)
            prefix = " ".join(tokens[:2])
            if len(prefix.replace(" ", "")) < 2:
                continue
            specs.append({"enumeration_type": "NPI-2", "organization_name": prefix + "*",
                          "state": "NJ"})
        if re.fullmatch(r"\d{5}", str(row.get("zip", ""))):
            specs.append({"enumeration_type": "NPI-2", "postal_code": row["zip"],
                          "taxonomy_description": "Home Health"})
            specs.append({"enumeration_type": "NPI-2", "postal_code": row["zip"],
                          "address_purpose": "LOCATION"})
        ids = []
        for spec in specs:
            qid = query_id(spec)
            queries[qid] = spec
            ids.append(qid)
        office_queries[pid] = sorted(set(ids))
    return {"schema": SCHEMA, "strategy": "statewide-name-prefix-plus-broad-practice-zip",
            "queries": dict(sorted(queries.items())), "office_queries": office_queries}


def validate_payload(payload):
    require(isinstance(payload, dict), "API response is not an object")
    require(not payload.get("Errors") and not payload.get("errors"), f"API error: {payload}")
    results = payload.get("results", [])
    require(isinstance(results, list), "Invalid API results")
    require(payload.get("result_count") == len(results), "API count differs from results")
    for record in results:
        require(record.get("enumeration_type") == "NPI-2", "Non-organization result")
        require(re.fullmatch(r"\d{10}", str(record.get("number", ""))), "Invalid NPI")
        require(isinstance(record.get("basic"), dict), "Missing basic data")
        require(record["basic"].get("organization_name") is None
                or isinstance(record["basic"]["organization_name"], str), "Invalid legal organization name")
        for field in ("addresses", "practiceLocations", "other_names"):
            rows = record.get(field, [])
            require(isinstance(rows, list) and all(isinstance(x, dict) for x in rows),
                    f"Invalid {field}")
        for address in record.get("addresses", []) + record.get("practiceLocations", []):
            require(all(address.get(k) is None or isinstance(address[k], str)
                        for k in ("address_1", "address_2", "city", "state", "postal_code",
                                  "telephone_number", "address_purpose")), "Invalid address field")
        require(all(x.get("organization_name") is None or isinstance(x["organization_name"], str)
                    for x in record.get("other_names", [])), "Invalid other organization name")
    return results


class Acquisition:
    def __init__(self, base, offline=False, timeout=15, retries=2, transport=None):
        self.base, self.offline = base, offline
        self.timeout, self.retries = timeout, retries
        self.transport = transport or self.fetch

    def fetch(self, url):
        cafile = "/etc/ssl/cert.pem"
        context = ssl.create_default_context(cafile=cafile if Path(cafile).exists() else None)
        request = Request(url, headers={"User-Agent": "Harbor-NPPES-research/1.0",
                                       "Accept": "application/json"})
        with urlopen(request, timeout=self.timeout, context=context) as response:
            return response.status, response.read()

    def read_page(self, qid, skip, query):
        pointer_path = self.base / "cache" / qid / f"{skip}.json"
        if not pointer_path.exists():
            return None
        pointer = read_json(pointer_path)
        receipt_path = self.base / pointer["receipt"]
        require(sha(receipt_path.read_bytes()) == pointer["receipt_sha256"], "Receipt tamper")
        receipt = read_json(receipt_path)
        params = dict(query, version="2.1", limit="200", skip=str(skip))
        require(receipt["query"] == params and receipt["query_id"] == qid, "Cached query drift")
        require(receipt["url"] == API + "?" + urlencode(sorted(params.items())), "Cached URL drift")
        for attempt in receipt["attempts"]:
            if attempt.get("raw"):
                raw = (self.base / attempt["raw"]).read_bytes()
                require(sha(raw) == attempt["sha256"], "Raw response tamper")
        if receipt["status"] == "ok":
            payload = json.loads((self.base / receipt["attempts"][-1]["raw"]).read_bytes())
            validate_payload(payload)
            return receipt, payload, pointer
        return receipt, None, pointer

    def page(self, qid, skip, query):
        cached = self.read_page(qid, skip, query)
        if cached and (cached[0]["status"] == "ok" or self.offline):
            return cached
        require(not self.offline, f"Offline cache miss {qid}/{skip}")
        params = dict(query, version="2.1", limit="200", skip=str(skip))
        url = API + "?" + urlencode(sorted(params.items()))
        receipt = {"query_id": qid, "query": params, "url": url, "attempts": [], "status": "error"}
        payload = None
        for retry in range(self.retries + 1):
            attempt = {"retrieved_at": utc()}
            try:
                status, raw = self.transport(url)
                attempt["http_status"] = status
                digest = sha(raw)
                relative = f"raw/{digest}.json"
                path = self.base / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                if path.exists():
                    require(path.read_bytes() == raw, "Raw hash collision")
                else:
                    path.write_bytes(raw)
                attempt.update({"raw": relative, "sha256": digest, "bytes": len(raw)})
                require(status == 200, f"HTTP {status}")
                parsed = json.loads(raw)
                validate_payload(parsed)
                payload = parsed
                receipt["status"] = "ok"
            except HTTPError as error:
                raw = error.read()
                digest = sha(raw)
                relative = f"raw/{digest}.json"
                (self.base / "raw").mkdir(parents=True, exist_ok=True)
                (self.base / relative).write_bytes(raw)
                attempt.update({"http_status": error.code, "error": str(error),
                                "raw": relative, "sha256": digest, "bytes": len(raw)})
            except (OSError, URLError, ValueError, TimeoutError) as error:
                attempt["error"] = f"{type(error).__name__}: {error}"
            receipt["attempts"].append(attempt)
            if payload is not None:
                break
            if retry < self.retries:
                time.sleep(min(2 ** retry, 4))
        digest = sha(encode(receipt))
        relative = f"receipts/{digest}.json"
        write_json(self.base / relative, receipt)
        pointer = {"receipt": relative, "receipt_sha256": digest}
        write_json(self.base / "cache" / qid / f"{skip}.json", pointer)
        return receipt, payload, pointer

    def query(self, query):
        qid = query_id(query)
        pages, count, seen = [], 0, set()
        for skip in range(0, 1001, 200):
            receipt, payload, pointer = self.page(qid, skip, query)
            pages.append(dict(pointer, skip=skip))
            if payload is None:
                return {"state": "error", "count": count, "pages": pages}
            results = validate_payload(payload)
            numbers = [str(x["number"]) for x in results]
            if seen.intersection(numbers) or len(set(numbers)) != len(numbers):
                return {"state": "pagination-conflict", "count": count, "pages": pages}
            seen.update(numbers)
            count += len(results)
            if len(results) < 200:
                return {"state": "complete", "count": count, "pages": pages}
        return {"state": "saturated", "count": count, "pages": pages}


def candidate(record, references):
    basic = record["basic"]
    addresses = []
    for i, address in enumerate(record.get("addresses", [])):
        addresses.append(dict(address, source_path=f"addresses[{i}]",
                              evidence_purpose=address.get("address_purpose", "UNKNOWN")))
    for i, address in enumerate(record.get("practiceLocations", [])):
        purpose = ("SECONDARY_LOCATION" if address.get("address_purpose") in (None, "", "LOCATION")
                   else "CONFLICTING_SECONDARY_PURPOSE")
        addresses.append(dict(address, source_path=f"practiceLocations[{i}]",
                              evidence_purpose=purpose))
    return {
        "npi": str(record["number"]), "enumeration_type": record["enumeration_type"],
        "legal_name": basic.get("organization_name"), "other_names": record.get("other_names", []),
        "status": basic.get("status"), "enumeration_date": basic.get("enumeration_date"),
        "last_updated": basic.get("last_updated"), "deactivation_date": basic.get("deactivation_date"),
        "reactivation_date": basic.get("reactivation_date"),
        "addresses": addresses, "taxonomies": record.get("taxonomies", []),
        "taxonomy_scope": "NPI organization; not independently verified for each practice location",
        "record_sha256": sha(encode(record)), "receipts": sorted(references),
    }


def assess(office, entity):
    row = office["identity"]
    names = name_keys(entity.get("legal_name") or "")
    former_names = set()
    for other in entity["other_names"]:
        values = name_keys(other.get("organization_name") or "")
        if str(other.get("code")) in ("1", "4") or "former" in str(other.get("type", "")).lower():
            former_names.update(values)
        elif str(other.get("code")) in ("2", "3", "5"):
            names.update(values)
    exact = sorted(name_keys(row["name"]) & (names - {""}))
    former = sorted(name_keys(row["name"]) & former_names)
    checks = {"exact_organization_names": exact, "exact_former_names": former, "locations": []}
    expected = address_key(row.get("address"))
    for address in entity["addresses"]:
        actual = address_key(" ".join(str(address.get(k) or "") for k in ("address_1", "address_2")))
        practice = address["evidence_purpose"] in ("LOCATION", "SECONDARY_LOCATION")
        place = ((address.get("state") or "").upper() == str(row.get("state", "")).upper()
                 and str(address.get("postal_code", ""))[:5] == str(row.get("zip", ""))[:5])
        city_equal = bool(words(row.get("city")) and words(row.get("city")) == words(address.get("city")))
        street = bool(expected["street"] and expected["street"] == actual["street"] and place)
        unit_conflict = any(k in actual["units"] and actual["units"][k] != v
                            for k, v in expected["units"].items())
        units_equal = actual["units"] == expected["units"]
        wanted_phone, actual_phone = phone(row.get("phone")), phone(address.get("telephone_number"))
        same_phone = bool(wanted_phone and actual_phone and wanted_phone == actual_phone)
        checks["locations"].append({
            "source_path": address["source_path"], "purpose": address["evidence_purpose"],
            "practice": practice, "same_street_zip_state": street,
            "city_equal": city_equal,
            "units_equal": units_equal, "explicit_unit_conflict": unit_conflict,
            "roster_units": expected["units"], "candidate_units": actual["units"],
            "phone_equal": same_phone, "phone_missing": not (wanted_phone and actual_phone),
        })
    reason = None
    if office["conflicts"]:
        reason = "roster_source_identity_conflict"
    elif expected["po_box"]:
        reason = "roster_mailing_only_po_box"
    elif any(re.search(r"physical office location is unverified|conflicting counties", x, re.I)
             for x in office.get("roster_warnings", [])):
        reason = "roster_location_warning"
    elif entity["status"] != "A" or entity.get("deactivation_date"):
        reason = "inactive_or_deactivated_entity"
    elif not exact:
        reason = "former_name_only_identity" if former else "organization_identity_not_exact"
    else:
        locations = [x for x in checks["locations"] if x["practice"] and x["same_street_zip_state"]]
        if not locations:
            mailing = any(x["purpose"] == "MAILING" and x["same_street_zip_state"] for x in checks["locations"])
            conflict = any(x["purpose"] == "CONFLICTING_SECONDARY_PURPOSE"
                           and x["same_street_zip_state"] for x in checks["locations"])
            reason = ("conflicting_secondary_address_purpose" if conflict else
                      "mailing_only_address_match" if mailing else "wrong_branch_or_older_address")
        elif not any(x["city_equal"] for x in locations):
            reason = "practice_city_conflict_or_missing"
        elif any(x["explicit_unit_conflict"] for x in locations):
            reason = "explicit_suite_or_floor_conflict"
        elif not any(x["units_equal"] for x in locations):
            reason = "suite_or_floor_evidence_missing"
        elif not any(x["city_equal"] and x["units_equal"] and x["phone_equal"] for x in locations):
            reason = ("practice_phone_missing" if any(x["units_equal"] and x["phone_missing"] for x in locations)
                      else "practice_phone_conflict")
    accepted_locations = [x["source_path"] for x in checks["locations"]
                          if x["practice"] and x["same_street_zip_state"] and x["city_equal"]
                          and x["units_equal"] and x["phone_equal"]]
    return {"npi": entity["npi"], "eligible": reason is None,
            "reason": reason or "exact_organization_practice_address_unit_and_phone",
            "matching_practice_paths": accepted_locations if reason is None else [], "checks": checks}


def load_evidence(base, roster, plan, index):
    acq = Acquisition(base, offline=True)
    entities, query_npis, receipt_hashes = {}, {}, {}
    for qid, summary in sorted(index["queries"].items()):
        require(qid in plan["queries"] or qid in index.get("exact_queries", {}), "Unplanned query")
        query = plan["queries"].get(qid, index.get("exact_queries", {}).get(qid))
        replay = acq.query(query)
        require(replay == summary, f"Query summary drift {qid}")
        query_npis[qid] = set()
        for page in summary["pages"]:
            receipt, payload, pointer = acq.read_page(qid, page["skip"], query)
            require(pointer == {k: page[k] for k in ("receipt", "receipt_sha256")}, "Page receipt drift")
            receipt_hashes[pointer["receipt"]] = pointer["receipt_sha256"]
            if payload is None:
                continue
            for record in validate_payload(payload):
                npi = str(record["number"])
                query_npis[qid].add(npi)
                digest = sha(encode(record))
                entry = entities.setdefault(npi, {})
                version = entry.setdefault(digest, {"record": record, "references": set(), "queries": set()})
                version["references"].add(pointer["receipt"])
                version["queries"].add(qid)
    inventory = {}
    for npi, versions in sorted(entities.items()):
        inventory[npi] = {
            "npi": npi, "version_conflict": len(versions) != 1,
            "versions": [candidate(v["record"], v["references"]) for _, v in sorted(versions.items())],
        }
    return inventory, query_npis, receipt_hashes


def decisions(roster, plan, index, inventory, query_npis):
    coverage, facts, unresolved = {}, {}, {}
    exact_queries = index.get("exact_queries", {})
    exact_by_npi = {q["number"]: qid for qid, q in exact_queries.items()}
    for pid, office in roster["offices"].items():
        qids = plan["office_queries"][pid]
        attempted = [q for q in qids if q in index["queries"]]
        states = {q: index["queries"][q]["state"] if q in index["queries"] else "unattempted" for q in qids}
        npis = sorted(set().union(*(query_npis.get(q, set()) for q in qids)))
        candidate_rows = []
        for npi in npis:
            entry = inventory[npi]
            assessments = [assess(office, v) for v in entry["versions"]]
            relevant = any(a["checks"]["exact_organization_names"] or a["checks"]["exact_former_names"] or any(
                x["same_street_zip_state"] or x["phone_equal"] for x in a["checks"]["locations"])
                           for a in assessments)
            if not relevant:
                continue
            result = assessments[0]
            if entry["version_conflict"]:
                result = dict(result, eligible=False, reason="conflicting_observed_npi_records")
            candidate_rows.append(result)
        eligible = [x for x in candidate_rows if x["eligible"]]
        incomplete = any(s != "complete" for s in states.values())
        verified = []
        for row in eligible:
            qid = exact_by_npi.get(row["npi"])
            if (qid and index["queries"][qid]["state"] == "complete"
                    and query_npis.get(qid) == {row["npi"]}):
                verified.append(row)
        if len(eligible) > 1:
            status, reason = "ambiguous", "multiple_exact_branch_npis"
        elif len(eligible) == 1 and len(verified) == 1 and not incomplete:
            status, reason = "verified", verified[0]["reason"]
        elif incomplete:
            status, reason = "incomplete", "discovery_query_error_saturation_or_unattempted"
        elif eligible:
            status, reason = "incomplete", "exact_npi_live_confirmation_missing_or_failed"
        elif candidate_rows:
            status, reason = "unresolved", "candidates_do_not_prove_exact_branch"
        else:
            status, reason = "attempted_zero", "no_locally_relevant_candidate_in_completed_scoped_queries"
        record = {
            "provider_id": pid, "in_app": office["in_app"], "in_supply": office["in_supply"],
            "identity_sha256": office["identity_sha256"], "status": status, "reason": reason,
            "query_ids": qids, "query_states": states, "attempted_queries": len(attempted),
            "discovered_npis": len(npis), "relevant_candidates": len(candidate_rows),
            "eligible_npis": [x["npi"] for x in eligible],
            "verified_npis": [x["npi"] for x in verified] if status == "verified" else [],
            "candidate_decisions": candidate_rows,
        }
        coverage[pid] = record
        if status == "verified":
            match = verified[0]
            entity = inventory[match["npi"]]["versions"][0]
            facts[pid] = {
                "provider_id": pid, "roster_identity_sha256": office["identity_sha256"],
                "npi": entity["npi"], "legal_name": entity["legal_name"], "other_names": entity["other_names"],
                "nppes_status": entity["status"], "nppes_last_updated": entity["last_updated"],
                "practice_locations": [a for a in entity["addresses"]
                                       if a["source_path"] in match["matching_practice_paths"]],
                "source_reported_taxonomies": entity["taxonomies"], "receipts": entity["receipts"],
                "taxonomy_scope": entity["taxonomy_scope"],
                "exact_lookup_query_id": exact_by_npi[entity["npi"]], "basis": match["reason"],
                "limitations": DISCLAIMER,
            }
        else:
            unresolved[pid] = record
    claims = defaultdict(list)
    for pid, fact in facts.items():
        for location in fact["practice_locations"]:
            claims[(fact["npi"], location["source_path"])].append(pid)
    for providers in claims.values():
        if len(providers) > 1:
            for pid in providers:
                coverage[pid].update(status="ambiguous", reason="same_npi_practice_claimed_by_multiple_roster_ids",
                                     verified_npis=[])
                unresolved[pid] = coverage[pid]
                facts.pop(pid, None)
    return coverage, facts, unresolved


def initialize(root, base, extend_plan=False):
    roster = current_roster(root)
    path = base / "roster.json"
    if path.exists():
        require(read_json(path) == roster, "Roster drift. Preserve this acquisition and use a new output directory.")
    else:
        write_json(path, roster)
    plan = make_plan(roster)
    plan_path = base / "query-plan.json"
    if plan_path.exists():
        previous = read_json(plan_path)
        if previous != plan:
            require(extend_plan, "Query plan drift. Use --extend-plan only for additions.")
            require(all(plan["queries"].get(k) == v for k, v in previous["queries"].items())
                    and set(previous["office_queries"]) == set(plan["office_queries"])
                    and all(set(v) <= set(plan["office_queries"][k])
                            for k, v in previous["office_queries"].items()),
                    "Query plan extension would change or discard existing queries")
            write_json(base / "plans" / f"{sha(encode(previous))}.json", previous)
            write_json(plan_path, plan)
    else:
        write_json(plan_path, plan)
    return roster, plan


def collect(root, base, workers=2, timeout=15, retries=2, offline=False, extend_plan=False):
    require(1 <= workers <= 3, "Use one to three workers")
    roster, plan = initialize(root, base, extend_plan)
    index_path = base / "acquisition.json"
    index = read_json(index_path) if index_path.exists() else {"schema": SCHEMA, "queries": {}, "exact_queries": {}}
    acq = Acquisition(base, offline, timeout, retries)
    pending = [(qid, query) for qid, query in plan["queries"].items()
               if qid not in index["queries"] or index["queries"][qid]["state"] == "error"]
    failures = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for offset in range(0, len(pending), workers * 10):
            jobs = {pool.submit(acq.query, q): qid for qid, q in pending[offset:offset + workers * 10]}
            for future in as_completed(jobs):
                qid = jobs[future]
                result = future.result()
                index["queries"][qid] = result
                failures = failures + 1 if result["state"] == "error" else 0
                write_json(index_path, index)
                done = len(set(plan["queries"]) & set(index["queries"]))
                if done % 25 == 0 or result["state"] != "complete":
                    print(f"discovery {done}/{len(plan['queries'])} {qid} {result['state']} {result['count']}", flush=True)
            if failures >= 20:
                print("Stopped after repeated API errors. Unattempted queries remain visible.", flush=True)
                break
    inventory, query_npis, _ = load_evidence(base, roster, plan, index)
    coverage, _, _ = decisions(roster, plan, index, inventory, query_npis)
    npis = sorted({npi for row in coverage.values() for npi in row["eligible_npis"]})
    for i, npi in enumerate(npis):
        query = {"number": npi, "enumeration_type": "NPI-2"}
        qid = query_id(query)
        index["exact_queries"][qid] = query
        index["queries"][qid] = acq.query(query)
        write_json(index_path, index)
        if (i + 1) % 25 == 0 or index["queries"][qid]["state"] != "complete":
            print(f"exact NPI {i + 1}/{len(npis)} {index['queries'][qid]['state']}", flush=True)
    print(json.dumps({"queries": len(index["queries"]), "exact_npis_attempted": len(npis),
                      "query_states": dict(Counter(q["state"] for q in index["queries"].values()))}), flush=True)


def products(root, base):
    roster = read_json(base / "roster.json")
    require(current_roster(root) == roster, "Roster/source drift")
    plan = read_json(base / "query-plan.json")
    require(make_plan(roster) == plan, "Query plan drift")
    index = read_json(base / "acquisition.json")
    inventory, query_npis, receipt_hashes = load_evidence(base, roster, plan, index)
    coverage, facts, unresolved = decisions(roster, plan, index, inventory, query_npis)
    require(set(coverage) == set(roster["offices"]), "Coverage denominator drift")
    csv_buffer = io.StringIO(newline="")
    fields = ["provider_id", "name", "in_app", "in_supply", "status", "reason",
              "attempted_queries", "discovered_npis", "relevant_candidates", "verified_npis"]
    writer = csv.DictWriter(csv_buffer, fields)
    writer.writeheader()
    for pid, row in coverage.items():
        record = {f: row.get(f) for f in fields}
        record["name"] = roster["offices"][pid]["identity"]["name"]
        record["verified_npis"] = "|".join(row["verified_npis"])
        for field, value in record.items():
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
                record[field] = "'" + value
        writer.writerow(record)
    relevant_npis = {x["npi"] for c in coverage.values() for x in c["candidate_decisions"]}
    history = []
    for path in sorted((base / "receipts").glob("*.json")):
        receipt_bytes = path.read_bytes()
        require(sha(receipt_bytes) == path.stem, "Historical receipt tamper")
        receipt = json.loads(receipt_bytes)
        for attempt in receipt["attempts"]:
            if attempt.get("raw"):
                raw_path = base / attempt["raw"]
                require(sha(raw_path.read_bytes()) == attempt["sha256"], "Historical raw response tamper")
            history.append(attempt)
    incomplete_queries = {
        qid: {"query": plan["queries"].get(qid, index.get("exact_queries", {}).get(qid)),
              "state": index["queries"][qid]["state"] if qid in index["queries"] else "unattempted"}
        for qid in sorted(set(plan["queries"]) | set(index["queries"]))
        if qid not in index["queries"] or index["queries"][qid]["state"] != "complete"
    }
    report = {
        "schema": SCHEMA, "reconciliation": roster["reconciliation"],
        "roster_sources": roster["sources"], "planned_discovery_queries": len(plan["queries"]),
        "attempted_discovery_queries": len(set(plan["queries"]) & set(index["queries"])),
        "exact_lookup_queries": len(index.get("exact_queries", {})),
        "query_states": dict(sorted(Counter(x["state"] for x in index["queries"].values()).items())),
        "incomplete_queries": incomplete_queries,
        "retained_request_attempts": len(history),
        "retained_failed_attempts": sum(bool(a.get("error")) for a in history),
        "acquisition_started_at": min((a["retrieved_at"] for a in history), default=None),
        "acquisition_last_attempt_at": max((a["retrieved_at"] for a in history), default=None),
        "unique_candidate_npis": len(inventory), "locally_relevant_npis": len(relevant_npis),
        "coverage_states": dict(sorted(Counter(x["status"] for x in coverage.values()).items())),
        "app_coverage_states": dict(sorted(Counter(x["status"] for x in coverage.values() if x["in_app"]).items())),
        "verified_offices": len(facts), "verified_unique_npis": len({f["npi"] for f in facts.values()}),
        "candidate_reasons": dict(sorted(Counter(x["reason"] for c in coverage.values()
                                                for x in c["candidate_decisions"]).items())),
        "limitations": DISCLAIMER,
        "search_scope": "Completed queries are scoped searches, not proof that an unmatched office lacks an NPI. "
                        "Every roster ZIP has an unfiltered NPI-2 practice-location query and a retained "
                        "Home Health query. Name prefixes search legal, DBA, former and other names. "
                        "Former-name-only matches are withheld. City aliases are not assumed. "
                        "Default address filters can match mailing or practice. Only practice is matched locally.",
    }
    artifacts = {
        "inventory.json": encode(inventory), "verified-branch-facts.json": encode(facts),
        "unresolved-candidates.json": encode(unresolved), "coverage.json": encode(coverage),
        "coverage.csv": csv_buffer.getvalue().encode(), "report.json": encode(report),
    }
    evidence_files = {"roster.json", "query-plan.json", "acquisition.json"}
    evidence_files.update(str(p.relative_to(base)) for folder in ("raw", "receipts")
                          for p in (base / folder).glob("*.json"))
    evidence_files.update(str(p.relative_to(base)) for p in (base / "plans").glob("*.json"))
    for receipt_path in receipt_hashes:
        evidence_files.add(receipt_path)
        receipt = read_json(base / receipt_path)
        evidence_files.update(a["raw"] for a in receipt["attempts"] if a.get("raw"))
    for qid, summary in index["queries"].items():
        evidence_files.update(f"cache/{qid}/{p['skip']}.json" for p in summary["pages"])
    manifest = {
        "schema": SCHEMA, "script_sha256": sha(Path(__file__).read_bytes()),
        "source_files": roster["sources"],
        "evidence_sha256": {p: sha((base / p).read_bytes()) for p in sorted(evidence_files)},
        "output_sha256": {p: sha(data) for p, data in artifacts.items()},
        "limitations": DISCLAIMER,
    }
    artifacts["manifest.json"] = encode(manifest)
    return artifacts, report


def build(root, base, check=False):
    if check:
        manifest = read_json(base / "manifest.json")
        require(manifest["script_sha256"] == sha(Path(__file__).read_bytes()), "Collector script drift")
        for section in ("evidence_sha256", "output_sha256"):
            for path, digest in manifest[section].items():
                require(sha((base / path).read_bytes()) == digest, f"Manifest tamper/drift: {path}")
    artifacts, report = products(root, base)
    for path, data in artifacts.items():
        if check:
            require((base / path).read_bytes() == data, f"Offline replay differs: {path}")
        else:
            (base / path).write_bytes(data)
    print(json.dumps({"check": "passed" if check else "built", **report}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("collect", "build", "check"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=BASE)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--extend-plan", action="store_true",
                        help="Retain the previous plan and allow additions without changing existing queries")
    args = parser.parse_args()
    require(args.root.is_absolute() and args.output.is_absolute(), "Use absolute root and output paths")
    if args.command == "collect":
        collect(args.root, args.output, args.workers, args.timeout, args.retries, args.offline, args.extend_plan)
    else:
        build(args.root, args.output, args.command == "check")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f"NPPES acquisition failed: {error}", file=sys.stderr)
        sys.exit(1)
