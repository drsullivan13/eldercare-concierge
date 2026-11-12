import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "../src/lib/providers";
import type { LocationResearch } from "../src/lib/location-research-types";
import type { FacebookResearchDataset } from "../src/lib/facebook-research";
import homeHealth from "../src/data/home-health-evidence.json";
import inspections from "../src/data/inspection-history.json";
import { createMarketRegistry } from "../src/lib/markets";
import { getHomeHealthEvidence } from "../src/lib/home-health";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builder = join(root, "scripts/regions/build-region.py");
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const asOf = "2026-11-12";
const source = {
  title: "Fixture directory",
  publisher: "Fixture publisher",
  url: "https://example.test/directory",
  kind: "regulatory" as const,
  checkedAt: asOf,
  supports: "Fixture identity and office address",
};

function provider(id = "north-jersey-example"): Provider {
  return {
    id,
    name: "Fixture provider",
    category: "assisted-living",
    address: "1 Example Street",
    city: "Morristown",
    state: "NJ",
    zip: "07960",
    lat: 40.79,
    lng: -74.48,
    locationKind: "facility",
    description: "Test fixture only",
    services: [],
    officialRecord: true,
    sources: [source],
    warnings: [],
    limitations: [],
  };
}

function cmsProvider(ccn = "315001"): Provider {
  return {
    ...provider(`cms-${ccn}`),
    category: "nursing-home",
    cms: {
      ccn,
      overall: null,
      inspections: null,
      staffing: null,
      quality: null,
      totalNurseHours: null,
      rnHours: null,
      turnover: null,
      fines: null,
      fineAmount: null,
      paymentDenials: null,
      healthDeficiencies: null,
      abuse: false,
      specialFocus: null,
      dataAsOf: asOf,
    },
  };
}

function research(providerId = "north-jersey-example"): LocationResearch {
  return {
    providerId,
    checkedAt: asOf,
    providerDetailsReviewed: true,
    sources: [
      {
        id: "directory",
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        kind: "regulator",
        checkedAt: asOf,
        publishedAt: null,
        access: "full-page",
      },
    ],
    facts: [
      { id: "care", kind: "care", text: "Fixture care", sourceId: "directory" },
    ],
    availability: {
      status: "not-published",
      text: "Not checked for openings",
      sourceId: null,
      asOf: null,
    },
    reviewAggregates: [],
    reviews: [],
    notes: [],
  };
}

function facebook(): FacebookResearchDataset {
  return {
    schemaVersion: 1,
    runId: "fixture",
    checkedAt: asOf,
    reviewBasis: "Synthetic test fixture",
    locations: {
      "north-jersey-example": {
        status: "findings-available",
        searchedAt: asOf,
        foundCount: 1,
        publishedObservationCount: 1,
        withheldCount: 0,
        coverageExplanation: "Test fixture only",
        findings: [
          {
            id: "finding",
            sourceObservationIds: ["observation"],
            kind: "recommendation",
            relationship: null,
            summary: "Test fixture only",
            date: null,
            sourceUrl: "https://example.test/post",
            threadUrl: "https://example.test/thread",
            topics: [],
            limitations: ["Not scored"],
          },
        ],
      },
    },
  };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "harbor-region-build-"));
  const output = join(dir, "output.json");
  const manifestPath = join(dir, "runtime-manifest.json");
  const data: Record<string, unknown> = {
    zips: { "07960": { city: "Morristown", lat: 40.79, lng: -74.48 } },
    providers: [provider()],
    meta: {
      asOf,
      catalogTotal: 1,
      categories: { "assisted-living": 1 },
      geography: { method: "Fixture ZIP membership, not service coverage" },
    },
  };
  const entry = {
    id: "north-jersey",
    label: "North Jersey",
    state: "NJ",
    defaultZip: "07960",
    review: {
      status: "reviewed",
      reviewedAt: asOf,
      reviewer: "Fixture reviewer",
    },
    artifacts: {} as Record<
      string,
      { path: string; sha256: string; count: number }
    >,
  };
  const manifest = { schemaVersion: 1, markets: [entry] };
  function save() {
    entry.artifacts = {};
    for (const [key, value] of Object.entries(data)) {
      const bytes = JSON.stringify(value);
      const path = `${key}.json`;
      writeFileSync(join(dir, path), bytes);
      const count =
        key === "meta"
          ? Object(value).catalogTotal
          : key === "facebookResearch"
            ? Object.keys(Object(value).locations).length
            : key === "inspectionHistory"
              ? Object.keys(Object(value).facilities).length
              : key === "homeHealthEvidence"
                ? Object(value).agencies.length
                : Array.isArray(value)
                  ? value.length
                  : Object.keys(Object(value)).length;
      entry.artifacts[key] = { path, sha256: digest(bytes), count };
    }
    writeFileSync(manifestPath, JSON.stringify(manifest));
  }
  save();
  return {
    dir,
    output,
    manifestPath,
    data,
    entry,
    manifest,
    save,
    run(...args: string[]) {
      return spawnSync(
        "python3",
        [
          "-B",
          builder,
          "--manifest",
          manifestPath,
          "--output",
          output,
          ...args,
        ],
        { cwd: dir, encoding: "utf8" },
      );
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

type Fixture = ReturnType<typeof fixture>;

function unchangedOnFailure(f: Fixture, expected: RegExp) {
  const previous = '{"retained":"previous output"}\n';
  writeFileSync(f.output, previous);
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, expected);
  assert.equal(readFileSync(f.output, "utf8"), previous);
  assert.equal(
    readdirSync(f.dir).some((file) => file.startsWith(".output.json.")),
    false,
  );
}

test("regional CLI emits the agreed array, preserves facts, and is deterministic", () => {
  const f = fixture();
  try {
    f.data.providers = [provider("north-jersey-z"), provider("north-jersey-a")];
    f.data.meta = {
      asOf,
      catalogTotal: 2,
      categories: { "assisted-living": 2 },
    };
    f.save();
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const first = readFileSync(f.output, "utf8");
    const markets = JSON.parse(first);
    assert.equal(markets.length, 1);
    assert.deepEqual(markets[0], {
      id: "north-jersey",
      label: "North Jersey",
      state: "NJ",
      defaultZip: "07960",
      ...f.data,
      providers: [provider("north-jersey-a"), provider("north-jersey-z")],
    });
    f.data.providers = [provider("north-jersey-a"), provider("north-jersey-z")];
    f.save();
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(f.output, "utf8"), first);
    assert.equal(f.run("--check").status, 0);
    writeFileSync(f.output, "[]\n");
    assert.equal(f.run("--check").status, 1);
    assert.equal(readFileSync(f.output, "utf8"), "[]\n");
  } finally {
    f.close();
  }
});

test("regional CLI retains location research and Facebook evidence without scoring or merging", () => {
  const f = fixture();
  try {
    f.data.locationResearch = { "north-jersey-example": research() };
    f.data.facebookResearch = facebook();
    f.save();
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const market = JSON.parse(readFileSync(f.output, "utf8"))[0];
    assert.deepEqual(market.locationResearch, f.data.locationResearch);
    assert.deepEqual(market.facebookResearch, f.data.facebookResearch);
    assert.equal(market.providers[0].research, undefined);
  } finally {
    f.close();
  }
});

function evidenceFixture() {
  const f = fixture();
  const nursing = cmsProvider();
  const home: Provider = {
    ...provider("cms-317001"),
    category: "home-health",
  };
  f.data.providers = [nursing, home];
  f.data.meta = {
    asOf,
    catalogTotal: 2,
    categories: { "nursing-home": 1, "home-health": 1 },
  };
  f.data.inspectionHistory = {
    ...inspections,
    facilities: { "315001": Object.values(inspections.facilities)[0] },
  };
  const agency = {
    ...homeHealth.agencies[0],
    ccn: "317001",
    organizationId: "cms-317001",
    cmsAddress: {
      ...homeHealth.agencies[0].cmsAddress,
      state: "NJ",
      zip: "07960",
    },
  };
  f.data.homeHealthEvidence = {
    ...homeHealth,
    agencies: [agency],
    patientExperienceComparators: {
      state: {
        ...homeHealth.patientExperienceComparators.massachusetts,
        code: "NJ",
        label: "New Jersey",
      },
      national: homeHealth.patientExperienceComparators.national,
    },
  };
  f.save();
  return { ...f, nursing, home, agency };
}

test("regional CLI validates retained inspection and home-health shapes with exact CMS joins", () => {
  const f = evidenceFixture();
  const { nursing, home, agency } = f;
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const market = JSON.parse(readFileSync(f.output, "utf8"))[0];
    assert.deepEqual(market.homeHealthEvidence, f.data.homeHealthEvidence);
    assert.deepEqual(market.inspectionHistory, f.data.inspectionHistory);
    assert.equal(
      market.providers.find((p: Provider) => p.id === home.id).cms,
      undefined,
    );
    const comparisons = Object(
      f.data.homeHealthEvidence,
    ).patientExperienceComparators;
    comparisons.state.code = "MA";
    f.save();
    unchangedOnFailure(f, /comparator state mismatch/);
    comparisons.state.code = "NJ";
    comparisons.massachusetts =
      homeHealth.patientExperienceComparators.massachusetts;
    f.save();
    unchangedOnFailure(f, /cross-market home-health comparator/);
    agency.ccn = "317002";
    delete comparisons.massachusetts;
    f.save();
    unchangedOnFailure(f, /home-health CCN identity mismatch/);
    agency.ccn = "317001";
    agency.organizationId = nursing.id;
    f.save();
    unchangedOnFailure(f, /cross-market home-health join/);
  } finally {
    f.close();
  }
});

for (const form of ["state", "market", "missing"] as const) {
  test(`builder-emitted home-health evidence roundtrips ${form} comparator without MA fallback`, () => {
    const f = evidenceFixture();
    try {
      const comparisons = Object(
        f.data.homeHealthEvidence,
      ).patientExperienceComparators;
      const state = comparisons.state;
      if (form !== "state") delete comparisons.state;
      if (form === "market")
        comparisons["north-jersey"] = {
          ...homeHealth.patientExperienceComparators.massachusetts,
        };
      f.save();
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      const evidence = getHomeHealthEvidence(
        f.home.id,
        createMarketRegistry(JSON.parse(readFileSync(f.output, "utf8"))),
      );
      assert.deepEqual(evidence.agencies, [f.agency]);
      assert.deepEqual(evidence.patientExperienceComparators, {
        national: homeHealth.patientExperienceComparators.national,
        ...(form === "missing" ? {} : { state }),
      });
      if (form !== "missing") {
        assert.equal(evidence.patientExperienceComparators.state?.code, "NJ");
        assert.equal(
          evidence.patientExperienceComparators.state?.sourceFile,
          state.sourceFile,
        );
      }
    } finally {
      f.close();
    }
  });
}

const invalidInputs: [string, (f: Fixture) => void, RegExp][] = [
  [
    "unsupported market ID",
    (f) => {
      f.entry.id = "central-jersey";
    },
    /unsupported market identity/,
  ],
  [
    "unsupported market state pair",
    (f) => {
      f.entry.state = "NY";
    },
    /unsupported market identity/,
  ],
  [
    "home-health nursing metrics",
    (f) => {
      f.data.providers = [
        { ...cmsProvider("317001"), category: "home-health" },
      ];
      f.data.meta = { asOf, catalogTotal: 1, categories: { "home-health": 1 } };
    },
    /CMS ratings require nursing-home category/,
  ],
  [
    "default ZIP",
    (f) => {
      f.entry.defaultZip = "07083";
    },
    /defaultZip/,
  ],
  [
    "ZIP state",
    (f) => {
      f.data.zips = { "02108": { city: "Boston", lat: 42, lng: -71 } };
      f.entry.defaultZip = "02108";
    },
    /outside state/,
  ],
  [
    "provider ZIP",
    (f) => {
      f.data.providers = [{ ...provider(), zip: "07083" }];
    },
    /provider ZIP/,
  ],
  [
    "provider state",
    (f) => {
      f.data.providers = [{ ...provider(), state: "MA" }];
    },
    /provider state/,
  ],
  [
    "coordinate range",
    (f) => {
      f.data.providers = [{ ...provider(), lat: 91 }];
    },
    /coordinates out of range/,
  ],
  [
    "coordinate pair",
    (f) => {
      f.data.providers = [{ ...provider(), lat: null }];
    },
    /both be null/,
  ],
  [
    "namespace",
    (f) => {
      f.data.providers = [provider("example")];
    },
    /region namespace/,
  ],
  [
    "CMS identity",
    (f) => {
      f.data.providers = [{ ...cmsProvider(), id: "north-jersey-example" }];
    },
    /cms-CCN/,
  ],
  [
    "duplicates",
    (f) => {
      f.data.providers = [provider(), provider()];
    },
    /duplicate IDs/,
  ],
  [
    "source date",
    (f) => {
      f.data.providers = [
        { ...provider(), sources: [{ ...source, checkedAt: "2026-02-30" }] },
      ];
    },
    /invalid calendar date 2026-02-30/,
  ],
  [
    "future date",
    (f) => {
      f.data.providers = [
        { ...provider(), sources: [{ ...source, checkedAt: "2099-01-01" }] },
      ];
    },
    /future source date/,
  ],
  [
    "snapshot date",
    (f) => {
      f.data.meta = {
        asOf: "2026-11-11",
        catalogTotal: 1,
        categories: { "assisted-living": 1 },
      };
    },
    /after snapshot/,
  ],
  [
    "review date",
    (f) => {
      f.entry.review.reviewedAt = "2026-11-11";
    },
    /review predates/,
  ],
  [
    "pending review",
    (f) => {
      f.entry.review.status = "pending";
    },
    /expected one of/,
  ],
  [
    "catalog count",
    (f) => {
      f.data.meta = {
        asOf,
        catalogTotal: 2,
        categories: { "assisted-living": 1 },
      };
    },
    /catalogTotal mismatch/,
  ],
  [
    "category count",
    (f) => {
      f.data.meta = { asOf, catalogTotal: 1, categories: { "home-care": 1 } };
    },
    /category counts mismatch/,
  ],
  [
    "missing provenance",
    (f) => {
      f.data.providers = [{ ...provider(), sources: [] }];
    },
    /source provenance/,
  ],
  [
    "required shape",
    (f) => {
      f.data.providers = [{ id: "north-jersey-example" }];
    },
    /required field/,
  ],
  [
    "unknown shape",
    (f) => {
      f.data.providers = [{ ...provider(), research: {} }];
    },
    /unknown fields/,
  ],
  [
    "location join",
    (f) => {
      f.data.locationResearch = { "vna-care": research("vna-care") };
    },
    /cross-market locationResearch/,
  ],
  [
    "source join",
    (f) => {
      const r = research();
      r.facts[0].sourceId = "missing";
      f.data.locationResearch = { [r.providerId]: r };
    },
    /unknown research sourceId/,
  ],
  [
    "Facebook join",
    (f) => {
      const fb = facebook();
      fb.locations["vna-care"] = fb.locations["north-jersey-example"];
      f.data.facebookResearch = fb;
    },
    /cross-market Facebook/,
  ],
  [
    "Facebook count",
    (f) => {
      const fb = facebook();
      fb.locations["north-jersey-example"].publishedObservationCount = 2;
      f.data.facebookResearch = fb;
    },
    /publishedObservationCount/,
  ],
  [
    "inspection join",
    (f) => {
      f.data.inspectionHistory = {
        ...inspections,
        facilities: { "225002": Object.values(inspections.facilities)[0] },
      };
    },
    /cross-market inspection/,
  ],
];

for (const [name, mutate, expected] of invalidInputs) {
  test(`regional CLI rejects ${name} and leaves existing output unchanged`, () => {
    const f = fixture();
    try {
      mutate(f);
      f.save();
      unchangedOnFailure(f, expected);
    } finally {
      f.close();
    }
  });
}

test("regional CLI rejects tampering, missing artifacts, path escapes, and explicit missing manifests", () => {
  for (const mode of [
    "hash",
    "count",
    "missing",
    "escape",
    "manifest",
  ] as const) {
    const f = fixture();
    try {
      if (mode === "hash") f.entry.artifacts.providers.sha256 = "0".repeat(64);
      if (mode === "count") f.entry.artifacts.providers.count = 2;
      if (mode === "missing") f.entry.artifacts.providers.path = "missing.json";
      if (mode === "escape")
        f.entry.artifacts.providers.path = "../providers.json";
      writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
      if (mode === "manifest") rmSync(f.manifestPath);
      unchangedOnFailure(
        f,
        /SHA-256 mismatch|artifact count mismatch|No such file|escapes manifest/,
      );
    } finally {
      f.close();
    }
  }
});

test("regional CLI rejects cross-market CMS collisions and never rewrites Massachusetts files", () => {
  const f = fixture();
  function filesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((file) =>
      file.isDirectory()
        ? filesUnder(join(directory, file.name))
        : [join(directory, file.name)],
    );
  }
  const protectedFiles = filesUnder(join(root, "src/data")).filter(
    (file) => file !== join(root, "src/data/regional-markets.json"),
  );
  const before = protectedFiles.map((file) => digest(readFileSync(file)));
  try {
    assert.equal(f.run().status, 0);
    f.data.providers = [cmsProvider("225002")];
    f.data.meta = { asOf, catalogTotal: 1, categories: { "nursing-home": 1 } };
    f.save();
    unchangedOnFailure(f, /collision across markets/);
    f.data.providers = [{ ...provider("cms-227068"), category: "home-health" }];
    f.data.meta = { asOf, catalogTotal: 1, categories: { "home-health": 1 } };
    f.save();
    unchangedOnFailure(f, /CCN collision across markets/);
    const denied = f.run("--output", join(root, "src/data/providers.json"));
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Only src\/data\/regional-markets.json/);
    assert.deepEqual(
      protectedFiles.map((file) => digest(readFileSync(file))),
      before,
    );
  } finally {
    f.close();
  }
});

test("regional CLI reports pending honestly and cannot erase an existing market when the default manifest is absent", () => {
  const f = fixture();
  try {
    const script = join(f.dir, "scripts/regions/build-region.py");
    const output = join(f.dir, "src/data/regional-markets.json");
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(builder, script);
    const run = (...args: string[]) =>
      spawnSync("python3", ["-B", script, ...args], {
        cwd: f.dir,
        encoding: "utf8",
      });
    const built = run();
    assert.equal(built.status, 0, built.stderr);
    assert.equal(JSON.parse(built.stdout).status, "pending-reviewed-manifest");
    assert.equal(readFileSync(output, "utf8"), "[]\n");
    assert.equal(run("--check").status, 0);
    const previous = '[{"id":"previous-market"}]\n';
    writeFileSync(output, previous);
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /must not erase published markets/);
    assert.equal(readFileSync(output, "utf8"), previous);
  } finally {
    f.close();
  }
});

test("regional CLI cannot overwrite its own manifest or normalized inputs", () => {
  const f = fixture();
  try {
    for (const path of [f.manifestPath, join(f.dir, "providers.json")]) {
      const before = readFileSync(path);
      const result = f.run("--output", path);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /must not overwrite/);
      assert.deepEqual(readFileSync(path), before);
    }
  } finally {
    f.close();
  }
});

test("regional CLI rejects an otherwise valid unsupported market without replacing output", () => {
  const f = fixture();
  try {
    f.entry.id = "new-york-city";
    f.entry.label = "New York City";
    f.entry.state = "NY";
    f.entry.defaultZip = "10001";
    f.data.zips = {
      "10001": { city: "New York", lat: 40.75, lng: -73.99 },
    };
    f.data.providers = [
      {
        ...provider("new-york-city-example"),
        state: "NY",
        zip: "10001",
        city: "New York",
      },
    ];
    f.save();
    unchangedOnFailure(f, /unsupported market identity/);
  } finally {
    f.close();
  }
});

test("regional CLI supports explicit empty reviewed manifests and rejects duplicate markets and JSON keys", () => {
  const f = fixture();
  try {
    f.manifest.markets = [];
    f.save();
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(f.output, "utf8"), "[]\n");
    f.manifest.markets = [f.entry, f.entry];
    f.save();
    unchangedOnFailure(f, /duplicate IDs/);
    writeFileSync(
      f.manifestPath,
      '{"schemaVersion":1,"schemaVersion":1,"markets":[]}',
    );
    unchangedOnFailure(f, /Duplicate JSON key/);
  } finally {
    f.close();
  }
});
