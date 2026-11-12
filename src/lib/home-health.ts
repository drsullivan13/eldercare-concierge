import { getProviderMarket, markets, type MarketRegistry } from "./markets";
import type { Market } from "./market-types";

export type HomeHealthMetric = {
  value: number | null;
  unit: string;
  sourceColumn: string;
  rawValue: string | null;
  footnoteCodes: string[];
  rawFootnote: string;
  status: "published" | "not published";
};
type HomeHealthPeriod = { start: string; end: string; label: string };
type HomeHealthSource = {
  url: string;
  publisher: string;
  checkedAt: string;
  releasedAt: string;
  datasetId?: string;
  title?: string;
  downloadUrl?: string;
  modified?: string | null;
};
type HomeHealthSurveyMeasure = {
  id: string;
  label: string;
  percent: HomeHealthMetric;
  starRating?: HomeHealthMetric | null;
};
type HomeHealthClinicalComponent = {
  id: string;
  label: string;
  rate: HomeHealthMetric;
  period: HomeHealthPeriod;
  betterDirection: "higher" | "lower";
  dateSourceMeasureName: string;
  dateSourceRawRange: string;
  publishedNumerator?: HomeHealthMetric;
  publishedDenominator?: HomeHealthMetric;
  calculationNote?: string;
};
type HomeHealthAgency = {
  ccn: string;
  organizationId: string;
  organizationName: string;
  cmsProviderName: string;
  cmsAddress: { street: string; city: string; state: string; zip: string };
  scope: string;
  releasedAt: string;
  checkedAt: string;
  qualityOfPatientCare: {
    starRating: HomeHealthMetric;
    starComponentPeriod: HomeHealthPeriod;
    components: HomeHealthClinicalComponent[];
    datasetId: string;
    measurementPeriodNote: string;
    measureDateRangesFile: string;
    rawUnitRowFile: string;
    componentDefinitionSource?: string;
    componentPeriodSource?: string;
  };
  patientExperience: {
    datasetId: string;
    period: HomeHealthPeriod;
    summaryStarRating: HomeHealthMetric;
    completedSurveys: HomeHealthMetric;
    responseRate: HomeHealthMetric;
    generalFootnoteCodes: string[];
    rawGeneralFootnote: string;
    measures: HomeHealthSurveyMeasure[];
    rawUnitRowFile: string;
  };
  sources: HomeHealthSource[];
  warnings: string[];
};
type HomeHealthSurveyComparator = {
  period: HomeHealthPeriod;
  releasedAt: string;
  measures: HomeHealthSurveyMeasure[];
  completedSurveys: HomeHealthMetric;
  responseRate: HomeHealthMetric;
  sourceFile: string;
};
export type HomeHealthEvidenceResponse = {
  providerId: string;
  schemaVersion: number;
  retrieved: string;
  releasedAt: string;
  sources: HomeHealthSource[];
  agencies: HomeHealthAgency[];
  clinicalMeasureDateRanges: { measure: string; rawPeriod: string }[];
  surveyMeasureDateRanges: { measure: string; rawPeriod: string }[];
  patientExperienceComparators: {
    massachusetts?: HomeHealthSurveyComparator;
    ma?: HomeHealthSurveyComparator;
    nj?: HomeHealthSurveyComparator;
    "north-jersey"?: HomeHealthSurveyComparator;
    state?: HomeHealthSurveyComparator & { code: string; label: string };
    national: HomeHealthSurveyComparator;
  };
  footnoteDefinitions: Record<string, string>;
  interpretationRules: string[];
};
export type HomeHealthEvidenceSnapshot = Omit<
  HomeHealthEvidenceResponse,
  "providerId"
>;

/** Verified catalog identity -> exact CMS reporting entities; never a network average. */
export const HOME_HEALTH_PROVIDER_CCNS = {
  "vna-care": ["227068", "227098"],
  "south-shore-vna": ["227082"],
  "mgb-home-care": ["227207"],
  "croi-health": ["227241"],
  "all-care": ["227263"],
  "bilh-at-home": ["227495"],
} as const;
type HomeHealthProviderId = keyof typeof HOME_HEALTH_PROVIDER_CCNS;
export class HomeHealthEvidenceError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "HomeHealthEvidenceError";
  }
}
export function getHomeHealthEvidence(
  providerId: string,
  registry: MarketRegistry = markets,
): HomeHealthEvidenceResponse {
  if (
    typeof providerId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId) ||
    providerId.length > 100
  ) {
    throw new HomeHealthEvidenceError("Supply one exact catalog provider ID.");
  }
  const market = getProviderMarket(providerId, registry);
  const snapshot = market?.homeHealthEvidence;
  const provider = market?.providers.find(
    (record) => record.id === providerId && record.state === market.state,
  );
  const maIdentity =
    market?.id === "massachusetts" &&
    Object.hasOwn(HOME_HEALTH_PROVIDER_CCNS, providerId);
  const regionalCcn =
    market?.id !== "massachusetts" && provider?.category === "home-health"
      ? /^cms-(\d{6})$/.exec(provider.id)?.[1]
      : undefined;
  const expected: readonly string[] = maIdentity
    ? HOME_HEALTH_PROVIDER_CCNS[providerId as HomeHealthProviderId]
    : regionalCcn
      ? [regionalCcn]
      : [];
  const matched =
    snapshot?.agencies.filter(
      (agency) =>
        agency.organizationId === providerId &&
        agency.cmsAddress.state === market?.state &&
        expected.includes(agency.ccn),
    ) ?? [];
  if (
    !market ||
    !snapshot ||
    !expected.length ||
    (market.id !== "massachusetts" && !matched.length)
  ) {
    throw new HomeHealthEvidenceError(
      "No matched CMS home-health evidence is available for this provider in the retained snapshot.",
      404,
    );
  }
  const agencies = matched.sort((a, b) => a.ccn.localeCompare(b.ccn));
  if (
    agencies.length !== expected.length ||
    new Set(agencies.map((agency) => agency.ccn)).size !== expected.length
  )
    throw new Error(
      "Home-health evidence snapshot does not match its verified identity allowlist.",
    );
  const comparators = snapshot.patientExperienceComparators;
  const state = stateComparator(comparators, market);
  return {
    ...snapshot,
    providerId,
    agencies,
    patientExperienceComparators: {
      national: comparators.national,
      ...(market.state === "MA" && comparators.massachusetts
        ? { massachusetts: comparators.massachusetts }
        : {}),
      ...(market.state === "MA" && comparators.ma
        ? { ma: comparators.ma }
        : {}),
      ...(market.state === "NJ" && comparators.nj
        ? { nj: comparators.nj }
        : {}),
      ...(state ? { state } : {}),
    },
  };
}

function stateComparator(
  comparators: HomeHealthEvidenceResponse["patientExperienceComparators"],
  market: Market,
) {
  const comparator =
    comparators.state?.code === market.state
      ? comparators.state
      : market.state === "NJ"
        ? (comparators.nj ?? comparators["north-jersey"])
        : (comparators.ma ?? comparators.massachusetts);
  if (!comparator) return undefined;
  return {
    ...comparator,
    code: market.state,
    label: market.state === "NJ" ? "New Jersey" : "Massachusetts",
  };
}
