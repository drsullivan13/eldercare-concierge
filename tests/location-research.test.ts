import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import catalogue from "../src/data/providers.json";
import merged from "../src/data/location-research.json";
import {
  getLocationResearch,
  getResearchSummary,
} from "../src/lib/location-research";
import { getMarket } from "../src/lib/markets";
import { getFacebookResearch } from "../src/lib/facebook-research";
import { searchProviders, getProvidersByIds } from "../src/lib/search";
import { GET } from "../src/app/api/research/route";
import type { LocationResearch } from "../src/lib/location-research-types";

const snapshot = merged as Record<string, LocationResearch>;
const inputs = join(process.cwd(), "src/data/inputs/location-research");
const raw = readdirSync(inputs)
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) =>
    (
      JSON.parse(
        readFileSync(join(inputs, name), "utf8"),
      ) as Partial<LocationResearch>[]
    ).map((row) => ({ row, prefix: `${basename(name, ".json")}-` })),
  );
const asOf = "2026-11-12";

test("retained Massachusetts location records are returned unchanged alongside computed evidence", () => {
  for (const [id, record] of Object.entries(snapshot)) {
    const { experience, facebookResearch, familyExperience, ...detail } =
      getLocationResearch(id, asOf);
    assert.deepEqual(detail, record, id);
    assert.ok(experience);
    assert.deepEqual(
      familyExperience,
      getResearchSummary(id)?.familyExperience,
    );
    assert.deepEqual(facebookResearch, getFacebookResearch(id), id);
  }
});

test("Facebook-only catalog records remain accessible through the getter and research API without contributing scores", async () => {
  const market = getMarket()!;
  const id = Object.keys(market.facebookResearch!.locations).find(
    (id) =>
      market.providers.some((provider) => provider.id === id) &&
      market.facebookResearch!.locations[id].findings.length > 0,
  )!;
  assert.ok(id, "Retained Facebook findings supply the regression fixture");
  const original = market.locationResearch!;
  const withoutLocation = { ...original };
  delete withoutLocation[id];
  market.locationResearch = withoutLocation;
  try {
    const facebook = getFacebookResearch(id);
    assert.ok(facebook?.findings.length);
    const detail = getLocationResearch(id, asOf);
    assert.deepEqual(detail.facebookResearch, facebook);
    assert.equal(detail.checkedAt, null);
    assert.equal(detail.providerDetailsReviewed, false);
    assert.deepEqual(detail.sources, []);
    assert.deepEqual(detail.facts, []);
    assert.deepEqual(detail.reviews, []);
    assert.deepEqual(detail.reviewAggregates, []);
    assert.equal(detail.experience.value, null);
    assert.equal(detail.experience.reviewCount, 0);
    assert.equal(detail.experience.independentSourceCount, 0);
    assert.deepEqual(detail.experience.includedSources, []);
    assert.equal(detail.experience.confidence, "unrated");
    assert.equal(detail.availability.sourceId, null);
    assert.equal(detail.availability.asOf, null);
    assert.equal(detail.availability.status, "not-published");
    const summary = getResearchSummary(id)!;
    assert.deepEqual(summary.familyExperience, detail.familyExperience);
    assert.ok(detail.familyExperience);
    assert.equal(
      summary.facebookResearch?.findingCount,
      facebook.findings.length,
    );
    assert.equal(summary.detailsAvailable, false);
    assert.equal(summary.experience.value, null);
    const response = GET(new Request(`http://localhost/api/research?id=${id}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.facebookResearch, facebook);
    assert.equal(body.providerId, id);
    assert.equal(body.experience.value, null);
    assert.deepEqual(body.experience.includedSources, []);
  } finally {
    market.locationResearch = original;
  }
});

test("actual NJ catalog gaps return unknown research rather than a missing-provider error", async () => {
  const market = getMarket("north-jersey")!;
  assert.ok(market, "The published NJ catalog must be available");
  const gaps = market.providers.filter(
    (provider) => !Object.hasOwn(market.locationResearch ?? {}, provider.id),
  );
  assert.ok(gaps.length > 0);
  for (const provider of gaps) {
    const detail = getLocationResearch(provider.id, asOf);
    assert.equal(detail.providerId, provider.id);
    assert.equal(detail.checkedAt, null);
    assert.equal(detail.providerDetailsReviewed, false);
    assert.deepEqual(detail.sources, []);
    assert.deepEqual(detail.facts, []);
    assert.deepEqual(detail.reviews, []);
    assert.deepEqual(detail.reviewAggregates, []);
    assert.equal(detail.availability.status, "not-published");
    assert.equal(detail.availability.sourceId, null);
    assert.equal(detail.availability.asOf, null);
    assert.match(detail.availability.text, /not been researched/i);
    assert.equal(detail.experience.value, null);
    assert.equal(detail.experience.reviewCount, 0);
    assert.deepEqual(detail.experience.includedSources, []);
    assert.deepEqual(detail.facebookResearch, getFacebookResearch(provider.id));
  }
  const response = GET(
    new Request(`http://localhost/api/research?id=${gaps[0].id}`),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).checkedAt, null);
});

test("every catalog location has research state and every imported claim retains exact source provenance", () => {
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    catalogue.map((p) => p.id).sort(),
  );
  for (const { row, prefix } of raw) {
    const record = snapshot[row.providerId!];
    for (const source of row.sources ?? []) {
      assert.deepEqual(
        record.sources.find((s) => s.id === prefix + source.id),
        {
          ...source,
          id: prefix + source.id,
          publishedAt: source.publishedAt ?? null,
        },
      );
    }
    for (const fact of row.facts ?? []) {
      assert.deepEqual(
        record.facts.find((f) => f.id === prefix + fact.id),
        { ...fact, id: prefix + fact.id, sourceId: prefix + fact.sourceId },
      );
    }
    for (const review of row.reviews ?? []) {
      assert.deepEqual(
        record.reviews.find((r) => r.id === prefix + review.id),
        {
          ...review,
          id: prefix + review.id,
          sourceId: prefix + review.sourceId,
        },
      );
    }
    for (const aggregate of row.reviewAggregates ?? []) {
      assert.ok(
        record.reviewAggregates.some(
          (a) =>
            JSON.stringify(a) ===
            JSON.stringify({
              ...aggregate,
              sourceId: prefix + aggregate.sourceId,
            }),
        ),
        `${row.providerId}: exact original aggregate retained`,
      );
    }
  }
});

test("all linked evidence has unique IDs, real calendar check dates and no orphaned or invented claims", () => {
  for (const record of Object.values(snapshot)) {
    const sources = new Map(record.sources.map((s) => [s.id, s]));
    assert.equal(sources.size, record.sources.length, record.providerId);
    assert.equal(
      new Set(record.facts.map((f) => f.id)).size,
      record.facts.length,
    );
    assert.equal(
      new Set(record.reviews.map((r) => r.id)).size,
      record.reviews.length,
    );
    for (const source of record.sources) {
      assert.match(source.url, /^https?:\/\//);
      assert.equal(
        new Date(`${source.checkedAt}T00:00:00Z`).toISOString().slice(0, 10),
        source.checkedAt,
      );
      assert.ok(
        source.checkedAt <= asOf,
        `${record.providerId}: source check cannot come from the future`,
      );
    }
    for (const claim of [
      ...record.facts,
      ...record.reviews,
      ...record.reviewAggregates,
    ])
      assert.ok(
        sources.has(claim.sourceId),
        `${record.providerId}: ${claim.sourceId}`,
      );
    if (record.availability.sourceId)
      assert.ok(sources.has(record.availability.sourceId));
    if (record.providerDetailsReviewed)
      assert.ok(
        record.facts.some((f) => {
          const s = sources.get(f.sourceId)!;
          return (
            s.kind === "provider" &&
            ["full-page", "pdf"].includes(s.access) &&
            ["care", "amenity", "activity", "dining", "room", "cost"].includes(
              f.kind,
            )
          );
        }),
        `${record.providerId}: regulator capacity alone is not researched provider offerings`,
      );
  }
});

test("opening and waitlist states retain an actual published observation, never inferred vacancies from capacity", () => {
  for (const record of Object.values(snapshot)) {
    if (
      !["opening-published", "waitlist-published"].includes(
        record.availability.status,
      )
    )
      continue;
    assert.ok(record.availability.sourceId);
    assert.ok(
      raw.some(
        ({ row, prefix }) =>
          row.providerId === record.providerId &&
          row.availability &&
          JSON.stringify({
            ...row.availability,
            sourceId: row.availability.sourceId
              ? prefix + row.availability.sourceId
              : null,
          }) === JSON.stringify(record.availability),
      ),
    );
    const source = record.sources.find(
      (s) => s.id === record.availability.sourceId,
    )!;
    assert.equal(source.kind, "provider");
  }
  const compass = snapshot["ma-alr-compass-on-the-bay"];
  assert.equal(compass.availability.status, "opening-published");
  assert.equal(compass.availability.asOf, null);
  assert.match(compass.availability.text, /undated/i);
  assert.equal(
    snapshot["lifeplan-brooksby-village"].availability.status,
    "waitlist-published",
  );
  assert.equal(
    snapshot["lifeplan-fox-hill-village"].availability.status,
    "inquiry-only",
  );
  const nursing = catalogue.find((p) => p.category === "nursing-home")!;
  assert.equal(snapshot[nursing.id].availability.status, "not-published");
});

test("entrance fees, recurring fees, free assessments and future-effective prices remain different evidence", () => {
  for (const record of Object.values(snapshot))
    for (const fact of record.facts) {
      const amount = fact.amount;
      if (!amount) continue;
      assert.equal(fact.kind, "cost");
      assert.equal(amount.currency, "USD");
      assert.ok(Number.isFinite(amount.min) && amount.min >= 0);
      assert.ok(
        amount.max === null ||
          (Number.isFinite(amount.max) && amount.max >= amount.min),
      );
      if (amount.type === "entrance-fee")
        assert.equal(amount.period, "one-time");
    }
  const brooksby = snapshot["lifeplan-brooksby-village"].facts;
  assert.ok(
    brooksby.some(
      (f) =>
        f.amount?.type === "entrance-fee" &&
        f.amount.min === 113000 &&
        f.amount.period === "one-time",
    ),
  );
  assert.ok(
    brooksby.some((f) => f.amount?.min === 2523 && f.amount.period === "month"),
  );
  const future = snapshot["ma-alr-allerton-house-at-harbor-park"].facts.filter(
    (f) => f.amount?.asOf === "2026-12-01",
  );
  assert.ok(future.length >= 5);
  assert.ok(future.every((f) => /future/i.test(f.text)));
  const freeAssessment = snapshot["all-care"].facts.find(
    (f) => f.amount?.min === 0,
  )!;
  assert.equal(freeAssessment.amount!.period, "one-time");
  assert.match(freeAssessment.text, /assessment/i);
  assert.ok(!/free (?:home )?care/i.test(freeAssessment.text));
});

test("actual consumer scores preserve source scope, no-review missingness and source-family counts", () => {
  const brooksby = getLocationResearch("lifeplan-brooksby-village", asOf);
  const caring = brooksby.reviewAggregates.find(
    (a) => a.platform === "Caring.com",
  )!;
  assert.equal(
    brooksby.experience.value,
    (caring.rating! / caring.scale!) * 10,
  );
  assert.equal(brooksby.experience.reviewCount, caring.count);
  assert.equal(brooksby.experience.confidence, "limited");
  for (const id of [
    "lifeplan-carleton-willard-village",
    "ma-alr-maplewood-at-weston",
    "ma-alr-waterstone-at-wellesley",
  ]) {
    assert.equal(getLocationResearch(id, asOf).experience.value, null, id);
  }
  const foxHill = getLocationResearch("lifeplan-fox-hill-village", asOf);
  assert.equal(foxHill.experience.value, 8.8);
  assert.equal(foxHill.experience.reviewCount, 12);
  assert.ok(
    foxHill.experience.excludedSources.some((source) =>
      /positive whole-number review count/.test(source.reason),
    ),
  );
  for (const record of Object.values(snapshot)) {
    const result = getLocationResearch(record.providerId, asOf).experience;
    assert.equal(
      new Set(result.includedSources.map((s) => s.sourceFamily)).size,
      result.includedSources.length,
    );
    assert.equal(
      result.reviewCount,
      result.includedSources.reduce((n, s) => n + s.count, 0),
    );
    assert.ok(
      result.includedSources.every(
        (s) =>
          record.reviewAggregates.find((a) => a.sourceId === s.sourceId)
            ?.scope === "consumer",
      ),
    );
  }
});

test("research filters preserve distance and category while distinguishing scored evidence from selected reviews", () => {
  for (const evidence of ["details", "pricing", "openings", "reviews"]) {
    const result = searchProviders({
      zip: "02459",
      radius: 50,
      category: "all",
      evidence,
    });
    assert.ok(result.providers.length > 0, evidence);
    for (const provider of result.providers) {
      assert.ok(provider.distanceMiles! <= 50);
      if (evidence === "details")
        assert.equal(provider.research?.detailsAvailable, true);
      if (evidence === "pricing")
        assert.ok(provider.research!.publishedCosts > 0);
      if (evidence === "openings")
        assert.equal(
          provider.research?.availabilityStatus,
          "opening-published",
        );
      if (evidence === "reviews")
        assert.notEqual(provider.research?.experience.value, null);
    }
  }
  assert.throws(
    () => searchProviders({ sort: "experience", category: "all" }),
    /category/,
  );
  const ranked = searchProviders({
    zip: "02459",
    radius: 50,
    category: "life-plan",
    sort: "experience",
  }).providers;
  assert.ok(ranked.every((p) => p.category === "life-plan"));
  for (let i = 1; i < ranked.length; i++)
    assert.ok(
      (ranked[i - 1].research!.experience.value ?? -1) >=
        (ranked[i].research!.experience.value ?? -1),
    );
});

test("a warm process expires card, filter and saved-record scores on the same date as location detail", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2027-05-12T12:00:00Z"),
  });
  const id = "lifeplan-brooksby-village";
  assert.equal(getLocationResearch(id).experience.value, null);
  assert.equal(
    searchProviders({
      zip: "02459",
      radius: 50,
      category: "life-plan",
    }).providers.find((p) => p.id === id)?.research?.experience.value,
    null,
  );
  assert.equal(getProvidersByIds([id])[0].research?.experience.value, null);
  assert.equal(
    searchProviders({ zip: "02459", radius: 50, evidence: "reviews" }).providers
      .length,
    0,
  );
});

test("research API returns the exact requested location and rejects missing, duplicate or foreign selectors", async () => {
  const good = await GET(
    new Request("http://localhost/api/research?id=lifeplan-brooksby-village"),
  );
  assert.equal(good.status, 200);
  assert.equal((await good.json()).providerId, "lifeplan-brooksby-village");
  for (const [query, status] of [
    ["", 400],
    ["?id=", 400],
    ["?id=unknown-location", 404],
    ["?id=INVALID-id", 400],
    ["?id=invalid%2Fid", 400],
    [`?id=${"a".repeat(151)}`, 400],
    ["?id=lifeplan-brooksby-village&id=lifeplan-linden-ponds", 400],
    ["?id=lifeplan-brooksby-village&ccn=225001", 400],
  ]) {
    const response = await GET(
      new Request(`http://localhost/api/research${query}`),
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).providerId, undefined);
  }
});
