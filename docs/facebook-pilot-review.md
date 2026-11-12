# Facebook pilot review — November 12, 2026

The original pilot does **not** pass import validation. A separate copy with three deterministic coverage-format corrections **does pass and has been privately staged**. Format cleanup is sufficient for review-only staging; it is not source-truth validation or publication approval. All **71 observations** remain human-review-pending, unpublished and ineligible for scoring.

Reviewed source: `origin/research/facebook-pilot-2026-11-12`, commit `8b9f8eb7`, directory `research/facebook-runs/fb-pilot-2026-11-12/`. Files were read with `git show`; the branch was not checked out or merged. Original extracts, corrected copies, validation results and an audit manifest are confined to ignored `artifacts/facebook-pilot-review/`. No observations, names or review quotations are included in this report. No Facebook sources were revisited or contacts made during this review.

## Reconciliation

| Item                                                      |                    Result |
| --------------------------------------------------------- | ------------------------: |
| Manifest assignments / coverage rows                      |                   20 / 20 |
| Observations                                              |                        71 |
| Exact matches with catalog IDs                            |                        39 |
| Probable matches with blank IDs                           |                         8 |
| Unresolved matches with blank IDs                         |                        24 |
| Assigned providers with at least one exact-attributed row |                  11 of 20 |
| Sum of coverage `observations_found`                      |                        71 |
| Declared public visibility                                |                        71 |
| Submitted `internal_review_pending`                       |                        71 |
| Collector flags: true / false                             |                   38 / 33 |
| Actual staged human-review queue                          | 71: 2 priority, 69 normal |
| Approved for publication or scoring                       |                         0 |

The manifest declares a seeded, stratified selection of five locations per market: Boston, Newton/Weston/Wellesley, North Shore and South Shore. Its 20 names, addresses, cities and ZIPs match the current catalog. The care mix is eight nursing homes, three continuing-care campuses, four assisted-living residences, three home-health organizations, one home-care organization and one staffing organization. This review reconciled the manifest; it did not independently reproduce the selection algorithm.

Coverage contains nine `evidence_found`, two `ambiguous_only`, five `searched_no_relevant_result` and four `partial` rows. The 11 providers with exact-attributed observations include two whose overall coverage remains partial. Neither 71 observations nor 11 providers is a count of independent households, verified residents or exhaustive platform coverage. Zero-result searches do not establish that reviews do not exist.

## Original validation failures and exact cleanup

Validation used the importer's actual current UTC clock, with no artificial `--as-of` override, against the current 521-provider catalog and the manifest's 20 assigned IDs. CSV row numbers include the header as row 1.

| File / row         | Provider                                   | Field / code                        | Cause and correction in the private copy                                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coverage.csv`, 10 | `mgb-home-care`                            | `sources_checked` / `array_invalid` | The field was valid JSON, but its first description was 607 characters, exceeding the 500-character item limit. Retained its existing source/query label in that item and moved the complete original 607-character narrative verbatim to `coverage_notes`, with a format-move label. The other two source items were unchanged. |
| `coverage.csv`, 15 | `lifeplan-brooksby-village`                | `sources_checked` / `array_invalid` | Converted the five existing semicolon-separated segments into a JSON array, trimming separator whitespace only. No sources were added.                                                                                                                                                                                           |
| `coverage.csv`, 16 | `ma-alr-harriett-and-ralph-kaplan-estates` | `sources_checked` / `array_invalid` | Applied the same conversion to the five existing segments. No sources were added.                                                                                                                                                                                                                                                |

Exactly four logical cells changed: row 10 `sources_checked` and `coverage_notes`, and rows 15/16 `sources_checked`. All other coverage cells are unchanged. The observations file is **byte-identical** to the source branch. No missing facts, relationships, dates, unit identities or source classifications were filled in. No importer defect was identified or code changed.

The corrected dry run has zero errors and 11 warnings. Five warnings escalate submitted false review flags on provider-promotion records (`fb-bos-003`, `fb-bos-004`, `fb-bos-007`, `fb-nsh-008`, `fb-nsh-009`). The other six require reconciliation of unresolved counts:

| Coverage row | Provider                            | Reported rows | Exact-attributed rows | Candidate rows needing reconciliation |
| ------------ | ----------------------------------- | ------------: | --------------------: | ------------------------------------: |
| 4            | `cms-225540`                        |             1 |                     0 |                                     1 |
| 6            | `cms-225759`                        |             1 |                     0 |                                     1 |
| 12           | `abc-home-healthcare`               |             2 |                     1 |                                     1 |
| 17           | `cms-225634`                        |             1 |                     0 |                                     1 |
| 18           | `lifeplan-newbridge-on-the-charles` |            34 |                     8 |                                    26 |
| 21           | `south-shore-vna`                   |             2 |                     0 |                                     2 |

These differences sum to the 32 probable/unresolved rows. They are not silently assigned to providers by the importer.

## Substantive review findings

**All rows require review.** The collector's 38 true flags identify a priority subset, not the entire approval workload. The run summary should say that all 71 require identity, source, date, paraphrase, reuse, redaction and independence review before any later publication decision. The 33 false flags are not approvals. The staged artifact enforces that distinction.

**The sample mixes different kinds of evidence.** Submitted account types are 34 firsthand, 28 recommendations without detail, seven provider promotions, one unclear account and one hearsay account. Only ten rows across four providers meet the submitted combination of exact match, family/resident relationship, firsthand account and receiving/previous-care stage. That is a filter over self-described metadata, not verification of ten people or ten independent experiences. Keep tours, employment, general recommendations and delivered-care accounts separate in subsequent synthesis.

**Facility-selected testimonials are promotional evidence.** The Laurel Ridge items `fb-bos-003/004` and Brooksby items `fb-nsh-008/009` are identified as facility-published or provider-produced testimonials. Their `provider_promotion` classification should remain even where the person is described as a family member or resident. Do not promote them into independent consumer reviews or score inputs. The [Brooksby public page](https://www.facebook.com/BrooksbyVillage) identifies the publishing channel; it does not establish an independently sampled resident experience.

**NewBridge care units must remain distinct.** The 34 rows collected during the campus search comprise eight campus-exact, six probable and 20 unresolved skilled-nursing/rehabilitation candidates. The catalog already distinguishes:

- `lifeplan-newbridge-on-the-charles`: campus, 5000 Great Meadow Road; [provider campus source](https://www.hebrewseniorlife.org/newbridge).
- `ma-alr-newbridge-on-the-charles`: assisted-living residence, 6000 Great Meadow Road; [Massachusetts listing](https://www.mass.gov/locations/newbridge-on-the-charles).
- `cms-225774`: skilled nursing facility, 7000 Great Meadow Road; [Medicare record](https://www.medicare.gov/care-compare/details/nursing-home/225774).

Keep `fb-ssh-016` through `fb-ssh-035` unassigned until a reviewer establishes the actual entity from the source. The existence of a matching SNF in the catalog is a research lead, not permission to auto-map all 20 rows. Add that entity to a documented follow-up assignment if appropriate. Broad campus praise and an assisted-living recommendation thread do not establish nursing-unit performance or a known care level.

Two additional source-metadata inconsistencies need correction from the original evidence, not inference: `fb-ssh-009` describes an official Page thread in `match_reason`, while its stored source/thread URLs use a Facebook group-post route. `fb-ssh-002/003` describe a shared thread in their independence notes, but their stored thread URLs differ. Resolve the source context and thread grouping; leave observation content untouched until checked.

**MGB allegations are one linked review case, not three independent signals.** `fb-nww-001/003` are the two priority safety-allegation records. The intervening `fb-nww-002` is a staff/service account. The supplied notes identify all three as advocacy material concerning the same 2026 labor dispute. They are employment accounts, not resident or family care accounts, and the reported allegations are not confirmed events. Review the three together, preserve their source affiliation and timing, and record their shared context. Do not convert their repetition into a prevalence claim or use `duplicate_of` unless the reviewer confirms an actual duplicate account rather than related perspectives.

**Automated duplicate checks are incomplete by design.** The batch contains 69 distinct source URLs and 31 distinct thread URLs. Staging identifies 15 candidate groups involving 51 observations: 11 shared-thread groups, three repeated-location-summary groups and one shared-source/content-version group. These are review candidates, not automatic merges or household counts. The three MGB URLs do not trigger those mechanical groups, despite their shared dispute; semantic grouping remains a human task. The raw batch declares no explicit `duplicate_of` links.

All 71 rows declare public visibility, and the collector notes document some closed/private groups as unsearched. Schema acceptance does not independently prove visibility, source authenticity, accurate dates or reuse permission. Preserve those limits and incomplete pagination in the coverage ledger. This review did not copy private discussions or independently authenticate any writer.

## Private staging result and audit identifiers

Batch: `batch_62bf346496c504a4e74a09456cd2a808`.

The CLI's explicit `--write` ran in a private review workspace containing a byte-identical copy of the canonical catalog, keeping its fixed output path within the authorized review directory. The artifact is:

`artifacts/facebook-pilot-review/staging-workspace/artifacts/research-imports/batch_62bf346496c504a4e74a09456cd2a808.json`

File mode is `0600`; its directory is `0700`. All 71 normalized observations have `needsHumanReview=true`, `useStatus=internal_review_pending`, `publishable=false` and `scoreEligible=false`. No database, public-app input or numerical score was changed. `format-cleanup.json` in the private review directory records per-cell transformations, hashes and staging checks.

| Input / artifact                    | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| Original and corrected observations | `3ac4ba5c78ce8f1c0e2e1e44c6db872e3959485509d910f458fe9bae7682c6bc` |
| Original coverage                   | `b9826fbec3e44e0f94c6b72aca736ac0d5b3a5be76afc497f5cbded618400978` |
| Corrected coverage                  | `2878a879236e05886f24cbbc0fdd1e23b609ab69a322741f1c28fc68a972e73b` |
| Original batch manifest             | `f755f683415518955038631a0b1117b65bf6b62e0499a99ae7248e857bb5f657` |
| Derived assigned-ID list            | `9657c57dbf73866eac0278a97ad2aade741485564ada2bc6afc27cc81f95cf0c` |
| Private staging artifact            | `0c3b4866d5bbb36a8c954f2359a1fd436085b7dc6916e46cb6f123dfc6467581` |

## Next pass for the collector and reviewer

1. Adopt the three format corrections, retaining the original source run and its audit trail. Run the dry-run validator with the same 20-ID assignment before submitting another batch.
2. Rewrite the review gate to cover **all 71** rows. Triage the two allegation records together with the related MGB staff account; do not imply that validation confirms the allegations.
3. Reconcile the six coverage-count warnings using explicit observation IDs. Keep probable/unresolved provider IDs blank until source evidence supports an exact care-entity match.
4. Resolve the NewBridge campus/ALR/SNF distinctions and the thread/context metadata in the three affected records. Do not broaden the existing batch silently; record any added provider assignment.
5. Preserve provider-selected testimonials, employment accounts and tours as distinct source classes. Confirm direct comment permalinks where obtainable, and record missing pagination or unavailable links rather than inventing them.
6. Review duplicate candidates and related-event groups before drafting themes. Keep each proposed insight attached to observation IDs, time window and source limitations; selected counts are not resident prevalence.

The corrected batch is ready for **human review in private staging**, not for public ingestion or scoring. No additional collection, outreach or source access was performed as part of this review.
