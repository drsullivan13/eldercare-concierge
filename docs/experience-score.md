# Consumer experience index, version 2.0

Harbor summarizes directly observed, published consumer review averages on a ten-point scale. The index describes reported consumer sentiment. It does **not** establish clinical quality, safety, a verified resident experience, current staffing, care suitability, price or availability. CMS clinical ratings and regulatory warnings remain separate and visible; a favorable experience index must never suppress a warning.

This is an original, provisional product policy. The ten-point presentation is familiar from travel products, but this is not Expedia's algorithm, verification system or a validated elder-care outcome model. Thresholds and source weights below are explicit choices to be evaluated as coverage grows, not learned facts or calibrated probabilities.

## Input contract and responsibility

`src/lib/experience-score.ts` exports `ExperienceScoreInput`, `ExperienceSummary`, related source/aggregate types and `computeExperienceScore`:

```ts
const summary = computeExperienceScore({
  reviewAggregates: location.reviewAggregates,
  sources: location.sources,
  reviews: location.reviews,
  reviewSamples: location.reviewSamples,
  asOfDate: new Date().toISOString().slice(0, 10),
});
```

Supply one location's source-linked evidence at a time. The data researcher must reconcile the platform listing's actual address and care entity to the catalog location. The function cannot prove that identity from a URL or resolve whether a campus page represents a separately licensed nursing unit. `scope: "consumer"` is the research attestation that a directly observed aggregate represents that exact location's broad consumer population. Use another scope, such as `ambiguous`, `employee`, `sales-only` or `brand`, when it does not. Those aggregates are excluded. Known employee/employer, sales-only and network-brand ratings must not be reclassified merely to make a score available.

Ordinary consumer platforms can combine resident, family and visitor/tour feedback. That limitation is disclosed; the score is never labeled a verified-resident score. A selected review's relationship may be unknown. Do not infer relationships, verified status, rating counts, dates, scores or independence from a snippet. If the only available aggregate mixes employee or brand evidence inseparably, mark its scope ambiguous and do not score it.

The numeric input must be a platform's published **consumer review average**, not its proprietary ranking, sponsored placement score, recommendation percentage, operational measure, CMS rating or a sum reconstructed from hand-picked excerpts. The data contract's `rating`/`scale` must retain that distinction. For example, a platform's proprietary zero because no recent reviews qualify is not a zero-star consumer experience.

## Publishing the headline

A single eligible family earns a clearly labeled **single-source estimate**. Harbor withholds its headline when two families with ten or more ratings each differ by at least 2/10. The ratings, denominators, publisher links and normalized source range remain available. Two independent primary source families with recent opposing resident/family accounts can also qualify a strongly favorable (8/10 or higher) or unfavorable (4/10 or lower) rating for withholding.

A source-visible sample is assessed before highlights are selected. The observable rows, eligible dates, original identifiers and source family stay linked to a fresh inspected page. If three or more distinct recent reviews contradict a strong aggregate in the same direction and constitute a strict majority of the recent eligible rows, Harbor withholds the headline. Positive and negative directions use the same rule. Mixed and neutral rows remain in the denominator. Fewer contrary reviews can flag concerns without withholding. No point penalty is applied. The visible window is a platform-selected subset, not a survey, and its counts describe only that window.

## Eligibility and missingness

An aggregate contributes only if all of these hold:

1. It has `scope: "consumer"` and exactly one linked source ID.
2. Its source is a `review-platform` or `public-discussion` source inspected as `full-page` or `pdf`. Provider promotion and search-only snippets are excluded.
3. Its URL is HTTP(S), platform/source family are nonempty, and `checkedAt` is a valid UTC calendar date no later than the requested assessment date and at most 180 days old.
4. Its published rating is finite, between zero and its declared maximum, and uses a five- or ten-point rating scale. A known positive whole-number review count is required. Null, zero-count placeholders, fractional counts and percentage recommendation measures are excluded.
5. If `asOf` is known, it is a valid snapshot date no later than the source check and at most 365 days before assessment. Null `asOf` is allowed, with unknown underlying recency disclosed.

The date boundaries are inclusive. Invalid `asOfDate` is a caller error and throws; invalid source evidence is excluded with a readable reason. Compute with the request's explicit UTC date so stale evidence expires without waiting for another import. Static pages or cached summaries must be refreshed accordingly.

An index requires either one retained family with **at least 30 reported reviews**, or **at least ten reviews across two families with at least five each**. A 29-review family plus a one-review listing does not pass. Selected accounts cannot supply the sample floor or substitute for an independent aggregate. Otherwise `value` is null and confidence is `unrated`. The published averages remain in `includedSources` for inspection. No zero, default average or fabricated review replaces missing evidence.

Version 1 allowed a lone ten-review family to produce a score. Version 2 withholds that sparse single-family result rather than pulling it toward an invented industry average. The floor applies equally to favorable and unfavorable averages. Larger single-family samples retain their published numeric value and limited coverage.

## Duplication, weights and calculation

Group aggregates by their canonical source family or duplicate page URL, including transitive matches. URL normalization removes scheme, `www`, fragments, trailing slashes and recognized tracking parameters. It preserves and sorts other query parameters, including location identity such as Google's `cid`. The researcher must still label syndicated or commonly sourced feeds consistently, because distinct URLs do not prove independent data.

The implementation canonicalizes A Place for Mom/APFM and SeniorAdvisor aliases into one family and normalizes Caring.com and Google naming. Known primary platform hosts also identify their family, so renaming a primary platform cannot create an independent vote. A MyLivingChoice page that republishes Google reviews belongs to `google`, not a second MyLivingChoice family. Researchers must identify mixed or unresolved feeds rather than assume every directory is independent.

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

| Label    | Rule                                                                                                                                    | Meaning                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Unrated | The sample floor is unmet or a publication guard applies | The reason distinguishes insufficient coverage from conflicting evidence. |
| Limited  | Rated, but does not pass every moderate rule                                                                                            | Concentrated, sparse or conflicting evidence. A large single family remains limited. |
| Moderate | Two families with at least ten reviews each, 30 total, no substantial aggregate disagreement or eligible independent narrative conflict | Broader observed coverage, not statistical confidence or a safety designation.       |

No `high confidence` claim is made. Unknown review ages, nonresponse/selection bias, platform solicitation and moderation, mixed care levels and possible manipulation remain. A recent page check is a freshness check on the published aggregate, not proof of recent care. Applying a numeric time decay would invent the underlying review-age distribution, so v2 does not do so.

`aggregateRange` shows the lowest and highest normalized averages. A spread of 2/10 or greater limits confidence. If both ends come from distinct families with at least ten reviews each, Harbor withholds the headline and shows the original source breakdown. A tiny dissenting source stays visible without vetoing a large sample.

## Selected primary narrative evidence

The optional `reviews` input already accepts a location's selected accounts. V2 also reads its existing `url`, `excerpt`, `relationship`, `date` and reviewed `aspects`. Older callers that supply only IDs still work. `narrativeDiagnostics`, when selections exist, lists included accounts with their family, sentiment and independence flag, plus readable exclusions. `reason` discloses independent positive, negative and mixed selected-account counts. Those counts are not reviewer prevalence.

An account qualifies only when all of these hold:

- Exactly one linked `review-platform` source was inspected as `full-page` or `pdf` within 180 days.
- The original location page is on a recognized primary review host, currently Caring, APFM/SeniorAdvisor or Google. It has a recognized location path, not a homepage, category, brand or search page. Google's `/maps` URL requires an explicit place identifier, or a `/maps/place/` path. The account URL and source URL identify that same page after URL normalization. A mirror, search snippet, social selection or unknown original host cannot establish primary provenance.
- The retained relationship is `family` or `resident`, the excerpt is nonempty, and the known calendar date is within 730 days and no later than the source check.
- Reviewed aspects contain only `positive`, `negative` or `mixed` sentiment. One account contributes one qualitative classification. Any mixed aspect, or both positive and negative aspects, makes the account mixed. The scorer does not classify prose or interpret an individual star rating.
- No aggregate linked to that source ID or page has an unresolved or non-consumer scope.

As with aggregates, assigning the account to this provider record attests to exact location and care-unit applicability. The scorer cannot infer that from a name, family relationship or URL. Researchers must not assign a nursing-unit account to a whole campus or transfer a historical operator's experience without its dated context. Undated and older accounts remain available in the research record but do not qualify the current confidence label.

Review IDs and normalized excerpts deduplicate transitively, including cross-posts. Conflicting annotations on one duplicate group become mixed rather than selecting the favorable annotation. Any connection to an eligible aggregate family or page makes that account overlapping, not independent. This includes discarded duplicate aggregate representations. Overlapping accounts remain diagnostic context and never count as additional corroboration.

Independent means a separate observed source family, not a verified independent person. Unknown cross-posts and differently shortened excerpts can survive deduplication. All selections remain nonrepresentative, regardless of how many are collected. Positive selections cannot make a sparse location rated or raise confidence. Mixed accounts, opposing selected sentiments, negative accounts against an average of at least 8/10, or positive accounts against an average at most 4/10 prevent moderate confidence. A stack of positive selections cannot outvote a negative one.

Narrative evidence can affect publication and confidence. Original source means, weights and reported counts never receive a sentiment-based point penalty. The source-visible window has its own denominator. Facebook findings stay separate.

## Presentation requirements

- Use **Consumer experience index**, with `/ 10`, coverage label, contributing source families and “reviews reported.” Keep the overlap and unverified-reviewer caveats accessible beside it.
- Show source averages and links so users can inspect what the number summarizes. Expose why an observed aggregate was excluded when that distinction matters.
- Keep official clinical/regulatory evidence distinct and prominent. Never call the index “safe care,” “best care” or a verified-resident satisfaction score. Do not use favorable review sentiment to cancel an adverse regulatory finding.
- Show the dated excerpt/source and selected status for narrative material. Independent eligible primary accounts qualify confidence and appear in the explanation. No selected account numerically raises or lowers the index. A few selected posts are not representative prevalence.
- An unrated location remains discoverable with its facts and source evidence. Missingness is not a negative rating and must not be silently converted to a bottom score.

## Family-experience evidence and tie-only ordering

`familyExperience` is a separate qualitative evidence object in location detail responses and compact provider research. It contains `distinctThreadCount`, `scope: "exact-provider"` and `selectionCaveat`. It never enters `computeExperienceScore`, changes a numeric score, or supplies a missing rating.

The existing curated Facebook snapshot is the editorial release for the exact provider ID. Only findings with `kind: "resident-family"` qualify. Recommendation, tour, provider-promotion and employment findings do not qualify, even when their text sounds favorable or mentions family. The runtime does not classify sentiment, infer relationships or add a release flag.

`scope: "exact-provider"` means editorial assignment to one catalog record, not proof that the account concerns a separately licensed care unit. A catalog record can represent a campus. NewBridge campus findings remain campus scoped and cannot transfer to separate nursing or assisted-living units. The family-evidence disclosure preserves this distinction.

The count is the number of distinct original `threadUrl` identities after eligibility filtering. Multiple findings, comments, `sourceObservationIds` and `sourceUrls` cannot multiply one thread. Known Facebook host aliases, trailing slashes, tracking queries and fragments normalize to one identity. Group `posts` and `permalink` paths with the same group and post IDs are equivalent. Page post paths and `story.php` or `permalink.php` links with matching `id` and `story_fbid` are equivalent. Identity-bearing query parameters remain part of that identity. Reel paths and `watch/videos` paths with the same video ID share one video identity. Comments on those videos do not add threads. The runtime rejects missing, invalid and unrecognized thread links rather than substituting a source link or finding ID. It does not guess equivalence between different group IDs, owner names and numeric owner IDs, short links or redirected links.

An absent provider entry means unsearched and omits `familyExperience`. A covered provider with no eligible valid thread has a count of zero. Zero means no qualifying thread in the released selection, not that no family experiences exist. A retained coverage entry with an unknown search date still describes that released selection. When `facebookResearch.withheldCount` is positive, cards and detail show the number of captured observations withheld from editorial release and excluded from the count beside it. Withheld observations do not become threads, people or posts in this count.

Only `sort=experience` within a selected care category uses the count. Equal non-null numeric scores sort by descending thread count, then the existing distance, name and ID order. Providers matched through secondary search categories participate in the same selected-category comparison. Unequal numeric scores retain their numeric order. Unrated providers retain distance, name and ID order regardless of thread count. Distance and CMS sorting do not use this signal.

Cards and detail label the count as selected resident or family accounts for the exact provider. These are qualitative accounts with self-described, unauthenticated relationships. Counts do not establish independent people, positive sentiment, quality, safety or prevalence. Broader selected evidence gives families more accounts to inspect when numeric scores tie. More selected threads can reflect search coverage and editorial selection rather than better care or more positive experiences. The tie-break is an explicit discovery policy, not a validated outcome model. Material warnings and the existing finding filters remain visible.

## Validation

`tests/experience-score.test.ts` retains the existing synthetic eligibility and weighting checks. Added v2 counterexamples cover symmetric sparse-sample withholding, five-review family floors, substantial disagreement, tiny dissenting sources, consistent high scores, primary narrative eligibility, positive and negative selection, overlapping aggregates and transitive excerpt duplicates. Tests verify that narrative evidence can withhold publication while preserving platform averages and review counts, that reversing inputs cannot change results, and that scoring does not mutate inputs. Retained-property checks use the normal `getLocationResearch` entry point.

`tests/family-experience.test.ts` adds synthetic fixtures for original-thread deduplication, reel and video URL aliases, excluded kinds, invalid and missing links, covered zero, unsearched providers, unchanged numeric summaries and scored tie-only sorting. Card tests verify that only positive thread counts appear. Detailed coverage distinguishes withheld observations and unsearched providers. The research API tests independently expect one released campus thread for NewBridge, two for its separate nursing record and three for Wareham, including its reel. The Facebook browser tests check positive counts on cards and coverage details for zero and unsearched states, alongside the existing filters and warning behavior. Their accessibility scope includes the family-evidence count and disclosure. A public methodology browser test checks the tie-only policy, exclusions and campus-scope caveat.

Actual research data is independently source-linked. Caring's broad-campus Brooksby and Linden Ponds aggregates retain single-family limited-coverage results. Carleton's unresolved campus/nursing-unit mixture and Brooksby's ambiguous memory-care aggregate stay excluded. Fox Hill's published 4.4/5 from 12 reviews remains inspectable but no longer supplies a lone-family score.

## New Jersey audit and measured v1/v2 results

Assessment date is 2026-11-12. These deterministic results use the retained NJ records through `getLocationResearch`, not newly invented property reviews. The following examples each use one eligible Google aggregate republished by MyLivingChoice. Retained excerpts, where present, are separate from that aggregate. `tests/experience-score.test.ts` checks their published average, count and actual v2 result. V1 is the normalized published mean because each retained example has exactly one eligible family.

| Retained property and provider ID                          | Published Google mean/count | V1  | V2           | Explanation                                         |
| ---------------------------------------------------------- | --------------------------- | --- | ------------ | --------------------------------------------------- |
| Brandywine Summit, `north-jersey-doh-nj90a001`             | 4.9/5, 28                   | 9.8 | Unrated      | Sparse single family.                               |
| Sunrise of Westfield, `north-jersey-doh-nj90144`           | 4.6/5, 25                   | 9.2 | Unrated      | Sparse single family.                               |
| Arbor Terrace Morris Plains, `north-jersey-doh-nj13a012`   | 4.9/5, 120                  | 9.8 | 9.8, limited | Large single family, no blanket high-score penalty. |
| Brighton Gardens Florham Park, `north-jersey-doh-nj60a001` | 4.6/5, 30                   | 9.2 | 9.2, limited | Exact single-family boundary.                       |
| Arbor Ridge Rehabilitation, `cms-315234`                   | 4.8/5, 375                  | 9.6 | 9.6, limited | Larger nursing-home sample, not a clinical rating.  |

Retained provenance includes `research/north-jersey/review-release/source-checks/brandywine-living-at-summit.json`, `source-checks/arbor-terrace-morris-plains.json`, the release `source-observations.json`, and the currently consumed `src/data/regional-markets.json`. No release input or generated artifact changes as part of this scorer work.

The final release counted every visible eligible review before choosing highlights. Out of 41 retained pages with visible reviews, 204 rows were visible and 196 met the metadata requirements. Each property’s publication guard uses its own recent, deduplicated rows. The platform chose which reviews to display.

| Location | Google average / reported count | Recent critical / eligible / visible | Harbor outcome |
| --- | --- | --- | --- |
| Complete Care at Orange Park | 4.4/5 · 200 | 3 / 4 / 5 | Withheld due to disagreement |
| Excel Care at Wayne | 4.1/5 · 158 | 3 / 5 / 5 | Withheld due to disagreement |
| Alaris Health at the Chateau | 4.1/5 · 314 | 2 / 5 / 5 | 8.2 single-source estimate, with concerns noted |
| Complete Care at Harborage | 4.8/5 · 297 | 0 / 5 / 5 | 9.6 single-source estimate |

At the November 12, 2026 assessment date, the revised policy published 56 of 974 North Jersey locations and 21 of 521 Massachusetts locations. Before the change, 66 and 122 locations respectively had a score. The reported aggregate counts and the values of continuing scores were identical.

The public-page audit found reasons not to equate a high single-platform average with uniform family experience:

- [Brandywine Summit's APFM page](https://www.aplaceformom.com/community/brandywine-summit-by-monarch-75630), directly inspected on the assessment date, identifies 41 Springfield Avenue and publishes **3.9/5 from 28 reviews**. Its separate proprietary 8/10 is not the review average. A June 2024 family account praises the setting and activities but criticizes inconsistent food. January 2026 and November 2025 accounts are favorable. Older negative accounts refer to Spring Meadows and earlier management. Those older accounts cannot establish current conditions. APFM/SeniorAdvisor would be one family, not two.
- [Sunrise of Westfield's APFM page](https://www.aplaceformom.com/community/sunrise-of-westfield-61361), directly inspected on the assessment date, publishes **4.2/5 from 30 reviews**, distinct from its proprietary 8.9/10. The October 13, 2026 family account praises food and rooms but criticizes limited activities. Other recent family accounts praise staff. The April 2025 account praises workers while describing a mismatch in required care. These mixed experiences are neither all-negative nor proof of prevalence.
- [Brandywine's Assisted Living Center page](https://www.assistedlivingcenter.com/facilities/nj/summit/brandywine-living-summit-07901/), directly inspected on the assessment date, displays a February 2026 account with both a care complaint and praise for other staff. It gives only a month and mixes local submissions with explicitly Google-labeled reviews. Its review heading and FAQ also differ. That page cannot supply an independent primary narrative or clean independent aggregate under this policy. Its Google reviews must not be added to MyLivingChoice's Google count.

These observations are audit evidence, not a silent publication of new sources or a claim that platforms contain independent people. The retained Brandywine and Sunrise scores therefore follow the sparse-sample rule above. Tests separately exercise a clearly labeled audit probe with the directly observed APFM published aggregates and a recent selected account. If those exact-location aggregates pass the separate release review, Brandywine's conflicting 7.8 and 9.8 source averages remain visible with the Harbor composite withheld. Sunrise's combined result is **8.8/10 with moderate coverage**. Its APFM mixed account then overlaps the included APFM aggregate and cannot count again as independent disagreement. Without the APFM aggregate, the account is independent qualitative context, but cannot restore the retained sparse Google score. Those probe results are not the currently published inputs.

Reproduce the retained comparisons and audit probes with `npx tsx --test tests/experience-score.test.ts`. The audit does not establish complete public-review coverage, reviewer authenticity or clinical quality.
