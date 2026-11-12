import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FamilyExperienceCount,
  FamilyExperienceEvidence,
} from "../src/components/family-experience";
import {
  getFamilyExperience,
  type FacebookResearchDataset,
} from "../src/lib/facebook-research";
import { getMarket, type MarketRegistry } from "../src/lib/markets";
import {
  getLocationResearch,
  getResearchSummary,
} from "../src/lib/location-research";
import { getProvidersByIds, searchProviders } from "../src/lib/search";
import type { LocationResearch } from "../src/lib/location-research-types";

type Finding = FacebookResearchDataset["locations"][string]["findings"][number];
function finding(
  threadUrl: string,
  kind: Finding["kind"] = "resident-family",
): Finding {
  return {
    id: "synthetic",
    kind,
    threadUrl,
    sourceUrl: "https://facebook.com/groups/example/posts/999",
    sourceUrls: ["https://facebook.com/groups/example/posts/998"],
    sourceObservationIds: ["one", "two", "three"],
    relationship: null,
    summary: "Synthetic account without a sentiment assessment.",
    date: null,
    topics: [],
    limitations: ["Selected account."],
  };
}
function registryWith(findings: Finding[]): MarketRegistry {
  const market = getMarket()!;
  const provider = market.providers[0];
  return [
    {
      ...market,
      providers: [provider],
      facebookResearch: {
        schemaVersion: 1,
        runId: "synthetic",
        checkedAt: "2026-11-12",
        reviewBasis: "Editorial release for the exact provider.",
        locations: {
          [provider.id]: {
            status: "partial",
            searchedAt: null,
            foundCount: 100,
            publishedObservationCount: 90,
            withheldCount: 10,
            coverageExplanation: "Synthetic selected evidence.",
            findings,
          },
        },
      },
    },
  ];
}

test("family evidence counts eligible original threads, not findings, observations, source links or sentiment", () => {
  const registry = registryWith([
    finding(
      "https://facebook.com/groups/example/permalink/123/?comment_id=5#comment",
    ),
    finding("http://www.facebook.com/groups/example/posts/123"),
    finding("https://m.facebook.com/groups/example/posts/123/?ref=share"),
    finding("https://mbasic.facebook.com/groups/example/permalink/123/"),
    finding("https://web.facebook.com/groups/example/posts/123/"),
    finding("https://facebook.com/owner/posts/456"),
    finding(
      "https://www.facebook.com/permalink.php?story_fbid=456&id=owner&ref=share",
    ),
    finding("https://m.facebook.com/story.php?id=owner&story_fbid=456#comment"),
    finding("https://facebook.com/owner/posts/789"),
    finding("https://facebook.com/groups/other/posts/123"),
    ...(
      ["recommendation", "tour", "provider-promotion", "employment"] as const
    ).map((kind, i) =>
      finding(`https://facebook.com/groups/example/posts/${900 + i}`, kind),
    ),
  ]);
  const id = registry[0].providers[0].id;
  const before = structuredClone(registry);
  const evidence = getFamilyExperience(id, registry)!;
  assert.equal(evidence.distinctThreadCount, 4);
  assert.equal(evidence.scope, "exact-provider");
  assert.match(evidence.selectionCaveat, /not a representative survey/);
  assert.deepEqual(registry, before);
  assert.deepEqual(
    getLocationResearch(id, "2026-11-12", registry).familyExperience,
    evidence,
  );
  assert.deepEqual(
    getResearchSummary(id, registry)?.familyExperience,
    evidence,
  );
  assert.deepEqual(
    getProvidersByIds([id], undefined, registry)[0].research?.familyExperience,
    evidence,
  );
});

test("invalid or missing original threads never fall back to a valid source URL, and covered zero differs from unsearched", () => {
  const invalid = [
    "",
    "not a URL",
    "https://facebook.com/",
    "https://facebook.com/groups/example",
    "https://example.com/groups/example/posts/123",
    "https://facebook.com.evil.test/owner/posts/123",
    "https://user@facebook.com/owner/posts/123",
    "https://facebook.com:444/owner/posts/123",
    "https://facebook.com/permalink.php?id=owner",
    "https://facebook.com/story.php?id=owner&story_fbid=1&story_fbid=2",
  ];
  const missing = finding("");
  Reflect.deleteProperty(missing, "threadUrl");
  const registry = registryWith([
    ...invalid.map((url) => finding(url)),
    missing,
  ]);
  const id = registry[0].providers[0].id;
  assert.equal(getFamilyExperience(id, registry)?.distinctThreadCount, 0);
  registry[0].facebookResearch!.locations[id].findings = [];
  assert.equal(getFamilyExperience(id, registry)?.distinctThreadCount, 0);
  registry[0].facebookResearch!.locations[id].findings = [
    finding("https://facebook.com/groups/example/posts/1", "recommendation"),
    finding("https://facebook.com/groups/example/posts/1"),
  ];
  assert.equal(getFamilyExperience(id, registry)?.distinctThreadCount, 1);
  delete registry[0].facebookResearch!.locations[id];
  assert.equal(getFamilyExperience(id, registry), undefined);
  assert.equal(
    getLocationResearch(id, "2026-11-12", registry).familyExperience,
    undefined,
  );
  assert.equal(getFamilyExperience("unknown-provider", registry), undefined);
});

test("reel and watch/videos aliases count each original video once despite host, tracking and comment variations", () => {
  const registry = registryWith([
    ...["reel", "watch/videos"].flatMap((route) =>
      ["facebook.com", "www.facebook.com", "m.facebook.com"].flatMap((host) =>
        [
          `https://${host}/${route}/123`,
          `https://${host}/${route}/123/`,
          `https://${host}/${route}/123/?ref=share&comment_id=456#comment`,
        ].map((url) => finding(url)),
      ),
    ),
    finding("https://facebook.com/reel/789/"),
    finding(
      "https://www.facebook.com/watch/videos/789/?comment_id=999#comment",
    ),
    finding("https://facebook.com/reel/456/", "provider-promotion"),
  ]);
  const id = registry[0].providers[0].id;
  assert.equal(getFamilyExperience(id, registry)?.distinctThreadCount, 2);
});

test("cards show only positive thread counts, with the explanation in details", () => {
  for (const count of [0, 1, 2]) {
    const registry = registryWith(
      Array.from({ length: count }, (_, i) =>
        finding(`https://facebook.com/groups/example/posts/${100 + i}`),
      ),
    );
    const evidence = getFamilyExperience(registry[0].providers[0].id, registry);
    const card = renderToStaticMarkup(
      createElement(FamilyExperienceCount, { evidence }),
    );
    const detail = renderToStaticMarkup(
      createElement(FamilyExperienceEvidence, { evidence }),
    );
    if (!count) {
      assert.equal(card, "");
      assert.equal(detail, "");
      continue;
    }
    assert.match(
      card,
      new RegExp(
        `${count} Facebook ${count === 1 ? "thread" : "threads"} with resident or family accounts`,
      ),
    );
    assert.doesNotMatch(card, /<details|withheld/);
    assert.match(detail, /Each thread counts once/);
    assert.match(detail, /the same published score/);
  }
  assert.equal(renderToStaticMarkup(createElement(FamilyExperienceCount)), "");
});

test("experience sorting uses family evidence only for scored ties in the selected category, never numeric scoring or other orders", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-11-12T12:00:00Z"),
  });
  const registry = registryWith([]);
  const market = registry[0];
  const origin = market.zips[market.defaultZip];
  const base = market.providers[0];
  const cms = getMarket()!.providers.find((provider) => provider.cms)!.cms!;
  const specs = [
    { id: "higher", rating: 5, threads: 0 },
    { id: "near-tie", rating: 4, threads: 0 },
    { id: "far-tie", rating: 4, threads: 2 },
    { id: "lower", rating: 3, threads: 3 },
    { id: "near-unrated", rating: null, threads: 0 },
    { id: "far-unrated", rating: null, threads: 5 },
    { id: "unsearched-unrated", rating: null, threads: 0 },
  ];
  market.providers = specs.map((spec, i) => ({
    ...base,
    id: spec.id,
    name: spec.id,
    category: i === 2 ? "life-plan" : "nursing-home",
    searchCategories: ["nursing-home"],
    cms: { ...cms, overall: i % 5 },
    lat: origin.lat + i * 0.001,
    lng: origin.lng,
  }));
  market.locationResearch = {};
  const template = market.facebookResearch!.locations[base.id];
  market.facebookResearch!.locations = {};
  for (const spec of specs) {
    const sourceId = `${spec.id}-rating`;
    const record: LocationResearch = {
      providerId: spec.id,
      checkedAt: "2026-11-12",
      providerDetailsReviewed: true,
      sources: [
        {
          id: sourceId,
          url: `https://example.com/${spec.id}`,
          title: "Synthetic published average",
          publisher: "Synthetic",
          kind: "review-platform",
          checkedAt: "2026-11-12",
          publishedAt: null,
          access: "full-page",
        },
      ],
      facts: [],
      reviews: [],
      notes: [],
      availability: {
        status: "not-published",
        text: "Unknown",
        sourceId: null,
        asOf: null,
      },
      reviewAggregates: [
        {
          sourceId,
          platform: "Synthetic",
          sourceFamily: "Synthetic",
          rating: spec.rating,
          scale: 5,
          count: 20,
          asOf: null,
          scope: "consumer",
          notes: [],
        },
      ],
    };
    market.locationResearch[spec.id] = record;
    if (spec.id !== "unsearched-unrated")
      market.facebookResearch!.locations[spec.id] = {
        ...template,
        findings: Array.from({ length: spec.threads }, (_, i) =>
          finding(`https://facebook.com/groups/example/posts/${i + 1}`),
        ),
      };
  }
  delete market.locationResearch["unsearched-unrated"];
  const options = { zip: market.defaultZip, category: "nursing-home" };
  const order = (sort: string) =>
    searchProviders({ ...options, sort }, undefined, registry).providers.map(
      (p) => p.id,
    );
  assert.deepEqual(order("experience"), [
    "higher",
    "far-tie",
    "near-tie",
    "lower",
    "near-unrated",
    "far-unrated",
    "unsearched-unrated",
  ]);
  assert.deepEqual(
    order("distance"),
    specs.map((s) => s.id),
  );
  const cmsOrder = order("cms-rating");
  assert.deepEqual(cmsOrder, [
    "near-unrated",
    "lower",
    "far-tie",
    "near-tie",
    "unsearched-unrated",
    "higher",
    "far-unrated",
  ]);
  const numericBefore = market.providers.map(
    (p) => getLocationResearch(p.id, "2026-11-12", registry).experience,
  );
  market.facebookResearch = undefined;
  assert.deepEqual(
    order("experience"),
    specs.map((s) => s.id),
  );
  assert.deepEqual(
    order("distance"),
    specs.map((s) => s.id),
  );
  assert.deepEqual(order("cms-rating"), cmsOrder);
  assert.deepEqual(
    market.providers.map(
      (p) => getLocationResearch(p.id, "2026-11-12", registry).experience,
    ),
    numericBefore,
  );
  assert.throws(
    () =>
      searchProviders(
        { ...options, category: "all", sort: "experience" },
        undefined,
        registry,
      ),
    /care category/,
  );
});
