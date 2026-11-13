"""Public supplemental replay uses reviewed outputs, never private acquisition bodies."""

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/regions" / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


release = load_module("supplemental_load", "nj_supplemental.py")
normalizer = load_module("supplemental_load_normalizer", "normalize-nj.py")


class PublicReplayTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / release.DIRECTORY
        self.output.mkdir()
        self.record = release.empty_record("office")
        self.record.update(checkedAt="2026-11-13", providerDetailsReviewed=True)
        self.record["sources"] = [{
            "id": "approved-source", "url": "https://example.org/office", "title": "Office",
            "publisher": "Provider", "kind": "provider", "access": "full-page",
            "checkedAt": "2026-11-13", "publishedAt": None,
        }]
        self.record["facts"] = [{
            "id": "approved-fact", "sourceId": "approved-source", "kind": "care",
            "text": "Provider reports companionship. Confirm availability.",
        }]
        self.identity = {
            "name": "Office", "category": "home-care", "address": "1 Main St",
            "city": "Union", "state": "NJ", "zip": "07083",
        }
        self.roster = {"office": {
            "name": "Office", "setting": "home-care", "county": "Union",
            "suppliedAddress": {key: self.identity[key] for key in ("address", "city", "state", "zip")},
        }}
        sources = {
            source: {"providerIds": ["office"] if source == release.SOURCES[0] else []}
            for source in release.SOURCES
        }
        self.values = {
            "locationResearch.json": {"office": self.record},
            "coverage.json": {
                "sources": sources, "combined": {"providerIds": ["office"], "uniqueProviders": 1},
            },
            "first-party-upgrades.json": {},
            "source-verification.json": dict.fromkeys(release.SOURCES, {}),
        }
        self.manifest = {
            "schemaVersion": 1, "status": "verified", "sources": sources,
            "identities": {"office": self.identity},
            "inputs": {
                "association-directory/.source.pdf": "a" * 64,
                "campus-offerings/evidence-01.json": "b" * 64,
                "home-care-first-party/receipts/private.json": "c" * 64,
            },
        }
        self.approve()

    def approve(self):
        self.manifest["outputs"] = {}
        for name, value in self.values.items():
            body = release.encode(value)
            (self.output / name).write_bytes(body)
            self.manifest["outputs"][name] = hashlib.sha256(body).hexdigest()
        self.write_manifest()
        self.pin()

    def write_manifest(self):
        (self.output / "manifest.json").write_bytes(release.encode(self.manifest))

    def pin(self):
        self.snapshot = {
            "schemaVersion": 1, "status": "reviewed-public-snapshot",
            "releaseManifestSha256": hashlib.sha256((self.output / "manifest.json").read_bytes()).hexdigest(),
        }
        (self.output / "public-snapshot.json").write_bytes(release.encode(self.snapshot))

    def load(self, counties=("Union",), inputs=None):
        return release.load_release(inputs or normalizer.Inputs(self.root), {}, self.roster, counties)

    def test_clean_public_fixture_loads_without_any_acquisition_input(self):
        inputs = normalizer.Inputs(self.root)
        self.assertEqual(self.load(inputs=inputs), {"office": self.record})
        self.assertEqual(set(inputs.hashes), {
            f"{release.DIRECTORY}/{name}"
            for name in (*self.values, "manifest.json", "public-snapshot.json")
        })
        inputs.verify()
        self.assertEqual(self.load(("Morris",)), {})

    def test_missing_public_pin_or_manifest_cannot_silently_change_replay_mode(self):
        (self.output / "public-snapshot.json").unlink()
        with self.assertRaisesRegex(ValueError, "public snapshot is required"):
            self.load()
        (self.output / "manifest.json").unlink()
        with self.assertRaisesRegex(ValueError, "without a verified manifest"):
            self.load()

    def test_absent_optional_release_preserves_existing_research(self):
        with tempfile.TemporaryDirectory() as temporary:
            baseline = {"existing": release.empty_record("existing")}
            self.assertEqual(release.load_release(
                normalizer.Inputs(Path(temporary)), baseline, {}, ("Union",)), baseline)

    def test_every_reviewed_output_is_required_and_hash_checked(self):
        for name in self.values:
            with self.subTest(name=name):
                path = self.output / name
                body = path.read_bytes()
                path.write_bytes(body + b" ")
                with self.assertRaisesRegex(ValueError, "release hash mismatch"):
                    self.load()
                path.unlink()
                with self.assertRaises(OSError):
                    self.load()
                path.write_bytes(body)

    def test_manifest_cannot_reapprove_changed_facts_or_evidence_hashes(self):
        self.values["locationResearch.json"]["office"]["facts"][0]["text"] = "Unapproved"
        snapshot = (self.output / "public-snapshot.json").read_bytes()
        self.approve()
        (self.output / "public-snapshot.json").write_bytes(snapshot)
        with self.assertRaisesRegex(ValueError, "snapshot.*mismatch"):
            self.load()
        self.setUp()
        self.manifest["inputs"]["association-directory/.source.pdf"] = "d" * 64
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "snapshot.*mismatch"):
            self.load()

    def test_private_bodies_are_not_public_replay_inputs_even_when_present(self):
        for relative in self.manifest["inputs"]:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"Private body, deliberately not matching the retained hash")
        self.assertIn("office", self.load())

    def test_provider_identity_and_fact_links_are_validated_before_county_filtering(self):
        mutations = [
            lambda: self.record.update(providerId="other"),
            lambda: self.record["facts"][0].update(sourceId="missing"),
            lambda: self.record["facts"].append(deepcopy(self.record["facts"][0])),
            lambda: self.record["sources"].append(deepcopy(self.record["sources"][0])),
            lambda: self.record["availability"].update(sourceId="missing"),
            lambda: self.record.update(reviews=[{"id": "forbidden-review"}]),
            lambda: self.record.update(reviewAggregates=[{"rating": 5}]),
            lambda: self.roster["office"]["suppliedAddress"].update(address="Other office"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                self.setUp()
                mutate()
                self.approve()
                with self.assertRaises(ValueError):
                    self.load(("Morris",))

    def test_unknown_provider_and_identity_roster_drift_fail_closed(self):
        self.roster.clear()
        with self.assertRaisesRegex(ValueError, "Unknown supplemental provider"):
            self.load()
        self.manifest["identities"].clear()
        self.write_manifest()
        self.pin()
        with self.assertRaisesRegex(ValueError, "identity roster mismatch"):
            self.load()

    def test_unsafe_evidence_paths_and_invalid_hashes_fail_without_reading_them(self):
        for path, digest in [("../private.pdf", "a" * 64), ("/private.pdf", "a" * 64),
                             ("safe.json", "not-a-sha256")]:
            with self.subTest(path=path):
                self.manifest["inputs"] = {path: digest}
                self.write_manifest()
                self.pin()
                with self.assertRaises(ValueError):
                    self.load()

    def test_symlink_escape_is_rejected_for_public_outputs(self):
        path = self.output / "locationResearch.json"
        external = self.root.parent / (self.root.name + "-outside.json")
        external.write_bytes(path.read_bytes())
        self.addCleanup(external.unlink)
        path.unlink()
        path.symlink_to(external)
        with self.assertRaisesRegex(ValueError, "escapes research root"):
            self.load()

    def test_changed_public_file_during_replay_is_detected_by_normalizer(self):
        inputs = normalizer.Inputs(self.root)
        self.load(inputs=inputs)
        (self.output / "source-verification.json").write_bytes(b"{}\n")
        with self.assertRaisesRegex(ValueError, "Source changed during normalization"):
            inputs.verify()

    def test_public_coverage_cannot_claim_unreleased_providers(self):
        self.values["coverage.json"]["combined"]["providerIds"].append("unreleased")
        self.approve()
        with self.assertRaisesRegex(ValueError, "coverage"):
            self.load()

    def test_unverified_snapshot_and_missing_output_declarations_fail_closed(self):
        self.snapshot["status"] = "collecting"
        (self.output / "public-snapshot.json").write_bytes(release.encode(self.snapshot))
        with self.assertRaisesRegex(ValueError, "snapshot.*reviewed"):
            self.load()
        self.manifest["outputs"].pop("source-verification.json")
        self.write_manifest()
        self.pin()
        with self.assertRaisesRegex(ValueError, "output roster"):
            self.load()


class ActualPublicReplayTests(unittest.TestCase):
    def test_canonical_normalize_and_build_replay_without_private_supplemental_inputs(self):
        root = ROOT / "research/north-jersey"
        expected_files, expected_manifest = normalizer.normalize(root, normalizer.COUNTIES)
        inputs = json.loads(expected_files["source-inputs.json"])["files"]
        private_directories = set(release.SOURCES)
        self.assertFalse(any(Path(path).parts[0] in private_directories for path in inputs))
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary)
            for relative in inputs:
                target = fixture / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(root / relative, target)
            files, manifest = normalizer.normalize(fixture, normalizer.COUNTIES)
            self.assertEqual(files, expected_files)
            self.assertEqual(manifest, expected_manifest)
            markets = normalizer.validate_release(files, manifest)
            self.assertEqual(markets[0]["id"], "north-jersey")
            released = json.loads((fixture / release.DIRECTORY / "locationResearch.json").read_bytes())
            actual = json.loads(files["locationResearch.json"])
            for pid, record in released.items():
                for fact in record["facts"]:
                    self.assertIn(fact, actual[pid]["facts"], pid)

    def test_released_research_replays_from_public_files_only(self):
        root = ROOT / "research/north-jersey"
        roster = json.loads((root / "address-points/providers-by-id.json").read_bytes())
        expected = json.loads((root / release.DIRECTORY / "locationResearch.json").read_bytes())
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary)
            output = fixture / release.DIRECTORY
            output.mkdir()
            for name in ("manifest.json", "public-snapshot.json", "locationResearch.json",
                         "coverage.json", "first-party-upgrades.json", "source-verification.json"):
                shutil.copyfile(root / release.DIRECTORY / name, output / name)
            inputs = normalizer.Inputs(fixture)
            actual = release.load_release(inputs, {}, roster, normalizer.COUNTIES)
            self.assertEqual(actual, expected)
            inputs.verify()


if __name__ == "__main__":
    unittest.main()
