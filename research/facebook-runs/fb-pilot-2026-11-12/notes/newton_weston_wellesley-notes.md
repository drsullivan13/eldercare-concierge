# Newton / Weston / Wellesley — researcher notes
Run: `fb-pilot-2026-11-12`, protocol v0.1. Collection window: 2026-11-12, ~11:20–11:23 UTC.
Researcher: Facebook researcher subagent, using Dan Sullivan's connected Facebook account.
No posts, comments, messages, group joins, or access requests were made. No private-group
material was searched, copied, or summarized.

## Shared sources and limits

- `social.search` (platform=facebook, since=2024-11-12 unless noted, top=25) per provider.
  Results are selected/personalized, not an exhaustive review history.
- `browser.search` per provider to locate the official Facebook Page URL.
- `facebook-cli groups search` surfaced five candidate groups; the two relevant ones were
  checked with `groups details`:
  - "Boston, Massachusetts Caregivers" (id 1136279117648226) — visibility OPEN / public,
    no rules listed. Searched within via `groups posts --query` per provider.
  - "Massachusetts Seniors Lifestyle" (id 2018806938376767) — visibility CLOSED / private.
    Its rules include "What's shared in the group should stay in the group", so permission
    to export/reuse is not granted. It was NOT searched and nothing was copied from it.
    Recorded as an access limitation on every coverage row.
  - "Greater Boston Senior Service Providers (GBSSP)" (id 2163404520791370) — described in
    its own listing as a private networking group for professionals; not searched (no
    resident/family discussion expected; private).
  - "North Shore Resources for Seniors" and "Merrimack Valley Seniors And Caregiver Group"
    are outside this market; not searched.
- Hard limit throughout: `facebook-cli` cannot list an unmanaged Page's posts or a Page's
  Recommendations/Reviews. Where a provider has an official Page, only posts surfaced by
  search could be read. This is the largest coverage gap in this batch — for Lasell Village
  and Waterstone at Wellesley in particular, Page timelines and Facebook recommendations
  could not be enumerated.

## Per-provider

### 1. cms-225656 — Campion Health & Wellness, Inc (nursing-home, Weston, 319 Concord Road)
- Queries: social.search (since 2024-11-12) x4 queries; social.search no-date-filter x3
  queries incl. variant "Campion Center"; browser.search for Facebook Page; groups posts
  query "Campion" in Boston, Massachusetts Caregivers.
- Results: 0 relevant posts in both social.search runs. No public Facebook Page found
  (directory listings only: Seniorly, CareScout, MyCaringPlan). One group hit was an
  unrelated Serenelink HealthCare Group weekend self-care video (2026-10-10), read via
  `post read` to confirm irrelevance.
- Name variants tried: "Campion Health & Wellness", "Campion Center" (the facility is also
  known as Campion Center, a Jesuit residence). Neither surfaced Facebook discussion.
- Coverage: searched_no_relevant_result, 0 observations.

### 2. lifeplan-lasell-village — Lasell Village (life-plan, Newton, 120 Seminary Avenue)
- Queries: social.search (since 2024-11-12) x4 queries; second social.search x4 queries
  (tour / resident-life / Auburndale variants); browser.search for Facebook Page;
  groups posts query "Lasell Village" in Boston, Massachusetts Caregivers.
- Results: 2 posts in first search — a Power Rankings "retirement towns" ranking graphic
  (2026-06-28) naming Lasell Village with no resident/family account, and a real-estate
  open-house flyer for 17 Lasell Street (street-name match, not the provider). Second
  search: 0 posts. Group search: 4 hits, all false positives (relocation intro,
  childcare/senior-care job post, two Flourishing Home Care LLC shares with no text;
  the two empty-content posts were read via `post read` to confirm).
- Official Page found: https://www.facebook.com/lasellvillage/ (via Boston Voyager
  listing). Timeline not enumerable via CLI — recorded as access limit.
- The Power Rankings graphic was reviewed and excluded, not recorded: no account of life
  or care, no tour, no recommendation. No Lasell House (nursing unit, same address)
  material was used or transferred to the campus record.
- Coverage: searched_no_relevant_result, 0 observations.

### 3. ma-alr-waterstone-at-wellesley — Waterstone at Wellesley (assisted-living, 23 Washington St.)
- Queries: social.search (since 2024-11-12) x4 queries; second social.search x4 queries
  (recommend / tour / family variants); browser.search for Facebook Page; `post read` +
  `post comments read` on the 2026-08-06 High Tea post; groups posts query "Waterstone".
- Results: official Page https://www.facebook.com/waterstoneatwellesley/ (6.7K followers).
  Social search surfaced only provider-posted activity calendars (2026-11-05, 2026-08-04).
  Web search surfaced provider posts: New Year celebration video (2026-01-02), High Tea
  carousel (2026-08-06), Denmark lecture photo (2026-08-28). The High Tea post's 3 visible
  comments are brief warm remarks with no care, tour, or recommendation content.
  Second social.search: 0 posts. Group search: 0 hits.
- The provider's own "review us" page (waterstonesl.com) confirms Facebook Recommendations
  exist for this community, but the CLI cannot list them — recorded as an access limit and
  the main follow-up gap for this provider.
- Ambiguity noted: directory listings give the address as 23 & 27 Washington Street;
  catalog says 23 Washington St. Both refer to the same community; no match confusion.
- Coverage: searched_no_relevant_result, 0 observations.

### 4. mgb-home-care — Mass General Brigham Home Care (home-health, Newton, 95 Wells Ave Ste 320)
- Queries: social.search (since 2024-11-12) x4 queries; browser.search for Facebook Page;
  groups posts query "Mass General Brigham Home Care".
- Results: 10 posts in social.search. Three are union advocacy sources about MGB Home Care
  clinicians, recorded as employment observations fb-nww-001 (MNA reel, 2026-06-30),
  fb-nww-002 (MNA reel, 2026-08-13), fb-nww-003 (Mgbhomecare MNA graphic, 2026-11-01).
  All three are flagged needs_human_review=true; two carry safety_allegation concern_type
  (staff-reported unsafe caseload claims) and one service (alleged supply reductions).
  All are staff-reported claims in advocacy material, not independently verified, and all
  concern the same July 2026 labor dispute — they must not be read as three independent
  signals about care quality.
- Excluded, with reasons: two copies of the same MGB Healthcare at Home PT recruitment
  flyer (provider promotion); Only In Boston strike announcement 2026-07-07 (labor news,
  not an experience); MNA board-wealth carousel 2026-06-29 (advocacy, not an experience);
  CareSync stock clinical photo 2026-10-27 (different entity); MGB Health Plan transport
  reel 2026-11-10 (different entity); staged caregiving photo on the main MGB page
  2026-08-12 (provider promotion, no account). A 2026-03-18 MGB page post praising "Home
  Hospital" was not transferred — Home Hospital is a distinct program from MGB Home Care.
- Group search: 6 hits, all false positives. One caregiver advice post (2026-08-01) was
  read in full via `post read`: it describes serious allegations at an unnamed rehab
  facility, names no provider, and is not attributable to any catalog provider, so it was
  not recorded. No identifying health detail from that post is reproduced here.
- No separate MGB Home Care Facebook Page was found; only the main Mass General Brigham
  page exists, and its timeline is not enumerable via CLI.
- Coverage: evidence_found, 3 observations. No resident/family account of receiving home
  care was found in the searched sources.

### 5. north-river — North River Home Care (home-care, Wellesley, 170 Worcester St Ste 201)
- Queries: social.search (since 2024-11-12) x4 queries; social.search no-date-filter x3
  queries (Norwell / NRHC / South Shore variants); browser.search for Facebook Page;
  groups posts query "North River".
- Results: 0 posts in both social.search runs. No provider Facebook Page URL surfaced.
  Group search: 21 hits, all keyword noise ("North Shore", "North End", other agencies'
  job ads). None about North River Home Care.
- Context: press release (EINPresswire, Oct 14, 2026) confirms the Wellesley office at
  170 Worcester Street, Suite 201 opened Oct 14, 2026 — under a month before this run —
  joining the main office in Norwell. The newness of the branch plausibly explains the
  thin Facebook footprint for Wellesley. The release lists Facebook among the agency's
  social channels but gives no Page URL.
- Coverage: searched_no_relevant_result, 0 observations.

## Blocks and ambiguities (batch-wide)

- No blocks, rate limits, or access denials were encountered. No content was removed or
  inaccessible in a way that changed a result.
- The private-group rule (stay-in-group) for Massachusetts Seniors Lifestyle is the only
  permission-based exclusion; it affects all five providers equally.
- The CLI's inability to enumerate unmanaged Page timelines / Recommendations is the main
  methodological gap; it bites hardest for Lasell Village and Waterstone at Wellesley,
  both of which have active official Pages.
- No serious allegation against a catalog provider was found in resident/family material.
  The two safety_allegation flags (fb-nww-001, fb-nww-003) are staff-reported caseload
  claims in union advocacy material, flagged for human review as reported allegations,
  not confirmed events.
- No duplicates were recorded as observations. Known duplicate promotional material: the
  MGB Healthcare at Home PT recruitment flyer appears twice (group post and author post);
  not recorded.
