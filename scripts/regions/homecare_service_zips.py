#!/usr/bin/env python3
"""Resolve operator-reviewed New Jersey home-visit areas to postal ZIPs.

The public API keeps source wording and geographic proof separate::

    geography = Geography.load()
    result = resolve_service_zips(
        [SourceArea(
            label="Essex County",
            kind="county",
            scope="full",
            source_url="https://example.org/agency/service-area",
            quote="We serve all of Essex County.",
        )],
        geography,
        market_zips={"07003", "07004"},
    )

``SourceArea`` is the only supported claim shape. A caller must set
``scope="full"``. The resolver never parses prose, mailing names, or points.
It returns JSON-serializable dictionaries with sorted ZIPs, per-ZIP evidence,
unsupported inputs, unmatched labels, excluded boundary derivations, and
market membership diagnostics.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Iterable, Literal, Mapping
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GEOGRAPHY_DIR = ROOT / "research/north-jersey/geography"
DEFAULT_SUBDIVISION_DIR = (
    ROOT / "research/north-jersey/home-care-supply/service-geography"
)
COUNTY_RELATION = "census-2020-zcta-county.txt"
GEONAMES_ARCHIVE = "geonames-US.zip"
GAZETTEER_ARCHIVE = "census-2026-zcta.zip"

COUNTY_COLUMNS = (
    "OID_ZCTA5_20", "GEOID_ZCTA5_20", "NAMELSAD_ZCTA5_20",
    "AREALAND_ZCTA5_20", "AREAWATER_ZCTA5_20", "MTFCC_ZCTA5_20",
    "CLASSFP_ZCTA5_20", "FUNCSTAT_ZCTA5_20", "OID_COUNTY_20",
    "GEOID_COUNTY_20", "NAMELSAD_COUNTY_20", "AREALAND_COUNTY_20",
    "AREAWATER_COUNTY_20", "MTFCC_COUNTY_20", "CLASSFP_COUNTY_20",
    "FUNCSTAT_COUNTY_20", "AREALAND_PART", "AREAWATER_PART",
)
SUBDIVISION_COLUMNS = (
    "OID_ZCTA5_20", "GEOID_ZCTA5_20", "NAMELSAD_ZCTA5_20",
    "AREALAND_ZCTA5_20", "AREAWATER_ZCTA5_20", "MTFCC_ZCTA5_20",
    "CLASSFP_ZCTA5_20", "FUNCSTAT_ZCTA5_20", "OID_COUSUB_20",
    "GEOID_COUSUB_20", "NAMELSAD_COUSUB_20", "AREALAND_COUSUB_20",
    "AREAWATER_COUSUB_20", "MTFCC_COUSUB_20", "CLASSFP_COUSUB_20",
    "FUNCSTAT_COUSUB_20", "AREALAND_PART", "AREAWATER_PART",
)
ZIP_RE = re.compile(r"[0-9]{5}")
COUNTY_RE = re.compile(r"[0-9]{5}")
SUBDIVISION_RE = re.compile(r"[0-9]{10}")
MUNICIPAL_SUFFIXES = (" borough", " city", " town", " township", " village")
SUPPORTED_SUBDIVISIONS = {("T1", "A"), ("C5", "F")}

AreaKind = Literal["zip", "county", "municipality"]
AreaScope = Literal["full", "partial", "unknown"]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _is_zip(value: object) -> bool:
    return isinstance(value, str) and value.isascii() and ZIP_RE.fullmatch(value) is not None


def _canonical_label(value: str) -> str:
    return " ".join(value.split()).casefold()


def _digest(data: bytes) -> tuple[int, str]:
    return len(data), hashlib.sha256(data).hexdigest()


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(
        ValueError(f"{path}: invalid JSON number {value}")
    ))


def _verified_file(path: Path, entry: object, label: str) -> bytes:
    _require(isinstance(entry, dict), f"{label}: expected manifest object")
    _require(type(entry.get("bytes")) is int and entry["bytes"] >= 0,
             f"{label}: invalid byte count")
    _require(isinstance(entry.get("sha256"), str)
             and re.fullmatch(r"[a-f0-9]{64}", entry["sha256"]) is not None,
             f"{label}: invalid SHA-256")
    data = path.read_bytes()
    size, digest = _digest(data)
    _require(size == entry["bytes"], f"{label}: byte count mismatch")
    _require(digest == entry["sha256"], f"{label}: SHA-256 mismatch")
    return data


def _int_area(value: str, path: str) -> int:
    _require(bool(value) and value.isascii() and value.isdecimal(),
             f"{path}: expected nonnegative integer area")
    return int(value)


def _relation_rows(data: bytes, columns: tuple[str, ...], label: str) -> list[dict[str, str]]:
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text), delimiter="|")
    _require(tuple(reader.fieldnames or ()) == columns, f"{label}: original columns changed")
    rows = list(reader)
    _require(bool(rows), f"{label}: no rows")
    _require(all(None not in row for row in rows), f"{label}: row has extra columns")
    return rows


def _validate_zcta_group(rows: list[dict[str, str]], label: str) -> tuple[int, int]:
    code = rows[0]["GEOID_ZCTA5_20"]
    _require(_is_zip(code), f"{label}: malformed ZCTA {code!r}")
    fields = {
        (row["AREALAND_ZCTA5_20"], row["AREAWATER_ZCTA5_20"],
         row["MTFCC_ZCTA5_20"], row["CLASSFP_ZCTA5_20"], row["FUNCSTAT_ZCTA5_20"])
        for row in rows
    }
    _require(len(fields) == 1, f"{label}: inconsistent ZCTA totals or status for {code}")
    land_text, water_text, mtfcc, classfp, funcstat = fields.pop()
    land_total = _int_area(land_text, f"{label} {code} land total")
    water_total = _int_area(water_text, f"{label} {code} water total")
    _require(land_total > 0, f"{label}: nonpositive ZCTA land total for {code}")
    _require((mtfcc, classfp, funcstat) == ("G6350", "B5", "S"),
             f"{label}: unsupported ZCTA status for {code}")
    part_land = sum(_int_area(row["AREALAND_PART"], f"{label} {code} land part") for row in rows)
    part_water = sum(_int_area(row["AREAWATER_PART"], f"{label} {code} water part") for row in rows)
    _require(part_land == land_total, f"{label}: incomplete land parts for {code}")
    _require(part_water == water_total, f"{label}: incomplete water parts for {code}")
    return land_total, water_total


def _aliases(names: Mapping[str, str], *, municipality: bool) -> Mapping[str, str]:
    candidates: dict[str, set[str]] = defaultdict(set)
    for geoid, name in names.items():
        canonical = _canonical_label(name)
        candidates[canonical].add(geoid)
        if municipality:
            for suffix in MUNICIPAL_SUFFIXES:
                if canonical.endswith(suffix):
                    candidates[canonical.removesuffix(suffix)].add(geoid)
                    break
        elif canonical.endswith(" county"):
            candidates[canonical.removesuffix(" county")].add(geoid)
    return MappingProxyType({alias: next(iter(geoids)) for alias, geoids in candidates.items()
                             if len(geoids) == 1})


@dataclass(frozen=True, slots=True)
class SourceArea:
    """One exact operator-reviewed service-area statement."""

    label: str
    kind: AreaKind
    scope: AreaScope
    source_url: str
    quote: str

    def __post_init__(self) -> None:
        _require(isinstance(self.label, str) and bool(self.label.strip()),
                 "SourceArea.label must be nonblank")
        _require(self.kind in ("zip", "county", "municipality"),
                 "SourceArea.kind must be zip, county, or municipality")
        _require(self.scope in ("full", "partial", "unknown"),
                 "SourceArea.scope must be full, partial, or unknown")
        parsed = urlparse(self.source_url) if isinstance(self.source_url, str) else None
        _require(parsed is not None and parsed.scheme in ("http", "https") and bool(parsed.netloc),
                 "SourceArea.source_url must be an HTTP URL")
        _require(isinstance(self.quote, str) and bool(self.quote.strip()),
                 "SourceArea.quote must be nonblank")


@dataclass(frozen=True, slots=True)
class Geography:
    """Verified postal membership and complete Census area requirements."""

    nj_postal_zips: frozenset[str]
    county_aliases: Mapping[str, str]
    municipality_aliases: Mapping[str, str]
    county_names: Mapping[str, str]
    municipality_names: Mapping[str, str]
    county_requirements: Mapping[str, frozenset[str]]
    municipality_requirements: Mapping[str, frozenset[str]]
    municipality_blockers: Mapping[str, tuple[str, ...]]
    diagnostics: Mapping[str, int]

    @classmethod
    def load(
        cls,
        geography_dir: Path = DEFAULT_GEOGRAPHY_DIR,
        subdivision_dir: Path = DEFAULT_SUBDIVISION_DIR,
    ) -> "Geography":
        """Load and verify the retained GeoNames, Gazetteer, and Census files."""

        geography_dir = Path(geography_dir)
        subdivision_dir = Path(subdivision_dir)
        source_manifest = _read_json(geography_dir / "source-manifest.json")
        _require(isinstance(source_manifest, dict)
                 and source_manifest.get("schemaVersion") == 1
                 and isinstance(source_manifest.get("sources"), dict),
                 "geography source manifest: expected schemaVersion 1")
        sources = source_manifest["sources"]
        required_sources = {COUNTY_RELATION, GEONAMES_ARCHIVE, GAZETTEER_ARCHIVE}
        _require(required_sources <= set(sources), "geography source manifest: missing source")
        verified_sources = {
            name: _verified_file(geography_dir / "raw" / name, entry, f"source {name}")
            for name, entry in sources.items()
        }

        postal_zips, non_nj_postal_rows, unassigned_postal_rows = _load_nj_postal_zips(
            verified_sources[GEONAMES_ARCHIVE]
        )
        _verify_gazetteer(verified_sources[GAZETTEER_ARCHIVE])
        county = _load_county_relation(verified_sources[COUNTY_RELATION])

        subdivision_manifest = _read_json(subdivision_dir / "manifest.json")
        _require(isinstance(subdivision_manifest, dict)
                 and subdivision_manifest.get("schemaVersion") == 1,
                 "subdivision manifest: expected schemaVersion 1")
        retained = subdivision_manifest.get("retained")
        _require(isinstance(retained, dict) and retained.get("path") == "nj-cousub-2020.psv",
                 "subdivision manifest: unexpected retained path")
        _require(isinstance(subdivision_manifest.get("source"), dict)
                 and all(key in subdivision_manifest["source"] for key in ("url", "sha256", "bytes")),
                 "subdivision manifest: incomplete source provenance")
        subdivision_data = _verified_file(
            subdivision_dir / retained["path"], retained, "subdivision retained file"
        )
        subdivision = _load_subdivision_relation(subdivision_data)
        counts = subdivision_manifest.get("counts")
        _require(isinstance(counts, dict), "subdivision manifest: missing counts")
        for key, value in subdivision["manifest_counts"].items():
            _require(counts.get(key) == value, f"subdivision manifest: {key} mismatch")

        diagnostics = MappingProxyType({
            "njPostalZipCount": len(postal_zips),
            "nonNjPostalRowCount": non_nj_postal_rows,
            "unassignedNjPostalRowCount": unassigned_postal_rows,
            "countyBlankZctaRowCount": county["blank_rows"],
            "subdivisionBlankZctaRowCount": subdivision["blank_rows"],
            "unsupportedSubdivisionRowCount": subdivision["unsupported_rows"],
        })
        return cls(
            nj_postal_zips=frozenset(postal_zips),
            county_aliases=_aliases(county["names"], municipality=False),
            municipality_aliases=_aliases(subdivision["names"], municipality=True),
            county_names=MappingProxyType(county["names"]),
            municipality_names=MappingProxyType(subdivision["names"]),
            county_requirements=MappingProxyType(county["requirements"]),
            municipality_requirements=MappingProxyType(subdivision["requirements"]),
            municipality_blockers=MappingProxyType(subdivision["blockers"]),
            diagnostics=diagnostics,
        )


def _load_nj_postal_zips(data: bytes) -> tuple[set[str], int, int]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = [name for name in archive.namelist() if name.endswith("US.txt")]
        _require(len(members) == 1, "GeoNames archive: expected one US.txt")
        text = archive.read(members[0]).decode("utf-8-sig")
    zips: set[str] = set()
    non_nj = 0
    unassigned = 0
    for number, row in enumerate(csv.reader(io.StringIO(text), delimiter="\t"), start=1):
        _require(len(row) == 12, f"GeoNames row {number}: expected 12 columns")
        if row[0] != "US" or row[4] != "NJ":
            non_nj += 1
            continue
        if not _is_zip(row[1]) or not row[6].isascii() or re.fullmatch(r"[0-9]{3}", row[6]) is None:
            unassigned += 1
            continue
        zips.add(row[1])
    _require(bool(zips), "GeoNames archive: no assigned NJ postal ZIPs")
    _require(unassigned == 0, "GeoNames archive: malformed or unassigned NJ postal rows")
    return zips, non_nj, unassigned


def _verify_gazetteer(data: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = [name for name in archive.namelist() if name.endswith(".txt")]
        _require(len(members) == 1, "Gazetteer archive: expected one text member")
        text = archive.read(members[0]).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text), delimiter="|")
    names = {name.strip() for name in reader.fieldnames or []}
    _require({"GEOID", "INTPTLAT", "INTPTLONG"} <= names,
             "Gazetteer archive: required original columns missing")
    _require(any(True for _ in reader), "Gazetteer archive: no rows")


def _load_county_relation(data: bytes) -> dict[str, object]:
    rows = _relation_rows(data, COUNTY_COLUMNS, "county relation")
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    blank_rows = 0
    for row in rows:
        code = row["GEOID_ZCTA5_20"]
        if not code:
            blank_rows += 1
            continue
        grouped[code].append(row)
    names: dict[str, str] = {}
    requirements: dict[str, frozenset[str]] = {}
    for code, parts in grouped.items():
        _validate_zcta_group(parts, "county relation")
        required: set[str] = set()
        seen: set[str] = set()
        for row in parts:
            geoid = row["GEOID_COUNTY_20"]
            name = row["NAMELSAD_COUNTY_20"]
            _require(COUNTY_RE.fullmatch(geoid) is not None and bool(name),
                     f"county relation: blank or malformed county for {code}")
            _require(geoid not in seen, f"county relation: duplicate county {geoid} for {code}")
            seen.add(geoid)
            _require(row["MTFCC_COUNTY_20"] == "G4020",
                     f"county relation: unsupported county MTFCC for {geoid}")
            land = _int_area(row["AREALAND_PART"], f"county relation {code} land part")
            water = _int_area(row["AREAWATER_PART"], f"county relation {code} water part")
            if land > 0 or water > 0:
                required.add(geoid)
            if geoid.startswith("34"):
                _require((row["CLASSFP_COUNTY_20"], row["FUNCSTAT_COUNTY_20"]) == ("H1", "A"),
                         f"county relation: unsupported NJ county status for {geoid}")
                previous = names.setdefault(geoid, name)
                _require(previous == name, f"county relation: inconsistent name for {geoid}")
        _require(bool(required), f"county relation: no positive parts for {code}")
        requirements[code] = frozenset(required)
    return {"blank_rows": blank_rows, "names": names, "requirements": requirements}


def _unsupported_subdivision(row: Mapping[str, str]) -> bool:
    name = row["NAMELSAD_COUSUB_20"]
    canonical = _canonical_label(name) if name else ""
    return (
        SUBDIVISION_RE.fullmatch(row["GEOID_COUSUB_20"]) is None
        or not row["GEOID_COUSUB_20"].startswith("34")
        or not name
        or (row["CLASSFP_COUSUB_20"], row["FUNCSTAT_COUSUB_20"])
        not in SUPPORTED_SUBDIVISIONS
        or any(term in canonical for term in ("not defined", "unassigned", "offshore"))
    )


def _load_subdivision_relation(data: bytes) -> dict[str, object]:
    rows = _relation_rows(data, SUBDIVISION_COLUMNS, "subdivision relation")
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    blank_rows = 0
    nj_rows = 0
    out_of_state_rows = 0
    zctas: set[str] = set()
    for row in rows:
        geoid = row["GEOID_COUSUB_20"]
        if geoid.startswith("34"):
            nj_rows += 1
        else:
            out_of_state_rows += 1
        code = row["GEOID_ZCTA5_20"]
        if not code:
            blank_rows += 1
            continue
        zctas.add(code)
        grouped[code].append(row)
    names: dict[str, str] = {}
    requirements: dict[str, frozenset[str]] = {}
    blockers: dict[str, tuple[str, ...]] = {}
    unsupported_rows = 0
    for code, parts in grouped.items():
        _validate_zcta_group(parts, "subdivision relation")
        required: set[str] = set()
        blocked: set[str] = set()
        seen: set[str] = set()
        for row in parts:
            geoid = row["GEOID_COUSUB_20"]
            land = _int_area(row["AREALAND_PART"], f"subdivision relation {code} land part")
            water = _int_area(row["AREAWATER_PART"], f"subdivision relation {code} water part")
            positive = land > 0 or water > 0
            unsupported = _unsupported_subdivision(row)
            if unsupported:
                unsupported_rows += 1
                if positive:
                    blocked.add(row["NAMELSAD_COUSUB_20"] or "blank subdivision")
                continue
            _require(row["MTFCC_COUSUB_20"] == "G4040",
                     f"subdivision relation: unsupported MTFCC for {geoid}")
            _require(geoid not in seen, f"subdivision relation: duplicate subdivision {geoid} for {code}")
            seen.add(geoid)
            name = row["NAMELSAD_COUSUB_20"]
            previous = names.setdefault(geoid, name)
            _require(previous == name, f"subdivision relation: inconsistent name for {geoid}")
            if positive:
                required.add(geoid)
        _require(bool(required) or bool(blocked),
                 f"subdivision relation: no positive parts for {code}")
        requirements[code] = frozenset(required)
        if blocked:
            blockers[code] = tuple(sorted(blocked))
    return {
        "blank_rows": blank_rows,
        "unsupported_rows": unsupported_rows,
        "names": names,
        "requirements": requirements,
        "blockers": blockers,
        "manifest_counts": {
            "blankZctaRows": blank_rows,
            "njRows": nj_rows,
            "outOfStateRows": out_of_state_rows,
            "retainedRows": len(rows),
            "zctas": len(zctas),
        },
    }


def _claim_dict(area: SourceArea) -> dict[str, str]:
    value = asdict(area)
    value["sourceUrl"] = value.pop("source_url")
    return value


def _diagnostic(index: int, reason: str, value: object) -> dict[str, object]:
    item: dict[str, object] = {"index": index, "reason": reason,
                              "inputType": type(value).__name__}
    if isinstance(value, SourceArea):
        item["area"] = _claim_dict(value)
    elif isinstance(value, str):
        item["label"] = value
    elif isinstance(value, dict):
        label = value.get("label")
        if isinstance(label, str):
            item["label"] = label
    return item


def _evidence_key(value: Mapping[str, str]) -> tuple[str, ...]:
    return tuple(value[key] for key in ("kind", "label", "scope", "sourceUrl", "quote"))


def resolve_service_zips(
    source_areas: Iterable[object],
    geography: Geography,
    *,
    market_zips: Iterable[str] | None = None,
) -> dict[str, object]:
    """Resolve full typed claims without widening partial or unknown inputs."""

    market: frozenset[str] | None = None
    if market_zips is not None:
        values = list(market_zips)
        _require(all(_is_zip(value) for value in values),
                 "market_zips must contain ASCII five-digit strings")
        _require(len(values) == len(set(values)), "market_zips must not contain duplicates")
        _require(set(values) <= geography.nj_postal_zips,
                 "market_zips must be retained NJ postal ZIPs")
        market = frozenset(values)

    unsupported: list[dict[str, object]] = []
    unmatched: list[dict[str, object]] = []
    accepted_explicit: dict[str, list[dict[str, str]]] = defaultdict(list)
    county_claims: dict[str, list[dict[str, str]]] = defaultdict(list)
    municipality_claims: dict[str, list[dict[str, str]]] = defaultdict(list)
    unsupported_valid_zips: set[str] = set()

    for index, value in enumerate(source_areas):
        if not isinstance(value, SourceArea):
            unsupported.append(_diagnostic(index, "expected_source_area", value))
            continue
        area = value
        if area.scope != "full":
            unsupported.append(_diagnostic(index, "scope_is_not_full", area))
            if area.kind == "zip" and _is_zip(area.label) and area.label in geography.nj_postal_zips:
                unsupported_valid_zips.add(area.label)
            continue
        evidence = _claim_dict(area)
        if area.kind == "zip":
            if not _is_zip(area.label):
                unsupported.append(_diagnostic(index, "malformed_zip", area))
            elif area.label not in geography.nj_postal_zips:
                unsupported.append(_diagnostic(index, "zip_not_in_retained_nj_postal_list", area))
            else:
                accepted_explicit[area.label].append(evidence)
            continue
        aliases = (geography.county_aliases if area.kind == "county"
                   else geography.municipality_aliases)
        geoid = aliases.get(_canonical_label(area.label))
        if geoid is None:
            unmatched.append(_diagnostic(index, "area_label_not_found_or_ambiguous", area))
        elif area.kind == "county":
            county_claims[geoid].append(evidence)
        else:
            municipality_claims[geoid].append(evidence)

    evidence_by_zip: dict[str, list[dict[str, str]]] = defaultdict(list)
    for code, evidence in accepted_explicit.items():
        evidence_by_zip[code].extend(evidence)

    excluded: list[dict[str, object]] = []
    served_counties = set(county_claims)
    for code, required in geography.county_requirements.items():
        intersection = required & served_counties
        if not intersection or code not in geography.nj_postal_zips:
            continue
        missing = required - served_counties
        if missing:
            excluded.append({
                "zip": code,
                "kind": "county",
                "reason": "not_all_positive_land_and_water_parts_served",
                "servedAreas": sorted(geography.county_names[item] for item in intersection),
                "unservedAreaIds": sorted(missing),
            })
            continue
        for geoid in sorted(required):
            evidence_by_zip[code].extend(county_claims[geoid])

    served_municipalities = set(municipality_claims)
    for code, required in geography.municipality_requirements.items():
        intersection = required & served_municipalities
        if not intersection or code not in geography.nj_postal_zips:
            continue
        missing = required - served_municipalities
        blockers = geography.municipality_blockers.get(code, ())
        if missing or blockers:
            item: dict[str, object] = {
                "zip": code,
                "kind": "municipality",
                "reason": ("unsupported_subdivision_part" if blockers
                           else "not_all_positive_land_and_water_parts_served"),
                "servedAreas": sorted(geography.municipality_names[item]
                                      for item in intersection),
                "unservedAreaIds": sorted(missing),
            }
            if blockers:
                item["unsupportedParts"] = list(blockers)
            excluded.append(item)
            continue
        for geoid in sorted(required):
            evidence_by_zip[code].extend(municipality_claims[geoid])

    normalized_evidence: dict[str, list[dict[str, str]]] = {}
    for code in sorted(evidence_by_zip):
        unique = {_evidence_key(item): item for item in evidence_by_zip[code]}
        normalized_evidence[code] = [unique[key] for key in sorted(unique)]
    accepted = sorted(normalized_evidence)

    market_diagnostics: dict[str, object] = {"checked": market is not None}
    if market is None:
        market_diagnostics.update({
            "acceptedPresent": [], "acceptedMissing": [],
            "unsupportedPresent": [], "unsupportedMissing": [],
        })
    else:
        accepted_set = set(accepted)
        market_diagnostics.update({
            "acceptedPresent": sorted(accepted_set & market),
            "acceptedMissing": sorted(accepted_set - market),
            "unsupportedPresent": sorted(unsupported_valid_zips & market),
            "unsupportedMissing": sorted(unsupported_valid_zips - market),
        })

    return {
        "serviceAreaZips": accepted,
        "evidenceByZip": normalized_evidence,
        "unmatchedAreas": unmatched,
        "unsupportedAreas": unsupported,
        "excludedDerivedZips": sorted(excluded, key=lambda item: (item["zip"], item["kind"])),
        "marketDiagnostics": market_diagnostics,
        "geographyDiagnostics": dict(geography.diagnostics),
    }
