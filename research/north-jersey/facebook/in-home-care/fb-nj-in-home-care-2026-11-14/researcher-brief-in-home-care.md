# Researcher brief — Harbor North Jersey in-home care run
# Run: fb-nj-in-home-care-2026-11-14

Read FIRST, before searching: `batch-manifest.json`, `collection-protocol.md`
(v0.1), `observations-template.csv`, `coverage-template.csv` — all in the run
dir `~/workspace/harbor/fb-nj-in-home-care-2026-11-14/`.

## What you are doing

You are researching what families say on Facebook about **paid, nonmedical
help in an older adult's home** — companionship, personal care, respite, help
with daily activities — for the Harbor research database: branch-level
evidence a family could use when deciding which agencies to interview. Do not
calculate scores or publish findings. Every observation starts
`internal_review_pending`.

**Exclude from family-experience evidence:** facility stays, employee reviews,
and Medicare skilled home-health episodes. Employment accounts (e.g. a
caregiver's job post) are recorded only as employment accounts, never read as
family care accounts.

## Your slice

Your seeds are listed in `batch-manifest.json` under your market. Record the
assigned IDs in your notes. Observation IDs use your market prefix from the
manifest (union `fb-nju-`, morris `fb-njm-`, essex `fb-nje-`,
comparison `fb-njc-`, discovery `fb-njd-`) and are unique within the run.

## Search surfaces

- `social.search` with platform=facebook, since=<24 months back>, top=25.
  Neutral queries only: exact name + town, name variants, name + review /
  recommendation / experience. Prefer the last 24 months; keep useful older
  accounts with their dates.
- `browser.search` to find each provider's public Facebook Page, then
  `facebook-cli post read --url` for specific public posts. For nested replies
  use the parent comment ID as `--post-id` to `facebook-cli post comments
  read`.
- `facebook-cli groups search --keywords '<town or topic>'` and
  `groups posts --group-id <id> --query '<provider name>'` for public
  caregiver and community groups.
- **Community Facebook pages — required, not optional.** For every seed and
  every search town, also search the town's public community Facebook pages
  and public community groups (e.g. town community forums, "residents"
  pages) for home-care recommendations and experience threads. Dan explicitly
  asked for community pages to be searched. Record every community page/group
  you checked, including ones that returned nothing. For a private group, read
  its rules first with `groups details`; proceed ONLY if the rules clearly
  permit research and reuse. Membership alone is not permission. If the rules
  are unclear or forbid it, log `access_restricted` in coverage and copy or
  summarize nothing from the group.
- Record care dates separately from post dates. Record every query you ran and
  every group or page you checked, including ones that returned nothing.

## What you never do

- Never post, comment, message, join a group, submit a form, create an
  account or request access. Never bypass access controls.
- Never collect names, profile links, contact details, diagnoses, treatment
  details or identifying health information.
- Never quote private-group material. Public excerpts are optional and capped
  at 25 words total per source or thread. No screenshots with people or
  personal info.
- Never turn likes, recommendations or sentiment into stars or scores.

## Matching — branch level, strict

- Confirm the **exact office** by its official address, town, phone or
  independently supported alias before linking a post. A brand, a nearby
  office or a franchise territory alone CANNOT establish which branch
  delivered care.
- `match_status=exact` only when location and care entity are both
  established, with a `match_reason`. Probable or unresolved means blank
  `provider_id`, keep `candidate_provider_name`, explain what is missing.
- Never transfer a review between a campus and a separately licensed unit, a
  home-care branch and another branch of the same brand, or a home-care office
  and a home-health agency without explicit evidence it belongs to the
  assigned entity. `assignments.csv` `selection_notes` list the same-brand
  nearby locations that must NOT be transferred for each seed.
- Known traps in this run: Visiting Angels "Montclair" is in Caldwell;
  Senior Helpers "Fairfield" is in Totowa; Visiting Angels Union has an OPEN
  address discrepancy (operator site: 485 Morris Ave #201, Springfield;
  earlier Harbor record: NJ DCA registry 2816 Morris Ave Ste 37, Union —
  registry unverified this run because the DCA PDF returned HTTP 403). A post
  naming only "2816 Morris Ave, Union" is an unresolved lead, not an exact
  match, until the registry is checked by another route. BAYADA Live-In
  Services (2nd Floor, 32 Maple Ave, Morristown) is a different service line
  from BAYADA Morris County (1st Floor). Life Home Care has Livingston, Glen
  Rock and Somerset offices that are NOT the East Hanover seed. BAYADA
  Pediatrics Passaic County (Little Falls) is NOT the Clifton seed.
- A search snippet is a lead only. Open the actual public Page, post or
  comment. Retain a stable permalink and explain any access limit.

## Extraction

- Relationship is self-described only: resident, family, tour_visitor, staff,
  care_professional, other, unknown. Keep employment accounts separate from
  resident and family care accounts.
- Themes use only the protocol vocabulary: communication,
  staff_responsiveness, staff_continuity, respect_and_dignity, personal_care,
  medication_coordination, dining, cleanliness, activities, billing,
  admission_transition, discharge_followup, family_access, transport, other.
- Duplicates and reposts are not independent experiences. Record the first
  occurrence and point later ones at it with `duplicate_of` plus
  `independence_notes`. Identical summaries are often collector templates for
  distinct name-only comments — check comment IDs before calling anything a
  duplicate. Likes are not satisfaction votes.
- Do not infer authenticity and do not label reviews fake.
- Serious allegations are reported allegations, not confirmed events. Set
  `concern_type=safety_allegation`, keep the source and the uncertainty, and
  set `needs_human_review=true`. `needs_human_review` is also always true
  for ambiguous matches and restricted material.
- Record mixed and negative findings too. Attribute any allegation, omit
  identifying and health details, avoid copying review text.

## Checkpointing and outputs (seed slices: union / morris / essex / comparison)

- Checkpoint after EVERY provider: append rows to your scratch files before
  moving on, so an interrupted run resumes without duplication.
- Write `scratch/<market>-observations.csv` and
  `scratch/<market>-coverage.csv` using the supplied template headers exactly.
  One coverage row per assigned provider, including zero-result providers
  (`searched_no_relevant_result`, `access_restricted` or `ambiguous_only`).
  `observations_found` counts rows found while searching that provider,
  including probable/unresolved rows with blank `provider_id`.
- Write `scratch/<market>-notes.md` with per-provider queries, groups and
  pages checked (including community pages), blocks, ambiguities, name
  variants tried and exclusions with reasons.
- Write `scratch/<market>-aggregate-candidates.csv` with header:
  `provider_id,rating,rating_scale,review_count,source_url,observed_location,check_date_utc,verification_status,notes`.
  Record a rating ONLY if the exact local Page itself visibly displays the
  rating, scale and count. Search-index place cards and likes do NOT qualify.
  If the Page does not surface a rating, record the lead with blank
  rating/scale/count and `verification_status=NOT VISIBLE` plus what you
  checked. Never calculate stars from comments.
- Report back with providers completed, observation count, zero-result
  providers, blocks, serious allegations flagged, and the file paths written.

## Discovery lane (market: discovery) — extra rules

- Towns to search (record the search town separately from any office address
  or service area): Chatham (07928), Summit, Westfield, Morristown,
  Montclair, Bridgewater, Somerville, Edison, New Brunswick. Counties: Union,
  Morris, Essex, Somerset, Middlesex. Try "home care agency for my mom",
  "companion for dad", "respite aide", "weekend aide", and "who have you
  actually used?" Search community Facebook pages and public community groups
  in each town first, then caregiver groups.
- Keep new independent agencies and small operators in the results. An
  individual aide recommendation is outside the agency cohort: tally it
  without collecting personal details. Distinguish a generic suggestion from
  experience after paid care began.
- **Do NOT assign `provider_id`, even if you believe a find is one of the
  16 seeds.** Discovery observations are recorded as probable/unresolved with
  blank `provider_id` and `candidate_provider_name` (name the seed you
  suspect in `match_reason` / `candidate_provider_name`); the seed slices are
  the authoritative matchers for their providers. Human review promotes
  seed-linked finds later.
- Write `scratch/discovery-observations.csv` (same observation template
  headers; every row is an actual experience/recommendation account) and
  `scratch/discovery-coverage.csv` (same coverage template headers; exactly
  ONE row, `provider_id=lane-discovery`, `observations_found` = number of
  rows in `discovery-observations.csv`).
- Write `scratch/discovery-leads.csv` with header:
  `lead_id,search_town,search_county,candidate_name,source_url,retrieved_at_utc,what_is_missing,harbor_id,notes`.
  Lead IDs use prefix `fb-njd-lead-`. This file holds names/mentions WITHOUT
  experience content, and ambiguous names needing follow-up. `harbor_id`
  stays blank.
- Write `scratch/discovery-town-searches.csv` with header:
  `search_town,search_county,queries_used,sources_checked,status,observations_found,leads_found,notes`.
  One row per town searched, including zero results
  (`searched_no_relevant_result`).
- Write `scratch/discovery-notes.md` with per-town queries, community pages
  and groups checked, blocks, and new-agency names found.
- Report back with towns covered, observation count, lead count, new agencies
  found, and the file paths written.
