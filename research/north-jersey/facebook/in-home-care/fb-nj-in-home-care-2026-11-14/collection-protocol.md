# Experience collection protocol, version 0.1

This protocol defines a research handoff. It does not activate an importer, a scheduled collector or a new scoring rule in Harbor. Current application scores continue to use their existing policy until a reviewed change is implemented.

## Records and values

Use UTF-8 CSV with the supplied column names. Quote fields containing commas or line breaks. Preserve leading zeroes in ZIP codes and CMS identifiers. Leave unknown scalar values blank; never write a guessed date, zero rating or invented source URL. Use UTC ISO 8601 timestamps for retrieval and run dates. For multiple themes or queries in one CSV cell, use a JSON array of strings.

`run_id` identifies the assignment and its collection date. `observation_id` is unique within the run. Assign stable local IDs such as `fb-001`; do not encode people's names or profile handles in them. A repeated run must retain source URLs so the importer can recognize previously collected material.

Allowed observation values:

| Field | Values or meaning |
| --- | --- |
| provider_id | Exact catalog ID for a confirmed match; blank for unresolved candidates |
| match_status | exact, probable, unresolved |
| match_reason | Location and care-unit evidence supporting the match |
| source_url | Actual permalink, if available; missing links require human review |
| thread_url | Actual root thread URL, useful for duplicate detection |
| source_visibility | public, private_authorized |
| posted_at | ISO date only when established; otherwise blank |
| experience_period | Stated date, month, year or range; preserve approximate wording |
| relationship | resident, family, tour_visitor, staff, care_professional, other, unknown |
| account_type | firsthand, recommendation_without_detail, hearsay, provider_promotion, unclear |
| care_level | Source-stated care level; unknown if it cannot be determined |
| experience_stage | touring, receiving_care, previous_care, employment, unknown |
| themes | JSON array using the vocabulary below |
| sentiment | positive, negative, mixed, neutral, unknown |
| summary | Short, attributed paraphrase, without personal or medical identifiers |
| supporting_public_excerpt | Optional, only for permitted public material; 25-word source/thread cap |
| concern_type | none, service, financial, safety_allegation, unclear |
| duplicate_of | Observation ID for a known duplicate, otherwise blank |
| independence_notes | Known shared thread, copied text or repeated experience; otherwise say independence unestablished |
| use_status | internal_review_pending, restricted_no_publication |
| needs_human_review | true or false; always true for ambiguous matches, restricted material and serious allegations |

Theme vocabulary: `communication`, `staff_responsiveness`, `staff_continuity`, `respect_and_dignity`, `personal_care`, `medication_coordination`, `dining`, `cleanliness`, `activities`, `billing`, `admission_transition`, `discharge_followup`, `family_access`, `transport`, `other`.

`care_level` is not a diagnosis. A broad campus review does not establish experience in its memory-care or nursing unit. An employment review remains an employment review even when it describes conditions relevant to residents.

Coverage status values: `evidence_found`, `searched_no_relevant_result`, `access_restricted`, `ambiguous_only`, `partial`, `not_searched`. Record mixed limitations in `access_limits`; a public result does not imply private sources were searched. `observations_found` counts rows, not people. Log search queries and visible filters so a subsequent researcher can reproduce the method. Social search results are selected and personalized; do not describe them as an exhaustive review history.

## Review before import

A human reviewer checks the exact provider/unit match, source accessibility, dates, faithful paraphrase, duplicate status and any restrictions on reuse. Restricted observations are kept outside the public catalog. The reviewer must distinguish the ability to read material from permission to retain, analyze or republish it.

Accepted public insights need supporting observation IDs and a clear time window. Counts describe the retrieved sample. Do not call a theme common among residents based on the percentage of selected posts mentioning it. A serious allegation can require follow-up without becoming a confirmed safety finding or a prevalence estimate.

The future importer should be idempotent: importing the same observation again updates its retrieval history without adding another experience. It should retain source edits/deletions, provenance, extraction version and review decisions within the permitted retention policy. A source deletion or permission change should trigger review of derived findings too.

## Repeating the work in another market

1. Establish the catalog identities first: stable national record ID, address, state identifiers where applicable, care setting, parent organization and separately operated/licensed units. Track renames, ownership changes and former addresses.
2. Assign nonoverlapping provider batches. Store a run manifest with market, assigned IDs, researcher/collector, collection window, query recipe and protocol version.
3. Collect through a source-specific adapter. Keep coverage failures separate from negative sentiment. Preserve source-specific access and retention rules.
4. Route uncertain matches, conflicting evidence and serious allegations to human review. Sample ordinary accepted records too; reviewing only flagged records misses silent errors.
5. Produce source-linked themes and dated experience profiles. Calculate numerical scores only under an approved scoring policy using eligible data. Keep employee views, tour reviews, delivered-care experiences and official patient surveys distinguishable.
6. Schedule refreshes by source rights and observed update frequency. Record successful retrieval separately from the experience date. Expire stale summaries, retry failures and keep a checkpoint. No scheduled collection is configured by this kit.

Measure exact-match error rate, supported-summary accuracy, duplicate leakage, source age, care-level coverage and human-review backlog. Track both researched locations and score-eligible locations; neither number should stand in for the other.
