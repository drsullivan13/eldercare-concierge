import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOSTON,
  catalog,
  distanceMiles,
  getProvidersByIds,
  searchProviders,
  SearchInputError,
} from "../src/lib/search";
import { GET as searchGET } from "../src/app/api/search/route";
import { GET as providersGET } from "../src/app/api/providers/route";
import type { Provider } from "../src/lib/providers";

const raw = JSON.parse(
  readFileSync(
    new URL("../src/data/inputs/boston-region-providers.json", import.meta.url),
    "utf8",
  ),
);
const origin = { lat: 42.350979, lng: -71.076591 }; // Published Census point for Boston 02116.

test("published Boston/Weston points give plausible symmetric straight-line miles", () => {
  const weston = { lat: 42.360068, lng: -71.303599 };
  const distance = distanceMiles(BOSTON, weston);
  assert.ok(distance > 12 && distance < 13);
  assert.ok(Math.abs(distanceMiles(weston, BOSTON) - distance) < 1e-10);
  assert.equal(distanceMiles(origin, origin), 0);
});

test("leading zero and default Newton ZIP are preserved; known requested locations resolve", () => {
  assert.equal(searchProviders().origin.zip, "02459");
  for (const zip of [
    "02116",
    "02459",
    "02493",
    "02482",
    "01970",
    "02043",
    "02169",
  ])
    assert.equal(searchProviders({ zip }).origin.zip, zip);
  assert.throws(() => searchProviders({ zip: "2459" }), SearchInputError);
});

test("invalid, unlisted, out-of-state and outside-pilot origins are rejected distinctly", () => {
  assert.throws(() => searchProviders({ zip: "ABCDE" }), /five-digit/);
  assert.throws(() => searchProviders({ zip: "02100" }), /not recognized/);
  assert.throws(() => searchProviders({ zip: "10001" }), /Massachusetts/);
  assert.throws(
    () => searchProviders({ zip: "01001" }),
    /outside the Boston pilot/,
  );
  assert.throws(
    () => searchProviders({ zip: "02554" }),
    /outside the Boston pilot/,
  );
});

test("radius is mandatory for every sort and a larger radius is a superset", () => {
  const narrow = searchProviders({ zip: "02116", radius: 2 });
  const broad = searchProviders({ zip: "02116", radius: 25 });
  assert.ok(narrow.total > 0 && broad.total > narrow.total);
  const ids = new Set(broad.providers.map((provider) => provider.id));
  assert.ok(
    narrow.providers.every(
      (provider) => ids.has(provider.id) && provider.distanceMiles! <= 2,
    ),
  );
  for (const provider of broad.providers) {
    assert.notEqual(provider.lat, null);
    assert.ok(
      distanceMiles(origin, { lat: provider.lat!, lng: provider.lng! }) <= 25,
    );
  }
  const rated = searchProviders({
    zip: "02116",
    radius: 2,
    category: "nursing-home",
    sort: "cms-rating",
  });
  assert.ok(rated.providers.every((provider) => provider.distanceMiles! <= 2));
  for (const radius of ["0", "51", "NaN", "", "Infinity", "-2"])
    assert.throws(() => searchProviders({ radius }), /Radius/);
});

test("CMS sorting applies only to nursing homes, puts real nulls last and is deterministic", () => {
  assert.throws(
    () => searchProviders({ sort: "cms-rating" }),
    /only.*nursing-home/,
  );
  assert.throws(
    () => searchProviders({ category: "assisted-living", sort: "cms-rating" }),
    /only.*nursing-home/,
  );
  const options = {
    zip: "02459",
    radius: 50,
    category: "nursing-home",
    sort: "cms-rating",
  };
  const result = searchProviders(options);
  assert.ok(
    result.providers.some((provider) => provider.cms?.overall === null),
  );
  for (let i = 1; i < result.providers.length; i++)
    assert.ok(
      (result.providers[i - 1].cms?.overall ?? -1) >=
        (result.providers[i].cms?.overall ?? -1),
    );
  assert.deepEqual(
    result.providers.map((provider) => provider.id),
    searchProviders(options).providers.map((provider) => provider.id),
  );
});

test("name/city text search and per-category radius counts use actual records", () => {
  const result = searchProviders({ zip: "02459", radius: 25, q: "Newton" });
  assert.ok(result.total > 0);
  assert.ok(
    result.providers.every((provider) =>
      /newton/i.test(`${provider.name} ${provider.city}`),
    ),
  );
  assert.equal(
    result.categories["nursing-home"],
    result.providers.filter((provider) => provider.category === "nursing-home")
      .length,
  );
  assert.equal(searchProviders({ q: "No such provider 5f9ac77" }).total, 0);
});

test("real records missing safe office points are counted and never receive invented distances", () => {
  const unlocated = catalog.find(
    (provider) => provider.id === "privatus-boston",
  );
  assert.ok(unlocated && unlocated.lat === null && unlocated.lng === null);
  const result = searchProviders({
    zip: "02459",
    radius: 50,
    category: "staffing",
  });
  assert.ok(result.excludedWithoutCoordinates >= 1);
  assert.ok(
    result.providers.every((provider) => provider.distanceMiles !== null),
  );
  assert.ok(
    !result.providers.some((provider) => provider.id === "privatus-boston"),
  );
  assert.equal(getProvidersByIds(["privatus-boston"])[0]?.lat, null);
});

test("same-distance/name ties resolve by ID using real catalog coordinates", () => {
  const record = catalog.find((provider) => provider.id === "cms-225506")!;
  // Same sourced location with distinct IDs exercises ordering, not geographic fabrication.
  const fixtures: Provider[] = [
    { ...record, id: "second" },
    { ...record, id: "first" },
  ];
  assert.deepEqual(
    searchProviders({ zip: "02116", radius: 25 }, fixtures).providers.map(
      (provider) => provider.id,
    ),
    ["first", "second"],
  );
});

test("catalog retains source coverage, CMS flags and null/zero numeric meaning", () => {
  assert.equal(catalog.length, 521);
  assert.equal(
    catalog.filter((provider) => provider.category === "nursing-home").length,
    280,
  );
  assert.equal(
    catalog.filter((provider) => provider.category === "assisted-living")
      .length,
    224,
  );
  for (const provider of catalog) {
    assert.ok(provider.sources.length > 0);
    assert.ok(
      provider.sources.every(
        (source) =>
          source.url.startsWith("https://") &&
          source.checkedAt === "2026-11-11",
      ),
    );
    if (provider.category !== "nursing-home")
      assert.equal(provider.cms, undefined);
  }
  for (const source of raw.filter(
    (provider: { type: string }) => provider.type === "nursing_home",
  )) {
    const provider = catalog.find((provider) => provider.id === source.id)!;
    assert.equal(
      provider.cms!.fineAmount,
      source.penalties?.totalFineDollars ?? null,
    );
    assert.equal(provider.cms!.fines, source.penalties?.fineCount ?? null);
    assert.equal(provider.cms!.overall, source.cmsStars?.overall ?? null);
  }
  assert.ok(catalog.some((provider) => provider.cms?.fineAmount === 0));
  assert.ok(catalog.some((provider) => provider.cms?.overall === null));
  assert.ok(
    catalog.some(
      (provider) =>
        provider.cms?.abuse &&
        provider.warnings.some((warning) => /abuse icon/.test(warning)),
    ),
  );
  assert.ok(
    catalog.some(
      (provider) =>
        provider.cms?.specialFocus &&
        provider.warnings.some((warning) => /special-focus/.test(warning)),
    ),
  );
});

test("API validates bad inputs and saved-ID lookup is bounded, ordered and tolerant of retired IDs", async () => {
  assert.equal(
    searchGET(new Request("http://localhost/api/search?zip=10001")).status,
    400,
  );
  assert.equal(
    searchGET(new Request("http://localhost/api/search?category=unknown"))
      .status,
    400,
  );
  const response = searchGET(
    new Request("http://localhost/api/search?zip=02459&radius=10"),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.origin.zip, "02459");
  assert.equal(body.total, body.providers.length);
  assert.equal(
    providersGET(new Request("http://localhost/api/providers")).status,
    400,
  );
  assert.equal(
    providersGET(
      new Request(
        "http://localhost/api/providers?ids=" + Array(101).fill("id").join(","),
      ),
    ).status,
    400,
  );
  const saved = await providersGET(
    new Request(
      "http://localhost/api/providers?ids=cms-225506,missing,cms-225506",
    ),
  ).json();
  assert.deepEqual(
    saved.providers.map((provider: Provider) => provider.id),
    ["cms-225506"],
  );
});

test("branch-coordinate caveats identify the affected office, not an agency primary point", () => {
  const vna = catalog.find((provider) => provider.id === "vna-care")!;
  const bilh = catalog.find((provider) => provider.id === "bilh-at-home")!;
  assert.ok(vna.lat !== null && vna.lng !== null);
  assert.ok(bilh.lat !== null && bilh.lng !== null);
  assert.match(vna.address, /250 Mount Vernon/);
  assert.match(bilh.address, /8 Presidential Way/);
  assert.ok(
    vna.limitations.some(
      (note) =>
        note.startsWith(
          "Office 100 TradeCenter, Suite G-500, Woburn, MA 01801:",
        ) && note.includes("no coordinates assigned"),
    ),
  );
  assert.ok(
    bilh.limitations.some(
      (note) =>
        note.startsWith(
          "Office 48 Dunham Ridge, Suite 2750, Beverly, MA 01915:",
        ) && note.includes("coordinates are null"),
    ),
  );
  assert.ok(
    bilh.limitations.some(
      (note) =>
        note.startsWith(
          "Office 625 Mount Auburn Street, Suite 103, Cambridge, MA 02140:",
        ) && note.includes("postal discrepancy"),
    ),
  );
  for (const provider of [vna, bilh]) {
    const coordinateNotes = provider.limitations.filter((note) =>
      /coordinates (are null|assigned|withheld)|no coordinates|postal discrepancy/.test(
        note,
      ),
    );
    assert.ok(coordinateNotes.every((note) => note.startsWith("Office ")));
  }
});

test("researched private-care services match home-care without duplicating agencies or changing their primary category", () => {
  const result = searchProviders({
    zip: "02459",
    radius: 50,
    category: "home-care",
  });
  for (const id of ["all-care", "croi-health", "abc-home-healthcare"]) {
    const provider = result.providers.find((provider) => provider.id === id);
    assert.ok(provider, id + " should match researched personal/private care");
    assert.ok(provider.searchCategories?.includes("home-care"));
    assert.notEqual(provider.category, "home-care");
    assert.equal(provider.cms, undefined);
  }
  assert.equal(
    new Set(result.providers.map((provider) => provider.id)).size,
    result.total,
  );
  assert.equal(result.excludedWithoutCoordinates, 1); // Privatus remains unlocated.
  assert.equal(
    catalog.find((provider) => provider.id === "privatus-boston")?.category,
    "staffing",
  );
  assert.ok(
    catalog
      .find((provider) => provider.id === "privatus-boston")
      ?.searchCategories?.includes("home-care"),
  );
  const all = searchProviders({ zip: "02459", radius: 50 });
  assert.ok(
    Object.values(all.categories).reduce((a, b) => a + b, 0) > all.total,
  );
  assert.throws(
    () => searchProviders({ category: "home-care", sort: "cms-rating" }),
    /only.*nursing-home/,
  );
  assert.throws(
    () => searchProviders({ category: "life-plan", sort: "cms-rating" }),
    /only.*nursing-home/,
  );
});

test("life-plan campuses remain separate from nursing units, with five street points and two sourced ZIP estimates", () => {
  const campuses = catalog.filter(
    (provider) => provider.category === "life-plan",
  );
  const researched = JSON.parse(
    readFileSync(
      new URL("../src/data/inputs/lifeplan.json", import.meta.url),
      "utf8",
    ),
  ).providers;
  const zips = JSON.parse(
    readFileSync(new URL("../src/data/ma-zips.json", import.meta.url), "utf8"),
  );
  assert.equal(campuses.length, 7);
  assert.equal(
    campuses.filter((provider) => provider.locationKind === "facility").length,
    5,
  );
  assert.deepEqual(
    campuses
      .filter((provider) => provider.locationKind === "zip")
      .map((provider) => provider.id)
      .sort(),
    ["lifeplan-brooksby-village", "lifeplan-newbridge-on-the-charles"],
  );
  for (const campus of campuses) {
    assert.equal(campus.cms, undefined);
    assert.equal(campus.searchCategories, undefined); // Care levels do not merge licensed unit identities.
    const original = researched.find(
      (record: { id: string }) => record.id === campus.id,
    );
    assert.ok(
      campus.limitations.some((note) =>
        note.includes("Campus identity is separate"),
      ),
    );
    if (campus.locationKind === "zip") {
      assert.equal(original.lat, null);
      assert.equal(original.lng, null);
      assert.equal(campus.lat, zips[campus.zip].lat);
      assert.equal(campus.lng, zips[campus.zip].lng);
      assert.match(
        campus.description,
        /Exact campus point not confirmed; distance and map use ZIP area estimate/,
      );
      assert.ok(
        campus.sources.some(
          (source) =>
            source.publisher === "U.S. Census Bureau" &&
            source.supports.includes("INTPTLAT/INTPTLONG"),
        ),
      );
      assert.ok(
        campus.limitations.some((note) => /ZIP area estimate/.test(note)),
      );
    } else {
      assert.equal(campus.lat, original.lat);
      assert.equal(campus.lng, original.lng);
    }
    for (const unit of original.relatedUnits.filter(
      (unit: { ccn?: string }) => unit.ccn,
    )) {
      const separate = catalog.find(
        (provider) => provider.id === unit.providerId,
      );
      assert.ok(separate && separate.category === "nursing-home");
      assert.equal(separate.cms?.ccn, unit.ccn);
      assert.notEqual(campus.id, separate.id);
    }
  }
  const result = searchProviders({
    zip: "02459",
    radius: 50,
    category: "life-plan",
  });
  assert.equal(result.total, 7);
  assert.ok(
    result.providers.every(
      (provider) => provider.category === "life-plan" && !provider.cms,
    ),
  );
  assert.throws(
    () => searchProviders({ category: "life-plan", sort: "cms-rating" }),
    /only.*nursing-home/,
  );
});
