import assert from "node:assert/strict";
import test from "node:test";
import data from "../src/data/facebook-research.json";
import catalog from "../src/data/providers.json";
import locationData from "../src/data/location-research.json";
import {
  getFacebookResearch,
  getFacebookSummary,
  type FacebookResearchDataset,
} from "../src/lib/facebook-research";
import {
  getLocationResearch,
  getResearchSummary,
} from "../src/lib/location-research";
import { computeExperienceScore } from "../src/lib/experience-score";
import { GET } from "../src/app/api/research/route";
import type { LocationResearch } from "../src/lib/location-research-types";

const snapshot = data as unknown as FacebookResearchDataset;
const locations = Object.entries(snapshot.locations);
const ids = new Set(catalog.map((p) => p.id));
const asOfDate = "2026-11-12";
const isFacebookUrl = (value: string) => {
  const u = new URL(value);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (u.hostname === "facebook.com" ||
      u.hostname.endsWith(".facebook.com") ||
      u.hostname === "fb.watch")
  );
};

test("curated pilot retains original assignments and reviewed location supplements with reconciled provenance", () => {
  assert.equal(snapshot.schemaVersion, 1);
  const originalAssignments = [
    "cms-225434",
    "cms-225469",
    "cms-225540",
    "cms-225654",
    "cms-225759",
    "cms-225656",
    "lifeplan-lasell-village",
    "ma-alr-waterstone-at-wellesley",
    "mgb-home-care",
    "north-river",
    "abc-home-healthcare",
    "all-care",
    "cms-225433",
    "lifeplan-brooksby-village",
    "ma-alr-harriett-and-ralph-kaplan-estates",
    "cms-225634",
    "lifeplan-newbridge-on-the-charles",
    "ma-alr-all-american-assisted-living-at-wareham",
    "ma-alr-discovery-village-quincy",
    "south-shore-vna",
  ];
  assert.deepEqual(
    Object.keys(snapshot.locations).sort(),
    [...originalAssignments, "ma-alr-edelweiss-village", "cms-225774"].sort(),
  );
  assert.ok(snapshot.runId.length > 0 && snapshot.reviewBasis.length > 30);
  assert.match(snapshot.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  const kinds = new Set([
    "resident-family",
    "recommendation",
    "tour",
    "provider-promotion",
    "employment",
  ]);
  const findingIds = new Set<string>();
  const publishedIds = new Set<string>();
  for (const [id, location] of locations) {
    assert.ok(ids.has(id), id);
    assert.ok(location.coverageExplanation.length > 15, id);
    assert.ok(
      [
        "findings-available",
        "no-relevant-result",
        "withheld",
        "partial",
      ].includes(location.status),
    );
    assert.ok(
      location.searchedAt && Number.isFinite(Date.parse(location.searchedAt)),
      id,
    );
    for (const count of [
      location.foundCount,
      location.publishedObservationCount,
      location.withheldCount,
    ])
      assert.ok(Number.isInteger(count) && count >= 0, id);
    assert.equal(
      location.foundCount,
      location.publishedObservationCount + location.withheldCount,
      id,
    );
    const observationIds = new Set<string>();
    for (const finding of location.findings) {
      assert.ok(!findingIds.has(finding.id));
      findingIds.add(finding.id);
      assert.ok(kinds.has(finding.kind));
      assert.ok(finding.summary.length > 10 && finding.summary.length < 2000);
      assert.ok(finding.sourceObservationIds.length > 0);
      for (const sourceId of finding.sourceObservationIds) {
        assert.ok(
          !observationIds.has(sourceId),
          `${id}: observations must not be counted twice`,
        );
        observationIds.add(sourceId);
        assert.ok(
          !publishedIds.has(sourceId),
          "A source observation must not be published under multiple locations",
        );
        publishedIds.add(sourceId);
      }
      for (const url of [
        finding.sourceUrl,
        finding.threadUrl,
        ...(finding.sourceUrls ?? []),
      ])
        assert.equal(
          isFacebookUrl(url),
          true,
          `${id}: source must be an attributed Facebook link`,
        );
      assert.ok(
        finding.date === null || /^\d{4}-\d{2}-\d{2}/.test(finding.date),
      );
      assert.ok(
        finding.limitations.length > 0,
        `${id}: selected accounts need source/selection limits`,
      );
      assert.deepEqual(
        Object.keys(finding).filter(
          (k) =>
            ![
              "id",
              "sourceObservationIds",
              "kind",
              "relationship",
              "summary",
              "date",
              "sourceUrl",
              "sourceUrls",
              "threadUrl",
              "topics",
              "limitations",
            ].includes(k),
        ),
        [],
        "Only curated public fields, no raw authors, medical narrative or ratings",
      );
    }
    assert.equal(
      observationIds.size,
      location.publishedObservationCount,
      `${id}: published count is observations, not grouped finding count`,
    );
    if (location.status === "no-relevant-result")
      assert.equal(location.foundCount, 0);
    if (location.status === "withheld") {
      assert.equal(location.findings.length, 0);
      assert.equal(location.publishedObservationCount, 0);
    }
  }
  assert.equal(publishedIds.size, 39);
  assert.equal(
    locations.reduce((n, [, r]) => n + r.foundCount, 0),
    71,
  );
  assert.equal(
    locations.reduce((n, [, r]) => n + r.withheldCount, 0),
    32,
  );
});

test("getter and compact card summary preserve every assigned state without treating unsearched locations as no results", () => {
  for (const [id, location] of locations) {
    const detail = getFacebookResearch(id)!;
    assert.equal(detail.providerId, id);
    assert.equal(detail.runId, snapshot.runId);
    assert.deepEqual(detail.findings, location.findings);
    const summary = getFacebookSummary(id)!;
    assert.deepEqual(summary, {
      status: location.status,
      searchedAt: location.searchedAt,
      foundCount: location.foundCount,
      publishedObservationCount: location.publishedObservationCount,
      withheldCount: location.withheldCount,
      findingCount: location.findings.length,
    });
    assert.deepEqual(getResearchSummary(id)?.facebookResearch, summary);
    assert.equal(Object.hasOwn(summary, "findings"), false);
  }
  const outside = catalog.find(
    (p) => !Object.hasOwn(snapshot.locations, p.id),
  )!.id;
  for (const id of [outside, "__proto__", "constructor", "unknown-provider"]) {
    assert.equal(getFacebookResearch(id), undefined);
    assert.equal(getFacebookSummary(id), undefined);
  }
});

test("Facebook findings never enter existing numeric review aggregates, source-family counts or clinical scores", () => {
  for (const [id] of locations) {
    const original = (locationData as Record<string, LocationResearch>)[id];
    const result = getLocationResearch(id, asOfDate);
    assert.deepEqual(result.reviewAggregates, original.reviewAggregates);
    assert.deepEqual(result.reviews, original.reviews);
    assert.deepEqual(
      result.experience,
      computeExperienceScore({
        sources: original.sources,
        reviewAggregates: original.reviewAggregates,
        reviews: original.reviews,
        asOfDate,
      }),
    );
  }
});

test("real research API attaches only the requested curated location and omits Facebook data for unsearched catalog IDs", async () => {
  const [id] = locations.find(([, v]) => v.findings.length > 0)!;
  const response = await GET(
    new Request(`http://localhost/api/research?id=${id}`),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.facebookResearch, getFacebookResearch(id));
  const outside = catalog.find(
    (p) => !Object.hasOwn(snapshot.locations, p.id),
  )!.id;
  const unsearched = await GET(
    new Request(`http://localhost/api/research?id=${outside}`),
  );
  assert.equal(unsearched.status, 200);
  assert.equal(
    Object.hasOwn(await unsearched.json(), "facebookResearch"),
    false,
  );
});
