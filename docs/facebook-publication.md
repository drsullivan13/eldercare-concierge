# Curated Facebook findings: publication audit

November 12, 2026. The current `src/data/facebook-research.json` incorporates the pilot and documented follow-up at source commit `fb859b7`, under the user's instruction to implement useful, carefully attributed findings. The original source batch at `8b9f8eb7` and its private staging artifact remain intact. No raw CSV or collector script was merged into the application, and `apply-amendments.py` was not executed by this reviewer.

Harbor's editorial reviewer read the amended records, amendment log, assignment list and supporting follow-up notes. **The reviewer did not independently reopen Facebook sources.** The follow-up collector's documented rereads are evidence about its review process, not independent corroboration by Harbor, verified author identity or proof of current conditions. Qualitative findings never enter the numerical experience index or offset CMS evidence.

## Independent validation of the follow-up

The unchanged amended CSVs passed the repository's importer at the actual current UTC time: **0 errors, 6 warnings, 71 observations and 20 original coverage rows**. All six warnings are `unresolved_count`, at coverage CSV rows 4, 6, 12, 17, 18 and 21. The private import identifier is `batch_4b8ec8b4f59b230512c2253c363dcecb`. The dry run does not publish or stage records; all 71 normalized observations remain review-pending and score-ineligible under the importer contract.

An independent parsed-cell diff confirms **exactly 38 changed cells**: 32 observation cells and six coverage cells. Four are the previously documented deterministic coverage-format corrections; the other 34 are substantive metadata/review amendments. Row counts, headers and observation identities are unchanged. Input SHA-256 hashes:

- `observations-amended.csv`: `85ad8854e7637398306c9388586c52590f79f6e40679ce52a2b17599ed504dca`
- `coverage-amended.csv`: `fc723933784ca6cfb8bdd3d60b2cab9f885a6903b2fad4fbd9cba20cd5d42b75`

The per-row log accounts for all 71 rows: **50 marked source reread, 14 semantic group review, one failed direct reread with index corroboration, and six batch-file checks**. Thus “65 checked” must not be presented as 65 successfully reopened sources. The six file-only rows are `fb-bos-001/002`, `fb-nsh-003/006/013` and `fb-ssh-045`. `fb-nww-003` failed its direct reread and remains withheld with the related employment material.

## Current publication scope

The dashboard now has **22 coverage keys, 39 published observation rows, 31 curated findings across 10 locations, and 32 withheld rows**. The original 20 search targets remain represented; two explicitly authorized supplemental assignments identify the correct care entities. Counts sum to the original 71 observations without counting transferred candidates at both locations. They are not counts of independent people, households, care episodes or representative opinions.

| Location ID                                      | Published rows | Findings | Withheld rows counted here |
| ------------------------------------------------ | -------------: | -------: | -------------------------: |
| `cms-225434`                                     |              2 |        1 |                          0 |
| `cms-225469`                                     |              3 |        3 |                          0 |
| `all-care`                                       |              1 |        1 |                          0 |
| `cms-225433`                                     |              3 |        2 |                          0 |
| `lifeplan-brooksby-village`                      |              5 |        5 |                          0 |
| `ma-alr-harriett-and-ralph-kaplan-estates`       |              2 |        2 |                          0 |
| `lifeplan-newbridge-on-the-charles`              |              8 |        7 |                         20 |
| `ma-alr-all-american-assisted-living-at-wareham` |             10 |        5 |                          0 |
| `ma-alr-edelweiss-village`                       |              1 |        1 |                          0 |
| `cms-225774`                                     |              4 |        4 |                          2 |
| Other 12 coverage keys                           |              0 |        0 |                         10 |
| **Total**                                        |         **39** |   **31** |                     **32** |

Finding types are nine resident/family findings, twelve recommendations, five tours and five provider-promotion findings. No employment-dispute findings are published. Five original assignments retain the limited-search no-result state; this does not establish that no Facebook reviews exist.

## Explicit assignment and provenance supplement

These are editorial mappings authorized for the application, **not edits to the source CSV provider IDs or claims that the original importer accepted new assignments**. The original amended assignment file remains the original 20 IDs. The source notes and `assignment-list.md` in the follow-up directory provide the mapping evidence.

| Supplement                      | Observation IDs          | Exact application provider           | Evidence and disposition                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1                              | `fb-bos-006`             | `ma-alr-edelweiss-village`           | Collector's reread identifies the named assisted-living unit, care level and town. Publication is a visit/tour summary only. The open assignment was explicitly authorized; no additional source-identity fact is invented.                                                                                    |
| A4 — direct service attribution | `fb-ssh-016/017/030/031` | `cms-225774`                         | Collector's documented comments explicitly identify short-term rehabilitation or skilled nursing at NewBridge. Publish with the no-street-address, historical-date and relationship limitations. Do not transfer to the campus or assisted-living unit.                                                        |
| A4 — weaker attribution, held   | `fb-ssh-021/027`         | `cms-225774` candidate coverage only | Follow-up calls both verified but explicitly acknowledges that their service attribution rests on the discussion context; neither comment itself names rehabilitation. Both remain unpublished, including the favorable and unfavorable accounts. No selective positive-only promotion of this uncertain pair. |

The former `cms-225540` search target keeps its search history with zero attributable rows and an explanation that its candidate moved to Edelweiss. The campus count decreases from 34 to 28 as six candidates move into the separate nursing assignment, which reports four published and two withheld. The original 34-row coverage remains unchanged in the private CSV; this public view reconciles the editorial reassignment explicitly.

For A4, the other fourteen thread-context-only nursing candidates remain held in the original campus search coverage. They are not silently assigned to the nursing unit. Six probable campus memory-care candidates also remain held. A5, the separately licensed assisted-living entity, has no established candidate and is not added.

## Metadata corrections incorporated

- `fb-ssh-002/003` now support separate campus recommendations. The follow-up resolves the mistaken shared-thread statement: they are comments on two different official Page posts. A volunteer endorsement is labeled as a recommendation, not resident/family care experience; the other writer's relationship stays unknown.
- `fb-ssh-009` is a self-described employee endorsement in a public community group, not an official Page comment. It appears as **provider promotion**, with staff affiliation and unresolved licensed-unit scope explicit. It is not independent consumer evidence.
- The five earlier provider-selected testimonial/announcement flags now read true in the amended source. Only the already useful testimonials are retained, visibly labeled promotion; the administrative announcement stays withheld.
- The amended shared-thread and cross-provider notes are respected. Distinct comment IDs do not establish distinct households. `fb-nsh-011/012` remain the same cross-provider comment, not two independent recommendations. Existing grouped findings do not become separate independent experiences merely because no exact duplicate was confirmed.
- Historical campus records `fb-ssh-004` through `008` remain campus-scoped. Their assisted-living discussion context does not establish the separate licensed unit. The correction to unresolved `fb-ssh-012` remains in the amended source, but does not justify publishing or assigning that row.

## Withheld material and remaining source limits

| Reason                                                               | Count | Observation IDs                                                                                                                                |
| -------------------------------------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unresolved provider/unit identity, including two weaker SNF mappings |    27 | `fb-bos-008`, `fb-nsh-001`, `fb-ssh-001`, `fb-ssh-010` through `015`, `fb-ssh-018` through `029`, `fb-ssh-032` through `035`, `fb-ssh-046/047` |
| Related employment material awaiting further verification            |     3 | `fb-nww-001/002/003`                                                                                                                           |
| Administrative operator announcement                                 |     1 | `fb-bos-007`                                                                                                                                   |
| Recruitment advertisement                                            |     1 | `fb-nsh-002`                                                                                                                                   |

The employment-related coverage remains neutral; no allegation details or summaries are published. The follow-up links the three posts to one dispute and records one inaccessible source, so they are neither independently verified nor three independent signals.

The collector reports incomplete nested-reply access, inability to enumerate Facebook Recommendations, and an unconfirmed Wareham lead that was not captured as an observation. No content or negative finding is invented from that lead. The campus and Wareham coverage must not imply an exhaustive or balanced sample. Two public groups' stated requests to keep shared content within the group are also recorded in the follow-up; public accessibility is not presented as a blanket reuse endorsement. Harbor uses brief deidentified paraphrases and source links, not verbatim comments, names, medical details or copied group material.

The source audit and excerpt checks do not independently establish truth, author authenticity, current public accessibility or representativeness. Dates are post dates, not inferred care dates. Historical admission comments do not become current availability facts.

## Dataset contract and checks

The JSON shape is unchanged: `schemaVersion`, `runId`, `checkedAt`, `reviewBasis`, and `locations` keyed by exact current catalog IDs. Location fields remain `status`, original `searchedAt`, `foundCount`, `publishedObservationCount`, `withheldCount`, `coverageExplanation` and `findings`. Supplemental search timestamps preserve the original collection time; the document records the later editorial assignment rather than inventing a new search.

Each finding retains its supporting observation IDs, kind, source-described relationship, deidentified paraphrase, primary post date, original source/thread links, grouped supporting URLs, source-supported topics and limitations. `staff` is now used as a relationship on the employee-promotion finding; it is not a verification badge. No rating, score, sentiment or scoring weight is present.

Consistency checks verify all 22 catalog IDs, all 20 original targets, the explicit supplemental mapping, 39 distinct published observation IDs, original URLs and dates, counts totaling 71, and the absence of withheld IDs and raw excerpts in findings. These checks establish internal consistency and traceability, not source-truth validation.
