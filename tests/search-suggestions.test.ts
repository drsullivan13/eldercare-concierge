import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/search-suggestions/route";
import { searchSuggestions } from "../src/lib/search-suggestions";
import { searchProviders } from "../src/lib/search";
import { markets } from "../src/lib/markets";
import type { SearchSuggestionsResponse } from "../src/lib/search-suggestion-types";

function suggest(q: string, overrides: Record<string, string> = {}) {
  return searchSuggestions(
    new URLSearchParams({
      zip: "07928",
      radius: "25",
      category: "all",
      q,
      ...overrides,
    }),
  ).suggestions;
}

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
