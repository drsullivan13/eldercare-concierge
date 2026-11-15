// The Node-only import prevents this data-backed reader entering a client bundle.
import "node:fs";
import interviews from "../../research/north-jersey/review-catalog-editorial/resident-interview-profiles.json";
import sunrise from "../../research/north-jersey/review-catalog-editorial/sunrise-survey-distinctions.json";
import brookdale from "../../research/north-jersey/review-catalog-editorial/brookdale-survey-distinctions.json";
import brightview from "../../research/north-jersey/review-catalog-editorial/brightview-survey-distinctions.json";
import benchmark from "../../research/north-jersey/review-catalog-editorial/benchmark-survey-distinctions.json";
import mixedRanks from "../../research/north-jersey/review-catalog-editorial/home-care-mixed-survey-ranks.json";
import activated from "../../research/north-jersey/review-catalog-editorial/wyckoff-activated-insights.json";
import officeProfiles from "../../research/north-jersey/home-care-review-links/portal-links.json";
import { getProviderEntry, publishedReviewCatalogs } from "./markets";
import type { IndividualReviewsResponse } from "./individual-reviews";
import type { ReviewCatalog } from "./review-catalog-types";

const records = publishedReviewCatalogs;
const distinctions = [sunrise, brightview, brookdale, benchmark].flatMap(
  ({ year, sourceUrl, records }) =>
    records.map(({ providerId, catalogAddress, categories }) => ({
      providerId,
      catalogAddress,
      year,
      sourceUrl,
      categories,
    })),
);

export function getReviewCatalog(providerId: string): ReviewCatalog | null {
  if (!Object.hasOwn(records, providerId)) return null;
  return structuredClone(records[providerId]);
}

// An external office profile is a navigation link. Its presence supplies no rating or account.
const externalProfiles = Map.groupBy(
  officeProfiles.links.filter((link) => {
    const address = getProviderEntry(link.providerId)?.provider.address;
    return (
      address?.trim().toLowerCase() === link.catalogAddress.trim().toLowerCase()
    );
  }),
  (link) => link.providerId,
);

export function getExternalReviewProfiles(providerId: string) {
  return (externalProfiles.get(providerId) ?? []).map(({ publisher, url }) => ({
    publisher,
    url,
  }));
}

export function getLocationFeedback(
  providerId: string,
): Pick<
  IndividualReviewsResponse,
  | "surveyDistinction"
  | "serviceDistinction"
  | "interviewUrl"
  | "mixedSurveyRank"
> {
  const provider = getProviderEntry(providerId)?.provider;
  if (!provider) return {};
  const sameCommunity = (record: {
    providerId: string;
    catalogAddress: string;
  }) =>
    record.providerId === providerId &&
    record.catalogAddress === provider.address;
  if (provider.category === "home-care") {
    const ranked = mixedRanks.records.find(sameCommunity);
    return ranked
      ? {
          mixedSurveyRank: {
            year: mixedRanks.year,
            surveyPeriod: mixedRanks.surveyPeriod,
            rank: ranked.rank,
            sourceUrl: ranked.sourceUrl,
          },
        }
      : {};
  }
  if (provider.category !== "assisted-living") return {};
  const profile = interviews.records.find(sameCommunity);
  const award = distinctions.find(sameCommunity);
  const serviceAward = activated.awards.find(sameCommunity);
  return {
    ...(serviceAward && {
      serviceDistinction: {
        year: activated.awardYear,
        categories: serviceAward.categories,
        sourceUrl: activated.operatorRelease,
      },
    }),
    ...(profile && { interviewUrl: profile.url }),
    ...(award && {
      surveyDistinction: {
        year: award.year,
        categories: award.categories,
        sourceUrl: award.sourceUrl,
      },
    }),
  };
}
