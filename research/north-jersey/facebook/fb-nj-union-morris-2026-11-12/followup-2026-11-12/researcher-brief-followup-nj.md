# Researcher brief — NJ follow-up (followup-2026-11-12)

Follow-up to run `fb-nj-union-morris-2026-11-12` (base batch pushed at
commit `0041ba3f` on branch `research/north-jersey-fb-2026-11-12`).
Read first, before searching: the base batch's `run-summary.md`,
`observations.csv`, `coverage.csv`, `aggregate-candidates.csv` and
`roster-notes.md` in the parent run directory, plus
`collection-protocol.md` (v0.1), `observations-template.csv`,
`coverage-template.csv` in this directory, and
`followup-2026-11-12/assignments.csv` + `batch-manifest.json`.

## Your assignments (7, Harbor IDs supplied)

`provider_id` in observations and coverage is the assignment ID
(`nj-campus-…`, `nj-reg-…`, `nj-hha-…`). The Harbor ID is recorded in
`assignments.csv` and the manifest — never invent a Harbor ID, and never
put one in `provider_id`.

- **Union slice A** (`fb-njfu-a-`): `nj-campus-lantern-hill` (Lantern
  Hill campus, 535 Mountain Ave, New Providence 07974),
  `nj-reg-HP0254700` (A1 Plus Home Care Services, 2424 Morris Ave
  Ste 107, Union 07083), `nj-reg-HP0364600` (AAK Healthcare Institute,
  1460 Morris Ave, Union 07083).
- **Morris slice B** (`fb-njfu-b-`): `nj-reg-HP0015347` (BAYADA Home
  Health Care, 32 Maple Ave 1st Fl, Morristown 07960),
  `nj-reg-HP0414500` (CSS Morris LLC, 15 Wychwood Rd, Morristown
  07960), `nj-hha-317020` (BAYADA Home Health Care, 11 Commerce Dr,
  Cranford 07016), `nj-campus-cedar-crest-village` (Cedar Crest
  Village, 1 Cedar Crest Village Dr, Pompton Plains 07444 — Passaic
  County).

## Rules carried over from the base run

- Public Facebook sources only. Skip private groups, member-only
  content, inaccessible pages. Do not contact people or facilities.
- Inspect the underlying page or post — search snippets identify leads
  but cannot establish a finding.
- Every observation starts `internal_review_pending` and
  `needs_human_review=true`. No scores, no publication.
- Omit personal identifiers and medical details. Label allegations as
  attributed accounts. Public excerpt ≤25 words total per source/thread.
- Distinguish resident/family experience after care began from tours,
  generic recommendations, staff accounts, provider-selected
  testimonials and promotion. Preserve mixed and unfavorable experiences.
- Match strictly: `exact` only when location + care entity are
  established. Never transfer a review between offices, campuses, or
  separately licensed units without explicit evidence. Probable/
  unresolved → blank `provider_id`, keep `candidate_provider_name`,
  explain what's missing.
- One coverage row per assignment, even for zero findings, with
  `sources_checked` as a JSON array.
- Aggregate candidates: only if a page visibly publishes a consumer
  rating, scale and review count for the EXACT location. Never derive a
  rating from posts, likes, recommendations, or inferred reviewer counts.

## Address corrections in this follow-up (binding)

- **Lantern Hill:** the campus is at **535 Mountain Avenue**. Its
  licensed care unit is at **537 Mountain Avenue** — a separate licensed
  unit. This assignment is the campus. Community/campus-level material
  belongs here; material specific to the 537 licensed unit must not be
  transferred to the campus assignment. (The base batch row `nj-u-08`
  covered the 537 record.)
- **BAYADA Cranford:** assigned at **11 Commerce Drive**. The prior
  batch searched **6 Commerce Drive** (row `nj-u-09`, 0 observations).
  Re-search with the corrected address. Material tied only to
  6 Commerce Drive is candidate-only, not an exact match.

## Lantern Hill outage thread (Union slice A only)

Attempt a re-read of the 2026-07-04 power-outage post on the official
Lantern Hill Page:
`https://www.facebook.com/LanternHillCommunity/posts/pfbid02jWdUk7Y4MqkPDad7E1n6UfXmyZuunpMwmDXtL5ny1BX7gJ7C5o8umrLcsY2Cz3Bfl`
A search-indexed summary described two critical comments (a resident
needing a CPAP reporting an unmarked extension cord across a hallway;
repeated unanswered calls to the front desk). Record them as
observations ONLY if the original public content is accessible and the
location/context is confirmed (official Page, July 4 2026 outage at the
campus). If the comments are not retrievable, keep them OUT of
observations and record the attempt, what the CLI returned, and the post
URL in the coverage notes for a human re-read.

## Traps

- BAYADA has many offices: Morristown (32 Maple Ave) and Cranford
  (11 Commerce Dr) are separate assignments. Do not transfer material
  between BAYADA offices, or from brand-level/corporate posts.
- AAK Healthcare Institute: the name suggests a training institute as
  well as home care. Match only the home-care service, not the school.
- CSS Morris LLC: verify what service this entity provides before
  matching; do not assume.
- Cedar Crest Village: watch for other Cedar Crest locations outside NJ.
- The base batch's unresolved/brand-confusion exclusions still apply
  (see `run-summary.md` § "Brand-confusion exclusions").

## Deliverables (per slice, in `followup-2026-11-12/scratch/`)

- `union-a-observations.csv` / `morris-b-observations.csv` (template headers)
- `union-a-coverage.csv` / `morris-b-coverage.csv` (one row per assigned provider)
- `union-a-aggregate-candidates.csv` / `morris-b-aggregate-candidates.csv` (headers only if none)
- `union-a-notes.md` / `morris-b-notes.md` (queries, sources, blocks, ambiguities, exclusions with reasons)

Report back with providers completed, observation count, zero-result
providers, blocks, serious allegations flagged, aggregate candidates
found, and file paths written.
