type ReviewCatalogAccount = {
  id: string;
  sourceId: string;
  sourceFamily: string;
  url: string;
  date: string | null;
  datePrecision: "day" | "month" | "year" | "unknown";
  relationship: "family" | "resident" | "staff" | "visitor" | "unknown";
  excerpt: string | null;
  summary: string | null;
  representation:
    "licensed-excerpt" | "reviewed-excerpt" | "original-summary" | "link-only";
  provenance: "retained-reviewed" | "new-public-page";
  nativeReviewId?: string;
  retainedReview?: { id: string; url: string };
};

type ReviewCatalogSource = {
  id: string;
  publisher: string;
  sourceFamily: string;
  url: string;
  reportedCount: number | null;
  retainedCount: number;
  previouslyUnseenCount: number;
  pagesChecked: number;
  coverage: "exhausted-visible-pages" | "partial" | "blocked" | "retained-only";
  stopReason: string;
  scopeNote?: string;
};

export type ReviewCatalog = {
  providerId: string;
  checkedAt: string;
  accounts: ReviewCatalogAccount[];
  sources: ReviewCatalogSource[];
  notes: string[];
};
