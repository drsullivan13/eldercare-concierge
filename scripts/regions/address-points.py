#!/usr/bin/env python3
"""Collect official public address matches and build a separate, offline release."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "research/north-jersey"
OUTPUT = REGION / "address-points"
NJ = "https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer"
CENSUS = "https://geocoding.geo.census.gov/geocoder"
COUNTIES = {"003": "Bergen", "013": "Essex", "017": "Hudson",
            "027": "Morris", "031": "Passaic", "039": "Union"}
WORDS = {
    "STREET": "ST", "AVENUE": "AVE", "BOULEVARD": "BLVD", "ROAD": "RD",
    "DRIVE": "DR", "LANE": "LN", "COURT": "CT", "PLACE": "PL",
    "PARKWAY": "PKWY", "TURNPIKE": "TPKE", "PLAZA": "PLZ",
    "TERRACE": "TER", "CIRCLE": "CIR", "HIGHWAY": "HWY",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "NORTHEAST": "NE", "NORTHWEST": "NW", "SOUTHEAST": "SE", "SOUTHWEST": "SW",
}
UNIT = re.compile(
    r"(?:\b(?:SUITE|STE|UNIT|APT|APARTMENT|OFFICE|BLDG|BUILDING|FLOOR|FL|"
    r"PENTHOUSE)\b|#|\b(?:\d+(?:ST|ND|RD|TH)?|FIRST|SECOND|THIRD|FOURTH)"
    r"\s+(?:FLOOR|FL)\b)", re.I
)
ACCURACY = {"PointAddress": "nj-address-point",
            "Subaddress": "nj-address-point",
            "StreetAddress": "nj-street-interpolated"}


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded(value))


def normalized(value):
    tokens = re.sub(r"[^A-Z0-9 -]", " ", value.upper()).split()
    return " ".join(WORDS.get(token, token) for token in tokens)


def street_parts(provider):
    address = " ".join(provider["address"].split())
    city = re.escape(provider["city"])
    address = re.sub(rf"\s+{city}\s*,?\s+NJ\s+\d{{5}}(?:-\d{{4}})?\s*$",
                     "", address, flags=re.I)
    match = UNIT.search(address)
    unit = address[match.start():] if match else ""
    street = address[:match.start()] if match else address
    street = street.strip(" ,()-")
    street = re.sub(r"^ONE\b", "1", street, flags=re.I)
    valid = bool(re.fullmatch(r"\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+.+", street))
    valid = valid and not bool(re.search(r"\bP\.?\s*O\.?\s+BOX\b", street, re.I))
    return {"street": street, "streetKey": normalized(street),
            "unit": unit, "parseable": valid}


def request_params(provider, source):
    parts = street_parts(provider)
    if source == "nj":
        return {"Address": parts["street"], "City": provider["city"],
                "Region": "NJ", "Postal": provider["zip"], "outSR": "4326",
                "outFields": "*", "locationType": "rooftop",
                "maxLocations": "10", "f": "json"}
    return {"street": parts["street"], "city": provider["city"], "state": "NJ",
            "zip": provider["zip"], "benchmark": "Public_AR_Current",
            "vintage": "Current_Current", "format": "json"}


def endpoint(source):
    return (NJ + "/findAddressCandidates" if source == "nj"
            else CENSUS + "/geographies/address")


def capture_path(output, source, params):
    return output / "raw" / source / (sha(encoded(params)) + ".json")


def capture(output, source, url, params):
    path = capture_path(output, source, params)
    if path.exists():
        receipt = json.loads(path.read_bytes())
        if receipt["sha256"] != sha((output / receipt["bodyFile"]).read_bytes()):
            raise ValueError(f"Capture hash mismatch: {path}")
        if "error" not in receipt:
            return receipt
    full_url = url + "?" + urlencode(params)
    receipt = {"source": source, "url": full_url, "parameters": params,
               "checkedAt": datetime.now(timezone.utc).isoformat(),
               "bodyFile": str(path.with_suffix(".body").relative_to(output))}
    cafile = os.environ.get("SSL_CERT_FILE")
    if cafile is None and Path("/etc/ssl/cert.pem").is_file():
        cafile = "/etc/ssl/cert.pem"
    context = ssl.create_default_context(cafile=cafile)
    body = None
    for attempt in range(3):
        try:
            with urlopen(Request(full_url, headers={"User-Agent": "Harbor-public-address-research/1"}),
                         timeout=40, context=context) as response:
                body = response.read(8 * 1024 * 1024 + 1)
                if len(body) > 8 * 1024 * 1024:
                    raise ValueError("Response exceeds 8 MiB")
                receipt["httpStatus"] = response.status
            value = json.loads(body)
            if "error" in value or "errors" in value:
                receipt["error"] = value.get("error", value.get("errors"))
            break
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            receipt["error"] = str(error)
    if body is None or "error" in receipt:
        body = encoded({"captureError": receipt.get("error", "no response")})
    receipt.update(sha256=sha(body), bytes=len(body))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.with_suffix(".body").write_bytes(body)
    write(path, receipt)
    return receipt


def load_capture(output, source, params):
    path = capture_path(output, source, params)
    if not path.exists():
        raise ValueError(f"Missing capture, run collect first: {path}")
    receipt = json.loads(path.read_bytes())
    body = (output / receipt["bodyFile"]).read_bytes()
    if receipt["sha256"] != sha(body) or receipt["bytes"] != len(body):
        raise ValueError(f"Capture hash mismatch: {path}")
    if receipt["url"] != endpoint(source) + "?" + urlencode(params):
        raise ValueError(f"Capture query mismatch: {path}")
    return receipt, json.loads(body)


def candidate_rows(body, source):
    if source == "nj":
        return body.get("candidates", [])
    return body.get("result", {}).get("addressMatches", [])


def inspect_candidate(provider, county, candidate, source, zip_points):
    supplied = street_parts(provider)
    if source == "nj":
        attrs = candidate["attributes"]
        street = attrs.get("StAddr", "")
        zip_code = attrs.get("Postal", "")
        city = attrs.get("City", "")
        state = attrs.get("RegionAbbr", "")
        matched_county = attrs.get("Subregion", "")
        kind = attrs.get("Addr_type")
        accuracy = ACCURACY.get(kind)
        point = candidate["location"]
        address = candidate["address"]
        identity = {"locator": attrs.get("Loc_name"), "block": attrs.get("Addr_Block"),
                    "lot": attrs.get("Addr_Lot"), "qualifier": attrs.get("Addr_Qualifier")}
    else:
        address = candidate["matchedAddress"]
        street = address.split(",")[0]
        attrs = candidate["addressComponents"]
        zip_code, city, state = attrs.get("zip", ""), attrs.get("city", ""), attrs.get("state", "")
        counties = candidate.get("geographies", {}).get("Counties", [])
        matched_county = (COUNTIES.get(counties[0].get("COUNTY"))
                          if len(counties) == 1 and counties[0].get("STATE") == "34" else None)
        kind, accuracy = "CensusAddressRange", "census-street-interpolated"
        point = candidate["coordinates"]
        identity = candidate.get("tigerLine", {})
    checks = {
        "exactStreetNumberAndName": supplied["streetKey"] == normalized(street),
        "exactZip": provider["zip"] == zip_code,
        "exactCity": normalized(provider["city"]) == normalized(city),
        "stateNJ": state == "NJ",
        "countyAgrees": county == matched_county,
        "streetLevelType": accuracy is not None,
        "finiteNJCoordinates": (all(isinstance(point.get(k), (int, float))
                                    and math.isfinite(point[k]) for k in ("x", "y"))
                                and -75.6 < point["x"] < -73.8 and 38.8 < point["y"] < 41.4),
        "notZipRepresentativePoint": (point.get("y"), point.get("x")) not in zip_points,
    }
    accepted = all(value for key, value in checks.items() if key != "exactCity")
    return {"accepted": accepted, "checks": checks, "matchedAddress": address,
            "matchedStreet": street, "matchedCity": city, "matchedZip": zip_code,
            "matchedCounty": matched_county, "matchType": kind,
            "coordinateAccuracy": accuracy, "lat": point.get("y"), "lng": point.get("x"),
            "sourceLocationIdentity": identity, "score": candidate.get("score")}


def evaluate(provider, county, output, source, zip_points):
    params = request_params(provider, source)
    receipt, body = load_capture(output, source, params)
    rows = [inspect_candidate(provider, county, row, source, zip_points)
            for row in candidate_rows(body, source)]
    accepted = [row for row in rows if row["accepted"]]
    # A site point outranks road interpolation, but two distinct site points stay unresolved.
    point_rows = [row for row in accepted if row["coordinateAccuracy"] == "nj-address-point"]
    eligible = point_rows or accepted
    positions = {(row["lat"], row["lng"]) for row in eligible}
    selected = eligible[0] if len(positions) == 1 else None
    return {"source": source, "checkedAt": receipt["checkedAt"][:10],
            "url": receipt["url"], "bodyFile": receipt["bodyFile"],
            "bodySha256": receipt["sha256"], "error": receipt.get("error"),
            "candidates": rows, "ambiguous": len(positions) > 1}, selected


def inputs(output):
    manifest = json.loads((output / "input-manifest.json").read_bytes())
    values = {}
    for name, metadata in manifest.items():
        body = (output / "inputs" / name).read_bytes()
        if sha(body) != metadata["sha256"]:
            raise ValueError(f"Input hash mismatch: {name}")
        values[name] = json.loads(body)
    providers = values["providers.json"]
    if len({p["id"] for p in providers}) != len(providers):
        raise ValueError("Duplicate provider ID")
    counties = defaultdict(set)
    for row in values["crosswalk.json"]:
        if row["status"].startswith("included"):
            counties[row["providerId"]].add(row["county"])
    if any(len(counties[p["id"]]) != 1 for p in providers):
        raise ValueError("Missing or ambiguous supplied county")
    if any(not p["officialRecord"] or p["state"] != "NJ" for p in providers):
        raise ValueError("Only official NJ business locations are eligible")
    return values, {pid: next(iter(names)) for pid, names in counties.items()}


def collect(output):
    if not (output / "input-manifest.json").exists():
        manifest = {}
        for name in ("providers.json", "crosswalk.json", "zips.json", "meta.json"):
            body = (REGION / "runtime" / name).read_bytes()
            target = output / "inputs" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            manifest[name] = {"path": f"research/north-jersey/runtime/{name}", "sha256": sha(body)}
        write(output / "input-manifest.json", manifest)
    values, counties = inputs(output)
    providers = values["providers.json"]
    zip_points = {(p["lat"], p["lng"]) for p in values["zips.json"].values()}
    capture(output, "metadata", NJ, {"f": "json"})
    capture(output, "metadata", CENSUS + "/benchmarks", {"format": "json"})
    for source in ("nj", "census"):
        eligible = [p for p in providers if street_parts(p)["parseable"]]
        if source == "census":
            eligible = [p for p in eligible
                        if evaluate(p, counties[p["id"]], output, "nj", zip_points)[1] is None]
        queries = {json.dumps(request_params(p, source), sort_keys=True):
                   request_params(p, source) for p in eligible}
        def fetch(params):
            return capture(output, source, endpoint(source), params)
        with ThreadPoolExecutor(max_workers=4) as pool:
            for index, _ in enumerate(pool.map(fetch, queries.values()), 1):
                if index % 50 == 0 or index == len(queries):
                    print(f"{source}: {index}/{len(queries)} retained queries", flush=True)
    build(output)


def build(output):
    values, counties = inputs(output)
    providers = values["providers.json"]
    zip_points = {(p["lat"], p["lng"]) for p in values["zips.json"].values()}
    release = {}
    source_rows = defaultdict(list)
    for row in values["crosswalk.json"]:
        source_rows[row["providerId"]].append(row)
    premises = defaultdict(list)
    for provider in sorted(providers, key=lambda p: p["id"]):
        pid = provider["id"]
        parts = street_parts(provider)
        attempts, chosen = [], None
        exceptions = []
        if parts["parseable"]:
            for source in ("nj", "census"):
                evidence, selected = evaluate(provider, counties[pid], output, source, zip_points)
                attempts.append(evidence)
                if selected:
                    chosen = {**selected, "source": source, "checkedAt": evidence["checkedAt"],
                              "url": evidence["url"], "bodyFile": evidence["bodyFile"],
                              "bodySha256": evidence["bodySha256"]}
                    break
        else:
            exceptions.append("unparseable_or_postal_only_address")
        if parts["unit"]:
            exceptions.append("unit_preserved_but_not_geospatially_verified")
        if chosen and not chosen["checks"]["exactCity"]:
            exceptions.append("city_label_differs_exact_street_and_zip_validate_match")
        if not chosen:
            exceptions.append("no_unique_validated_official_street_match")
        if any(a["error"] for a in attempts):
            exceptions.append("source_access_error")
        if any(a["ambiguous"] for a in attempts):
            exceptions.append("multiple_validated_coordinates")
        zip_point = values["zips.json"][provider["zip"]]
        premises_key = [parts["streetKey"], provider["zip"]]
        premises_id = "nj-premises-" + sha(encoded(premises_key))[:20]
        location_id = "nj-location-" + sha(encoded([*premises_key, normalized(parts["unit"])]))[:20]
        fallback_accuracy = ("zip-representative-point" if provider["locationKind"] == "zip"
                             else "supplied-coordinate-unverified")
        release[pid] = {
            "providerId": pid, "locationId": location_id, "premisesId": premises_id,
            "name": provider["name"], "county": counties[pid], "setting": provider["category"],
            "suppliedAddress": {key: provider[key] for key in ("address", "city", "state", "zip")},
            "addressParts": parts, "officialIdentities": source_rows[pid],
            "suppliedCoordinate": {"lat": provider["lat"], "lng": provider["lng"],
                                   "locationKind": provider["locationKind"]},
            "zipFallback": {"lat": zip_point["lat"], "lng": zip_point["lng"],
                            "coordinateAccuracy": "zip-representative-point"},
            "status": "matched" if chosen else "fallback",
            "lat": chosen["lat"] if chosen else provider["lat"],
            "lng": chosen["lng"] if chosen else provider["lng"],
            "coordinateAccuracy": chosen["coordinateAccuracy"] if chosen else fallback_accuracy,
            "entranceVerified": False, "accuracyMeters": None,
            "match": chosen, "attempts": attempts, "exceptions": exceptions,
        }
        premises[premises_id].append(pid)
    groups = {key: ids for key, ids in sorted(premises.items()) if len(ids) > 1}
    write(output / "providers-by-id.json", release)
    write(output / "shared-premises.json", {
        "meaning": "Same normalized base street and ZIP, not proof of duplicate providers or shared care units.",
        "groups": groups,
    })
    counters = defaultdict(Counter)
    for record in release.values():
        for key in ("all", "county/" + record["county"], "setting/" + record["setting"],
                    "county-setting/" + record["county"] + "/" + record["setting"]):
            counters[key]["total"] += 1
            counters[key][record["status"]] += 1
            counters[key][record["coordinateAccuracy"]] += 1
    same_zip = []
    by_zip = defaultdict(list)
    for record in release.values():
        if record["status"] == "matched":
            by_zip[record["suppliedAddress"]["zip"]].append(record)
    for zip_code, rows in sorted(by_zip.items()):
        pair = next(((a, b) for a in rows for b in rows
                     if a["premisesId"] != b["premisesId"]
                     and (a["lat"], a["lng"]) != (b["lat"], b["lng"])), None)
        if pair:
            same_zip.append({"zip": zip_code, "providers": [
                {key: row[key] for key in ("providerId", "suppliedAddress", "lat", "lng",
                                          "coordinateAccuracy", "zipFallback")} for row in pair]})
        if len(same_zip) == 2:
            break
    report = {
        "coverage": {key: dict(value) for key, value in sorted(counters.items())},
        "exceptions": dict(Counter(exc for row in release.values() for exc in row["exceptions"])),
        "twoSameZipExamples": same_zip,
        "checkedDates": sorted({a["checkedAt"] for r in release.values() for a in r["attempts"]}),
        "providerCount": len(release),
        "duplicatePolicy": "No provider IDs merged. Only spelling abbreviations share premises keys.",
        "inputs": json.loads((output / "input-manifest.json").read_bytes()),
        "releaseSha256": sha((output / "providers-by-id.json").read_bytes()),
    }
    write(output / "coverage.json", report)
    write(output / "exceptions.json", {pid: {"exceptions": row["exceptions"],
          "status": row["status"]} for pid, row in release.items() if row["exceptions"]})
    print(json.dumps(report["coverage"]["all"], sort_keys=True), flush=True)
    return release, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("collect", "build"))
    args = parser.parse_args()
    (collect if args.command == "collect" else build)(OUTPUT)


if __name__ == "__main__":
    main()
