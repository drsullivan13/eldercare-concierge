// The Node-only import prevents this data-backed reader entering a client bundle.
import "node:fs";
import catalog from "@/data/review-catalog.json";
import type { ReviewCatalog } from "./review-catalog-types";

const records = catalog as Record<string, ReviewCatalog>;

export function getReviewCatalog(providerId: string): ReviewCatalog | null {
  if (!Object.hasOwn(records, providerId)) return null;
  return structuredClone(records[providerId]);
}
