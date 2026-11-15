# Union slice notes — run fb-nj-in-home-care-2026-11-14
Market: union. Observation prefix: fb-nju-. Researcher: subagent (Union slice).
Collection window: 2026-11-14 ~19:28–19:35 ET (retrieved_at UTC 2026-11-15T00:28–00:31Z).

## Assigned providers (from batch-manifest.json / assignments.csv)

- north-jersey-hp-hp0065000 Visiting Angels Union — 485 Morris Ave #201, Springfield, NJ 07081 — HP0065000
- north-jersey-hp-hp0249500 HomeWell Care Services — 1600 US Highway 22 E, Suite 301, Union, NJ 07083 — HP0249500
- north-jersey-hp-hp0191600 BrightStar Care Westfield & Summit — 560 Springfield Ave, 2nd Fl, Ste G, Westfield, NJ 07090 — HP0191600
- north-jersey-hp-hp0015320 BAYADA Union County — 251 North Ave W, Suite 201, Westfield, NJ 07090 — HP0015320

## Results summary

13 observations total. 10 exact, 2 probable, 1 unresolved. 0 family firsthand care
accounts. 0 safety allegations. All rows internal_review_pending.

| Provider | Obs | Exact | Probable | Unresolved | Character |
|---|---|---|---|---|---|
| Visiting Angels Union | 1 | 1 | 0 | 0 | Employment (Jan 2023 hiring post) |
| HomeWell Care Services | 2 | 2 | 0 | 0 | Provider promotion (training-event reels) |
| BrightStar Care Westfield & Summit | 7 | 7 | 0 | 0 | Provider promotion / employment |
| BAYADA Union County | 3 | 0 | 2 | 1 | Promotion + 1 unresolved negative comment (index only) |

## Per-provider detail

### Visiting Angels Union (north-jersey-hp-hp0065000) — 1 obs, evidence_found
- social.search (platform=facebook, since=2024-11-14, top=25), 4 neutral queries:
  "Visiting Angels Union New Jersey", "Visiting Angels Springfield NJ home care",
  "Visiting Angels Union recommendation review", "Visiting Angels Union NJ experience"
  → 0 post blocks returned.
- browser.search "Visiting Angels Union NJ Facebook page Springfield" → no Facebook
  Page found. Operator site confirms office at 485 Morris Ave #201, Springfield,
  phone 908-497-7016.
- A second web search surfaced facebook.com/VisitingAngelsNJSeniorCare — that is the
  Burling-Mercer franchise (NJ License #HP0107200), NOT this seed. Not transferred.
- Community groups searched via facebook-cli:
  - "What's happening in Springfield NJ" (286116885538992, 6,000 members) --query
    'Visiting Angels' → 20 posts returned; 3 were Visiting Angels hiring posts
    (2023-01-02, 2023-01-11, 2023-01-18, all naming 485 Morris Ave #201,
    Springfield and 908-497-7016). Recorded as ONE observation (fb-nju-001, the
    Jan 2 post); the Jan 11 and Jan 18 posts are the same recruitment push, noted
    in independence_notes, not separately recorded. Remaining 17 posts were
    unrelated group content (food pantry, therapy, house cleaning, etc.).
  - "Springfield NJ Neighbors (Union County)" (643761569304974, 5,000) --query
    'Visiting Angels' → 0 results.
  - "Union, NJ Residents Forum" (146324565519435, 28,000) --query 'Visiting Angels'
    → 0 results.
  - "Union, NJ Neighborhood Chat" (499305033541998, 13,000) --query 'Visiting Angels'
    → 0 results.
  - "Union County Residents Forum" (510486929060528, 2,000) --query 'Visiting Angels'
    → 0 results.
- NOT searched (membership-only, closed): "I Love Living in Springfield NJ"
  (1232920610066047, ~1,000 members; group description states it is a closed group
  for current Springfield residents/business owners and forbids unsavoury reviews of
  local businesses) and "Springfield NJ Dads" (356943244392715, 741; membership
  restricted to Springfield dads). Logged as access limits; nothing copied.
- No family care experience found anywhere checked. The 2816 Morris Ave, Union
  address from the earlier Harbor record produced no Facebook material in these
  searches; the discrepancy stays open.
- Aggregate candidate: no public office Facebook Page found → NOT VISIBLE, values blank.

### HomeWell Care Services (north-jersey-hp-hp0249500) — 2 obs, evidence_found
- social.search (same method), queries: "HomeWell Care Services Union New Jersey",
  "HomeWell Union NJ home care", "HomeWell Care Services Union recommendation",
  "HomeWell Union NJ review experience" → 2 results, both reels from the office's
  own Page "HomeWell Care Services - New Jersey" (facebook.com/HomeWellCareServicesNJ,
  1.1K followers).
- Both reels verified via facebook-cli post read (public, owner confirmed):
  - fb-nju-002: reel 1754160122326819, posted 2026-11-10, caregiver training event
    Nov 12, 2026 at "our Union office (1600 US-22, Suite 301, Union, NJ 07083)".
  - fb-nju-003: reel 1002482739264544, posted 2026-07-30, caregiver training day
    Aug 13 at the same Union office address.
- Community groups: "Union, NJ Residents Forum" --query 'HomeWell' → 0; "Union, NJ
  Neighborhood Chat" --query 'HomeWell' → 0; "Union County Residents Forum" --query
  'HomeWell' → 0.
- Page rating: CLI profile info → HTTP 403 "Profile Not Accessible". browser.open of
  the Page returned a stub only (name, URL, professional account, 1,127 followers),
  no rating block or reviews. Aggregate candidate → NOT VISIBLE, values blank.
- No family care experience found.

### BrightStar Care Westfield & Summit (north-jersey-hp-hp0191600) — 7 obs, evidence_found
- social.search (same method), queries: "BrightStar Care Westfield New Jersey",
  "BrightStar Care Westfield Summit home care", "BrightStar Care Westfield
  recommendation review", "BrightStar Care Westfield NJ experience" → 4 results,
  all from the office's Page "BrightStar Care of Westfield and Summit"
  (facebook.com/BSCWestfield, 930 followers), all provider promotion.
- All verified via facebook-cli post read (public, owner confirmed):
  - fb-nju-004: Page post 2026-11-02, "3 Signs Your Parent May Need Home Care".
  - fb-nju-005: Page post 2026-11-07, "Home Care After a Hospital Stay" (Union County).
  - fb-nju-006: reel 2026-09-06, "The Sunday Night Check-In" ad.
  - fb-nju-007: group post 2025-10-20 in public group "Cranford Neighbors"
    (241154856298929, 37,000 members, OPEN), post-hospital recovery tip graphic,
    phone 908-322-8200.
- Cranford Neighbors --query 'BrightStar' returned 19 posts; 3 named BrightStar:
  - fb-nju-008: 2026-05-04, hiring a Customer Care Manager for the Westfield home
    care team (posted by the office Page).
  - fb-nju-009: 2026-05-05, same hiring notice reposted by a staff member
    ("Christina Marie"); apply link is the office's hireology page
    (brightstarcare-unioncountynj). Recorded as duplicate_of fb-nju-008.
  - fb-nju-010: 2026-04-08, hiring an RN for a one-on-one school case in Union
    County (posted by the office Page) — medical-staffing employment account, not
    in-home senior care.
  - The other 16 posts in the result set were unrelated group content.
- Westfield community groups (facebook-cli groups search 'Westfield NJ'):
  - "Westfield, NJ" (181023518704974, 20,000) --query 'BrightStar' → 0; --query
    'home care' → 0.
  - "The Westfield Southsider" (279566962648341, 3,000) --query 'BrightStar' → 0.
  - "Westfield N.J." (1684527545090329, 2,000) --query 'BrightStar' → 0.
  - "Westfield, New Jersey" (350063394439382, 6,000) --query 'BrightStar' → 0.
  - "Westfield Football Alumni" (582498992526925, 214) not searched — alumni group,
    not a community discussion surface.
  - "Union County Residents Forum" --query 'BrightStar' → 0.
- Page rating: browser.open of facebook.com/BSCWestfield returned a stub only
  (name, URL, professional account, 932 followers), no rating block or reviews.
  Aggregate candidate → NOT VISIBLE, values blank.
- Out of scope, NOT recorded: a care.com review snippet naming BrightStar Westfield
  (a reviewer praising a caregiver for a husband with Alzheimer's) — care.com is not
  Facebook, so it is outside this run's evidence surface. Noted here only so a
  human reviewer knows it exists.
- No family care experience found on Facebook.

### BAYADA Union County (north-jersey-hp-hp0015320) — 3 obs, ambiguous_only
- social.search (same method), two rounds:
  - Round 1 queries: "BAYADA Union County Westfield New Jersey", "BAYADA Westfield NJ
    home care", "BAYADA Union County recommendation review", "BAYADA Westfield NJ
    experience" → 1 result: the June 18, 2026 BBQ carousel on the Page "BAYADA Home
    Health Care, Union, NJ" (facebook.com/BAYADAUNIONOFFICE, 420 followers).
  - Round 2 queries: "BAYADA Home Health Care Union NJ", "BAYADA Union office New
    Jersey", "BAYADA Westfield Union County" → 18 results; only 2 from the Union
    Page (the same BBQ carousel + a June 24, 2026 BBQ reel). The rest were other
    BAYADA offices (Vineland, Mercer, Moorestown, Cherry Hill, Camden County,
    Pennsauken, Deptford, Live-In Services Southern NJ), a NJ Senate Democrats visit
    to an unnamed BAYADA facility, and unrelated political posts. None transferred.
- Posts verified via facebook-cli post read (public, owner confirmed):
  - fb-nju-011: carousel post 2026-06-18 (post_id 1948624632743066), "UNI Team"
    Annual BBQ celebrating home health aides. PROBABLE, not exact: the Page name
    "BAYADA Home Health Care, Union, NJ" does not resolve between Union County (the
    Westfield seed office) and the separate BAYADA presence at 324 Chestnut St,
    Union; no address or phone appears in the post. needs_human_review=true.
  - fb-nju-012: the sole comment reported on that post by the search index —
    "Terrible decision when we called Bayada." UNRESOLVED. facebook-cli
    `post comments read --post-id 1948624632743066 --limit 20` returns 0 comments
    under every invocation, and the post read itself reports comments: 0, so the
    comment could not be opened directly. Staged with the retrieval caveat in
    match_reason; a human must confirm it on the live post before any use. The
    commenter names no office. needs_human_review=true.
  - fb-nju-013: reel 2026-06-24 (reel 1803147877724810), same UNI Team Annual BBQ,
    aides interviewed on camera. PROBABLE for the same page-identity reason.
    needs_human_review=true. Same event as fb-nju-011, distinct post.
- Community groups: "Westfield, NJ" --query 'BAYADA' → 0. "Cranford Neighbors"
  --query 'BAYADA' → 2 posts, both loose matches with no BAYADA content in the
  visible text (a haircut request for grandparents; an ISO caregiver post for a
  mother with dementia, 2025-06-22 — no agency named; discovery-lane material, not
  recorded here). "Union County Residents Forum" --query 'BAYADA' → 0.
- Page rating: browser.open of facebook.com/BAYADAUNIONOFFICE returned a stub only
  (name, URL, professional account, 417 followers), no rating block or reviews.
  Aggregate candidate → NOT VISIBLE, values blank. Page identity itself is
  ambiguous — see fb-nju-011.
- No family care experience attributable to the Westfield office.

## Community pages/groups checked (all, including zero results)

- Springfield: "What's happening in Springfield NJ" (286116885538992, 6,000);
  "Springfield NJ Neighbors (Union County)" (643761569304974, 5,000);
  "I Love Living in Springfield NJ" (1232920610066047, ~1,000, CLOSED — not searched);
  "Springfield NJ Dads" (356943244392715, 741, membership-restricted — not searched);
  "Springfield Township, Burlington County, New Jersey" (1865593610928070) — wrong
  county, not searched.
- Union: "Union, NJ Residents Forum" (146324565519435, 28,000); "Union, NJ
  Neighborhood Chat" (499305033541998, 13,000); "Union NJ Memories"
  (2432983280374884, 279) and "Union New Jersey, Then and Now" (237232393106108,
  2,000) found in search but not queried (nostalgia/history groups, no care
  discussion expected — noted, not searched).
- Union County: "Union County Residents Forum" (510486929060528, 2,000).
- Westfield: "Westfield, NJ" (181023518704974, 20,000); "The Westfield Southsider"
  (279566962648341, 3,000); "Westfield N.J." (1684527545090329, 2,000);
  "Westfield, New Jersey" (350063394439382, 6,000); "Westfield Football Alumni"
  (582498992526925, 214 — not searched, alumni group).
- Cranford: "Cranford Neighbors" (241154856298929, 37,000, PUBLIC/OPEN).

## Blocks and access limits

- No public Facebook Page found for Visiting Angels Union (Springfield office).
- CLI `profile info` for the HomeWell Page returned HTTP 403 "Profile Not Accessible".
- Browser reads of all three found Pages (HomeWell, BSCWestfield, BAYADAUNIONOFFICE)
  return stubs only — no rating block, reviews tab, or address. Ratings are
  NOT VISIBLE for all four seeds.
- facebook-cli returns 0 comments on the BAYADA June 18 post although the search
  index reports 1 comment (fb-nju-012 caveat). Same enumeration limit seen in the
  earlier Harbor follow-up (Lantern Hill).
- Facebook CLI cannot enumerate an unmanaged Page's timeline or Recommendations tab;
  only posts surfaced by social.search / group queries were reachable.
- Closed/membership-only groups were not searched (see per-provider sections).
- "Union NJ Memories" and "Union New Jersey, Then and Now" were not queried
  (nostalgia groups).

## Name variants and exclusions

- Visiting Angels: "VisitingAngelsNJSeniorCare" is the Burling-Mercer franchise
  (HP0107200) — excluded, not transferred. "Linda Visiting Angels" personal profile
  noted in an earlier run as friend-gated (403) — not used.
- BAYADA: other offices excluded — Vineland, Mercer, Moorestown, Cherry Hill,
  Camden County, Pennsauken, Deptford, Live-In Services Southern NJ, BAYADA
  Pediatrics (Cranford, 6 Commerce Dr), BAYADA Cranford home health (11 Commerce
  Dr), and the separate 324 Chestnut St, Union presence. A NJ Senate Democrats post
  about a visit to an unnamed BAYADA facility was excluded (no location named).
- BrightStar: no other BrightStar location surfaced; the Summit name is the same
  office (Westfield & Summit).
- HomeWell: no other HomeWell NJ location surfaced in Facebook search.

## Files written

- scratch/union-observations.csv — 13 rows (fb-nju-001 to fb-nju-013)
- scratch/union-coverage.csv — 4 rows (one per seed)
- scratch/union-aggregate-candidates.csv — 4 rows, all NOT VISIBLE, blank values
- scratch/union-notes.md — this file
