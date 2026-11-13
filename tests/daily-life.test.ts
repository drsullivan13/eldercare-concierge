import test from "node:test";
import assert from "node:assert/strict";
import { dailyLife } from "../src/lib/daily-life-display";
import { getLocationResearch } from "../src/lib/location-research";
import { getProviderMarket } from "../src/lib/markets";
import type { OfferingFact } from "../src/lib/location-research-types";
import { isServiceProvider, type CareCategory } from "../src/lib/providers";

function retainedProfile(id: string) {
  const market = getProviderMarket(id)!;
  return {
    data: market.locationResearch![id],
    provider: market.providers.find((provider) => provider.id === id)!,
  };
}

test("care category defines the service setting without coordinate information", () => {
  for (const category of [
    "home-care",
    "home-health",
    "staffing",
  ] satisfies CareCategory[])
    assert.equal(isServiceProvider({ category }), true);
  for (const category of [
    "assisted-living",
    "nursing-home",
    "life-plan",
  ] satisfies CareCategory[])
    assert.equal(isServiceProvider({ category }), false);
});

test("ZIP precision does not change service agencies into residences or Brooksby into an office", () => {
  for (const [id, office] of [
    ["cms-317058", true],
    ["north-jersey-hp-hp0144800", true],
    ["lifeplan-brooksby-village", false],
  ] as const) {
    const provider = getProviderMarket(id)!.providers.find(
      (provider) => provider.id === id,
    )!;
    assert.equal(provider.locationKind, "zip");
    const data = getLocationResearch(id);
    const result = dailyLife(data, provider);
    assert.equal(result.office, office, id);
    assert.equal(result.gaps.includes("meal preparation"), office, id);
    const source = retainedProfile(
      "ma-alr-evans-park-at-newton-corner",
    ).data.sources.find((source) => source.kind === "provider")!;
    const meals = dailyLife(
      {
        facts: [
          {
            id: "published-meals",
            kind: "dining",
            sourceId: source.id,
            text: "Meal preparation is offered.",
          },
        ],
        sources: [{ ...source, kind: "provider" }],
      },
      provider,
    );
    assert.equal(
      meals.groups[0].title,
      office ? "Help with meals at home" : "Meals & dining",
      id,
    );
  }
});

test("real MA dining, outings and transport preserve complete published facts and sources", () => {
  const id = "ma-alr-evans-park-at-newton-corner";
  const { data, provider } = retainedProfile(id);
  const result = dailyLife(data, provider);
  assert.equal(result.office, false);
  assert.deepEqual(
    result.groups.map((group) => group.id),
    ["dining", "activity", "amenity", "care"],
  );
  assert.deepEqual(result.gaps, []);
  const retained = result.groups.flatMap((group) => group.facts);
  assert.ok(
    retained.some(({ fact }) =>
      fact.text.includes("modified diets and private dining"),
    ),
  );
  assert.ok(
    retained.some(({ fact }) => fact.text.includes("outings and movies")),
  );
  assert.ok(
    retained.some(({ fact }) => fact.text.includes("scheduled transportation")),
  );
  for (const { fact, source } of retained) {
    assert.equal(
      fact,
      data.facts.find((entry) => entry.id === fact.id),
    );
    assert.equal(
      source,
      data.sources.find((entry) => entry.id === fact.sourceId),
    );
    assert.notEqual(source.kind, "regulator");
    assert.ok(source.url.startsWith("https://"));
  }
});

test("real NJ listings distinguish third-party amenities, licensed setting and unresearched dining", () => {
  const id = "north-jersey-doh-nj13a012";
  const { data, provider } = retainedProfile(id);
  const result = dailyLife(data, provider);
  const facts = result.groups.flatMap((group) => group.facts);
  assert.ok(
    facts.some(
      ({ fact, source }) =>
        fact.text.includes("Housekeeping") &&
        source.publisher === "MyLivingChoice",
    ),
  );
  assert.ok(facts.every(({ fact }) => !fact.text.includes("State-licensed")));
  assert.ok(result.gaps.includes("meals & dining"));
  assert.ok(result.gaps.includes("transport arrangements"));
  assert.ok(!result.gaps.includes("activities & outings"));
});

test("home care keeps published staff roles, meal help and service schedules in office context", () => {
  const id = "abc-home-healthcare";
  const { data, provider } = retainedProfile(id);
  const result = dailyLife(data, provider);
  assert.equal(result.office, true);
  assert.ok(
    result.groups
      .find((group) => group.id === "staffing")
      ?.facts.some(({ fact }) => fact.text.includes("managed by nurses")),
  );
  assert.ok(
    result.groups
      .flatMap((group) => group.facts)
      .some(({ fact }) => fact.text.includes("one to 24 hours daily")),
  );
  assert.ok(!result.gaps.includes("meal preparation"));
});

test("published agency social-worker services do not fill the companionship gap", () => {
  const id = "cms-317058";
  const { provider } = retainedProfile(id);
  const data = getLocationResearch(id);
  const result = dailyLife(data, provider);
  const socialWorker = result.groups
    .flatMap((group) => group.facts)
    .find(({ fact }) => fact.text.includes("Medical Social Worker"));
  assert.ok(socialWorker);
  assert.equal(
    socialWorker.source.publisher,
    "Home Care & Hospice Association of NJ",
  );
  assert.deepEqual(result.gaps, [
    "meal preparation",
    "companionship & outings",
    "transport arrangements",
  ]);
});

test("social-work and staff evidence stay distinct from explicit activities and companionship", () => {
  const { data, provider } = retainedProfile("cms-317058");
  const source = data.sources.find((entry) => entry.kind === "provider")!;
  for (const [kind, text, hasGap] of [
    ["care", "Medical Social Worker services are available.", true],
    ["care", "Medical social services are available.", true],
    ["care", "Social work staff support care planning.", true],
    ["care", "Social staff help coordinate visits.", true],
    ["care", "Social activities are offered.", false],
    ["care", "Companionship is offered.", false],
    ["care", "Social work staff also offer companionship.", false],
    ["activity", "Weekly social gathering.", false],
  ] satisfies [OfferingFact["kind"], string, boolean][]) {
    const result = dailyLife(
      {
        facts: [{ id: "social-evidence", kind, text, sourceId: source.id }],
        sources: data.sources,
      },
      provider,
    );
    assert.equal(result.gaps.includes("companionship & outings"), hasGap, text);
    assert.equal(result.groups[0].facts[0].fact.text, text);
    assert.equal(result.groups[0].facts[0].source, source);
  }
});

test("licensing-only nursing records produce one evidence gap, not invented amenities or ratios", () => {
  for (const id of ["cms-315009", "cms-225002"]) {
    const { data, provider } = retainedProfile(id);
    const result = dailyLife(data, provider);
    assert.deepEqual(result.groups, []);
    assert.deepEqual(result.gaps, [
      "meals & dining",
      "activities & outings",
      "transport arrangements",
    ]);
    assert.ok(provider.cms?.totalNurseHours != null);
  }
});

test("orphaned and non-offering evidence cannot become a daily benefit; published ratios stay verbatim", () => {
  const { data, provider } = retainedProfile(
    "ma-alr-evans-park-at-newton-corner",
  );
  const source = data.sources.find((entry) => entry.kind === "provider")!;
  const facts: OfferingFact[] = [
    {
      id: "ratio",
      kind: "care",
      text: "Published daytime staffing ratio is 1:8 for this memory-care unit.",
      sourceId: source.id,
    },
    { id: "orphan", kind: "dining", text: "Three meals", sourceId: "missing" },
    { id: "price", kind: "cost", text: "$5000 monthly", sourceId: source.id },
    { id: "beds", kind: "capacity", text: "100 beds", sourceId: source.id },
  ];
  const result = dailyLife({ facts, sources: data.sources }, provider);
  assert.deepEqual(
    result.groups.flatMap((group) => group.facts).map(({ fact }) => fact.text),
    [facts[0].text],
  );
  assert.equal(result.groups[0].id, "staffing");
  assert.equal(result.publishedRatio, true);
  assert.equal(
    dailyLife(
      {
        facts: [
          { ...facts[0], text: "Staff support is advertised 24 hours daily." },
        ],
        sources: data.sources,
      },
      provider,
    ).publishedRatio,
    false,
  );
  const activity = dailyLife(
    {
      facts: [
        { ...facts[0], kind: "activity", text: "Tuesday baking at 10:30." },
      ],
      sources: data.sources,
    },
    provider,
  );
  assert.equal(activity.publishedRatio, false);
  assert.ok(!activity.gaps.includes("activities & outings"));
});
