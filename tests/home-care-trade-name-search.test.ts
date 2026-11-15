import test from "node:test";
import assert from "node:assert/strict";
import { GET as searchGET } from "../src/app/api/search/route";
import { GET as suggestionsGET } from "../src/app/api/search-suggestions/route";
import { markets, type MarketSnapshot } from "../src/lib/markets";
import type { Provider, SearchResponse } from "../src/lib/providers";
import { searchProviders } from "../src/lib/search";
import { searchSuggestions } from "../src/lib/search-suggestions";
import type { SearchSuggestionsResponse } from "../src/lib/search-suggestion-types";

const providerId = "north-jersey-hp-hp0055100";
const tradeName = "J & L HOMECARE SERVICE, INC";
const zip = "08876";
const published = markets.find((market) => market.id === "north-jersey")!;
const office = published.providers.find(
  (provider) => provider.id === providerId,
)!;
const options = { zip, radius: "1", category: "home-care", q: tradeName };

function snapshot(providers: Provider[], state = "NJ"): MarketSnapshot {
  return {
    ...published,
    state,
    providers,
    locationResearch: {},
    facebookResearch: undefined,
  };
}

function matches(market: MarketSnapshot, q = tradeName) {
  return {
    results: searchProviders({ ...options, q }, undefined, [
      market,
    ]).providers.map((provider) => provider.id),
    suggestions: searchSuggestions(new URLSearchParams({ ...options, q }), [
      market,
    ]).suggestions.map((suggestion) => suggestion.id),
  };
}

test("a real registered trade name absent from the legal name resolves through both public endpoints", async () => {
  assert.equal(office.name, "VISITING ANGELS LIVING ASSISTANCE SERVICE");
  assert.ok(!office.name.includes(tradeName));
  for (const q of [tradeName, "  j & l homecare  "]) {
    const query = new URLSearchParams({ ...options, q });
    const searchResponse = searchGET(
      new Request(`http://localhost/api/search?${query}`),
    );
    const suggestionsResponse = suggestionsGET(
      new Request(`http://localhost/api/search-suggestions?${query}`),
    );
    assert.equal(searchResponse.status, 200);
    assert.equal(suggestionsResponse.status, 200);
    const search = (await searchResponse.json()) as SearchResponse;
    const suggestions =
      (await suggestionsResponse.json()) as SearchSuggestionsResponse;
    assert.deepEqual(
      search.providers.map((provider) => provider.id),
      [providerId],
    );
    assert.deepEqual(suggestions.suggestions, [
      {
        id: providerId,
        kind: "provider",
        value: office.name,
        detail: `${office.city}, NJ · Provider`,
      },
    ]);
    assert.equal(
      Object.hasOwn(search.providers[0], "registrationFacts"),
      false,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(search.providers[0])) < 10_000);
  }
});

test("trade names resolve without attached facts and do not transfer to another office, name, state or category", () => {
  const detached = { ...office };
  assert.equal(Object.hasOwn(detached, "registrationFacts"), false);
  assert.deepEqual(matches(snapshot([detached])), {
    results: [providerId],
    suggestions: [providerId],
  });
  for (const provider of [
    { ...detached, id: "north-jersey-hp-hp9999999" },
    { ...detached, name: "Unrelated agency" },
    { ...detached, state: "MA" },
    { ...detached, category: "staffing" as const },
  ]) {
    assert.deepEqual(matches(snapshot([provider], provider.state)), {
      results: [],
      suggestions: [],
    });
  }
  assert.deepEqual(
    searchProviders({ ...options, zip: "02459", radius: 50 }).providers,
    [],
  );
  assert.deepEqual(
    searchSuggestions(
      new URLSearchParams({ ...options, zip: "02459", radius: "50" }),
    ).suggestions,
    [],
  );
});

test("trade-name matching preserves radius, service-area and category boundaries", () => {
  const far = { ...office, lat: published.zips[zip].lat + 1 };
  delete far.serviceAreaZips;
  assert.deepEqual(matches(snapshot([far])), { results: [], suggestions: [] });
  assert.deepEqual(matches(snapshot([{ ...far, serviceAreaZips: [zip] }])), {
    results: [providerId],
    suggestions: [providerId],
  });
  const wrongCategory = { ...options, category: "nursing-home" };
  assert.deepEqual(searchProviders(wrongCategory).providers, []);
  assert.deepEqual(
    searchSuggestions(new URLSearchParams(wrongCategory)).suggestions,
    [],
  );
});

test("trade names do not change distance ordering or legal-name prefix ranking", () => {
  const point = published.zips[zip];
  const market = snapshot([
    { ...office, lat: point.lat, lng: point.lng },
    {
      ...office,
      id: "north-jersey-prefix-office",
      name: "J & L AGENCY",
      lat: point.lat + 0.005,
      lng: point.lng,
    },
  ]);
  assert.deepEqual(matches(market, "J & L"), {
    results: [providerId, "north-jersey-prefix-office"],
    suggestions: ["north-jersey-prefix-office", providerId],
  });
});
