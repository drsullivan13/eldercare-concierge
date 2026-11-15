// The Node-only import prevents this data-backed reader entering a client bundle.
import "node:fs";
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
