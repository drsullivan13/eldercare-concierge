import assert from "node:assert/strict";
import test from "node:test";
import {
  projectSearchCard,
  searchProviders,
  searchResponse,
} from "../src/lib/search";

const query = "zip=07928&radius=50&category=home-care";
const full = searchProviders(new URLSearchParams(query));
const office = full.providers.find(
  (provider) => provider.id === "north-jersey-hp-hp0015318",
)!;
const summary =
  "BAYADA caregivers can help someone bathe and dress, prepare a meal or do light housework.";

test("projectSearchCard retains only the reviewed location description summary", () => {
  assert.ok(office.locationDescription?.sources.length);
  assert.equal(office.locationDescription.summary, summary);
  const card = projectSearchCard(office);
  assert.ok("locationDescription" in card);
  assert.deepEqual(card.locationDescription, { summary });
  assert.equal("sources" in card, false);
  assert.equal("description" in card, false);
});

test("projectSearchCard omits missing descriptions without legacy fallback or placeholders", () => {
  const { locationDescription, ...withoutDescription } = office;
  assert.ok(locationDescription);
  for (const provider of [
    withoutDescription,
    { ...withoutDescription, locationDescription: undefined },
    { ...withoutDescription, locationDescription: null },
  ]) {
    const card = projectSearchCard({
      ...provider,
      description: "Legacy prose must not become a card description.",
    });
    assert.equal("locationDescription" in card, false);
    assert.equal("description" in card, false);
    assert.equal("locationDescription" in JSON.parse(JSON.stringify(card)), false);
  }
});

test("real ZIP search cards retain reviewed summaries but omit missing descriptions and marker evidence", () => {
  let described = 0;
  let missing = 0;
  let seen = 0;
  for (let page = 1; ; page++) {
    const result = searchResponse(
      new URLSearchParams(`${query}&response=cards&pageSize=48&page=${page}`),
    );
    assert.ok("pagination" in result);
    for (const card of result.providers) {
      const provider = full.providers.find((item) => item.id === card.id)!;
      assert.ok(provider);
      assert.equal("sources" in card, false);
      assert.equal("description" in card, false);
      if (provider.locationDescription) {
        described++;
        assert.ok("locationDescription" in card);
        assert.deepEqual(card.locationDescription, {
          summary: provider.locationDescription.summary,
        });
      } else {
        missing++;
        assert.equal("locationDescription" in card, false);
      }
      seen++;
    }
    if (page === 1) {
      assert.equal(result.markers?.length, full.total);
      for (const marker of result.markers!) {
        for (const key of ["locationDescription", "description", "sources"])
          assert.equal(key in marker, false, `${marker.id}: ${key}`);
      }
    }
    if (!result.pagination.hasMore) break;
  }
  assert.equal(seen, full.total);
  assert.ok(described > 0);
  assert.ok(missing > 0);
});
