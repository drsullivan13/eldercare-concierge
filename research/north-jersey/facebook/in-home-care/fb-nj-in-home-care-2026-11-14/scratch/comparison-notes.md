# Comparison slice notes — run fb-nj-in-home-care-2026-11-14

Researcher: comparison subagent. Search date: 2026-11-14 (ET evening; UTC 2026-11-15 00:28–00:33).
Assigned providers (4): north-jersey-hp-hp0171100 (Senior Helpers Bergen County,
Paramus), north-jersey-hp-hp0151500 (Visiting Angels Ramsey), north-jersey-hp-hp0015321
(BAYADA Passaic County, Clifton), north-jersey-hp-hp0242300 (Senior Helpers Fairfield,
Totowa office).

Headline: 1 observation total (fb-njc-001, unresolved brand-generic allegation, blank
provider_id). 0 exact matches, 0 probable matches. 3 of 4 providers zero results;
the 4th (Bergen County) has only the unresolved allegation. No safety allegation
attributable to any seed office. No Facebook Page rating was visible for any seed.

## Method and limits (all providers)

- Surfaces per provider: social.search (platform=facebook, 2 calls each — one
  since=2024-11-14, one engagement-ranked without a since filter), browser.search
  for the public Facebook Page, operator-site check for a Facebook link,
  facebook-cli groups search for town community groups + groups posts queries
  ('<brand>', 'home care', and where useful 'home health aide') in each group.
- CLI groups details did not return a privacy value for any group checked
  (privacy field blank), so public/private status of the community groups is
  unconfirmed from that call; all group post searches ran without access errors.
- Known CLI limit, hit on both Senior Helpers Pages: unmanaged Page timelines and
  Reviews tabs are not enumerable; profile info returns HTTP 403 'Profile Not
  Accessible'. Browser fetch of the Bergen County Page returned HTTP 403; browser
  fetch of the Fairfield NJ Page failed (no public profile data available).
- Social search is selected/personalized, not exhaustive. Zero results here means
  no relevant material surfaced on these surfaces, not that no experiences exist.
- No posts, comments, messages, joins, forms, or access requests at any point.
- No names, profile links, contact details, diagnoses, or treatment details were
  collected. Individual caregiver/aide names and phone numbers seen in search
  results were NOT recorded in any file.

## Provider 1 — north-jersey-hp-hp0171100 — Senior Helpers Bergen County, Paramus
### 22 Madison Ave Ste 305, Paramus, NJ 07652 — HP0171100 — 201-968-5777

- Facebook Page found via operator site: facebook.com/pages/Senior-Helpers-of-Bergen-County-NJ/306626376159 (Page ID 306626376159).
  Page profile info via CLI: HTTP 403. Browser fetch: HTTP 403. Timeline/Reviews
  not enumerable. Aggregate candidate recorded NOT VISIBLE, values blank.
- social.search (2 calls): only hits were (a) ACAP Bergen County caregiver
  resource-fair posts at the Paramus Library (Feb 2026, community event notices,
  not provider experience) and (b) Senior Helpers of **North Hudson** (North
  Bergen, Kennedy Blvd) marketing, accreditation, and ribbon-cutting posts — a
  different franchise, NOT transferred — plus individual Bergen County caregiver
  service offers (Loving Care 4 Seniors LLC, Shelley's Concierge Services, and
  individual CHHA/caregiver ads) and a Sen. Holly Schepisi ANCHOR/Stay NJ event
  reel. None is about the Paramus office.
- Paramus community groups searched (groups posts 'Senior Helpers' + 'home care',
  all 0 results): You know you are from Paramus when.... (141580402593141,
  ~4000), You know you're from Paramus when (229338680437055, ~3000), Paramus
  Affairs (362348924110486, ~1000), Paramus Connect (4783606025033880, ~742),
  Paramus Parents (986332541492304, ~1000).
- Observation fb-njc-001 (unresolved, blank provider_id): a 2026-03-28 post that
  makes a one-line accusation of corruption against the Senior Helpers brand
  with no examples, details, office, town, or care episode stated. Recorded as a
  reported allegation only (concern_type=safety_allegation, needs_human_review=true)
  because the protocol routes serious allegations to human review; nothing in the
  post ties it to the Paramus office or any other branch. No excerpt quoted.
  It may also surface in the discovery lane sweep — do not double-count.
- Coverage status: ambiguous_only, observations_found 1.

## Provider 2 — north-jersey-hp-hp0151500 — Visiting Angels Ramsey
### 17 S. Franklin Tpk 1st Floor #3, Ramsey, NJ 07446 — HP0151500 — 201-825-7900

- social.search (2 calls, both 0 results): no Visiting Angels Ramsey content at all.
- No public Facebook Page for the Ramsey office found via the operator site
  (visitingangels.com/ramsey/about-us shows no Facebook link) or web search.
  Aggregate candidate recorded NOT VISIBLE with blank source URL.
- Ramsey community groups searched (groups posts 'Visiting Angels', 'home care',
  'home health aide', all 0 results): Ramsey Moms and Dads (1671188596527525,
  ~4000), Zero7446 (2985567874836715, ~2000), The Democratic Club of Ramsey
  (771580303007820, ~559). Listed but not searched for care content: Ramsey High
  School Class of 1966 (2963729837074741, alumni), Ramsey NJ Book Swap
  (541186144049059). Groups search for plain 'Ramsey' returned 0 groups; 'Ramsey
  NJ' returned the list above.
- Excluded with reasons: web search surfaced Facebook place-card style results
  for OTHER Visiting Angels offices — Montclair/Caldwell 5.0/17 reviews, Hoboken
  5.0/3, Sparta 1.0/1. Index cards for other branches; not transferred and not
  recorded as aggregate candidates for this seed. Also surfaced: Care.com and
  operator-site testimonials for other Visiting Angels offices (Princeton
  Junction, Wall, Gloucester County, Scotch Plains, Sparta, Lawrenceville) —
  not Facebook evidence about Ramsey, not recorded.
- Coverage status: searched_no_relevant_result, observations_found 0.

## Provider 3 — north-jersey-hp-hp0015321 — BAYADA Passaic County, Clifton
### 1117 Main Ave Ste 101, Clifton, NJ 07011 — HP0015321 — 973-333-4477

- No Clifton-office Facebook Page found via operator site or web search (only
  BAYADA job postings for the Clifton/Passaic/Bergen/Hudson service area and NPI
  records). BAYADA's corporate Facebook Page is national, not branch-specific,
  and is not recorded as a rating lead. Aggregate candidate recorded NOT VISIBLE
  with blank source URL.
- social.search (2 calls): 3 hits. (1) BAYADA Home Health Aide and Senior
  Clients Roundtable reel (2026-11-06) — read in full via CLI: NJ State Senator
  Angela McKnight's roundtable with **@Bayadajc (BAYADA Jersey City)**, not the
  Clifton office; transcript is general discussion of aides' companionship role.
  NOT transferred. (2) 'Katherinne Care & Clean' business promo — unrelated
  cleaning business. (3) Personal babysitting ad (Passaic/Clifton) — unrelated.
- Clifton community groups searched: Clifton NJ Parents Group (1328488663888916,
  ~2000), Clifton - Uncensored (2039432409685548, ~2000), The City of Clifton NJ,
  UNFILTERED! (1727383471283564, ~10000), Indians in Clifton (336474540775987,
  ~1000). Queries 'BAYADA' returned 0 in all four. Query 'home care' returned 0
  in the first two, 21 in UNFILTERED, 18 in Indians in Clifton.
- UNFILTERED 'home care' hits reviewed (21): mostly cleaning ads, personal
  training, dog sitting, and image-only posts with no caption. Two threads read
  in full: (a) post 1870856853602891 (2026-05-19, father coming home from rehab,
  seeking ramp/wheelchair) — 5 comments, all about equipment (wheelchair,
  walker, fire dept, insurance case manager); no agency named. (b) The
  remaining image-only posts (owners suggest cleaning/domestic-service ads) had
  0 comments and no usable text. No BAYADA mention.
- Indians in Clifton 'home care' hits reviewed (18): mostly food, nanny, massage,
  and cleaning posts. Three care-relevant items, none seed-linked: (a) post
  1330591614697603 (2025-05-24, family request for help caring for an elderly
  mother with Parkinson's/dementia in Clifton) — 0 comments, no agency named.
  (b) CarePoint Home Health ads (posts 1805670423454868, 1713053326451428,
  1516628992760530) — a different provider (DDD-approved), discovery-lane
  territory. (c) Faith Home Healthcare caregiver job ad (1130499204706846) —
  employment, different provider. Howayfarer Domestic Agency ad (UNFILTERED
  1916664209022155) — domestic staffing, not senior home care.
- BAYADA Pediatrics Passaic County (Little Falls) material was not encountered;
  the separation was maintained.
- Coverage status: searched_no_relevant_result, observations_found 0.

## Provider 4 — north-jersey-hp-hp0242300 — Senior Helpers Fairfield, Totowa office
### 547 Union Blvd, Totowa, NJ 07512 — HP0242300 — 973-362-0130

- Facebook Page found via operator site:
  facebook.com/Senior-Helpers-of-Fairfield-NJ-201122313659146 (Page ID
  201122313659146). Page profile info via CLI: HTTP 403. Browser fetch failed
  (no public profile data available). Timeline/Reviews not enumerable. Aggregate
  candidate recorded NOT VISIBLE, values blank. Operator site also links
  Instagram @seniorhelperstotowa (not searched — out of scope for this Facebook
  run). Operator site carries an on-site testimonial from a Succasunna client;
  it is on seniorhelpers.com, not Facebook, and is out of scope — noted here
  only, not recorded as an observation.
- social.search (2 calls) is dominated by **Senior Helpers of Fairfield & New
  Haven County (Connecticut)** — Page owner_id 100063480586254, handles
  seniorhelpersFairfieldUpper and SeniorHelpersfairfield. Its client testimonial
  reels (Kim Foote and father, Aug 2026), 'WHAT OUR Clients SAY' graphics, and
  promo videos are a different franchise; NOT transferred. One additional hit: a
  2026-04-29 photo of a roadside 'SENIOR Helpers' sign showing phone
  (732) 866-4488, which matches neither the Totowa office (973-362-0130) nor
  any seed phone; branch unidentified, not transferred.
- Totowa community groups searched: Our Town Totowa (2091549027823541, ~8000),
  Living In Totowa, New Jersey (906795469396781, ~3000), Little Falls, Totowa,
  Woodland Park NJ Residents (355352291506931, ~15000), Totowa Neighbors Talk
  (461691347819619, ~1000), The NO BS! Totowa, Woodland Park, Little Falls Page
  (25951610101167025, ~725). Queries 'Senior Helpers' returned 18 in Our Town
  Totowa and 0 elsewhere; 'home care' returned 21 in Our Town Totowa and 0
  elsewhere (except the three groups above, all 0 for both queries).
- Our Town Totowa 'Senior Helpers' hits (18) reviewed in full: all are keyword
  matches on 'senior(s)' — snow-shoveling help for seniors, Clover Hill Senior
  Living caregiver job ad (North Haledon, employment, different provider),
  individual companion/errand offers, a 2023 senior resource event, a 2022
  free-ramps-for-seniors request thread (9 comments, not read in full — ramp
  request, not agency experience). No post names Senior Helpers Fairfield or
  the Totowa office.
- Our Town Totowa 'home care' hits (21) reviewed in full: cleaning-service ads,
  nanny requests, infant day-care request, real-estate posts, and one individual
  companion offer (2025-12-15, mall walks with an older adult — individual
  aide, discovery territory, no agency named). No Senior Helpers mention.
- Fairfield NJ community groups searched: I love living in Fairfield Nj
  (451662852022654, ~4000) returned 20 'Senior Helpers' and 20 'home care'
  hits; You know you're from Fairfield, NJ when... (172585199480121, ~2000)
  returned 0 for both. The Fairfield hits are all **Home Helpers Home Care of
  West Essex** ads (a different provider — discovery-lane territory) plus
  massage/nanny ads; no Senior Helpers Fairfield NJ mention. Listed but not
  searched: Fairfield Town Center (1222230241122755), Fairfield 07004 Curb
  Alert/Buy Nothing (619378572508280), Fairfield, NJ Moms (1538118663993839).
- Coverage status: searched_no_relevant_result, observations_found 0.

## Same-brand traps encountered (do not transfer)

- Senior Helpers of North Hudson (North Bergen) vs Bergen County (Paramus).
- Senior Helpers of Fairfield & New Haven County, CT (owner_id 100063480586254)
  vs Senior Helpers Fairfield, NJ (Totowa office).
- BAYADA Jersey City (@Bayadajc) vs BAYADA Passaic County (Clifton).
- Visiting Angels Montclair/Caldwell, Hoboken, Sparta (index cards) vs Visiting
  Angels Ramsey.
- BAYADA Pediatrics Passaic County (Little Falls) vs BAYADA Passaic County
  (Clifton) — not encountered, separation maintained.

## New / other providers seen (discovery-lane territory, names only, no details)

- Home Helpers Home Care of West Essex (active advertiser in Fairfield NJ groups
  and Cedar Grove groups); CarePoint Home Health (Clifton groups, DDD-approved
  provider); Faith Home Healthcare (caregiver job ads, Essex/Bergen/Morris/
  Hudson/Union/Passaic); Care for Less Homecare (Fairfield NJ groups, via a
  Senior Living Placement Specialist card); Howayfarer Domestic Agency (Clifton
  UNFILTERED). Individual caregiver/aide offers seen in Paramus, Clifton, and
  Totowa groups — tallied by the discovery lane, not here.
- These were NOT recorded as comparison observations; they belong to the
  discovery lane.

## Files written

- scratch/comparison-observations.csv — 1 row (fb-njc-001)
- scratch/comparison-coverage.csv — 4 rows (one per seed)
- scratch/comparison-aggregate-candidates.csv — 4 rows (all NOT VISIBLE, blank values)
- scratch/comparison-notes.md — this file
