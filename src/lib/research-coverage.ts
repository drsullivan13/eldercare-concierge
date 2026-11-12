import catalog from "@/data/providers.json";
import { getLocationResearch } from "./location-research";
import type { CareCategory } from "./providers";

export type CoverageStatus =
  "scored" | "too-few-reviews" | "source-check-needed" | "no-rating-evidence";
export type ResearchCoverageRow = {
  providerId: string;
  name: string;
  category: CareCategory;
  address: string;
  city: string;
  zip: string;
  score: number | null;
  status: CoverageStatus;
  eligibleReviews: number;
  sourceFamilies: number;
  ratingSourceUrls: string[];
  facebookStatus: string;
  facebookFindings: number;
  facebookWithheldObservations: number;
  nextAction: string;
};

export function getResearchCoverage(
  asOfDate = new Date().toISOString().slice(0, 10),
) {
  const locations: ResearchCoverageRow[] = catalog.map((provider) => {
    const research = getLocationResearch(provider.id, asOfDate);
    const score = research.experience;
    const status: CoverageStatus =
      score.value !== null
        ? "scored"
        : score.reviewCount > 0
          ? "too-few-reviews"
          : research.reviewAggregates.length
            ? "source-check-needed"
            : "no-rating-evidence";
    const nextAction =
      status === "scored"
        ? "Add independent sources and dated resident/family context; check for duplicates."
        : status === "too-few-reviews"
          ? "Find additional exact-location published rating averages and counts; at least 10 eligible reviews are needed."
          : status === "source-check-needed"
            ? "Inspect the original rating page, confirm the exact care unit, population, count and date; resolve the recorded exclusions."
            : "Find an exact-location public consumer rating average and review count. Record no result or access limits honestly.";
    return {
      providerId: provider.id,
      name: provider.name,
      category: provider.category as CareCategory,
      address: provider.address,
      city: provider.city,
      zip: provider.zip,
      score: score.value,
      status,
      eligibleReviews: score.reviewCount,
      sourceFamilies: score.independentSourceCount,
      ratingSourceUrls: [
        ...new Set(
          research.reviewAggregates.flatMap((aggregate) => {
            const source = research.sources.find(
              (s) => s.id === aggregate.sourceId,
            );
            return source ? [source.url] : [];
          }),
        ),
      ],
      facebookStatus: research.facebookResearch?.status ?? "not-searched",
      facebookFindings: research.facebookResearch?.findings.length ?? 0,
      facebookWithheldObservations:
        research.facebookResearch?.withheldCount ?? 0,
      nextAction,
    };
  });
  return {
    asOfDate,
    total: locations.length,
    scored: locations.filter((row) => row.score !== null).length,
    unscored: locations.filter((row) => row.score === null).length,
    facebookCovered: locations.filter(
      (row) => row.facebookStatus !== "not-searched",
    ).length,
    facebookWithFindings: locations.filter((row) => row.facebookFindings > 0)
      .length,
    locations,
  };
}

/** CSV remains a research checklist; no observation text or personal data is exported. */
export function researchCoverageCsv(
  coverage: ReturnType<typeof getResearchCoverage>,
): string {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    // Quoting alone does not stop spreadsheet formula evaluation.
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const columns = [
    "provider_id",
    "name",
    "care_category",
    "address",
    "city",
    "zip",
    "experience_score_0_to_10",
    "score_status",
    "eligible_reported_reviews",
    "source_families",
    "rating_source_urls",
    "facebook_status",
    "facebook_findings",
    "facebook_withheld_observations",
    "next_research_action",
    "assessment_date",
  ];
  const rows = coverage.locations.map((row) => [
    row.providerId,
    row.name,
    row.category,
    row.address,
    row.city,
    row.zip,
    row.score,
    row.status,
    row.eligibleReviews,
    row.sourceFamilies,
    row.ratingSourceUrls.join(" | "),
    row.facebookStatus,
    row.facebookFindings,
    row.facebookWithheldObservations,
    row.nextAction,
    coverage.asOfDate,
  ]);
  return (
    [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") +
    "\r\n"
  );
}
