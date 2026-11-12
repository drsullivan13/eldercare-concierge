import facebookData from "@/data/facebook-research.json";

export type FacebookFindingKind =
  | "resident-family"
  | "recommendation"
  | "tour"
  | "provider-promotion"
  | "employment";

export type FacebookFinding = {
  id: string;
  sourceObservationIds: string[];
  kind: FacebookFindingKind;
  relationship: string | null;
  summary: string;
  date: string | null;
  sourceUrl: string;
  sourceUrls?: string[];
  threadUrl: string;
  topics: string[];
  limitations: string[];
};

export type FacebookResearchLocation = {
  status: "findings-available" | "no-relevant-result" | "withheld" | "partial";
  searchedAt: string | null;
  foundCount: number;
  publishedObservationCount: number;
  withheldCount: number;
  coverageExplanation: string;
  findings: FacebookFinding[];
};

export type FacebookResearchDataset = {
  schemaVersion: 1;
  runId: string;
  checkedAt: string;
  reviewBasis: string;
  locations: Record<string, FacebookResearchLocation>;
};

export type FacebookResearch = FacebookResearchLocation & {
  providerId: string;
  runId: string;
  checkedAt: string;
  reviewBasis: string;
};

export type FacebookSummary = Pick<
  FacebookResearchLocation,
  | "status"
  | "searchedAt"
  | "foundCount"
  | "publishedObservationCount"
  | "withheldCount"
> & { findingCount: number };

const dataset = facebookData as unknown as FacebookResearchDataset;

// This curated snapshot is separate from review aggregates and the score policy.
// An absent location means not searched in this pilot, never "no Facebook reviews".
export function getFacebookResearch(
  providerId: string,
): FacebookResearch | undefined {
  if (!Object.hasOwn(dataset.locations, providerId)) return undefined;
  const location = dataset.locations[providerId];
  return {
    providerId,
    runId: dataset.runId,
    checkedAt: dataset.checkedAt,
    reviewBasis: dataset.reviewBasis,
    status: location.status,
    searchedAt: location.searchedAt,
    foundCount: location.foundCount,
    publishedObservationCount: location.publishedObservationCount,
    withheldCount: location.withheldCount,
    coverageExplanation: location.coverageExplanation,
    findings: location.findings,
  };
}

export function getFacebookSummary(
  providerId: string,
): FacebookSummary | undefined {
  const research = getFacebookResearch(providerId);
  if (!research) return undefined;
  const {
    status,
    searchedAt,
    foundCount,
    publishedObservationCount,
    withheldCount,
  } = research;
  return {
    status,
    searchedAt,
    foundCount,
    publishedObservationCount,
    withheldCount,
    findingCount: research.findings.length,
  };
}
