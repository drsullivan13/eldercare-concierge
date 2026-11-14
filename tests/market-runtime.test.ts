import test from "node:test";
import assert from "node:assert/strict";
import retainedNJZips from "../research/north-jersey/geography/nj-zips.json";
import {
  createMarketRegistry,
  getMarket,
  getProviderMarket,
  type MarketSnapshot,
} from "../src/lib/markets";
import type { Provider } from "../src/lib/providers";
import type { LocationResearch } from "../src/lib/location-research-types";
import {
  searchProviders,
  getProvidersByIds,
  BOSTON,
  distanceMiles,
} from "../src/lib/search";
import {
  getLocationResearch,
  getResearchSummary,
  ResearchInputError,
} from "../src/lib/location-research";
import { getFacebookResearch } from "../src/lib/facebook-research";
import {
  getInspectionEvidence,
  EvidenceInputError,
} from "../src/lib/inspections";
import {
  getHomeHealthEvidence,
  HomeHealthEvidenceError,
} from "../src/lib/home-health";
import { getResearchCoverage } from "../src/lib/research-coverage";
import { GET as searchGET } from "../src/app/api/search/route";
import { GET as providersGET } from "../src/app/api/providers/route";
import { GET as coverageGET } from "../src/app/api/research-coverage/route";
import { GET as researchGET } from "../src/app/api/research/route";
import { GET as inspectionGET } from "../src/app/api/evidence/route";
import { GET as homeHealthGET } from "../src/app/api/home-health-evidence/route";

const ma = getMarket()!;
const njPoint = { city: "Hoboken", lat: 40.745251, lng: -74.027926 };
const nursing = ma.providers.find((provider) => provider.id === "cms-225268")!;
const njProvider: Provider = {
  ...nursing,
  id: "cms-319999",
  name: "Injected NJ regression facility",
  state: "NJ",
  city: njPoint.city,
  zip: "07030",
  lat: njPoint.lat,
  lng: njPoint.lng,
  cms: { ...nursing.cms!, ccn: "319999" },
  sources: [],
};
const nj: MarketSnapshot = {
  id: "north-jersey",
  label: "North Jersey",
  state: "NJ",
  defaultZip: "07960",
  zips: { "07030": njPoint, "07960": retainedNJZips["07960"] },
  meta: { asOf: "2026-10-01" },
  providers: [njProvider],
};
const registry = createMarketRegistry([ma, nj]);
const request = (path: string) => new Request(`http://localhost/api/${path}`);

test("ZIP selects its reviewed market and metadata without rewriting globally stable CMS IDs", () => {
  const result = searchProviders(
    { zip: "07030", radius: 1 },
    undefined,
    registry,
  );
  assert.deepEqual(result.market, {
    id: "north-jersey",
    label: "North Jersey",
    state: "NJ",
  });
  assert.deepEqual(result.origin, { zip: "07030", ...njPoint });
  assert.equal(result.catalogTotal, 1);
  assert.equal(result.asOf, nj.meta.asOf);
  assert.equal(result.total, 1);
  assert.equal(result.providers[0].id, "cms-319999");
  assert.equal(result.providers[0].cms?.ccn, "319999");
  assert.equal(result.providers[0].research, undefined);
  const original = searchProviders({}, undefined, registry);
  assert.deepEqual(original.market, {
    id: "massachusetts",
    label: "Massachusetts",
    state: "MA",
  });
  assert.equal(original.origin.zip, "02459");
  assert.equal(original.asOf, ma.meta.asOf);
});

test("mixed injected records cannot leak across markets through radius, category counts or unlocated counts", () => {
  const nearbyMA = { ...nursing, lat: njPoint.lat, lng: njPoint.lng };
  const unlocatedMA = { ...nearbyMA, lat: null, lng: null };
  const farNJ = {
    ...njProvider,
    id: "nj-far",
    lat: nursing.lat,
    lng: nursing.lng,
    cms: undefined,
  };
  const unlocatedNJ = {
    ...njProvider,
    id: "nj-unlocated",
    lat: null,
    lng: null,
    cms: undefined,
  };
  const records = [njProvider, nearbyMA, unlocatedMA, farNJ, unlocatedNJ];
  for (const sort of ["distance", "cms-rating", "experience"]) {
    const result = searchProviders(
      { zip: "07030", radius: 1, category: "nursing-home", sort },
      records,
      registry,
    );
    assert.deepEqual(
      result.providers.map((provider) => provider.id),
      [njProvider.id],
    );
    assert.equal(result.categories["nursing-home"], 1);
    assert.equal(result.catalogTotal, 3);
    assert.equal(result.excludedWithoutCoordinates, 1);
    assert.equal(result.experienceCoverage.scored, 0);
    assert.equal(result.experienceCoverage.unscored, 1);
    assert.equal(result.experienceCoverage.facebookCovered, 0);
  }
  const maResult = searchProviders(
    { zip: "02459", radius: 50 },
    [nursing, { ...njProvider, lat: nursing.lat, lng: nursing.lng }],
    registry,
  );
  assert.deepEqual(
    maResult.providers.map((provider) => provider.id),
    [nursing.id],
  );
  assert.equal(maResult.catalogTotal, 1);
});

test("unreviewed NJ ZIPs never borrow coordinates from a neighboring ZIP or its prefix", () => {
  assert.throws(
    () => searchProviders({ zip: "07030" }, undefined, [ma]),
    /North Jersey coverage is pending/,
  );
  for (const zip of ["07031", "07999", "08999"]) {
    assert.throws(
      () => searchProviders({ zip }, undefined, registry),
      /not recognized.*published North Jersey coverage/i,
    );
  }
  for (const zip of ["7030", "07030-1234", "ABCDE", ""]) {
    assert.throws(
      () => searchProviders({ zip }, undefined, registry),
      /five-digit/,
    );
  }
});

test("the Boston origin boundary still applies at its nearest real ZIPs on both sides", () => {
  const ordered = Object.entries(ma.zips)
    .map(([zip, point]) => ({ zip, miles: distanceMiles(BOSTON, point) }))
    .sort((a, b) => a.miles - b.miles);
  const inside = ordered.filter((point) => point.miles <= 55).at(-1)!;
  const outside = ordered.find((point) => point.miles > 55)!;
  assert.ok(inside.miles > 54);
  assert.ok(outside.miles < 56);
  assert.equal(searchGET(request(`search?zip=${inside.zip}`)).status, 200);
  assert.equal(searchGET(request(`search?zip=${outside.zip}`)).status, 400);
  assert.equal(searchGET(request("search?zip=01001")).status, 400);
  assert.equal(searchGET(request("search?zip=02554")).status, 400);
});

test("published NJ ZIP coverage accepts reviewed localities and rejects excluded or unrecognized ZIPs without claiming pending", async () => {
  const market = getMarket("north-jersey")!;
  assert.ok(market, "The NJ snapshot is published");
  for (const zip of ["07083", "07960", "08812"]) {
    assert.ok(Object.hasOwn(market.zips, zip), zip);
    const response = searchGET(request(`search?zip=${zip}&radius=10`));
    assert.equal(response.status, 200, zip);
    const result = await response.json();
    assert.equal(result.market.id, "north-jersey");
    assert.deepEqual(result.origin, { zip, ...market.zips[zip] });
    assert.ok(result.providers.length > 0, zip);
    assert.ok(
      result.providers.every((provider: Provider) => provider.state === "NJ"),
    );
  }
  for (const zip of ["08002", "08901", "07000"]) {
    const response = searchGET(request(`search?zip=${zip}`));
    assert.equal(response.status, 400, zip);
    const { error } = await response.json();
    assert.match(error, /not recognized.*published North Jersey coverage/i);
    assert.doesNotMatch(error, /pending/i);
  }
});

test("published Whippany postal ZIP retains its source origin and NJ scope without requiring nearby results", async () => {
  const zip = "07999";
  const market = getMarket("north-jersey")!;
  assert.deepEqual(market.zips[zip], retainedNJZips[zip]);
  const response = searchGET(request(`search?zip=${zip}&radius=10`));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.market.id, "north-jersey");
  assert.equal(result.market.state, "NJ");
  assert.deepEqual(result.origin, { zip, ...retainedNJZips[zip] });
  assert.ok(
    result.providers.every((provider: Provider) => provider.state === "NJ"),
  );
});

test("global saved-ID lookup preserves caller order, deduplicates and optionally filters ownership", () => {
  const ids = [njProvider.id, nursing.id, njProvider.id, "retired"];
  assert.deepEqual(
    getProvidersByIds(ids, undefined, registry).map((provider) => provider.id),
    [njProvider.id, nursing.id],
  );
  assert.deepEqual(
    getProvidersByIds(ids, "north-jersey", registry).map(
      (provider) => provider.id,
    ),
    [njProvider.id],
  );
  assert.deepEqual(
    getProvidersByIds(ids, "massachusetts", registry).map(
      (provider) => provider.id,
    ),
    [nursing.id],
  );
  assert.equal(getProviderMarket(njProvider.id, registry)?.id, "north-jersey");
});

test("custom saved-ID lookup follows live records and first valid ownership without retaining stale entries", () => {
  const id = "custom-lookup";
  const first = { ...nursing, id, name: "First valid MA record" };
  const duplicate = { ...first, name: "Later MA duplicate" };
  const other = { ...njProvider, id, name: "NJ duplicate" };
  const customMA = { ...ma, providers: [{ ...other }, first, duplicate] };
  const customNJ = { ...nj, providers: [other] };
  const custom = [customMA, customNJ];
  const ids = Object.freeze([id, "missing", id]);
  const names = (marketId?: string) =>
    getProvidersByIds(ids, marketId, custom).map((provider) => provider.name);
  assert.deepEqual(names(), [first.name]);
  assert.deepEqual(names("north-jersey"), []);
  assert.equal(getProviderMarket(id, custom), customMA);
  custom.reverse();
  assert.deepEqual(names(), [other.name]);
  assert.deepEqual(names("massachusetts"), []);
  other.state = "MA";
  assert.deepEqual(names(), [first.name]);
  first.id = "renamed";
  assert.deepEqual(names(), [duplicate.name]);
  customMA.providers = [];
  assert.deepEqual(names(), []);
  other.state = "NJ";
  assert.deepEqual(names(), [other.name]);
  const result = getProvidersByIds(ids, undefined, custom);
  result[0].name = "Caller edit";
  assert.deepEqual(names(), [other.name]);
  assert.deepEqual(ids, [id, "missing", id]);
});

test("absent NJ evidence stays absent even when the Massachusetts snapshot contains the same lookup key", () => {
  const contaminatedMA: MarketSnapshot = {
    ...ma,
    locationResearch: {
      ...ma.locationResearch,
      [njProvider.id]: ma.locationResearch![nursing.id],
    },
    facebookResearch: {
      ...ma.facebookResearch!,
      locations: {
        ...ma.facebookResearch!.locations,
        [njProvider.id]: Object.values(ma.facebookResearch!.locations)[0],
      },
    },
    inspectionHistory: {
      ...ma.inspectionHistory!,
      facilities: {
        ...ma.inspectionHistory!.facilities,
        "319999": ma.inspectionHistory!.facilities["225268"],
      },
    },
  };
  const contaminated = createMarketRegistry([contaminatedMA, nj]);
  const absent = getLocationResearch(njProvider.id, undefined, contaminated);
  assert.equal(absent.providerId, njProvider.id);
  assert.equal(absent.checkedAt, null);
  assert.equal(absent.providerDetailsReviewed, false);
  assert.deepEqual(absent.sources, []);
  assert.deepEqual(absent.facts, []);
  assert.deepEqual(absent.reviews, []);
  assert.deepEqual(absent.reviewAggregates, []);
  assert.equal(absent.facebookResearch, undefined);
  assert.equal(absent.experience.value, null);
  assert.equal(absent.availability.status, "not-published");
  assert.equal(absent.availability.sourceId, null);
  assert.equal(absent.availability.asOf, null);
  assert.throws(
    () => getLocationResearch("unknown-provider", undefined, contaminated),
    (error) => error instanceof ResearchInputError && error.status === 404,
  );
  assert.equal(getResearchSummary(njProvider.id, contaminated), undefined);
  assert.equal(getFacebookResearch(njProvider.id, contaminated), undefined);
  assert.throws(
    () => getInspectionEvidence("319999", 5, contaminated),
    (error) => error instanceof EvidenceInputError && error.status === 404,
  );
  assert.throws(
    () => getHomeHealthEvidence(njProvider.id, contaminated),
    (error) => error instanceof HomeHealthEvidenceError && error.status === 404,
  );
});

test("NJ research, Facebook provenance and inspection metadata come only from the owning snapshot", () => {
  const sourceRecord = ma.locationResearch![nursing.id];
  const location: LocationResearch = {
    ...sourceRecord,
    providerId: njProvider.id,
    sources: [],
    facts: [],
    reviews: [],
    reviewAggregates: [],
  };
  const facebookLocation = Object.values(ma.facebookResearch!.locations)[0];
  const researchedNJ: MarketSnapshot = {
    ...nj,
    locationResearch: { [njProvider.id]: location, [nursing.id]: sourceRecord },
    facebookResearch: {
      ...ma.facebookResearch!,
      runId: "injected-nj-run",
      checkedAt: "2026-10-01",
      reviewBasis: "Injected NJ regression evidence",
      locations: {
        [njProvider.id]: facebookLocation,
        [nursing.id]: facebookLocation,
      },
    },
    inspectionHistory: {
      ...ma.inspectionHistory!,
      retrieved: "2026-10-01",
      sources: [],
      facilities: { "319999": { healthCitations: null, penalties: null } },
    },
  };
  const scoped = createMarketRegistry([ma, researchedNJ]);
  const detail = getLocationResearch(njProvider.id, "2026-11-12", scoped);
  assert.equal(detail.providerId, njProvider.id);
  assert.equal(detail.experience.value, null);
  assert.equal(detail.facebookResearch?.runId, "injected-nj-run");
  assert.equal(detail.facebookResearch?.checkedAt, "2026-10-01");
  const facebookOnly = createMarketRegistry([
    ma,
    { ...researchedNJ, locationResearch: undefined },
  ]);
  const facebookOnlyDetail = getLocationResearch(
    njProvider.id,
    "2026-11-12",
    facebookOnly,
  );
  assert.deepEqual(
    facebookOnlyDetail.facebookResearch,
    detail.facebookResearch,
  );
  assert.equal(facebookOnlyDetail.checkedAt, null);
  assert.equal(facebookOnlyDetail.experience.value, null);
  assert.equal(facebookOnlyDetail.experience.reviewCount, 0);
  assert.deepEqual(facebookOnlyDetail.experience.includedSources, []);
  assert.equal(
    getResearchSummary(njProvider.id, facebookOnly)?.facebookResearch
      ?.findingCount,
    facebookLocation.findings.length,
  );
  assert.equal(getFacebookResearch(nursing.id, scoped)?.runId, undefined);
  const inspection = getInspectionEvidence("319999", 5, scoped);
  assert.equal(inspection.providerId, njProvider.id);
  assert.equal(inspection.retrieved, "2026-10-01");
  assert.deepEqual(inspection.sources, []);
  assert.equal(inspection.healthCitations.available, false);
  assert.equal(inspection.healthCitations.total, null);
  assert.equal(inspection.penalties.fineCount, null);
});

test("coverage includes unresearched NJ providers as gaps without borrowing Massachusetts scores", () => {
  assert.throws(
    () =>
      createMarketRegistry([
        ma,
        { ...nj, providers: [...nj.providers, nursing] },
      ]),
    /state/,
  );
  const scoped = createMarketRegistry([ma, nj]);
  const coverage = getResearchCoverage("2026-11-12", "north-jersey", scoped);
  assert.equal(coverage.market.id, "north-jersey");
  assert.equal(coverage.total, 1);
  assert.equal(coverage.scored, 0);
  assert.equal(coverage.unscored, 1);
  assert.equal(coverage.facebookCovered, 0);
  assert.deepEqual(coverage.locations[0].ratingSourceUrls, []);
  assert.equal(coverage.locations[0].facebookStatus, "not-searched");
  assert.equal(coverage.locations[0].status, "no-rating-evidence");
  assert.equal(coverage.locations[0].providerId, njProvider.id);
});

test("NJ home-health evidence uses its exact reporting unit and never labels a state comparator Massachusetts", () => {
  const maEvidence = getHomeHealthEvidence("vna-care");
  const maAgency = maEvidence.agencies[0];
  const agencyId = "cms-319998";
  const provider: Provider = {
    ...njProvider,
    id: agencyId,
    category: "home-health",
    cms: { ...njProvider.cms!, ccn: "319998" },
  };
  const stateComparator = {
    ...maEvidence.patientExperienceComparators.massachusetts!,
    sourceFile: "injected-nj-state-source",
  };
  const withHealth: MarketSnapshot = {
    ...nj,
    providers: [provider],
    homeHealthEvidence: {
      ...maEvidence,
      retrieved: "2026-10-01",
      agencies: [
        maAgency,
        {
          ...maAgency,
          ccn: "319998",
          organizationId: agencyId,
          cmsAddress: { ...maAgency.cmsAddress, state: "NJ" },
        },
        { ...maAgency, ccn: "319998", organizationId: agencyId },
        {
          ...maAgency,
          organizationId: agencyId,
          cmsAddress: { ...maAgency.cmsAddress, state: "NJ" },
        },
      ],
      patientExperienceComparators: {
        ...maEvidence.patientExperienceComparators,
        nj: stateComparator,
      },
    },
  };
  const scoped = createMarketRegistry([ma, withHealth]);
  const result = getHomeHealthEvidence(agencyId, scoped);
  assert.deepEqual(
    result.agencies.map((agency) => agency.ccn),
    ["319998"],
  );
  assert.equal(result.retrieved, "2026-10-01");
  assert.equal(result.patientExperienceComparators.massachusetts, undefined);
  assert.equal(result.patientExperienceComparators.state?.code, "NJ");
  assert.equal(result.patientExperienceComparators.state?.label, "New Jersey");
  assert.deepEqual(result.patientExperienceComparators.nj, stateComparator);
  assert.equal(
    result.patientExperienceComparators.state?.sourceFile,
    "injected-nj-state-source",
  );
  const noNJState = createMarketRegistry([
    ma,
    {
      ...withHealth,
      homeHealthEvidence: {
        ...withHealth.homeHealthEvidence!,
        patientExperienceComparators: maEvidence.patientExperienceComparators,
      },
    },
  ]);
  assert.equal(
    getHomeHealthEvidence(agencyId, noNJState).patientExperienceComparators
      .state,
    undefined,
  );
  assert.equal(
    getHomeHealthEvidence(agencyId, noNJState).patientExperienceComparators
      .massachusetts,
    undefined,
  );
  const mismatchedCCN = createMarketRegistry([
    ma,
    {
      ...withHealth,
      homeHealthEvidence: {
        ...withHealth.homeHealthEvidence!,
        agencies: [
          {
            ...maAgency,
            organizationId: agencyId,
            cmsAddress: { ...maAgency.cmsAddress, state: "NJ" },
          },
        ],
      },
    },
  ]);
  assert.throws(
    () => getHomeHealthEvidence(agencyId, mismatchedCCN),
    (error) => error instanceof HomeHealthEvidenceError && error.status === 404,
  );
});

test("registry rejects market collisions, ambiguous ZIPs and rewritten or duplicate CMS identities", () => {
  assert.throws(() => createMarketRegistry([ma, ma]), /duplicate/);
  assert.throws(
    () =>
      createMarketRegistry([ma, { ...nj, zips: ma.zips, defaultZip: "02459" }]),
    /ambiguous/,
  );
  assert.throws(
    () =>
      createMarketRegistry([
        ma,
        { ...nj, providers: [{ ...njProvider, id: nursing.id }] },
      ]),
    /globally unique/,
  );
  assert.throws(
    () =>
      createMarketRegistry([
        ma,
        { ...nj, providers: [{ ...njProvider, id: "nj-cms-319999" }] },
      ]),
    /CMS IDs/,
  );
  assert.throws(
    () =>
      createMarketRegistry([
        { ...nj, zips: { ...nj.zips, "07030": { ...njPoint, lat: NaN } } },
      ]),
    /ZIP/,
  );
  assert.throws(
    () => createMarketRegistry([{ ...nj, defaultZip: "07999" }]),
    /snapshot/,
  );
});

test("actual search and coverage APIs return reviewed NJ data or truthful pending responses", async () => {
  const maResponse = searchGET(request("search?zip=02459&radius=10"));
  assert.equal(maResponse.status, 200);
  const maBody = await maResponse.json();
  assert.equal(maBody.market.id, "massachusetts");
  assert.equal(
    maBody.catalogTotal,
    ma.providers.filter((provider) => provider.state === "MA").length,
  );
  const liveNJ = getMarket("north-jersey");
  const njResponse = searchGET(
    request(`search?zip=${liveNJ?.defaultZip ?? "07030"}`),
  );
  const coverage = coverageGET(
    request("research-coverage?market=north-jersey"),
  );
  if (!liveNJ) {
    assert.equal(njResponse.status, 400);
    assert.match((await njResponse.json()).error, /North Jersey.*pending/);
    assert.equal(coverage.status, 404);
    assert.match((await coverage.json()).error, /No reviewed.*market/);
  } else {
    assert.equal(njResponse.status, 200);
    const body = await njResponse.json();
    assert.equal(body.market.id, "north-jersey");
    assert.equal(body.asOf, liveNJ.meta.asOf);
    assert.equal(
      body.catalogTotal,
      liveNJ.providers.filter((provider) => provider.state === "NJ").length,
    );
    assert.ok(
      body.providers.every((provider: Provider) => provider.state === "NJ"),
    );
    assert.equal(coverage.status, 200);
    assert.equal((await coverage.json()).market.id, "north-jersey");
    const provider = liveNJ.providers.find(
      (record) =>
        record.state === "NJ" &&
        record.category === "nursing-home" &&
        record.cms,
    )!;
    assert.ok(provider);
    assert.equal(provider.id, `cms-${provider.cms!.ccn}`);
    const ids = `${provider.id},${nursing.id},${provider.id}`;
    const saved = await providersGET(request(`providers?ids=${ids}`)).json();
    assert.deepEqual(
      saved.providers.map((record: Provider) => record.id),
      [provider.id, nursing.id],
    );
    const savedNJ = await providersGET(
      request(`providers?ids=${ids}&market=north-jersey`),
    ).json();
    assert.deepEqual(
      savedNJ.providers.map((record: Provider) => record.id),
      [provider.id],
    );
    assert.equal(
      researchGET(request(`research?id=${provider.id}`)).status,
      200,
    );
    assert.equal(
      inspectionGET(request(`evidence?ccn=${provider.cms!.ccn}`)).status,
      liveNJ.inspectionHistory ? 200 : 404,
    );
    assert.equal(
      homeHealthGET(request(`home-health-evidence?providerId=${provider.id}`))
        .status,
      404,
    );
    const csv = coverageGET(
      request("research-coverage?market=north-jersey&format=csv"),
    );
    assert.equal(csv.status, 200);
    assert.match(
      csv.headers.get("content-disposition")!,
      /harbor-experience-research-north-jersey-/,
    );
    const csvBody = await csv.text();
    assert.equal(csvBody.split("\r\n").length, liveNJ.providers.length + 2);
    assert.ok(!csvBody.includes(`"${nursing.id}"`));
  }
});

test("actual API handlers reject duplicate, unknown, malformed and cross-market selectors", async () => {
  for (const query of [
    "zip=02459&zip=07030",
    "zip=ABCDE",
    "zip=02100",
    "zip=10001",
    "radius=51",
    "market=north-jersey",
  ]) {
    assert.equal(searchGET(request(`search?${query}`)).status, 400, query);
  }
  for (const query of [
    "ids=cms-225268&ids=cms-225268",
    "ids=cms-225268&market=invalid",
    "ids=cms-225268&market=massachusetts&market=north-jersey",
    "ids=cms-225268&extra=1",
  ]) {
    assert.equal(
      providersGET(request(`providers?${query}`)).status,
      400,
      query,
    );
  }
  const filtered = await providersGET(
    request("providers?ids=cms-225268&market=north-jersey"),
  ).json();
  assert.deepEqual(filtered.providers, []);
  assert.equal(
    (
      await providersGET(
        request("providers?ids=cms-225268&market=massachusetts"),
      ).json()
    ).providers[0].id,
    "cms-225268",
  );
  for (const query of [
    "market=invalid",
    "market=",
    "market=massachusetts&market=north-jersey",
    "market=massachusetts&format=csv&format=json",
  ]) {
    assert.equal(
      coverageGET(request(`research-coverage?${query}`)).status,
      400,
      query,
    );
  }
  const csv = coverageGET(
    request("research-coverage?market=massachusetts&format=csv"),
  );
  assert.equal(csv.status, 200);
  assert.match(
    csv.headers.get("content-disposition")!,
    /harbor-experience-research-massachusetts-\d{4}-\d{2}-\d{2}\.csv/,
  );
  assert.equal(
    researchGET(request(`research?id=${njProvider.id}`)).status,
    404,
  );
  assert.equal(inspectionGET(request("evidence?ccn=319999")).status, 404);
  assert.equal(
    homeHealthGET(request(`home-health-evidence?providerId=${njProvider.id}`))
      .status,
    404,
  );
  assert.equal(
    inspectionGET(request("evidence?ccn=225268&providerId=cms-319999")).status,
    400,
  );
});
