# Consumer experience index, version 1.0

Harbor summarizes directly observed, published consumer review averages on a ten-point scale. The index describes reported consumer sentiment. It does **not** establish clinical quality, safety, a verified resident experience, current staffing, care suitability, price or availability. CMS clinical ratings and regulatory warnings remain separate and visible; a favorable experience index must never suppress a warning.

This is an original, provisional product policy. The ten-point presentation is familiar from travel products, but this is not Expedia's algorithm, verification system or a validated elder-care outcome model. Thresholds and source weights below are explicit choices to be evaluated as coverage grows, not learned facts or calibrated probabilities.

## Input contract and responsibility

`src/lib/experience-score.ts` exports `ExperienceScoreInput`, `ExperienceSummary`, related source/aggregate types and `computeExperienceScore`:

```ts
const summary = computeExperienceScore({
  reviewAggregates: location.reviewAggregates,
  sources: location.sources,
  reviews: location.reviews, // Optional qualitative material; never scored.
  asOfDate: new Date().toISOString().slice(0, 10),
});
```

Supply one location's source-linked evidence at a time. The data researcher must reconcile the platform listing's actual address and care entity to the catalog location. The function cannot prove that identity from a URL or resolve whether a campus page represents a separately licensed nursing unit. `scope: "consumer"` is the research attestation that a directly observed aggregate represents that exact location's broad consumer population. Use another scope, such as `ambiguous`, `employee`, `sales-only` or `brand`, when it does not. Those aggregates are excluded. Known employee/employer, sales-only and network-brand ratings must not be reclassified merely to make a score available.

Ordinary consumer platforms can combine resident, family and visitor/tour feedback. That limitation is disclosed; the score is never labeled a verified-resident score. A selected review's relationship may be unknown. Do not infer relationships, verified status, rating counts, dates, scores or independence from a snippet. If the only available aggregate mixes employee or brand evidence inseparably, mark its scope ambiguous and do not score it.

The numeric input must be a platform's published **consumer review average**, not its proprietary ranking, sponsored placement score, recommendation percentage, operational measure, CMS rating or a sum reconstructed from hand-picked excerpts. The data contract's `rating`/`scale` must retain that distinction. For example, a platform's proprietary zero because no recent reviews qualify is not a zero-star consumer experience.

## Eligibility and missingness

An aggregate contributes only if all of these hold:

1. It has `scope: "consumer"` and exactly one linked source ID.
2. Its source is a `review-platform` or `public-discussion` source inspected as `full-page` or `pdf`. Provider promotion and search-only snippets are excluded.
3. Its URL is HTTP(S), platform/source family are nonempty, and `checkedAt` is a valid UTC calendar date no later than the requested assessment date and at most 180 days old.
4. Its published rating is finite, between zero and its declared maximum, and uses a five- or ten-point rating scale. A known positive whole-number review count is required. Null, zero-count placeholders, fractional counts and percentage recommendation measures are excluded.
5. If `asOf` is known, it is a valid snapshot date no later than the source check and at most 365 days before assessment. Null `asOf` is allowed, with unknown underlying recency disclosed.

The date boundaries are inclusive. Invalid `asOfDate` is a caller error and throws; invalid source evidence is excluded with a readable reason. Compute with the request's explicit UTC date so stale evidence expires without waiting for another import. Static pages or cached summaries must be refreshed accordingly.

An index requires **at least 10 reported reviews after deduplication**. Otherwise `value` is null and confidence is `unrated`; never render zero, a default average, fake stars or a fabricated Expedia-style score. An excluded source can still be shown as clearly attributed qualitative evidence where appropriate. Its exclusion is not evidence of poor care. No review source is not the same as no reviews on a known source.

## Duplication, weights and calculation

Group aggregates by their canonical source family or duplicate page URL, including transitive matches. URL normalization removes scheme, `www`, query/fragment and trailing slash for duplicate-page checks. The researcher must still label syndicated or commonly sourced feeds consistently, because distinct URLs do not prove independent data.

The implementation canonicalizes A Place for Mom/APFM and SeniorAdvisor aliases into one family and normalizes Caring.com naming. Additional known syndication relationships belong in source-family research and, if common, the canonicalization map. It does not assume every different social website is statistically independent.

Keep one aggregate per group: newest known snapshot (or source-check date when snapshot is unknown), then latest check, then largest reported count, then stable source ID. Do **not** pick the highest rating. Other group members receive an exclusion reason. Missing snapshot dates mean the chosen page is the more recently observed representation, not necessarily newer underlying experiences.

For each retained source `i`:

```text
normalized_i = 10 × published_rating_i / published_scale_i
raw_weight_i = sqrt(min(published_review_count_i, 100))
weight_i     = raw_weight_i / sum(raw_weight)
index        = round(sum(weight_i × normalized_i), 1 decimal)
```

Square-root weighting allows a larger published sample to count more without allowing a giant listing to dominate linearly. The cap limits a single source family's weight to the square root of 100. These are coverage controls, not an estimate of effective independent respondents or inverse statistical variance. All eligible source families use the same rule; no platform receives an invented accuracy advantage. No Bayesian prior, industry baseline, sentiment classifier, clinical multiplier, price factor or fabricated review is added.

`includedSources` reports the original rating, scale, count, normalized rating and exact fractional weight. `reviewCount` sums reported counts only from the retained sources. It is **not a unique reviewer/resident count**: unknown cross-posting can persist between families. `platformCount` and `independentSourceCount` describe retained contributors, not every researched or displayed platform.

## Coverage labels and recency

| Label    | Rule                                                               | Meaning                                                                                 |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Unrated  | Fewer than 10 eligible reported reviews                            | Not enough eligible aggregate evidence under this policy.                               |
| Limited  | Rated, but only one family or fewer than 30 total reported reviews | Thin source/sample coverage. A single large platform remains limited.                   |
| Moderate | At least two deduplicated source groups and 30 reported reviews    | More source coverage; not statistical confidence, verification or a safety designation. |

No `high confidence` claim is made. Unknown review ages, nonresponse/selection bias, platform solicitation and moderation, mixed care levels and possible manipulation remain. A recent page check is a freshness check on the published aggregate, not proof of recent care. Applying a numeric time decay to that aggregate would invent the age distribution of its constituent reviews, so v1 does not do so. Known stale snapshots expire; dated excerpts can be shown as dated context but cannot establish prevalence or recency of the full review population.

## Presentation requirements

- Use **Consumer experience index**, with `/ 10`, coverage label, contributing source families and “reviews reported.” Keep the overlap and unverified-reviewer caveats accessible beside it.
- Show source averages and links so users can inspect what the number summarizes. Expose why an observed aggregate was excluded when that distinction matters.
- Keep official clinical/regulatory evidence distinct and prominent. Never call the index “safe care,” “best care” or a verified-resident satisfaction score. Do not use favorable review sentiment to cancel an adverse regulatory finding.
- Show the dated excerpt/source and selected status for narrative material. Individual posts, Facebook/Reddit/X discussion and manually selected reviews never numerically raise or lower this index. A few selected posts are not representative prevalence.
- An unrated location remains discoverable with its facts and source evidence. Missingness is not a negative rating and must not be silently converted to a bottom score.

## Validation

`tests/experience-score.test.ts` uses explicitly synthetic policy fixtures, not invented production review data. It checks missing/no-review states, count thresholds, source weight caps, mixed scales, syndication and transitive duplicate-page handling, stale/future/impossible dates, employee/sales/brand exclusions, source ambiguity and snippet exclusion. It also checks that selected excerpts and input ordering cannot alter the result or mutate the source data.

Actual research data is independently source-linked. Initial eligible examples include Caring's broad-campus Brooksby and Linden Ponds aggregates, yielding single-family limited-coverage results. Carleton's unresolved campus/nursing-unit mixture and Brooksby's ambiguous memory-care aggregate are excluded. Fox Hill's no-review placeholder remains unrated. These examples illustrate scope handling; the current imported snapshot, not this prose, is authoritative for values.
