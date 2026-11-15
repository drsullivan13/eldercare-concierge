#!/usr/bin/env python3
"""Behavior tests for conservative NJ home-care service ZIP resolution."""

import copy
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = ROOT / "scripts/regions"
GEOGRAPHY_DIR = ROOT / "research/north-jersey/geography"
SUBDIVISION_DIR = ROOT / "research/north-jersey/home-care-supply/service-geography"

SPEC = importlib.util.spec_from_file_location(
    "homecare_service_zips", SCRIPT_DIR / "homecare_service_zips.py"
)
resolver = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = resolver
SPEC.loader.exec_module(resolver)

BUILD_SPEC = importlib.util.spec_from_file_location(
    "homecare_service_zips_build_region", SCRIPT_DIR / "build-region.py"
)
build_region = importlib.util.module_from_spec(BUILD_SPEC)
assert BUILD_SPEC.loader is not None
sys.modules[BUILD_SPEC.name] = build_region
BUILD_SPEC.loader.exec_module(build_region)


def area(label, kind, scope="full", quote=None, url="https://agency.example/service-area"):
    return resolver.SourceArea(
        label=label,
        kind=kind,
        scope=scope,
        source_url=url,
        quote=quote or f"We serve {label}.",
    )


def rewrite_retained(directory, transform):
    source = SUBDIVISION_DIR / "nj-cousub-2020.psv"
    target = directory / source.name
    lines = source.read_text().splitlines()
    transformed = transform(lines)
    data = ("\n".join(transformed) + "\n").encode()
    target.write_bytes(data)
    manifest = json.loads((SUBDIVISION_DIR / "manifest.json").read_text())
    manifest["retained"]["bytes"] = len(data)
    manifest["retained"]["sha256"] = hashlib.sha256(data).hexdigest()
    (directory / "manifest.json").write_text(json.dumps(manifest))


class ResolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geography = resolver.Geography.load()

    def test_real_loader_verifies_and_audits_retained_inputs(self):
        self.assertEqual(len(self.geography.nj_postal_zips), 723)
        self.assertEqual(self.geography.county_aliases["essex"], "34013")
        self.assertEqual(self.geography.municipality_aliases["edison"], "3402320230")
        self.assertEqual(
            dict(self.geography.diagnostics),
            {
                "njPostalZipCount": 723,
                "nonNjPostalRowCount": 40767,
                "unassignedNjPostalRowCount": 0,
                "countyBlankZctaRowCount": 903,
                "subdivisionBlankZctaRowCount": 24,
                "unsupportedSubdivisionRowCount": 21,
            },
        )

    def test_essex_county_requires_full_scope_and_all_boundary_counties(self):
        result = resolver.resolve_service_zips([area("Essex", "county")], self.geography)
        self.assertEqual(len(result["serviceAreaZips"]), 28)
        self.assertIn("07003", result["serviceAreaZips"])
        self.assertNotIn("07009", result["serviceAreaZips"])
        excluded = {item["zip"]: item for item in result["excludedDerivedZips"]}
        self.assertEqual(excluded["07009"]["unservedAreaIds"], ["34031"])

        partial = resolver.resolve_service_zips(
            [area("Essex", "county", scope="partial")], self.geography
        )
        self.assertEqual(partial["serviceAreaZips"], [])
        self.assertEqual(partial["unsupportedAreas"][0]["reason"], "scope_is_not_full")

    def test_counties_combine_only_when_every_boundary_part_is_named(self):
        somerset_middlesex = resolver.resolve_service_zips(
            [area("Somerset", "county"), area("Middlesex County", "county")],
            self.geography,
        )
        self.assertNotIn("07060", somerset_middlesex["serviceAreaZips"])
        boundary = next(item for item in somerset_middlesex["excludedDerivedZips"]
                        if item["zip"] == "07060")
        self.assertEqual(boundary["unservedAreaIds"], ["34039"])

        complete = resolver.resolve_service_zips(
            [area("Somerset", "county"), area("Middlesex", "county"),
             area("Union", "county")],
            self.geography,
        )
        self.assertIn("07060", complete["serviceAreaZips"])
        self.assertEqual(
            {item["label"] for item in complete["evidenceByZip"]["07060"]},
            {"Somerset", "Middlesex", "Union"},
        )

    def test_named_municipalities_combine_without_implying_their_counties(self):
        edison = resolver.resolve_service_zips([area("Edison", "municipality")], self.geography)
        self.assertEqual(edison["serviceAreaZips"], [])
        self.assertEqual(
            {item["zip"] for item in edison["excludedDerivedZips"]},
            {"08817", "08820", "08837", "08854"},
        )

        combined = resolver.resolve_service_zips(
            [area("Edison", "municipality"), area("Piscataway", "municipality")],
            self.geography,
        )
        self.assertIn("08817", combined["serviceAreaZips"])
        self.assertIn("08854", combined["serviceAreaZips"])
        self.assertNotIn("08820", combined["serviceAreaZips"])

        bridgewater = resolver.resolve_service_zips(
            [area("Bridgewater", "municipality")], self.geography
        )
        self.assertEqual(bridgewater["serviceAreaZips"], ["08807", "08836"])
        bridgewater_bound_brook = resolver.resolve_service_zips(
            [area("Bridgewater", "municipality"), area("Bound Brook", "municipality")],
            self.geography,
        )
        self.assertIn("08805", bridgewater_bound_brook["serviceAreaZips"])
        self.assertNotIn("07920", bridgewater_bound_brook["serviceAreaZips"])

    def test_water_only_unsupported_subdivision_blocks_municipal_proof(self):
        result = resolver.resolve_service_zips(
            [area("Barnegat Light", "municipality")], self.geography
        )
        self.assertNotIn("08006", result["serviceAreaZips"])
        item = next(value for value in result["excludedDerivedZips"]
                    if value["zip"] == "08006")
        self.assertEqual(item["reason"], "unsupported_subdivision_part")
        self.assertEqual(item["unsupportedParts"], ["County subdivisions not defined"])

    def test_explicit_retained_postal_zip_does_not_require_a_zcta(self):
        result = resolver.resolve_service_zips([area("07999", "zip")], self.geography)
        self.assertEqual(result["serviceAreaZips"], ["07999"])
        self.assertEqual(result["evidenceByZip"]["07999"][0]["quote"], "We serve 07999.")

    def test_unknown_and_invalid_inputs_are_diagnostic_and_never_inflate(self):
        claims = [
            "Essex County",
            {"label": "Somerset", "kind": "county", "scope": "full"},
            8817,
            area("8817", "zip"),
            area("０８８１７", "zip"),
            area("10001", "zip"),
            area("Somerset", "county", scope="unknown"),
            area("Nowhere", "municipality"),
        ]
        result = resolver.resolve_service_zips(claims, self.geography)
        self.assertEqual(result["serviceAreaZips"], [])
        self.assertEqual(
            [item["reason"] for item in result["unsupportedAreas"]],
            [
                "expected_source_area", "expected_source_area", "expected_source_area",
                "malformed_zip", "malformed_zip", "zip_not_in_retained_nj_postal_list",
                "scope_is_not_full",
            ],
        )
        self.assertEqual(result["unmatchedAreas"][0]["area"]["label"], "Nowhere")
        json.dumps(result, allow_nan=False)

    def test_duplicate_claims_have_one_evidence_record(self):
        claim = area("08807", "zip", quote="The agency serves ZIP 08807.")
        result = resolver.resolve_service_zips([claim, claim], self.geography)
        self.assertEqual(result["serviceAreaZips"], ["08807"])
        self.assertEqual(len(result["evidenceByZip"]["08807"]), 1)

    def test_distinct_sources_naming_one_zip_keep_separate_evidence(self):
        first = area("08807", "zip", quote="Our aides visit 08807.",
                     url="https://first.example/coverage")
        second = area("08807", "zip", quote="Service area includes 08807.",
                      url="https://second.example/towns")
        result = resolver.resolve_service_zips([first, second], self.geography)
        self.assertEqual(result["serviceAreaZips"], ["08807"])
        self.assertEqual(
            {item["sourceUrl"] for item in result["evidenceByZip"]["08807"]},
            {"https://first.example/coverage", "https://second.example/towns"},
        )

    def test_water_only_county_part_still_requires_the_boundary_county(self):
        geography = resolver.Geography(
            nj_postal_zips=frozenset({"00001"}),
            county_aliases={"land": "34001", "shore": "34002"},
            municipality_aliases={},
            county_names={"34001": "Land County", "34002": "Shore County"},
            municipality_names={},
            county_requirements={"00001": frozenset({"34001", "34002"})},
            municipality_requirements={},
            municipality_blockers={},
            diagnostics={},
        )
        land_only = resolver.resolve_service_zips(
            [area("Land", "county")], geography
        )
        self.assertEqual(land_only["serviceAreaZips"], [])
        self.assertEqual(land_only["excludedDerivedZips"][0]["unservedAreaIds"], ["34002"])
        both = resolver.resolve_service_zips(
            [area("Land", "county"), area("Shore", "county")], geography
        )
        self.assertEqual(both["serviceAreaZips"], ["00001"])

    def test_market_diagnostics_separate_accepted_and_unsupported_zips(self):
        result = resolver.resolve_service_zips(
            [area("07999", "zip"), area("07004", "zip"),
             area("07003", "zip", scope="partial"),
             area("07006", "zip", scope="unknown")],
            self.geography,
            market_zips=["07999", "07003"],
        )
        self.assertEqual(
            result["marketDiagnostics"],
            {
                "checked": True,
                "acceptedPresent": ["07999"],
                "acceptedMissing": ["07004"],
                "unsupportedPresent": ["07003"],
                "unsupportedMissing": ["07006"],
            },
        )
        for invalid in (["07999", "07999"], ["8817"], ["10001"], [8817]):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                resolver.resolve_service_zips([], self.geography, market_zips=invalid)

    def test_retained_subdivision_hash_and_complete_totals_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            shutil.copy2(SUBDIVISION_DIR / "manifest.json", directory / "manifest.json")
            target = directory / "nj-cousub-2020.psv"
            data = bytearray((SUBDIVISION_DIR / target.name).read_bytes())
            data[-1] ^= 0xFF
            target.write_bytes(bytes(data))
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                resolver.Geography.load(GEOGRAPHY_DIR, directory)

        def inconsistent(lines):
            for index, line in enumerate(lines[1:], start=1):
                fields = line.split("|")
                if fields[1]:
                    fields[3] = str(int(fields[3]) + 1)
                    lines[index] = "|".join(fields)
                    break
            return lines

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rewrite_retained(directory, inconsistent)
            with self.assertRaisesRegex(ValueError, "incomplete land parts"):
                resolver.Geography.load(GEOGRAPHY_DIR, directory)

        def missing(lines):
            for index, line in enumerate(lines[1:], start=1):
                fields = line.split("|")
                if fields[1]:
                    fields[4] = ""
                    lines[index] = "|".join(fields)
                    break
            return lines

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rewrite_retained(directory, missing)
            with self.assertRaisesRegex(ValueError, "expected nonnegative integer area"):
                resolver.Geography.load(GEOGRAPHY_DIR, directory)

    def test_offshore_named_part_is_not_usable_as_municipal_proof(self):
        def offshore(lines):
            for index, line in enumerate(lines[1:], start=1):
                fields = line.split("|")
                if fields[1] == "08805" and fields[9] == "3403506790":
                    fields[10] = "Offshore area"
                    lines[index] = "|".join(fields)
                    return lines
            raise AssertionError("08805 Bound Brook row not found")

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rewrite_retained(directory, offshore)
            geography = resolver.Geography.load(GEOGRAPHY_DIR, directory)
            result = resolver.resolve_service_zips(
                [area("Bridgewater", "municipality")], geography
            )
            item = next(value for value in result["excludedDerivedZips"]
                        if value["zip"] == "08805")
            self.assertEqual(item["reason"], "unsupported_subdivision_part")
            self.assertEqual(item["unsupportedParts"], ["Offshore area"])


class ProviderServiceAreaValidationTests(unittest.TestCase):
    def provider(self):
        return {
            "id": "north-jersey-example", "name": "Example", "category": "home-care",
            "address": "1 Main Street", "city": "Newark", "state": "NJ", "zip": "07102",
            "lat": None, "lng": None, "locationKind": "office", "description": "",
            "services": [], "officialRecord": True,
            "sources": [{
                "title": "Source", "publisher": "Publisher", "url": "https://example.org",
                "kind": "regulatory", "checkedAt": "2026-01-01", "supports": "Identity",
            }],
            "warnings": [], "limitations": [],
        }

    def test_provider_shape_rejects_nonarray_malformed_and_duplicate_zip_values(self):
        for value in ("07102", ["7102"], [7102]):
            provider = self.provider()
            provider["serviceAreaZips"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                build_region.PROVIDER(provider, "provider")

        provider = self.provider()
        provider["serviceAreaZips"] = ["07102", "07102"]
        build_region.PROVIDER(provider, "provider")
        market = {
            "id": "north-jersey", "state": "NJ", "defaultZip": "07102",
            "zips": {"07102": {"city": "Newark", "lat": 40.7, "lng": -74.1}},
            "providers": [provider],
            "meta": {"asOf": "2026-01-01", "catalogTotal": 1,
                     "categories": {"home-care": 1}},
        }
        with self.assertRaisesRegex(ValueError, "duplicate IDs"):
            build_region.validate_market(
                market, {"reviewedAt": "2026-01-02"}, {"071": ["NJ"]}
            )

    def test_validate_market_accepts_absent_or_empty_and_rejects_outside_market(self):
        for value in (None, []):
            provider = self.provider()
            if value is not None:
                provider["serviceAreaZips"] = value
            market = {
                "id": "north-jersey", "state": "NJ", "defaultZip": "07102",
                "zips": {"07102": {"city": "Newark", "lat": 40.7, "lng": -74.1}},
                "providers": [provider],
                "meta": {"asOf": "2026-01-01", "catalogTotal": 1,
                         "categories": {"home-care": 1}},
            }
            build_region.validate_market(
                market, {"reviewedAt": "2026-01-02"}, {"071": ["NJ"]}
            )

        provider = self.provider()
        provider["serviceAreaZips"] = ["07003"]
        market = {
            "id": "north-jersey", "state": "NJ", "defaultZip": "07102",
            "zips": {"07102": {"city": "Newark", "lat": 40.7, "lng": -74.1}},
            "providers": [provider],
            "meta": {"asOf": "2026-01-01", "catalogTotal": 1,
                     "categories": {"home-care": 1}},
        }
        with self.assertRaisesRegex(ValueError, "outside market"):
            build_region.validate_market(
                market, {"reviewedAt": "2026-01-02"}, {"070": ["NJ"], "071": ["NJ"]}
            )

    def test_real_build_markets_accepts_optional_service_area_zips(self):
        source_manifest_path = ROOT / "research/north-jersey/runtime-manifest.json"
        source_manifest = json.loads(source_manifest_path.read_text())
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            manifest = copy.deepcopy(source_manifest)
            for reference in manifest["markets"][0]["artifacts"].values():
                source = (source_manifest_path.parent / reference["path"]).resolve()
                target = directory / reference["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            providers_ref = manifest["markets"][0]["artifacts"]["providers"]
            providers_path = directory / providers_ref["path"]
            providers = json.loads(providers_path.read_text())
            providers[0]["serviceAreaZips"] = [providers[0]["zip"]]
            data = (json.dumps(providers, indent=2, sort_keys=True) + "\n").encode()
            providers_path.write_bytes(data)
            providers_ref["sha256"] = hashlib.sha256(data).hexdigest()
            manifest_path = directory / "runtime-manifest.json"
            manifest_path.write_text(json.dumps(manifest))

            markets = build_region.build_markets(
                [(manifest_path, None)], directory / "output.json", build_region.registrations()
            )
            self.assertEqual(markets[0]["providers"][0]["serviceAreaZips"],
                             [providers[0]["zip"]])


if __name__ == "__main__":
    unittest.main()
