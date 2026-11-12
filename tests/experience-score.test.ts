import test from "node:test";
import assert from "node:assert/strict";
import {
  computeExperienceScore,
  type ExperienceAggregate,
  type ExperienceSource,
} from "../src/lib/experience-score";

// Synthetic policy fixtures only; these are not actual provider reviews.
const today = "2026-11-12";
function source(
  id: string,
  changes: Partial<ExperienceSource> = {},
): ExperienceSource {
  return {
    id,
    url: `https://${id}.example.test/location`,
    kind: "review-platform",
    checkedAt: today,
    access: "full-page",
    ...changes,
  };
}
function aggregate(
  id: string,
  changes: Partial<ExperienceAggregate> = {},
): ExperienceAggregate {
  return {
    sourceId: id,
    platform: id,
    sourceFamily: id,
    rating: 4,
    scale: 5,
    count: 10,
    asOf: null,
    scope: "consumer",
    ...changes,
  };
}
function score(
  aggregates: ExperienceAggregate[],
  sources = aggregates.map((a) => source(a.sourceId)),
  asOfDate = today,
) {
  return computeExperienceScore({
    reviewAggregates: aggregates,
    sources,
    asOfDate,
  });
}

test("absent evidence, excerpts alone and nine reported reviews remain unrated rather than zero", () => {
  assert.equal(score([]).value, null);
  const result = computeExperienceScore({
    reviewAggregates: [],
    sources: [source("social")],
    reviews: [
      {
        id: "selected-positive-post",
        sourceId: "social",
        date: today,
        relationship: "family",
      },
    ],
    asOfDate: today,
  });
  assert.equal(result.value, null);
  assert.equal(result.reviewCount, 0);
  assert.equal(score([aggregate("one", { count: 9 })]).confidence, "unrated");
});

test("single-platform evidence can be rated but is explicitly limited even with many reviews", () => {
  const result = score([aggregate("one", { rating: 4.3, count: 1000 })]);
  assert.equal(result.value, 8.6);
  assert.equal(result.confidence, "limited");
  assert.equal(result.reviewCount, 1000);
  assert.equal(result.independentSourceCount, 1);
  assert.equal(result.includedSources[0].weight, 1);
});

test("normalized published averages combine with bounded source weights, not pooled invented reviewers", () => {
  const result = score([
    aggregate("a", { rating: 4, count: 10000 }),
    aggregate("b", { rating: 6, scale: 10, count: 25 }),
  ]);
  assert.equal(result.value, 7.3); // 8*(10/15) + 6*(5/15), rounded once.
  assert.equal(result.reviewCount, 10025);
  assert.equal(result.confidence, "moderate");
  assert.equal(result.includedSources[0].weight, 2 / 3);
  assert.equal(result.includedSources[1].weight, 1 / 3);
});

test("APFM and SeniorAdvisor syndication cannot create an independent vote or cross the count threshold", () => {
  const result = score([
    aggregate("apfm", {
      platform: "A Place for Mom",
      sourceFamily: "a-place-for-mom",
      count: 6,
      rating: 2.6,
    }),
    aggregate("mirror", {
      platform: "SeniorAdvisor.com",
      sourceFamily: "senioradvisor",
      count: 6,
      rating: 2.6,
    }),
  ]);
  assert.equal(result.value, null);
  assert.equal(result.reviewCount, 6);
  assert.equal(result.independentSourceCount, 1);
  assert.equal(result.excludedSources.length, 1);
});

test("the newest source-family snapshot wins rather than its highest rating", () => {
  const result = score([
    aggregate("old", {
      sourceFamily: "shared",
      asOf: "2026-10-01",
      rating: 5,
      count: 80,
    }),
    aggregate("new", {
      sourceFamily: "shared",
      asOf: "2026-11-01",
      rating: 2,
      count: 20,
    }),
  ]);
  assert.equal(result.value, 4);
  assert.equal(result.reviewCount, 20);
  assert.equal(result.includedSources[0].sourceId, "new");
});

test("duplicate page URLs and transitive shared families do not manufacture independent evidence", () => {
  const aggregates = [
    aggregate("a", { sourceFamily: "one" }),
    aggregate("b", { sourceFamily: "two" }),
    aggregate("c", { sourceFamily: "two" }),
  ];
  const result = score(aggregates, [
    source("a", { url: "https://example.test/one?tracking=a" }),
    source("b", { url: "https://www.example.test/one/#reviews" }),
    source("c"),
  ]);
  assert.equal(result.independentSourceCount, 1);
  assert.equal(result.reviewCount, 10);
});

test("employee, sales-only, brand, ambiguous scope, provider promotion and snippets never enter the score", () => {
  const scopes = ["staff", "employee", "sales-only", "brand", "ambiguous"];
  const aggregates = [
    ...scopes.map((scope) => aggregate(scope, { scope, count: 100 })),
    aggregate("promotional"),
    aggregate("snippet"),
  ];
  const sources = [
    ...scopes.map((id) => source(id)),
    source("promotional", { kind: "provider" }),
    source("snippet", { access: "search-result" }),
  ];
  const result = score(aggregates, sources);
  assert.equal(result.value, null);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.excludedSources.length, aggregates.length);
});

test("unknown counts, no-review zeros, invalid ratings and recommendation percentages are not averages", () => {
  const changes: Partial<ExperienceAggregate>[] = [
    { count: null },
    { count: 0, rating: 0 },
    { count: 1.5 },
    { count: Infinity },
    { rating: null },
    { rating: NaN },
    { rating: 5.1 },
    { rating: -1 },
    { rating: 90, scale: 100 },
  ];
  const result = score(
    changes.map((change, i) => aggregate(`bad${i}`, change)),
  );
  assert.equal(result.value, null);
  assert.equal(result.excludedSources.length, changes.length);
});

test("source-check expiration is evaluated at the explicit request date, including exact boundary", () => {
  const item = aggregate("one");
  const sources = [source("one", { checkedAt: "2026-05-16" })];
  assert.equal(score([item], sources, "2026-11-12").value, 8); // 180 days.
  assert.equal(score([item], sources, "2026-11-13").value, null);
});

test("known old or impossible snapshot dates cannot masquerade as newly checked reviews", () => {
  const items = [
    aggregate("old", { asOf: "2025-11-11" }),
    aggregate("future", { asOf: "2026-11-13" }),
    aggregate("invalid", { asOf: "2026-02-30" }),
  ];
  assert.equal(score(items).value, null);
  assert.equal(score([aggregate("unknown-date")]).value, 8);
  assert.throws(() => score([], [], "2026-02-30"), RangeError);
});

test("unlinked, duplicate-ID and invalid-URL source evidence is not silently accepted", () => {
  assert.equal(score([aggregate("missing")], []).value, null);
  assert.equal(
    score([aggregate("dup")], [source("dup"), source("dup")]).value,
    null,
  );
  assert.equal(
    score([aggregate("bad")], [source("bad", { url: "javascript:alert(1)" })])
      .value,
    null,
  );
});

test("selected positive or negative excerpts and input order cannot alter the index", () => {
  const reviewAggregates = [
    aggregate("a", { rating: 3.7, count: 44 }),
    aggregate("b", { rating: 4.1, count: 42 }),
  ];
  const sources = reviewAggregates.map((a) => source(a.sourceId));
  const before = JSON.stringify({ reviewAggregates, sources });
  const base = computeExperienceScore({
    reviewAggregates,
    sources,
    asOfDate: today,
  });
  const withExcerpt = computeExperienceScore({
    reviewAggregates: [...reviewAggregates].reverse(),
    sources,
    reviews: [
      {
        id: "selected-negative",
        sourceId: "a",
        date: "2020-01-01",
        relationship: "unknown",
      },
    ],
    asOfDate: today,
  });
  assert.deepEqual(base, withExcerpt);
  assert.equal(JSON.stringify({ reviewAggregates, sources }), before);
});
