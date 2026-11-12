# Boston market — run notes (fb-pilot-2026-11-12, protocol v0.1)

Collection date: 2026-11-12. Searcher: Facebook researcher subagent, using Dan Sullivan's connected Facebook account. No posts, comments, messages, group joins, or access requests made. Retrieval times are UTC.

## Shared sources

- `social.search`, platform=facebook, since=2024-11-12, top=25 per provider (neutral queries only).
- `browser.search` to locate each facility's public Facebook Page; `facebook-cli post read --url` to verify specific public posts. The CLI cannot list an unmanaged Page's posts — only posts surfaced by search were read. Recorded as an access limit in coverage.
- Public group checked: "Boston, Massachusetts Caregivers" (id 1136279117648226), visibility OPEN, no rules listed. Searched with `groups posts --query` per facility name. Note: its relevance search is loose — the "Boston Home" query returned generic home-care/housekeeping/job ads matched on the word "home", not on the facility.
- Private groups NOT searched (permission unclear; membership alone is not permission):
  - "Massachusetts Seniors Lifestyle" (id 2018806938376767), CLOSED. Rules include "Respect everyone's privacy" — "What's shared in the group should stay in the group." No research/reuse permission; nothing copied or summarized.
  - "Greater Boston Senior Service Providers (GBSSP)" (id 2163404520791370), CLOSED, professional networking group, no rules listed. Permission unclear; nothing copied or summarized.

## Provider 1 — cms-225434 | BOSTON HOME, INC (THE) | 2049 Dorchester Ave, Boston

- Queries: social.search ("Boston Home Dorchester Avenue Boston nursing home" / "Boston Home Inc Dorchester nursing home experience" / "Boston Home Boston recommendation review"); browser.search for Facebook Page; group query "Boston Home".
- Observations: fb-bos-001 (Sen. Nick Collins tour post, 2026-05-19, visit 2026-05-18), fb-bos-002 (Rep. Brandy Fluker Oakley tour post, 2026-07-02).
- Ambiguity: fb-bos-002 may describe the same May 2026 visit as fb-bos-001 (same $50,000 check, same officials) posted later; flagged needs_human_review=true, independence unestablished. Not marked as a duplicate — not established as one.
- Excluded: social.search result about The Bostonian Nursing & Rehabilitation Center (337 Neponset Ave, Dorchester) — different facility; its commenter's praise of that facility was not transferred.
- No dedicated public Facebook Page found for the facility via web search; it is tagged @thebostonhome in the Brandy post. Unmanaged Page posts not listable via CLI.
- No resident/family care accounts found in this run; both observations are official tour visits.

## Provider 2 — cms-225469 | LAUREL RIDGE REHAB AND SKILLED CARE CENTER | 174 Forest Hills St, Boston

- Queries: social.search ("Laurel Ridge Rehab Forest Hills Boston" / "Laurel Ridge Jamaica Plain nursing home experience" / "Laurel Ridge Rehab skilled care recommendation") — zero results; browser.search for Facebook Page; group query "Laurel Ridge" — zero results.
- Observations: fb-bos-003 (facility-published testimonial graphic, family member re aunt, 2026-10-15), fb-bos-004 (facility-published testimonial graphic, patient Ms. Pasqua, short-term rehab, 2026-09-17), fb-bos-005 (recommendation comment on the fb-bos-004 thread, 2026-09-17).
- Name variant: facility also presents on Facebook as "Laurel Ridge Center for Health & Rehabilitation" (operator: National Health Care Associates). Both Pages used; match is exact on name + address (174 Forest Hills St) via laurelridgerehab.com.
- All observations are facility-published or thread material; no independent resident/family post found. Testimonials are recorded as provider_promotion with the underlying speaker's relationship preserved, not as independent firsthand posts.
- No blocks encountered.

## Provider 3 — cms-225540 | German Center for Extended Care | 2222 Centre St, Boston

- Queries: social.search ("German Center for Extended Care Boston" / "German Centre West Roxbury nursing home experience" / "German Center Centre Street Boston recommendation"); browser.search for Facebook Page; group query "German Center".
- Observation: fb-bos-006 (Sen. Mike Rush tour post, 2026-02-18) — recorded as an UNRESOLVED candidate with provider_id BLANK. The caption, verified via facebook-cli, says the visit was to the "German Center Edelweiss Village assisted living in West Roxbury" — the assisted-living unit, not the extended-care nursing unit (cms-225540). Campus and nursing unit are separately operated care entities; the account must not be transferred to the nursing-home record. needs_human_review=true.
- Directory listings confirm the 2222/2220 Centre St campus has separately listed units (extended care nursing, assisted living, memory care / Schrafft Pavilion, adult day health).
- Other material: German Aid Society of Boston posted a holiday event flyer at the German Centre (2026-10-27) — a community event notice, not a care account; not recorded as an observation.
- No resident/family account about the extended-care nursing unit was found in this run.

## Provider 4 — cms-225654 | The Benjamin Healthcare Center | 120 Fisher Ave, Boston

- Queries: social.search ("Benjamin Healthcare Center Boston" / "Benjamin Health Care Fisher Avenue Roxbury experience" / "Benjamin Healthcare Center Boston recommendation review"); browser.search for Facebook Page; group query "Benjamin" — zero results.
- Observation: fb-bos-007 (Allaire Health Services announcement, 2026-08-25, verified via facebook-cli) — operator announcement that The Benjamin joined Allaire Health Services as part of its Massachusetts expansion. Recorded as provider_promotion, exact match on name + 120 Fisher Ave address. This is an ownership/operator-change flag, not a care account. Same graphic/caption also posted the same day by The Center for Rehabilitation & Nursing at Washington Township page — noted as duplicate publication, not a second observation.
- The Benjamin has its own Facebook Page with promotional videos (2026-10-15 "Refined Living" tour video; 2026-10-16 staff luncheon video) — no resident/family accounts in them; noted here, not recorded as observations.
- No resident/family care account was found in this run.

## Provider 5 — cms-225759 | RECUPERATIVE SERVICES UNIT-HEBREW REHAB CENTER | 1200 Centre St, Boston

- Queries: two rounds of social.search (round 1: "Hebrew Rehabilitation Center Roslindale Boston" / "Hebrew Rehab Center Centre Street Boston experience" / "Hebrew SeniorLife Roslindale recommendation review" — zero results; round 2: "Hebrew Rehab Roslindale family experience" / "Recuperative Services Unit Hebrew Rehabilitation Center" / "Hebrew SeniorLife Boston review recommendation" — 1 result); browser.search for Facebook Page; group query "Hebrew" — one irrelevant companion-services ad.
- Observation: fb-bos-008 (Hebrew SeniorLife BBQ post, 2026-08-19, verified via facebook-cli) — provider-published post about annual floor cookouts at Hebrew Rehabilitation Center - Boston. Recorded as a PROBABLE candidate with provider_id BLANK: it names HRC Boston generally and the 1200 Centre St address matches, but it does not identify the Recuperative Services Unit, so it cannot be attributed to cms-225759 specifically. needs_human_review=true.
- EXCLUDED: a testimonial graphic from "Hebrew Center for Health & Rehabilitation" (posted 2026-11-06) — verified via web search as a different facility in West Hartford, CT (1 Abrahms Blvd, hebrewcenterrehab.com). Similar name, different facility and state; not recorded.
- Hebrew SeniorLife's Page also posts about affordable housing initiatives — unrelated to this unit; not recorded.
- No resident/family account about the Recuperative Services Unit was found in this run.

## Blocks and limitations (whole batch)

- No posts, comments, messages, group joins, or access requests were made at any point.
- No blocks, rate limits, or access denials were encountered on public sources.
- facebook-cli cannot list an unmanaged Page's posts — only posts surfaced by search were read. This is the main coverage gap for all five providers.
- Two private groups were not searched (see "Shared sources" above): "Massachusetts Seniors Lifestyle" (rules state group content stays in the group) and "Greater Boston Senior Service Providers (GBSSP)" (permission unclear). Nothing was copied or summarized from either.
- social.search is a selected/personalized index, not an exhaustive review history; zero-result searches do not mean no experiences exist.
- No serious allegations were found in this batch. No observation has concern_type other than "none".
