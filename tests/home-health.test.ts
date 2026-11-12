import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  getHomeHealthEvidence,
  HOME_HEALTH_PROVIDER_CCNS,
  HomeHealthEvidenceError,
  type HomeHealthMetric,
} from "../src/lib/home-health";
import { GET } from "../src/app/api/home-health-evidence/route";
import {
  createMarketRegistry,
  getMarket,
  type MarketSnapshot,
} from "../src/lib/markets";

const read = (file: string) =>
  JSON.parse(
    readFileSync(
      new URL("../src/data/inputs/home-health/" + file, import.meta.url),
      "utf8",
    ),
  );
const quality = read("matched-6jpm-sxkc.json") as Record<string, string>[];
const survey = read("matched-ccn4-8vby.json") as Record<string, string>[];
const dates = read("matched-c886-nwpj.json") as Record<string, string>[];
const byCcn = (rows: Record<string, string>[], ccn: string) =>
  rows.find((row) => row["CMS Certification Number (CCN)"] === ccn)!;
const number = (raw: string) =>
  ["", "-", "NA", "N/A", "Not Available"].includes(raw.trim())
    ? null
    : Number(raw.replaceAll(",", ""));
const all = Object.keys(HOME_HEALTH_PROVIDER_CCNS).flatMap(
  (id) => getHomeHealthEvidence(id).agencies,
);
function matchesRaw(metric: HomeHealthMetric, raw: Record<string, string>) {
  assert.equal(metric.rawValue, raw[metric.sourceColumn]);
  assert.equal(metric.value, number(raw[metric.sourceColumn]));
  assert.equal(
    metric.status,
    metric.value === null ? "not published" : "published",
  );
}

test("six exact catalog identities expose seven separate CMS reporting units without an invented network rating", () => {
  assert.equal(all.length, 7);
  assert.equal(new Set(all.map((agency) => agency.ccn)).size, 7);
  for (const [id, ccns] of Object.entries(HOME_HEALTH_PROVIDER_CCNS)) {
    const result = getHomeHealthEvidence(id);
    assert.equal(result.providerId, id);
    assert.deepEqual(
      result.agencies.map((agency) => agency.ccn),
      [...ccns].sort(),
    );
    assert.equal(result.retrieved, "2026-11-12");
    assert.equal(result.releasedAt, "2026-10-21");
    assert.equal("networkRating" in result, false);
    for (const agency of result.agencies) {
      const raw = byCcn(quality, agency.ccn);
      assert.equal(agency.organizationId, id);
      assert.equal(agency.cmsProviderName, raw["Provider Name"]);
      assert.equal(agency.cmsAddress.street, raw.Address);
      assert.equal(agency.cmsAddress.zip, raw["ZIP Code"]);
      assert.equal("cms" in agency, false);
      assert.match(agency.scope, /reporting entity\/CCN/);
    }
  }
  const vna = getHomeHealthEvidence("vna-care");
  assert.deepEqual(
    vna.agencies.map(
      (agency) => agency.patientExperience.summaryStarRating.value,
    ),
    [4, 3],
  );
});

test("all five patient-experience rates, stars, counts, response and blank source footnotes match actual CMS rows", () => {
  for (const agency of all) {
    const raw = byCcn(survey, agency.ccn);
    const experience = agency.patientExperience;
    assert.deepEqual(experience.period, {
      start: "2025-04-01",
      end: "2026-03-31",
      label: "April 1, 2025–March 31, 2026",
    });
    for (const metric of [
      experience.summaryStarRating,
      experience.completedSurveys,
      experience.responseRate,
    ])
      matchesRaw(metric, raw);
    assert.equal(experience.measures.length, 5);
    for (const measure of experience.measures) {
      matchesRaw(measure.percent, raw);
      assert.deepEqual(measure.percent.footnoteCodes, []);
      assert.equal(measure.percent.rawFootnote, "");
      if (measure.starRating) matchesRaw(measure.starRating, raw);
      if (measure.id === "definitely-recommend")
        assert.equal(measure.starRating, null);
    }
    assert.equal(experience.rawGeneralFootnote, raw["Footnote Number"]);
    assert.deepEqual(experience.generalFootnoteCodes, []);
    assert.ok(
      experience.completedSurveys.value! >= 282 &&
        experience.completedSurveys.value! <= 1279,
    );
    assert.ok(
      experience.responseRate.value! >= 17 &&
        experience.responseRate.value! <= 26,
    );
    assert.ok(
      agency.warnings.some((warning) =>
        warning.includes("not a verified denominator"),
      ),
    );
  }
});

test("clinical half-stars and seven dated components stay separate from the survey, with actual source direction and denominator fields", () => {
  assert.equal(
    getHomeHealthEvidence("south-shore-vna").agencies[0].qualityOfPatientCare
      .starRating.value,
    2.5,
  );
  for (const agency of all) {
    const clinical = agency.qualityOfPatientCare;
    const raw = byCcn(quality, agency.ccn);
    matchesRaw(clinical.starRating, raw);
    assert.equal(clinical.components.length, 7);
    assert.deepEqual(clinical.starComponentPeriod, {
      start: "2025-01-01",
      end: "2025-12-31",
      label: "January 1–December 31, 2025",
    });
    for (const component of clinical.components) {
      matchesRaw(component.rate, raw);
      assert.equal(component.period.start, "2025-01-01");
      assert.equal(component.period.end, "2025-12-31");
      assert.equal(
        dates.find(
          (row) => row["Measure Name"] === component.dateSourceMeasureName,
        )?.["Measure Date Range"],
        component.dateSourceRawRange,
      );
      if (component.rate.sourceColumn === "PPH Risk-Standardized Rate")
        assert.equal(component.betterDirection, "lower");
      else assert.equal(component.betterDirection, "higher");
      if (component.publishedNumerator)
        matchesRaw(component.publishedNumerator, raw);
      if (component.publishedDenominator)
        matchesRaw(component.publishedDenominator, raw);
    }
    assert.notEqual(
      clinical.starComponentPeriod.start,
      agency.patientExperience.period.start,
    );
  }
});

test("provenance URLs are strings and official comparators remain distinct same-period reference values", () => {
  const result = getHomeHealthEvidence("mgb-home-care");
  for (const source of [
    ...result.sources,
    ...all.flatMap((agency) => agency.sources),
  ]) {
    assert.equal(typeof source.url, "string");
    assert.match(source.url, /^https:\/\//);
    assert.equal(source.releasedAt, "2026-10-21");
  }
  const references = result.patientExperienceComparators;
  for (const [key, file] of [
    ["massachusetts", "matched-m5jg-jg7i.json"],
    ["national", "matched-vxub-6swi.json"],
  ] as const) {
    const raw = read(file)[0];
    const comparator = references[key];
    assert.ok(comparator);
    assert.equal(comparator.period.start, "2025-04-01");
    for (const measure of comparator.measures) matchesRaw(measure.percent, raw);
  }
  assert.equal(references.state?.code, "MA");
  assert.equal(references.state?.label, "Massachusetts");
  assert.deepEqual(
    references.state?.measures,
    references.massachusetts?.measures,
  );
  assert.match(result.footnoteDefinitions["11"], /Fewer than 70/);
  assert.ok(
    result.interpretationRules.some((rule) =>
      rule.includes("40 completed surveys"),
    ),
  );
});

test("endpoint rejects missing, duplicate, malformed, unknown, unrelated and foreign CCN selectors without returning evidence", async () => {
  const cases: [string, number][] = [
    ["", 400],
    ["?providerId=", 400],
    ["?providerId=vna-care&providerId=mgb-home-care", 400],
    ["?providerId=VNA%20Care", 400],
    ["?providerId=227068", 404],
    ["?providerId=not-in-catalog", 404],
    ["?providerId=cms-225506", 404],
    ["?providerId=houseworks", 404],
    ["?providerId=privatus-boston", 404],
    ["?providerId=vna-care&ccn=227207", 400],
    ["?ccn=227068", 400],
  ];
  for (const [query, status] of cases) {
    const response = GET(
      new Request("http://localhost/api/home-health-evidence" + query),
    );
    assert.equal(response.status, status, query);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.agencies, undefined);
  }
  assert.throws(
    () => getHomeHealthEvidence("unknown"),
    (error: unknown) =>
      error instanceof HomeHealthEvidenceError && error.status === 404,
  );
  const response = GET(
    new Request(
      "http://localhost/api/home-health-evidence?providerId=vna-care",
    ),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).agencies.length, 2);
});

function regionalHomeHealth() {
  const ma = getMarket()!;
  const evidence = getHomeHealthEvidence("vna-care");
  const template = ma.providers.find((provider) => provider.id === "vna-care")!;
  const provider = {
    ...template,
    id: "cms-317001",
    state: "NJ",
    cms: undefined,
  };
  const agency = {
    ...evidence.agencies[0],
    ccn: "317001",
    organizationId: provider.id,
    cmsAddress: { ...evidence.agencies[0].cmsAddress, state: "NJ" },
  };
  const market: MarketSnapshot = {
    id: "north-jersey",
    label: "North Jersey",
    state: "NJ",
    defaultZip: "07960",
    zips: { "07960": { city: "Morristown", lat: 40.79, lng: -74.48 } },
    meta: { asOf: evidence.retrieved },
    providers: [provider],
    homeHealthEvidence: {
      ...evidence,
      agencies: [agency],
      patientExperienceComparators: {
        national: evidence.patientExperienceComparators.national,
        "north-jersey": {
          ...evidence.patientExperienceComparators.massachusetts!,
          sourceFile: "nj-state-survey.json",
        },
      },
    },
  };
  return { ma, market, provider, agency };
}

test("stable NJ CMS agency IDs work without nursing-home metrics and normalize the market comparator", () => {
  const { ma, market, provider, agency } = regionalHomeHealth();
  assert.equal(provider.cms, undefined);
  const result = getHomeHealthEvidence(
    provider.id,
    createMarketRegistry([ma, market]),
  );
  assert.deepEqual(result.agencies, [agency]);
  assert.deepEqual(result.patientExperienceComparators, {
    national: market.homeHealthEvidence!.patientExperienceComparators.national,
    state: {
      ...market.homeHealthEvidence!.patientExperienceComparators[
        "north-jersey"
      ],
      code: "NJ",
      label: "New Jersey",
    },
  });
});

test("regional agencies require the exact organization, CCN, state and CMS catalog identity", () => {
  for (const mismatch of [
    "ccn",
    "state",
    "organization",
    "unknown-provider",
    "regional-id",
    "short-ccn",
    "long-ccn",
    "wrong-category",
    "provider-state",
  ]) {
    const { ma, market, provider, agency } = regionalHomeHealth();
    if (mismatch === "ccn") agency.ccn = "317002";
    if (mismatch === "state") agency.cmsAddress.state = "MA";
    if (mismatch === "organization") agency.organizationId = "cms-317002";
    if (mismatch === "unknown-provider") market.providers = [];
    if (mismatch === "provider-state") provider.state = "MA";
    if (mismatch === "wrong-category") provider.category = "home-care";
    if (["regional-id", "short-ccn", "long-ccn"].includes(mismatch)) {
      provider.id =
        mismatch === "regional-id"
          ? "north-jersey-agency"
          : mismatch === "short-ccn"
            ? "cms-31700"
            : "cms-3170010";
      agency.organizationId = provider.id;
    }
    assert.throws(
      () =>
        getHomeHealthEvidence(provider.id, createMarketRegistry([ma, market])),
      (error) =>
        error instanceof HomeHealthEvidenceError && error.status === 404,
      mismatch,
    );
  }
});

test("NJ omits missing and mismatched state comparators without borrowing MA evidence", () => {
  for (const form of ["missing", "wrong-state", "ma-only"] as const) {
    const { ma, market, provider } = regionalHomeHealth();
    const comparators = market.homeHealthEvidence!.patientExperienceComparators;
    const state = comparators["north-jersey"]!;
    delete comparators["north-jersey"];
    if (form === "wrong-state")
      comparators.state = { ...state, code: "MA", label: "Massachusetts" };
    if (form === "ma-only") comparators.massachusetts = state;
    const result = getHomeHealthEvidence(
      provider.id,
      createMarketRegistry([ma, market]),
    );
    assert.deepEqual(result.patientExperienceComparators, {
      national: comparators.national,
    });
  }
});

test("MA retains its exact allowlist and Massachusetts comparator beside regional evidence", () => {
  const { ma, market } = regionalHomeHealth();
  const original = getHomeHealthEvidence("vna-care");
  const result = getHomeHealthEvidence(
    "vna-care",
    createMarketRegistry([ma, market]),
  );
  assert.deepEqual(result, original);
  assert.deepEqual(
    result.agencies.map((agency) => agency.ccn),
    ["227068", "227098"],
  );
  assert.equal(result.patientExperienceComparators.state?.code, "MA");
  assert.equal(
    result.patientExperienceComparators.state?.label,
    "Massachusetts",
  );
  assert.deepEqual(
    result.patientExperienceComparators.massachusetts,
    ma.homeHealthEvidence!.patientExperienceComparators.massachusetts,
  );
});

test("offline rebuild is byte-identical, excludes its own hash manifest, and distinguishes missing from published zero", () => {
  const root = new URL("../", import.meta.url);
  const paths = [
    "src/data/home-health-evidence.json",
    "src/data/inputs/home-health/source-hashes.json",
  ];
  const hashes = () =>
    paths.map((path) =>
      createHash("sha256")
        .update(readFileSync(new URL(path, root)))
        .digest("hex"),
    );
  const before = hashes();
  execFileSync("python", ["scripts/prepare-home-health.py"], {
    cwd: root,
    stdio: "pipe",
  });
  const after = hashes();
  assert.deepEqual(after, before);
  assert.equal(
    Object.hasOwn(read("source-hashes.json"), "source-hashes.json"),
    false,
  );
  const actual = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        "import runpy,json; m=runpy.run_path('scripts/prepare-home-health.py'); print(json.dumps([m['numeric'](v) for v in [None,'','-','NA','N/A','Not Available','0','0.00','2.5']]))",
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  assert.deepEqual(actual, [null, null, null, null, null, null, 0, 0, 2.5]);
});
