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
export type ExperienceReviewSample = {
  sourceId: string;
  sourceFamily: string;
  selection: "all-visible-before-highlighting";
  visibleCount: number;
  observations: readonly {
    id: string;
    date: string | null;
    sentiment: "positive" | "negative" | "mixed" | "neutral";
  }[];
};
type SampleDiagnostic = {
  sourceId: string;
  eligible: number;
  negative: number;
  positive: number;
  visible: number;
  conflicts: boolean;
};
type ExperienceReview = {
  id: string;
  sourceId: string;
  date?: string | null;
  relationship?: string;
  url?: string;
  excerpt?: string;
  aspects?: readonly { aspect: string; sentiment: string }[];
};
type NarrativeDiagnostics = {
  includedReviews: {
    reviewId: string;
    sourceId: string;
    sourceFamily: string;
    url: string;
    sentiment: "positive" | "negative" | "mixed";
    independent: boolean;
  }[];
  excludedReviews: { reviewId: string; reason: string }[];
};
export type ExperienceSummary = {
  label: "Consumer experience index";
  value: number | null;
  reviewCount: number;
  platformCount: number;
  independentSourceCount: number;
  confidence: "unrated" | "limited" | "moderate";
  reason: string;
  publicationStatus?:
    | "single-source-estimate"
    | "multi-source-index"
    | "insufficient-evidence"
    | "sources-disagree";
  singleSourceLabel?: string;
  selectedConcerns?: boolean;
  sampleDiagnostics?: SampleDiagnostic[];
  methodVersion: "1.0" | "2.0";
  aggregateRange?: { minimum: number; maximum: number; substantial: boolean };
  narrativeDiagnostics?: NarrativeDiagnostics;
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
  /** Selected accounts affect evidence diagnostics, never numeric averages or counts. */
  reviews?: readonly ExperienceReview[];
  reviewSamples?: readonly ExperienceReviewSample[];
  asOfDate: string;
};

const EXPERIENCE_SCORE_POLICY = {
  version: "2.0",
  minimumReportedReviews: 10,
  singleFamilyMinimum: 30,
  independentFamilyMinimum: 5,
  moderateCoverageReviews: 30,
  moderateFamilyMinimum: 10,
  disagreementPoints: 2,
  maximumCheckedAgeDays: 180,
  maximumSnapshotAgeDays: 365,
  reviewCountWeightCap: 100,
  maximumNarrativeAgeDays: 730,
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
function primaryFamily(value: string): string | null {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "caring.com") return "caring";
    if (host === "aplaceformom.com" || host === "senioradvisor.com")
      return "aplaceformom";
    if (host === "google.com" || host === "maps.google.com") return "google";
    return null;
  } catch {
    return null;
  }
}
function primaryLocationFamily(value: string): string | null {
  const family = primaryFamily(value);
  if (!family) return null;
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (family === "caring")
    return /^\/senior-(living|care)\/[^/]+\/[^/]+\/[^/]+$/.test(path)
      ? family
      : null;
  if (family === "aplaceformom")
    return /^\/community\/[^/]+-\d+$/.test(path) ||
      (url.hostname.replace(/^www\./, "") === "senioradvisor.com" &&
        /^\/local\/[^/]+$/.test(path))
      ? family
      : null;
  return /^\/maps\/place\/[^/]+/.test(path) ||
    (path === "/maps" &&
      ["cid", "ftid", "query_place_id"].some((key) =>
        Boolean(url.searchParams.get(key)),
      ))
    ? family
    : null;
}
function familyFor(aggregate: ExperienceAggregate, url?: string): string {
  const primary = url ? primaryFamily(url) : null;
  if (primary) return primary;
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
  if (
    [declared, platform].some((value) =>
      ["google", "googlemaps", "googlereviews"].includes(value),
    )
  )
    return "google";
  return declared;
}
function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|tracking|gclid|fbclid)$/i.test(key))
        url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const query = url.searchParams.toString();
    return `${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
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

function narrativeEvidence(
  input: ExperienceScoreInput,
  sources: Map<string, ExperienceSource[]>,
  represented: Candidate[],
  now: number,
): NarrativeDiagnostics {
  const eligible: (NarrativeDiagnostics["includedReviews"][number] & {
    fingerprint: string;
  })[] = [];
  const excludedReviews: NarrativeDiagnostics["excludedReviews"] = [];
  for (const review of [...(input.reviews ?? [])].sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      a.sourceId.localeCompare(b.sourceId) ||
      (a.url ?? "").localeCompare(b.url ?? "") ||
      (a.excerpt ?? "").localeCompare(b.excerpt ?? ""),
  )) {
    const reject = (reason: string) =>
      excludedReviews.push({ reviewId: review.id, reason });
    const matches = sources.get(review.sourceId) ?? [];
    const source = matches.length === 1 ? matches[0] : undefined;
    const family = source ? primaryLocationFamily(source.url) : null;
    const checked = source ? dateValue(source.checkedAt) : null;
    const date = dateValue(review.date);
    const page = source ? canonicalUrl(source.url) : null;
    const url = review.url ? canonicalUrl(review.url) : null;
    if (
      !source ||
      source.kind !== "review-platform" ||
      !["full-page", "pdf"].includes(source.access) ||
      !family ||
      !url ||
      url !== page
    ) {
      reject(
        "Requires a directly inspected original review on the linked primary location page; mirrors, social selections and snippets are context only.",
      );
      continue;
    }
    if (
      checked === null ||
      checked > now ||
      (now - checked) / DAY > EXPERIENCE_SCORE_POLICY.maximumCheckedAgeDays ||
      date === null ||
      date > checked ||
      (now - date) / DAY > EXPERIENCE_SCORE_POLICY.maximumNarrativeAgeDays
    ) {
      reject(
        "Requires a fresh source check and a known review date within 730 days, no later than the check.",
      );
      continue;
    }
    if (
      !["family", "resident"].includes(review.relationship ?? "") ||
      !review.excerpt?.trim() ||
      input.reviewAggregates.some(
        (a) =>
          a.scope !== "consumer" &&
          (a.sourceId === review.sourceId ||
            (sources.get(a.sourceId) ?? []).some(
              (s) => canonicalUrl(s.url) === page,
            )),
      )
    ) {
      reject(
        "Requires an exact-location resident or family account with retained text; unresolved care-unit, visitor, staff and unknown relationships are context only.",
      );
      continue;
    }
    const sentiments = new Set(
      review.aspects?.map((aspect) => aspect.sentiment),
    );
    if (
      !sentiments.size ||
      [...sentiments].some(
        (s) => !["positive", "negative", "mixed"].includes(s),
      )
    ) {
      reject(
        "Requires reviewed aspect sentiment; no sentiment or numeric rating is inferred from prose.",
      );
      continue;
    }
    const sentiment =
      sentiments.has("mixed") || sentiments.size > 1
        ? "mixed"
        : sentiments.has("negative")
          ? "negative"
          : "positive";
    const fingerprint = review.excerpt
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!fingerprint) {
      reject("Requires meaningful retained review text.");
      continue;
    }
    eligible.push({
      reviewId: review.id,
      sourceId: review.sourceId,
      sourceFamily: family,
      url: review.url!,
      sentiment,
      independent: !represented.some(
        (candidate) =>
          candidate.family === family ||
          candidate.url === url ||
          candidate.aggregate.sourceId === review.sourceId,
      ),
      fingerprint,
    });
  }
  const groups: (typeof eligible)[] = [];
  for (const review of eligible) {
    const matching = groups.filter((group) =>
      group.some(
        (item) =>
          item.reviewId === review.reviewId ||
          item.fingerprint === review.fingerprint,
      ),
    );
    for (const group of matching) groups.splice(groups.indexOf(group), 1);
    groups.push([review, ...matching.flat()]);
  }
  const includedReviews = groups
    .map((group) => {
      group.sort(
        (a, b) =>
          a.reviewId.localeCompare(b.reviewId) ||
          a.sourceId.localeCompare(b.sourceId),
      );
      const first = group[0];
      for (const duplicate of group.slice(1))
        excludedReviews.push({
          reviewId: duplicate.reviewId,
          reason:
            "Duplicate review ID or normalized excerpt; repeated or cross-posted accounts do not add evidence.",
        });
      return {
        reviewId: first.reviewId,
        sourceId: first.sourceId,
        sourceFamily: first.sourceFamily,
        url: first.url,
        independent: group.every((review) => review.independent),
        sentiment:
          new Set(group.map((review) => review.sentiment)).size > 1
            ? ("mixed" as const)
            : first.sentiment,
      };
    })
    .sort(
      (a, b) =>
        a.reviewId.localeCompare(b.reviewId) ||
        a.sourceId.localeCompare(b.sourceId),
    );
  excludedReviews.sort(
    (a, b) =>
      a.reviewId.localeCompare(b.reviewId) || a.reason.localeCompare(b.reason),
  );
  return { includedReviews, excludedReviews };
}

// A source-visible window can qualify publication, but cannot estimate the prevalence
// of an experience. Every eligible post enters its denominator before highlights are chosen.
function assessReviewSamples(
  samples: readonly ExperienceReviewSample[],
  sources: Map<string, ExperienceSource[]>,
  candidates: Candidate[],
  now: number,
  average: number,
): SampleDiagnostic[] {
  const diagnostics: SampleDiagnostic[] = [];
  for (const sample of samples) {
    const matches = sources.get(sample.sourceId);
    if (matches?.length !== 1) continue;
    const source = matches[0];
    const page = canonicalUrl(source.url);
    const family = token(sample.sourceFamily);
    const checked = dateValue(source.checkedAt);
    if (
      !page ||
      source.kind !== "review-platform" ||
      source.access !== "full-page" ||
      checked === null ||
      checked > now ||
      now - checked > EXPERIENCE_SCORE_POLICY.maximumCheckedAgeDays * DAY ||
      sample.selection !== "all-visible-before-highlighting" ||
      !Number.isSafeInteger(sample.visibleCount) ||
      !Array.isArray(sample.observations) ||
      sample.visibleCount < sample.observations.length ||
      !candidates.some(
        (c) =>
          c.family === family &&
          (c.url === page || c.aggregate.sourceId === sample.sourceId),
      )
    )
      continue;
    const unique = new Map<
      string,
      ExperienceReviewSample["observations"][number]
    >();
    let valid = true;
    for (const post of sample.observations) {
      if (
        !post.id?.trim() ||
        !["positive", "negative", "mixed", "neutral"].includes(post.sentiment)
      ) {
        valid = false;
        break;
      }
      const prior = unique.get(post.id);
      if (
        prior &&
        (prior.date !== post.date || prior.sentiment !== post.sentiment)
      ) {
        valid = false;
        break;
      }
      unique.set(post.id, post);
    }
    if (!valid) continue;
    const recent = [...unique.values()].filter((post) => {
      // A month-only source date qualifies only if its earliest possible day
      // is recent. The capture establishes that the review was already public.
      const date =
        typeof post.date === "string" && /^\d{4}-\d{2}$/.test(post.date)
          ? dateValue(post.date + "-01")
          : dateValue(post.date);
      return (
        date !== null &&
        date <= checked &&
        now - date <= EXPERIENCE_SCORE_POLICY.maximumNarrativeAgeDays * DAY
      );
    });
    const negative = recent.filter(
      (post) => post.sentiment === "negative",
    ).length;
    const positive = recent.filter(
      (post) => post.sentiment === "positive",
    ).length;
    const contrary = average >= 8 ? negative : average <= 4 ? positive : 0;
    diagnostics.push({
      sourceId: sample.sourceId,
      eligible: recent.length,
      visible: sample.visibleCount,
      negative,
      positive,
      conflicts: contrary >= 3 && contrary * 2 > recent.length,
    });
  }
  return diagnostics.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

/** Published averages and selected narrative evidence retain separate meanings. */
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
    const family = familyFor(aggregate, source.url);
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
          a.aggregate.rating - b.aggregate.rating ||
          a.aggregate.scale - b.aggregate.scale ||
          a.aggregate.platform.localeCompare(b.aggregate.platform),
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
  const sampledFamilies = includedSources.filter(
    (source) =>
      source.count >= EXPERIENCE_SCORE_POLICY.independentFamilyMinimum,
  ).length;
  const meetsSampleFloor =
    reviewCount >= EXPERIENCE_SCORE_POLICY.minimumReportedReviews &&
    (sampledFamilies >= 2 ||
      includedSources.some(
        (source) => source.count >= EXPERIENCE_SCORE_POLICY.singleFamilyMinimum,
      ));
  const ratings = includedSources.map((source) => source.normalizedRating);
  const aggregateRange = ratings.length
    ? {
        minimum: Math.min(...ratings),
        maximum: Math.max(...ratings),
        substantial:
          Math.max(...ratings) - Math.min(...ratings) >=
          EXPERIENCE_SCORE_POLICY.disagreementPoints - Number.EPSILON * 10,
      }
    : undefined;
  const weightedAverage = includedSources.reduce(
    (sum, source) => sum + source.normalizedRating * source.weight,
    0,
  );
  const narrativeDiagnostics = input.reviews?.length
    ? narrativeEvidence(input, sources, candidates, now)
    : undefined;
  const independentNarratives =
    narrativeDiagnostics?.includedReviews.filter(
      (review) => review.independent,
    ) ?? [];
  const narrativeConflict =
    independentNarratives.some(
      (review) =>
        review.sentiment === "mixed" ||
        (weightedAverage >= 8 && review.sentiment === "negative") ||
        (weightedAverage <= 4 && review.sentiment === "positive"),
    ) ||
    new Set(independentNarratives.map((review) => review.sentiment)).size > 1;
  const substantialSources = includedSources.filter(
    (source) => source.count >= EXPERIENCE_SCORE_POLICY.moderateFamilyMinimum,
  );
  const sourceDisagreement = substantialSources.some((source) =>
    substantialSources.some(
      (other) =>
        source.normalizedRating - other.normalizedRating >=
        EXPERIENCE_SCORE_POLICY.disagreementPoints - Number.EPSILON * 10,
    ),
  );
  const opposingNarratives = independentNarratives.filter(
    (review) =>
      (weightedAverage >= 8 && review.sentiment === "negative") ||
      (weightedAverage <= 4 && review.sentiment === "positive"),
  );
  const sampleDiagnostics = assessReviewSamples(
    input.reviewSamples ?? [],
    sources,
    selected,
    now,
    weightedAverage,
  );
  const conflict =
    meetsSampleFloor &&
    (sourceDisagreement ||
      new Set(opposingNarratives.map((review) => review.sourceFamily)).size >=
        2 ||
      sampleDiagnostics.some((sample) => sample.conflicts));
  const rated = meetsSampleFloor && !conflict;
  const publicationStatus = conflict
    ? "sources-disagree"
    : !rated
      ? "insufficient-evidence"
      : independentSourceCount === 1
        ? "single-source-estimate"
        : "multi-source-index";
  const firstSource = includedSources[0];
  const sourceLabels: Record<string, string> = {
    google: "Google",
    caring: "Caring.com",
    aplaceformom: "A Place for Mom / SeniorAdvisor",
  };
  const singleSourceLabel =
    independentSourceCount === 1
      ? (sourceLabels[firstSource.sourceFamily] ?? firstSource.platform)
      : undefined;
  const selectedConcerns =
    sampleDiagnostics.some((sample) => sample.negative > 0) ||
    Boolean(
      narrativeDiagnostics?.includedReviews.some(
        (review) =>
          review.sentiment === "negative" || review.sentiment === "mixed",
      ),
    );
  const confidence = !rated
    ? "unrated"
    : includedSources.filter(
          (source) =>
            source.count >= EXPERIENCE_SCORE_POLICY.moderateFamilyMinimum,
        ).length >= 2 &&
        reviewCount >= EXPERIENCE_SCORE_POLICY.moderateCoverageReviews &&
        !aggregateRange?.substantial &&
        !narrativeConflict
      ? "moderate"
      : "limited";
  const reason = [
    conflict
      ? "Harbor withheld its score because the published ratings or recent accounts disagree. The original platform averages and counts remain available."
      : !rated
        ? "Unrated: requires 30 reported reviews from one family, or at least 10 across two families with at least five each. Selected accounts cannot supply the sample floor."
        : confidence === "moderate"
          ? "Moderate evidence coverage: at least two families with ten reviews each and 30 total, without substantial observed disagreement. This is not statistical confidence or care-quality verification."
          : "Limited evidence coverage: source/sample concentration or observed disagreement prevents moderate coverage.",
    ...sampleDiagnostics
      .filter((sample) => sample.eligible > 0)
      .map(
        (sample) =>
          `Of ${sample.eligible} recent eligible reviews in a visible sample of ${sample.visible}, ${sample.negative} were critical and ${sample.positive} were favorable. The platform controls which reviews appear; these counts do not represent all reviewers.`,
      ),
    aggregateRange && includedSources.length > 1
      ? `Published source averages range from ${aggregateRange.minimum.toFixed(1)} to ${aggregateRange.maximum.toFixed(1)} / 10.${aggregateRange.substantial ? " The published averages differ substantially; review their original values." : ""}`
      : "",
    independentNarratives.length
      ? `Selected independent primary resident/family accounts: ${independentNarratives.filter((r) => r.sentiment === "positive").length} positive, ${independentNarratives.filter((r) => r.sentiment === "negative").length} negative, ${independentNarratives.filter((r) => r.sentiment === "mixed").length} mixed.${narrativeConflict ? " Mixed or opposing accounts qualify this evidence." : ""} Selection is not representative prevalence or proof of independent people.`
      : "",
    narrativeDiagnostics?.includedReviews.some((review) => !review.independent)
      ? "Selected primary accounts from an included aggregate family are context, not additional independent votes."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    label: "Consumer experience index",
    publicationStatus,
    singleSourceLabel,
    selectedConcerns,
    sampleDiagnostics,
    value: rated ? Math.round(weightedAverage * 10) / 10 : null,
    reviewCount,
    platformCount: new Set(
      includedSources.map((source) => token(source.platform)),
    ).size,
    independentSourceCount,
    confidence,
    reason,
    methodVersion: EXPERIENCE_SCORE_POLICY.version,
    aggregateRange,
    narrativeDiagnostics,
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
      "Selected primary resident/family sentiment can qualify the confidence explanation, but never supplies numeric ratings, reported counts or representative prevalence. Social posts remain separate. Missing, inaccessible and excluded evidence is not a negative rating.",
      "Coverage labels and thresholds are provisional product rules, not calibrated probabilities. Platforms differ in collection, moderation, solicitation and selection bias.",
    ],
  };
}
