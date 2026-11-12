# Follow-up summary — fb-nj-union-morris-2026-11-12 / followup-2026-11-12

**Date:** 2026-11-12 · **Base batch:** commit `0041ba3f` ·
**Branch:** `research/north-jersey-fb-2026-11-12` · **Protocol:** 0.1
**Scope:** seven Harbor-supplied assignments (Harbor IDs), the two rating
leads from the base batch, and the Lantern Hill / Arbor Terrace
unverified leads. No scores, no publication. All 19 new observations
are `internal_review_pending` with `needs_human_review=true`.

## Results

- **19 observations** — exact 18, probable 1. Firsthand 11,
  recommendation_without_detail 4, unclear 2, hearsay 1,
  provider_promotion 1. Sentiment positive 17, negative 2.
- **2 of 7 providers have evidence** (Lantern Hill campus, Cedar Crest
  Village). 4 have no relevant public evidence; 1 is ambiguous-only.
- Coverage: evidence_found 2, ambiguous_only 1,
  searched_no_relevant_result 4.

| assignment | Harbor ID | provider | obs | outcome |
|---|---|---|---|---|
| nj-campus-lantern-hill | north-jersey-campus-lantern-hill-07974 | Lantern Hill campus, 535 Mountain Ave, New Providence | 2 | evidence_found |
| nj-reg-HP0254700 | north-jersey-hp-hp0254700 | A1 Plus Home Care Services, Union | 0 | searched_no_relevant_result |
| nj-reg-HP0364600 | north-jersey-hp-hp0364600 | AAK Healthcare Institute, Union | 0 | searched_no_relevant_result |
| nj-reg-HP0015347 | north-jersey-hp-hp0015347 | BAYADA, 32 Maple Ave, Morristown | 1 | ambiguous_only (probable, blank provider_id) |
| nj-reg-HP0414500 | north-jersey-hp-hp0414500 | CSS Morris LLC, Morristown | 0 | searched_no_relevant_result |
| nj-hha-317020 | cms-317020 | BAYADA, 11 Commerce Dr, Cranford | 0 | searched_no_relevant_result |
| nj-campus-cedar-crest-village | north-jersey-campus-cedar-crest-village-07444 | Cedar Crest Village, Pompton Plains | 16 | evidence_found |

## Lantern Hill outage comments — now recorded, with a retrieval caveat

The two July 4 outage comments are recorded as follow-up observations
on the campus assignment (not the 537 licensed unit — no unit is named):

- **fb-njfu-a-001** (safety_allegation, firsthand, negative): a resident
  needing a CPAP reported an extension cord laid across a hallway during
  the outage, with security not coming to mark it — a trip hazard.
- **fb-njfu-a-002** (service, firsthand, negative): a commenter reported
  calling the front desk repeatedly since early morning without reaching
  anyone.

One linked event, not two independent events. Excerpts total 23 words
for the shared thread (≤25-word cap).

**Retrieval caveat — read before using these rows.** The CLI
(`facebook-cli post comments read`) returns **0 comments** on this post
under every invocation (pfbid, numeric ID 1595834925883155, `--limit
20`), so no parent comment ID is obtainable. The excerpts come from the
public search index (three independent retrievals returning verbatim
quotes) plus a page fetch describing both comments. Post metadata
reports **1 comment** while the index describes two. A human should
confirm on the live post before any use. The caveat is recorded in both
rows' `match_reason`.

## Rating verification — neither lead confirmed

Both base-batch aggregate candidates were checked on the actual public
Facebook Pages (~16:09–16:10 UTC) and are **NOT VISIBLE**:

- **VNA of Northern NJ (nj-m-09, cms-317002, 175 South St,
  Morristown):** CLI `profile info` returns HTTP 403; browser reads of
  the Page and `/reviews` return only a profile stub (1,192 followers)
  with no rating block. The web-index place card still shows 4.0/10
  reviews, but that is index data, not the Page — **4.0/10 NOT
  confirmed**. Values left blank in `aggregate-candidates.csv`.
- **Atria Cranford (nj-doh-NJ82472, 10 Jackson Dr):** same result — CLI
  403, Page stub only (711 followers), no rating. Index card still
  shows 4.9/18 — **4.9/18 NOT confirmed**. Values left blank.

A logged-in human browser session is the remaining route to see either
rating on the Page itself.

## Arbor Terrace nested reply — retrieved, does NOT name Mountainside

The reply to "how long have you been at Arbor Terrace?" (comment
1082973757538336, 2026-09-08) was retrieved via the CLI: "it will be
three years in January. Highly recommend moving here! Location is only
1 mile from our former home" (20 words). No town is named, so **no
amendment is proposed — base observation fb-nju-a-007 stays unresolved
with provider_id blank**.

## Address corrections — outcomes

- **BAYADA Cranford at 11 Commerce Dr (not 6):** correction confirmed
  against the record (Union County Visits, CCN 317020; Pediatrics is a
  separate unit at 6 Commerce Dr). It made **no difference** to the
  Facebook outcome — still zero observations; all four Cranford
  community groups are closed and were not searched.
- **Lantern Hill campus 535 vs licensed unit 537:** applied. The two
  outage observations are campus-level.
- **CSS Morris address discrepancy:** assignment gives 15 Wychwood Rd
  (DCA registration); the NPPES record lists 55 Madison Ave Ste 400 —
  a suite shared with ~20 other entities, so address-only material
  cannot establish CSS Morris. Entity verified as an In Home Supportive
  Care agency (NPI 1750279766, enumerated 2025-06-26); no Facebook Page
  or website surfaced.

## Other findings

- **Cedar Crest Village (16 obs, all exact, all positive):** 12 comments
  from a 2022-06-06 public Pequannock Township group thread (8 firsthand
  family accounts, 1 secondhand staff account, 3 recommendations), 1
  recommendation from a 2018 home-health-aide thread, 1 operator
  promotion (Erickson Senior Living, 2026-04-15), 2 News 12 NJ event
  reels. No safety allegations; no mixed/negative rows. Separately named
  units on the same campus — Mountainview Gardens (skilled nursing) and
  Renaissance Gardens (assisted living) — none of the 16 observations is
  unit-specific; all are campus-general.
- **BAYADA Morristown (1 probable):** staff/employment firsthand account
  (nurse's Q4 2024 National Hero award post, 2025-02-28). The Morristown
  link rests only on a search-index summary of a carousel slide naming
  the Morristown Skilled Nursing Unit; the caption as read via CLI does
  not name Morristown, so it stays probable.
- **A1 Plus / AAK:** both verified as real businesses at the exact
  assigned addresses (A1 Plus since 2016; AAK NJ-licensed home-care
  firm), but neither has a Facebook Page or public Facebook discussion.
  Excluded: other A Plus/A1 entities, AAK Home Healthcare Sumter SC,
  Ace Healthcare Training Institute, AAK's Somerset office.
- Closed groups not searched: 4 Cranford groups; My Hometown Pompton
  Plains; Our Pequannock; New Providence NJ Community Forum (7,000,
  membership-gated).

## Method correction (applies to the base run's notes too)

Nested replies **are** retrievable via the CLI: pass the parent comment
ID as `--post-id` to `facebook-cli post comments read`. That is how the
Arbor Terrace reply was retrieved. The base run's "nested replies not
retrievable" note is too broad as a general rule — but on the Lantern
Hill outage post the CLI path is exhausted (0 comments enumerable), so
the limitation there is top-level comment enumeration, not nested replies.

## Files in this follow-up

- `assignments.csv` (7) / `batch-manifest.json` / `researcher-brief-followup-nj.md`
- `observations.csv` (19) / `coverage.csv` (7) / `aggregate-candidates.csv` (2, both NOT VISIBLE)
- `followup-summary.md` (this file)
- `scratch/union-a-observations.csv`, `union-a-coverage.csv`, `union-a-notes.md`
- `scratch/morris-b-observations.csv`, `morris-b-coverage.csv`, `morris-b-notes.md`
- `scratch/verify-aggregate-candidates.csv`, `scratch/verify-notes.md`
- `collection-protocol.md`, `observations-template.csv`, `coverage-template.csv`
