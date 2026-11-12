import test from "node:test";
import assert from "node:assert/strict";
import {
  individualReviews,
  reviewAccountCounts,
} from "../src/lib/individual-reviews";
import type { LocationResearch } from "../src/lib/location-research-types";
import type { ReviewCatalog } from "../src/lib/review-catalog-types";

const research: LocationResearch = {
  providerId: "exact-provider",
  checkedAt: "2026-11-12",
  providerDetailsReviewed: true,
  sources: [
    {
      id: "review-source",
      url: "https://example.org/reviews",
      title: "Reviews",
      publisher: "Reviews",
      kind: "review-platform",
      checkedAt: "2026-11-12",
      publishedAt: null,
      access: "full-page",
    },
  ],
  facts: [],
  reviewAggregates: [],
  availability: {
    status: "not-published",
    text: "Unknown",
    sourceId: null,
    asOf: null,
  },
  notes: [],
  reviews: [
    {
      id: "stable-review",
      sourceId: "review-source",
      url: "https://example.org/reviews#original-1",
      date: null,
      rating: null,
      scale: null,
      relationship: "unknown",
      excerpt: "",
      summary: "",
      aspects: [],
      notes: [],
    },
  ],
};
const catalog: ReviewCatalog = {
  providerId: research.providerId,
  checkedAt: "2026-11-12",
  sources: [],
  notes: [],
  accounts: [
    {
      id: "stable-review",
      sourceId: "review-source",
      sourceFamily: "example",
      url: research.reviews[0].url,
      date: null,
      datePrecision: "unknown",
      relationship: "family",
      excerpt: null,
      summary: "The family described responsive staff.",
      representation: "reviewed-excerpt",
      provenance: "new-public-page",
    },
  ],
};

test("newly approved text upgrades a retained link-only account without changing its original ID or receipt", () => {
  const result = individualReviews(research, catalog);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].id, "stable-review");
  assert.equal(result.accounts[0].url, research.reviews[0].url);
  assert.equal(result.accounts[0].summary, catalog.accounts[0].summary);
  assert.deepEqual(reviewAccountCounts(result.accounts), {
    total: 1,
    withText: 1,
  });
  assert.equal(research.reviews[0].summary, "");
});

test("another provider's text cannot upgrade a matching review ID and receipt", () => {
  assert.throws(
    () =>
      individualReviews(research, {
        ...catalog,
        providerId: "other-provider",
        accounts: [
          ...catalog.accounts,
          {
            ...catalog.accounts[0],
            id: "other-review",
            url: "https://example.org/reviews#another-provider",
          },
        ],
      }),
    /does not match this provider/,
  );
});

test("the same review ID on another original receipt cannot replace retained text", () => {
  const result = individualReviews(research, {
    ...catalog,
    accounts: [
      { ...catalog.accounts[0], url: "https://example.org/reviews#original-2" },
    ],
  });
  assert.equal(
    result.accounts.find((account) => account.url === research.reviews[0].url)
      ?.summary,
    "",
  );
});

test("blank strings do not count as available review text", () => {
  const account = individualReviews(research, null).accounts[0];
  assert.deepEqual(
    reviewAccountCounts([{ ...account, excerpt: "  ", summary: "\n" }]),
    { total: 1, withText: 0 },
  );
});

test("an explicitly reviewed provisional-link alias resolves the original receipt without changing the stable ID", () => {
  const resolved = {
    ...catalog.accounts[0],
    url: "https://example.org/resolved-original",
    retainedReview: {
      id: research.reviews[0].id,
      url: research.reviews[0].url,
    },
  };
  const result = individualReviews(research, {
    ...catalog,
    accounts: [resolved],
  });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].id, research.reviews[0].id);
  assert.equal(result.accounts[0].url, resolved.url);
  assert.equal(result.accounts[0].summary, resolved.summary);
  assert.equal(
    research.reviews[0].url,
    "https://example.org/reviews#original-1",
  );
});

test("an alias for a different provisional receipt cannot bypass original-link matching", () => {
  const resolved = {
    ...catalog.accounts[0],
    url: "https://example.org/resolved-original",
    retainedReview: {
      id: research.reviews[0].id,
      url: "https://example.org/other-provisional",
    },
  };
  const result = individualReviews(research, {
    ...catalog,
    accounts: [resolved],
  });
  assert.equal(result.accounts[0].url, research.reviews[0].url);
  assert.equal(result.accounts[0].summary, "");
});
