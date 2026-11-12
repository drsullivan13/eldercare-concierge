import evidenceData from '@/data/home-health-evidence.json';

export type HomeHealthMetric = {
  value: number | null;
  unit: string;
  sourceColumn: string;
  rawValue: string | null;
  footnoteCodes: string[];
  rawFootnote: string;
  status: 'published' | 'not published';
};
export type HomeHealthPeriod = { start: string; end: string; label: string };
export type HomeHealthSource = {
  url: string;
  publisher: string;
  checkedAt: string;
  releasedAt: string;
  datasetId?: string;
  title?: string;
  downloadUrl?: string;
  modified?: string | null;
};
export type HomeHealthSurveyMeasure = {
  id: string;
  label: string;
  percent: HomeHealthMetric;
  starRating?: HomeHealthMetric | null;
};
export type HomeHealthClinicalComponent = {
  id: string;
  label: string;
  rate: HomeHealthMetric;
  period: HomeHealthPeriod;
  betterDirection: 'higher' | 'lower';
  dateSourceMeasureName: string;
  dateSourceRawRange: string;
  publishedNumerator?: HomeHealthMetric;
  publishedDenominator?: HomeHealthMetric;
  calculationNote?: string;
};
export type HomeHealthAgency = {
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
export type HomeHealthSurveyComparator = {
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
  patientExperienceComparators: { massachusetts: HomeHealthSurveyComparator; national: HomeHealthSurveyComparator };
  footnoteDefinitions: Record<string, string>;
  interpretationRules: string[];
};

/** Verified catalog identity -> exact CMS reporting entities; never a network average. */
export const HOME_HEALTH_PROVIDER_CCNS = {
  'vna-care': ['227068', '227098'],
  'south-shore-vna': ['227082'],
  'mgb-home-care': ['227207'],
  'croi-health': ['227241'],
  'all-care': ['227263'],
  'bilh-at-home': ['227495'],
} as const;
export type HomeHealthProviderId = keyof typeof HOME_HEALTH_PROVIDER_CCNS;
export class HomeHealthEvidenceError extends Error {
  constructor(message: string, public readonly status: 400 | 404 = 400) {
    super(message);
    this.name = 'HomeHealthEvidenceError';
  }
}
const snapshot = evidenceData as Omit<HomeHealthEvidenceResponse, 'providerId'>;

export function getHomeHealthEvidence(providerId: string): HomeHealthEvidenceResponse {
  if (typeof providerId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId) || providerId.length > 100) {
    throw new HomeHealthEvidenceError('Supply one exact catalog provider ID.');
  }
  if (!Object.hasOwn(HOME_HEALTH_PROVIDER_CCNS, providerId)) {
    throw new HomeHealthEvidenceError('No matched CMS home-health evidence is available for this provider in the retained snapshot.', 404);
  }
  const expected: readonly string[] = HOME_HEALTH_PROVIDER_CCNS[providerId as HomeHealthProviderId];
  const agencies = snapshot.agencies.filter(agency => agency.organizationId === providerId && expected.includes(agency.ccn)).sort((a, b) => a.ccn.localeCompare(b.ccn));
  if (agencies.length !== expected.length || new Set(agencies.map(agency => agency.ccn)).size !== expected.length) throw new Error('Home-health evidence snapshot does not match its verified identity allowlist.');
  return { ...snapshot, providerId, agencies };
}
