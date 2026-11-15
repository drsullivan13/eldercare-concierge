// The Node-only import prevents this data-backed reader entering a client bundle.
import "node:fs";
import interviews from "../../research/north-jersey/review-catalog-editorial/resident-interview-profiles.json";
import distinctions from "../../research/north-jersey/review-catalog-editorial/sunrise-survey-distinctions.json";
import officeProfiles from "../../research/north-jersey/home-care-review-links/portal-links.json";
import { getProviderEntry, publishedReviewCatalogs } from "./markets";
import type { ReviewCatalog } from "./review-catalog-types";

const records = publishedReviewCatalogs;

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

export function getCommunityFeedback(providerId: string) {
  const provider = getProviderEntry(providerId)?.provider;
  if (!provider || provider.category !== "assisted-living") return {};
  const sameCommunity = (record: {
    providerId: string;
    catalogAddress: string;
  }) =>
    record.providerId === providerId &&
    record.catalogAddress === provider.address;
  const profile = interviews.records.find(sameCommunity);
  const award = distinctions.records.find(sameCommunity);
  return {
    ...(profile && { interviewUrl: profile.url }),
    ...(award && {
      surveyDistinction: {
        year: distinctions.year,
        categories: award.categories,
        sourceUrl: distinctions.sourceUrl,
      },
    }),
  };
}
