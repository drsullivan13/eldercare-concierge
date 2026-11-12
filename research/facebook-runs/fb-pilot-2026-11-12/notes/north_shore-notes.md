# North Shore run notes — fb-pilot-2026-11-12

Researcher notes per provider: queries run, groups/pages checked, blocks, ambiguities, name variants tried. Run date 2026-11-12. Protocol v0.1.

## 1. abc-home-healthcare — ABC Home Healthcare Professionals, Wakefield (staffing/home care)

Queries run:
- social.search (facebook, since=2024-11-12, top=25): "ABC Home Healthcare Professionals Wakefield", "ABC Home Healthcare Professionals reviews", "ABC Home Healthcare Wakefield Massachusetts recommendation", "ABCHHP home care experience" — 0 results.
- social.search (facebook, no date filter, top=25): "ABC Home Healthcare Professionals", "ABC Home Healthcare Wakefield", "ABC Home Healthcare Professionals Massachusetts" — 50 results, mostly noise.
- browser.search: "ABC Home Healthcare Professionals Wakefield MA Facebook page" — confirmed Page URL facebook.com/abchomehealthcareprofessionals; address 233 Albion St, phone (781) 245-1880 match catalog.
- facebook-cli groups search --keywords "North Shore caregivers senior living Massachusetts" — found public group "North Shore Resources for Seniors" (id 1410738586135083, ~1,000 members, OPEN). Group rules include "What's shared in the group should stay in the group" and "No negative reviews of local businesses" — noted; only public-group search used.
- facebook-cli groups posts --group-id 1410738586135083 --query "ABC Home Healthcare" — 10 results, all general home-care/advocacy posts, none naming ABC.

Ambiguities / variants:
- A similarly named Maryland company, ABC Home Solutions / Absolute Best Care Home Solutions (abchs.org, phone 443-736-7823), dominates name-search results. Different entity; excluded from observations.
- "ABC Home Healthcare and Senior Services" (Pacifici post, 2026-08-24) — name differs from catalog; no town/address given. Recorded as unresolved candidate fb-nsh-001.
- A staff hiring post by Neesha Bierma ("abc home healthcare", 2026-10-05) was cross-posted to an Idaho community group ("Life In Idaho Falls! (SE Idaho)", public) and another group at the same timestamp; no location ties it to the Wakefield agency, so it was NOT recorded as a match.
- Provider's own Page posts in the sample are promotion/recruitment (staff spotlight, respite-care graphic, sign-on bonus ad, AgeSpan partnership). No resident/family care accounts found in the retrieved sample.
- The CLI cannot list posts of a Page the account does not manage; Page content assessed only via search results.

Blocks: none. Private groups: none searched for this provider.

## 2. all-care — All Care VNA, Hospice and Private Care, Lynn (home-health)

Queries run:
- social.search (facebook, since=2024-11-12, top=25): "All Care VNA Lynn Massachusetts", "All Care VNA Hospice Private Care review", "All Care VNA Lynn recommendation", "All Care visiting nurse Lynn experience" — 1 result (Marblehead thread).
- social.search (facebook, no date filter, top=25): "All Care VNA", "All Care Hospice Lynn", "All Care VNA Hospice" — 7 results; same Marblehead thread plus Alliance Home Care VNA (Woburn) noise.
- browser.search: "All Care VNA Hospice Private Care Lynn MA Facebook page" — confirmed Page URL facebook.com/allcarevnahospice; address 210 Market St and phone (781) 598-2454 match catalog.
- facebook-cli groups details 116815719615416 — "Anything Marblehead (except politics)", public (OPEN), ~7,000 members. Rules include "What's shared in the group should stay in the group" — noted; content is public.
- facebook-cli post read + post comments read on the Marblehead thread (2026-01-19) — verified two comments recommending All Care VNA and Hospice in Lynn; recorded as one observation (fb-nsh-003), second comment endorses the first.
- facebook-cli groups posts --group-id 1410738586135083 --query "All Care" — no All Care mentions; general posts only.

Ambiguities / variants:
- Alliance Home Care VNA (Woburn, alliancevna.com) is a different agency and dominates broader "All Care VNA" searches; excluded.
- VNA Care (Worcester, vnacare.org) is a different agency; excluded.
- Provider Page posts outreach/event content (e.g. 2026-10-30 health-fair photo); no resident/family care accounts found in the retrieved sample.
- Lead for later providers: general assisted-living advice thread in North Shore Resources for Seniors (2026-03-28, 63 comments, permalink/2141009563107978/) may name Brooksby Village or Kaplan Estates — check its comments under providers 4/5.

Blocks: none. Private groups: none searched for this provider.

## 3. cms-225433 — ABERJONA REHABILITATION AND NURSING CENTER, Winchester (nursing-home)

Queries run:
- social.search (facebook, since=2024-11-12, top=25): "Aberjona Rehabilitation Nursing Center Winchester", "Aberjona nursing home Winchester review", "Aberjona rehab Winchester recommendation", "Aberjona Winchester MA experience" — 1 result (Napoleon Room photo post, 2025-12-16, reviewed and NOT recorded: shows a named resident with health details, no care-experience content).
- social.search (facebook, no date filter, top=25): "Aberjona", "Aberjona Rehabilitation", "Aberjona Winchester nursing" — 5 results; river-history posts (irrelevant), a HELPIS teddy-bear delivery post (2026-02-13, not a care account), a wound-care award post (2026-02-22, staff celebration only).
- browser.search: "Aberjona Rehabilitation and Nursing Center Winchester MA Facebook page" — confirmed Page facebook.com/AberjonaNursing (~210 followers); address 184 Swanton St and CMS CCN 225433 match catalog.
- facebook-cli post read + post comments read on two Page posts: retirement celebration (2026-09-12, post 1059752243323322) and survey announcement (2026-06-20, post 989925526972661). Three family observations recorded (fb-nsh-004/005/006).
- facebook-cli groups posts --group-id 1410738586135083 --query "Aberjona" — no results.
- facebook-cli groups search "Winchester Massachusetts community" — found public "Winchester, MA" group (id 1636041573391727, ~8,000 members, OPEN, no rules). groups posts --query "Aberjona" — 3 results: river/turtle posts and a 2020 gift-program mention; no care accounts.

Unverified secondary-source mention (NOT an observation): a web-search summary of the 2026-06-20 thread described a negative comment about delayed pain medication after a knee replacement. The comment was not present in the comments retrieved via facebook-cli on 2026-11-12 (9 of 10 comments returned, no paging cursor). Flagged in coverage notes for human review; do not treat as verified.

Blocks: none. Private groups: none searched for this provider.

## 4. lifeplan-brooksby-village — Brooksby Village, Peabody (life-plan)

(pending)

## 4. lifeplan-brooksby-village — Brooksby Village, life-plan, Peabody, 100 Brooksby Village Drive — CHECKPOINT DONE
- Queries: social.search facebook since=2024-11-12, top=25 — "Brooksby Village Peabody", "Brooksby Village Peabody review", "Brooksby Village recommendation", "Brooksby Village experience" (26 results returned, file read in full).
- Provider Page: facebook.com/BrooksbyVillage (~1.8K followers). CLI cannot list an unmanaged Page's posts; two reels read directly via post read --url (both public, verified).
- Groups: "North Shore Resources for Seniors" (1410738586135083, OPEN, ~1,000 members) searched for "Brooksby" — returned the 2026-03-28 assisted-living advice thread (63 comments claimed; 32 top-level comments read across 2 pages; nested replies not retrieved). "The People Of Peabody" (667047019191593, OPEN, ~2,000 members) searched for "Brooksby Village" — 16 results, loose/noisy matches, none mentioning Brooksby in the visible snippet; one bare "Sharing" post (2026-06-24) could not be verified as Brooksby-related — not recorded. "Peabody, MA Community Group" (203429400983110, CLOSED, ~1,000 members) — NOT searched: rules ("Be kind and courteous", "No hate speech or bullying", "No promotions or spam", "This is not a for sale/buy group") do not mention research/reuse; membership alone is not permission.
- Name variants / exclusions: Brooksby Farm is a DIFFERENT entity (city farm, 54 Felton St, Peabody) — all farm posts excluded. Brooksby Village's separately licensed nursing unit (Continuing Care at Brooksby Village, 400 Brooksby Village Drive) is NOT in the batch — no reviews transferred between campus and nursing unit.
- Observations: fb-nsh-007 (family firsthand, father at Brooksby, mixed, billing/personal_care/admission_transition), fb-nsh-008 (Diane R. provider-produced reel, medical services), fb-nsh-009 (Carman G./Jane & Celso provider-produced reel, touring), fb-nsh-010 (tour pricing, $100k starting), fb-nsh-011 (recommendation without detail). fb-nsh-012 (Kaplan Estates, same comment as fb-nsh-011) found here; counts toward Kaplan coverage.
- Not recorded: Peabody Area Scanner EMS-dispatch post (2026-10-07) — scanner report, no care account, health info about an unidentified person. Ann Marie Crowell post (2025-09-12) — pre-move, seeking a caregiver, no care account. TJ Welch mailer post (2026-06-17) — reaction to marketing. Advice-thread comment about poor care at four unnamed top-rated North Shore facilities — no provider named, unattributed context only. Ken Kocher post — commenter mentions a relative living at Brooksby, no detail.
- Blocks: none. Serious allegations: none flagged.

## 5. ma-alr-harriett-and-ralph-kaplan-estates — Harriett and Ralph Kaplan Estates, assisted-living, Peabody, 240 Lynnfield St. — CHECKPOINT DONE
- Queries: social.search facebook since=2024-11-12, top=25 — "Kaplan Estates Peabody", "Harriett and Ralph Kaplan Estates", "Kaplan Estates Peabody review", "Kaplan Estates assisted living experience" (2 results: one irrelevant realtor reel, one tour reel).
- Provider Page: no standalone Kaplan Estates Facebook Page URL found via web search (operator is Chelsea Jewish Lifecare, Peabody Campus). CLI cannot list an unmanaged Page's posts in any case.
- Groups: "North Shore Resources for Seniors" (1410738586135083, OPEN) searched for "Kaplan" — only the 2026-03-28 advice thread (fb-nsh-012, found during Brooksby review). "The People Of Peabody" (667047019191593, OPEN) searched for "Kaplan Estates" — 21 results, all loose/noisy matches, none mentioning Kaplan Estates in the visible snippet.
- Campus note: Kaplan Estates shares 240 Lynnfield St with the Jeffrey & Susan Brudnick Center for Living (skilled nursing, rehabilitation, memory care) and the Shapiro-Rudolph Adult Day Health Center. The tour observation (fb-nsh-013) covers Kaplan Estates' assisted-living and memory-care spaces only; no accounts transferred between the assisted-living community and the nursing center.
- Name exclusions: Kaplan Cycles (Facebook page about a motocross property) is unrelated; a realtor reel about a Cape home at 52 Aberdeen Ave, Peabody is unrelated.
- Observations: fb-nsh-012 (recommendation without detail, advice thread), fb-nsh-013 (guided tour by a local business owner, 2026-03-17, positive, cleanliness/dining/activities). The same tour was also posted by the author on Instagram (instagram.com/reel/DV_HzOUkYAk/) — not counted as a separate observation.
- Not recorded: no firsthand resident or family care accounts were found in the retrieved sample.
- Blocks: none. Serious allegations: none flagged.
