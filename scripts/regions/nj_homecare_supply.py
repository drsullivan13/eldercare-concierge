#!/usr/bin/env python3
"""Build Harbor's NJ health care service firm office supply from retained registry and geography captures.

The build is offline and deterministic. --check verifies every input and compares each output byte for byte
without writing.
"""

import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import csv  # noqa: E402
import gzip
import hashlib  # noqa: E402
import runpy
import importlib.util  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
from collections import Counter, defaultdict  # noqa: E402
from pathlib import Path  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from nj_collect import TableRows, excel_date, place_key, workbook_rows  # noqa: E402

_spec = importlib.util.spec_from_file_location("zip_build", HERE / "zip-build.py")
zip_build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(zip_build)

DEFAULT_RESEARCH = ROOT / "research/north-jersey"
DEFAULT_OUTPUT = DEFAULT_RESEARCH / "home-care-supply"
BUILDER = "scripts/regions/nj_homecare_supply.py"
MARKET = "north-jersey"
TIERS = {
    "Essex": "core", "Morris": "core", "Union": "core", "Somerset": "core", "Middlesex": "core",
    "Bergen": "ring", "Passaic": "ring", "Monmouth": "ring",
    "Hudson": "preserved",
}
TARGET = frozenset(TIERS)
REGISTRY_FILE = "home-care-supply/source/firms.xlsx"
BASELINE = "home-care-supply/source/baseline-offices.json.gz"
NORMALIZE_STREET = runpy.run_path(str(HERE / "address-points.py"))["normalized"]
OFFICE_GEOCODE = "home-care-supply/source/census-office-geocode"
PINNED = {
    REGISTRY_FILE: ("0bea21d668c3fd62e97b0ba36eede5785fcc69be146a5d8302bd9e05609fd489", "2026-11-15"),
    "state/raw/municipalities.json": ("890f23f7a5d55364482e69dbb543db5d5ddee46ce764061004132b1048fe071a", "2026-11-12"),
    "state/raw/localities.html": ("13a8e5c51af0106f128d58c401eec070d50af0e3eb2f3b9e77d5d6303a1cd437", "2026-11-12"),
    "geography/raw/geonames-US.zip": ("8143066cdca36f13bf956692750e8d14797a3968c0c87d026e95fa7b0e080c26", "2026-11-12"),
    "geography/raw/geonames-readme.txt": ("fff60148da20f4d182859d926518efa5b0f3949f3c3273a284901325f1f8f008", "2026-11-12"),
    "geography/raw/census-2026-zcta.zip": ("f1e9046b91f6e60686a99343cb2752834c02b0764939403b331c78c017e2c54c", "2026-11-12"),
    "geography/raw/census-2020-zcta-county.txt": ("3ed41278d637dc249e0323306f68be8a6c234e3090f4de88ef328dee71aeaaaf", "2026-11-12"),
    BASELINE: ("5540242907772deb59005479754a7564ad4ef6feb508bc802b754cc1e934bd33", "2026-11-13"),
    "geography/nj-zips.json": ("d3e20077d709b26d164442ca3ae12e9db07e4a144b2193ff7ae515da9576ebfe", "2026-11-13"),
    f"{OFFICE_GEOCODE}/census-input.csv": ("cbefd0a0f874713414b68703a9a9d0d587adaef45f12df4ad9a2e5c6bd75135e", "2026-11-15"),
    f"{OFFICE_GEOCODE}/census-output.csv": ("e5227ee008526b5d3e685c1656d2e66d5c2a07fcef68e8729cd0d80647973d60", "2026-11-15"),
}
REGISTRY_ROWS = 3628
MUNICIPALITY_ROWS = 564
LOCALITY_ROWS = 3301
ID_FIELD = "License/Registration"
LOCATION_FIELDS = ("Business Address", "Business City", "Business Zipcode")
PO_BOX = re.compile(r"\bP\.?\s*O\.?\s*BOX\b|\bPOST\s+OFFICE\s+BOX\b", re.I)
SOURCE_REACHABILITY = {
    "observedAt": "2026-11-14",
    "observer": "coordinating agent, HTTP fetch",
    "meaning": "The complete HP* capture contains 3,628 rows, matching the portal total. The source has no effective date.",
    "urls": [
        {"url": "https://rgbportal.dca.njoag.gov/public-view/", "status": 200,
         "note": "HP* search and export matched counts; no renewal or availability is inferred."},
        {"url": "https://www.njconsumeraffairs.gov/hcservice", "status": 200,
         "note": "Page last modified 8/19/2026. Alert says HCSF registrations now expire September 30 instead of "
                 "June 30. Current registrations expire September 30, 2026, and registrations already renewed for "
                 "2026-27 extend to September 30, 2027. Workbook expiration dates are kept literally. The firm "
                 "definition includes health care, companion or personal care placement, so registration is not "
                 "proof of nonmedical-only service."},
        {"url": "https://data.nj.gov/resource/k9xb-zgh4.json?%24limit=1000", "status": 200,
         "note": "JSON matches the retained municipality dataset shape."},
        {"url": "https://www.nj.gov/cgi-bin/infobank/localsearch.pl", "status": 200,
         "note": "Reports 3301 matches, equal to the retained locality capture."},
        {"url": "https://download.geonames.org/export/zip/readme.txt", "status": 200,
         "note": "CC BY 4.0 attribution required. Postal points are approximate, algorithmic estimates."},
        {"url": "https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html", "status": 200,
         "note": "Census states that ZIP codes are not ZCTAs."},
    ],
}
BASE_LIMITATIONS = (
    "Registry source date is not published. checkedAt is retrieval date, not an effective date.",
    "Registration does not establish Medicare certification, private-pay acceptance, current staffing, "
    "home visits, specific services or availability.",
    "Physical business address and county are not countywide service coverage.",
)
ZIP_POINT_LIMITATION = (
    "Coordinates are an approximate ZIP representative point, not a verified facility or office entrance."
)
CENSUS_POINT_LIMITATION = "Map position uses a Census interpolated street address. Entrance and suite are unverified."
BLANK_STATE_LIMITATION = (
    "The registry row leaves the business state blank. New Jersey is inferred from the NJ postal ZIP and a "
    "matching NJ municipality or locality name."
)


class InputError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InputError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def clean(value):
    return " ".join(str(value or "").split())


def registration_id(row):
    return row[ID_FIELD].strip().upper()


def provider_id(reg_id):
    return f"{MARKET}-hp-" + re.sub(r"[^a-z0-9]+", "-", reg_id.lower()).strip("-")


def zip5(value):
    match = re.fullmatch(r"(\d{5})(?:\s*-\s*\d{4}|\d{4})?", value.strip())
    return match[1] if match else None


def sidecar(research, relative):
    if relative.startswith("state/raw/") or relative == REGISTRY_FILE:
        meta = json.loads((research / (relative + ".json")).read_text())
        return {"sha256": meta["sha256"], "bytes": meta["bytes"], "url": meta["url"],
                "retrievedAt": meta["retrieved_at"]}, meta
    if relative.startswith("geography/raw/"):
        meta = json.loads((research / "geography/source-manifest.json").read_text())["sources"][Path(relative).name]
        return {"sha256": meta["sha256"], "bytes": meta["bytes"], "url": meta["url"],
                "retrievedAt": meta["retrievedAt"]}, meta
    if relative.startswith(OFFICE_GEOCODE + "/"):
        meta = json.loads((research / OFFICE_GEOCODE / "capture.json").read_text())
        return {"sha256": meta[Path(relative).name], "bytes": None, "url": meta["url"],
                "retrievedAt": meta["retrievedAt"]}, meta
    if relative == "geography/nj-zips.json":
        meta = json.loads((research / "geography/manifest.json").read_bytes())["outputs"]["nj-zips.json"]
        return {**meta, "url": None, "retrievedAt": "2026-11-13"}, meta
    if relative == BASELINE:
        meta = json.loads((research / (relative + ".json")).read_bytes())
        return meta, meta
    raise ValueError(f"Unknown captured input: {relative}")


def load_inputs(research):
    """Verify each retained input against its sidecar and the pinned capture, then parse it."""
    data, receipts, metas = {}, {}, {}
    for relative, (pinned_sha, pinned_date) in PINNED.items():
        body = (research / relative).read_bytes()
        receipt, meta = sidecar(research, relative)
        require(sha256(body) == receipt["sha256"], f"Source hash mismatch with its sidecar: {relative}")
        require(receipt["bytes"] in (None, len(body)), f"Source size differs from its sidecar: {relative}")
        require(receipt["sha256"] == pinned_sha, f"Unpinned input capture: {relative}")
        require(receipt["retrievedAt"][:10] == pinned_date, f"Capture date differs from the pinned capture: {relative}")
        data[relative], metas[relative] = body, meta
        receipts[relative] = {**receipt, "bytes": len(body)}

    firms_meta = metas[REGISTRY_FILE]
    rows = workbook_rows(research / REGISTRY_FILE)
    require(len(rows) == firms_meta["displayed_rows"] == firms_meta["exported_rows"] == REGISTRY_ROWS,
            "Registry export row count differs from the retained portal count")
    require(all(registration_id(row).startswith("HP") for row in rows), "Registry export has a non-HP row")

    municipalities = json.loads(data["state/raw/municipalities.json"])
    require(len(municipalities) == MUNICIPALITY_ROWS, "Municipality reference row count changed")
    places = defaultdict(lambda: {"municipality": set(), "locality": set()})
    for row in municipalities:
        county = row["county_name_common"].removesuffix(" County")
        for field in ("municipality_name_common", "municipality_name_nj_1040", "municipality_name_dca"):
            places[place_key(row[field])]["municipality"].add(county)
    counties = {county for entry in places.values() for county in entry["municipality"]}
    html = data["state/raw/localities.html"].decode()
    table = TableRows()
    table.feed(html)
    match = re.search(r"Your search\s+generated (\d+) matches", html)
    require(table.rows and table.rows[0] == ["Local Name", "Municipality", "County"]
            and match and int(match[1]) == len(table.rows) - 1 == LOCALITY_ROWS,
            "Locality reference differs from its reported result count")
    for row in table.rows[1:]:
        if len(row) == 3 and row[2] in counties:
            places[place_key(row[0])]["locality"].add(row[2])

    postal, points, relationships = zip_build.parse_sources(
        {Path(name).name: body for name, body in data.items() if name.startswith("geography/raw/")})
    zips = zip_references(postal, points, relationships)
    require({c for ref in zips.values() for c in ref["counties"]} <= counties,
            "ZIP county names differ from the municipality reference")

    geocodes = office_geocodes(data[f"{OFFICE_GEOCODE}/census-input.csv"],
                               data[f"{OFFICE_GEOCODE}/census-output.csv"],
                               metas[f"{OFFICE_GEOCODE}/census-output.csv"])
    county_fips = {part["countyFips"]: part["county"] for parts in relationships.values() for part in parts
                   if part["countyFips"].startswith("34")}

    runtime_rows = json.loads(gzip.decompress(data[BASELINE]))
    runtime = {p["id"]: p for p in runtime_rows if p["category"] == "home-care" and p["id"].startswith(f"{MARKET}-hp-")}
    registry = {"url": receipts[REGISTRY_FILE]["url"],
                "checkedAt": receipts[REGISTRY_FILE]["retrievedAt"][:10]}
    return {
        "rows": rows, "places": dict(places), "zips": zips, "runtime": runtime,
        "runtimeZips": json.loads(data["geography/nj-zips.json"]), "counties": sorted(counties),
        "registry": registry, "receipts": receipts,
        "officeGeocodes": {"records": geocodes, "countyFips": county_fips,
                           "url": receipts[f"{OFFICE_GEOCODE}/census-output.csv"]["url"],
                           "checkedAt": receipts[f"{OFFICE_GEOCODE}/census-output.csv"]["retrievedAt"][:10]},
    }


def office_geocodes(input_body, output_body, capture):
    inputs = {row[0]: row[1:] for row in csv.reader(io.StringIO(input_body.decode()))}
    outputs = {row[0]: row[1:] for row in csv.reader(io.StringIO(output_body.decode()))}
    require(len(inputs) == len(outputs) == capture["rows"] and inputs.keys() == outputs.keys(),
            "Census office geocode input and output rows differ from the capture receipt")
    return {
        reg_id: {
            "street": inputs[reg_id][0], "city": inputs[reg_id][1], "state": inputs[reg_id][2], "zip": inputs[reg_id][3],
            "match": (outputs[reg_id] + [""] * 11)[1], "exactness": (outputs[reg_id] + [""] * 11)[2],
            "matchedAddress": (outputs[reg_id] + [""] * 11)[3], "coordinates": (outputs[reg_id] + [""] * 11)[4],
            "stateFips": (outputs[reg_id] + [""] * 11)[7], "countyFips": (outputs[reg_id] + [""] * 11)[8],
        }
        for reg_id in sorted(inputs)
    }


def zip_references(postal, points, relationships):
    refs = {}
    for code, records in postal.items():
        records = sorted(records, key=lambda record: (record["city"], record["sourceLine"]))
        if code in points:
            land = [part for part in relationships.get(code, []) if part["landAreaM2"] > 0]
            require(land, f"ZCTA without land county overlap: {code}")
            refs[code] = {
                "city": records[0]["city"], **points[code],
                "coordinateSource": "census_2026_zcta_representative_point",
                "countyBasis": "census_2020_zcta_positive_land_overlap",
                "counties": sorted({p["county"] for p in land if p["countyFips"].startswith("34")}),
                "outOfStateCountyFips": sorted(p["countyFips"] for p in land if not p["countyFips"].startswith("34")),
            }
        else:
            refs[code] = {
                "city": records[0]["city"], "lat": records[0]["lat"], "lng": records[0]["lng"],
                "coordinateSource": "geonames_published_postal_point",
                "countyBasis": "geonames_postal_county_attribution",
                "counties": sorted({record["county"] for record in records}),
                "outOfStateCountyFips": [],
            }
    return refs


def locate(row, places, zips):
    code = zip5(row["Business Zipcode"])
    ref = zips.get(code) if code else None
    place = places.get(place_key(row["Business City"]), {})
    place_counties = set().union(*place.values()) if place else set()
    zip_counties = set(ref["counties"]) if ref else set()
    return {
        "state": clean(row["Business USA State"]).upper(),
        "address": clean(row["Business Address"]),
        "zip": code, "zipRef": ref,
        "placeCounties": place_counties,
        "placeSources": sorted(kind for kind, values in place.items() if values),
        "zipCounties": zip_counties,
        "overlap": place_counties & zip_counties,
    }


# Ordered eligibility table for a registration's single Active variant. The first matching rule decides.
RULES = (
    ("excluded", "outside_nj", lambda loc: loc["state"] not in ("NJ", "")),
    ("held", "invalid_zip", lambda loc: loc["zip"] is None),
    ("excluded", "outside_nj", lambda loc: loc["state"] == "" and loc["zipRef"] is None),
    ("held", "zip_not_in_nj_postal_reference", lambda loc: loc["zipRef"] is None),
    ("held", "missing_address", lambda loc: not re.search("[A-Za-z]", loc["address"])),
    ("held", "po_box_address", lambda loc: PO_BOX.search(loc["address"])),
    ("held", "place_name_unmatched", lambda loc: not loc["placeCounties"]),
    ("held", "city_zip_county_conflict", lambda loc: not loc["overlap"]),
    ("held", "county_ambiguous", lambda loc: len(loc["overlap"]) > 1 and not loc["overlap"] <= TARGET),
    ("excluded", "outside_target_counties", lambda loc: not loc["overlap"] & TARGET),
)


def decide(loc):
    for outcome, reason, applies in RULES:
        if applies(loc):
            return outcome, reason
    return "published", None


def census_office_point(reg_id, row, loc, counties, geocodes):
    """Accept a Census batch result only when it is an exact match for this registration's own office address."""
    geocode = geocodes["records"].get(reg_id)
    if geocode is None:
        return None, "not_in_capture"
    if (geocode["match"], geocode["exactness"]) != ("Match", "Exact"):
        return None, "not_exact_match"
    street = clean(geocode["street"]).upper()
    if (geocode["state"] != "NJ" or geocode["zip"] != loc["zip"] or not street
            or clean(geocode["city"]).upper() != clean(row["Business City"]).upper()
            or not loc["address"].upper().startswith(street)):
        return None, "input_differs_from_registry_row"
    matched = clean(geocode["matchedAddress"]).upper()
    if matched.rsplit(",", 1)[-1].strip() != loc["zip"]:
        return None, "matched_zip_differs"
    if NORMALIZE_STREET(matched.split(",")[0].strip()) != NORMALIZE_STREET(street):
        return None, "matched_street_differs"
    if geocodes["countyFips"].get(geocode["stateFips"] + geocode["countyFips"]) not in counties:
        return None, "census_county_differs"
    lng, lat = (float(value) for value in geocode["coordinates"].split(","))
    if not (38.8 <= lat <= 41.4 and -75.6 <= lng <= -73.8):
        return None, "point_outside_nj_bounds"
    return {"lat": lat, "lng": lng}, "accepted"


def location_text(row):
    return (clean(row["Business Address"]), row["Business City"], zip5(row["Business Zipcode"]))


def warnings_for(reg_id, primary, superseded, registry):
    warnings = []
    expires = excel_date(primary["Expiration Date"])
    if expires and expires < registry["checkedAt"]:
        warnings.append(
            f"The registry lists this registration as Active with expiration {expires}, before the "
            f"{registry['checkedAt']} capture. Both values are kept as published. Confirm the current "
            "registration with NJ Consumer Affairs.")
    for row in superseded:
        if location_text(row) != location_text(primary):
            address, city, _ = location_text(row)
            warnings.append(
                f"The registry also lists source row {row['source_row']} for {reg_id} as "
                f"{row['License Status']} at {address}, {city} {clean(row['Business Zipcode'])}. "
                "This record uses the Active row's office address.")
    return warnings


def provider_record(reg_id, row, loc, registry, office=None):
    expires = excel_date(row["Expiration Date"])
    limitations = list(BASE_LIMITATIONS)
    limitations.append(
        f"Portal lists expiration {expires}. Active status is retained as published; neither field overrides the other."
        if expires else "Portal lists no expiration date. Active status is retained as published.")
    if loc["state"] == "":
        limitations.append(BLANK_STATE_LIMITATION)
    limitations.append(CENSUS_POINT_LIMITATION if office else ZIP_POINT_LIMITATION)
    point = office or loc["zipRef"]
    record = {
        "id": provider_id(reg_id), "name": row["Business Name"], "category": "home-care",
        "address": loc["address"], "city": row["Business City"], "state": "NJ", "zip": loc["zip"],
        "lat": point["lat"], "lng": point["lng"], "locationKind": "office" if office else "zip",
        "description": (f"Registered health care service firm. Registration {reg_id} is listed Active. "
                        f"Business office in {row['Business City']}. Not a verified service area."),
        "services": [], "officialRecord": True,
        "sources": [{
            "title": "NJ health care service firm registration",
            "publisher": "New Jersey Division of Consumer Affairs",
            "url": registry["url"], "kind": "regulatory", "checkedAt": registry["checkedAt"],
            "supports": f"Registration {reg_id}, source row {row['source_row']}. "
                        "Active registry status and business office address only.",
        }],
        "warnings": [], "limitations": limitations,
    }
    if office:
        record["sources"].append({
            "title": "Census interpolated street address", "publisher": "U.S. Census Bureau",
            "url": office["url"], "kind": "regulatory", "checkedAt": office["checkedAt"],
            "supports": "Address-level map position. Census interpolated street address from an exact batch match.",
        })
    phone = clean(row["Business Phone"])
    if phone and phone != "0":
        record["phone"] = phone
    return record


IDENTITY_KEYS = ("id", "name", "category", "address", "city", "state", "zip")


def overlay_runtime(generated, previous):
    return [key for key in IDENTITY_KEYS if generated.get(key) != previous.get(key)]


def resolve(rows, places, zips, runtime, registry, geocodes):
    """Assign every registry row one disposition and every registration ID one outcome."""
    groups = defaultdict(list)
    for row in rows:
        groups[registration_id(row)].append(row)
    row_ledger, registrations, providers = {}, [], []
    runtime_report = {"reused": [], "regenerated": [], "omitted": [], "zipPointMismatches": [], "warningsAdded": 0}

    for reg_id in sorted(groups):
        variants = {}
        for row in groups[reg_id]:
            key = tuple((k, reg_id if k == ID_FIELD else v) for k, v in row.items() if k != "source_row")
            variants.setdefault(key, []).append(row)
        firsts = [members[0] for members in variants.values()]
        active = [row for row in firsts if row["License Status"] == "Active"]
        for members in variants.values():
            for duplicate in members[1:]:
                row_ledger[duplicate["source_row"]] = {"disposition": "exact_duplicate", "primaryRow": members[0]["source_row"]}
        entry = {
            "registrationId": reg_id,
            "rows": [row["source_row"] for row in groups[reg_id]],
            "statuses": sorted({row["License Status"] for row in groups[reg_id]}),
        }
        literal_ids = sorted({row[ID_FIELD] for row in groups[reg_id]})
        if literal_ids != [reg_id]:
            entry["sourceIds"] = literal_ids
        if len(firsts) > 1:
            entry["variantConflict"] = {
                "rows": [row["source_row"] for row in firsts],
                "fields": sorted(k for k in firsts[0] if k != "source_row" and len({clean(r[k]) for r in firsts}) > 1),
            }
        pid = provider_id(reg_id)
        primary = active[0] if active else firsts[0]
        loc = locate(primary, places, zips)
        entry["primaryRow"] = primary["source_row"]
        if len(loc["overlap"]) == 1:
            entry["locatedCounty"] = next(iter(loc["overlap"]))

        if not active:
            entry.update(outcome="excluded", reason="no_active_row")
            for row in firsts:
                row_ledger[row["source_row"]] = {"disposition": "excluded", "reason": "no_active_row"}
            registrations.append(entry)
            if pid in runtime:
                runtime_report["omitted"].append({"providerId": pid, "reason": "no_active_row"})
            continue

        for row in firsts:
            if row["License Status"] != "Active":
                row_ledger[row["source_row"]] = {"disposition": "superseded_non_active", "primaryRow": primary["source_row"]}
        if len(active) > 1:
            outcome, reason = "held", "conflicting_active_rows"
        else:
            outcome, reason = decide(loc)
        expires = excel_date(primary["Expiration Date"])
        candidates = loc["overlap"] or (loc["placeCounties"] | loc["zipCounties"])
        entry.update(
            activeRows=[row["source_row"] for row in active],
            status=primary["License Status"], expiration=expires,
            expirationPastAtCapture=bool(expires and expires < registry["checkedAt"]),
            businessState=loc["state"], city=primary["Business City"], zip=loc["zip"],
            placeCounties=sorted(loc["placeCounties"]), placeSources=loc["placeSources"],
            zipCounties=sorted(loc["zipCounties"]),
            zipCountyBasis=loc["zipRef"]["countyBasis"] if loc["zipRef"] else None,
            candidateCounties=sorted(candidates),
            targetRelevant=bool(candidates & TARGET),
            outcome=outcome,
        )
        if reason:
            entry["reason"] = reason
        for row in active:
            row_ledger[row["source_row"]] = {"disposition": outcome, **({"reason": reason} if reason else {})}

        if outcome == "published":
            county = next(iter(loc["overlap"])) if len(loc["overlap"]) == 1 else None
            entry.update(county=county, countyAssignment="single_overlap" if county else "multiple_target_overlap",
                         tiers=sorted({TIERS[c] for c in loc["overlap"]}), providerId=pid)
            superseded = [row for row in firsts if row["License Status"] != "Active"]
            warnings = warnings_for(reg_id, primary, superseded, registry)
            generated = provider_record(reg_id, primary, loc, registry)
            record = generated
            if pid in runtime:
                mismatches = overlay_runtime(generated, runtime[pid])
                if mismatches:
                    entry["runtime"] = "regenerated"
                    runtime_report["regenerated"].append({"providerId": pid, "fields": mismatches})
                else:
                    entry["runtime"] = "reused"
                    runtime_report["reused"].append(pid)
                    previous = runtime[pid]
                    record.update({key: previous[key] for key in ("locationKind", "lat", "lng")})
                    record["sources"].extend(previous["sources"][1:])
                    if record["locationKind"] == "office":
                        record["limitations"].remove(ZIP_POINT_LIMITATION)
                        record["limitations"].extend(s for s in previous["limitations"] if s.startswith("Map position"))
                    if record["locationKind"] == "zip" and (record["lat"], record["lng"]) != (generated["lat"], generated["lng"]):
                        runtime_report["zipPointMismatches"].append(pid)
                    added = [w for w in warnings if w not in record["warnings"]]
                    runtime_report["warningsAdded"] += bool(added)
                    warnings = record["warnings"] + added
            else:
                entry["runtime"] = "new"
                point, entry["officeGeocode"] = census_office_point(
                    reg_id, primary, loc, {county} if county else loc["overlap"], geocodes)
                if point:
                    record = provider_record(reg_id, primary, loc, registry,
                                             {**point, "url": geocodes["url"], "checkedAt": geocodes["checkedAt"]})
            record["warnings"] = warnings
            entry["locationKind"] = record["locationKind"]
            entry["warnings"] = len(warnings)
            providers.append(record)
        elif pid in runtime:
            entry["runtime"] = "omitted"
            runtime_report["omitted"].append({"providerId": pid, "reason": reason})
        registrations.append(entry)

    require(sorted(row_ledger) == sorted(row["source_row"] for row in rows), "A source row lacks exactly one disposition")
    row_entries = []
    by_row = {row["source_row"]: row for row in rows}
    for number in sorted(row_ledger):
        row = by_row[number]
        row_entries.append({"row": number, "registrationId": registration_id(row),
                            "status": row["License Status"], **row_ledger[number]})
    accounted = set(runtime_report["reused"]) | {r["providerId"] for r in runtime_report["regenerated"]} | {
        r["providerId"] for r in runtime_report["omitted"]}
    runtime_report["notInRegistry"] = sorted(set(runtime) - accounted)
    return {
        "providers": sorted(providers, key=lambda p: p["id"]),
        "registrations": registrations,
        "rows": row_entries,
        "runtime": runtime_report,
        "zips": {p["zip"]: zips[p["zip"]] for p in providers},
    }


def reconcile(result, inputs):
    rows, registrations, providers = inputs["rows"], result["registrations"], result["providers"]
    registry = inputs["registry"]
    active_rows = [row for row in rows if row["License Status"] == "Active"]
    held = [r for r in registrations if r["outcome"] == "held"]
    published = [r for r in registrations if r["outcome"] == "published"]
    counties = {}
    for county in inputs["counties"]:
        counties[county] = {
            "tier": TIERS.get(county),
            "activeIdsLocated": sum(r.get("locatedCounty") == county and "activeRows" in r for r in registrations),
            "published": sum(r.get("county") == county for r in published),
            "publishedRuntimeReused": sum(r.get("county") == county and r["runtime"] == "reused" for r in published),
            "publishedNew": sum(r.get("county") == county and r["runtime"] == "new" for r in published),
            "heldCandidate": sum(county in r["candidateCounties"] for r in held),
            "excludedOutsideTarget": sum(r.get("reason") == "outside_target_counties" and r.get("locatedCounty") == county
                                         for r in registrations),
            "inactiveIdsLocated": sum(r.get("locatedCounty") == county and r["outcome"] == "excluded"
                                      and r["reason"] == "no_active_row" for r in registrations),
        }
    runtime = result["runtime"]
    runtime_records = inputs["runtime"]
    zips = result["zips"]
    return {
        "schemaVersion": 1,
        "registry": {
            "url": registry["url"], "checkedAt": registry["checkedAt"], "dataAsOf": None,
            "rows": len(rows),
            "distinctIds": len(registrations),
            "activeRows": len(active_rows),
            "idsWithActiveRow": sum("activeRows" in r for r in registrations),
            "statusCounts": dict(sorted(Counter(row["License Status"] for row in rows).items())),
            "caseNormalizedIds": [{"registrationId": r["registrationId"], "sourceIds": r["sourceIds"]}
                                  for r in registrations if "sourceIds" in r],
            "idsWithDuplicateRows": sum(len(r["rows"]) > 1 for r in registrations),
            "exactDuplicateRows": sum(row["disposition"] == "exact_duplicate" for row in result["rows"]),
            "idsWithConflictingVariants": [
                {"registrationId": r["registrationId"], **r["variantConflict"], "outcome": r["outcome"]}
                for r in registrations if "variantConflict" in r],
            "activeRowsPastExpirationAtCapture": sum(
                bool(excel_date(row["Expiration Date"])) and excel_date(row["Expiration Date"]) < registry["checkedAt"]
                for row in active_rows),
            "activeRowsWithoutExpiration": sum(not excel_date(row["Expiration Date"]) for row in active_rows),
            "activeRowsWithBlankState": sum(not clean(row["Business USA State"]) for row in active_rows),
        },
        "rowDispositions": dict(sorted(Counter(row["disposition"] for row in result["rows"]).items())),
        "registrationOutcomes": {
            "published": len(published),
            "held": dict(sorted(Counter(r["reason"] for r in held).items())),
            "excluded": dict(sorted(Counter(r["reason"] for r in registrations if r["outcome"] == "excluded").items())),
        },
        "targetCounties": {"core": sorted(c for c, t in TIERS.items() if t == "core"),
                           "ring": sorted(c for c, t in TIERS.items() if t == "ring"),
                           "preserved": sorted(c for c, t in TIERS.items() if t == "preserved")},
        "counties": counties,
        "publishedMultipleTargetCounties": [
            {"providerId": r["providerId"], "counties": r["candidateCounties"]}
            for r in published if r["county"] is None],
        "heldTargetRelevant": [
            {"registrationId": r["registrationId"], "reason": r["reason"], "candidateCounties": r["candidateCounties"],
             "city": r["city"], "zip": r["zip"], **({"runtime": r["runtime"]} if "runtime" in r else {})}
            for r in held if r["targetRelevant"]],
        "heldOutsideTarget": dict(sorted(Counter(r["reason"] for r in held if not r["targetRelevant"]).items())),
        "runtime": {
            "homeCareRecords": len(runtime_records),
            "byLocationKind": dict(sorted(Counter(p["locationKind"] for p in runtime_records.values()).items())),
            "reused": len(runtime["reused"]),
            "reusedByLocationKind": dict(sorted(Counter(
                runtime_records[pid]["locationKind"] for pid in runtime["reused"]).items())),
            "regenerated": runtime["regenerated"],
            "omitted": runtime["omitted"],
            "notInRegistry": runtime["notInRegistry"],
            "recordsWithWarningsAdded": runtime["warningsAdded"],
            "zipPointMismatches": runtime["zipPointMismatches"],
        },
        "published": {
            "total": len(providers),
            "byLocationKind": dict(sorted(Counter(p["locationKind"] for p in providers).items())),
            "byRuntime": dict(sorted(Counter(r["runtime"] for r in published).items())),
            "newOfficeGeocode": dict(sorted(Counter(r["officeGeocode"] for r in published if "officeGeocode" in r).items())),
            "byTier": dict(sorted(Counter("+".join(r["tiers"]) for r in published).items())),
            "withPastExpirationWarning": sum(r["expirationPastAtCapture"] for r in published),
            "withSupersededAddressWarning": sum(any("also lists source row" in w for w in p["warnings"]) for p in providers),
            "withBlankBusinessState": sum(r["businessState"] == "" for r in published),
            "zipsUsed": len(zips),
            "zipsOutsideRuntimeLookup": sorted(z for z in zips if z not in inputs["runtimeZips"]),
            "runtimeLookupPointMismatches": sorted(
                z for z in zips if z in inputs["runtimeZips"]
                and inputs["runtimeZips"][z] != {k: zips[z][k] for k in ("city", "lat", "lng")}),
        },
    }


def json_lines(records):
    body = ",\n".join(json.dumps(r, sort_keys=True, ensure_ascii=False, separators=(",", ":")) for r in records)
    return ("[\n" + body + "\n]\n").encode()


def json_document(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def render(research):
    inputs = load_inputs(research)
    result = resolve(inputs["rows"], inputs["places"], inputs["zips"], inputs["runtime"], inputs["registry"],
                     inputs["officeGeocodes"])
    reconciliation = reconcile(result, inputs)
    zip_refs = {code: {**ref, "inRuntimeLookup": code in inputs["runtimeZips"]} for code, ref in sorted(result["zips"].items())}
    outputs = {
        "market-zips.json": (json_document({z: {k: v[k] for k in ("city", "lat", "lng")} for z, v in sorted(inputs["zips"].items()) if TARGET.intersection(v["counties"])}), None),
        "providers.json": (json_lines(result["providers"]), len(result["providers"])),
        "registrations.json": (json_lines(result["registrations"]), len(result["registrations"])),
        "rows.json": (json_lines(result["rows"]), len(result["rows"])),
        "zip-references.json": (json_document(zip_refs), len(zip_refs)),
        "reconciliation.json": (json_document(reconciliation), None),
    }
    manifest = {
        "schemaVersion": 1,
        "builder": BUILDER,
        "consumer": "providers.json",
        "inputs": inputs["receipts"],
        "outputs": {name: {"sha256": sha256(body), "bytes": len(body), **({"records": n} if n is not None else {})}
                    for name, (body, n) in outputs.items()},
        "sourceReachability": SOURCE_REACHABILITY,
    }
    files = {name: body for name, (body, _) in outputs.items()}
    files["manifest.json"] = json_document(manifest)
    return files, reconciliation


def write(output, files):
    """Replace only files this builder owns: absent, recorded in its previous manifest, or already current."""
    previous = {}
    manifest_path = output / "manifest.json"
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        require(old.get("builder") == BUILDER, "manifest.json was not written by this builder")
        previous = {name: entry["sha256"] for name, entry in old["outputs"].items()}
    for name, body in files.items():
        path = output / name
        if path.exists() and name != "manifest.json":
            current = sha256(path.read_bytes())
            require(current in (previous.get(name), sha256(body)),
                    f"{path} exists and was not written by this builder or was modified. Move it aside to rebuild.")
    output.mkdir(parents=True, exist_ok=True)
    for name in sorted(files, key=lambda n: n == "manifest.json"):
        temporary = output / f".{name}.tmp"
        temporary.write_bytes(files[name])
        os.replace(temporary, output / name)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-root", type=Path, default=DEFAULT_RESEARCH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Verify inputs and compare outputs without writing")
    args = parser.parse_args(argv)
    try:
        files, reconciliation = render(args.research_root.resolve())
        output = args.output_dir.resolve()
        if args.check:
            stale = [name for name, body in files.items()
                     if not (output / name).exists() or (output / name).read_bytes() != body]
            require(not stale, "Generated output differs: " + ", ".join(stale))
        else:
            write(output, files)
    except (InputError, OSError, KeyError, StopIteration, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps({
        "mode": "check" if args.check else "build",
        "registry": {k: reconciliation["registry"][k] for k in ("rows", "distinctIds", "activeRows", "idsWithActiveRow")},
        "published": reconciliation["published"]["total"],
        "byRuntime": reconciliation["published"]["byRuntime"],
        "held": reconciliation["registrationOutcomes"]["held"],
        "runtimeOmitted": len(reconciliation["runtime"]["omitted"]),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
