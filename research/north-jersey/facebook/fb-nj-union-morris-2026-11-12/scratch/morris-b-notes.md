# Morris slice B notes — fb-nj-union-morris-2026-11-12

Slice: nj-doh-NJ14C014 The Terraces at Florham Park; nj-m-09 Visiting Nurse
Association of Northern New Jersey (Morristown); nj-m-10 Visiting Angels of
Morris and Somerset County (Morristown). Observation prefix `fb-njm-b-`.
Searched 2026-11-12. Facebook account: Dan Sullivan (fb_user_id 1420075896).

## 1. nj-doh-NJ14C014 — The Terraces at Florham Park (190 Park Ave, Florham Park, NJ 07932; Comprehensive Personal Care Home, license 14C014)

**Result: 0 observations — searched_no_relevant_result.**

Queries run:
- social.search (facebook, since 2024-11-12, top 25): "Terraces at Florham
  Park", "Terraces Florham Park assisted living review", "Terraces at
  Florham Park experience", "Terraces Florham Park recommendation" — no posts.
- social.search (facebook, no date filter, top 25): "Terraces Florham Park
  NJ", "Terraces at Florham Park senior living", "190 Park Avenue Florham
  Park senior" — no posts.
- social.search (facebook, since 2024-11-12, top 25): "Terraces Florham
  Park", "Florham Park senior living review", "Florham Park assisted living"
  — no posts.
- browser.search: "The Terraces at Florham Park Facebook page" — no Page
  found; directory listings only.
- browser.search: site:facebook.com "Terraces at Florham Park" — no Page;
  only unrelated "Terraces" results (River Park SC, DLF Promenade Delhi,
  Terraces at Absecon Inlet) and Florham Park community posts.
- browser.search: '"Terraces at Florham Park" 190 Park Avenue website OR
  Facebook OR reviews' — confirmed NJ DOH records; no Facebook presence.
- facebook-cli groups search: "Florham Park", "Florham Park NJ",
  "Morris County seniors". Groups found and checked for visibility/rules:
  Florham Park Forum (156539317719829, OPEN, 5000 members), Florham Park,
  NJ Community Forum (2981953008767459, OPEN, 2000 members), Elderly
  Caregiver - Morris County NJ (766723355319419, OPEN, 1000 members).
  Rules in Florham Park Forum (relevancy, respect, no ads, no politics)
  do not forbid research/reuse; Elderly Caregiver group has no rules
  listed. No private groups searched.
- facebook-cli groups posts --query 'Terraces' in Florham Park Forum: 3
  hits, all false positives (concrete patio referral request 2024-03-06;
  cat at a patio door 2023-11-12; one empty-content post 2025-06-27).
- --query 'Saint Anne Villa' (former name, per seniorcare.com) in Florham
  Park Forum: 2 hits — a Florham Park Rehabilitation Trunk or Treat event
  post (2023-10-13, 190 Park Ave) and a Villa of Florham Park Alzheimer's
  talk (2018-08-16). Neither is The Terraces.
- --query 'assisted living' in Florham Park Forum: 20 hits, mostly the
  BPS Elm Street proposed-facility fight (a different, proposed facility),
  plus one 2023-06-19 post by a resident of an unnamed Florham Park
  assisted living facility seeking a handyman. Its 5 comments (read via
  post comments read) name only handymen, never the facility — not
  attributable, excluded.
- --query 'Terraces' in Elderly Caregiver - Morris County NJ: no results.
- --query 'Terraces' in Florham Park, NJ Community Forum: only sunroom /
  patio enclosure ads ("terrace" false positives).

Exclusions with reasons:
- Florham Park Rehabilitation Trunk or Treat post (2023-10-13): the
  co-located long-term care facility at the same address, a different
  licensed entity, not the rostered CPCH.
- Villa of Florham Park (2018-08-16 Alzheimer's talk): a different
  facility.
- Unnamed-facility handyman post (2023-06-19): facility never named in
  post or comments; cannot be attributed to The Terraces.

Context found (not Facebook evidence): NJ DOH lists two Terraces records
at 190 Park Ave — 14C014 Comprehensive Personal Care Home (27 beds, phone
973-867-1500) and 60A010 Assisted Living Residence (21 beds, phone
609-386-7171), same administrator and owner. Former name Saint Anne Villa.
The campus shares the address and phone with Florham Park Rehabilitation
and Healthcare Center. No aggregate candidate: no Facebook Page publishes
a rating for this location.

## 2. nj-m-09 — Visiting Nurse Association of Northern New Jersey (VNANNJ; 175 South St, Morristown, NJ 07960; home health, CMS CCN 317002)

**Result: 1 observation (fb-njm-b-001) — searched_with_relevant_result.**

Queries run:
- social.search (facebook, since 2024-11-12, top 25): "Visiting Nurse
  Association of Northern New Jersey", "VNA of Northern New Jersey",
  "VNANNJ Morristown", "Visiting Nurse Association Morristown NJ review"
  — 1 kept post: Dominick DiFalco Sr. 2026-09-03 tag-only post.
- social.search (facebook, no date filter, top 25): "VNANNJ", "VNA of
  Northern New Jersey client review", "Visiting Nurse Association
  Northern New Jersey home care experience" — 13 kept posts, all about
  the Vietnamese jewelry company PNJ (ticker), a substring false
  positive; no VNANNJ content.
- browser.search: "Visiting Nurse Association of Northern New Jersey
  Facebook page Morristown" — confirmed official Page facebook.com/vnannj
  (1.2K followers) and surfaced the 2026-09-03 DiFalco tag post.
- browser.search: site:facebook.com "Visiting Nurse Association of
  Northern New Jersey" — surfaced 4 VNANNJ Page posts: 2026-11-04
  advocacy graphic (Support S.5250 Medicare Home Health), 2026-10-09
  testimonial graphic (Tracy / Jen, physical therapy), 2026-09-03
  Labor Day graphic, 2026-08-18 "Romance Ages Well" graphic.
- facebook-cli post read of the 2026-10-09 testimonial post: public,
  owner Visiting Nurse Association of Northern New Jersey
  (100063786494232), 0 comments; caption and graphic text confirm the
  quote. Recorded as fb-njm-b-001 (provider_promotion, exact, positive;
  independence unestablished).
- browser.open https://www.facebook.com/vnannj — Page fetch returned
  only profile metadata (professional account, 1192 followers); no
  rating surfaced.
- facebook-cli groups search "Morristown": Morristown Helps
  (638911306894469, 3000 members), Morristown Recommendations, Reviews &
  Town Happenings (835154269943493, 5000 members), Morristown, NJ - Then
  and Now (214289766077685, 2000 members), Morristownfoodandbars
  (800829063344995, 7000 members), Morristown, Tennessee (625590577997838
  — wrong state, ignored). Group details did not report privacy; posts
  were readable. No rules listed that forbid research/reuse.
- facebook-cli groups posts --query 'Visiting Nurse' and 'VNA' in
  Morristown Helps and in Morristown Recommendations, Reviews & Town
  Happenings: no VNANNJ mentions. The 'VNA' query in Morristown Helps
  returned 2 posts — a 2021-06-18 Spina Bifida help request that
  explicitly says agencies are not feasible, and a 2020-05-05 post with
  empty content. A keyword-flagged Nick's Hope FAQ post (2021-04-19)
  matched only "Northern New Jersey" (clothing charity service area) —
  false positive, read in full to confirm.

Observation:
- fb-njm-b-001 (2026-10-09, public, provider_promotion): testimonial
  graphic; client "Tracy" praises physical therapist Jen as very
  helpful and knowledgeable, listening to concerns, better physical
  therapy than she had before. Themes staff_responsiveness,
  personal_care. Excerpt (17 words): "Very helpful and knowledgeable.
  Jen listened to my concerns and did everything she could to address
  them."

Aggregate candidate (eligibility review only):
- facebook.com/vnannj — Facebook place listing (place_id
  438990601487941) shows 4.0 based on 10 reviews for the exact 175
  South St, Morristown location, surfaced via web-search snippet. The
  direct Page fetch did NOT surface a rating, so the value is
  unconfirmed — recorded in morris-b-aggregate-candidates.csv for
  eligibility review, not as a finding.

Exclusions with reasons:
- Dominick DiFalco Sr. post (2026-09-03): tags VNANNJ with a branded
  hashtag but no commentary — a mention, not a care account.
- VNA Health Group posts (2026-06-24, 2026-01-07): different
  organization (VNAHG, Holmdel-based).
- VNACJ - Community Health Center post (2026-01-30): different
  organization (Central Jersey).
- Lower Penns Neck VNA carousel (2025-01-10, Pennsville): different
  organization.
- Instagram testimonial graphics (~Bob 2026-07-26, ~Karen 2026-11-10,
  ~Marilyn 2026-03-31, ~Rita 2026-07-09, ~Dayna 2026-04-29, ~Kellie
  2026-05-29, ~Deborah 2025-03-06, ~Wolfgang 2025-09-16, ~Pkap
  2024-12-11): Instagram, out of scope for this Facebook run — noted
  here as leads only, not recorded as observations.
- ReviewStars "4.6 star rating with 406 reviews": third-party
  aggregator, not Facebook — not recorded as an aggregate candidate.
- vnannj.org testimonial letters: website, not Facebook — not recorded.
- Morristown group hits: false positives (see above).

## 3. nj-m-10 — Visiting Angels of Morris and Somerset County (Morristown office; 55 Madison Ave #400, Morristown, NJ 07960; phone 908-572-7017; visitingangels.com/morristown)

**Result: 0 observations — searched_no_relevant_result.**

**Identifier gap (recorded, not filled): no verified NJ Consumer Affairs
HCSF registration number was found for this office.** The agency website
says it is "accredited by the state of NJ" and "fully accredited by the
CAHC", but neither statement is an HCSF number. Do not invent one; confirm
before any publication use.

Queries run:
- social.search (facebook, since 2024-11-12, top 25): "Visiting Angels
  Morristown NJ", "Visiting Angels Morris County", "Visiting Angels of
  Morris and Somerset County", "Visiting Angels Morristown review" — 1
  kept post: "Linda Visiting Angels" 2026-06-16 Twilight Wish event
  flyer (event at Morris View Healthcare Center, Morristown).
- social.search (facebook, no date filter, top 25): "Linda Visiting
  Angels Morristown", "Visiting Angels Morristown caregiver",
  "Visiting Angels Morris Somerset County Facebook" — 0 posts.
- browser.search: "Visiting Angels Morris County Morristown NJ Facebook
  page 55 Madison Avenue" — confirmed office identity (55 Madison Ave
  #400, 908-572-7017, visitingangels.com/morristown); no local Page URL
  surfaced. Facebook place listing (place_id 1106797493263665) shows no
  rating.
- browser.search: site:facebook.com "Visiting Angels" Morristown —
  surfaced corporate Page posts, the Linda post, and other franchises
  (see exclusions).
- browser.open https://www.facebook.com/visitingangelsLinda — professional
  profile, 646 followers (social.search summary had said 460; Page fetch
  figure used). No rating surfaced.
- facebook-cli profile info --profile-id visitingangelsLinda and timeline
  fetch --limit 20: both HTTP 403, "Profile Not Accessible — This profile
  is only readable for the viewer or the viewer's friends." The local
  franchise-associated profile's posts cannot be read via the CLI. Access
  limit recorded in coverage.
- facebook-cli groups posts --query 'Visiting Angels' in Morristown Helps
  (638911306894469) and in Morristown Recommendations, Reviews & Town
  Happenings (835154269943493): only loose keyword matches — Creature
  Comfort Pet Therapy posts, "angels on earth" praise for a restaurant,
  hiring posts — no Visiting Angels content in visible text. Several
  returned posts have empty content (photo/link posts); none could be
  attributed to this office.

Exclusions with reasons:
- VisitingAngelsCorporate posts (130K followers): "Angel of the Month"
  employee recognitions (Caitlin Stipe Dec 2024; Peter Asamoah Feb 2024;
  Abiel Valce Feb 2026) and a 2026-09-22 farewell post for a client
  named Linda (nearly four years of care, moving to Arizona) — brand-wide
  posts naming no office; cannot be attributed to the Morristown
  franchise. The farewell "Linda" is a client, not the "Linda Visiting
  Angels" profile — do not conflate the two.
- Senator Rosemary Brown post (2026-08-20): Pennsylvania Senate
  certificate for a Pennsylvania Visiting Angels office (Tricia
  Wingerter) — different franchise, different state.
- Visiting Angels, Bethlehem PA post (2026-07-07): different franchise.
- Greater Yakima Chamber of Commerce reel (2026-06-15): Visiting Angels
  franchise in Yakima, WA — different franchise.
- "Linda Visiting Angels" 2026-06-16 post: Twilight Wish community-event
  flyer for a June 23, 2026 networking event at Morris View Healthcare
  Center — an event promotion, not a resident/family care experience.

No aggregate candidate: no Facebook Page or place listing for this office
visibly publishes a rating for the exact location.

