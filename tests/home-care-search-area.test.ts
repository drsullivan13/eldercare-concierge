import test from "node:test";
import assert from "node:assert/strict";
import { getMarket, type MarketSnapshot } from "../src/lib/markets";
import type { CareCategory, Provider } from "../src/lib/providers";
import type { LocationResearch } from "../src/lib/location-research-types";
import { searchProviders, type SearchOptions } from "../src/lib/search";
import { searchSuggestions } from "../src/lib/search-suggestions";

const published = getMarket()!;
const zip = "02459";
const point = published.zips[zip];
function office(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `Agency ${id}`,
    category: "home-care",
    address: "Synthetic office",
    city: "Synthetic town",
    state: "MA",
    zip: "02116",
    lat: point.lat + 1,
    lng: point.lng,
    locationKind: "office",
    description: "",
    services: [],
    officialRecord: false,
    sources: [],
    warnings: [],
    limitations: [],
    ...overrides,
  };
}
function market(providers: Provider[]): MarketSnapshot {
  return {
    ...published,
    providers,
    locationResearch: {},
    facebookResearch: undefined,
  };
}
function search(snapshot: MarketSnapshot, options: SearchOptions = {}) {
  return searchProviders(
    { zip, radius: 1, category: "home-care", ...options },
    undefined,
    [snapshot],
  );
}
function suggestions(snapshot: MarketSnapshot, category = "home-care") {
  return searchSuggestions(
    new URLSearchParams({ zip, radius: "1", category, q: "Agency" }),
    [snapshot],
  ).suggestions.map((item) => item.id);
}
const ids = (result: ReturnType<typeof search>) =>
  result.providers.map((provider) => provider.id);

test("published exact home ZIP coverage includes distant offices without treating unknown coverage as rejection", () => {
  const snapshot = market([
    office("covered", { serviceAreaZips: [zip] }),
    office("unknown-far"),
    office("outside-far", { serviceAreaZips: ["02116"] }),
    office("unknown-near", { lat: point.lat }),
    office("outside-near", { lat: point.lat, serviceAreaZips: ["02116"] }),
    office("covered-near", { lat: point.lat, serviceAreaZips: [zip] }),
  ]);
  const result = search(snapshot);
  assert.deepEqual(ids(result), [
    "covered-near",
    "outside-near",
    "unknown-near",
    "covered",
  ]);
  assert.equal(result.providers.at(-1)?.serviceAreaMatch, true);
  assert.ok(result.providers.at(-1)!.distanceMiles! > 1);
  assert.equal(result.providers[0].serviceAreaMatch, true);
  assert.equal(result.providers[1].serviceAreaMatch, undefined);
  assert.equal(result.providers[2].serviceAreaMatch, undefined);
  assert.equal(result.total, 4);
  assert.equal(result.categories["home-care"], 4);
  assert.equal(result.catalogTotal, 6);
  assert.equal(result.experienceCoverage.unscored, 4);
  assert.deepEqual(suggestions(snapshot), ids(result));
});

test("only whole ZIP entries count, never snippets, office ZIPs, prefixes or county prose", () => {
  const snapshot = market([
    office("prefix", { serviceAreaZips: ["024"] }),
    office("zip-plus-four", { serviceAreaZips: [`${zip}-1234`] }),
    office("whitespace", { serviceAreaZips: [` ${zip} `] }),
    office("prose", {
      zip,
      serviceArea: `Serving ${zip} and all nearby counties`,
      description: `Excellent reviews, openings and service throughout ${zip}`,
      services: [`Care in ${zip}`],
    }),
    office("empty", { serviceAreaZips: [] }),
    office("exact", { serviceAreaZips: ["02116", zip, zip] }),
  ]);
  assert.deepEqual(ids(search(snapshot)), ["exact"]);
  assert.deepEqual(suggestions(snapshot), ["exact"]);
  assert.deepEqual(ids(search(snapshot, { q: "prose" })), []);
  assert.equal(search(snapshot).categories["home-care"], 1);
});

test("covered offices without safe map points keep null distance, sort last and do not inflate exclusions", () => {
  const snapshot = market([
    office("null-b", { lat: null, lng: null, serviceAreaZips: [zip] }),
    office("null-a", { lat: null, serviceAreaZips: [zip] }),
    office("not-finite", { lng: NaN, serviceAreaZips: [zip] }),
    office("unknown-null", { lat: null, lng: null }),
    office("outside-null", { lat: null, serviceAreaZips: ["02116"] }),
    office("far", { serviceAreaZips: [zip] }),
    office("near", { lat: point.lat }),
  ]);
  for (const sort of ["distance", "experience"]) {
    const result = search(snapshot, { sort });
    assert.deepEqual(ids(result), [
      "near",
      "far",
      "not-finite",
      "null-a",
      "null-b",
    ]);
    assert.deepEqual(
      result.providers.slice(2).map((p) => p.distanceMiles),
      [null, null, null],
    );
    assert.equal(result.providers.at(-1)?.lat, null);
    assert.equal(result.providers.at(-1)?.lng, null);
    assert.equal(result.excludedWithoutCoordinates, 2);
    assert.equal(result.categories["home-care"], 5);
    assert.equal(result.total, 5);
    assert.equal(result.experienceCoverage.unscored, 5);
  }
  assert.deepEqual(suggestions(snapshot), ids(search(snapshot)));
});

test("coverage expansion is limited to primary home care and the selected home-care category", () => {
  const categories: CareCategory[] = [
    "home-health",
    "staffing",
    "assisted-living",
    "nursing-home",
    "life-plan",
  ];
  const snapshot = market([
    office("covered", {
      serviceAreaZips: [zip],
      searchCategories: ["home-health"],
    }),
    ...categories.flatMap((category) => [
      office(`${category}-far`, {
        category,
        searchCategories: ["home-care"],
        serviceAreaZips: [zip],
      }),
      office(`${category}-near`, {
        category,
        searchCategories: ["home-care"],
        serviceAreaZips: [zip],
        lat: point.lat,
      }),
    ]),
    office("wrong-state", {
      state: "NJ",
      lat: point.lat,
      serviceAreaZips: [zip],
    }),
  ]);
  const result = search(snapshot);
  assert.equal(result.total, 6);
  assert.equal(result.categories["home-care"], 6);
  assert.equal(result.categories["home-health"], 2);
  assert.equal(result.categories.staffing, 1);
  assert.deepEqual(result.experienceCoverage, {
    scored: 0,
    unscored: 6,
    facebookFindings: 0,
    facebookCovered: 0,
  });
  assert.deepEqual(suggestions(snapshot), ids(result));
  for (const category of ["all", ...categories]) {
    const normal = search(snapshot, { category });
    assert.ok(normal.providers.every((p) => p.id.endsWith("-near")));
    assert.ok(normal.providers.every((p) => p.serviceAreaMatch === undefined));
    assert.equal(normal.categories["home-care"], 5);
    assert.equal(normal.categories["home-health"], 1);
    assert.ok(!suggestions(snapshot, category).includes("covered"));
  }
});

function research(
  providerId: string,
  access: "full-page" | "search-result",
): LocationResearch {
  const today = new Date().toISOString().slice(0, 10);
  return {
    providerId,
    checkedAt: today,
    providerDetailsReviewed: false,
    sources: [
      {
        id: "reviews",
        url: "https://www.caring.com/senior-care/massachusetts/newton/synthetic-agency",
        title: "Synthetic agency reviews",
        publisher: "Caring.com",
        kind: "review-platform",
        checkedAt: today,
        publishedAt: null,
        access,
        excerpt: `Service in ${zip}, five stars, low prices and immediate openings`,
      },
    ],
    facts: [],
    availability: {
      status: "not-published",
      text: "",
      sourceId: null,
      asOf: null,
    },
    reviewAggregates: [
      {
        sourceId: "reviews",
        platform: "Caring.com",
        sourceFamily: "caring",
        rating: 4,
        scale: 5,
        count: 40,
        asOf: today,
        scope: "consumer",
        notes: [],
      },
    ],
    reviews: [],
    notes: [],
  };
}

test("reviewed and unrated covered offices preserve evidence filters, scores and category counts", () => {
  const snapshot = market([
    office("reviewed", { serviceAreaZips: [zip] }),
    office("reviewed-null", { serviceAreaZips: [zip], lat: null, lng: null }),
    office("snippet", { serviceAreaZips: [zip] }),
    office("unrated", { serviceAreaZips: [zip], lat: point.lat }),
  ]);
  snapshot.locationResearch = {
    reviewed: research("reviewed", "full-page"),
    "reviewed-null": research("reviewed-null", "full-page"),
    snippet: research("snippet", "search-result"),
  };
  const before = JSON.stringify(snapshot);
  const result = search(snapshot, { sort: "experience" });
  assert.deepEqual(ids(result), [
    "reviewed",
    "reviewed-null",
    "unrated",
    "snippet",
  ]);
  assert.deepEqual(
    result.providers.slice(0, 2).map((p) => p.research?.experience.value),
    [8, 8],
  );
  assert.equal(result.experienceCoverage.scored, 2);
  assert.equal(result.experienceCoverage.unscored, 2);
  for (const [evidence, expected] of [
    ["reviews", ["reviewed", "reviewed-null"]],
    ["unrated", ["unrated", "snippet"]],
    ["details", []],
    ["pricing", []],
    ["openings", []],
    ["facebook", []],
  ] as const) {
    const filtered = search(snapshot, { evidence });
    assert.deepEqual(ids(filtered), expected, evidence);
    assert.equal(filtered.total, expected.length, evidence);
    assert.equal(filtered.categories["home-care"], expected.length, evidence);
    assert.equal(filtered.excludedWithoutCoordinates, 0, evidence);
  }
  assert.equal(JSON.stringify(snapshot), before);
});

test("published details, prices and openings still filter covered unlocated offices independently", () => {
  const snapshot = market([
    office("evidence", { serviceAreaZips: [zip], lat: null, lng: null }),
    office("coverage-only", { serviceAreaZips: [zip] }),
  ]);
  const record = research("evidence", "full-page");
  record.providerDetailsReviewed = true;
  record.facts = [
    {
      id: "price",
      kind: "cost",
      text: "Published hourly rate",
      sourceId: "reviews",
      amount: {
        min: 40,
        max: null,
        currency: "USD",
        period: "hour",
        type: "care-fee",
        asOf: null,
      },
    },
  ];
  record.availability = {
    status: "opening-published",
    text: "Published opening",
    sourceId: "reviews",
    asOf: record.checkedAt,
  };
  snapshot.locationResearch = { evidence: record };
  for (const evidence of ["details", "pricing", "openings", "reviews"]) {
    const result = search(snapshot, { evidence });
    assert.deepEqual(ids(result), ["evidence"], evidence);
    assert.equal(result.providers[0].distanceMiles, null);
    assert.equal(result.providers[0].serviceAreaMatch, true);
    assert.equal(result.categories["home-care"], 1);
    assert.equal(result.excludedWithoutCoordinates, 0);
    assert.equal(result.experienceCoverage.scored, 1);
  }
  assert.deepEqual(ids(search(snapshot, { evidence: "unrated" })), [
    "coverage-only",
  ]);
});

test("families can limit home-care results to offices reporting their home ZIP", () => {
  const snapshot = market([
    office("unknown-near", { lat: point.lat }),
    office("covered-near", { lat: point.lat, serviceAreaZips: [zip] }),
    office("covered-far", { serviceAreaZips: [zip] }),
    office("different-area", { lat: point.lat, serviceAreaZips: ["02116"] }),
  ]);
  const result = search(snapshot, { evidence: "service-area" });
  assert.deepEqual(ids(result), ["covered-near", "covered-far"]);
  assert.equal(result.total, 2);
  assert.equal(result.categories["home-care"], 2);
  assert.throws(
    () => search(snapshot, { category: "all", evidence: "service-area" }),
    /in-home care/,
  );
});
