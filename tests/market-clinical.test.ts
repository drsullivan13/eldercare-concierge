import test from "node:test";
import assert from "node:assert/strict";
import qualityRows from "../research/north-jersey/cms/datasets/6jpm-sxkc.json";
import surveyRows from "../research/north-jersey/cms/datasets/ccn4-8vby.json";
import stateSurveyCapture from "../research/north-jersey/clinical/sources/m5jg-jg7i.rows.json";
import nationalSurveyCapture from "../research/north-jersey/clinical/sources/vxub-6swi.rows.json";
import healthDeficiencyRows from "../research/north-jersey/cms/datasets/r5ix-sfxw.json";
import penaltyRows from "../research/north-jersey/cms/datasets/g6vv-u9sr.json";
import cmsVerification from "../research/north-jersey/cms/verification.json";
import { getMarket } from "../src/lib/markets";
import type { Provider } from "../src/lib/providers";
import type { HomeHealthMetric } from "../src/lib/home-health";
import { GET as searchGET } from "../src/app/api/search/route";
import { GET as providersGET } from "../src/app/api/providers/route";
import { GET as coverageGET } from "../src/app/api/research-coverage/route";
import { GET as researchGET } from "../src/app/api/research/route";
import { GET as inspectionGET } from "../src/app/api/evidence/route";
import { GET as homeHealthGET } from "../src/app/api/home-health-evidence/route";

// Real source-backed NJ records selected from the published registry.
const HOME_HEALTH = { providerId: "cms-317002", ccn: "317002" } as const;
const NURSING = { providerId: "cms-315303", ccn: "315303" } as const;

type RawRow = Record<string, string>;
const qualityRaw = qualityRows.find((row) => row.cms_certification_number_ccn === HOME_HEALTH.ccn)!;
const surveyRaw = surveyRows.find((row) => row.cms_certification_number_ccn === HOME_HEALTH.ccn)!;
const stateSurveyRow = (
  stateSurveyCapture as unknown as { body: { results: RawRow[] } }
).body.results.find((row) => row.state === "NJ")!;
const nationalSurveyRow = (
  nationalSurveyCapture as unknown as { body: { results: RawRow[] } }
).body.results[0];
const deficiencies = healthDeficiencyRows as unknown as RawRow[];
const penalties = penaltyRows as unknown as RawRow[];
const rawCitations = deficiencies.filter(
  (row) => row.cms_certification_number_ccn === NURSING.ccn,
);
const rawPenalties = penalties.filter(
  (row) => row.cms_certification_number_ccn === NURSING.ccn,
);

const nj = getMarket("north-jersey")!;
assert.ok(nj, "The NJ snapshot is published");
const nursingProvider = nj.providers.find(
  (provider) => provider.id === NURSING.providerId,
)!;
const homeHealthProvider = nj.providers.find(
  (provider) => provider.id === HOME_HEALTH.providerId,
)!;
assert.equal(nursingProvider.cms?.ccn, NURSING.ccn);
assert.equal(homeHealthProvider.category, "home-health");
const request = (path: string) => new Request(`http://localhost/api/${path}`);

const numeric = (raw: string | null) =>
  raw === null ||
  ["", "-", "NA", "N/A", "Not Available"].includes(raw.trim())
    ? null
    : Number(raw.replaceAll(",", ""));

function matchesRaw(metric: HomeHealthMetric, raw: RawRow) {
  assert.equal(metric.rawValue, raw[metric.sourceColumn]);
  assert.equal(metric.value, numeric(raw[metric.sourceColumn]));
  assert.equal(
    metric.status,
    metric.value === null ? "not published" : "published",
  );
}

/** Documented bounding order: newest source date first, ties broken by id. */
function latestFirst<T extends { id: string }>(
  records: readonly T[],
  getDate: (record: T) => string | null,
): T[] {
  return [...records].sort(
    (a, b) =>
      (getDate(b) ?? "").localeCompare(getDate(a) ?? "") ||
      a.id.localeCompare(b.id),
  );
}

test("real NJ home-health evidence matches its retained clinical source artifact exactly", async () => {
  const response = homeHealthGET(
    request(`home-health-evidence?providerId=${HOME_HEALTH.providerId}`),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.providerId, HOME_HEALTH.providerId);
  assert.equal(body.retrieved, nj.homeHealthEvidence!.retrieved);
  assert.equal(
    body.releasedAt,
    cmsVerification.release_consistency.home_health[0],
  );
  assert.match(body.providerId, /^cms-\d{6}$/);
  assert.deepEqual(
    body.agencies.map((agency: { ccn: string }) => agency.ccn),
    [HOME_HEALTH.ccn],
  );
  const agency = body.agencies[0];
  assert.equal(agency.organizationId, HOME_HEALTH.providerId);
  assert.equal(agency.cmsProviderName, qualityRaw.provider_name);
  assert.equal(agency.cmsAddress.street, qualityRaw.address);
  assert.equal(agency.cmsAddress.city, qualityRaw.citytown);
  assert.equal(agency.cmsAddress.state, "NJ");
  assert.equal(agency.cmsAddress.zip, qualityRaw.zip_code);
  matchesRaw(agency.qualityOfPatientCare.starRating, qualityRaw);
  for (const component of agency.qualityOfPatientCare.components) {
    matchesRaw(component.rate, qualityRaw);
    if (component.publishedNumerator)
      matchesRaw(component.publishedNumerator, qualityRaw);
    if (component.publishedDenominator)
      matchesRaw(component.publishedDenominator, qualityRaw);
  }
  const experience = agency.patientExperience;
  matchesRaw(experience.summaryStarRating, surveyRaw);
  matchesRaw(experience.completedSurveys, surveyRaw);
  matchesRaw(experience.responseRate, surveyRaw);
  for (const measure of experience.measures) {
    matchesRaw(measure.percent, surveyRaw);
    if (measure.starRating) matchesRaw(measure.starRating, surveyRaw);
  }
  const unitRow = `research/north-jersey/clinical/home-health-agency-evidence.json#/agenciesByCcn/${HOME_HEALTH.ccn}`;
  assert.equal(
    agency.qualityOfPatientCare.rawUnitRowFile,
    `${unitRow}/qualitySource`,
  );
  assert.equal(experience.rawUnitRowFile, `${unitRow}/surveySource`);
  assert.equal(
    agency.qualityOfPatientCare.measureDateRangesFile,
    "research/north-jersey/cms/datasets/c886-nwpj.json",
  );
  assert.deepEqual(
    agency.sources.map((source: { datasetId?: string }) => source.datasetId),
    ["6jpm-sxkc", "ccn4-8vby"],
  );
  for (const source of [...body.sources, ...agency.sources]) {
    assert.equal(source.checkedAt, "2026-11-12");
    assert.equal(
      source.releasedAt,
      cmsVerification.release_consistency.home_health[0],
    );
  }

  // The comparator is New Jersey only: no Massachusetts label, key or values.
  const comparators = body.patientExperienceComparators;
  assert.deepEqual(Object.keys(comparators).sort(), ["national", "state"]);
  assert.doesNotMatch(JSON.stringify(comparators), /massachusetts/i);
  assert.equal(comparators.state.code, "NJ");
  assert.equal(comparators.state.label, "New Jersey");
  assert.equal(
    comparators.state.sourceFile,
    "research/north-jersey/clinical/sources/m5jg-jg7i.rows.json",
  );
  assert.equal(
    comparators.national.sourceFile,
    "research/north-jersey/clinical/sources/vxub-6swi.rows.json",
  );
  for (const measure of comparators.state.measures)
    matchesRaw(measure.percent, stateSurveyRow);
  for (const measure of comparators.national.measures)
    matchesRaw(measure.percent, nationalSurveyRow);
});

test("real NJ inspection evidence is bounded from the selected snapshot and its retained CMS rows", async () => {
  const snapshot = nj.inspectionHistory!;
  const facility = snapshot.facilities[NURSING.ccn];
  assert.ok(facility?.healthCitations && facility.penalties);
  assert.equal(facility.healthCitations.total, rawCitations.length);
  assert.equal(facility.penalties.total, rawPenalties.length);
  assert.equal(
    facility.penalties.fineCount,
    rawPenalties.filter((row) => row.penalty_type === "Fine").length,
  );
  assert.equal(
    facility.penalties.paymentDenialCount,
    rawPenalties.filter((row) => row.penalty_type === "Payment Denial").length,
  );

  const response = inspectionGET(request(`evidence?ccn=${NURSING.ccn}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ccn, NURSING.ccn);
  assert.equal(body.providerId, NURSING.providerId);
  assert.equal(body.providerName, nursingProvider.name);
  assert.equal(body.retrieved, snapshot.retrieved);
  assert.equal(body.retrieved, "2026-11-12");
  assert.equal(body.limit, 5);
  assert.equal(body.maximumLimit, 25);
  for (const source of body.sources) {
    assert.equal(source.released, cmsVerification.release_consistency.nursing[0]);
  }
  assert.deepEqual(
    body.sources.map((source: { datasetId: string }) => source.datasetId),
    ["r5ix-sfxw", "g6vv-u9sr"],
  );
  assert.equal(body.healthCitations.total, rawCitations.length);
  assert.equal(body.healthCitations.returned, Math.min(5, rawCitations.length));
  assert.equal(body.healthCitations.hasMore, rawCitations.length > 5);
  assert.deepEqual(
    body.healthCitations.records.map((row: { id: string }) => row.id),
    latestFirst(facility.healthCitations.records, (row) => row.surveyDate)
      .slice(0, 5)
      .map((row) => row.id),
  );
  assert.equal(body.penalties.total, rawPenalties.length);
  assert.equal(body.penalties.returned, Math.min(5, rawPenalties.length));
  assert.equal(
    body.penalties.fineCount,
    rawPenalties.filter((row) => row.penalty_type === "Fine").length,
  );
  assert.equal(
    body.penalties.paymentDenialCount,
    rawPenalties.filter((row) => row.penalty_type === "Payment Denial").length,
  );
  assert.equal(
    body.careCompareUrl,
    `https://www.medicare.gov/care-compare/details/nursing-home/${NURSING.ccn}`,
  );

  const full = await inspectionGET(
    request(`evidence?ccn=${NURSING.ccn}&limit=25`),
  ).json();
  assert.equal(full.healthCitations.returned, Math.min(25, rawCitations.length));
  assert.equal(full.penalties.returned, Math.min(25, rawPenalties.length));

  // The same CCN shape resolves against the owning snapshot only: the MA
  // nursing home still comes from the earlier Massachusetts extract.
  const maResponse = inspectionGET(request("evidence?ccn=225268"));
  assert.equal(maResponse.status, 200);
  const maBody = await maResponse.json();
  assert.equal(maBody.providerId, "cms-225268");
  assert.equal(maBody.retrieved, "2026-11-11");
  assert.notEqual(maBody.retrieved, body.retrieved);
});

test("search, providers, research and coverage handlers keep NJ clinical records in their owning region", async () => {
  const homeHealthSearch = await searchGET(
    request("search?zip=07960&radius=10&category=home-health"),
  ).json();
  assert.equal(homeHealthSearch.market.id, "north-jersey");
  const foundHome = homeHealthSearch.providers.find(
    (provider: Provider) => provider.id === HOME_HEALTH.providerId,
  )!;
  assert.ok(foundHome, "real home-health agency is searchable");
  assert.equal(foundHome.state, "NJ");
  assert.equal(foundHome.cms, undefined);
  const nursingSearch = await searchGET(
    request("search?zip=07960&radius=10&category=nursing-home"),
  ).json();
  const foundNursing = nursingSearch.providers.find(
    (provider: Provider) => provider.id === NURSING.providerId,
  )!;
  assert.ok(foundNursing, "real nursing home is searchable");
  assert.equal(foundNursing.cms?.ccn, NURSING.ccn);
  for (const provider of [
    ...homeHealthSearch.providers,
    ...nursingSearch.providers,
  ]) {
    assert.equal(provider.state, "NJ");
    assert.ok(nj.providers.some((record) => record.id === provider.id));
    if (provider.cms) assert.equal(provider.id, `cms-${provider.cms.ccn}`);
  }

  const ids = `${HOME_HEALTH.providerId},${NURSING.providerId}`;
  const saved = await providersGET(request(`providers?ids=${ids}`)).json();
  assert.deepEqual(
    saved.providers.map((provider: Provider) => provider.id),
    [HOME_HEALTH.providerId, NURSING.providerId],
  );
  const savedMA = await providersGET(
    request(`providers?ids=${ids}&market=massachusetts`),
  ).json();
  assert.deepEqual(savedMA.providers, []);

  for (const id of [HOME_HEALTH.providerId, NURSING.providerId]) {
    const research = await researchGET(request(`research?id=${id}`)).json();
    assert.equal(research.providerId, id);
    const published = nj.locationResearch?.[id];
    assert.equal(research.checkedAt, published?.checkedAt ?? null);
    assert.deepEqual(research.sources, published?.sources ?? []);
    if (!published?.reviewAggregates.length) assert.equal(research.experience.value, null);
  }
  const coverage = await coverageGET(
    request("research-coverage?market=north-jersey"),
  ).json();
  assert.equal(coverage.market.id, "north-jersey");
  for (const id of [HOME_HEALTH.providerId, NURSING.providerId]) {
    const location = coverage.locations.find(
      (entry: { providerId: string }) => entry.providerId === id,
    );
    assert.ok(location, `coverage lists ${id}`);
    assert.equal(location.providerId, id);
  }
});

test("wrong selectors are rejected without cross-region evidence leakage", async () => {
  const cases: [() => Response, number][] = [
    [() => homeHealthGET(request("home-health-evidence?providerId=317002")), 404],
    [
      () =>
        homeHealthGET(
          request(`home-health-evidence?providerId=${NURSING.providerId}`),
        ),
      404,
    ],
    [
      () =>
        homeHealthGET(
          request(
            `home-health-evidence?providerId=${HOME_HEALTH.providerId}&ccn=${HOME_HEALTH.ccn}`,
          ),
        ),
      400,
    ],
    [
      () => homeHealthGET(request(`home-health-evidence?ccn=${HOME_HEALTH.ccn}`)),
      400,
    ],
    [
      () =>
        homeHealthGET(
          request(
            "home-health-evidence?providerId=cms-317002&providerId=cms-317006",
          ),
        ),
      400,
    ],
    [() => inspectionGET(request(`evidence?ccn=${HOME_HEALTH.ccn}`)), 404],
    [() => inspectionGET(request(`evidence?ccn=${NURSING.providerId}`)), 400],
    [() => inspectionGET(request(`evidence?ccn=${NURSING.ccn}&limit=0`)), 400],
    [() => inspectionGET(request(`evidence?ccn=${NURSING.ccn}&limit=26`)), 400],
    [() => inspectionGET(request(`evidence?ccn=${NURSING.ccn}&limit=abc`)), 400],
    [
      () =>
        inspectionGET(request(`evidence?ccn=${NURSING.ccn}&ccn=${NURSING.ccn}`)),
      400,
    ],
    [
      () =>
        researchGET(
          request(`research?id=${HOME_HEALTH.providerId}&id=${NURSING.providerId}`),
        ),
      400,
    ],
    [
      () =>
        providersGET(
          request(`providers?ids=${HOME_HEALTH.providerId}&extra=1`),
        ),
      400,
    ],
  ];
  for (const [query, status] of cases) {
    const response = query();
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.agencies, undefined);
    assert.equal(body.records, undefined);
  }
  const maHomeHealth = await homeHealthGET(
    request("home-health-evidence?providerId=vna-care"),
  ).json();
  assert.deepEqual(
    maHomeHealth.agencies.map((agency: { ccn: string }) => agency.ccn),
    ["227068", "227098"],
  );
  assert.equal(
    maHomeHealth.patientExperienceComparators.state.label,
    "Massachusetts",
  );
});
