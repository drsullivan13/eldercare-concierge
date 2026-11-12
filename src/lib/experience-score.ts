/** Public consumer sentiment only. Clinical quality and regulatory findings are separate. */
export type ExperienceSource = {
  id: string;
  url: string;
  kind: string;
  checkedAt: string;
  access: string;
};
export type ExperienceAggregate = {
  sourceId: string;
  platform: string;
  sourceFamily: string;
  rating: number | null;
  scale: number | null;
  count: number | null;
  asOf: string | null;
  scope: string;
  notes?: string[];
};
export type ExperienceReview = {
  id: string;
  sourceId: string;
  date?: string | null;
  relationship?: string;
};
export type ExperienceSummary = {
  label: "Consumer experience index";
  value: number | null;
  reviewCount: number;
  platformCount: number;
  independentSourceCount: number;
  confidence: "unrated" | "limited" | "moderate";
  reason: string;
  methodVersion: "1.0";
  excludedSources: { sourceId: string; reason: string }[];
  includedSources: {
    sourceId: string;
    platform: string;
    sourceFamily: string;
    rating: number;
    scale: number;
    count: number;
    normalizedRating: number;
    /** Fraction of final index weight, summing to one across included sources. */
    weight: number;
  }[];
  limitations: string[];
};
export type ExperienceScoreInput = {
  reviewAggregates: readonly ExperienceAggregate[];
  sources: readonly ExperienceSource[];
  /** Selected excerpts are accepted for integration but never enter the score. */
  reviews?: readonly ExperienceReview[];
  asOfDate: string;
};

export const EXPERIENCE_SCORE_POLICY = {
  version: "1.0",
  minimumReportedReviews: 10,
  moderateCoverageReviews: 30,
  maximumCheckedAgeDays: 180,
  maximumSnapshotAgeDays: 365,
  reviewCountWeightCap: 100,
} as const;
const DAY = 86_400_000;

function dateValue(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : null;
}
function token(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function familyFor(aggregate: ExperienceAggregate): string {
  const declared = token(aggregate.sourceFamily);
  const platform = token(aggregate.platform);
  const apfm = new Set([
    "aplaceformom",
    "apfm",
    "senioradvisor",
    "senioradvisorcom",
  ]);
  // These are known shared/syndicated source aliases, not separate votes.
  if (apfm.has(declared) || apfm.has(platform)) return "aplaceformom";
  if ([declared, platform].some((value) => value === "caringcom"))
    return "caring";
  return declared;
}
function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
type Candidate = {
  aggregate: ExperienceAggregate & {
    rating: number;
    scale: number;
    count: number;
  };
  family: string;
  url: string;
  checked: number;
  snapshot: number;
};

/** Deterministic, original v1 policy; no implied equivalence to Expedia methodology. */
export function computeExperienceScore(
  input: ExperienceScoreInput,
): ExperienceSummary {
  const now = dateValue(input.asOfDate);
  if (now === null)
    throw new RangeError("asOfDate must be a valid YYYY-MM-DD UTC date.");
  const excludedSources: ExperienceSummary["excludedSources"] = [];
  const candidates: Candidate[] = [];
  const sources = new Map<string, ExperienceSource[]>();
  for (const source of input.sources) {
    sources.set(source.id, [...(sources.get(source.id) ?? []), source]);
  }
  for (const aggregate of input.reviewAggregates) {
    const reject = (reason: string) =>
      excludedSources.push({ sourceId: aggregate.sourceId, reason });
    if (aggregate.scope !== "consumer") {
      reject(
        "Not an exact-location consumer aggregate; employee, sales-only, brand and ambiguous populations are excluded.",
      );
      continue;
    }
    const matches = sources.get(aggregate.sourceId) ?? [];
    if (matches.length !== 1) {
      reject("A unique linked source is required.");
      continue;
    }
    const source = matches[0];
    if (
      !["review-platform", "public-discussion"].includes(source.kind) ||
      !["full-page", "pdf"].includes(source.access)
    ) {
      reject(
        "Requires directly inspected public review evidence, not provider promotion or a search snippet.",
      );
      continue;
    }
    const url = canonicalUrl(source.url);
    const family = familyFor(aggregate);
    if (!url || !family || !aggregate.platform.trim()) {
      reject(
        "A valid public source URL, platform and source family are required.",
      );
      continue;
    }
    const checked = dateValue(source.checkedAt);
    if (
      checked === null ||
      checked > now ||
      (now - checked) / DAY > EXPERIENCE_SCORE_POLICY.maximumCheckedAgeDays
    ) {
      reject(
        "The source check is missing, future-dated or more than 180 days old.",
      );
      continue;
    }
    const snapshot =
      aggregate.asOf === null ? checked : dateValue(aggregate.asOf);
    if (
      snapshot === null ||
      snapshot > checked ||
      (now - snapshot) / DAY > EXPERIENCE_SCORE_POLICY.maximumSnapshotAgeDays
    ) {
      reject(
        "The aggregate snapshot date is invalid, later than its source check or more than 365 days old.",
      );
      continue;
    }
    const { rating, scale, count } = aggregate;
    if (
      typeof rating !== "number" ||
      !Number.isFinite(rating) ||
      (scale !== 5 && scale !== 10) ||
      rating < 0 ||
      rating > scale ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1
    ) {
      reject(
        "Requires a published 5- or 10-point rating and a known positive whole-number review count.",
      );
      continue;
    }
    candidates.push({
      aggregate: { ...aggregate, rating, scale, count },
      family,
      url,
      checked,
      snapshot,
    });
  }

  // Transitive grouping prevents renamed families or mirrored URLs adding votes.
  const groups: Candidate[][] = [];
  for (const candidate of candidates) {
    const matching = groups.filter((group) =>
      group.some(
        (item) =>
          item.family === candidate.family || item.url === candidate.url,
      ),
    );
    if (!matching.length) groups.push([candidate]);
    else {
      const combined = [candidate, ...matching.flat()];
      for (const group of matching) groups.splice(groups.indexOf(group), 1);
      groups.push(combined);
    }
  }
  const selected = groups
    .map((group) => {
      // Prefer the newest snapshot, then newest check, then largest published count.
      // Never select the highest rating; stable lexical fields break remaining ties.
      group.sort(
        (a, b) =>
          b.snapshot - a.snapshot ||
          b.checked - a.checked ||
          b.aggregate.count - a.aggregate.count ||
          a.aggregate.sourceId.localeCompare(b.aggregate.sourceId) ||
          a.aggregate.rating - b.aggregate.rating,
      );
      for (const duplicate of group.slice(1))
        excludedSources.push({
          sourceId: duplicate.aggregate.sourceId,
          reason:
            "Shared source family or duplicate page; only one aggregate contributes to avoid counting syndicated evidence twice.",
        });
      return group[0];
    })
    .sort(
      (a, b) =>
        a.family.localeCompare(b.family) ||
        a.aggregate.sourceId.localeCompare(b.aggregate.sourceId),
    );
  const weightTotal = selected.reduce(
    (sum, item) =>
      sum +
      Math.sqrt(
        Math.min(
          item.aggregate.count,
          EXPERIENCE_SCORE_POLICY.reviewCountWeightCap,
        ),
      ),
    0,
  );
  const includedSources = selected.map(({ aggregate, family }) => ({
    sourceId: aggregate.sourceId,
    platform: aggregate.platform,
    sourceFamily: family,
    rating: aggregate.rating,
    scale: aggregate.scale,
    count: aggregate.count,
    normalizedRating: (aggregate.rating / aggregate.scale) * 10,
    weight:
      Math.sqrt(
        Math.min(aggregate.count, EXPERIENCE_SCORE_POLICY.reviewCountWeightCap),
      ) / weightTotal,
  }));
  const reviewCount = includedSources.reduce(
    (sum, source) => sum + source.count,
    0,
  );
  const independentSourceCount = includedSources.length;
  const rated =
    reviewCount >= EXPERIENCE_SCORE_POLICY.minimumReportedReviews &&
    independentSourceCount > 0;
  const confidence = !rated
    ? "unrated"
    : independentSourceCount >= 2 &&
        reviewCount >= EXPERIENCE_SCORE_POLICY.moderateCoverageReviews
      ? "moderate"
      : "limited";
  return {
    label: "Consumer experience index",
    value: rated
      ? Math.round(
          includedSources.reduce(
            (sum, source) => sum + source.normalizedRating * source.weight,
            0,
          ) * 10,
        ) / 10
      : null,
    reviewCount,
    platformCount: new Set(
      includedSources.map((source) => token(source.platform)),
    ).size,
    independentSourceCount,
    confidence,
    reason: !rated
      ? `Unrated: at least ${EXPERIENCE_SCORE_POLICY.minimumReportedReviews} reported reviews with eligible aggregate evidence are required.`
      : confidence === "limited"
        ? "Limited evidence coverage: only one independent source family or fewer than 30 reported reviews."
        : "Moderate evidence coverage: at least two source families and 30 reported reviews; this is not statistical confidence or care-quality verification.",
    methodVersion: "1.0",
    includedSources,
    excludedSources: excludedSources.sort(
      (a, b) =>
        a.sourceId.localeCompare(b.sourceId) ||
        a.reason.localeCompare(b.reason),
    ),
    limitations: [
      "Consumer sentiment, not clinical quality, safety, current availability or a verified-resident rating. Regulatory warnings and CMS evidence remain separate.",
      "Reported review counts may overlap across platforms; they are not unique people. Known source-family and page duplication is removed, but unknown cross-posts cannot be identified.",
      "Aggregate review ages and reviewer mix are not fully available. A recent source check does not mean recent care experiences; tour and visitor reviews may be included.",
      "Selected individual reviews and social posts are qualitative context only and never alter the numeric score. Missing, inaccessible and excluded evidence is not treated as a negative rating.",
      "Coverage labels and thresholds are provisional product rules, not calibrated probabilities. Platforms differ in collection, moderation, solicitation and selection bias.",
    ],
  };
}
