# Researcher brief — Harbor NJ run fb-nj-union-morris-2026-11-12

Give this brief to each per-county-slice researcher subagent, at most 5
providers each. The researcher reads the run's `batch-manifest.json`,
`assignments.csv`, `roster-notes.md`, `collection-protocol.md` and both CSV
templates before searching.

## What you are doing

You are researching what residents and families say on Facebook about the
elder-care locations assigned to you, for the Harbor research database:
attributable accounts of life and care after admission, plus clearly labeled
tour experiences and recommendations. Do not calculate facility scores or
publish findings. Every observation starts `internal_review_pending`.

This run's batch is RECONCILED from two sources. The 12 fixed facility
assignments come from Harbor's supplied
`supplied-first-facility-assignments.csv` (repo commit f61a0de; IDs
`nj-doh-NJxxxxx`, 6 per county). Five more rows fill CCRC/home-service
slots from the provisional roster built the same day from official sources
(`nj-u-08` Lantern Hill, `nj-u-09` BAYADA Cranford, `nj-u-10` Visiting
Angels Union, `nj-m-09` VNA of Northern New Jersey, `nj-m-10` Visiting
Angels Morristown). Total 17 assignments; 3 of the 8 remaining slots stay
open (no verified Morris CCRC; no further official home-service
assignments available in this pass). Twelve provisional facility rows were
dropped to alternates — do not research them; they are listed in
`roster-notes.md`.
In observations and coverage, `provider_id` is the assignment ID. Harbor
IDs are blank everywhere until reconciled — never invent one.

## Inputs

- Assignments: `assignments.csv` in the run dir (official_name,
  former_names_or_aliases, address, municipality, county, care_setting,
  care_unit, source_url, source_identifier, source_type, selection_notes).
  `roster-notes.md` records name changes, address ambiguities, failed
  leads and verified alternates — read it before searching your slice.
- Protocol: `collection-protocol.md` v0.1 (in the run dir). Follow it
  exactly. Unknown scalars stay blank. Never guess a date, a zero rating
  or a source URL. Dates are UTC ISO 8601. Themes and experience stages
  come only from the protocol vocabulary.
- Your providers: the manifest lists them by county. Record the assigned
  IDs in your notes.

## Search surfaces

- `social.search` with platform=facebook, since=<24 months back>, top=25.
  Neutral queries only: exact name + town, name variants and former names,
  name + review / recommendation / experience. Prefer the last 24 months;
  keep useful older accounts with their dates.
- `browser.search` to find each provider's public Facebook Page, then
  `facebook-cli post read --url` for specific public posts.
- `facebook-cli groups search --keywords '<town or topic>'` and
  `groups posts --group-id <id> --query '<provider name>'` for public
  caregiver and community groups.
- Record care dates separately from post dates. Record every query you ran
  and every group or page you checked, including ones that returned nothing.
- Search snippets can identify leads but cannot establish a finding: open
  the underlying page or post and verify from the source itself.

## What you never do

- Never post, comment, message, join a group, submit a form, create an
  account or request access. Never bypass access controls.
- Never collect names, profile links, contact details, diagnoses, treatment
  details or identifying health information.
- Never quote private-group material. Public excerpts are optional and capped
  at 25 words total per source or thread. No screenshots with people or
  personal info.
- Never turn likes, recommendations or sentiment into stars or scores.
- Do not contact people or facilities.

## Private groups

Public sources are the default. Skip private groups, member-only content
and inaccessible pages; record them as access limits in coverage. For a
private group, read its rules first with `groups details` if you can do so
without joining. Proceed only if the rules clearly permit research and
reuse AND the run's authorization covers it — membership alone is not
permission. If the rules are unclear or forbid it, log `access_restricted`
in coverage and copy or summarize nothing from the group. Permitted
private research returns only a redacted internal note marked
`restricted_no_publication`. You may not join any group.

## Matching

- Confirm the exact provider by name, address, town and care setting
  before recording an observation against it.
- `match_status=exact` only when location and care entity are both
  established, with a `match_reason`. Probable or unresolved means blank
  `provider_id`, keep `candidate_provider_name`, explain what is missing.
- Never transfer a review between a campus and a separately licensed unit
  (nursing home, memory-care unit, home-care branch) or between brand
  locations without explicit evidence it belongs to the assigned entity.
- An agency office address does not establish its service area: a home
  health or home care account is about the agency only when the account
  names that agency or its office's service; do not attribute a brand's
  statewide reviews to one office.
- DENVILLE RULE (from the prompt, binding): The Oaks at Denville
  assisted living (19 Pocono Road, `nj-doh-NJ60A002`) and long-term care
  (21 Pocono Road, `nj-doh-NJ61424`) share a name, ZIP and phone number.
  A post naming only the community or quoting the shared phone CANNOT
  establish which unit it describes. Preserve such accounts as a campus
  candidate (match_status probable or unresolved, `provider_id` blank,
  `candidate_provider_name` "The Oaks at Denville") and leave BOTH unit
  IDs unassigned until there is unit-specific evidence (an address, a
  unit name, or a service only one unit provides). The two Denville rows
  are researched by the same agent so this rule is applied consistently.
- NJ-specific traps (from roster-notes.md — verify each from the source,
  do not take the note as the finding):
  - Mira Vie At Fanwood was licensed as The Chelsea at Fanwood; search
    both names, attribute to the Fanwood address only.
  - Complete Care At Westfield was Westfield Center; Aristacare At
    Parkside and Aristacare At Delaire share one license/CCN — do not
    split their accounts across two entities.
  - Lantern Hill: NJ DOH address is 537 Mountain Avenue, New Providence;
    the operator site gives 535. The campus's continuing-care unit is the
    rostered entity; do not transfer campus-wide reviews to the unit
    without evidence.
  - CareOne At Parsippany is licensed "Careone At Parsippany" and
    marketed as "CareOne at Morris"; a separate "CareOne at Morris
    Assisted Living" sits at 200 Mazda Brook Road and is NOT rostered.
  - Merry Heart Nursing Home (200 Route 10 West) vs Merry Heart Assisted
    Living (118 Main Street, Succasunna) — different entities, do not mix.
  - Morris View Healthcare Center: NJ DOH lists Morristown, 07960;
    secondary directories list the same address as Morris Plains. Follow
    NJ DOH.
  - The Oaks At Denville: rostered ALR is 19 Pocono Road; the separate
    nursing-care unit at 21 Pocono Road is NOT rostered.
  - Visiting Angels Union: registered address 2816 Morris Ave Ste 37,
    Union (HP0065000) vs operator site's Springfield office — the
    registered Union address is the rostered entity. The Millburn
    franchise's number HP0118200 must NOT be attributed to any Morris
    office. Visiting Angels Morristown (nj-m-10) has NO verified HCSF
    number — record that gap in coverage; do not invent one.
  - BAYADA Cranford: NPI-registered 6 Commerce Dr PH Suite; the operator
    site also lists 11 Commerce Drive Suite 1 — the registered address is
    the rostered entity.
  - Memory care in NJ is a program inside an assisted-living residence
    license, not a separate license class: a memory-care account belongs
    to the ALR that runs the program unless the source names a different
    licensed unit.

## Extraction

- Relationship is self-described only: resident, family, tour visitor,
  staff, care professional, other, unknown. Keep employment accounts
  separate from resident and family care accounts. Distinguish
  resident/family experience after care began from tours, generic
  recommendations, staff accounts, provider-selected testimonials and
  promotion. Preserve mixed and unfavorable experiences as well as
  favorable ones.
- Themes use only the protocol vocabulary: communication,
  staff_responsiveness, staff_continuity, respect_and_dignity,
  personal_care, medication_coordination, dining, cleanliness, activities,
  billing, admission_transition, discharge_followup, family_access,
  transport, other.
- Duplicates and reposts are not independent experiences. Record the first
  occurrence and point later ones at it with `duplicate_of` plus
  `independence_notes`. A shared thread alone proves neither duplication
  nor independence. Likes are not satisfaction votes.
- Do not infer authenticity and do not label reviews fake.
- Serious allegations are reported allegations, not confirmed events.
  Set `concern_type=safety_allegation`, keep the source and the uncertainty,
  and set `needs_human_review=true`. `needs_human_review` is also always
  true for ambiguous matches and restricted material. In this run, flag
  EVERY observation for human review.
- Employment accounts (for example labor-dispute advocacy posts) are a
  common false positive for home-health and staffing providers. Record them
  as what they are and never read them as resident or family care accounts.

## Aggregate candidates (separate file)

If a page visibly publishes a consumer rating, scale and review count for
the EXACT assigned location, record it in
`scratch/<slice>-aggregate-candidates.csv` with headers:
`assignment_id,harbor_id,source_url,page_name,rating_value,rating_scale,review_count,population,checked_at_utc,notes`
— `population` is what the count counts (e.g. "Facebook Recommendations",
"Google reviews") as stated on the page; `harbor_id` stays blank; preserve
missing fields as blank. Do NOT derive a rating from posts, likes,
recommendations, or inferred reviewer counts. This file is for eligibility
review only; nothing in it is a score.

## Checkpointing and outputs

- Checkpoint after EVERY provider: append rows to your scratch files before
  moving on, so an interrupted run resumes without duplication.
- Write `scratch/<slice>-observations.csv` and
  `scratch/<slice>-coverage.csv` using the supplied template headers exactly
  (run_id `fb-nj-union-morris-2026-11-12`, provider_id = assignment_id).
  One coverage row per assigned provider, including zero-result providers
  (`searched_no_relevant_result`, `access_restricted` or `ambiguous_only`),
  with sources_checked as a JSON array, check date, outcome, access limits
  and unresolved questions.
- Write `scratch/<slice>-aggregate-candidates.csv` when applicable (empty
  file with headers only if no page in your slice publishes a rating).
- Write `scratch/<slice>-notes.md` with per-provider queries, groups and
  pages checked, blocks, ambiguities, name variants tried and exclusions
  with reasons.
- Observation IDs use the slice prefix (`fb-nju-a-`, `fb-nju-b-`,
  `fb-njm-a-`, `fb-njm-b-`) and are unique within the run.
- Report back with providers completed, observation count, zero-result
  providers, blocks, serious allegations flagged, aggregate candidates
  found, and the file paths written.
