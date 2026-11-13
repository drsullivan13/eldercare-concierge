import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GET } from "../src/app/api/location-description/route";
import {
  getLocationDescription,
  LocationDescriptionInputError,
} from "../src/lib/location-descriptions";
import {
  isLocationDescriptionResponse,
  type LocationDescription,
  type LocationDescriptionResponse,
} from "../src/lib/location-description-types";
import { getMarket } from "../src/lib/markets";
import upgradeData from "../research/north-jersey/supplemental-release/first-party-upgrades.json";
import snapshotData from "../src/data/location-descriptions.json";

const upgrades: Record<string, (typeof upgradeData)[keyof typeof upgradeData]> =
  upgradeData;

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

test("published descriptions return exact provenance, with honest gaps across all active NJ IDs", async () => {
  const snapshot: {
    schemaVersion: number;
    marketId: string;
    checkedAt: string;
    locations: Record<string, LocationDescription>;
  } = JSON.parse(
    await readFile(
      join(process.cwd(), "src/data/location-descriptions.json"),
      "utf8",
    ),
  );
  const providers = getMarket("north-jersey")!.providers;
  const coverage = JSON.parse(
    await readFile(
      join(process.cwd(), "research/north-jersey/descriptions/coverage.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    coverage.locations.map((p: { providerId: string }) => p.providerId).sort(),
    providers.map(({ id }) => id).sort(),
  );
  assert.deepEqual(
    coverage.locations
      .filter((p: { status: string }) => p.status === "described")
      .map((p: { providerId: string }) => p.providerId)
      .sort(),
    Object.keys(snapshot.locations).sort(),
  );
  for (const provider of providers) {
    const description = await getLocationDescription(provider.id);
    if (
      !snapshot.locations[provider.id] &&
      !Object.hasOwn(upgrades, provider.id)
    ) {
      assert.equal(description, null);
      const response = await GET(
        new Request(
          `http://localhost/api/location-description?id=${provider.id}`,
        ),
      );
      assert.equal(response.status, 404);
      continue;
    }
    assert.ok(description, provider.id);
    assert.equal(isLocationDescriptionResponse(description, provider.id), true);
    const { schemaVersion, marketId, checkedAt, ...record } = description;
    assert.equal(schemaVersion, 1);
    assert.equal(marketId, "north-jersey");
    if (
      Object.hasOwn(upgrades, provider.id) &&
      snapshot.locations[provider.id]?.basis !== "provider"
    ) {
      assert.equal(checkedAt, upgrades[provider.id].checkedAt);
      assert.equal(record.basis, "provider");
      assert.equal(record.summary, upgrades[provider.id].statement.text);
    } else {
      assert.equal(checkedAt, snapshot.checkedAt);
      assert.deepEqual(record, snapshot.locations[provider.id]);
    }
    assert.equal("locations" in description, false);
  }
});

test("all 39 verified office intros reach the endpoint without network access", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("Description lookup must not fetch remote evidence.");
  });
  assert.equal(Object.keys(upgrades).length, 39);
  const reviewed: Record<
    string,
    (typeof snapshotData.locations)[keyof typeof snapshotData.locations]
  > = snapshotData.locations;
  let preserved = 0;
  let upgraded = 0;
  for (const [id, upgrade] of Object.entries(upgrades)) {
    const response = await GET(
      new Request(`http://localhost/api/location-description?id=${id}`),
    );
    assert.equal(response.status, 200, id);
    const body: unknown = await response.json();
    assert.ok(isLocationDescriptionResponse(body, id), id);
    assert.equal(body.basis, "provider", id);
    assert.equal(body.scope, "agency-office", id);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
    assert.ok(body.summary.length >= 25 && body.summary.length <= 700, id);
    assert.doesNotMatch(body.summary, /\n/);
    if (reviewed[id]?.basis === "provider") {
      preserved++;
      assert.deepEqual(body, {
        ...reviewed[id],
        schemaVersion: snapshotData.schemaVersion,
        marketId: snapshotData.marketId,
        checkedAt: snapshotData.checkedAt,
      });
    } else {
      upgraded++;
      assert.equal(body.summary, upgrade.statement.text, id);
      assert.equal(body.checkedAt, upgrade.checkedAt, id);
      assert.deepEqual(
        body.sources.map(({ url }) => url),
        upgrade.sourceUrls,
        id,
      );
      for (const source of body.sources) {
        assert.equal(source.checkedAt, upgrade.checkedAt, id);
        assert.ok(source.publisher && source.title, id);
      }
      for (const url of upgrade.statement.source_urls)
        assert.ok(
          body.sources.some((source) => source.url === url),
          id,
        );
      for (const limitation of upgrade.limitations)
        assert.ok(body.limitations.includes(limitation), id);
      assert.equal("identity" in body, false);
      assert.equal("statement" in body, false);
    }
  }
  assert.equal(preserved, 9);
  assert.equal(upgraded, 30);
});

test("verified office copy fills a missing description without changing its catalog identity", async () => {
  const id = "north-jersey-hp-hp0015318";
  const locations: Record<string, unknown> = snapshotData.locations;
  const original = locations[id];
  const provider = getMarket("north-jersey")!.providers.find(
    (p) => p.id === id,
  )!;
  const identity = structuredClone(provider);
  try {
    delete locations[id];
    const body = await getLocationDescription(id);
    assert.equal(body?.basis, "provider");
    assert.equal(body?.summary, upgrades[id].statement.text);
    assert.equal(body?.scope, "agency-office");
    assert.deepEqual(provider, identity);
  } finally {
    locations[id] = original;
  }
});

test("office upgrades fail closed on every exact identity field", async () => {
  const id = "north-jersey-hp-hp0015318";
  const upgrade = upgrades[id];
  for (const field of [
    "name",
    "category",
    "address",
    "city",
    "state",
    "zip",
  ] as const) {
    const original = upgrade.identity[field];
    try {
      upgrade.identity[field] = `${original} changed`;
      await assert.rejects(getLocationDescription(id), /identity/i, field);
    } finally {
      upgrade.identity[field] = original;
    }
  }
  const original = upgrade.providerId;
  try {
    upgrade.providerId = "north-jersey-hp-hp0015319";
    await assert.rejects(getLocationDescription(id), /identity/i);
  } finally {
    upgrade.providerId = original;
  }
});

test("office upgrades retain mailing-only and existing service-area scope", async () => {
  const id = "north-jersey-hp-hp0015318";
  const provider = getMarket("north-jersey")!.providers.find(
    (p) => p.id === id,
  )!;
  const upgrade = upgrades[id];
  const originalAddress = provider.address;
  const originalIdentityAddress = upgrade.identity.address;
  const locations: Record<
    string,
    (typeof snapshotData.locations)[keyof typeof snapshotData.locations]
  > = snapshotData.locations;
  const originalScope = locations[id].scope;
  try {
    for (const address of ["PO BOX 24", "P.O. Box 24", "Post Office Box 24"]) {
      provider.address = upgrade.identity.address = address;
      const body = await getLocationDescription(id);
      assert.equal(body?.basis, "provider");
      assert.equal(body?.scope, "service-area");
      assert.ok(body?.limitations.some((text) => /mailing/i.test(text)));
      assert.ok(body?.limitations.some((text) => /not.*coverage/i.test(text)));
    }
    provider.address = originalAddress;
    upgrade.identity.address = originalIdentityAddress;
    locations[id].scope = "service-area";
    assert.equal((await getLocationDescription(id))?.scope, "service-area");
  } finally {
    provider.address = originalAddress;
    upgrade.identity.address = originalIdentityAddress;
    locations[id].scope = originalScope;
  }
});

test("office upgrades validate released scope, prose and provenance before returning", async () => {
  const id = "north-jersey-hp-hp0015318";
  const upgrade = upgrades[id];
  const original = structuredClone(upgrade);
  const invalid = [
    () => {
      upgrade.scope = "Brandwide service coverage";
    },
    () => {
      upgrade.statement.text = "";
    },
    () => {
      upgrade.statement.text = "x".repeat(701);
    },
    () => {
      upgrade.statement.text = "An office.\nWith unsupported formatting.";
    },
    () => {
      upgrade.checkedAt = "2026-02-30";
    },
    () => {
      upgrade.sourceUrls = [];
    },
    () => {
      upgrade.sourceUrls = ["http://example.com/office"];
    },
    () => {
      upgrade.sourceUrls = ["https://example.com/?api_key=secret"];
    },
    () => {
      upgrade.statement.source_urls = ["https://example.com/unrelated"];
    },
    () => {
      upgrade.limitations = [""];
    },
  ];
  for (const mutate of invalid) {
    try {
      mutate();
      await assert.rejects(getLocationDescription(id), /Invalid/);
    } finally {
      Object.assign(upgrade, structuredClone(original));
    }
  }
});

test("the live lookup distinguishes the Cedar Crest campus, nursing unit and an agency office", async () => {
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
