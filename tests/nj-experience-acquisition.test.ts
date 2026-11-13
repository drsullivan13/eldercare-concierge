import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { computeExperienceScore } from "../src/lib/experience-score";
import { getLocationResearch } from "../src/lib/location-research";
import { markets, type MarketRegistry } from "../src/lib/markets";
import { getResearchCoverage } from "../src/lib/research-coverage";
import {
  fingerprint,
  fingerprintBaseline,
  readBaselineFingerprint,
} from "./helpers/nj-experience-baseline";

const root = resolve(import.meta.dirname, "..");
const baselinePath = resolve(
  root,
  "tests/fixtures/nj-experience-baseline.json",
);
const baselineSha256 =
  "e30df0ca204b94561abf5dc536a5f53dd8ff77507d9dc36b56ef744555539a02";
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

function runtimeSnapshot(asOfDate: string) {
  const active = markets.filter((market) => market.state === "NJ");
  assert.ok(active.length, "The registered active NJ market must exist.");
  // Omit unrelated evidence so these application calls cannot consult social data.
  const registry: MarketRegistry = active.map((market) => ({
    id: market.id,
    label: market.label,
    state: market.state,
    defaultZip: market.defaultZip,
    zips: market.zips,
    meta: market.meta,
    providers: market.providers,
    locationResearch: market.locationResearch,
  }));
  const crosswalk = JSON.parse(
    readFileSync(
      resolve(root, "research/north-jersey/runtime/crosswalk.json"),
      "utf8",
    ),
  ) as {
    providerId: string;
    county: string;
    officialId: string;
    license: string;
    licensedName: string;
    licensedSetting: string;
  }[];
  const providers = registry
    .flatMap((market) => {
      const coverage = getResearchCoverage(asOfDate, market.id, registry);
      assert.equal(coverage.total, market.providers.length);
      return market.providers.map((provider) => {
        const research = getLocationResearch(provider.id, asOfDate, registry);
        const experience = computeExperienceScore({
          sources: research.sources,
          reviewAggregates: research.reviewAggregates,
          reviews: research.reviews,
          reviewSamples: research.reviewSamples,
          asOfDate,
        });
        assert.deepEqual(research.experience, experience);
        const row = coverage.locations.find(
          (item) => item.providerId === provider.id,
        );
        assert.ok(row);
        assert.equal(row.score, experience.value);
        const identities = crosswalk.filter(
          (item) => item.providerId === provider.id,
        );
        const counties = [
          ...new Set(identities.map((item) => item.county).filter(Boolean)),
        ];
        assert.equal(
          counties.length,
          1,
          `One official county required for ${provider.id}`,
        );
        const sourceIds = new Set([
          ...research.reviewAggregates.map((item) => item.sourceId),
          ...experience.includedSources.map((item) => item.sourceId),
          ...experience.excludedSources.map((item) => item.sourceId),
        ]);
        return {
          providerId: provider.id,
          marketId: market.id,
          name: provider.name,
          address: provider.address,
          city: provider.city,
          state: provider.state,
          zip: provider.zip,
          category: provider.category,
          locationKind: provider.locationKind ?? null,
          county: counties[0],
          officialIdentities: identities.map((item) => ({
            officialId: item.officialId,
            license: item.license,
            licensedName: item.licensedName,
            licensedSetting: item.licensedSetting,
          })),
          ccn: provider.cms?.ccn ?? null,
          coverage: {
            status: row.status,
            eligibleReviews: row.eligibleReviews,
            sourceFamilies: row.sourceFamilies,
            nextAction: row.nextAction,
          },
          experience,
          reviewAggregates: research.reviewAggregates,
          sources: research.sources
            .filter((source) => sourceIds.has(source.id))
            .map((source) => ({
              id: source.id,
              url: source.url,
              kind: source.kind,
              checkedAt: source.checkedAt,
              access: source.access,
            })),
        };
      });
    })
    .sort((a, b) => a.providerId.localeCompare(b.providerId));
  assert.equal(
    new Set(providers.map((provider) => provider.providerId)).size,
    providers.length,
  );
  const inputPaths = [
    "src/data/regional-markets.json",
    "src/lib/experience-score.ts",
    "src/lib/location-research.ts",
    "src/lib/research-coverage.ts",
    "research/north-jersey/runtime/crosswalk.json",
  ];
  return {
    schemaVersion: 1,
    asOfDate,
    scope: "all-active-registered-NJ-providers",
    inputHashes: Object.fromEntries(
      inputPaths.map((path) => [
        path,
        digest(readFileSync(resolve(root, path))),
      ]),
    ),
    runtimeProviders: providers,
  };
}

const snapshotIndex = process.argv.indexOf("--snapshot");
if (snapshotIndex !== -1) {
  process.stdout.write(
    JSON.stringify(runtimeSnapshot(process.argv[snapshotIndex + 1])),
  );
} else {
  test("full active NJ snapshot agrees with application scorer and coverage", () => {
    const snapshot = runtimeSnapshot("2026-11-13");
    const active = markets.filter((market) => market.state === "NJ");
    assert.equal(
      snapshot.runtimeProviders.length,
      active.reduce((sum, market) => sum + market.providers.length, 0),
    );
    assert.deepEqual(
      new Set(snapshot.runtimeProviders.map((provider) => provider.providerId)),
      new Set(
        active.flatMap((market) =>
          market.providers.map((provider) => provider.id),
        ),
      ),
    );
    for (const provider of snapshot.runtimeProviders) {
      assert.ok(provider.county);
      assert.ok(provider.officialIdentities.length);
      assert.ok(!Object.hasOwn(provider, "description"));
      assert.ok(!Object.keys(provider).some((key) => /facebook/i.test(key)));
      assert.equal(
        provider.coverage.eligibleReviews,
        provider.experience.reviewCount,
      );
    }
    assert.ok(
      new Set(snapshot.runtimeProviders.map((provider) => provider.county))
        .size > 2,
    );
  });

  test("bridge preserves the real sparse-evidence floor and disagreement rules", () => {
    const snapshot = runtimeSnapshot("2026-11-13");
    for (const provider of snapshot.runtimeProviders) {
      if (provider.experience.value === null) continue;
      const sources = provider.experience.includedSources;
      assert.ok(
        sources.some((source) => source.count >= 30) ||
          (sources.reduce((sum, source) => sum + source.count, 0) >= 10 &&
            sources.filter((source) => source.count >= 5).length >= 2),
      );
      assert.notEqual(
        provider.experience.publicationStatus,
        "sources-disagree",
      );
    }
    assert.throws(() => runtimeSnapshot("not-a-date"), /asOfDate/);
  });

  test("acquisition preserves every baseline aggregate, source and existing score", () => {
    const baseline = readBaselineFingerprint(baselinePath, baselineSha256);
    const current = runtimeSnapshot(baseline.asOfDate);
    assert.deepEqual(
      current.runtimeProviders.map((provider) => provider.providerId).sort(),
      Object.keys(baseline.providers).sort(),
    );
    assert.equal(
      Object.values(baseline.providers).filter(
        (provider) => provider.experience,
      ).length,
      56,
    );
    const byId = new Map(
      current.runtimeProviders.map((p) => [p.providerId, p]),
    );
    for (const [providerId, before] of Object.entries(baseline.providers)) {
      const after = byId.get(providerId);
      assert.ok(after);
      for (const [sourceId, hash] of Object.entries(before.aggregates ?? {})) {
        const aggregate: (typeof after.reviewAggregates)[number] | undefined =
          after.reviewAggregates.find((row) => row.sourceId === sourceId);
        assert.ok(aggregate, `${providerId} lost aggregate ${sourceId}`);
        assert.equal(
          fingerprint(aggregate),
          hash,
          `${providerId} aggregate ${sourceId}`,
        );
      }
      for (const [sourceId, hash] of Object.entries(before.sources ?? {})) {
        const source: (typeof after.sources)[number] | undefined =
          after.sources.find((row) => row.id === sourceId);
        assert.ok(source, `${providerId} lost source ${sourceId}`);
        assert.equal(
          fingerprint(source),
          hash,
          `${providerId} source ${sourceId}`,
        );
      }
      if (before.experience) {
        assert.equal(
          fingerprint(after.experience),
          before.experience,
          `${providerId} score diagnostics changed`,
        );
      }
    }
  });

  test("public baseline fails closed for missing or corrupted snapshots", () => {
    const directory = mkdtempSync(join(tmpdir(), "nj-experience-baseline-"));
    const path = join(directory, "baseline.json");
    try {
      assert.throws(() => readBaselineFingerprint(path, baselineSha256), {
        code: "ENOENT",
      });
      const baseline = readBaselineFingerprint(baselinePath, baselineSha256);
      delete baseline.providers[Object.keys(baseline.providers)[0]];
      for (const raw of ["", "{", JSON.stringify(baseline)]) {
        writeFileSync(path, raw);
        assert.throws(
          () => readBaselineFingerprint(path, baselineSha256),
          /Public baseline fingerprint changed/,
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("fingerprints preserve complete JSON values without publishing diagnostics", () => {
    assert.equal(fingerprint({ b: 2, a: 1 }), digest('{"a":1,"b":2}'));
    assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
    const provider = {
      providerId: "baseline-provider",
      experience: { value: 8, diagnostics: { weights: [1, 2] } },
      reviewAggregates: [{ sourceId: "aggregate", rating: 4, count: 30 }],
      sources: [
        {
          id: "aggregate",
          url: "https://example.com",
          checkedAt: "2026-11-13",
        },
      ],
    };
    const raw = JSON.stringify({
      asOfDate: "2026-11-13",
      runtimeProviders: [
        provider,
        {
          providerId: "unscored",
          experience: { value: null },
          reviewAggregates: [],
          sources: [],
        },
      ],
    });
    const baseline = fingerprintBaseline(raw);
    assert.equal(baseline.inventorySha256, digest(raw));
    assert.deepEqual(baseline.providers, {
      "baseline-provider": {
        experience: fingerprint(provider.experience),
        aggregates: { aggregate: fingerprint(provider.reviewAggregates[0]) },
        sources: { aggregate: fingerprint(provider.sources[0]) },
      },
      unscored: {},
    });
    assert.notEqual(
      baseline.providers["baseline-provider"].experience,
      fingerprint({ ...provider.experience, value: 8.1 }),
    );
    assert.notEqual(
      baseline.providers["baseline-provider"].experience,
      fingerprint({ ...provider.experience, diagnostics: { weights: [2, 1] } }),
    );
    assert.notEqual(
      baseline.providers["baseline-provider"].aggregates?.aggregate,
      fingerprint({ ...provider.reviewAggregates[0], count: 31 }),
    );
    assert.notEqual(
      baseline.providers["baseline-provider"].sources?.aggregate,
      fingerprint({ ...provider.sources[0], checkedAt: "2026-11-14" }),
    );
    assert.ok(!JSON.stringify(baseline).includes("diagnostics"));
    assert.ok(!JSON.stringify(baseline).includes("https://"));
  });

  test("reviewed aggregates and complete windows reach the actual runtime", () => {
    const decisions = JSON.parse(
      readFileSync(
        resolve(
          root,
          "research/north-jersey/experience-acquisition/integration/reviewed-mylivingchoice.json",
        ),
        "utf8",
      ),
    ) as {
      assessmentDate: string;
      approvals: [
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        number,
        [
          string,
          string | null,
          "positive" | "negative" | "mixed" | "neutral",
        ][],
      ][];
    };
    for (const [
      slug,
      providerId,
      ,
      ,
      ,
      ,
      rating,
      count,
      rows,
    ] of decisions.approvals) {
      const research = getLocationResearch(
        providerId,
        decisions.assessmentDate,
      );
      const sourceId = `review-release-mlc-acquisition-${slug}`;
      const aggregate = research.reviewAggregates.find(
        (a) => a.sourceId === sourceId,
      );
      assert.ok(aggregate);
      assert.equal(aggregate.rating, rating);
      assert.equal(aggregate.count, count);
      assert.equal(aggregate.sourceFamily, "google");
      const sample = research.reviewSamples?.find(
        (s) => s.sourceId === sourceId,
      );
      assert.ok(sample);
      assert.equal(sample.visibleCount, rows.length);
      assert.deepEqual(
        sample.observations,
        rows.map(([id, date, sentiment]) => ({
          id: `mlc-google-${id}`,
          date,
          sentiment,
        })),
      );
      assert.equal(research.experience.value, rating * 2);
    }
  });
}
