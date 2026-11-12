#!/usr/bin/env python3
"""Source-backed acceptance tests for the North Jersey ZIP snapshot."""

import csv
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "research/north-jersey/geography"
BUILDER = ROOT / "scripts/regions/zip-build.py"
TARGETS = {"34003", "34013", "34017", "34027", "34031", "34039"}


def read_json(name):
    return json.loads((SNAPSHOT / name).read_text())


def archived_rows(name, member, delimiter):
    with zipfile.ZipFile(SNAPSHOT / "raw" / name) as archive:
        text = archive.read(member).decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text), delimiter=delimiter))


def run_builder(output, mode):
    return subprocess.run(
        [sys.executable, str(BUILDER), "--output-dir", str(output), mode],
        cwd=ROOT,
        env={**os.environ, "SSL_CERT_FILE": "/no-network-needed-for-offline-build"},
        capture_output=True,
        text=True,
        timeout=30,
    )


class ZipAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lookup = read_json("nj-zips.json")
        cls.provenance = read_json("nj-zips-provenance.json")
        cls.county_zips = read_json("nj-county-zips.json")
        cls.excluded = read_json("exclusions.json")
        cls.postal = {}
        for row in archived_rows("geonames-US.zip", "US.txt", "\t"):
            if row[0] == "US" and row[4] == "NJ":
                cls.postal.setdefault(row[1], []).append(row)
        gazetteer = archived_rows(
            "census-2026-zcta.zip", "2026_Gaz_zcta_national.txt", "|"
        )
        header = gazetteer[0]
        cls.points = {
            row[header.index("GEOID")]: (
                float(row[header.index("INTPTLAT")]),
                float(row[header.index("INTPTLONG")]),
            )
            for row in gazetteer[1:]
        }
        with (SNAPSHOT / "raw/census-2020-zcta-county.txt").open() as source:
            cls.parts = {}
            for row in csv.DictReader(source, delimiter="|"):
                if row["GEOID_ZCTA5_20"] and row["GEOID_COUNTY_20"]:
                    cls.parts.setdefault(row["GEOID_ZCTA5_20"], []).append(row)

    def test_every_coordinate_and_label_matches_published_source(self):
        self.assertEqual(len(self.lookup), 270)
        self.assertEqual(set(self.lookup), set(self.provenance))
        for code, point in self.lookup.items():
            with self.subTest(zip=code):
                self.assertRegex(code, r"^0\d{4}$")
                self.assertEqual(set(point), {"city", "lat", "lng"})
                records = self.postal[code]
                self.assertIn(point["city"], {row[2] for row in records})
                actual = (point["lat"], point["lng"])
                if code in self.points:
                    self.assertEqual(actual, self.points[code])
                    self.assertTrue(self.provenance[code]["hasZcta"])
                else:
                    self.assertIn(actual, {(float(row[9]), float(row[10])) for row in records})
                    self.assertFalse(self.provenance[code]["hasZcta"])
                    self.assertIsNone(self.provenance[code]["zcta"])

    def test_all_county_memberships_and_exclusions_match_source(self):
        expected = {fips: set() for fips in TARGETS}
        included = set()
        for code, records in self.postal.items():
            if code in self.points:
                parts = [row for row in self.parts[code] if int(row["AREALAND_PART"]) > 0]
                fips = {row["GEOID_COUNTY_20"] for row in parts}
                self.assertEqual(
                    sum(int(row["AREALAND_PART"]) for row in parts),
                    int(parts[0]["AREALAND_ZCTA5_20"]),
                )
            else:
                fips = {"34" + row[6] for row in records}
            if fips & TARGETS:
                included.add(code)
                item = self.provenance[code]
                self.assertEqual(
                    {part["countyFips"] for part in item["countyMemberships"]},
                    fips,
                )
                self.assertEqual(item["targetCountyFips"], sorted(fips & TARGETS))
                if code in self.points:
                    for part in item["countyMemberships"]:
                        source = next(
                            row for row in parts if row["GEOID_COUNTY_20"] == part["countyFips"]
                        )
                        self.assertEqual(part["landAreaM2"], int(source["AREALAND_PART"]))
                        self.assertEqual(part["waterAreaM2"], int(source["AREAWATER_PART"]))
                        self.assertEqual(part["zctaLandAreaM2"], int(source["AREALAND_ZCTA5_20"]))
                        self.assertEqual(
                            part["county"], source["NAMELSAD_COUNTY_20"].removesuffix(" County")
                        )
                    primary = max(
                        parts,
                        key=lambda row: (int(row["AREALAND_PART"]), row["GEOID_COUNTY_20"]),
                    )
                    self.assertEqual(item["primaryCountyFips"], primary["GEOID_COUNTY_20"])
                    self.assertEqual(
                        {part["countyFips"] for part in item["waterOnlyCountyOverlaps"]},
                        {row["GEOID_COUNTY_20"] for row in self.parts[code]
                         if int(row["AREALAND_PART"]) == 0},
                    )
                for target in fips & TARGETS:
                    expected[target].add(code)
            else:
                self.assertEqual(self.excluded[code]["reason"], "outside_target_counties")
        self.assertEqual(set(self.lookup), included)
        self.assertEqual(set(self.excluded), set(self.postal) - included)
        self.assertEqual(len(self.excluded), 453)
        for fips, codes in expected.items():
            self.assertEqual(set(self.county_zips[fips]["zips"]), codes)
        census_targets = {
            code for code, parts in self.parts.items()
            if any(row["GEOID_COUNTY_20"] in TARGETS and int(row["AREALAND_PART"]) > 0
                   for row in parts)
        }
        self.assertLessEqual(census_targets, included)

    def test_morristown_union_postal_fallback_and_cross_county_examples(self):
        self.assertEqual(
            self.lookup["07960"], {"city": "Morristown", "lat": 40.779235, "lng": -74.502462}
        )
        self.assertEqual(self.provenance["07960"]["targetCountyFips"], ["34027"])
        self.assertEqual(
            self.lookup["07083"], {"city": "Union", "lat": 40.695266, "lng": -74.269078}
        )
        self.assertEqual(self.provenance["07083"]["targetCountyFips"], ["34039"])
        self.assertEqual(
            self.provenance["07962"]["coordinateSource"], "geonames_published_postal_point"
        )
        self.assertEqual(
            {part["countyFips"] for part in self.provenance["07060"]["countyMemberships"]},
            {"34023", "34035", "34039"},
        )
        self.assertNotIn("08540", self.lookup)
        self.assertIn("08540", self.excluded)
        self.assertNotIn("00000", self.lookup)

    def test_offline_rebuild_is_byte_identical_and_check_does_not_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "snapshot"
            shutil.copytree(SNAPSHOT, output)
            manifest = read_json("manifest.json")
            names = [*manifest["outputs"], "manifest.json"]
            before = {name: (output / name).read_bytes() for name in names}
            for mode in ("--offline", "--offline", "--check"):
                result = run_builder(output, mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(before, {name: (output / name).read_bytes() for name in names})

    def test_corrupt_source_is_rejected_before_outputs_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "snapshot"
            shutil.copytree(SNAPSHOT, output)
            before = (output / "nj-zips.json").read_bytes()
            source = output / "raw/geonames-US.zip"
            source.write_bytes(source.read_bytes() + b"corruption")
            result = run_builder(output, "--offline")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Source hash mismatch", result.stderr)
            self.assertEqual((output / "nj-zips.json").read_bytes(), before)

    def test_corrupt_output_is_rejected_without_repairing_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "snapshot"
            shutil.copytree(SNAPSHOT, output)
            target = output / "nj-zips.json"
            target.write_text("{}\n")
            result = run_builder(output, "--check")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Generated output differs", result.stderr)
            self.assertEqual(target.read_text(), "{}\n")


if __name__ == "__main__":
    unittest.main()
