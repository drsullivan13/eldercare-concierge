# Morris slice B notes — NJ follow-up followup-2026-11-12

Run `fb-nj-union-morris-2026-11-12`, follow-up `followup-2026-11-12`.
Researcher slice: Morris B (`fb-njfu-b-`). Collected 2026-11-12.
`run_id` in observations/coverage is the base run ID
(`fb-nj-union-morris-2026-11-12`); the follow-up is identified by the
manifest `followup_id` `followup-2026-11-12`.

## Providers and totals

| assignment | provider | observations | status |
|---|---|---|---|
| nj-reg-HP0015347 | BAYADA Home Health Care, 32 Maple Ave, Morristown | 1 (probable, blank provider_id) | ambiguous_only |
| nj-reg-HP0414500 | CSS Morris, LLC, 15 Wychwood Rd, Morristown | 0 | searched_no_relevant_result |
| nj-hha-317020 | BAYADA Home Health Care, 11 Commerce Dr, Cranford | 0 | searched_no_relevant_result |
| nj-campus-cedar-crest-village | Cedar Crest Village, 1 Cedar Crest Village Dr, Pompton Plains | 16 (all exact) | evidence_found |

Total: 17 observations. No aggregate candidates in this slice (no page
visibly publishes a rating for any of the four locations). No safety
allegations. All observations `internal_review_pending`,
`needs_human_review=true`.

## Queries used (reproducible)

- social.search (facebook, since 2024-11-12, top 25) per provider, plus a
  second no-date-filter round for BAYADA Morristown, CSS Morris and
  Cedar Crest.
- browser.search: office/page verification per provider; site:facebook.com
  rating checks for BAYADA Morristown and Cedar Crest.
- facebook-cli groups search: "Morristown NJ", "Morris County",
  "Cranford", "Cranford NJ", "Pompton Plains", "Pequannock".
- facebook-cli groups posts: BAYADA in 5 Morristown/Morris County groups;
  CSS Morris in 2 Morristown groups; Cedar Crest in Pequannock Township
  (OPEN, 16000) and the two closed Pompton Plains groups (0 results).
- facebook-cli post read / post comments read: all posts listed in the
  per-provider sections below.

## nj-reg-HP0015347 — BAYADA Morristown (1 probable)

- Office confirmed at 32 Maple Ave, 1st Floor (Assistive Care) and 2nd
  Floor (Live-In Services), Morristown, via bayada.com and directory
  listings; NPI 1194230649.
- No Morristown-specific BAYADA Facebook Page found. Corporate Page posts
  name no office and were not transferred.
- fb-njfu-b-001 (probable, blank provider_id): BAYADA nurse Richard
  Kitrick's own public post (2025-02-28) celebrating a Q4 2024 National
  Hero award. The Morristown link rests on a search-index summary of the
  carousel slide naming the Morristown, NJ Skilled Nursing Unit; the post
  caption as read via CLI does not name Morristown, so the office link is
  unconfirmed in the underlying source. Staff/employment, firsthand,
  positive.
- Excluded: Morristown Helps 2021-06-18 care-seeking post (author says
  agencies are not feasible; a comment names Right at Home, not BAYADA);
  Morristown Helps 2020-03-31 mask-headband post; brand-level corporate
  posts (Nurse.com CE promo, Senator McKnight roundtable, Kevin M.
  Google-review testimonial, Yusef post); BAYADA Mercer County and Rhode
  Island office Pages; a "Senior Assistance" post in Morristown Stimulus
  Plan (2026-11-09) seeking a helper for a Meals on Wheels client (no
  agency named).
- Groups searched, no BAYADA material: Morristown Stimulus Plan
  (2474860256161506, OPEN, 18000), Morristown Helps (638911306894469,
  OPEN, 3000), Morristown Recommendations, Reviews & Town Happenings
  (835154269943493, OPEN, 5000), Morristown Community Forum
  (850931364919624, OPEN, 1000), Morris County Residents
  (1078407615877991, OPEN, 8000).

## nj-reg-HP0414500 — CSS Morris, LLC (0)

- Service verified: In Home Supportive Care agency, NPI 1750279766,
  taxonomy 253Z00000X, enumerated 2025-06-26, authorized official Steven
  Loewenthal.
- Address discrepancy: the assignment gives 15 Wychwood Road (NJ DCA
  HCSF registration HP0414500), but the NPPES record lists location and
  mailing address 55 Madison Ave Ste 400, Morristown — a suite shared
  with ~20 other registered entities (ReliableCare USA, Richantly LLC,
  Morris Home Care, Visiting Angels Morristown, Pharos Monitoring and
  others). Material tied only to 55 Madison Ave cannot establish CSS
  Morris.
- No Facebook Page and no website surfaced. social.search hits were false
  positives (U.S. Army 1297th CSSB ceremony; Morris County College
  t-shirt). Group queries for "CSS Morris" returned only loose substring
  matches with no relevant content.
- No aggregate candidate.

## nj-hha-317020 — BAYADA Cranford, 11 Commerce Dr (0)

- Address correction confirmed: BAYADA Home Health (Union County
  Visits), 11 Commerce Drive Suite 1, Cranford, CCN 317020, office
  director Kanchan Kamra (bayada.com, CMS directory records). BAYADA
  Pediatrics is a separate unit at 6 Commerce Dr PH Suite — material
  tied only to 6 Commerce Drive is candidate-only per the brief, and
  none was found.
- No Cranford-specific BAYADA Facebook Page found. All four Cranford
  community groups located are CLOSED/private and were not searched:
  Cranford, NJ Parents (640676112767115, 3000), Cranford NJ Area -
  Families (1387838484789822, 16000), Cranford, NJ Moms
  (411739329332459, 3000), Cranford in Four Seasons (1545344412200964,
  1000). This matches the base run's note.
- Excluded: a 2026-05-19 Ocean County thread recommending Bayada Home
  Health in Whiting (different office, CHF monitoring program);
  brand-level corporate posts naming no office; BAYADA Mercer County and
  Rhode Island office Pages.
- No aggregate candidate. The corrected address made no difference to the
  Facebook outcome versus the base batch's 6 Commerce Drive search.

## nj-campus-cedar-crest-village — Cedar Crest Village (16 exact)

- Community confirmed: Erickson Senior Living CCRC, 130-acre campus,
  1 Cedar Crest Drive / 1 Cedar Crest Village Drive, Pompton Plains
  07444, 1,800+ residents. No dedicated Cedar Crest Village Facebook
  Page found; material comes from the operator's Page, News 12 NJ
  coverage, and the public Pequannock Township group.
- Unit identity: separately named units on the same campus —
  Mountainview Gardens (skilled nursing, 4 Cedar Crest Village Drive,
  per a 2020-03-14 community post) and Renaissance Gardens (assisted
  living, 4 Cedar Crest Drive, per directory listings). None of the 16
  observations is unit-specific; all are campus-general. Do not transfer
  unit-specific material to the campus assignment (same principle as the
  Denville rule).
- Observations fb-njfu-b-002–013: twelve comments on the public
  Pequannock Township group thread of 2022-06-06 ("ISO any feedback on
  CEDAR CREST Senior Living Community in Pompton Plains", 13 comments,
  1 mover advertisement excluded). 8 firsthand family accounts, 1
  secondhand staff account (husband reporting his wife's 8.5 years as a
  CHHA), 3 recommendations without detail. All positive. Excerpt budget:
  one 8-word excerpt on fb-njfu-b-006 only; all other thread rows carry
  no excerpt (25-word per-thread cap).
- fb-njfu-b-014: "Cedar crest is good" comment on the 2018-10-11
  home-health-aide recommendation thread.
- fb-njfu-b-015: Erickson Senior Living operator post (2026-04-15)
  profiling the DiNome couple who moved to Cedar Crest from area 55+
  communities (provider_promotion).
- fb-njfu-b-016/017: News 12 NJ reporter Della Crews reels — resident
  craft fair (2026-05-24, event 2026-05-02) and Pump It for Parkinson's
  (2026-04-21, event 2026-04-09; 160 residents + 10 team members,
  370,456 steps). News coverage of facility events, account_type unclear.
- Excluded, with reasons: News 12 NJ 2026-09-02 missing-hikers post
  (two Cedar Crest residents on Pyramid Mountain; caption does not name
  Cedar Crest and the incident is not a care experience); fire-department
  dispatch posts (dumpster fire 2026-06-09; elevator rescues 2026-04-04
  and 2023-09-11); 2025-08-17 town-affordability post (Cedar Crest only
  in discussion); 2025-05-15 charity sock drive at the campus; 2025-12-25
  mover request; 2019-06-06 ride request; 2021-11-05 hiring post;
  2021-01-08 vaccination post; 2020-03-14 card-drop-off post;
  housekeeper and outside-agency recommendation comments (Assisting
  Seniors at Home, Caring People, Visiting Angels) for care at Cedar
  Crest — recommendations of other providers, not Cedar Crest
  observations; 2022-06-06 mover advertisement comment; a "Cedar Crest"
  tiny-home real-estate reel (unrelated product sharing the name).
- Cross-reference noted: a comment in the 2023-01-14 "Besides Cedar
  Crest" senior-living thread reports good experiences at Victoria Mews
  in Boonton (base batch nj-doh-NJ60A004); the same thread recommends
  Chelsea at Montville, Holland Christian Home and others — none are
  Cedar Crest observations.
- Groups: Pequannock Township, New Jersey (226332979096, OPEN, 16000)
  searched for Cedar Crest (20 results). My Hometown Pompton Plains,
  Pequannock NJ (1109295552418445) and Our Pequannock (217442301984814)
  are CLOSED/private and were not searched (queries returned 0).
- No aggregate candidate: no Page visibly publishes a rating for this
  location. Comments on the two Della Crews reels were not retrievable
  via CLI (Parkinson's reel reports 2 comments; CLI returned none) —
  noted as an unverified lead for a human to open.

## Blocks and limits (whole slice)

- Facebook Recommendations tabs are not enumerable via the CLI (known
  gap); unmanaged Page timelines cannot be enumerated — only
  search-found posts were read.
- Nested replies are not retrievable via CLI; comment pagination on the
  ISO feedback thread was complete (13/13) and on the aide thread (9/9).
- No private groups searched anywhere in this slice. Closed groups
  noted, not searched: 4 Cranford groups, 2 Pompton Plains/Pequannock
  groups.
- social.search results are selected and personalized; not an exhaustive
  review history. Morristown, TN false positives appeared in
  unfiltered "Morristown" queries and were excluded.

## Name variants used

- BAYADA / Bayada Home Health Care; BAYADA Assistive Care; BAYADA Union
  County Visits; BAYADA Pediatrics (separate unit, 6 Commerce Dr).
- CSS Morris, LLC; CSS Morris.
- Cedar Crest Village; Cedar Crest; Cedar Crest Retirement; Cedar Crest
  Senior Living; Renaissance Gardens; Mountainview Gardens.
