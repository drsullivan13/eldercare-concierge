"""Behavioral checks for supplemental publication without rebuilding shared snapshots."""

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("nj_supplemental.py")
spec = importlib.util.spec_from_file_location("nj_supplemental", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
normalizer_spec = importlib.util.spec_from_file_location("normalize_nj", SCRIPT.with_name("normalize-nj.py"))
normalizer = importlib.util.module_from_spec(normalizer_spec)
normalizer_spec.loader.exec_module(normalizer)


def record(pid="exact-office", source_id="supplemental-source", fact_id="supplemental-fact"):
    value = release.empty_record(pid)
    value.update(checkedAt="2026-11-13", providerDetailsReviewed=True)
    value["sources"] = [{
        "id": source_id, "url": "https://example.org/exact-office", "title": "Exact office",
        "publisher": "Provider", "kind": "provider", "access": "full-page",
        "checkedAt": "2026-11-13", "publishedAt": None,
    }]
    value["facts"] = [{
        "id": fact_id, "kind": "care", "text": "Local office reports companionship. Confirm availability.",
        "sourceId": source_id,
    }]
    value["notes"] = ["Office location is not a service-area assertion."]
    return value


class MergeTests(unittest.TestCase):
    def test_retains_existing_reviews_costs_and_conflicting_claims_without_scoring_supplement(self):
        baseline = record(source_id="old", fact_id="old-cost")
        baseline["facts"][0].update(kind="cost", text="Original qualified price")
        baseline["reviewAggregates"] = [{"rating": 4.5, "count": 27}]
        baseline["reviews"] = [{"id": "existing-review"}]
        before = deepcopy(baseline)
        patch = record()
        result = release.merge_research({"exact-office": baseline}, {"exact-office": patch})
        self.assertEqual(baseline, before)
        self.assertEqual(result["exact-office"]["reviewAggregates"], before["reviewAggregates"])
        self.assertEqual(result["exact-office"]["reviews"], before["reviews"])
        self.assertEqual([f["text"] for f in result["exact-office"]["facts"]],
                         ["Original qualified price", patch["facts"][0]["text"]])

    def test_repeated_merge_is_idempotent(self):
        patches = {"exact-office": record()}
        once = release.merge_research({}, patches)
        self.assertEqual(release.merge_research(once, patches), once)

    def test_identifier_conflicts_and_orphan_sources_fail_closed(self):
        patch = record()
        conflicting = deepcopy(patch)
        conflicting["facts"][0]["text"] = "A different claim"
        with self.assertRaisesRegex(ValueError, "Conflicting supplemental facts"):
            release.merge_research({"exact-office": patch}, {"exact-office": conflicting})
        conflicting = deepcopy(patch)
        conflicting["sources"][0]["url"] = "https://example.org/wrong-office"
        with self.assertRaisesRegex(ValueError, "Conflicting supplemental sources"):
            release.merge_research({"exact-office": patch}, {"exact-office": conflicting})
        patch["facts"][0]["sourceId"] = "missing"
        with self.assertRaisesRegex(ValueError, "no source"):
            release.merge_research({}, {"exact-office": patch})

    def test_reviews_cannot_enter_supplemental_release(self):
        patch = record()
        patch["reviewAggregates"] = [{"rating": 5}]
        with self.assertRaisesRegex(ValueError, "review evidence is forbidden"):
            release.merge_research({}, {"exact-office": patch})

    def test_conflicting_availability_remains_visible_without_overriding_existing(self):
        original = record(source_id="old", fact_id="old-fact")
        original["availability"].update(status="waitlist-published", sourceId="old",
                                        text="Unit has a published waitlist.")
        patch = record()
        patch["availability"].update(status="inquiry-only", sourceId="supplemental-source",
                                     text="Campus says call for availability.")
        merged = release.merge_research({"exact-office": original}, {"exact-office": patch})
        target = merged["exact-office"]
        self.assertEqual(target["availability"], original["availability"])
        self.assertIn("Campus says call", target["facts"][-1]["text"])
        self.assertEqual(release.merge_research(merged, {"exact-office": patch}), merged)

    def test_coverage_counts_unique_provider_gains_by_setting(self):
        records = {"a": {}, "b": {}, "c": {}}
        providers = [{"id": "a", "category": "home-care"}, {"id": "b", "category": "home-care"},
                     {"id": "c", "category": "life-plan"}]
        counts = release.coverage(records, {"a": {}}, providers)
        self.assertEqual(counts["uniqueProviders"], 3)
        self.assertEqual(counts["newResearchProvidersByType"], {"home-care": 1, "life-plan": 1})


class ReleaseBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / release.DIRECTORY
        self.output.mkdir()
        patch = {"exact-office": record()}
        body = release.encode(patch)
        (self.output / "locationResearch.json").write_bytes(body)
        (self.root / "verified.json").write_text("{}\n")
        self.identity = {
            "name": "Exact office", "category": "home-care", "address": "1 Main St",
            "city": "Union", "state": "NJ", "zip": "07083",
        }
        self.roster = {"exact-office": {
            "name": self.identity["name"], "setting": self.identity["category"], "county": "Union",
            "suppliedAddress": {key: self.identity[key] for key in ("address", "city", "state", "zip")},
        }}
        self.manifest = {
            "schemaVersion": 1, "status": "verified", "sources": dict.fromkeys(release.SOURCES, {}),
            "inputs": {"verified.json": hashlib.sha256(b"{}\n").hexdigest()},
            "outputs": {"locationResearch.json": hashlib.sha256(body).hexdigest()},
            "identities": {"exact-office": self.identity},
        }
        self.write_manifest()

    def write_manifest(self):
        (self.output / "manifest.json").write_bytes(release.encode(self.manifest))

    def load(self, counties=("Union",)):
        return release.load_release(normalizer.Inputs(self.root), {}, self.roster, counties)

    def test_normalizer_boundary_loads_exact_provider_only_in_selected_counties(self):
        self.assertIn("exact-office", self.load())
        self.assertEqual(self.load(("Morris",)), {})
        self.roster["exact-office"]["suppliedAddress"]["address"] = "2 Main St"
        with self.assertRaisesRegex(ValueError, "identity changed"):
            self.load()

    def test_changed_source_and_output_fail_closed(self):
        (self.root / "verified.json").write_text('{"changed": true}\n')
        with self.assertRaisesRegex(ValueError, "input changed"):
            self.load()
        (self.root / "verified.json").write_text("{}\n")
        (self.output / "locationResearch.json").write_text("{}\n")
        with self.assertRaisesRegex(ValueError, "release hash mismatch"):
            self.load()

    def test_unreviewed_release_and_escaped_input_fail_closed(self):
        self.manifest["status"] = "collecting"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "not verified"):
            self.load()
        self.manifest["status"] = "verified"
        self.manifest["inputs"] = {"../outside.json": "bad"}
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "escapes research root"):
            self.load()

    def test_missing_manifest_cannot_silently_drop_existing_supplemental_facts(self):
        (self.output / "manifest.json").unlink()
        with self.assertRaisesRegex(ValueError, "without a verified manifest"):
            self.load()


class ActualReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = release.ROOT / "research/north-jersey"
        cls.files = release.build(cls.root)
        cls.patches = json.loads(cls.files["locationResearch.json"])
        cls.roster = json.loads((cls.root / "address-points/providers-by-id.json").read_bytes())
        cls.records = normalizer.released_research(normalizer.Inputs(cls.root), cls.roster, normalizer.COUNTIES)
        cls.baseline = {}
        for origin in ("offerings", "review-release"):
            for pid, record in json.loads((cls.root / origin / "locationResearch.json").read_bytes()).items():
                if pid not in cls.baseline:
                    cls.baseline[pid] = deepcopy(record)
                    continue
                target = cls.baseline[pid]
                for field in ("sources", "facts", "reviewAggregates", "reviews", "notes"):
                    for item in record[field]:
                        if item not in target[field]:
                            target[field].append(deepcopy(item))
                for field in ("reviewSamples", "availability", "admissionRestriction"):
                    value = record.get(field)
                    if value and (field == "reviewSamples" or value.get("sourceId")):
                        target[field] = deepcopy(value)
                target["checkedAt"] = max(target["checkedAt"], record["checkedAt"])
                target["providerDetailsReviewed"] |= record["providerDetailsReviewed"]
        normalizer.add_public_review_context(
            normalizer.Inputs(cls.root), cls.baseline, cls.roster, normalizer.COUNTIES)

    def test_actual_release_reproduces_every_saved_output(self):
        for name, body in self.files.items():
            self.assertEqual((self.root / release.DIRECTORY / name).read_bytes(), body, name)

    def test_final_source_counts_and_every_exact_provider_reach_normalization(self):
        sources = json.loads(self.files["coverage.json"])["sources"]
        self.assertEqual(sources["home-care-first-party"]["uniqueProviders"],
                         len(json.loads((self.root / "home-care-first-party/records.json").read_bytes())))
        self.assertEqual(sources["nppes-organizations"]["uniqueProviders"],
                         len(json.loads((self.root / "nppes-organizations/matches.json").read_bytes())))
        self.assertEqual(sources["association-directory"]["uniqueProviders"],
                         len(json.loads((self.root / "association-directory/accepted-services.json").read_bytes())))
        for pid, record in self.patches.items():
            self.assertTrue(record["facts"], pid)
            self.assertEqual(record["reviews"], [])
            self.assertEqual(record["reviewAggregates"], [])
            for fact in record["facts"]:
                self.assertIn(fact, self.records[pid]["facts"], pid)
        self.assertNotIn("north-jersey-campus-fritz-reuter-altenheim-07047", self.patches)

    def test_payment_qualifiers_daily_rates_conflicts_and_unit_scope_survive(self):
        payments = self.records["north-jersey-hp-hp0184500"]["facts"]
        self.assertEqual(sum(f["id"].startswith("supp-association-") and f["kind"] == "cost" for f in payments), 3)
        for fact in payments:
            if fact["id"].startswith("supp-association-") and fact["kind"] == "cost":
                self.assertIn("Medicaid PCA, Private PCA", fact["text"])
                self.assertIn("not a quoted price", fact["text"])
                self.assertNotIn("amount", fact)
        lantern = self.records["north-jersey-campus-lantern-hill-07974"]["facts"]
        conflict = next(f for f in lantern if f["id"] == "campus-offerings-lantern-hill-il-refund-conflict")
        self.assertIn("80%", conflict["text"])
        self.assertIn("90%", conflict["text"])
        cedar = self.records["north-jersey-campus-cedar-crest-village-07444"]["facts"]
        rate = next(f for f in cedar if f["id"] == "campus-offerings-cedar-crest-mc-daily")
        self.assertEqual(rate["amount"]["min"], 621)
        self.assertEqual(rate["amount"]["period"], "day")
        self.assertIsNone(rate["amount"]["asOf"])
        self.assertFalse(any(f["id"].startswith("campus-offerings-")
                             for f in self.records["cms-315491"]["facts"]))
        for pid, row in self.patches.items():
            for fact in row["facts"]:
                if fact["id"].startswith("supp-nppes"):
                    self.assertIn("not verified staffed services", fact["text"])
                    self.assertNotIn("amount", fact)

    def test_real_research_api_returns_every_fact_without_changing_experience(self):
        program = """
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { markets } = require('./src/lib/markets.ts');
const { GET } = require('./src/app/api/research/route.ts');
const { getResearchSummary } = require('./src/lib/location-research.ts');
const { baseline, merged, patches } = JSON.parse(fs.readFileSync(0, 'utf8'));
const market = markets.find(market => market.id === 'north-jersey');
async function run() {
  let count = 0;
  for (const [pid, patch] of Object.entries(patches)) {
    market.locationResearch = baseline;
    const before = await GET(new Request('http://localhost/api/research?id=' + pid)).json();
    market.locationResearch = merged;
    const response = GET(new Request('http://localhost/api/research?id=' + pid));
    assert.equal(response.status, 200, pid);
    const data = await response.json();
    assert.equal(data.providerId, pid);
    assert.deepEqual(data.experience, before.experience, pid + ' experience changed');
    assert.equal(data.reviewSamples, undefined);
    for (const fact of patch.facts) {
      assert.deepEqual(data.facts.find(item => item.id === fact.id), fact, pid + ' fact missing');
      assert.ok(data.sources.some(source => source.id === fact.sourceId));
    }
    const summary = getResearchSummary(pid);
    assert.equal(summary.publishedCosts,
      data.facts.filter(fact => fact.kind === 'cost' && fact.amount?.min > 0).length);
    count++;
  }
  console.log(JSON.stringify({ actualResearchApiProvidersVerified: count }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
"""
        result = subprocess.run(
            ["node", "--import", "tsx", "--eval", program], cwd=release.ROOT,
            input=json.dumps({"baseline": self.baseline, "merged": self.records, "patches": self.patches}),
            text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["actualResearchApiProvidersVerified"], len(self.patches))


if __name__ == "__main__":
    unittest.main()
