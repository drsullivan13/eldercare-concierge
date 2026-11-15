import type { ExperienceSummary, PublicExperience } from "./experience-score";

export type { PublicExperience } from "./experience-score";

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
