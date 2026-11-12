#!/usr/bin/env python3
"""Build Harbor's North Jersey ZIP research snapshot using retained public inputs."""

import argparse
import csv
import hashlib
import io
import json
import math
import re
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "research/north-jersey/geography"
COUNTIES = {
    "34003": "Bergen",
    "34013": "Essex",
    "34017": "Hudson",
    "34027": "Morris",
    "34031": "Passaic",
    "34039": "Union",
}
SOURCES = {
    "geonames-US.zip": "https://download.geonames.org/export/zip/US.zip",
    "geonames-readme.txt": "https://download.geonames.org/export/zip/readme.txt",
    "census-2026-zcta.zip": (
        "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
        "2026_Gazetteer/2026_Gaz_zcta_national.zip"
    ),
    "census-2020-zcta-county.txt": (
        "https://www2.census.gov/geo/docs/maps-data/data/rel2020/"
        "zcta520/tab20_zcta520_county20_natl.txt"
    ),
}


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def refresh(output):
    raw = output / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 1, "sources": {}}
    # Fetch every input before replacing the retained snapshot.
    downloads = {}
    for name, url in SOURCES.items():
        request = urllib.request.Request(url, headers={"User-Agent": "Harbor-geography/1.0"})
        with urllib.request.urlopen(request, timeout=90) as response:
            data = response.read()
            effective_url = response.url
        require(data, f"Empty source: {url}")
        downloads[name] = data
        manifest["sources"][name] = {
            **digest(data),
            "url": url,
            "effectiveUrl": effective_url,
            "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    parse_sources(downloads)
    for name, data in downloads.items():
        (raw / name).write_bytes(data)
    (output / "source-manifest.json").write_bytes(encoded(manifest))


def load_sources(output):
    manifest = json.loads((output / "source-manifest.json").read_text())
    require(set(manifest["sources"]) == set(SOURCES), "Unexpected source manifest")
    data = {}
    for name, url in SOURCES.items():
        entry = manifest["sources"][name]
        require(entry["url"] == url, f"Unexpected source URL: {name}")
        data[name] = (output / "raw" / name).read_bytes()
        require(
            all(entry[key] == value for key, value in digest(data[name]).items()),
            f"Source hash mismatch: {name}",
        )
    return data, manifest


def archive_text(data, suffix):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [name for name in archive.namelist() if name.endswith(suffix)]
        require(len(names) == 1, f"Expected one archive member ending in {suffix}")
        return archive.read(names[0]).decode("utf-8-sig")


def parse_sources(data):
    require(
        "Creative Commons Attribution 4.0" in data["geonames-readme.txt"].decode(),
        "Review changed GeoNames license before rebuilding",
    )
    postal = defaultdict(list)
    for line_number, fields in enumerate(
        csv.reader(io.StringIO(archive_text(data["geonames-US.zip"], "US.txt")), delimiter="\t"),
        start=1,
    ):
        require(len(fields) == 12, f"Unexpected GeoNames row {line_number}")
        if fields[0] != "US" or fields[4] != "NJ":
            continue
        code = fields[1]
        require(re.fullmatch(r"\d{5}", code), f"Invalid NJ ZIP: {code}")
        point = {"lat": float(fields[9]), "lng": float(fields[10])}
        validate_point(code, point)
        require(re.fullmatch(r"\d{3}", fields[6]), f"Missing NJ county: {code}")
        postal[code].append({
            "city": fields[2],
            **point,
            "countyFips": "34" + fields[6],
            "county": fields[5],
            "accuracy": int(fields[11]) if fields[11] else None,
            "sourceLine": line_number,
        })
    require(postal, "No NJ postal records")

    points = {}
    gazetteer = archive_text(data["census-2026-zcta.zip"], ".txt")
    reader = csv.DictReader(io.StringIO(gazetteer), delimiter="|")
    reader.fieldnames = [name.strip() for name in reader.fieldnames]
    require({"GEOID", "INTPTLAT", "INTPTLONG"} <= set(reader.fieldnames), "Gazetteer schema changed")
    for row in reader:
        code = row["GEOID"].strip()
        require(code not in points, f"Duplicate Gazetteer GEOID: {code}")
        points[code] = {"lat": float(row["INTPTLAT"]), "lng": float(row["INTPTLONG"])}

    relationships = defaultdict(list)
    reader = csv.DictReader(
        io.StringIO(data["census-2020-zcta-county.txt"].decode("utf-8-sig")), delimiter="|"
    )
    required = {"GEOID_ZCTA5_20", "GEOID_COUNTY_20", "NAMELSAD_COUNTY_20",
                "AREALAND_PART", "AREAWATER_PART", "AREALAND_ZCTA5_20"}
    require(required <= set(reader.fieldnames), "County relationship schema changed")
    seen = set()
    for row in reader:
        code, fips = row["GEOID_ZCTA5_20"], row["GEOID_COUNTY_20"]
        if not code or not fips:
            continue
        require((code, fips) not in seen, f"Duplicate county relationship: {code}/{fips}")
        seen.add((code, fips))
        land, water = int(row["AREALAND_PART"]), int(row["AREAWATER_PART"])
        require(land >= 0 and water >= 0, f"Negative area: {code}/{fips}")
        relationships[code].append({
            "countyFips": fips,
            "county": row["NAMELSAD_COUNTY_20"].removesuffix(" County"),
            "landAreaM2": land,
            "waterAreaM2": water,
            "zctaLandAreaM2": int(row["AREALAND_ZCTA5_20"]),
        })
    require(relationships, "No ZCTA county relationships")
    return dict(postal), points, dict(relationships)


def validate_point(code, point):
    require(
        math.isfinite(point["lat"]) and math.isfinite(point["lng"])
        and 38.8 <= point["lat"] <= 41.4 and -75.6 <= point["lng"] <= -73.8,
        f"Invalid New Jersey point: {code} {point}",
    )


def build(data, source_manifest):
    postal, points, relationships = parse_sources(data)
    lookup, provenance, excluded = {}, {}, {}
    county_zips = {fips: {"county": name, "zips": []} for fips, name in COUNTIES.items()}
    for code, records in sorted(postal.items()):
        records = sorted(records, key=lambda record: (record["city"], record["sourceLine"]))
        record = records[0]
        parts = sorted(relationships.get(code, []), key=lambda part: part["countyFips"])
        land_parts = [part for part in parts if part["landAreaM2"] > 0]
        has_zcta = code in points
        if has_zcta:
            require(land_parts, f"Gazetteer ZIP lacks county land relationships: {code}")
            memberships = land_parts
            basis = "census_2020_zcta_positive_land_overlap"
            primary = max(land_parts, key=lambda part: (part["landAreaM2"], part["countyFips"]))
            target = sorted({part["countyFips"] for part in land_parts} & COUNTIES.keys())
        else:
            require(not parts, f"County relationship ZIP missing from Gazetteer: {code}")
            memberships = [
                {"county": name, "countyFips": fips}
                for fips, name in sorted({(r["countyFips"], r["county"]) for r in records})
            ]
            basis = "geonames_postal_county_attribution"
            primary = memberships[0]
            target = sorted({part["countyFips"] for part in memberships} & COUNTIES.keys())
        if not target:
            excluded[code] = {
                "reason": "outside_target_counties",
                "cities": sorted({r["city"] for r in records}),
                "countyMembershipBasis": basis,
                "countyFips": [part["countyFips"] for part in memberships],
                "geonamesCountyFips": sorted({r["countyFips"] for r in records}),
            }
            continue
        point = points[code] if has_zcta else {key: record[key] for key in ("lat", "lng")}
        validate_point(code, point)
        lookup[code] = {"city": record["city"], **point}
        provenance[code] = {
            "citySource": "geonames_US_postal_export",
            "coordinateSource": (
                "census_2026_zcta_representative_point"
                if has_zcta else "geonames_published_postal_point"
            ),
            "hasZcta": has_zcta,
            "zcta": code if has_zcta else None,
            "countyMembershipBasis": basis,
            "countyMemberships": memberships,
            "waterOnlyCountyOverlaps": [part for part in parts if part["landAreaM2"] == 0],
            "primaryCountyFips": primary["countyFips"],
            "primaryCountyRule": "largest_zcta_land_overlap" if has_zcta else "first_postal_county",
            "targetCountyFips": target,
            "geonamesRecords": records,
        }
        for fips in target:
            county_zips[fips]["zips"].append(code)

    census_candidates = {
        code for code, parts in relationships.items()
        if any(part["countyFips"] in COUNTIES and part["landAreaM2"] > 0 for part in parts)
    }
    missing_postal = sorted(census_candidates - postal.keys())
    for code in missing_postal:
        excluded[code] = {
            "reason": "target_zcta_without_NJ_geonames_postal_record",
            "countyMemberships": relationships[code],
        }

    require(lookup, "No ZIPs selected")
    for code, city, fips in [("07960", "Morristown", "34027"), ("07083", "Union", "34039")]:
        require(lookup[code]["city"] == city, f"Example city changed: {code}")
        require(fips in provenance[code]["targetCountyFips"], f"Example county changed: {code}")
        require(lookup[code] == {"city": city, **points[code]}, f"Example point mismatch: {code}")
    require(set(lookup).isdisjoint(excluded), "Included ZIP also excluded")
    require(set(postal) == (set(lookup) | (set(excluded) & set(postal))), "Postal accounting failed")
    for fips, county in county_zips.items():
        require(county["zips"], f"No ZIPs for {fips}")
    cross_county = sorted(
        code for code, item in provenance.items() if len(item["countyMemberships"]) > 1
    )
    source_disagreements = sorted(
        code for code, item in provenance.items()
        if item["hasZcta"]
        and {r["countyFips"] for r in item["geonamesRecords"]}
        - {part["countyFips"] for part in item["countyMemberships"]}
    )
    validation = {
        "schemaVersion": 1,
        "njPostalZipCount": len(postal),
        "includedZipCount": len(lookup),
        "censusCoordinateCount": sum(item["hasZcta"] for item in provenance.values()),
        "postalFallbackCoordinateCount": sum(not item["hasZcta"] for item in provenance.values()),
        "excludedByReason": dict(Counter(item["reason"] for item in excluded.values())),
        "countyZipCounts": {item["county"]: len(item["zips"]) for item in county_zips.values()},
        "crossCountyZips": cross_county,
        "targetZctasWithoutPostalRecords": missing_postal,
        "geonamesCountyOutsideCensusLandMembership": source_disagreements,
        "examples": {
            code: {"point": lookup[code], "provenance": provenance[code]}
            for code in ("07960", "07083")
        },
    }
    outputs = {
        "nj-zips.json": lookup,
        "nj-zips-provenance.json": provenance,
        "nj-county-zips.json": county_zips,
        "exclusions.json": excluded,
        "validation.json": validation,
    }
    serialized = {name: encoded(value) for name, value in outputs.items()}
    manifest = {
        "schemaVersion": 1,
        "sourceManifestSha256": hashlib.sha256(encoded(source_manifest)).hexdigest(),
        "sources": source_manifest["sources"],
        "outputs": {name: digest(value) for name, value in serialized.items()},
        "scope": {"state": "NJ", "counties": COUNTIES},
    }
    serialized["manifest.json"] = encoded(manifest)
    return serialized, validation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh", action="store_true", help="Download and retain a new public source snapshot")
    mode.add_argument("--check", action="store_true", help="Verify source hashes and compare all outputs without writing")
    mode.add_argument("--offline", action="store_true", help="Rebuild from retained inputs (the default)")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if args.refresh:
        refresh(output)
    data, source_manifest = load_sources(output)
    outputs, validation = build(data, source_manifest)
    for name, value in outputs.items():
        if args.check:
            require((output / name).read_bytes() == value, f"Generated output differs: {name}")
        else:
            (output / name).write_bytes(value)
    print(json.dumps({
        "mode": "check" if args.check else "build",
        **{key: validation[key] for key in (
            "njPostalZipCount", "includedZipCount", "censusCoordinateCount",
            "postalFallbackCoordinateCount", "excludedByReason", "countyZipCounts",
        )},
    }, indent=2))


if __name__ == "__main__":
    main()
