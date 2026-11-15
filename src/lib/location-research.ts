import { getProviderEntry, markets, type MarketRegistry } from "./markets";
import { njHomeHealthSurvey } from "./home-health";
import { getReviewCatalog } from "./review-catalog";
import { getDailyLifeResearch } from "./daily-life";
import { getNursingStaffingResearch } from "./nursing-staffing";
import { getHomeCareOfficeIdentifiers } from "./home-care-office-identifiers";
import { getRegistrationFacts } from "./registration-facts";
import { getOfficeDirectoryResearch } from "./office-directory-research";
import { individualReviews, reviewAccountCounts } from "./individual-reviews";
import {
  computeExperienceScore,
  type ExperienceSummary,
} from "./experience-score";
import { publicExperience } from "./public-experience";
import {
  getFacebookResearch,
  getFacebookSummary,
  getFamilyExperience,
} from "./facebook-research";
import {
  emptyLocationResearch,
  type LocationResearch,
  type InternalLocationResearchResponse,
  type ResearchSummary,
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

const individualReviewCountCache = new Map<
  string,
  {
    record: LocationResearch | undefined;
    counts: ResearchSummary["individualReviews"];
  }
>();

function individualReviewSummary(
  providerId: string,
  record: LocationResearch | undefined,
  registry: MarketRegistry,
): ResearchSummary["individualReviews"] {
  if (registry !== markets) {
    return record
      ? reviewAccountCounts(individualReviews(record, null).accounts)
      : undefined;
  }
  const cached = individualReviewCountCache.get(providerId);
  if (cached && cached.record === record)
    return cached.counts && { ...cached.counts };
  const catalog = getReviewCatalog(providerId);
  const counts =
    record || catalog
      ? reviewAccountCounts(
          individualReviews(record ?? getLocationResearch(providerId), catalog)
            .accounts,
        )
      : undefined;
  individualReviewCountCache.set(providerId, { record, counts });
  return counts && { ...counts };
}

export function getLocationResearch(
  providerId: string,
  asOfDate?: string,
  registry: MarketRegistry = markets,
): InternalLocationResearchResponse {
  validateProviderId(providerId);
  const entry = getProviderEntry(providerId, registry);
  if (!entry)
    throw new ResearchInputError("No catalog provider matches this ID.", 404);
  const { market, provider } = entry;
  const records = market.locationResearch;
  const publishedOffice =
    registry === markets &&
    market.id === "north-jersey" &&
    provider.category === "home-care";
  const record: LocationResearch =
    records && Object.hasOwn(records, providerId)
      ? records[providerId]
      : emptyLocationResearch(providerId, [
          "No retained location research is available for this catalog provider. Missing evidence does not imply poor care or that no public information exists.",
        ]);
  return {
    ...record,
    ...(publishedOffice && {
      registrationFacts: getRegistrationFacts(provider),
      officeDirectories: getOfficeDirectoryResearch(providerId),
      officeIdentifiers: getHomeCareOfficeIdentifiers(providerId),
    }),
    ...(registry === markets && {
      dailyLife: getDailyLifeResearch(providerId) ?? undefined,
      nursingStaffing: getNursingStaffingResearch(providerId) ?? undefined,
    }),
    familyExperience: getFamilyExperience(providerId, registry),
    facebookResearch: getFacebookResearch(providerId, registry),
    experience: scoreLocation(record, asOfDate),
  };
}
export function getResearchSummary(
  providerId: string,
  registry: MarketRegistry = markets,
): ResearchSummary | undefined {
  const entry = getProviderEntry(providerId, registry);
  if (!entry) return undefined;
  const { market, provider } = entry;
  const homeHealthSurvey = njHomeHealthSurvey(provider, market);
  const records = market.locationResearch;
  const record =
    records && Object.hasOwn(records, providerId)
      ? records[providerId]
      : undefined;
  const individualReviewCounts = individualReviewSummary(
    providerId,
    record,
    registry,
  );
  if (!record) {
    const facebookResearch = getFacebookSummary(providerId, registry);
    if (!facebookResearch && !individualReviewCounts && !homeHealthSurvey)
      return undefined;
    return {
      ...(homeHealthSurvey && { homeHealthSurvey }),
      individualReviews: individualReviewCounts,
      familyExperience: getFamilyExperience(providerId, registry),
      facebookResearch,
      detailsAvailable: false,
      publishedCosts: 0,
      availabilityStatus: "not-published",
      availabilityCheckedAt: null,
      experience: {
        label: "Consumer experience index",
        value: null,
        reviewCount: 0,
        confidence: "unrated",
        independentSourceCount: 0,
      },
    };
  }
  validateProviderId(providerId);
  const experience = publicExperience(scoreLocation(record));
  const source = record.sources.find(
    (s) => s.id === record.availability.sourceId,
  );
  return {
    ...(homeHealthSurvey && { homeHealthSurvey }),
    individualReviews: individualReviewCounts,
    familyExperience: getFamilyExperience(providerId, registry),
    facebookResearch: getFacebookSummary(providerId, registry),
    residentEngagement: record.residentEngagement,
    detailsAvailable: record.providerDetailsReviewed,
    publishedCosts: record.facts.filter(
      (f) => f.kind === "cost" && f.amount && f.amount.min > 0,
    ).length,
    availabilityStatus: record.availability.status,
    availabilityCheckedAt: source?.checkedAt ?? null,
    admissionRestriction: record.admissionRestriction?.text,
    experience,
  };
}
