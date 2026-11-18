import assert from "node:assert/strict";
import test from "node:test";
import { searchProviders, searchResponse } from "../src/lib/search";
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

test("canonical compact first page uses bounded shared caching", () => {
  const response = GET(
    new Request(`https://harbor.example/api/search?${query}&response=compact`),
  );
  assert.match(
    response.headers.get("cache-control")!,
    /^public, max-age=0, s-maxage=\d+, must-revalidate$/,
  );
});
