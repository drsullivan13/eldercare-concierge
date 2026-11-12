import test from "node:test";
import assert from "node:assert/strict";
import { getDailyLifeResearch } from "../src/lib/daily-life";
import { dailyLife } from "../src/lib/daily-life-display";
import { getNursingStaffingResearch } from "../src/lib/nursing-staffing";
import { getReviewCatalog } from "../src/lib/review-catalog";
import {
  individualReviews,
  reviewAccountCounts,
} from "../src/lib/individual-reviews";
import {
  getLocationResearch,
  getResearchSummary,
} from "../src/lib/location-research";
import { markets } from "../src/lib/markets";
import { searchProviders } from "../src/lib/search";
import { GET as researchGET } from "../src/app/api/research/route";
import { GET as reviewsGET } from "../src/app/api/reviews/route";
import type { DailyLifeResearch } from "../src/lib/daily-life-types";
import maMergeExamples from "../research/massachusetts/review-catalog/merge-examples.json";

const asOf = "2026-11-12";
const providers = markets.flatMap((market) => market.providers);

test("actual Massachusetts retained-source and acquired accounts match the independently reviewed merge examples", async () => {
  for (const example of maMergeExamples) {
    const response = reviewsGET(
      new Request(`http://localhost/api/reviews?id=${example.providerId}`),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(
      body.accounts.length,
      example.distinctMergedAccounts,
      example.providerId,
    );
    assert.equal(
      getResearchSummary(example.providerId)?.individualReviews?.total,
      example.distinctMergedAccounts,
    );
    const originals = body.accounts.filter((account: { url: string }) =>
      account.url.includes("www.google.com/maps/reviews/"),
    );
    const keys = originals.map(
      (account: { url: string }) =>
        decodeURIComponent(account.url).match(/!1s((?:Ci|Ch)[^!?#]+)/)?.[1],
    );
    assert.equal(
      keys.length,
      new Set(keys).size,
      `${example.providerId} original receipts deduplicate`,
    );
  }
});

test("the actual 38-rating mixed-campus source publishes only four explicit nursing accounts and no new scored aggregate", () => {
  const providerId = "cms-225281";
  const catalog = getReviewCatalog(providerId)!;
  const source = catalog.sources.find((source) =>
    source.url.endsWith("/skilled-nursing-facility-at-north-hill-the"),
  )!;
  assert.equal(source.reportedCount, 38);
  assert.equal(source.retainedCount, 4);
  assert.match(source.scopeNote ?? "", /campus|mixed.scope|Pines Edge/i);
  assert.equal(
    catalog.accounts.filter((account) => account.sourceId === source.id).length,
    4,
  );
  assert.ok(catalog.notes.some((note) => /campus|Pines Edge/i.test(note)));
  const detail = getLocationResearch(providerId, asOf);
  const originalIds = detail.sources
    .filter((original) => original.url === source.url)
    .map((original) => original.id);
  assert.ok(
    detail.reviewAggregates.every(
      (aggregate) => !originalIds.includes(aggregate.sourceId),
    ),
  );
  assert.ok(
    detail.experience.includedSources.every(
      (included) => !originalIds.includes(included.sourceId),
    ),
  );
});

test("published evidence attaches to its exact provider across both markets without modifying retained research", () => {
  let acquired = 0;
  let staffing = 0;
  for (const market of markets) {
    for (const provider of market.providers) {
      const detail = getLocationResearch(provider.id, asOf);
      assert.deepEqual(
        detail.dailyLife ?? null,
        getDailyLifeResearch(provider.id),
      );
      assert.deepEqual(
        detail.nursingStaffing ?? null,
        getNursingStaffingResearch(provider.id),
      );
      if (detail.dailyLife) {
        acquired++;
        assert.equal(detail.dailyLife.providerId, provider.id);
        const display = dailyLife(detail, provider);
        for (const fact of detail.dailyLife.facts) {
          const source = detail.dailyLife.sources.find(
            (source) => source.id === fact.sourceId,
          )!;
          assert.ok(
            display.groups
              .flatMap((group) => group.facts)
              .some(
                (entry) =>
                  entry.fact.text === fact.text &&
                  entry.source.url === source.url,
              ),
            `${provider.id}: ${fact.id} reaches the UI helper`,
          );
        }
      }
      if (detail.nursingStaffing) {
        staffing++;
        assert.equal(provider.id, `cms-${detail.nursingStaffing.ccn}`);
        assert.equal(provider.category, "nursing-home");
      }
      const original = market.locationResearch?.[provider.id];
      if (original) {
        assert.deepEqual(detail.facts, original.facts);
        assert.deepEqual(detail.sources, original.sources);
        assert.deepEqual(detail.reviews, original.reviews);
      }
    }
  }
  assert.ok(acquired > 0, "Released daily-life evidence is exercised");
  assert.ok(staffing > 0, "Released staffing evidence is exercised");
});

test("custom registry copies cannot inherit global daily-life, staffing or review accounts", () => {
  for (const market of markets) {
    const registry = [{ ...market }];
    for (const provider of market.providers) {
      const detail = getLocationResearch(provider.id, asOf, registry);
      assert.equal(detail.dailyLife, undefined);
      assert.equal(detail.nursingStaffing, undefined);
      const counts = reviewAccountCounts(
        individualReviews(detail, null).accounts,
      );
      const summary = getResearchSummary(provider.id, registry);
      assert.deepEqual(
        summary?.individualReviews ?? { total: 0, withText: 0 },
        counts,
      );
    }
  }
});

test("compact review counts equal the lazy response, including providers without legacy research", async () => {
  let catalogs = 0;
  let readable = 0;
  let linkOnly = 0;
  for (const provider of providers) {
    const catalog = getReviewCatalog(provider.id);
    if (!catalog) continue;
    catalogs++;
    const response = reviewsGET(
      new Request(`http://localhost/api/reviews?id=${provider.id}`),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providerId, provider.id);
    const actual = {
      total: body.accounts.length,
      withText: body.accounts.filter(
        (account: { excerpt: string; summary: string }) =>
          account.excerpt.trim() || account.summary.trim(),
      ).length,
    };
    readable += actual.withText;
    linkOnly += actual.total - actual.withText;
    assert.deepEqual(
      getResearchSummary(provider.id)?.individualReviews,
      actual,
      provider.id,
    );
    assert.equal(
      new Set(body.accounts.map((account: { id: string }) => account.id)).size,
      actual.total,
    );
  }
  assert.ok(catalogs > 0);
  assert.ok(readable > 0);
  assert.ok(linkOnly > 0);

  const counted = providers.find(
    (provider) => getResearchSummary(provider.id)?.individualReviews?.total,
  )!;
  const summary = getResearchSummary(counted.id)!;
  const originalCounts = { ...summary.individualReviews! };
  summary.individualReviews!.total++;
  assert.deepEqual(
    getResearchSummary(counted.id)?.individualReviews,
    originalCounts,
  );

  const market = markets.find((market) =>
    market.providers.some((provider) => getReviewCatalog(provider.id)),
  )!;
  const provider = market.providers.find((provider) =>
    getReviewCatalog(provider.id),
  )!;
  const original = market.locationResearch;
  market.locationResearch = { ...original };
  delete market.locationResearch[provider.id];
  try {
    const expected = individualReviews(
      getLocationResearch(provider.id),
      getReviewCatalog(provider.id),
    );
    assert.deepEqual(
      getResearchSummary(provider.id)?.individualReviews,
      reviewAccountCounts(expected.accounts),
    );
    assert.equal(getResearchSummary(provider.id)?.experience.value, null);
  } finally {
    market.locationResearch = original;
  }
});

test("catalog payloads stay out of research detail and search lists in every region", async () => {
  for (const market of markets) {
    const result = searchProviders({ zip: market.defaultZip, radius: 50 });
    assert.ok(result.providers.length);
    for (const provider of result.providers) {
      const summary = provider.research;
      if (!summary) continue;
      for (const key of [
        "reviewCatalog",
        "accounts",
        "sources",
        "reviews",
        "dailyLife",
        "nursingStaffing",
      ]) {
        assert.equal(
          Object.hasOwn(summary, key),
          false,
          `${provider.id}: ${key}`,
        );
      }
      if (summary.individualReviews) {
        assert.deepEqual(Object.keys(summary.individualReviews).sort(), [
          "total",
          "withText",
        ]);
      }
    }
    const provider = market.providers.find((provider) =>
      getReviewCatalog(provider.id),
    )!;
    assert.ok(provider, `${market.id} has retained review catalog coverage`);
    const response = researchGET(
      new Request(`http://localhost/api/research?id=${provider.id}`),
    );
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(Object.hasOwn(detail, "reviewCatalog"), false);
    assert.equal(Object.hasOwn(detail, "accounts"), false);
  }
});

test("unseen valid provider IDs stay unknown and cannot receive another provider's catalog", () => {
  const id = "north-jersey-unseen-integration-provider";
  assert.equal(getReviewCatalog(id), null);
  assert.equal(getDailyLifeResearch(id), null);
  assert.equal(getNursingStaffingResearch(id), null);
  assert.throws(() => getLocationResearch(id), /No catalog provider matches/);
  assert.equal(getResearchSummary(id), undefined);
});

test("daily-life display keeps transport, numeric staffing meaning and exact provider ownership", () => {
  const provider = providers.find(
    (provider) => provider.locationKind === "facility",
  )!;
  const source: DailyLifeResearch["sources"][number] = {
    id: "official",
    url: "https://example.org/exact-location",
    title: "Exact location",
    publisher: "Provider",
    checkedAt: asOf,
    publishedAt: "2026-10-01",
    access: "full-page",
    excerpt: "Retained offering statements",
    locationEvidence: "Exact location address",
  };
  const acquired: DailyLifeResearch = {
    providerId: provider.id,
    checkedAt: asOf,
    sources: [source],
    notes: [],
    facts: [
      {
        id: "transport",
        kind: "transport",
        text: "Scheduled shuttle transportation.",
        quote: "Scheduled shuttle transportation.",
        sourceId: source.id,
        evidence: "provider-reported",
      },
      {
        id: "staffing",
        kind: "staffing",
        text: "Licensed nurse coverage of 12 hours per day for assisted living.",
        quote:
          "Licensed nurse coverage of 12 hours per day for assisted living.",
        sourceId: source.id,
        evidence: "provider-reported",
        numeric: {
          value: 12,
          unit: "hours-per-day",
          population: "Assisted living licensed nurses",
          period: "Daytime",
        },
      },
    ],
  };
  const data = { facts: [], sources: [], dailyLife: acquired };
  const display = dailyLife(data, provider);
  assert.equal(
    display.groups.some((group) => group.id === "activity"),
    false,
  );
  assert.ok(display.gaps.includes("activities & outings"));
  assert.ok(!display.gaps.includes("transport arrangements"));
  const staff = display.groups.find((group) => group.id === "staffing")!
    .facts[0];
  assert.deepEqual(staff.fact.numeric, acquired.facts[1].numeric);
  assert.equal(staff.fact.evidence, "provider-reported");
  assert.equal(staff.source.url, source.url);
  assert.equal(staff.fact.asOf, source.publishedAt);
  assert.deepEqual(
    dailyLife(
      { ...data, dailyLife: { ...acquired, providerId: "other-location" } },
      provider,
    ).groups,
    [],
  );
});
