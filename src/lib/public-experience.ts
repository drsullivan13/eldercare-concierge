import type { ExperienceSummary } from "./experience-score";

export type PublicExperience = {
  label: "Consumer experience index";
  value: number | null;
  reviewCount: number;
  independentSourceCount: number;
  confidence: "unrated" | "limited" | "moderate";
  publicationStatus?:
    | "single-source-estimate"
    | "multi-source-index"
    | "insufficient-evidence"
    | "sources-disagree";
  singleSourceLabel?: string;
  selectedConcerns?: boolean;
};

export function publicExperience(score: ExperienceSummary): PublicExperience {
  return {
    label: score.label,
    value: score.value,
    reviewCount: score.reviewCount,
    independentSourceCount: score.independentSourceCount,
    confidence: score.confidence,
    publicationStatus: score.publicationStatus,
    singleSourceLabel: score.singleSourceLabel,
    selectedConcerns: score.selectedConcerns,
  };
}
