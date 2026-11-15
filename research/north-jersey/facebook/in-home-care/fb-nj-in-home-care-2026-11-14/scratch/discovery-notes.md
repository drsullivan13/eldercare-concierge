# Discovery lane notes — run fb-nj-in-home-care-2026-11-14

Lane 2: names Harbor might have missed. Public community and caregiver
discussions in Union, Morris, Essex, Somerset and Middlesex counties.
Search window: 2026-11-14 ~19:28–19:33 ET (2026-11-15T00:28–00:33Z), plus a
new-seed re-check 2026-11-14 19:37 ET (2026-11-15T00:37:34Z).
Retrieval timestamps in the CSVs are per-batch (see below).

## Method

- `social.search` (platform=facebook, since 2024-11-14, top=25) for all 9 towns
  with the brief's queries: "home care agency for my mom", "companion for dad",
  "respite aide", "weekend aide", "who have you actually used?", plus "home care"
  and "caregiver" in group queries.
- `facebook-cli groups search` for town community groups; `groups posts
  --group-id <id> --query 'home care'` (and 'caregiver' where the first query
  returned 0) on 12 public groups; `post read` + `post comments read` for 9
  threads; `groups details` for the Westfield group; one `link-sharing
  decode-url`.
- Rule kept throughout: NO provider_id assigned, even for suspected seeds.
  Seed-suspected finds are probable/unresolved with candidate_provider_name and
  the suspected seed named in match_reason. The seed slices are authoritative.
- Phone numbers, profile links and contact details are NOT recorded in any
  CSV (protocol). Individual aides are tallied below without personal details.

## Per-town summary

### Chatham (Morris, 07928) — evidence_found, 1 obs, 15 leads
- Chatham Community Forum (607297712701876, ~8,000 members) and Chatham
  Borough NJ – Community Forum (196167567537575, ~6,000) searched via CLI.
- Threads read: 2026-04-09 part-time HHA request (9 comments); 2026-06-12
  live-in caregiver request for 81-year-old mother with dementia on hospice
  (4 comments) — OneCare Harmony recommended twice (fb-njd-004);
  2025-10-05 post-surgical home health request (10 comments, no agency named);
  2026-10-31 companion request for mother at Juniper in Chatham (facility-stay
  context, excluded); 2026-09-14 rehab placement discussion, 43 comments
  (facility stays, excluded); 2026-08-09 "Lana" caretaker endorsement and
  2025-04-18 "Yvania" aide endorsement (individual-aide tallies).
- Chatham Borough threads: 2026-05-11 stroke recovery / coming home (3
  comments; OneCare Harmony owner self-promotion); 2026-04-06 trustworthy aide
  2x/week (10 comments; individual-aide offers; one detailed account of an
  informal Colombian former-nurses care team — unnamed, unlicensed, NOT an
  agency, pattern noted only); 2026-03-04 SAGE Eldercare provider post citing
  client quotes (quotes not visible in excerpt — lead, not observation);
  2026-01-05 OneCare Harmony self-advertisement; 2025-11-24 free community
  presentation at Florham Park Library (likely SAGE Eldercare).
- Unnamed-agency endorsement NOT recorded as an observation: Mary Velazquez
  post 2026-08-05 (post_id 10242456238890364), "Best Agency in NJ ... They
  really take care of my Mom" — genuine family endorsement after care began,
  but the agency is NOT named in the visible caption and there are 0 comments.
  compile-run.py requires a candidate name on probable/unresolved rows, and
  inventing one would be junk data. Tallied here instead.

### Summit (Union) — partial, 0 obs, 4 leads
- Everything Summit (2634981673300055, ~2,000) and Summit NJ group
  (658422187505498, ~12,000): 0 results for "home care".
- Pamela Cario Sayles thread (group 4336540516459451, post 28113815454971957,
  2026-08-10): family seeking weekend care (Sat/Sun 9 AM–1 PM) for 90-year-old
  mother post-stroke in Summit; 4 comments — 3 individual aides offering
  availability, plus Andrea, owner of Blueprint Home Care (Morris County,
  state-registered per her comment), offering to talk through needs.
- Individual-aide tallies: Pamela thread (3 offers), a Feb 2025 Pamela post
  (caregiver offers; facility stay), David Coloma live-in HHA job ad
  (employment), Tara Cunningham-Leas aide solicitation (PPL payroll).

### Westfield (Union) — evidence_found, 1 obs, 3 leads
- Westfield, NJ group (181023518704974, ~20,000 members) is PRIVATE; rules
  include "What's shared in the group should stay in the group" (privacy rule)
  — research/reuse NOT permitted. NOT joined, NOT read, nothing copied.
  Logged access_restricted for that group only.
- Westfield Southsider (279566962648341, ~3,000): 0 results for "home care".
- BrightStar Care Westfield & Summit client testimonial (fb-njd-003) via
  social.search.
- Individual-aide tallies: Brenda Steele post (sister relocated to Westfield,
  20+ years experience; commenters named a local insurance contact and the
  Office of the Aging), Juliana Solowinski job-seeking (Westfield/Union County).

### Morristown (Morris) — partial, 0 obs, 5 leads
- Morristown Community Forum (850931364919624, ~1,000): 11 near-identical
  repeated ads (June–September 2026) for Senior Helpers from one poster —
  provider promotion; branch/office NOT stated, so it cannot be tied to the
  Madison seed (HP0104400). Recorded as ONE lead with branch unestablished
  (see "New seeds" below for the Plainsboro / 764 Easton Ave implications).
  Also one overnight-caregiver ad (individual aide) and handyman/cleaning noise.
- Morristown NJ – Then and Now (214289766077685, ~2,000): 0 results for
  "home care".
- Pam Carlson thread (group 2474860256161506, post 3917539128560271,
  2025-05-04): "any recommendations for caregivers for the elderly?" 9 comments
  — Integral Care Home Care offered help; one commenter with 30 years in home
  care (live-in/hourly, Morris/Union/Essex, licensed/bonded/insured); a senior
  placement advisor offering recommendations by DM; Corner Stone Adult Day Care
  Morristown mentioned (adult day program — NOT in-home care, excluded); one
  commenter recommending her mother's private aide (individual-aide tally).
- Individual-aide tallies: Nataliya Greenberg (Russian/Ukrainian-speaking,
  part-time for mom), Angelica Sapienza (private CHHA, Morris County), Totri
  Elbakidze (overnight male caregiver, 5+ years), Norma Rivera (personal
  assistance, Essex/Union/Morristown), Jan Duller (companion job listing,
  89-year-old male), Manuel Loachamin (job postings incl. Morristown), Deloris
  Turner Harless (daytime caregiver request).

### Montclair (Essex) — partial, 0 obs, 12 leads
- Montclair's South End (3294450913919329, ~3,000) and New to Montclair NJ
  (337114820951081, ~3,000): 0 results for "home care".
- Montclair Mutual Aid (2670649733217529, 779) identified but not queried —
  mutual-aid group; no home-care discussion surfaced in search.
- Gina Turiello veteran thread (group 2701207050103401, post 5466622913561787,
  2026-09-10): request for home-care agencies serving veterans; 20 comments
  read — name-only recommendations, mostly Monmouth/Ocean (out of scope) but
  in-scope names: Caring People Homecare, Alvita Care, Life Force Senior Care,
  Eminence Home Care (VA contract), Always Best Care of Central New Jersey,
  Executive Home Care of Morristown. Seed-brand mentions (BAYADA, Visiting
  Angels, HomeWell, Right at Home Northern Monmouth/Middlesex/Mercer — a
  different Right at Home franchise from the Essex seed) noted as
  brand-confusion only. BoldAge PACE noted (PACE program, not a nonmedical
  agency).
- Individual-aide tallies: Trang Jacobson (91-year-old mother), Gerdy
  Beleut-Odabas (Spanish-speaking weekend aide), Teresa Grateful (backup
  caregiver), Ingrid Gomes (job-seeking), Nina Tushishvili (intermediary for
  experienced caregivers, Nutley/Belleville/Bloomfield/Montclair), Emily
  Toscano (live-in caregiver, Monroe area).

### Bridgewater (Somerset) — evidence_found, 1 obs, 2 leads
- Bridgewater Martinsville Raritan NJ Community Forum (1468809430052029,
  ~6,000) and Bridgewater-Raritan NJ Bulletin Board (255104491259557, ~9,000):
  0 results for "home care".
- Homewatch CareGivers Woodbridge review-quote (fb-njd-002) via social.search.
- Individual-aide tallies: Melissa Nagy Jenkins (recruiting HHA for two
  disabled adults — family hiring request), Poonam Bordoloi (part-time
  caregiver for mother-in-law, 2 hrs/day).

### Somerville (Somerset) — partial, 0 obs, 5 leads
- Somerville NJ – Talk of the Town (254647882927781, ~10,000) and Somerville
  NJ Community Page (148621185835305, ~26,000): 0 results for "home care"
  and "caregiver".
- Leads from social.search only (Arch Angels, Haven of Peace, A Place At Home
  – Somerville, Acti-Kare, Alimata).
- Excluded: Cindy Schoen post about Somerville, MA (Magoun Square,
  MassHealth — wrong Somerville).

### Edison (Middlesex) — evidence_found, 1 obs, 15 leads
- Edison NJ 08817-08820-08837 (4224728424464031, ~6,000): mostly noise
  (nanny, cleaning, housing); one relevant post 4551480611788809 (2026-07-04,
  individual-aide endorsement — aide cared for mother five years, seeking
  24/7 live-in after patient died) — individual-aide tally.
- Kait Aurilio Gesek North Edison thread (group 2780034385586501, post
  4480840728839183, 2026-09-09): seeking caregiver for 80-year-old father in
  North Edison; 17 comments — mostly individual aides; new names Medivance
  Care LLC, Growing Hearts, Madat HHC (all leads).
- BrightStar Care East Brunswick client review (fb-njd-001) via social.search.
- Individual-aide tallies: Denise Coonan, Regina Ashurov (CHHA, Central NJ,
  multiple posts), Madona Sarajishvili-Vardiashvili (HHA, 15 service areas),
  Meryl Rubin Vance (per diem HHA recruiting), Amy Patel (caregiver for
  in-laws), Nidhi Radia / Neha Jain Shah (live-in caretaker requests for
  elderly couple), Alpana Jain (nurse/nanny for mother with Parkinson's),
  Nitu Bansal (HHA position), Tatevik Ashurov (HHA role), LiveInCareUSA
  (Edison live-in position posting). Achal Parikh companion request was for a
  grandmother in a rehab home — facility, excluded.

### New Brunswick (Middlesex) — partial, 0 obs, 13 leads
- Old New(s) Brunswick NJ (943957737153354, ~7,000) and "You know you're from
  New Brunswick, NJ if..." (173217722746405, ~30,000): noise only.
- Leads from social.search only. Right at Home Central New Jersey confirmed
  as a distinct franchise (see "New seeds" below).
- Individual-aide tallies: Javni Patel (live-in caretaker for mother, 2
  posts), Tracy Stoessler (helping mother's former aide find work near East
  Brunswick — aide with 5 years experience), Alex Anders (male home aide job
  listing).
- Excluded: Atlantic Homecare / Caring Companion / Unicare / Hope Spring Home
  Care (New Brunswick, CANADA — 506 area code, .ca).

## New seeds (repo main 7ba7adc) — discovery re-check 2026-11-14 19:37 ET

Four seeds added after the discovery searches ran; a dedicated
Somerset+Middlesex researcher covers them. Discovery re-checked each name
with social.search (platform=facebook, since 2024-11-14):

- Right at Home Somerset & Hunterdon (105 Omni Dr, Hillsborough, HP0101000):
  NO material on the Hillsborough seed surfaced. The only Right at Home
  material is the Central New Jersey franchise (rahcentral.com, 732-967-0900,
  serving Middlesex/Mercer/Northern Monmouth) — confirmed a DISTINCT franchise
  by its own 2026-10-02 promo, recorded as lead fb-njd-lead-072. The rest of
  the search was noise (real-estate listings, 55+ housing thread).
- Home Instead Somerset (220 Davidson Ave Suite 98, Somerset, HP0289000):
  0 posts returned.
- Visiting Angels East Brunswick (A2 Brier Hill Ct Suite 3, HP0436900):
  0 posts returned.
- Senior Helpers Plainsboro (2 Hospital Dr Building B, HP0347100): 2 posts
  returned, both Town Square Princeton adult-day event flyers that carry a
  Senior Helpers logo only — no care experience, no Plainsboro office content.
  (The flyers' venue address, 2 Hospital Dr, Plainsboro, is Town Square
  Princeton's address, not evidence about the Senior Helpers office.)
- Somerset identity hold: the Senior Helpers office at 764 Easton Ave Suite 8
  (HP0423200 / HP0175500) is deliberately UNASSIGNED. No discovery material
  names that address. The Morristown Forum Senior Helpers ads (lead
  fb-njd-lead-028) name NO branch — they could be the Madison seed, the
  Plainsboro seed, or the unassigned 764 Easton Ave office — so they stay a
  lead, NOT a Plainsboro observation.

## Observations (4)

- fb-njd-001 BrightStar Care of Greater Middlesex & Monmouth Counties
  (East Brunswick) — probable, provider-published client review ("Lucille"
  praising caregiver Magdaline). Verbatim excerpt 19 words, verified via
  facebook-cli post read.
- fb-njd-002 Homewatch CareGivers Woodbridge — probable, provider-republished
  Google review quote ("Elise H.", father). Quote is in the post image; the
  caption does not repeat it, so no excerpt recorded. Verified via post read.
- fb-njd-003 BrightStar Care Westfield & Summit — probable, provider-published
  five-star testimonial. Suspected seed HP0191600; seed slice is authoritative
  matcher. Testimonial text is in the post image; caption is provider framing
  only, so no excerpt recorded. Verified via post read.
- fb-njd-004 OneCare Harmony — unresolved, recommendation_without_detail.
  Two community members recommend it in one Chatham thread; neither states
  they used it after paid care began. Excerpt 9 words, verified via comments
  read.

## Leads (74)

New independent agencies / small operators without experience content, one
row each in discovery-leads.csv with source URL, what is missing, and notes.
Notable: Aquinas Healthcare (Chatham/Summit), SAGE Eldercare (Summit
nonprofit, accredited, since 1954), One You Love Homecare of Bridgewater,
2ndFamily of Montclair ("COMING Fall 2026" launch), First Day Homecare
(HCSF HP0397600 stated on its own brochure), A Place At Home (Montclair /
Somerville / East Brunswick — three separate offices), Home Helpers
(West Essex and Morristown — two franchises), Seniors Helping Seniors
(Morris County chapter; franchise — Central NJ chapter is separate).

## Out-of-scope / excluded (notes only, NOT leads)

- Facility stays: Juniper Village at Chatham companion request; Chatham
  rehab placement thread (FP Rehab, Inglemoor, Chatham Hills, Spring Grove,
  Runnells, Mountainside); Summit Home Care & Hospice testimonial
  (skilled/hospice); Achal Parikh rehab-home companion request.
- Employee reviews / job ads treated as employment, not family experience:
  Eastbridge, Outfront, Garden Family, Grace Healthcare (employer-only
  mentions are leads with that caveat, not observations).
- Medicare skilled home-health episodes: none identified as family experience.
- Out-of-county: Regmon Care (Princeton/Mercer); Caring Hearts (Bergen &
  Hudson — recorded as a lead only because it surfaced in a New Brunswick
  search, flagged out-of-scope); Flemington/Hunterdon mentions (Anita's
  Angels, Seniors Helping Seniors Central NJ); West Milford/Passaic thread
  (TLC Companions NJ; individual aide Debbie Brown); Home Care Bears
  (Matawan, Monmouth); BrightStar Care of North Middlesex County is a
  different branch — recorded as a lead (Edison search), not a seed.
- Wrong geography: Neighbourly Care (Chatham-Kent, Ontario, Canada);
  Cindy's Personal Care Home (Westfield, PA); TrustedHands Care Agency
  (Westfield, IN); Summit County OH posts (A Lot Of Love Home Health, Unique
  Touch, Heartfelt Cares); New Brunswick, Canada posts; Somerville, MA post.
- Not in-home older-adult care: Hopes Promise Respite (developmental-
  disability respite, Montclair); Delightsome Care Services (DDD, Edison);
  Legacy Path Solutions (Monmouth, disability respite); Corner Stone Adult
  Day Care (adult day program); BoldAge PACE (PACE program); AIP Mobility
  (stair lift installer); A Place for Mom (referral service, not an agency);
  Brooke Care (search/verification platform); PicknCare (caregiver-matching
  platform, 100+ vetted private caregivers NJ).
- Too weak for a lead: "Mom's Got It" (tagged in a Chatham thread; unknown
  what it is); "Home Sure Home Care" IS recorded as a lead (name only in a
  New Brunswick group welcome post) with what_is_missing stating that.

## Search-method notes

- social.search is selected/personalized, not exhaustive — several town
  searches returned geographically off-target results (other states' towns
  with the same name, other NJ counties); the Chatham search returned mostly
  provider promotion. Genuine family experience accounts are rare in the
  retrieved sample — most material is provider ads, family hiring requests,
  and individual-aide solicitations.
- Facebook CLI `groups posts` returns up to ~20 posts per query; query
  "home care" matched loosely (cleaning, chiropractic, handyman posts
  included).
- CLI `post comments read` works for public group posts; share links decode
  via `link-sharing decode-url` (1CRqviTaox resolved to the Chatham Forum
  "Yvania" individual-aide post 9442104145887811 — no new agency).
- Facebook CLI cannot enumerate an unmanaged Page's timeline or
  Recommendations tab — recorded as an access limit in coverage.
- No private group was joined or read. The only private group encountered
  (Westfield, NJ) forbids taking content out; logged access_restricted.

## Retrieval timestamps

- Town social.search batches: Chatham/Summit/Westfield/Morristown
  2026-11-15T00:28:10Z; Montclair/Bridgewater 2026-11-15T00:29:27Z;
  Somerville/Edison/New Brunswick 2026-11-15T00:29:41Z.
- Group post queries/reads (facebook-cli): 2026-11-15T00:31:31Z.
- New-seed re-check searches: 2026-11-15T00:37:34Z.
- Coverage searched_at_utc: 2026-11-15T00:30:00Z.
