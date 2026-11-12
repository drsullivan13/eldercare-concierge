import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../src/app/api/research/route";
import { getFacebookResearch } from "../../src/lib/facebook-research";
import { getLocationResearch } from "../../src/lib/location-research";
import { createMarketRegistry, markets } from "../../src/lib/markets";
import {
  getResearchCoverage,
  researchCoverageCsv,
} from "../../src/lib/research-coverage";

const cedar = "north-jersey-campus-cedar-crest-village-07444";
const lantern = "north-jersey-campus-lantern-hill-07974";

test("NJ reviewed family thread reaches the research route without a Facebook rating", async () => {
  const response = GET(
    new Request(`http://localhost/api/research?id=${cedar}`),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.facebookResearch.status, "findings-available");
  assert.equal(body.facebookResearch.foundCount, 16);
  assert.equal(body.facebookResearch.withheldCount, 9);
  assert.equal(body.facebookResearch.publishedObservationCount, 7);
  assert.equal(body.facebookResearch.findings.length, 1);
  assert.equal(body.facebookResearch.findings[0].kind, "resident-family");
  assert.equal(
    body.facebookResearch.findings[0].sourceObservationIds.length,
    7,
  );
  assert.deepEqual(
    body.facebookResearch.findings[0].sourceObservationIds,
    [3, 4, 5, 6, 10, 12, 13].map(
      (n) => `fb-njfu-b-${String(n).padStart(3, "0")}`,
    ),
  );
  assert.equal(body.familyExperience.distinctThreadCount, 1);
  assert.equal(body.facebookResearch.findings[0].date, "2022-06-06");
  const victoria = getFacebookResearch("north-jersey-doh-nj60a004");
  assert.equal(victoria?.findings.length, 1);
  assert.equal(victoria?.publishedObservationCount, 1);
  assert.equal(victoria?.findings[0].date, "2026-10-06");
  assert.match(body.facebookResearch.findings[0].summary, /2022/);

  assert.equal(getFacebookResearch(lantern)?.foundCount, 2);
  assert.equal(getFacebookResearch("cms-315009")?.foundCount, 2);
  assert.equal(getFacebookResearch("nj-u-08"), undefined);
  assert.equal(
    getFacebookResearch("north-jersey-doh-nj60a002")?.status,
    "partial",
  );
  assert.equal(getFacebookResearch("cms-315329")?.status, "no-relevant-result");
});

test("Facebook coverage leaves every existing NJ numeric experience score unchanged", () => {
  const market = markets.find((item) => item.id === "north-jersey");
  assert.ok(market);
  const withoutFacebook = createMarketRegistry(
    markets.map((item) =>
      item.id === market.id ? { ...item, facebookResearch: undefined } : item,
    ),
  );
  for (const { id: providerId } of market.providers) {
    const current = getLocationResearch(providerId, "2026-11-12");
    const baseline = getLocationResearch(
      providerId,
      "2026-11-12",
      withoutFacebook,
    );
    assert.deepEqual(current.experience, baseline.experience, providerId);
    assert.deepEqual(
      current.reviewAggregates,
      baseline.reviewAggregates,
      providerId,
    );
  }
});

test("coverage checklist exports reviewed states and no private Facebook content", () => {
  const coverage = getResearchCoverage("2026-11-12", "north-jersey");
  assert.equal(coverage.facebookCovered, 20);
  assert.equal(coverage.facebookWithFindings, 2);
  assert.equal(
    coverage.locations.filter((row) => row.facebookStatus === "withheld")
      .length,
    8,
  );
  assert.equal(
    coverage.locations.filter((row) => row.facebookStatus === "partial").length,
    2,
  );
  assert.equal(
    coverage.locations.filter(
      (row) => row.facebookStatus === "no-relevant-result",
    ).length,
    8,
  );
  const csv = researchCoverageCsv(coverage);
  assert.ok(csv.includes(cedar));
  assert.ok(!csv.includes("fb-njfu-"));
  assert.ok(!csv.includes("facebook.com/"));
});
