import test from "node:test";
import assert from "node:assert/strict";
import { getLocationResearch } from "../src/lib/location-research";
import {
  computeExperienceScore,
  type ExperienceAggregate,
  type ExperienceSource,
  type ExperienceScoreInput,
} from "../src/lib/experience-score";

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
    count: 30,
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
    aggregate("b", { rating: 7, scale: 10, count: 25 }),
  ]);
  assert.equal(result.value, 7.7); // 8*(10/15) + 7*(5/15), rounded once.
  assert.equal(result.reviewCount, 10025);
  assert.equal(result.confidence, "moderate");
  assert.equal(result.aggregateRange?.substantial, false);
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
      count: 30,
    }),
  ]);
  assert.equal(result.value, 4);
  assert.equal(result.reviewCount, 30);
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
  assert.equal(result.reviewCount, 30);
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

test("ineligible excerpts cannot alter the numeric index and input order never alters the summary", () => {
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
  assert.equal(base.value, withExcerpt.value);
  assert.equal(base.confidence, withExcerpt.confidence);
  assert.equal(withExcerpt.narrativeDiagnostics?.excludedReviews.length, 1);
  assert.deepEqual(
    base,
    computeExperienceScore({
      reviewAggregates: [...reviewAggregates].reverse(),
      sources: [...sources].reverse(),
      asOfDate: today,
    }),
  );
  assert.equal(JSON.stringify({ reviewAggregates, sources }), before);
});

test("sparse single-family evidence is withheld symmetrically, never shrunk toward a made-up average", () => {
  for (const rating of [0, 1, 4.9, 5]) {
    assert.equal(score([aggregate("one", { rating, count: 29 })]).value, null);
    assert.equal(
      score([aggregate("one", { rating, count: 30 })]).value,
      rating * 2,
    );
  }
  assert.equal(
    score([aggregate("a", { count: 5 }), aggregate("b", { count: 5 })]).value,
    8,
  );
  assert.equal(
    score([aggregate("a", { count: 9 }), aggregate("b", { count: 1 })]).value,
    null,
  );
  assert.equal(
    score([aggregate("a", { count: 29 }), aggregate("b", { count: 1 })]).value,
    null,
  );
  assert.equal(
    score([aggregate("a", { count: 30 }), aggregate("b", { count: 1 })])
      .confidence,
    "limited",
  );
  assert.equal(
    score([aggregate("a", { count: 20 }), aggregate("b", { count: 10 })])
      .confidence,
    "moderate",
  );
});

test("strong disagreement withholds the composite and preserves the source averages", () => {
  const mixed = score([
    aggregate("a", { rating: 5, count: 100 }),
    aggregate("b", { rating: 1, count: 100 }),
  ]);
  assert.equal(mixed.value, null);
  assert.equal(mixed.publicationStatus, "sources-disagree");
  assert.equal(mixed.confidence, "unrated");
  assert.deepEqual(
    mixed.includedSources.map((s) => [s.rating, s.count]),
    [
      [5, 100],
      [1, 100],
    ],
  );
  assert.deepEqual(mixed.aggregateRange, {
    minimum: 2,
    maximum: 10,
    substantial: true,
  });
  assert.match(mixed.reason, /withheld its score/);
  const tinyDissent = score([
    aggregate("a", { rating: 5, count: 10000 }),
    aggregate("b", { rating: 1, count: 1 }),
  ]);
  assert.equal(tinyDissent.value, 9.3);
  assert.equal(tinyDissent.aggregateRange?.minimum, 2);
  assert.equal(tinyDissent.confidence, "limited");
  const consistent = score([
    aggregate("a", { rating: 4.9, count: 100 }),
    aggregate("b", { rating: 4.8, count: 100 }),
  ]);
  assert.equal(consistent.value, 9.7);
  assert.equal(consistent.confidence, "moderate");
  assert.equal(consistent.methodVersion, "2.0");
  for (const rating of [4, 4.00001]) {
    assert.equal(
      score([aggregate("a", { rating: 5 }), aggregate("b", { rating })])
        .aggregateRange?.substantial,
      rating === 4,
    );
  }
});

function primaryReview(
  changes: Partial<NonNullable<ExperienceScoreInput["reviews"]>[number]> = {},
) {
  return {
    id: "selected-primary",
    sourceId: "primary",
    url: "https://www.aplaceformom.com/community/synthetic-location-1",
    date: today,
    relationship: "family",
    excerpt: "Synthetic first-person family account, not an actual review.",
    aspects: [{ aspect: "care", sentiment: "negative" }],
    ...changes,
  };
}
function withNarratives(
  reviews: NonNullable<ExperienceScoreInput["reviews"]>,
  changes: Partial<ExperienceScoreInput> = {},
) {
  const reviewAggregates = [
    aggregate("a", { rating: 4.8 }),
    aggregate("b", { rating: 4.6 }),
  ];
  return computeExperienceScore({
    reviewAggregates,
    sources: [
      ...reviewAggregates.map((a) => source(a.sourceId)),
      source("primary", { url: primaryReview().url }),
    ],
    asOfDate: today,
    ...changes,
    reviews,
  });
}

test("eligible independent primary sentiment qualifies confidence without inventing stars or reviewers", () => {
  const base = withNarratives([]);
  assert.equal(base.value, 9.4);
  assert.equal(base.confidence, "moderate");
  for (const sentiments of [
    ["negative"],
    ["positive", "negative"],
    ["mixed"],
  ]) {
    const result = withNarratives([
      primaryReview({
        aspects: sentiments.map((sentiment) => ({ aspect: "care", sentiment })),
      }),
    ]);
    assert.equal(result.value, base.value);
    assert.equal(result.reviewCount, base.reviewCount);
    assert.deepEqual(result.includedSources, base.includedSources);
    assert.equal(result.confidence, "limited");
    assert.match(result.reason, /Selection is not representative/);
    assert.equal(
      result.narrativeDiagnostics?.includedReviews[0].independent,
      true,
    );
  }
  assert.equal(
    withNarratives([
      primaryReview({
        aspects: [{ aspect: "care", sentiment: "positive" }],
      }),
    ]).confidence,
    "moderate",
  );
  const sparse = withNarratives(
    Array.from({ length: 100 }, (_, i) =>
      primaryReview({ id: `review-${i}`, excerpt: `Synthetic account ${i}` }),
    ),
    { reviewAggregates: [aggregate("a", { rating: 5, count: 29 })] },
  );
  assert.equal(sparse.value, null);
  assert.equal(sparse.reviewCount, 29);
  assert.equal(sparse.confidence, "unrated");
});

test("positive and negative selections cannot outvote each other or repair a low aggregate by selection", () => {
  const positive = primaryReview({
    id: "positive",
    excerpt: "Different synthetic positive account.",
    aspects: [{ aspect: "care", sentiment: "positive" }],
  });
  const result = withNarratives([primaryReview(), positive]);
  assert.equal(result.confidence, "limited");
  assert.match(result.reason, /1 positive, 1 negative/);
  const low = withNarratives([positive], {
    reviewAggregates: [
      aggregate("a", { rating: 1 }),
      aggregate("b", { rating: 1.5 }),
    ],
  });
  assert.equal(low.value, 2.5);
  assert.equal(low.confidence, "limited");
});

test("same-family and republished aggregate reviews are context, not independent corroboration", () => {
  const reviewAggregates = [
    aggregate("a", { rating: 4.8 }),
    aggregate("mirror", {
      rating: 4.6,
      sourceFamily: "apfm",
      platform: "SeniorAdvisor",
    }),
  ];
  const result = withNarratives([primaryReview()], {
    reviewAggregates,
    sources: [
      source("a"),
      source("mirror"),
      source("primary", { url: primaryReview().url }),
    ],
  });
  assert.equal(result.confidence, "moderate");
  assert.equal(
    result.narrativeDiagnostics?.includedReviews[0].independent,
    false,
  );
  assert.match(result.reason, /not additional independent votes/);
  const renamed = score(
    [
      aggregate("a", { sourceFamily: "renamed", platform: "renamed" }),
      aggregate("b", { sourceFamily: "apfm", platform: "APFM" }),
    ],
    [source("a", { url: primaryReview().url }), source("b")],
  );
  assert.equal(renamed.independentSourceCount, 1);
});

test("narrative eligibility rejects ambiguous identity, snippets, mirrors, undated and stale selections", () => {
  const invalidReviews = [
    primaryReview({ relationship: "staff" }),
    primaryReview({ relationship: "visitor" }),
    primaryReview({ relationship: "unknown" }),
    primaryReview({ date: null }),
    primaryReview({ date: "2024-11-11" }),
    primaryReview({ date: "2026-02-30" }),
    primaryReview({ date: "2026-11-13" }),
    primaryReview({ excerpt: "" }),
    primaryReview({ aspects: [] }),
    primaryReview({ aspects: [{ aspect: "care", sentiment: "inferred" }] }),
    primaryReview({
      url: "https://www.aplaceformom.com/community/another-location-2",
    }),
  ];
  for (const review of invalidReviews) {
    const result = withNarratives([review]);
    assert.equal(result.confidence, "moderate", JSON.stringify(review));
    assert.equal(result.narrativeDiagnostics?.includedReviews.length, 0);
    assert.equal(result.narrativeDiagnostics?.excludedReviews.length, 1);
  }
  assert.equal(
    withNarratives([primaryReview({ date: "2024-11-12" })]).narrativeDiagnostics
      ?.includedReviews.length,
    1,
  );
  for (const changes of [
    { access: "search-result" },
    { kind: "provider" },
    { kind: "public-discussion" },
    { url: "https://reviews.birdeye.com/synthetic" },
    { checkedAt: "2026-05-15" },
  ]) {
    const result = withNarratives([primaryReview()], {
      sources: [
        source("a"),
        source("b"),
        source("primary", { url: primaryReview().url, ...changes }),
      ],
    });
    assert.equal(result.narrativeDiagnostics?.includedReviews.length, 0);
  }
  assert.equal(
    withNarratives([primaryReview()], {
      reviewAggregates: [
        aggregate("a"),
        aggregate("primary", { scope: "ambiguous" }),
      ],
    }).narrativeDiagnostics?.includedReviews.length,
    0,
  );
  assert.equal(
    withNarratives([primaryReview()], {
      sources: [
        source("a"),
        source("b"),
        source("primary", { url: primaryReview().url }),
        source("primary", { url: primaryReview().url }),
      ],
    }).narrativeDiagnostics?.includedReviews.length,
    0,
  );
});

test("narrative cross-posts, conflicting annotations and transitive duplicates stay one account in either order", () => {
  const reviews = [
    primaryReview({ id: "one" }),
    primaryReview({ id: "one", excerpt: "Second synthetic text." }),
    primaryReview({
      id: "two",
      excerpt: "SECOND synthetic text!",
      aspects: [{ aspect: "staff", sentiment: "positive" }],
    }),
  ];
  const before = JSON.stringify(reviews);
  const result = withNarratives(reviews);
  assert.equal(result.narrativeDiagnostics?.includedReviews.length, 1);
  assert.equal(
    result.narrativeDiagnostics?.includedReviews[0].sentiment,
    "mixed",
  );
  assert.equal(result.narrativeDiagnostics?.excludedReviews.length, 2);
  assert.deepEqual(result, withNarratives([...reviews].reverse()));
  assert.equal(JSON.stringify(reviews), before);
});

test("identity-bearing query parameters cannot transfer narrative evidence between locations", () => {
  const url = "https://www.google.com/maps?cid=one";
  const result = withNarratives(
    [
      primaryReview({
        url: "https://www.google.com/maps?cid=another",
      }),
    ],
    {
      sources: [source("a"), source("b"), source("primary", { url })],
    },
  );
  assert.equal(result.narrativeDiagnostics?.includedReviews.length, 0);
  const same = withNarratives(
    [primaryReview({ url: `${url}&utm_source=test` })],
    {
      sources: [source("a"), source("b"), source("primary", { url })],
    },
  );
  assert.equal(same.narrativeDiagnostics?.includedReviews.length, 1);
});

test("cross-posts cannot hide their overlap with a represented aggregate family", () => {
  const first = primaryReview({ id: "a" });
  const caringUrl = "https://www.caring.com/senior-living/state/city/synthetic";
  const result = withNarratives(
    [first, primaryReview({ id: "b", sourceId: "caring", url: caringUrl })],
    {
      reviewAggregates: [
        aggregate("a", { rating: 4.8 }),
        aggregate("caring", { rating: 4.6, sourceFamily: "caring" }),
      ],
      sources: [
        source("a"),
        source("caring", { url: caringUrl }),
        source("primary", { url: first.url }),
      ],
    },
  );
  assert.equal(result.narrativeDiagnostics?.includedReviews.length, 1);
  assert.equal(
    result.narrativeDiagnostics?.includedReviews[0].independent,
    false,
  );
  assert.equal(result.confidence, "moderate");
});

test("discarded transitive aggregate representations cannot re-enter as independent narratives", () => {
  const result = withNarratives([primaryReview()], {
    reviewAggregates: [
      aggregate("a", { count: 100, sourceFamily: "google" }),
      aggregate("bridge", { sourceFamily: "apfm" }),
      aggregate("primary", { sourceFamily: "apfm" }),
    ],
    sources: [
      source("a", { url: "https://mirror.example.test/synthetic" }),
      source("bridge", { url: "https://mirror.example.test/synthetic" }),
      source("primary", { url: primaryReview().url }),
    ],
  });
  assert.equal(result.independentSourceCount, 1);
  assert.equal(
    result.narrativeDiagnostics?.includedReviews[0].independent,
    false,
  );
});

test("retained NJ property counterexamples pass through the normal research getter with explicit before/after values", () => {
  const examples = [
    ["north-jersey-doh-nj90a001", 9.8, 28, null],
    ["north-jersey-doh-nj90144", 9.2, 25, null],
    ["north-jersey-doh-nj13a012", 9.8, 120, 9.8],
    ["north-jersey-doh-nj60a001", 9.2, 30, 9.2],
    ["cms-315234", 9.6, 375, 9.6],
  ] as const;
  for (const [id, v1, count, v2] of examples) {
    const retained = getLocationResearch(id, today);
    const published = retained.reviewAggregates[0];
    assert.equal(
      Math.round((published.rating! / published.scale!) * 100) / 10,
      v1,
    );
    assert.equal(published.count, count);
    const result = getLocationResearch(id, today).experience;
    assert.equal(result.value, v2, id);
    assert.equal(result.reviewCount, count);
    assert.equal(result.confidence, v2 === null ? "unrated" : "limited");
  }
});

test("recognized platform home, category, brand and search pages cannot attest primary location evidence", () => {
  for (const url of [
    "https://www.aplaceformom.com/",
    "https://www.aplaceformom.com/providers/synthetic-brand-1",
    "https://www.aplaceformom.com/assisted-living/new-jersey",
    "https://www.caring.com/",
    "https://www.caring.com/senior-living/new-jersey",
    "https://www.google.com/search?q=synthetic",
    "https://www.google.com/maps",
    "https://www.google.com/maps/search/synthetic",
  ]) {
    const result = withNarratives([primaryReview({ url })], {
      sources: [source("a"), source("b"), source("primary", { url })],
    });
    assert.equal(result.confidence, "moderate", url);
    assert.equal(result.narrativeDiagnostics?.includedReviews.length, 0, url);
    assert.equal(result.narrativeDiagnostics?.excludedReviews.length, 1, url);
  }
});

test("directly inspected NJ audit probes distinguish published means, mixed accounts and old management context", () => {
  const observations = [
    {
      id: "north-jersey-doh-nj90a001",
      url: "https://www.aplaceformom.com/community/brandywine-summit-by-monarch-75630",
      rating: 3.9,
      count: 28,
      minimum: 7.8,
      maximum: 9.8,
    },
    {
      id: "north-jersey-doh-nj90144",
      url: "https://www.aplaceformom.com/community/sunrise-of-westfield-61361",
      rating: 4.2,
      count: 30,
      minimum: 8.4,
      maximum: 9.2,
    },
  ];
  for (const observation of observations) {
    const retained = getLocationResearch(observation.id, today);
    const input: ExperienceScoreInput = {
      reviewAggregates: [
        ...retained.reviewAggregates,
        aggregate("audit-apfm", {
          platform: "A Place for Mom",
          sourceFamily: "aplaceformom",
          rating: observation.rating,
          count: observation.count,
        }),
      ],
      sources: [
        ...retained.sources,
        source("audit-apfm", { url: observation.url }),
      ],
      asOfDate: today,
    };
    const result = computeExperienceScore(input);
    assert.equal(
      result.value,
      observation.id === "north-jersey-doh-nj90a001" ? null : 8.8,
    );
    assert.ok(
      Math.abs(result.aggregateRange!.minimum - observation.minimum) < 1e-12,
    );
    assert.ok(
      Math.abs(result.aggregateRange!.maximum - observation.maximum) < 1e-12,
    );
    if (observation.id === "north-jersey-doh-nj90a001") {
      assert.equal(result.publicationStatus, "sources-disagree");
      const historical = computeExperienceScore({
        ...input,
        reviews: [
          {
            id: "audit-brandywine-historical",
            sourceId: "audit-apfm",
            url: observation.url,
            date: "2019-07-28",
            relationship: "family",
            excerpt: "the place is a mess",
            aspects: [{ aspect: "management", sentiment: "negative" }],
          },
        ],
      });
      assert.equal(historical.narrativeDiagnostics?.includedReviews.length, 0);
      assert.match(
        historical.narrativeDiagnostics!.excludedReviews[0].reason,
        /730 days/,
      );
    } else {
      assert.equal(result.confidence, "moderate");
      const mixed = {
        id: "audit-sunrise-2026-10-13",
        sourceId: "audit-apfm",
        url: observation.url,
        date: "2026-10-13",
        relationship: "family",
        excerpt:
          "Food was good, very nice rooms. ... they did not have many options",
        aspects: [
          { aspect: "food", sentiment: "positive" },
          { aspect: "activities", sentiment: "negative" },
        ],
      };
      const overlapping = computeExperienceScore({
        ...input,
        reviews: [mixed],
      });
      assert.equal(
        overlapping.narrativeDiagnostics?.includedReviews[0].independent,
        false,
      );
      assert.equal(overlapping.value, 8.8);
      const independent = computeExperienceScore({
        ...input,
        reviewAggregates: retained.reviewAggregates,
        reviews: [mixed],
      });
      assert.equal(
        independent.narrativeDiagnostics?.includedReviews[0].independent,
        true,
      );
      assert.equal(
        independent.narrativeDiagnostics?.includedReviews[0].sentiment,
        "mixed",
      );
      assert.equal(independent.value, null);
      assert.match(independent.reason, /0 positive, 0 negative, 1 mixed/);
    }
  }
});

test("a majority of contrary reviews can withhold a Harbor headline without moving the platform rating", () => {
  for (const [rating, contrary, supportive] of [
    [4.4, "negative", "positive"],
    [1.8, "positive", "negative"],
  ] as const) {
    const item = aggregate("google", { rating, count: 200 });
    const base = {
      sources: [source("google")],
      reviewAggregates: [item],
      asOfDate: today,
    };
    const posts = [contrary, contrary, contrary, supportive, supportive].map(
      (sentiment, index) => ({ id: String(index), date: today, sentiment }),
    );
    const sample = {
      sourceId: "google",
      sourceFamily: "google",
      selection: "all-visible-before-highlighting" as const,
      visibleCount: 5,
      observations: posts,
    };
    const held = computeExperienceScore({ ...base, reviewSamples: [sample] });
    assert.equal(held.publicationStatus, "sources-disagree");
    assert.equal(held.value, null);
    assert.equal(held.reviewCount, 200);
    assert.equal(held.includedSources[0].rating, rating);
    assert.deepEqual(
      held.sampleDiagnostics?.map((s) => [s.eligible, s.positive, s.negative]),
      [[5, rating > 2 ? 2 : 3, rating > 2 ? 3 : 2]],
    );
    for (const alternate of [
      {
        ...sample,
        observations: [posts[0], posts[0], posts[1], posts[3], posts[4]],
      },
      {
        ...sample,
        observations: posts.map((p, i) =>
          i === 2 ? { ...p, date: "2019-10-10" } : p,
        ),
      },
      { ...sample, sourceFamily: "unrelated" },
      { ...sample, visibleCount: 4 },
      {
        ...sample,
        observations: [...posts, { ...posts[0], sentiment: supportive }],
        visibleCount: 6,
      },
    ]) {
      const released = computeExperienceScore({
        ...base,
        reviewSamples: [alternate],
      });
      assert.equal(released.value, rating * 2);
      assert.equal(released.publicationStatus, "single-source-estimate");
    }
  }
});

test("published NJ visible samples qualify the headline without changing underlying Google ratings", () => {
  const expected = [
    ["cms-315178", null, 4.4, 200, 3, 4],
    ["cms-315103", null, 4.1, 158, 3, 5],
    ["cms-315494", 8.2, 4.1, 314, 2, 5],
    ["cms-315307", 9.6, 4.8, 297, 0, 5],
  ] as const;
  for (const [id, value, rating, count, negative, eligible] of expected) {
    const score = getLocationResearch(id, today).experience;
    assert.equal(score.value, value, id);
    assert.equal(
      score.publicationStatus,
      value === null ? "sources-disagree" : "single-source-estimate",
      id,
    );
    assert.equal(score.singleSourceLabel, "Google", id);
    assert.equal(score.includedSources[0].rating, rating, id);
    assert.equal(score.reviewCount, count, id);
    assert.equal(score.sampleDiagnostics?.[0].negative, negative, id);
    assert.equal(score.sampleDiagnostics?.[0].eligible, eligible, id);
    assert.equal(score.sampleDiagnostics?.[0].visible, 5, id);
  }
});
