import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/search-suggestions/route";
import { searchSuggestions } from "../src/lib/search-suggestions";
import { searchProviders } from "../src/lib/search";
import {
  markets,
  type MarketRegistry,
  type MarketSnapshot,
} from "../src/lib/markets";
import type { SearchSuggestionsResponse } from "../src/lib/search-suggestion-types";

function suggest(
  q: string,
  overrides: Record<string, string> = {},
  registry: MarketRegistry = markets,
) {
  return searchSuggestions(
    new URLSearchParams({
      zip: "07928",
      radius: "25",
      category: "all",
      q,
      ...overrides,
    }),
    registry,
  ).suggestions;
}

function customMarket(): MarketSnapshot {
  const published = markets.find((market) => market.state === "NJ")!;
  return {
    ...published,
    zips: { "07928": { city: "Origin", lat: 40, lng: -74 } },
    providers: [
      {
        ...published.providers[0],
        id: "custom-provider",
        name: "Harbor Lodge",
        city: "Cedar",
        category: "assisted-living",
        searchCategories: [],
        lat: 40,
        lng: -74,
      },
    ],
  };
}

test("custom registries reflect changed town and provider text and replaced records", () => {
  const market = customMarket();
  const registry = [market];
  assert.deepEqual(
    suggest("harbor", {}, registry).map((item) => item.id),
    ["custom-provider"],
  );
  assert.deepEqual(
    suggest("origin", {}, registry).map((item) => item.value),
    ["Origin"],
  );

  market.providers[0].name = "Willow House";
  market.providers[0].city = "Maple";
  market.zips["07928"].city = "Willow";
  assert.deepEqual(suggest("harbor", {}, registry), []);
  assert.deepEqual(suggest("cedar", {}, registry), []);
  assert.deepEqual(suggest("origin", {}, registry), []);
  assert.deepEqual(
    suggest("willow", {}, registry).map((item) => item.value),
    ["Willow", "Willow House"],
  );
  assert.deepEqual(
    suggest("maple", {}, registry).map((item) => item.id),
    ["custom-provider"],
  );

  market.providers = [{ ...market.providers[0], name: "Birch House" }];
  market.zips = { "07928": { city: "Birch", lat: 40, lng: -74 } };
  assert.deepEqual(suggest("willow", {}, registry), []);
  assert.deepEqual(
    suggest("birch", {}, registry).map((item) => item.value),
    ["Birch", "Birch House"],
  );
});

test("duplicate normalized towns use the nearest matching ZIP before ranking and radius filtering", () => {
  const market = customMarket();
  market.providers = [];
  market.zips["07929"] = { city: "mApLe", lat: 40.2, lng: -74 };
  market.zips["07930"] = { city: "MAPLE", lat: 40.02, lng: -74 };
  market.zips["07931"] = { city: "Mapleton", lat: 40.04, lng: -74 };
  const expected = [
    {
      id: `town:${market.id}:maple`,
      kind: "town",
      value: "MAPLE",
      detail: "Town · NJ",
    },
    {
      id: `town:${market.id}:mapleton`,
      kind: "town",
      value: "Mapleton",
      detail: "Town · NJ",
    },
  ];
  for (const radius of ["5", "25"])
    assert.deepEqual(suggest("  MaPlE  ", { radius }, [market]), expected);
});

test("provider ranking uses case-insensitive name prefixes before distance, name and ID", () => {
  const market = customMarket();
  const provider = market.providers[0];
  market.providers = [
    { ...provider, id: "substring", name: "The Maple", lat: 40 },
    { ...provider, id: "far-prefix", name: "mApLe A", lat: 40.1 },
    { ...provider, id: "name-z", name: "Maple Z", lat: 40.01 },
    { ...provider, id: "tie-b", name: "MAPLE B", lat: 40.01 },
    { ...provider, id: "tie-a", name: "MAPLE B", lat: 40.01 },
  ];
  assert.deepEqual(
    suggest("  MaPlE  ", {}, [market]).map((item) => item.id),
    ["tie-a", "tie-b", "name-z", "far-prefix", "substring"],
  );
  assert.deepEqual(
    suggest("cEdAr", {}, [market]).map((item) => item.id),
    ["substring", "tie-a", "tie-b", "name-z", "far-prefix"],
  );
});

test("towns come from reviewed nearby ZIPs and provider suggestions use the full scoped catalog", () => {
  assert.ok(
    suggest("cha").some(
      (item) => item.kind === "town" && item.value === "Chatham",
    ),
  );
  assert.ok(
    suggest("sun").some(
      (item) => item.kind === "provider" && item.value === "SUNRISE OF SUMMIT",
    ),
  );
  assert.equal(suggest("Boston").length, 0);
  assert.equal(suggest("Chatham", { zip: "02459" }).length, 0);
  assert.ok(
    suggest("Newton", { zip: "02459" }).some((item) => item.kind === "town"),
  );

  for (const zip of ["07928", "02459"]) {
    const fullSearch = searchProviders({ zip, radius: 50 });
    assert.ok(fullSearch.providers.length > 48);
    const record = fullSearch.providers
      .slice(48)
      .find(
        (provider) =>
          fullSearch.providers.filter((other) => other.name === provider.name)
            .length === 1,
      )!;
    assert.ok(record);
    assert.ok(
      suggest(record.name, { zip, radius: "50" }).some(
        (item) => item.id === record.id,
      ),
    );
  }
});

test("radius and primary or additional care category constrain provider suggestions", () => {
  assert.ok(suggest("SUNRISE OF SUMMIT").length > 0);
  assert.equal(suggest("SUNRISE OF SUMMIT", { radius: "1" }).length, 0);
  assert.equal(
    suggest("SUNRISE OF SUMMIT", { category: "nursing-home" }).length,
    0,
  );
  assert.ok(
    suggest("SUNRISE OF SUMMIT", { category: "assisted-living" }).some(
      (item) => item.kind === "provider",
    ),
  );
  assert.ok(
    suggest("All Care", {
      zip: "02459",
      radius: "50",
      category: "home-care",
    }).some((item) => item.id === "all-care"),
  );
});

test("short and absent text returns no suggestions, and arbitrary free text remains a valid query", () => {
  for (const query of ["", " ", "a", "No such provider 5f9ac77"])
    assert.deepEqual(suggest(query), []);
  assert.ok(suggest("  cHaThAm  ").some((item) => item.value === "Chatham"));
  assert.deepEqual(suggest("cha"), suggest("cha"));
});

test("the endpoint rejects invalid and ambiguous selectors without widening geography", async () => {
  for (const query of [
    "zip=bad",
    "zip=10001",
    "zip=01001",
    "zip=07928&radius=0",
    "zip=07928&radius=51",
    "zip=07928&radius=NaN",
    "zip=07928&category=unknown",
    "zip=07928&category=toString",
    "zip=07928&q=a&q=b",
    "zip=07928&zip=02459",
    "zip=07928&limit=1000",
    `zip=07928&q=${"x".repeat(201)}`,
  ]) {
    const response = GET(
      new Request(`http://localhost/api/search-suggestions?${query}`),
    );
    assert.equal(response.status, 400, query);
    assert.equal(typeof (await response.json()).error, "string");
  }
  const response = GET(
    new Request("http://localhost/api/search-suggestions?zip=07928&q=Chatham"),
  );
  assert.equal(response.status, 200);
  assert.ok(
    ((await response.json()) as SearchSuggestionsResponse).suggestions.length >
      0,
  );
});

test("suggestions stay bounded and contain only compact public display fields at the largest radius", async () => {
  for (const zip of ["07928", "02459"]) {
    for (const q of ["ca", "he", "st", "an", "ch", "new"]) {
      const response = GET(
        new Request(
          `http://localhost/api/search-suggestions?zip=${zip}&radius=50&q=${q}`,
        ),
      );
      const text = await response.text();
      const { suggestions } = JSON.parse(text) as SearchSuggestionsResponse;
      assert.ok(suggestions.length <= 10);
      assert.ok(Buffer.byteLength(text) < 10_000);
      assert.equal(
        new Set(suggestions.map((item) => item.id)).size,
        suggestions.length,
      );
      for (const suggestion of suggestions)
        assert.deepEqual(Object.keys(suggestion).sort(), [
          "detail",
          "id",
          "kind",
          "value",
        ]);
    }
  }
});

test("unlocated providers are never suggested through their postal town", () => {
  const market = markets.find((item) => item.id === "massachusetts")!;
  const unlocated = market.providers.find(
    (item) => item.id === "privatus-boston",
  )!;
  assert.equal(unlocated.lat, null);
  assert.ok(
    !suggest("Privatus", { zip: "02459", radius: "50" }).some(
      (item) => item.id === unlocated.id,
    ),
  );
});
