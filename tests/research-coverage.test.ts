import { test } from "node:test";
import assert from "node:assert/strict";
import catalog from "../src/data/providers.json";
import {
  getResearchCoverage,
  researchCoverageCsv,
} from "../src/lib/research-coverage";
import { getLocationResearch } from "../src/lib/location-research";
import { searchProviders } from "../src/lib/search";
import { GET } from "../src/app/api/research-coverage/route";

test("every catalog location has an auditable score or an explicit research gap", () => {
  const result = getResearchCoverage("2026-11-12");
  assert.equal(result.total, catalog.length);
  assert.deepEqual(
    new Set(result.locations.map((row) => row.providerId)),
    new Set(catalog.map((row) => row.id)),
  );
  assert.equal(result.scored + result.unscored, result.total);
  assert.equal(result.facebookCovered, 22);
  assert.ok(result.facebookWithFindings > 0);
  for (const row of result.locations) {
    assert.equal(
      row.score,
      getLocationResearch(row.providerId, result.asOfDate).experience.value,
    );
    assert.ok(row.nextAction.length > 20);
    if (row.score !== null) {
      assert.equal(row.status, "scored");
      assert.ok(row.score >= 0 && row.score <= 10);
      assert.ok(row.eligibleReviews >= 10);
      assert.ok(row.ratingSourceUrls.length > 0);
    } else assert.notEqual(row.status, "scored");
  }
});

test("Facebook and unrated filters preserve geographic constraints and report result coverage", () => {
  for (const evidence of ["facebook", "unrated", "reviews"]) {
    const result = searchProviders({ zip: "02459", radius: 50, evidence });
    assert.ok(result.total > 0);
    assert.equal(
      result.experienceCoverage.scored + result.experienceCoverage.unscored,
      result.total,
    );
    for (const provider of result.providers) {
      assert.ok(provider.distanceMiles! <= 50);
      if (evidence === "facebook")
        assert.ok(provider.research!.facebookResearch!.findingCount > 0);
      if (evidence === "unrated")
        assert.equal(provider.research!.experience.value, null);
      if (evidence === "reviews")
        assert.notEqual(provider.research!.experience.value, null);
    }
  }
});

test("research export keeps missing scores blank and neutralizes spreadsheet formulas", async () => {
  const coverage = getResearchCoverage("2026-11-12");
  const missing = coverage.locations.find((row) => row.score === null)!;
  const csv = researchCoverageCsv({
    ...coverage,
    locations: [{ ...missing, name: '=HYPERLINK("https://example.com")' }],
  });
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes(`"${missing.zip}","","${missing.status}"`));
  assert.equal(csv.split("\r\n").length, 3);
  const response = GET(
    new Request("http://localhost/api/research-coverage?format=csv"),
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition")!,
    /^attachment; filename="harbor-experience-research-/,
  );
  assert.equal(
    (await response.text()).split("\r\n").length,
    catalog.length + 2,
  );
  for (const query of [
    "?format=csv&format=json",
    "?format=html",
    "?provider=foreign",
  ]) {
    assert.equal(
      GET(new Request(`http://localhost/api/research-coverage${query}`)).status,
      400,
    );
  }
});
