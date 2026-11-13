import type { LocationResearch } from "./location-research-types";
import type { ReviewCatalog } from "./review-catalog-types";

type RetainedReview = LocationResearch["reviews"][number];
export type IndividualReview = RetainedReview & {
  publisher: string;
  providerSelected: boolean;
  searchResultOnly: boolean;
  representation:
    "licensed-excerpt" | "reviewed-excerpt" | "original-summary" | "link-only";
};
export type IndividualReviewsResponse = {
  providerId: string;
  accounts: IndividualReview[];
  sources: Omit<ReviewCatalog["sources"][number], "sourceFamily">[];
  notes: string[];
};

export function individualReviews(
  research: Pick<LocationResearch, "providerId" | "sources" | "reviews">,
  catalog: ReviewCatalog | null,
): IndividualReviewsResponse {
  if (catalog && catalog.providerId !== research.providerId)
    throw new RangeError(
      "The individual review catalog does not match this provider.",
    );
  const accounts: IndividualReview[] = research.reviews.map((review) => {
    const source = research.sources.find((item) => item.id === review.sourceId);
    return {
      ...review,
      publisher: source?.publisher ?? "Source not established",
      providerSelected: source?.kind === "provider",
      searchResultOnly: source?.access === "search-result",
      representation: review.excerpt ? "reviewed-excerpt" : "link-only",
    };
  });
  for (const account of catalog?.accounts ?? []) {
    const retained = accounts.find(
      (review) =>
        review.id === account.id ||
        (Boolean(account.excerpt) &&
          review.url === account.url &&
          review.excerpt.trim() === account.excerpt?.trim()),
    );
    if (retained) {
      const resolvedOriginal =
        account.retainedReview?.id === retained.id &&
        account.retainedReview.url === retained.url;
      if (retained.url !== account.url && !resolvedOriginal) continue;
      if (resolvedOriginal) {
        retained.url = account.url;
        retained.date = account.date ?? retained.date;
        retained.sourceId = account.sourceId;
        retained.publisher =
          catalog?.sources.find((item) => item.id === account.sourceId)
            ?.publisher ?? retained.publisher;
        retained.searchResultOnly = false;
        retained.providerSelected = false;
      }
      if (
        !retained.excerpt.trim() &&
        account.excerpt?.trim() &&
        account.representation !== "link-only"
      ) {
        retained.excerpt = account.excerpt;
        retained.representation = account.representation;
      }
      if (!retained.summary.trim() && account.summary?.trim()) {
        retained.summary = account.summary;
        retained.representation = account.representation;
      }
      continue;
    }
    const source = catalog?.sources.find(
      (item) => item.id === account.sourceId,
    );
    accounts.push({
      id: account.id,
      sourceId: account.sourceId,
      url: account.url,
      date: account.date,
      rating: null,
      scale: null,
      relationship: account.relationship,
      excerpt: account.excerpt ?? "",
      summary: account.summary ?? "",
      aspects: [],
      notes: [],
      publisher: source?.publisher ?? "Source not established",
      providerSelected: false,
      searchResultOnly: false,
      representation: account.representation,
    });
  }
  return {
    providerId: research.providerId,
    accounts,
    sources: catalog?.sources ?? [],
    notes: catalog?.notes ?? [],
  };
}

export function reviewAccountCounts(accounts: IndividualReview[]) {
  return {
    total: accounts.length,
    withText: accounts.filter(
      (account) => account.excerpt.trim() || account.summary.trim(),
    ).length,
  };
}

export function reviewPageGroups(accounts: IndividualReview[]) {
  const narratives: IndividualReview[] = [];
  const sourceLinks = new Map<string, IndividualReview[]>();
  for (const account of accounts) {
    if (account.excerpt.trim() || account.summary.trim()) {
      narratives.push(account);
    } else {
      const group = sourceLinks.get(account.sourceId) ?? [];
      group.push(account);
      sourceLinks.set(account.sourceId, group);
    }
  }
  return { narratives, sourceLinks: [...sourceLinks.values()] };
}
