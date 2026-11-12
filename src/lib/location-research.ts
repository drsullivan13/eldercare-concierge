import { getProviderMarket, markets, type MarketRegistry } from "./markets";
import {
  computeExperienceScore,
  type ExperienceSummary,
} from "./experience-score";
import {
  getFacebookResearch,
  getFacebookSummary,
  getFamilyExperience,
} from "./facebook-research";
import type {
  LocationResearch,
  LocationResearchResponse,
  ResearchSummary,
} from "./location-research-types";

export class ResearchInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
  }
}
function validateProviderId(providerId: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId) || providerId.length > 150)
    throw new ResearchInputError("Supply one exact provider ID.");
}

function scoreLocation(
  record: LocationResearch,
  asOfDate = new Date().toISOString().slice(0, 10),
): ExperienceSummary {
  const { sources, reviewAggregates, reviews } = record;
  return computeExperienceScore({
    sources,
    reviewAggregates,
    reviews,
    reviewSamples: record.reviewSamples,
    asOfDate,
  });
}

export function getLocationResearch(
  providerId: string,
  asOfDate?: string,
  registry: MarketRegistry = markets,
): LocationResearchResponse {
  validateProviderId(providerId);
  const market = getProviderMarket(providerId, registry);
  if (!market)
    throw new ResearchInputError("No catalog provider matches this ID.", 404);
  const records = market.locationResearch;
  const record: LocationResearch =
    records && Object.hasOwn(records, providerId)
      ? records[providerId]
      : {
          providerId,
          checkedAt: null,
          providerDetailsReviewed: false,
          sources: [],
          facts: [],
          reviews: [],
          reviewAggregates: [],
          availability: {
            status: "not-published",
            text: "Current availability has not been researched for this location. Contact the provider to confirm openings and waitlist timing.",
            sourceId: null,
            asOf: null,
          },
          notes: [
            "No retained location research is available for this catalog provider. Missing evidence does not imply poor care or that no public information exists.",
          ],
        };
  return {
    ...record,
    familyExperience: getFamilyExperience(providerId, registry),
    facebookResearch: getFacebookResearch(providerId, registry),
    experience: scoreLocation(record, asOfDate),
  };
}
export function getResearchSummary(
  providerId: string,
  registry: MarketRegistry = markets,
): ResearchSummary | undefined {
  const records = getProviderMarket(providerId, registry)?.locationResearch;
  if (!records || !Object.hasOwn(records, providerId)) {
    const facebookResearch = getFacebookSummary(providerId, registry);
    if (!facebookResearch) return undefined;
    return {
      familyExperience: getFamilyExperience(providerId, registry),
      facebookResearch,
      detailsAvailable: false,
      publishedCosts: 0,
      availabilityStatus: "not-published",
      availabilityCheckedAt: null,
      experience: {
        value: null,
        reviewCount: 0,
        confidence: "unrated",
        independentSourceCount: 0,
      },
    };
  }
  validateProviderId(providerId);
  const record = records[providerId];
  const {
    value,
    reviewCount,
    confidence,
    independentSourceCount,
    publicationStatus,
    selectedConcerns,
    singleSourceLabel,
  } = scoreLocation(record);
  const source = record.sources.find(
    (s) => s.id === record.availability.sourceId,
  );
  return {
    familyExperience: getFamilyExperience(providerId, registry),
    facebookResearch: getFacebookSummary(providerId, registry),
    detailsAvailable: record.providerDetailsReviewed,
    publishedCosts: record.facts.filter(
      (f) => f.kind === "cost" && f.amount && f.amount.min > 0,
    ).length,
    availabilityStatus: record.availability.status,
    availabilityCheckedAt: source?.checkedAt ?? null,
    admissionRestriction: record.admissionRestriction?.text,
    experience: {
      value,
      reviewCount,
      confidence,
      independentSourceCount,
      publicationStatus,
      selectedConcerns,
      singleSourceLabel,
    },
  };
}
