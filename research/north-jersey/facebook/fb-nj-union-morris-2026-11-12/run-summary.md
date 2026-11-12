# Run summary — fb-nj-union-morris-2026-11-12

**Run:** fb-nj-union-morris-2026-11-12 · **Date:** 2026-11-12 · **Protocol:** 0.1
**Scope:** public Facebook research on elder-care experience in Union and
Morris counties, NJ. No scores, no publication. All 65 observations are
`internal_review_pending` with `needs_human_review=true`.

## Batch composition (reconciled 2026-11-12)

17 assignments: the 12 fixed facilities from Harbor's supplied
`supplied-first-facility-assignments.csv` (repo commit f61a0de, 6 per
county) plus 5 CCRC/home-service rows from the provisional roster built
the same day from official sources (Lantern Hill, BAYADA Cranford,
Visiting Angels Union, VNA of Northern New Jersey, Visiting Angels
Morristown). Three of the eight remaining slots stay open — no verified
Morris CCRC, no further official home-service assignments in this pass.
Twelve provisional facility rows were dropped to alternates
(`roster-notes.md`). An earlier 20-row provisional batch was started,
stopped, and superseded before any compile; its partial scratch files are
kept locally only, under `scratch/superseded-provisional-20/`, and are
NOT part of this batch.

## Results

- **65 observations** — exact 54, probable 8, unresolved 3.
- **9 of 17 providers have exact matches.** 7 providers have no relevant
  public evidence; 1 (Denville AL) is ambiguous-only at unit level.
- Account types: provider_promotion 43, firsthand 12,
  recommendation_without_detail 7, unclear 2, hearsay 1.
- Sentiment: positive 53, neutral 11, mixed 1.
- Concern type: none on all 65 rows. **No safety allegations recorded.**
- Coverage: evidence_found 4, partial 5, ambiguous_only 1,
  searched_no_relevant_result 7.

| assignment | provider | obs | exact | character |
|---|---|---|---|---|
| nj-doh-NJ90A120 | Amber Court of Elizabeth | 3 | 2 | all provider promotion |
| nj-doh-NJ90A000 | Mira Vie at Fanwood | 3 | 3 | all provider promotion (opened June 2026) |
| nj-doh-NJ20A013 | Arbor Terrace Mountainside | 8 | 7 | promotion-heavy; 1 resident account, unresolved (brand) |
| nj-doh-NJ62016 | Autumn Lake, Berkeley Heights | 13 | 8 | richest community discussion in the run |
| nj-doh-NJ22001L | Runnells Center | 3 | 2 | promotion + staff storm post + 1 hearsay |
| nj-doh-NJ82472 | Atria Cranford | 7 | 7 | only firsthand care accounts in Union B |
| nj-doh-NJ60A004 | Victoria Mews | 17 | 16 | facility Page dominates; 6 community-thread comments |
| nj-doh-NJ60A006 | Juniper Village at Chatham | 0 | 0 | Page is promotion/events only |
| nj-doh-NJ60A002 | Oaks at Denville (AL) | 3* | 0 | *campus candidates, provider_id blank (Denville rule) |
| nj-doh-NJ61424 | Oaks at Denville (LTC) | 0* | 0 | *cross-referenced to the AL row |
| nj-doh-NJ61407 | Chatham Hills Subacute | 0 | 0 | Page is promotion/events only |
| nj-doh-NJ14C014 | Terraces at Florham Park | 0 | 0 | no official Page found |
| nj-u-08 | Lantern Hill | 7 | 7 | all provider-published or civic endorsement |
| nj-u-09 | BAYADA Cranford | 0 | 0 | no Cranford Page; other offices not transferred |
| nj-u-10 | Visiting Angels Union | 0 | 0 | no Union Page; other offices not transferred |
| nj-m-09 | VNA of Northern NJ | 1 | 1 | provider-published testimonial graphic |
| nj-m-10 | Visiting Angels Morristown | 0 | 0 | no local Page; HCSF number still unverified |

## What the record actually is

Mostly provider-published material (43 of 65). Twelve firsthand
resident/family accounts exist, concentrated at Autumn Lake, Atria
Cranford, Victoria Mews, and Arbor Terrace. No resident/family care
account was found for Amber Court, Mira Vie, Runnells, Juniper Village,
Chatham Hills, Lantern Hill, or either Denville unit. The Denville rule
worked as designed: three campus candidates stay unassigned to either
unit until unit-specific evidence exists.

## Aggregate candidates (eligibility review only — not ratings)

Two rows in `aggregate-candidates.csv`, both needing live-Page
confirmation before any use:

- **VNA of Northern NJ (nj-m-09): 4.0/5, 10 reviews** — surfaced in a
  web-search snippet of the Facebook place listing; a direct Page fetch
  did not surface the rating.
- **Atria Cranford (nj-doh-NJ82472): 4.9/5, 18 reviews** — search-indexed
  place card; the Page text fetch did not surface the rating block.

Two further search-engine place cards (Autumn Lake 5.0/6, Runnells 3.5/17)
were NOT recorded — rating sources not established and neither Page
visibly publishes a rating. They are unverified leads in the slice notes.

## Access limits

- Private groups were not searched anywhere in this run. Closed groups
  noted (not searched): Elizabeth NJ Residents Forum; Fanwood Residents
  Neighborhood Chat; Mountainside Matters; Mountainside Uncensored!;
  Berkeley Heights Community Forum (×2); 4 Cranford groups; 3 New
  Providence groups; 2 Union groups.
- Facebook Recommendations tabs are not enumerable via the CLI (known
  gap); unmanaged Page timelines cannot be enumerated — only
  search-found posts were read.
- Nested replies are not retrievable via CLI; incomplete comment
  pagination on several threads (Clark Neighbors rehab threads;
  Boonton Township thread 16/22).
- One friend-gated local profile ("Linda Visiting Angels") returned
  HTTP 403; its posts could not be read via the CLI.
- CLI returned 0 comments on Lantern Hill's 2026-07-04 power-outage post
  despite the post reporting 1 comment.

## Unverified leads for human follow-up (not observations)

- **Lantern Hill 2026-07-04 outage post:** a search-indexed summary
  describes two critical comments (a resident needing a CPAP reporting
  an unmarked extension cord across a hallway; repeated unanswered calls
  to the front desk). Not retrievable via CLI. Human should open the post
  directly; record only if the comments are visible.
- **Arbor Terrace resident account (fb-nju-a-007):** names only "Arbor
  Terrace". Human step: read the nested reply to the "how long have you
  been at Arbor Terrace?" comment; upgrade to exact only if it names
  Mountainside.
- **Victoria Mews move-in post (probable):** facility named only in a
  nested reply the CLI cannot retrieve.
- **Single comments on three reels/posts** (Victoria Mews ED reel,
  Juniper Trail of Treats reel, Chatham Hills birthday post) were not
  retrievable — unverified leads for a human to open.

## Brand-confusion exclusions (handled, not transferred)

- Autumn Lake allegations about the **Voorhees** location (Medford group
  thread) were explicitly NOT transferred to Berkeley Heights.
- Arbor Terrace, Autumn Lake (Cherry Hill, Memorial Bridge, Linwood/
  Oceanview, Glen Burnie), BAYADA (Mercer County, PA Pediatrics),
  Visiting Angels (Scotch Plains, Cape May, Sparta, corporate) — other
  locations/offices not transferred to rostered entities.
- Florham Park Rehabilitation Trunk or Treat post excluded from the
  Terraces row (co-located LTC, different licensed entity).

## Verification gaps carried forward

- **nj-m-10 (Visiting Angels Morristown):** no verified NJ Consumer
  Affairs HCSF registration number. Confirm via the verification portal
  before publication use.
- **Lantern Hill address:** NJ DOH lists 537 Mountain Ave; the operator
  site says 535.
- **The Terraces at Florham Park:** NJ DOH lists two records at 190 Park
  Ave (14C014 CPCH + 60A010 ALR); former name Saint Anne Villa.

## Files in this batch

- `assignments.csv` — 17 reconciled assignments (superset columns)
- `supplied-first-facility-assignments.csv` — the supplied file, byte-identical (blob SHA 38d402a3)
- `supplied-north-jersey-facebook-prompt.md` — the prompt, byte-identical (blob SHA 42a793a5)
- `batch-manifest.json` / `batch-manifest.md`
- `observations.csv` (65) / `coverage.csv` (17) / `aggregate-candidates.csv` (2)
- `roster-notes.md`, `researcher-brief-nj.md`, `collection-protocol.md`
- `scratch/*-notes.md` — per-slice notes (queries, blocks, exclusions)

## Next batch to check

Essex, Bergen, Hudson, or Passaic per the prompt order. Somerset leads
tracked separately in `roster-notes.md` (Fellowship Village, Spring Hills
Somerset, CareOne at Somerset Valley, Sunrise of Basking Ridge);
Middlesex needs its own roster pass. The 12 dropped provisional facility
rows (Sunrise Westfield, Brighton Gardens Mountainside/Florham Park,
Complete Care Westfield, Aristacare Parkside, Cornell Hall, CareOne
Parsippany, Morris View, Troy Hills, Merry Heart, Arden Courts Whippany,
Sunrise Morris Plains) remain alternates.
