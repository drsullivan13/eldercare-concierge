import { test } from "node:test";
import assert from "node:assert/strict";
import {
  individualReviews,
  reviewAccountCounts,
} from "../src/lib/individual-reviews";
import type { LocationResearch } from "../src/lib/location-research-types";
import type { ReviewCatalog } from "../src/lib/review-catalog-types";

const research: LocationResearch = {
  providerId: "test-location",
  checkedAt: "2026-11-12",
  providerDetailsReviewed: true,
  sources: [
    {
      id: "original",
      url: "https://example.com/location",
      title: "Original location page",
      publisher: "Review platform",
      kind: "review-platform",
      checkedAt: "2026-11-12",
      publishedAt: null,
      access: "full-page",
    },
  ],
  facts: [],
  availability: {
    status: "not-published",
    text: "Unknown",
    sourceId: null,
    asOf: null,
  },
  reviewAggregates: [
    {
      sourceId: "original",
      platform: "Review platform",
      sourceFamily: "original",
      rating: 4,
      scale: 5,
      count: 38,
      asOf: "2026-11-12",
      scope: "consumer",
      notes: [],
    },
  ],
  reviews: [
    {
      id: "retained-account",
      sourceId: "original",
      url: "https://example.com/location",
      date: "2026-10",
      rating: 2,
      scale: 5,
      relationship: "family",
      excerpt: "The account raises a concern.",
      summary: "A selected concern.",
      aspects: [{ aspect: "communication", sentiment: "negative" }],
      notes: ["Relationship is not independently verified."],
    },
  ],
  notes: [],
};

function catalog(): ReviewCatalog {
  return {
    providerId: research.providerId,
    checkedAt: "2026-11-12",
    sources: [
      {
        id: "original",
        publisher: "Review platform",
        sourceFamily: "original",
        url: "https://example.com/location",
        reportedCount: 38,
        retainedCount: 3,
        previouslyUnseenCount: 2,
        pagesChecked: 1,
        coverage: "partial",
        stopReason: "Only the visible page was inspected.",
      },
    ],
    accounts: [
      {
        id: "retained-account",
        sourceId: "original",
        sourceFamily: "original",
        url: "https://example.com/location",
        date: "2026-10",
        datePrecision: "month",
        relationship: "family",
        excerpt: null,
        summary: null,
        representation: "link-only",
        provenance: "retained-reviewed",
      },
      {
        id: "new-link",
        sourceId: "original",
        sourceFamily: "original",
        url: "https://example.com/location#review-new",
        date: "2026",
        datePrecision: "year",
        relationship: "unknown",
        excerpt: null,
        summary: null,
        representation: "link-only",
        provenance: "new-public-page",
      },
      {
        id: "second-link",
        sourceId: "original",
        sourceFamily: "original",
        url: "https://example.com/location#review-second",
        date: null,
        datePrecision: "unknown",
        relationship: "unknown",
        excerpt: null,
        summary: null,
        representation: "link-only",
        provenance: "new-public-page",
      },
    ],
    notes: ["Source rating total is not an acquired-account count."],
  };
}

test("retained account IDs, source links, concern flags and ratings survive catalog merging", () => {
  const merged = individualReviews(research, catalog());
  assert.equal(merged.accounts.length, 3);
  const retained = merged.accounts.find(
    (account) => account.id === "retained-account",
  )!;
  for (const key of [
    "id",
    "url",
    "rating",
    "scale",
    "date",
    "aspects",
    "notes",
  ] as const)
    assert.deepEqual(retained[key], research.reviews[0][key]);
  assert.equal(retained.publisher, "Review platform");
  assert.equal(merged.accounts[1].date, "2026");
  assert.equal(merged.accounts[2].date, null);
  assert.equal(merged.accounts[1].rating, null);
  assert.equal(merged.accounts[1].summary, "");
  assert.equal(Object.hasOwn(merged.accounts[1], "author"), false);
});

test("38 source ratings remain separate from three records and one retained text", () => {
  const merged = individualReviews(research, catalog());
  assert.deepEqual(reviewAccountCounts(merged.accounts), {
    total: 3,
    withText: 1,
  });
  assert.equal(research.reviewAggregates[0].count, 38);
  assert.equal(merged.sources[0].reportedCount, 38);
  assert.equal(merged.notes[0], catalog().notes[0]);
});

test("missing catalogs preserve original accounts without guessing additional records", () => {
  const merged = individualReviews(research, null);
  assert.deepEqual(reviewAccountCounts(merged.accounts), {
    total: 1,
    withText: 1,
  });
  assert.deepEqual(merged.sources, []);
});

test("an identical retained excerpt is not duplicated under a new catalog ID", () => {
  const input = catalog();
  input.accounts = [
    {
      ...input.accounts[0],
      id: "alternate-id",
      excerpt: research.reviews[0].excerpt,
    },
  ];
  assert.equal(individualReviews(research, input).accounts.length, 1);
});

test("foreign-provider catalogs cannot be combined with this location", () => {
  assert.throws(
    () =>
      individualReviews(research, {
        ...catalog(),
        providerId: "another-location",
      }),
    /does not match/,
  );
});

test("newly reviewed text fills a retained link-only account without losing its ID or flags", () => {
  const input = catalog();
  input.accounts[0].excerpt = "Newly reviewed source text.";
  input.accounts[0].representation = "reviewed-excerpt";
  const original = {
    ...research,
    reviews: [{ ...research.reviews[0], excerpt: "", summary: "  " }],
  };
  const merged = individualReviews(original, input);
  assert.equal(merged.accounts[0].excerpt, "Newly reviewed source text.");
  assert.equal(merged.accounts[0].id, research.reviews[0].id);
  assert.deepEqual(merged.accounts[0].aspects, research.reviews[0].aspects);
  assert.deepEqual(reviewAccountCounts(merged.accounts), {
    total: 3,
    withText: 1,
  });
});

test("a proven retained alias resolves the original URL without losing reviewed context", () => {
  const input = catalog();
  input.accounts = [
    {
      ...input.accounts[0],
      url: "https://example.com/review/resolved-original",
      date: "2026-10-12",
      retainedReview: {
        id: research.reviews[0].id,
        url: research.reviews[0].url,
      },
    },
  ];
  const merged = individualReviews(research, input);
  assert.equal(merged.accounts.length, 1);
  assert.equal(merged.accounts[0].id, research.reviews[0].id);
  assert.equal(merged.accounts[0].url, input.accounts[0].url);
  assert.equal(merged.accounts[0].date, "2026-10-12");
  assert.equal(merged.accounts[0].excerpt, research.reviews[0].excerpt);
  assert.deepEqual(merged.accounts[0].aspects, research.reviews[0].aspects);
  assert.deepEqual(merged.accounts[0].notes, research.reviews[0].notes);
  assert.equal(research.reviews[0].url, "https://example.com/location");
});

test("an alias with the wrong prior URL cannot replace a retained account", () => {
  const input = catalog();
  input.accounts = [
    {
      ...input.accounts[0],
      url: "https://example.com/review/resolved-original",
      retainedReview: {
        id: research.reviews[0].id,
        url: "https://example.com/wrong-prior",
      },
    },
  ];
  const merged = individualReviews(research, input);
  assert.equal(merged.accounts.length, 1);
  assert.equal(merged.accounts[0].url, research.reviews[0].url);
});
