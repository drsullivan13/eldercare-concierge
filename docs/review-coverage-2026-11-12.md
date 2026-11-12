# Experience research coverage · November 12, 2026

Harbor now has a provisional experience score for 122 of its 521 catalog locations, up from six. The calculation is unchanged. The increase comes from inspecting additional public rating pages, checking the exact location and reviewer population, and retaining their published average and count.

All 122 scores currently have **limited source coverage**. None establishes that a provider is safe, clinically effective or the best choice for a particular person.

| Current result                                                       | Locations |
| -------------------------------------------------------------------- | --------: |
| Score available                                                      |       122 |
| Eligible evidence, but fewer than ten reported reviews               |       122 |
| Aggregate found, but source, identity or population needs resolution |        67 |
| No retained rating aggregate                                         |       210 |
| Total catalog                                                        |       521 |

Scores are available for 87 assisted-living residences, 32 nursing homes and three continuing-care campuses. Agency and staffing records remain unscored under this consumer-rating policy; CMS patient surveys remain available separately where applicable.

## What was researched

Four disjoint assignments covered 121 and 120 non-nursing locations, plus two groups of 140 nursing homes. Each catalog location received a public search or an exact-source page check. This was primarily Caring.com research, supplemented by A Place for Mom and selected other public pages. It was not an exhaustive search of every platform.

The expansion retained 310 location records with 317 aggregate observations. Combined with earlier inputs, 311 locations have at least one aggregate, including excluded and small-sample observations. The [search ledger](../research/review-runs/2026-11-12/search-coverage.json) records attempted locations, queries where retained, source URLs and input hashes. A failed search or inaccessible page does not establish that no reviews exist.

Only directly inspected, attributable consumer averages can contribute. Search snippets, proprietary ranking scores, mixed industry-reviewer populations, unresolved care-unit matches and small samples remain excluded or unrated. APFM and SeniorAdvisor share one source family. Duplicate source pages do not add another independent opinion.

Two independently reopened sources changed during reconciliation: Current South Shore now uses APFM's 4.8/5 from 29 reviews; Bostonian's Birdeye 3.8/78 is retained as ambiguous because the page did not establish the underlying consumer population and source counts. Eight address corrections were checked against providers' own pages. Original state records and map points remain intact, and the private research registry received the same address corrections.

## Facebook findings

The amended pilot supports 31 curated findings across ten locations, drawn from 39 of the original 71 observations. The other 32 remain withheld. Coverage explanations span the original 20 search targets and two separately identified care entities. The [publication audit](facebook-publication.md) explains each reassignment and exclusion.

The dashboard labels resident/family accounts, tours, recommendations and provider promotion separately. It shows dates, links and limitations without copying names or medical details. Harbor reviewed the collector's files and documented follow-up; this release does not claim an independent Harbor reread of Facebook sources. These selected accounts never alter the numeric score.

## Repeatable next pass

1. Download **Catalog research checklist** from the dashboard, or request `/api/research-coverage?format=csv`. It contains all 521 locations, exact IDs, current scores, evidence gaps, source URLs and next actions. The JSON endpoint is `/api/research-coverage`.
2. Assign nonoverlapping location IDs. Consult the search ledger before repeating a blocked page or a known mismatch. A search attempt, an inspected page and an accepted score input are different outcomes.
3. Inspect exact-location public pages. Record the source, check date, published consumer average, scale, count, reviewer mix and care-unit scope. Preserve contradictory observations. Do not infer a mean from a few selected reviews or a recommendation percentage.
4. Keep candidates in a new research input. Review scope and access before setting an aggregate to consumer evidence. Resolve ambiguous identity against official addresses; never assign another unit's score to a campus.
5. Rebuild with `python scripts/prepare-data.py` and `python scripts/prepare-location-research.py`. Run the source-provenance, scoring and search tests, then check the changed locations in the dashboard before publication.

The next Facebook run should prioritize the unresolved assignments in the collector's follow-up: exact-unit attribution, the Care One nested reply, the South Shore VNA address discrepancy and the Recommendations enumeration gap. Preserve a full denominator where the platform exposes one. A handful of selected comments can improve questions for a tour; it cannot supply a representative zero-to-ten score.

The public review and Facebook imports remain reviewed snapshots. The scheduled worker currently refreshes official CMS sources; it does not automatically harvest social reviews. Yelp remains disabled, and this expansion used no paid feed.
