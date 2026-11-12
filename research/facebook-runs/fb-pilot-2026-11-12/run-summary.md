# Run summary — fb-pilot-2026-11-12

Harbor Facebook experience research, pilot batch. Protocol v0.1.
Searched 2026-11-12. All observations `internal_review_pending`.
No scores calculated. Nothing here is published or imported.

## Batch

20 providers, seeded stratified random sample (seed 20261112), 5 per market,
round-robin across care categories. Selection method and assigned IDs are in
`batch-manifest.json`. Markets: Boston, Newton/Weston/Wellesley, North Shore,
South Shore.

## Counts

- 71 observations total: 39 exact, 8 probable, 24 unresolved.
- 39 rows carry a provider_id; 32 are blank (probable/unresolved candidates).
- 11 of 20 providers have at least one attributed observation.
- Coverage: 9 `evidence_found`, 4 `partial`, 2 `ambiguous_only`,
  5 `searched_no_relevant_result`.
- 38 observations need human review.
- Concern types: 62 none, 2 safety_allegation, 4 service, 1 financial,
  2 unclear.
- Account types: 34 firsthand, 28 recommendation without detail,
  7 provider promotion, 1 hearsay, 1 unclear.
- Relationships: family 22, resident 4, tour visitor 4, staff 5,
  care professional 2, other 4, unknown 30.
- Sentiment: positive 56, negative 9, mixed 2, neutral 4.

The positive skew is not a finding. Most of the positive material is
provider-published content and short recommendations without detail, and the
search surface is selected, not exhaustive. Do not read these counts as
satisfaction or as representative of any provider's residents.

## What was found, by market

### Boston (8 observations)

- Boston Home (cms-225434): 2, both tour visits by elected officials.
  No resident or family care account.
- Laurel Ridge (cms-225469): 3, two facility-published testimonial graphics
  (family member, Oct 2026; short-term rehab patient, Sep 2026) plus one
  recommendation comment on the patient thread. Strongest firsthand material
  in this market, both facility-published.
- German Center (cms-225540): 1 unresolved candidate only. The one
  attributable account was a visit to the Edelweiss Village assisted-living
  unit on the same campus, not the extended-care nursing unit. Not transferred.
- The Benjamin (cms-225654): 1, an operator announcement that the center
  joined the Allaire Health Services network (Aug 2026). Ownership flag,
  not a care account.
- Hebrew Rehab Recuperative Services Unit (cms-225759): 1 probable candidate
  only, a provider-published cookout post about Hebrew Rehabilitation Center
  Boston generally that does not name the unit.

### Newton / Weston / Wellesley (3 observations)

- Mass General Brigham Home Care (mgb-home-care): 3, all employment accounts
  from Massachusetts Nurses Association advocacy material during the July 2026
  labor dispute. Staff-reported workload and supply claims, not resident or
  family accounts of receiving care. Two carry `safety_allegation` (staff-
  reported unsafe caseload claims). All three concern the same dispute and
  must not be read as independent signals.
- Campion, Lasell Village, Waterstone at Wellesley, North River Home Care:
  no usable results. Plausible explanations in the notes (no public Page for
  Campion; North River's Wellesley office opened Oct 14, 2026; Waterstone and
  Lasell surface only provider-posted content).

### North Shore (13 observations)

- Brooksby Village (lifeplan-brooksby-village): 5, including one firsthand
  family account (father at Brooksby, mixed, billing / personal-care /
  admission-transition themes), two provider-produced testimonial reels, one
  tour-pricing note, one recommendation without detail.
- Aberjona (cms-225433): 3, all family comments on the facility's own public
  Page, one firsthand.
- Kaplan Estates (ma-alr-harriett-and-ralph-kaplan-estates): 2, one
  recommendation without detail from the Brooksby advice thread and one
  guided tour by a local business owner (2026-03-17).
- All Care VNA (all-care): 1 recommendation without detail from a public
  community-group thread.
- ABC Home Healthcare (abc-home-healthcare): 2, one unresolved candidate
  (name variant, no town) and one staff recruitment post.
- No reviews were transferred between Brooksby Village and its separately
  licensed nursing unit, or between Kaplan Estates and the Brudnick Center
  nursing unit at the same address.

### South Shore (47 observations)

- NewBridge on the Charles (lifeplan-newbridge-on-the-charles): 34 rows found,
  but only 8 are attributed to the life-plan campus. 20 rows concern the
  separately licensed skilled-nursing/rehab unit at 7000 Great Meadow Road
  and are recorded unresolved with a blank provider_id; 6 more are probable
  for the campus generally. The SNF unit generated far more public discussion
  than the campus itself. Do not merge the two.
- All American Assisted Living at Wareham: 10, mostly provider-posted
  activity content plus family comments on the facility's Page.
- South Shore VNA (south-shore-vna): 2, both unresolved. A garbled 2026-11-07
  thread alleges needed home-health help is not being sent, but the
  responsible entity is unestablished (the thread mixes South Shore services,
  the visiting nurse, pathways, the VNA and Old Colony Elder Services).
  Allegation preserved with uncertainty, needs human review.
- Care One at Weymouth (cms-225634): 1.
- Discovery Village Quincy: zero results. Its Page (71 followers) carries
  only promotional posts. Absence of public discussion, not an assessment.

## Serious allegations

Two observations carry `safety_allegation`, both MGB Home Care (fb-nww-001,
fb-nww-003): staff-reported unsafe caseload claims from the July 2026 labor
dispute advocacy material. Reported allegations, not confirmed events.

One further unverified lead was NOT recorded as an observation: a search
summary described a detailed negative comment in the Wareham opinions thread
(billing, medication/supply responsibility, falls, barred return) that was not
among the 8 comments retrievable via the CLI. It is noted in the South Shore
coverage and notes with the thread URL for direct human review.

## Fixes applied at compile

- Two quoted excerpts exceeded the 25-word per-thread cap and were trimmed:
  the Laurel Ridge testimonial thread (30 words to 23) and the Brooksby advice
  thread (74 words to 25, keeping the firsthand family account whole and
  blanking the excerpts on the three shorter comments in the same thread).
- One coverage status corrected from `no_results` (not a protocol value) to
  `searched_no_relevant_result` for Discovery Village Quincy.

## Limitations

- The Facebook CLI cannot list an unmanaged Page's posts or its
  Recommendations tab. Facility-page coverage comes from search hits plus
  direct reads of specific posts found via web search.
- Private groups were largely not searched: group rules did not permit
  research or reuse (Massachusetts Seniors Lifestyle, Greater Boston Senior
  Service Providers, Weymouth Community Page, Wareham Chatters, Quincy MA
  Community Page, Quincy Ma Happenings and Events, The Dedham Connection,
  Peabody MA Community Group). Nothing was copied from any of them.
- Comment pagination was incomplete on two NewBridge threads (27 of 36 and
  19 of 36 comments retrieved).
- `social.search` results are selected and personalized, not an exhaustive
  review history. A blank result means no public discussion was found, not
  that no experiences exist.
- No independent resident or family care account was found for most providers
  in this batch. The strongest firsthand material is facility-published
  testimonials, which are provider-selected by definition.

## Review gate

A human reviewer checks the exact provider/unit match, source accessibility,
dates, faithful paraphrase, duplicate status and reuse restrictions before
anything is imported into Supabase. The 38 rows flagged
`needs_human_review=true` need that check first, especially the 32 rows with
a blank provider_id and the two safety allegations.
