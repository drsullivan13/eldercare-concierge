# Morris slice notes — run fb-nj-in-home-care-2026-11-14

Researcher: morris slice (4 seeds). Collection window: 2026-11-14 ~19:28–19:55 ET
(2026-11-15 00:28–00:55 UTC). All rows `internal_review_pending`.

## Summary

- **Observations: 4** — all for Senior Helpers Madison (2 exact provider-promotion
  posts from the office's own Page, 1 unresolved firsthand family recommendation
  naming only the brand, 1 unresolved provider ad series in the Madison community
  forum). No exact family care experience for any of the 4 seeds.
- **Zero-result providers (3):** Home Instead Morris County, Life Home Care,
  BAYADA Morris County.
- **Serious allegations: 0.** No safety allegations recorded.
- **Aggregate candidates: 2 rows**, both NOT VISIBLE (ratings not confirmed on the
  Page itself; see below).

## 1. Senior Helpers Madison — north-jersey-hp-hp0104400 (214 Main St, Madison)

Queries (social.search, platform=facebook, since=2024-11-14, top=25):
"Senior Helpers Madison NJ", "Senior Helpers Madison New Jersey review",
"Senior Helpers Madison recommendation experience", "home care Madison NJ agency";
second call: "home care agency for my mom Madison NJ",
"Senior Helpers Madison NJ review recommendation",
"companion for dad Madison New Jersey home care",
"who have you used home care Madison NJ".

Pages/groups checked:
- Official Page facebook.com/SeniorHelpersMadisonNJ (350–355 followers). Two public
  promotional posts read via `facebook-cli post read`: 2026-10-19 "Live Far From
  Mom?" (fb-njm-001) and 2026-10-26 "1 in 2" loneliness post (fb-njm-002), both
  linking to seniorhelpers.com/nj/madison/. CLI `profile info` returned HTTP 403
  (Profile Not Accessible); browser read returned a stub only (name, URL,
  professional account, 355 followers) — no rating block, reviews tab or address.
  Aggregate row: NOT VISIBLE.
- Madison, NJ Community Forum (id 471675701508081, OPEN, 2,000 members) —
  `--query 'Senior Helpers'` and `--query 'home care'`. Found the Senior Helpers
  ad series (fb-njm-004): identical live-in/hourly ad posted ~weekly, contact
  phone 201-600-4109, contact "Monica Tuman, Mtuman@seniorhelpers.com". The phone
  does not match the Madison office (973-360-1500) and no office is named, so the
  branch cannot be established — recorded unresolved. The same phone appears in a
  caregiver-recommendation thread (group 2474860256161506, comment 3917553321892185,
  "Monica 201-600-4109", 30 years in home care, Morris/Union/Essex) — supports a
  Senior Helpers attribution but still no branch.
- Madison Area Parents And Community (Official) (id 979509039749501, OPEN, 1,000
  members) — `--query 'Senior Helpers'`: only mother's-helper/babysitting posts;
  no agency content.
- Madison Area Parents And Community (id 210180855785327, CLOSED, 11,000 members)
  — NOT searched: rules explicitly forbid sharing posts outside the group
  ("Do not screenshot or share any posts outside of the group").
- Madison, NJ 411 (id 783701721781480, CLOSED, 2,000 members) — NOT searched: no
  rules shown, reuse unclear.

Other finds (not seed evidence, left for the discovery lane):
- Veronica Meyer post, 2026-10-20 (fb-njm-003): firsthand family recommendation
  of "Senior Helpers" only — no office/town/address in the post or its one reply
  (a generic agency thank-you naming no branch). Recorded unresolved; the post
  surfaced via Madison-targeted search but carries no location evidence.
- Search results also surfaced other agencies (The Madison House LLC, Madison
  Heights Homecare, HomeCare Pal, Agewell Homecare, Friendly Home Care, etc.) and
  individual-aide ads — not recorded here; discovery lane's scope.

## 2. Home Instead Morris County — north-jersey-hp-hp0397500 (1719 NJ-10, Parsippany)

Queries (social.search, since=2024-11-14, top=25): "Home Instead Morris County",
"Home Instead Parsippany NJ", "Home Instead Morris County review recommendation",
"Home Instead Parsippany experience".

Pages/groups checked:
- No public Facebook Page for the Morris County office found via two browser
  searches. A search-index Facebook place card exists (place_id 1397232981413645,
  1719 NJ-10 #317, Parsippany, phone 973-797-9055) showing 5.0 based on 2 reviews
  in the index — NOT confirmed on the Page itself. CLI `profile info` on the
  place id returned HTTP 403. Aggregate row: NOT VISIBLE; a logged-in human
  browser session is the remaining route.
- Parsippany NJ Community (id 2091269208018172, OPEN, 1,000 members) —
  `--query 'Home Instead'` and `--query 'home care agency'`. Results were
  "Home Away From Home" adult-day-care posts and Raquel Marte / Home Helpers
  promotional posts; no Home Instead content.
- Parsippany Residents (id 966965265075801, OPEN, 583 members) —
  `--query 'Home Instead'`: same "Home Away From Home" cross-posts; no Home
  Instead content.
- Parsippany Supporting Our Town (id 1185636471643403, CLOSED, 8,000 members) —
  NOT searched: rules silent on research/reuse.
- Caregiver-recommendation thread (group 2474860256161506, post 3917539128560271,
  2025-05-04, 9 comments read via CLI): commenters offer Integral Care Home Care,
  a senior placement advisor, a private aide, and "Monica 201-600-4109" — no
  Home Instead mention.

Exclusions: Home Instead Millburn (215 Millburn Ave, a separate Essex seed) and
the Succasunna address in the Morris County home-care-agencies guide (109 Main
St) were not transferred. Operator-site testimonial on the homeinstead.com
diabetes-care page ("staff worked very hard to find the right caregiver...") is
not a Facebook source and was not recorded.

## 3. Life Home Care — north-jersey-hp-hp0285900 (120 Eagle Rock Ave, East Hanover)

Queries (social.search, since=2024-11-14, top=25): "Life Home Care East Hanover",
"Life Home Care New Jersey review", "Life Home Care East Hanover recommendation",
"Life Home Care NJ experience".

Pages/groups checked:
- No public Facebook Page for Life Home Care found via browser search. No
  Facebook place card surfaced, so no aggregate row (no rating lead to record).
- East Hanover, NJ Community Forum (id 1176819452980316, OPEN, 356 members) —
  `--query 'Life Home Care'`: cross-posted Raquel Marte / Home Helpers posts
  ("The Benefits of Home Care for Families", "The Hidden Benefit of Home Care
  Nobody Talks About", "Tips for Speaking With a Family Member Who Needs Home
  Care"); no Life Home Care content.
- East Hanover Community Information Page (id 323076549709489, OPEN, 9,000
  members) — `--query 'Life Home Care'`: same Home Helpers cross-posts, the
  Senior Helpers ad series (post 1462313532452446, 2026-09-28), a CarePoint Health
  ad (Mukesh/Mookie Patel, post 1462793452404454, read in full — a different
  agency), and nanny/household ads; no Life Home Care content.
- East Hanover Information (id 423096787756186, CLOSED, 6,000 members) — NOT
  searched: rules silent on research/reuse.

Exclusions: "Life & Health Home Care Agency" (Perth Amboy) is a different agency
and was not transferred. Individual caretaker-seeking posts for East Hanover
(Melissa Yannuzzi, 2026-11-12, three cross-posts seeking an aide for a
mother-in-law; Dana Leatham offering individual caregiver services) are
discovery-lane material, not seed evidence. Livingston HQ (70 S Orange Ave),
Glen Rock and Somerset offices were not transferred.

## 4. BAYADA Morris County — north-jersey-hp-hp0015347 (32 Maple Ave, Morristown)

Queries (social.search, since=2024-11-14, top=25): "BAYADA Morristown",
"BAYADA Morris County home care", "BAYADA Morristown review recommendation",
"BAYADA Morristown experience"; second call: "BAYADA National Hero nurse
Morristown", "BAYADA home care New Jersey", "BAYADA caregiver Morristown NJ".
First call returned 0 results.

Pages/groups checked:
- No public Facebook Page for the Morristown office found via browser search.
  No Facebook place card surfaced, so no aggregate row (no rating lead to record).
- Morristown Community Forum (id 850931364919624, OPEN, 1,000 members) —
  `--query 'BAYADA'` (0 results) and `--query 'home care'`: Senior Helpers ad
  series cross-posts, an individual overnight-caregiver ad (2026-10-17), and
  home-service ads; no BAYADA content.
- Morristown NJ 07960 Its History, Its People! (id 938774606482093, OPEN, 19,000
  members) — `--query 'BAYADA'`: 0 results.
- Morristown, NJ Community Forum (id 1658274287763522, CLOSED, 14,000 members) —
  NOT searched: its single rule covers Monday-only ads and is silent on
  research/reuse.

Exclusions: the only BAYADA result surfaced was a HERO award post for a
Lancaster-office nurse (Mindy Hoffman, LPN; RarestRuby, 2026-10-31) — not
Morristown, not transferred. BAYADA Live-In Services (2nd Floor, 32 Maple Ave)
is a different service line and was not transferred. The earlier follow-up's
probable BAYADA Morristown employment account (fb-njfu-b-001, Q4 2024 National
Hero award post, 2025-02-28) did not resurface in this run's searches and was
not re-recorded, to avoid duplicating the existing follow-up batch.

## Cross-cutting notes

- The Senior Helpers ad series (phone 201-600-4109, "Monica Tuman") is cross-posted
  across the Madison, East Hanover and Morristown community forums on Mondays;
  it was recorded once under the Madison slice (fb-njm-004) as an unresolved
  series, not once per town.
- The Raquel Marte / Home Helpers promotional posts ("Home Care vs. Home Health",
  "The Hidden Benefit of Home Care Nobody Talks About", etc.) are cross-posted
  across the Parsippany and East Hanover community forums; they belong to Home
  Helpers, not to any seed, and were left for the discovery lane.
- Facebook CLI `profile info` returned HTTP 403 (Profile Not Accessible) for both
  the Senior Helpers Madison Page and the Home Instead Morris County place id —
  the same friend-gating seen in earlier runs. Browser reads of Pages return a
  profile stub only (name, URL, follower count), with no rating block.
- No facility stays, employee reviews (other than provider-published hiring/
  training-style promotion, none found for these seeds), or Medicare skilled
  home-health episodes were recorded as family experience evidence.
