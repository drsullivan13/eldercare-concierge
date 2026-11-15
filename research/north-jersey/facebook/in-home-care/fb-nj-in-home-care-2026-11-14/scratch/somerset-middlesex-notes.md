# Somerset + Middlesex slice — notes
Run: fb-nj-in-home-care-2026-11-14. Researcher: Somerset/Middlesex slice.
Date: 2026-11-14/15 (all retrieval times UTC 2026-11-15T00:35–00:38Z).

## Assigned seeds
- north-jersey-hp-hp0101000 — Right at Home Somerset & Hunterdon, 105 Omni Dr, Hillsborough, NJ 08844, 908-281-7961 (HP0101000)
- north-jersey-hp-hp0289000 — Home Instead Somerset, 220 Davidson Ave Ste 98, Somerset, NJ 08873, 732-271-5100 (HP0289000)
- north-jersey-hp-hp0436900 — Visiting Angels East Brunswick, A2 Brier Hill Ct Ste 3, East Brunswick, NJ (HP0436900) — **office NOT verified, see below**
- north-jersey-hp-hp0347100 — Senior Helpers Plainsboro ("of Princeton"), 2 Hospital Dr Bldg B, Plainsboro, NJ 08536, 609-759-2225 (HP0347100)

## Headline
4 observations, all exact, all provider promotion. **Zero family firsthand care
accounts in the entire slice, zero safety allegations.** Two seeds produced
evidence (Right at Home Somerset 1, Senior Helpers Plainsboro 3); two produced
nothing (Home Instead Somerset 0, Visiting Angels East Brunswick 0).

## Per-provider

### Right at Home Somerset & Hunterdon (hp0101000) — 1 observation
- Queries: social.search "Right at Home Somerset Hillsborough NJ" /
  "Right at Home Hillsborough home care review" / "Right at Home Somerset
  Hunterdon recommendation"; second round "Right at Home Hillsborough NJ" /
  "Right at Home West Central New Jersey" / "Right at Home Somerset Hunterdon
  Facebook"; browser.search for the office Facebook Page.
- fb-njs-001 (exact, provider_promotion, 2026-06-03): Senior Care Circuit
  "Provider Spotlight: Right at Home Somerset & Hunterdon Counties" — caption
  names the office, image shows the seed phone 908-281-7961. Verified by
  opening the post via facebook-cli post read (public, 0 comments).
- No Facebook Page found for the Hillsborough office itself. The office's
  search-index place card (place_id 775563286917266) shows 5.0 based on 1
  review — index data only, recorded as NOT VISIBLE in aggregate candidates.
- **Exclusion — Right at Home of Central New Jersey (Old Bridge office,
  732-967-0900, rahcentral.com, facebook.com/RightatHomeofCentralNewJersey):
  a large volume of material surfaced (owner profile, recruitment reel,
  2026-11-09 "394 families / 5.0 stars, 394 reviews" ad, event-table photo).
  None of it was transferred — different office, different phone and website.
  Its "5.0 stars, 394 reviews" claim is that office's own ad copy, not this
  seed's Facebook Page rating.**
- **Exclusion — Right at Home Bergen County flyer** (201-489-3399,
  rightathome.net/ridgewood): different office, not transferred.
- Community groups checked: all three Hillsborough groups are CLOSED —
  Hillsborough NJ Community Forum (id 1914116389003190, 2,000 members),
  Hillsborough, NJ Community Update (2312470049027231, 5,000; rules state
  "What's shared in the group should stay in the group"), Hillsborough NJ
  Neighborly Forum (562799884346925, 2,000) — none searched, nothing copied.
  Somerset County Moms Group (212081548931088, 4,000) CLOSED — not searched.
  Franklin-Somerset Focus (855252611722039, 8,000) is OPEN (business promotion
  allowed); groups-posts queries for "Home Instead", "Right at Home" and
  "home care" returned no seed material (top hits: Seniors Helping Seniors
  ads, a care-options advisor post, cleaning-service ads).

### Home Instead Somerset (hp0289000) — 0 observations
- Queries: two social.search rounds ("Home Instead Somerset NJ", "Home
  Instead Somerset County review", "Home Instead Somerset recommendation
  experience", then "Home Instead Somerset County NJ", "Home Instead Somerset
  NJ home care", "Home Instead Davidson Avenue Somerset"); browser.search
  `"Home Instead" Somerset County NJ facebook.com`.
- Both social.search rounds returned 0 relevant results (first round's only
  hit was a Maryland Eastern Shore job plea mentioning Somerset County, MD).
  No Facebook Page found for the Somerset office. The office's search-index
  place card (place_id 3416467061965434) shows 5.0 based on 1 review — index
  data only, recorded as NOT VISIBLE.
- **Exclusions — other Home Instead offices, not transferred:** Springfield
  NJ / Millburn (288) hiring posts (facebook.com/HomeInsteadSpringfieldNJ,
  2026-11-06 and 2026-10-16, "WE'RE HIRING NJ CHHAS", Essex/Union counties);
  Hamilton/Robbinsville (357) posts in Plainsboro groups (phone 609-448-7555,
  homeinstead.com/357, incl. "Quarterly Family Support Group" May 16 posts);
  Parsippany/Morris County (322) place card (5.0, 2 reviews).
- Older directory records show a former address (100 Davidson Ave Ste 105);
  current operator site lists 220 Davidson Ave Ste 98 — no material tied to
  either address surfaced.

### Visiting Angels East Brunswick (hp0436900) — 0 observations; OFFICE NOT VERIFIED
- **Verification attempts (first step, before any linking):** four
  browser.search rounds — "Visiting Angels East Brunswick New Jersey Brier
  Hill Court office", "\"Brier Hill\" East Brunswick NJ Visiting Angels home
  care", "visitingangels.com East Brunswick office location New Jersey" —
  plus social.search "Visiting Angels East Brunswick NJ" / "home care" /
  "review recommendation" (0 results).
- **Result: the office is NOT corroborated.** No Visiting Angels office at
  "A2 Brier Hill Ct, Suite 3, East Brunswick" appears on visitingangels.com
  (NJ offices the locator surfaced: Hillsborough, Caldwell, Lawrenceville,
  Matawan, Red Bank, Morristown, Wall, Jersey City, Gloucester County), and
  no Facebook Page for a Visiting Angels East Brunswick office exists. The
  Brier Hill Ct address in East Brunswick belongs to **BrightStar Care of
  East Brunswick** (C2 Brier Hill Ct, Bldg C, Ste 206, 732-755-2846) and
  **Premier Home Care Inc** (2 Brier Hill Ct Bldg C Ste 209) — the repo
  assignment's address looks like a possible mix-up with the BrightStar
  office in the same building complex. Phone/website remain blank in
  assignments.csv.
- The Hillsborough Visiting Angels office (415/450 Amwell Rd) lists East
  Brunswick in its service area; its material was NOT transferred. The
  Morris & Somerset office (55 Madison Ave, Morristown) was NOT transferred.
  Florence Nightingale Visiting Angels LLC (812 Birchwood Ct, North
  Brunswick) is a different franchise; not transferred.
- Community groups checked: "We are East Brunswick" (353987382265724, 8,000)
  is OPEN (rules: no political posts) — groups-posts queries for "Visiting
  Angels" and "home care" returned no Visiting Angels mentions. "East
  Brunswick Group of True Transparency" (1941268836294714, 1,000) is OPEN
  (town-politics focus) — query "Visiting Angels" returned no relevant hit.
  East Brunswick NJ Community (387521908067351, 9,000), East Brunswick
  Parents Page (1733544273374024, 2,000) and East Brunswick Helping Each
  Other (1526373287620651, 13,000) are CLOSED — not searched, nothing copied.
- One community-thread item noted (not an observation): in "We are East
  Brunswick", a wheelchair user in East Brunswick posted seeking a private
  female caregiver for personal care (Hoyer-lift transfers, bathing,
  dressing). No agency named; no seed link. Left for the discovery lane's
  individual-aide tally, not recorded here.
- **Any post naming only "Visiting Angels East Brunswick" remains an
  unresolved lead until the office is verified by another route.** Coverage
  status is `searched_no_relevant_result` with this verification failure in
  coverage_notes.

### Senior Helpers Plainsboro (hp0347100) — 3 observations
- Queries: browser.search "Senior Helpers Princeton Plainsboro NJ Facebook
  page"; social.search "Senior Helpers Princeton NJ" / "Senior Helpers
  Plainsboro review" / "Senior Helpers Princeton recommendation experience".
- Office Page found: facebook.com/SHPrincetonNJ (24 followers), linked from
  operator site seniorhelpers.com/nj/princeton/. All three posts verified by
  opening via facebook-cli post read (all public, 0 comments):
  - fb-njx-001 (2026-10-26): "1 IN 2" loneliness-awareness graphic.
  - fb-njx-002 (2026-11-04): Alzheimer's Awareness Month connection guidance.
  - fb-njx-003 (2026-11-09): early-signs-of-Alzheimer's blog promotion.
  All provider_promotion, exact, neutral sentiment. No family firsthand
  account.
- Page rating check: browser.open of the Page returns a stub only (name,
  URL, professional account, 24 followers) — no rating block. facebook-cli
  profile info returns HTTP 403 ("Profile Not Accessible", friend-gated).
  Recorded as NOT VISIBLE in aggregate candidates.
- Community groups checked: "Plainsboro, West Windsor, East Windsor,
  Princeton Residents" (563818632183407, 11,000) OPEN, no rules — queries
  "Senior Helpers" and "home care" returned no Senior Helpers mentions.
  "Plainsboro, NJ Community Forum" (2515788301920334, 463) OPEN, no rules —
  queries "Senior Helpers" and "home care" returned no Senior Helpers
  mentions. Princeton Collection at Plainsboro (335185749904113, 533) CLOSED
  and Indian Community of New Jersey (1658516447508884, 5,000) CLOSED — not
  searched.
- **Exclusion — 2025-06-09 networking event flyer (Linda Price Amorosia,
  Maplewood at Princeton, 1 Hospital Dr):** the flyer image shows a Senior
  Helpers logo, but the CLI read of the post shows the tagged Page is
  "Senior Helpers - Central New Jersey", NOT the Princeton/Plainsboro office
  — NOT transferred. This is the trap the brief warned about.
- **Identity hold honored:** no material naming the unassigned 764 Easton
  Ave Senior Helpers office (HP0423200 / HP0175500) surfaced; any such
  material would be an unresolved lead, not a Plainsboro observation.
- Place-card phone variant 609-759-8027 noted (assignments.csv lists
  609-759-2225 from the operator site); address consistent everywhere.
- Discovery-lane flags from the Plainsboro open groups (not seed rows, noted
  for the discovery lane): private HHA "Kim" seeking live-in work
  (2026-07-19); an individual-aide recommendation vouching for a private
  caregiver (5 years caring for the poster's mother); a self-promotion post
  from "Regmon Care" (small agency); a private live-in companion request for
  the Lawrenceville area. None names a seed office.

## Blocks and limits
- Facebook CLI cannot enumerate an unmanaged Page's timeline or its
  Recommendations tab; browser Page reads return stubs only.
- facebook-cli profile info returns HTTP 403 for SHPrincetonNJ (friend-gated).
- All Hillsborough community groups and the Somerset County Moms Group are
  CLOSED; the Hillsborough, NJ Community Update group explicitly states
  content stays in the group. These were not searched and nothing was copied.
- social.search is selected/personalized, not exhaustive; zero results here
  mean no relevant material surfaced, not that none exists.

## Name variants tried
Right at Home Somerset / Hillsborough / West Central New Jersey / Somerset &
Hunterdon; Home Instead Somerset / Somerset County / Davidson Ave; Visiting
Angels East Brunswick / Brier Hill; Senior Helpers Princeton / Plainsboro /
of Princeton.
