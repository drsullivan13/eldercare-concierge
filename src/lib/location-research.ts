import researchData from "@/data/location-research.json";
import { computeExperienceScore } from "./experience-score";
import { getFacebookResearch, getFacebookSummary } from "./facebook-research";
import type {
  LocationResearch,
  LocationResearchResponse,
  ResearchSummary,
} from "./location-research-types";

const records = researchData as Record<string, LocationResearch>;
export class ResearchInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
  }
}
export function getLocationResearch(
  providerId: string,
  asOfDate = new Date().toISOString().slice(0, 10),
): LocationResearchResponse {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId) || providerId.length > 150)
    throw new ResearchInputError("Supply one exact provider ID.");
  if (!Object.hasOwn(records, providerId))
    throw new ResearchInputError(
      "This provider is not in the Boston research catalog.",
      404,
    );
  const record = records[providerId];
  return {
    ...record,
    facebookResearch: getFacebookResearch(providerId),
    experience: computeExperienceScore({
      sources: record.sources,
      reviewAggregates: record.reviewAggregates,
      reviews: record.reviews,
      asOfDate,
    }),
  };
}
export function getResearchSummary(
  providerId: string,
): ResearchSummary | undefined {
  if (!Object.hasOwn(records, providerId)) return undefined;
  const record = getLocationResearch(providerId);
  const { value, reviewCount, confidence, independentSourceCount } =
    record.experience;
  const source = record.sources.find(
    (s) => s.id === record.availability.sourceId,
  );
  return {
    facebookResearch: getFacebookSummary(providerId),
    detailsAvailable: record.providerDetailsReviewed,
    publishedCosts: record.facts.filter(
      (f) => f.kind === "cost" && f.amount && f.amount.min > 0,
    ).length,
    availabilityStatus: record.availability.status,
    availabilityCheckedAt: source?.checkedAt ?? null,
    admissionRestriction: record.admissionRestriction?.text,
    experience: { value, reviewCount, confidence, independentSourceCount },
  };
}
