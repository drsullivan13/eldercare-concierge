import assert from "node:assert/strict";
import test from "node:test";
import {
  searchProviders,
  searchResponse,
  projectSearchCard,
} from "../src/lib/search";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const { ProviderCard } =
  require("../src/components/provider-card") as typeof import("../src/components/provider-card");
import { GET } from "../src/app/api/search/route";

const query = "zip=07928&radius=25&category=home-care";
test("compact pages preserve the complete ordered index and legacy metadata", () => {
  const full = searchProviders(new URLSearchParams(query));
  const result = searchResponse(
    new URLSearchParams(`${query}&response=compact&pageSize=7&page=1`),
  );
  assert.ok("markers" in result && result.markers);
  assert.deepEqual(result.providers, full.providers.slice(0, 7));
  assert.deepEqual(
    result.markers.map((p) => p.id),
    full.providers.map((p) => p.id),
  );
  for (const key of [
    "total",
    "categories",
    "experienceCoverage",
    "excludedWithoutCoordinates",
    "origin",
    "market",
    "catalogTotal",
    "asOf",
    "radius",
  ] as const)
    assert.deepEqual(result[key], full[key]);
  for (const [index, marker] of result.markers.entries()) {
    const provider = full.providers[index];
    assert.equal(marker.serviceAreaMatch, provider.serviceAreaMatch);
    assert.equal(marker.distanceMiles, provider.distanceMiles);
    assert.equal(marker.lat, provider.lat);
    assert.equal(marker.lng, provider.lng);
    assert.equal("research" in marker, false);
    assert.equal("sources" in marker, false);
  }
  assert.deepEqual(result.pagination, {
    page: 1,
    pageSize: 7,
    totalPages: Math.ceil(full.total / 7),
    hasMore: full.total > 7,
  });
  const end = searchResponse(
    new URLSearchParams(`${query}&response=compact&page=10000`),
  );
  assert.ok("pagination" in end);
  assert.equal(end.providers.length, 0);
  assert.equal(end.markers, undefined);
  assert.equal(end.pagination.hasMore, false);
});
test("compact pagination is strict and variants avoid shared caches", () => {
  for (const suffix of [
    "response=compact&q=test",
    "response=cards&q=test",
    "response=cards&page=2&pageSize=18",
    "response=compact&page=2&pageSize=48",
  ]) {
    const response = GET(
      new Request(`https://harbor.example/api/search?${query}&${suffix}`),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  for (const suffix of [
    "page=1",
    "pageSize=24",
    "response=full",
    "response=compact&response=compact",
    "response=cards&response=cards",
    "response=compact&page=0",
    "response=compact&page=01",
    "response=compact&page=1.1",
    "response=compact&page=10001",
    "response=compact&page=1&page=2",
    "response=compact&pageSize=49",
    "response=compact&pageSize=0",
    "response=compact&unknown=1",
  ]) {
    const response = GET(
      new Request(`https://harbor.example/api/search?${query}&${suffix}`),
    );
    assert.equal(response.status, 400, suffix);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(
    searchResponse(new URLSearchParams(query)),
    searchProviders(new URLSearchParams(query)),
  );
});

test("canonical first pages use bounded shared caching for both finite modes", () => {
  for (const mode of ["compact", "cards"]) {
    const response = GET(
      new Request(
        `https://harbor.example/api/search?${query}&response=${mode}`,
      ),
    );
    assert.match(
      response.headers.get("cache-control")!,
      /^public, max-age=0, s-maxage=\d+, must-revalidate$/,
    );
  }
});

test("cards response projects display fields while compact v1 and full detail remain intact", () => {
  for (const radius of [25, 50]) {
    const params = `zip=07928&radius=${radius}&category=home-care`;
    const full = searchProviders(new URLSearchParams(params));
    const cards = searchResponse(
      new URLSearchParams(`${params}&response=cards`),
    );
    const compact = searchResponse(
      new URLSearchParams(`${params}&response=compact`),
    );
    assert.deepEqual(compact.providers, full.providers.slice(0, 18));
    assert.deepEqual(
      cards.providers,
      full.providers.slice(0, 18).map(projectSearchCard),
    );
    assert.deepEqual(
      { ...cards, providers: [] },
      { ...compact, providers: [] },
    );
    for (const card of cards.providers) {
      for (const key of [
        "sources",
        "limitations",
        "officialRecord",
        "address",
        "description",
        "phone",
        "website",
        "serviceAreaZips",
        "ownership",
        "capacity",
      ])
        assert.equal(key in card, false, key);
      const provider = full.providers.find((item) => item.id === card.id)!;
      assert.deepEqual(card.research, provider.research);
      assert.deepEqual(card.warnings, provider.warnings);
      assert.deepEqual(card.services, provider.services);
      assert.deepEqual(
        card.locationDescription,
        provider.locationDescription
          ? { summary: provider.locationDescription.summary }
          : undefined,
      );
    }
    assert.ok(JSON.stringify(cards).length < JSON.stringify(compact).length);
  }
});

test("projected cards render identical content and care alerts across care categories", () => {
  const full = searchProviders(
    new URLSearchParams("zip=07928&radius=50&category=all"),
  );
  for (const provider of full.providers) {
    const props = {
      saved: false,
      onSave() {},
      onOpen() {},
      onReviews() {},
      onCompare() {},
    };
    assert.equal(
      renderToStaticMarkup(
        createElement(ProviderCard, {
          ...props,
          provider: projectSearchCard(provider),
        }),
      ),
      renderToStaticMarkup(createElement(ProviderCard, { ...props, provider })),
      provider.id,
    );
  }
});
