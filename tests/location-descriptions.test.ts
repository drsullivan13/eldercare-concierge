import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/location-description/route";
import {
  getLocationDescription,
  LocationDescriptionInputError,
} from "../src/lib/location-descriptions";
import {
  isLocationDescriptionResponse,
  type LocationDescriptionResponse,
} from "../src/lib/location-description-types";
import { getMarket } from "../src/lib/markets";
import snapshotData from "../src/data/location-descriptions.json";

const campusId = "north-jersey-campus-cedar-crest-village-07444";
const unitId = "cms-315491";
const officeId = "cms-317058";
const example: LocationDescriptionResponse = {
  schemaVersion: 1,
  marketId: "north-jersey",
  checkedAt: "2026-11-13",
  providerId: campusId,
  summary: "A campus in Pompton Plains with several care settings.",
  scope: "campus",
  basis: "provider",
  sources: [
    {
      url: "https://www.ericksonseniorliving.com/cedar-crest",
      publisher: "Erickson Senior Living",
      title: "Cedar Crest",
      checkedAt: "2026-11-13",
    },
  ],
  limitations: ["Campus amenities do not establish services in a care unit."],
};

test("description responses retain explicit scope and basis for one exact provider", () => {
  for (const scope of ["facility", "campus", "agency-office", "service-area"]) {
    for (const basis of ["provider", "official-listing"])
      assert.equal(
        isLocationDescriptionResponse({ ...example, scope, basis }, campusId),
        true,
      );
  }
  assert.equal(isLocationDescriptionResponse(example, unitId), false);
});

test("description response validation rejects malformed identity, provenance and links", () => {
  for (const value of [
    null,
    [],
    {},
    { ...example, schemaVersion: 2 },
    { ...example, marketId: "massachusetts" },
    { ...example, providerId: unitId },
    { ...example, summary: "" },
    { ...example, scope: "office" },
    { ...example, scope: ["campus"] },
    { ...example, basis: "directory" },
    { ...example, checkedAt: "2026-02-30" },
    { ...example, sources: [] },
    { ...example, limitations: [null] },
    ...[
      { url: "javascript:alert(1)" },
      { url: "http://www.nj.gov/example" },
      { url: "https://127.0.0.1/example" },
      { url: "https://evidence.local/example" },
      { url: "https://www.nj.gov/example?api_key=secret" },
      { url: "https://user:password@example.com" },
      { publisher: "" },
      { title: "" },
      { checkedAt: "yesterday" },
    ].map((source) => ({
      ...example,
      sources: [{ ...example.sources[0], ...source }],
    })),
  ])
    assert.equal(isLocationDescriptionResponse(value, campusId), false);
});

test("description API accepts exactly one syntactically valid ID selector", async () => {
  for (const query of [
    "",
    "id=",
    `id=${campusId}&id=${unitId}`,
    `id=${campusId}&market=north-jersey`,
    `providerId=${campusId}`,
    "id=../location-descriptions",
    "id=UPPERCASE",
    `id=${"a".repeat(151)}`,
  ]) {
    const response = await GET(
      new Request(`http://localhost/api/location-description?${query}`),
    );
    assert.equal(response.status, 400, query);
    assert.ok((await response.json()).error);
  }
});

test("unknown IDs and non-NJ catalog records never receive a description", async () => {
  for (const id of [
    "north-jersey-unknown-provider",
    "lifeplan-brooksby-village",
  ]) {
    await assert.rejects(
      getLocationDescription(id),
      (error: unknown) =>
        error instanceof LocationDescriptionInputError && error.status === 404,
    );
    const response = await GET(
      new Request(`http://localhost/api/location-description?id=${id}`),
    );
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error);
    assert.equal(body.summary, undefined);
  }
});

test("published descriptions retain legacy provenance outside North Jersey home care", async () => {
  const snapshot: {
    checkedAt: string;
    locations: Record<string, Record<string, unknown>>;
  } = snapshotData;
  for (const provider of getMarket("north-jersey")!.providers) {
    const description = await getLocationDescription(provider.id);
    if (provider.category === "home-care") {
      assert.deepEqual(description, provider.locationDescription);
      continue;
    }
    const expected = snapshot.locations[provider.id];
    assert.deepEqual(
      description,
      expected
        ? {
            ...expected,
            schemaVersion: 1,
            marketId: "north-jersey",
            checkedAt: snapshot.checkedAt,
          }
        : null,
      provider.id,
    );
  }
});

test("the live lookup distinguishes the Cedar Crest campus, nursing unit and skilled home-health office", async () => {
  const campus = await getLocationDescription(campusId);
  const unit = await getLocationDescription(unitId);
  const office = await getLocationDescription(officeId);
  assert.equal(campus?.scope, "campus");
  assert.equal(unit?.scope, "facility");
  assert.equal(office?.scope, "agency-office");
  assert.notEqual(campus?.summary, unit?.summary);
  for (const id of [campusId, unitId, officeId]) {
    const response = await GET(
      new Request(`http://localhost/api/location-description?id=${id}`),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
    const body = await response.json();
    assert.equal(body.providerId, id);
    assert.equal("locations" in body, false);
  }
});
