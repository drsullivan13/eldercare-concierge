import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import regionalMarkets from "../src/data/regional-markets.json";
import release from "../src/data/home-care-reviews.json";
import baseCatalog from "../src/data/review-catalog.json";
import { mergeHomeCareReviews } from "../src/lib/home-care-reviews";
import { markets, type MarketSnapshot } from "../src/lib/markets";
import {
  getLocationResearch,
  getResearchSummary,
} from "../src/lib/location-research";
import { getReviewCatalog } from "../src/lib/review-catalog";
import {
  individualReviews,
  reviewAccountCounts,
} from "../src/lib/individual-reviews";
import { searchProviders } from "../src/lib/search";
import { GET as reviewGET } from "../src/app/api/reviews/route";

const root = resolve(import.meta.dirname, "..");
const pid = "north-jersey-hp-hp9999999";
const syntheticUrl =
  "https://www.mylivingchoice.com/property/synthetic-test-office";
const area = "research/north-jersey/home-care-reviews";
const asOf = "2026-11-14";

function json(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function command(cwd: string, program: string, args: string[]) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8_000_000,
  });
  assert.equal(
    result.status,
    0,
    `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

function temporaryApp(t: { after: (callback: () => void) => void }) {
  const path = mkdtempSync(
    join(tmpdir(), "harbor-home-care-runtime-synthetic-"),
  );
  t.after(() => rmSync(path, { recursive: true, force: true }));
  command(root, "python3", [
    "-B",
    join(root, "scripts/regions/home-care-reviews-test.py"),
    "--fixture",
    path,
  ]);
  symlinkSync(join(root, "node_modules"), join(path, "node_modules"), "dir");
  cpSync(join(root, "src/lib"), join(path, "src/lib"), { recursive: true });
  cpSync(join(root, "src/app/api"), join(path, "src/app/api"), {
    recursive: true,
  });
  cpSync(join(root, "tsconfig.json"), join(path, "tsconfig.json"));
  writeJson(
    join(
      path,
      "research/north-jersey/home-care-review-links/portal-links.json",
    ),
    { schemaVersion: 1, links: [] },
  );
  for (const name of readdirSync(join(root, "src/data"))) {
    const target = join(path, "src/data", name);
    if (
      name.endsWith(".json") &&
      !existsSync(target) &&
      name !== "home-care-reviews.json"
    )
      symlinkSync(join(root, "src/data", name), target);
  }
  const catalogPath = join(path, "src/data/review-catalog.json");
  rmSync(catalogPath);
  writeJson(catalogPath, {});
  mkdirSync(join(path, "scripts/regions"), { recursive: true });
  cpSync(
    join(root, "scripts/regions/home-care-reviews.py"),
    join(path, "scripts/regions/home-care-reviews.py"),
  );
  return path;
}

function publish(
  path: string,
  batch = json(join(path, "synthetic-input.json")),
) {
  writeJson(join(path, "synthetic-input.json"), batch);
  command(root, "python3", [
    "-B",
    join(root, "scripts/regions/home-care-reviews.py"),
    "--root",
    path,
    "--input",
    join(path, "synthetic-input.json"),
  ]);
  return json(join(path, "src/data/home-care-reviews.json"));
}

const applicationProbe = `
const assert = require("node:assert/strict");
const { markets, createMarketRegistry } = require("./src/lib/markets");
const { mergeHomeCareReviews } = require("./src/lib/home-care-reviews");
const { getLocationResearch, getResearchSummary } = require("./src/lib/location-research");
const { getReviewCatalog } = require("./src/lib/review-catalog");
const { individualReviews, reviewAccountCounts } = require("./src/lib/individual-reviews");
const { searchProviders } = require("./src/lib/search");
const { GET: reviewGET } = require("./src/app/api/reviews/route");
const { GET: researchGET } = require("./src/app/api/research/route");
const raw = require("./src/data/regional-markets.json");
const supplemental = require("./src/data/home-care-reviews.json");
const baseCatalog = require("./src/data/review-catalog.json");
const pid = "${pid}";
const research = getLocationResearch(pid, "${asOf}");
const catalog = getReviewCatalog(pid);
const individual = individualReviews(research, catalog);
const counts = reviewAccountCounts(individual.accounts);
const summary = getResearchSummary(pid);
assert.deepEqual(summary.individualReviews, counts);
const search = searchProviders({zip:"07960", category:"home-care", sort:"experience"});
assert.equal(search.providers.length, 1);
assert.deepEqual(search.providers[0].research.individualReviews, counts);
const custom = createMarketRegistry(structuredClone(raw));
assert.equal(getLocationResearch(pid, "${asOf}", custom).reviewAggregates.length, 0);
assert.deepEqual(getResearchSummary(pid, custom).individualReviews, {total:0, withText:0});
const merged = mergeHomeCareReviews(raw, baseCatalog, supplemental);
const twice = mergeHomeCareReviews(merged.snapshots, merged.catalogs, supplemental);
assert.deepEqual(twice, merged);
const original = raw[0].locationResearch[pid];
for (const key of Object.keys(original).filter(k => !["sources","reviewAggregates","reviews","reviewSamples","notes"].includes(k)))
 assert.deepEqual(research[key], original[key], key);
assert.deepEqual(markets.find(m => m.id === "north-jersey").providers, raw[0].providers);
Promise.all([
 reviewGET(new Request("https://harbor.example/api/reviews?id=" + pid)).json(),
 researchGET(new Request("https://harbor.example/api/research?id=" + pid)).json()
]).then(([reviewsApi,researchApi]) => {
 assert.equal(reviewsApi.accounts.length, counts.total);
 assert.deepEqual(reviewsApi.sources.map(s => [s.url,s.retainedCount]),
                  catalog.sources.map(s => [s.url,s.retainedCount]));
 assert.equal(researchApi.experience.value,research.experience.value);
 assert.equal(researchApi.experience.reviewCount,research.experience.reviewCount);
 assert.ok(!JSON.stringify(researchApi).includes("sourceFamily"));
 process.stdout.write(JSON.stringify({research,catalog,individual,counts,summary,search:search.providers[0],reviewsApi,researchApi}));
}).catch(error => { console.error(error); process.exitCode = 1; });
`;

function probe(path: string) {
  return JSON.parse(
    command(path, process.execPath, [
      "--import",
      "tsx",
      "-e",
      applicationProbe,
    ]),
  );
}

test("published review evidence is present in the office catalog and leaves other offices unchanged", async () => {
  const raw = regionalMarkets.find((market) => market.id === "north-jersey")!;
  const published = markets.find((market) => market.id === raw.id)!;
  assert.deepEqual(published.providers, raw.providers);
  for (const provider of raw.providers.filter(
    (entry) => entry.category === "home-care",
  )) {
    const catalog = getReviewCatalog(provider.id);
    const original =
      baseCatalog[provider.id as keyof typeof baseCatalog] ?? null;
    if (!Object.hasOwn(release.providers, provider.id)) {
      assert.deepEqual(catalog, original);
      continue;
    }
    const patch =
      release.providers[provider.id as keyof typeof release.providers];
    const result = await reviewGET(
      new Request(`https://harbor.example/api/reviews?id=${provider.id}`),
    ).json();
    for (const account of patch.catalog.accounts) {
      assert.ok(
        result.accounts.some(
          (item: { url: string; summary: string }) =>
            item.url === account.url && item.summary === account.summary,
        ),
      );
    }
    const detail = getLocationResearch(provider.id, asOf);
    assert.deepEqual(
      getResearchSummary(provider.id)?.individualReviews,
      reviewAccountCounts(individualReviews(detail, catalog).accounts),
    );
    if (original) {
      for (const prior of original.accounts) {
        assert.ok(
          result.accounts.some(
            (item: { url: string }) => item.url === prior.url,
          ),
        );
      }
    }
  }
});

test("sparse and withheld panels can have readable family accounts", async () => {
  const sparse = "north-jersey-hp-hp0413400";
  const detail = getLocationResearch(sparse, asOf);
  assert.equal(detail.experience.value, null);
  assert.equal(detail.experience.reviewCount, 13);
  const result = await reviewGET(
    new Request(`https://harbor.example/api/reviews?id=${sparse}`),
  ).json();
  assert.ok(
    result.accounts.some(
      (record: { relationship: string; summary: string }) =>
        record.relationship === "family" && Boolean(record.summary),
    ),
  );
  const rated = searchProviders({
    zip: "07666",
    radius: 5,
    category: "home-care",
    sort: "experience",
  });
  assert.equal(
    rated.providers.find(
      (provider) => provider.id === "north-jersey-hp-hp0256900",
    )?.research?.experience.value,
    9.6,
  );
});

test("external office profiles can accompany an unrated listing without creating accounts or a score", async () => {
  const id = "north-jersey-hp-hp0119000";
  const result = await reviewGET(
    new Request(`https://harbor.example/api/reviews?id=${id}`),
  ).json();
  assert.ok(
    result.externalProfiles.some(
      (link: { publisher: string }) => link.publisher === "Yelp",
    ),
  );
  assert.equal(result.accounts.length, 0);
  assert.equal(getLocationResearch(id, asOf).experience.value, null);
  const overlap = "north-jersey-hp-hp0058900";
  const withAccounts = await reviewGET(
    new Request(`https://harbor.example/api/reviews?id=${overlap}`),
  ).json();
  assert.ok(
    withAccounts.accounts.some(
      (account: { summary: string }) => account.summary,
    ),
  );
  assert.deepEqual(
    new Set(
      withAccounts.externalProfiles.map(
        (link: { publisher: string }) => link.publisher,
      ),
    ),
    new Set(["Caring.com", "Google Maps"]),
  );
  assert.equal(getLocationResearch(overlap, asOf).experience.value, null);
});

test("accepted synthetic CLI evidence reaches default search, research, catalog and both APIs", (t) => {
  const path = temporaryApp(t);
  const output = publish(path);
  const result = probe(path);
  assert.equal(result.research.experience.value, null);
  assert.equal(result.research.experience.reviewCount, 6);
  assert.equal(
    result.research.experience.publicationStatus,
    "insufficient-evidence",
  );
  assert.deepEqual(result.counts, { total: 1, withText: 0 });
  assert.equal(result.catalog.accounts[0].date, "2026-10");
  assert.equal(result.catalog.accounts[0].datePrecision, "month");
  assert.equal(result.catalog.sources[0].url, syntheticUrl);
  assert.equal(result.catalog.sources[0].retainedCount, 1);
  assert.equal(result.research.sources[0].url, syntheticUrl);
  assert.equal(output.providers[pid].reviews.length, 0);
  assert.ok(!JSON.stringify(result).includes("SYNTHETIC protected narrative"));
  const decisions = json(join(path, area, "decisions.json"));
  assert.equal(
    decisions[0].originalUrl,
    "https://www.google.com/maps?cid=9999999",
  );
  assert.notEqual(decisions[0].originalUrl, decisions[0].canonicalUrl);
  rmSync(join(path, "synthetic-input.json"));
  command(root, "python3", [
    "-B",
    join(root, "scripts/regions/home-care-reviews.py"),
    "--root",
    path,
    "--check",
  ]);
});

test("approved original summary upgrades an overlapping link-only account without duplicating it", (t) => {
  const path = temporaryApp(t);
  const batch = json(join(path, "synthetic-input.json"));
  const obs = batch.observations[0];
  const sourceId = "synthetic-existing-catalog-source";
  writeJson(join(path, "src/data/review-catalog.json"), {
    [pid]: {
      providerId: pid,
      checkedAt: asOf,
      accounts: [
        {
          id: "synthetic-existing-account",
          sourceId,
          sourceFamily: "google",
          url: obs.accounts[0].url,
          date: "2026-10",
          datePrecision: "month",
          relationship: "unknown",
          excerpt: null,
          summary: null,
          representation: "link-only",
          provenance: "new-public-page",
          nativeReviewId: obs.accounts[0].nativeReviewId,
        },
        {
          id: "synthetic-other-existing-account",
          sourceId,
          sourceFamily: "google",
          url: obs.accounts[0].url.replace(
            "CiSyntheticAccount",
            "ChSyntheticOther",
          ),
          date: "2023-08",
          datePrecision: "month",
          relationship: "unknown",
          excerpt: null,
          summary: null,
          representation: "link-only",
          provenance: "new-public-page",
        },
      ],
      sources: [
        {
          id: sourceId,
          publisher: "Synthetic MyLivingChoice",
          sourceFamily: "google",
          url: syntheticUrl,
          reportedCount: 6,
          retainedCount: 2,
          previouslyUnseenCount: 2,
          pagesChecked: 1,
          coverage: "exhausted-visible-pages",
          stopReason: "Synthetic prior check",
        },
      ],
      notes: [],
    },
  });
  obs.textRights = {
    decision: "original-summary",
    assessedAt: asOf,
    basis: "Synthetic original summary permission",
    evidenceSha256: "c".repeat(64),
  };
  obs.accounts[0].privacyReviewed = true;
  obs.accounts[0].text =
    "Synthetic family account described responsive scheduling.";
  publish(path, batch);
  const result = probe(path);
  assert.deepEqual(result.counts, { total: 2, withText: 1 });
  assert.equal(result.catalog.accounts[0].id, "synthetic-existing-account");
  assert.equal(
    result.individual.accounts[0].representation,
    "original-summary",
  );
  assert.equal(result.catalog.sources.length, 1);
  assert.equal(result.catalog.sources[0].id, sourceId);
  assert.equal(result.catalog.sources[0].retainedCount, 2);
  assert.equal(result.research.experience.reviewCount, 6);
});

test("the existing scorer withholds a headline when the complete synthetic visible window conflicts", (t) => {
  const path = temporaryApp(t);
  const batch = json(join(path, "synthetic-input.json"));
  const obs = batch.observations[0];
  obs.aggregate.count = 30;
  obs.window.visibleCount = 4;
  obs.window.observations = [
    ...obs.window.observations,
    ...[1, 2, 3].map((n) => ({
      id: `synthetic-negative-${n}`,
      date: "2026-10",
      datePrecision: "month",
      sentiment: "negative",
    })),
  ];
  publish(path, batch);
  const result = probe(path);
  assert.equal(result.research.experience.value, null);
  assert.equal(
    result.research.experience.publicationStatus,
    "sources-disagree",
  );
  assert.equal(result.research.experience.sampleDiagnostics[0].negative, 3);
  assert.equal(result.research.reviewAggregates[0].rating, 5);
  assert.equal(result.research.reviewAggregates[0].count, 30);
});

test("different pages in the same canonical family contribute once through the unchanged scorer", (t) => {
  const path = temporaryApp(t);
  const batch = json(join(path, "synthetic-input.json"));
  const second = structuredClone(batch.observations[0]);
  second.id = "synthetic-syndicated-duplicate";
  second.checkedUrl =
    second.canonicalUrl =
    second.effectiveUrl =
      syntheticUrl + "-second-page";
  second.identity.url = second.canonicalUrl;
  second.sourceFamily = "google";
  second.aggregate.count = 8;
  second.accounts = [];
  batch.observations.push(second);
  publish(path, batch);
  const result = probe(path);
  assert.equal(result.research.reviewAggregates.length, 2);
  assert.equal(result.research.experience.independentSourceCount, 1);
  assert.equal(result.research.experience.reviewCount, 8);
  assert.equal(result.research.experience.value, null);
  assert.equal(result.research.experience.excludedSources.length, 1);
});

test("accounts alone never create an average or a score", (t) => {
  const path = temporaryApp(t);
  const batch = json(join(path, "synthetic-input.json"));
  batch.observations[0].aggregate = null;
  publish(path, batch);
  const result = probe(path);
  assert.equal(result.research.experience.value, null);
  assert.equal(result.research.experience.reviewCount, 0);
  assert.equal(result.catalog.sources[0].reportedCount, null);
  assert.deepEqual(result.counts, { total: 1, withText: 0 });
});

test("a previously unresearched office receives reviews without changing its missing facts or availability", (t) => {
  const path = temporaryApp(t);
  const raw = json(join(path, "src/data/regional-markets.json"));
  delete raw[0].locationResearch[pid];
  writeJson(join(path, "src/data/regional-markets.json"), raw);
  publish(path);
  const result = JSON.parse(
    command(path, process.execPath, [
      "--import",
      "tsx",
      "-e",
      `
    const { getLocationResearch, getResearchSummary } = require("./src/lib/location-research");
    const { getReviewCatalog } = require("./src/lib/review-catalog");
    const { individualReviews } = require("./src/lib/individual-reviews");
    const research = getLocationResearch("${pid}", "${asOf}");
    process.stdout.write(JSON.stringify({research, summary:getResearchSummary("${pid}"),
      individual:individualReviews(research,getReviewCatalog("${pid}"))}));
  `,
    ]),
  );
  assert.equal(result.research.checkedAt, null);
  assert.equal(result.research.providerDetailsReviewed, false);
  assert.deepEqual(result.research.facts, []);
  assert.equal(result.research.availability.status, "not-published");
  assert.equal(result.research.availability.sourceId, null);
  assert.equal(result.research.experience.value, null);
  assert.equal(result.individual.accounts.length, 1);
  assert.deepEqual(result.summary.individualReviews, { total: 1, withText: 0 });
});

test("the merge rejects identity and ID conflicts and preserves unrelated object identity", (t) => {
  const path = temporaryApp(t);
  const supplemental = publish(path);
  const raw = json(
    join(path, "src/data/regional-markets.json"),
  ) as MarketSnapshot[];
  const unrelated = structuredClone(raw[0].locationResearch![pid]);
  raw[0].locationResearch!["unrelated-record"] = unrelated;
  const result = mergeHomeCareReviews(raw, {}, supplemental);
  assert.strictEqual(result.snapshots[0].providers, raw[0].providers);
  assert.strictEqual(
    result.snapshots[0].locationResearch!["unrelated-record"],
    unrelated,
  );
  assert.equal(raw[0].locationResearch![pid].sources.length, 0);
  const wrongIdentity = structuredClone(supplemental);
  wrongIdentity.providers[pid].identity.address = "Wrong office";
  assert.throws(
    () => mergeHomeCareReviews(raw, {}, wrongIdentity),
    /identity drift/,
  );
  const unknown = structuredClone(supplemental);
  unknown.providers["north-jersey-hp-hp0000000"] = unknown.providers[pid];
  delete unknown.providers[pid];
  assert.throws(
    () => mergeHomeCareReviews(raw, {}, unknown),
    /unpublished provider/,
  );
  const conflicting = structuredClone(supplemental);
  conflicting.providers[pid].sources[0].publisher = "Conflicting receipt";
  assert.throws(
    () => mergeHomeCareReviews(result.snapshots, result.catalogs, conflicting),
    /Conflicting home-care review release ID/,
  );
});
