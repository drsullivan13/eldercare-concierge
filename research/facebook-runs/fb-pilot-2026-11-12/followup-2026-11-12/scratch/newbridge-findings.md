# NewBridge follow-up findings — run fb-pilot-2026-11-12

Review date: 2026-11-12. Reviewer: follow-up pass on rows fb-ssh-002 through
fb-ssh-035 (34 rows found during the NewBridge on the Charles search).
Sources re-read on 2026-11-12 via facebook-cli (public sources only, no joins,
messages or private material). No CSV was edited; this file proposes changes
for the parent to apply to the amended copies.

## Method and verification standard

Each recorded comment was re-read from the source itself (post read for the
parent post, comments read for the full top-level comment list). Comment text
is paraphrased here; only short identifying phrases are quoted. No commenter
names are recorded.

Entity verdicts use this standard:

- **Verified entity** — the comment itself explicitly describes the service or
  unit in its own words (for example short-term rehab, skilled nursing
  section, rehabilitation facilities, memory/dementia care), or it describes a
  firsthand stay in direct answer to a thread requesting that care level and
  names a comparable facility of that type. The verified entity is recorded
  for a follow-up assignment; it is NOT proposed for this batch, whose
  assignment is the original 20 IDs.
- **Probable entity (thread context only)** — the comment names NewBridge only
  (or name plus a superlative) in a thread requesting a specific care level.
  The intended service is indicated by the thread, but the commenter did not
  describe it. Not verified.
- **Exact (unchanged)** — the collector's exact attribution stands; only
  metadata is corrected.

Threads re-read in full (top-level comments):

- Official NewBridge Page post, Director of Community Life, 2026-06-27
  (8 comments, all read) — fb-ssh-002.
- Official NewBridge Page post, Club and Committee Fair, 2026-06-30
  (1 comment, read) — fb-ssh-003.
- Group thread 2531799013655921, assisted-living recommendations, 2023-06-28
  (27 comments, all read) — fb-ssh-004 through 008.
- Group thread 2963697150466103, memory-care recommendations, 2025-01-10
  (56 comments, all read) — fb-ssh-009 through 017.
- Group thread 3048619391973878, short-term rehab recommendations, 2025-04-10
  (6 comments, all read) — fb-ssh-018 through 020.
- Group thread 3014557802046704, rehab after hip surgery, 2025-03-09
  (32 comments, all read) — fb-ssh-021 through 029.
- Group thread 2917566545079164, skilled-nursing recommendations, 2024-11-13
  (19 comments, all read) — fb-ssh-030 through 035.

All five group threads are in the public group Everything Local
Dedham/Westwood and Beyond (visibility OPEN, 32,000 members; post visibility
public, verified). The group's Community Code of Conduct asks members to
respect privacy and keep shared content in the group; that is a reuse caution
for any future publication, not a bar on public-source research, and all rows
stay internal_review_pending.

## Reconciliation (task 4)

Coverage reports 34 rows for lifeplan-newbridge-on-the-charles. Reconciled
with explicit IDs after this review:

- **Exact-attributed, provider_id = lifeplan-newbridge-on-the-charles: 8 rows**
  — fb-ssh-002, fb-ssh-003, fb-ssh-004, fb-ssh-005, fb-ssh-006, fb-ssh-007,
  fb-ssh-008, fb-ssh-009. Unchanged in count; two metadata corrections
  (fb-ssh-009 match_reason; fb-ssh-002/003 independence_notes).
- **Candidates, provider_id blank: 26 rows**
  - Probable, campus memory care: 6 — fb-ssh-010, fb-ssh-011, fb-ssh-012,
    fb-ssh-013, fb-ssh-014, fb-ssh-015.
  - Unresolved, verified entity cms-225774 (follow-up candidate): 6 —
    fb-ssh-016, fb-ssh-017, fb-ssh-021, fb-ssh-027, fb-ssh-030, fb-ssh-031.
  - Unresolved, probable cms-225774 on thread context only: 14 — fb-ssh-018,
    fb-ssh-019, fb-ssh-020, fb-ssh-022, fb-ssh-023, fb-ssh-024, fb-ssh-025,
    fb-ssh-026, fb-ssh-028, fb-ssh-029, fb-ssh-032, fb-ssh-033, fb-ssh-034,
    fb-ssh-035.
- 8 + 6 + 6 + 14 = 34. Coverage observations_found = 34. Reconciled.

No row was verified for ma-alr-newbridge-on-the-charles (assisted living,
6000 Great Meadow Road). See the reviewer note on fb-ssh-004 through 008.

## The two metadata corrections

### fb-ssh-009 — source context was wrong

Stored match_reason says the comment is on the official NewBridge Facebook
Page thread. Re-reading proves otherwise: the comment (posted 2025-01-10) is
in group thread 2963697150466103, a memory-care recommendations request in the
public group. The commenter says they have worked for the company for years
and praises the memory-care unit. The stored source_url and thread_url already
point at the group thread and are correct; source_visibility public is
confirmed (group OPEN, post visibility public, verified). Only match_reason
needs correcting (see proposed amendments). The exact attribution to the
life-plan campus is retained as the collector's judgment: the commenter refers
to the campus memory-care unit, and the comment names no address.

### fb-ssh-002 / fb-ssh-003 — not a shared thread

The stored independence_notes say the two share a thread, then add
"(different post)". Post reads confirm they are comments on two different
posts on the official NewBridge Page (owner id 100063471853396, profile
facebook.com/NewBridgeontheCharles, visibility public, verified):

- fb-ssh-002: comment on the 2026-06-27 Director of Community Life post
  (8 comments total). A volunteer account via a JFCS program; the stored
  summary is faithful to the comment text.
- fb-ssh-003: the single comment on the 2026-06-30 Club and Committee Fair
  post. The stored summary is faithful.

They do not share a thread. Only independence_notes needs correcting on both
rows (see proposed amendments). Their stored thread URLs are correct and
distinct.

## Per-row findings

| observation_id | verdict | evidence | remaining uncertainty |
|---|---|---|---|
| fb-ssh-002 | Exact (unchanged) | Comment verified verbatim on the official Page's 2026-06-27 post; volunteer account, campus generally, no licensed unit named. | None on source. Care level unknown, as stored. |
| fb-ssh-003 | Exact (unchanged) | Single comment verified verbatim on the official Page's 2026-06-30 Club Fair post; general campus praise, no unit named. | None on source. Relationship unknown, as stored. |
| fb-ssh-004 | Exact (unchanged) | Comment verified verbatim in the assisted-living recommendations thread; sister resident 1.5 years, staff and care praised; no care level stated in the comment. | Thread context is assisted living, so the ALR (ma-alr-newbridge-on-the-charles) is the likely unit; the comment itself does not state it. Reviewer note only, no change proposed. |
| fb-ssh-005 | Exact (unchanged) | Name-only comment verified verbatim in the assisted-living thread. | Same ALR note as fb-ssh-004; no care level stated. |
| fb-ssh-006 | Exact (unchanged) | Comment verified verbatim; grandmother resident, compared with other grandparents' assisted-living or nursing-home stays; grandmother's own care level not stated. | Same ALR note as fb-ssh-004. |
| fb-ssh-007 | Exact (unchanged) | Comment verified verbatim; geriatric care manager names NewBridge among good assisted-living options. | Same ALR note as fb-ssh-004. |
| fb-ssh-008 | Exact (unchanged) | Comment verified verbatim; mother resident for many years; no care level stated. | Same ALR note as fb-ssh-004. |
| fb-ssh-009 | Exact (unchanged) + metadata fix | Comment verified verbatim in the group memory-care thread (not the Page); staff endorsement praising the memory-care unit. | Comment names no address; exact-to-campus rests on the memory-care unit being a campus residence. |
| fb-ssh-010 | Probable — campus memory care | Comment verified verbatim: mother was at both NewBridge and Benchmark, Benchmark better; no care level stated by the commenter; thread requests memory care. | SNF cannot be ruled out; no unit or address stated. |
| fb-ssh-011 | Probable — campus memory care | Comment verified verbatim: mother resident for years; no care level stated; thread requests memory care. | SNF cannot be ruled out; no unit or address stated. |
| fb-ssh-012 | Probable — campus memory care | Comment verified verbatim: campus cared for the commenter's mother with dementia and also their mother-in-law. Dementia care is explicitly described, so the service is memory care; the unit is not named. | SNF also provides dementia care, so the entity is not established; care_level should read memory care (see amendments). |
| fb-ssh-013 | Probable — campus memory care | Name-plus-superlative comment verified verbatim in the memory-care thread; no detail. | SNF cannot be ruled out; no unit or address stated. |
| fb-ssh-014 | Probable — campus memory care | Comment verified verbatim: care manager explicitly lists NewBridge among memory-care options and notes a long wait list. The service is explicitly memory care (the commenter's own list). | SNF cannot be ruled out; no address stated. Nested replies (4) not retrievable. |
| fb-ssh-015 | Probable — campus memory care | Short negative comment verified verbatim in the memory-care thread; no detail. | SNF cannot be ruled out; no unit or address stated. |
| fb-ssh-016 | Verified — cms-225774 (follow-up candidate) | Comment verified verbatim in the memory-care thread: no direct memory-care experience, but an excellent short-term rehab program, firsthand, with links to the Hebrew Rehabilitation Center rating page and the campus memory-care assisted-living page. The rehab service is explicit and firsthand. | The comment also infers the memory-care unit would meet the same standards; that inference is not experience and is already flagged in the stored summary. |
| fb-ssh-017 | Verified — cms-225774 (follow-up candidate) | Comment verified verbatim in the memory-care thread: no memory-care experience, but the skilled nursing section is excellent. The service is explicit in the comment's own words. | Comment names no address; the SNF is the only NewBridge entity with a skilled nursing section. |
| fb-ssh-018 | Probable — cms-225774 (thread context only) | Name-only comment verified verbatim in the short-term rehab thread. | Comment names no unit or service; the rehab link is the thread's request, not the commenter's words. |
| fb-ssh-019 | Probable — cms-225774 (thread context only) | Negative name-only comment verified verbatim in the short-term rehab thread; no detail or reason stated. | Same as fb-ssh-018; concern behind the statement is unclear, as stored. |
| fb-ssh-020 | Probable — cms-225774 (thread context only) | Name-only comment verified verbatim in the short-term rehab thread. | Same as fb-ssh-018. |
| fb-ssh-021 | Verified — cms-225774 (follow-up candidate) | Comment verified verbatim in the rehab-after-hip-surgery thread: two good stays for the commenter's mother, explicitly compared with Hebrew Rehab in Roslindale, both noted as owned by Hebrew Senior Life. A firsthand stay account answering a rehab request, framed against a rehab facility. | The word rehab does not appear in the comment itself; the rehab framing comes from the thread request and the Hebrew Rehab comparison. |
| fb-ssh-022 | Probable — cms-225774 (thread context only) | Name-only comment verified verbatim in the rehab-after-hip thread. | Same thread-context-only limitation as fb-ssh-018. |
| fb-ssh-023 | Probable — cms-225774 (thread context only) | Name-only comment verified verbatim in the rehab-after-hip thread. | Same as fb-ssh-022. |
| fb-ssh-024 | Probable — cms-225774 (thread context only) | Comment verified verbatim: names NewBridge alongside two other facilities, no detail. | Same as fb-ssh-022. |
| fb-ssh-025 | Probable — cms-225774 (thread context only) | Name-plus-emphatic-endorsement verified verbatim in the rehab-after-hip thread. | Same as fb-ssh-022. |
| fb-ssh-026 | Probable — cms-225774 (thread context only) | Name-only comment verified verbatim in the rehab-after-hip thread. | Same as fb-ssh-022; 7 nested replies not retrievable. |
| fb-ssh-027 | Verified — cms-225774 (follow-up candidate) | Comment verified verbatim in the rehab-after-hip thread: firsthand detailed negative stay account for the commenter's husband (care, food options, broken room window, evening staffing). A stay account answering a rehab request. | The word rehab does not appear in the comment itself; the rehab framing comes from the thread request. |
| fb-ssh-028 | Probable — cms-225774 (thread context only) | Short negative recommendation verified verbatim in the rehab-after-hip thread; no experience described. | Same as fb-ssh-022; no detail stated. |
| fb-ssh-029 | Probable — cms-225774 (thread context only) | Comment verified verbatim: names NewBridge or Hebrew Rehab, rules out two other facilities; no detail. | Same as fb-ssh-022. |
| fb-ssh-030 | Verified — cms-225774 (follow-up candidate) | Comment verified verbatim in the skilled-nursing thread: mother had good care at Newbridge and Hebrew Rehab in Roslindale, and the commenter classifies both as rehabilitation facilities only. The service is explicit in the commenter's own words. | Comment names no address; the SNF is the only NewBridge rehabilitation facility. |
| fb-ssh-031 | Verified — cms-225774 (follow-up candidate) | Comment verified verbatim in the skilled-nursing thread: calls Newbridge the best and notes it is difficult to get in if it is just for rehab. The rehab framing is explicit in the commenter's own words. | Comment names no address. |
| fb-ssh-032 | Probable — cms-225774 (thread context only) | Name-only comment verified verbatim in the skilled-nursing thread. | Same thread-context-only limitation as fb-ssh-018. |
| fb-ssh-033 | Probable — cms-225774 (thread context only) | Name-plus-superlative verified verbatim in the skilled-nursing thread. | Same as fb-ssh-032. |
| fb-ssh-034 | Probable — cms-225774 (thread context only) | Name-only comment verified verbatim in the skilled-nursing thread. | Same as fb-ssh-032. |
| fb-ssh-035 | Probable — cms-225774 (thread context only) | Comment verified verbatim: names Newbridge as one of the best alongside another facility; no detail. | Same as fb-ssh-032; 2 nested replies not retrievable. |

## Proposed amendments

Apply to the amended copies (observations-amended.csv). No provider_id is
proposed for any row: this batch's assignment is the original 20 IDs, and
cms-225774 is not among them. Verified entities are recorded in match_reason
and in the follow-up assignment list below, not as provider_id writes.

| observation_id | field | current value | proposed value | reason |
|---|---|---|---|---|
| fb-ssh-002 | independence_notes | Shares thread with fb-ssh-003 (different post); independence unestablished | Separate post on the official NewBridge Page from fb-ssh-003; different commenters; independence unestablished | Post reads confirm two different Page posts (2026-06-27 Director post vs 2026-06-30 Club Fair post); the comments do not share a thread. |
| fb-ssh-003 | independence_notes | Shares thread with fb-ssh-002 (different post); independence unestablished | Separate post on the official NewBridge Page from fb-ssh-002; different commenters; independence unestablished | Same as fb-ssh-002. |
| fb-ssh-009 | match_reason | Comment on the official NewBridge on the Charles Facebook Page thread; author says they have worked for the company for years and praises the campus memory-care unit. The unit is part of the life-plan campus in this batch, but the account is a staff endorsement, so it is recorded as provider promotion and flagged for human review. | Comment in the public Everything Local Dedham/Westwood and Beyond group memory-care recommendations thread; author says they have worked for the company for years and praises the campus memory-care unit. The unit is part of the life-plan campus in this batch, but the account is a staff endorsement, so it is recorded as provider promotion and flagged for human review. | Comments read confirms the comment is in group thread 2963697150466103, not on the official Page. Stored source_url, thread_url and source_visibility (public) are already correct. |
| fb-ssh-012 | care_level | unknown | memory care | The comment explicitly says the campus cared for the commenter's mother with dementia; memory care is the source-stated care level. |
| fb-ssh-012 | summary | Commenter said NewBridge in Dedham is the best and that the campus cared for their mother and their mother-in-law. No specific events, dates, or care level were stated. | Commenter said NewBridge in Dedham is the best and that the campus cared for their mother, who had dementia, and their mother-in-law. No specific events or dates were stated. | The stored claim that no care level was stated is inaccurate; the comment explicitly mentions dementia care. |
| fb-ssh-016 | match_reason | Comment in a short-term rehab / skilled-nursing recommendations thread naming NewBridge. The rehab context points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch. Campus vs. nursing unit cannot be distinguished from the comment alone; provider_id is left blank so the account is not transferred to the life-plan campus. | Comment in the memory-care recommendations thread naming NewBridge; the commenter describes firsthand short-term rehab experience and links the Hebrew Rehabilitation Center rating page. The rehab service points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch; provider_id is left blank so the account is not transferred to the life-plan campus. | Comments read confirms the comment is in thread 2963697150466103 (memory-care request), not a rehab thread; the rehab link is established by the commenter's own words and links. |
| fb-ssh-017 | match_reason | Comment in a short-term rehab / skilled-nursing recommendations thread naming NewBridge. The rehab context points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch. Campus vs. nursing unit cannot be distinguished from the comment alone; provider_id is left blank so the account is not transferred to the life-plan campus. | Comment in the memory-care recommendations thread naming NewBridge; the commenter states they have no memory-care experience but that the skilled nursing section is excellent. The skilled-nursing service points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch; provider_id is left blank so the account is not transferred to the life-plan campus. | Same thread correction as fb-ssh-016; the comment explicitly names the skilled nursing section. |
| fb-ssh-021 | match_reason | Comment in a short-term rehab / skilled-nursing recommendations thread naming NewBridge. The rehab context points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch. Campus vs. nursing unit cannot be distinguished from the comment alone; provider_id is left blank so the account is not transferred to the life-plan campus. | Comment in a rehab recommendations thread (hip surgery) naming NewBridge. The commenter describes two good stays for their mother and compares NewBridge with Hebrew Rehab, both noted as owned by Hebrew Senior Life. The rehab service points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch; provider_id is left blank so the account is not transferred to the life-plan campus. | The comment can now be distinguished: a firsthand stay account answering a rehab request, framed against a rehab facility. The thread is the rehab-after-hip thread 3014557802046704, not a generic short-term rehab thread. |
| fb-ssh-021 | summary | Commenter said Newbridge in Dedham was a very good experience for their mother twice. No specific events, dates, or care aspects were stated. The rehab context points to the skilled nursing unit, not the life-plan campus. | Commenter said Newbridge in Dedham was a very good experience for their mother twice, and that she was also at Hebrew Rehab in Roslindale once, noting both are owned by Hebrew Senior Life. No specific events, dates, or care aspects were stated. The rehab context points to the skilled nursing unit, not the life-plan campus. | The comment explicitly compares NewBridge with Hebrew Rehab; the comparison reinforces the rehab context and was omitted from the stored summary. |
| fb-ssh-027 | match_reason | Comment in a short-term rehab / skilled-nursing recommendations thread naming NewBridge. The rehab context points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch. Campus vs. nursing unit cannot be distinguished from the comment alone; provider_id is left blank so the account is not transferred to the life-plan campus. | Comment in a rehab recommendations thread (hip surgery) naming NewBridge. The commenter describes a firsthand negative stay for their husband, with care, food, room and evening-staffing conditions. The stay was a rehab stay in context; the rehab service points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch; provider_id is left blank so the account is not transferred to the life-plan campus. | The comment can now be distinguished: a firsthand stay account answering a rehab request. The word rehab does not appear in the comment itself; the rehab framing comes from the thread request. |
| fb-ssh-030 | match_reason | Comment in a short-term rehab / skilled-nursing recommendations thread naming NewBridge. The rehab context points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch. Campus vs. nursing unit cannot be distinguished from the comment alone; provider_id is left blank so the account is not transferred to the life-plan campus. | Comment in a skilled-nursing recommendations thread naming NewBridge. The commenter states their mother had good care there and classifies NewBridge as a rehabilitation facility. The rehab service points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch; provider_id is left blank so the account is not transferred to the life-plan campus. | The comment itself classifies NewBridge as a rehabilitation facility; the unit can now be distinguished. |
| fb-ssh-031 | match_reason | Comment in a short-term rehab / skilled-nursing recommendations thread naming NewBridge. The rehab context points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch. Campus vs. nursing unit cannot be distinguished from the comment alone; provider_id is left blank so the account is not transferred to the life-plan campus. | Comment in a skilled-nursing recommendations thread naming NewBridge. The commenter calls it the best and notes it is difficult to get in if it is just for rehab. The rehab service points to the separately licensed skilled nursing facility at 7000 Great Meadow Road, which is not in this batch; provider_id is left blank so the account is not transferred to the life-plan campus. | The comment itself frames NewBridge as a rehab facility; the unit can now be distinguished. |

No amendments proposed for fb-ssh-004 through fb-ssh-008, fb-ssh-010,
fb-ssh-011, fb-ssh-013, fb-ssh-014, fb-ssh-015, fb-ssh-018, fb-ssh-019,
fb-ssh-020, fb-ssh-022, fb-ssh-023, fb-ssh-024, fb-ssh-025, fb-ssh-026,
fb-ssh-028, fb-ssh-029, fb-ssh-032, fb-ssh-033, fb-ssh-034, fb-ssh-035.
Their stored match_reason, summaries and posted_at dates were verified
against the re-read comments and are faithful.

## Follow-up assignment candidates

### Verified entity: cms-225774 (NewBridge on the Charles Skilled Nursing Facility, 7000 Great Meadow Road, Dedham)

Six rows establish the SNF from the comment itself. Recommend adding
cms-225774 to a follow-up assignment so these accounts can be attached to
their entity there; do not write the ID into this batch.

- fb-ssh-016 — firsthand short-term rehab, links the Hebrew Rehabilitation
  Center rating page.
- fb-ssh-017 — explicit "skilled nursing section is excellent", no
  memory-care experience.
- fb-ssh-021 — firsthand two-stay rehab account, compared with Hebrew Rehab.
- fb-ssh-027 — firsthand detailed negative rehab-stay account.
- fb-ssh-030 — firsthand, classifies NewBridge as a rehabilitation facility.
- fb-ssh-031 — explicit rehab-admission framing ("just for rehab").

### Probable entity: cms-225774 (thread context only)

Fourteen rows name NewBridge only in a rehab or skilled-nursing thread. The
intended service is indicated by the thread, but the commenter did not
describe it. Second-tier candidates for the same follow-up assignment, to be
re-examined there rather than auto-attached: fb-ssh-018, fb-ssh-019,
fb-ssh-020, fb-ssh-022, fb-ssh-023, fb-ssh-024, fb-ssh-025, fb-ssh-026,
fb-ssh-028, fb-ssh-029, fb-ssh-032, fb-ssh-033, fb-ssh-034, fb-ssh-035.

### Probable entity: campus memory care (life-plan campus)

Six rows in the memory-care thread: fb-ssh-010, fb-ssh-011, fb-ssh-012,
fb-ssh-013, fb-ssh-014, fb-ssh-015. The campus memory-care unit is the likely
subject, but the SNF cannot be ruled out and no comment names an address.
No new entity to assign; they stay probable with blank provider_id.

### Reviewer note: ma-alr-newbridge-on-the-charles (assisted living, 6000 Great Meadow Road)

No row among the 26 candidates verifies the ALR. However, fb-ssh-004 through
fb-ssh-008 (exact campus rows, outside the candidate set) sit in an
assisted-living recommendations thread, so the ALR is the likely unit for
those five even though no comment states a care level. If a follow-up
assignment covers the ALR, those five should be re-examined there. No change
is proposed to them in this batch.

## Limitations and remaining uncertainty

- Nested replies are not retrievable through the CLI's flat comment list.
  All five threads' top-level comments were fully re-read (27 + 56 + 6 + 32 +
  19 = 140 comments), but a NewBridge mention inside a nested reply would
  not have been seen. Recorded rows all come from top-level comments that
  were read verbatim, so no recorded row depends on an unseen reply.
- Comment-count discrepancies vs the collector's notes (AL 27 of 36, SNF 19
  of 36, memory-care 104, rehab-after-hip 66) are explained: the post reads
  now report 27, 19, 56 and 32 top-level comments respectively, and all were
  retrieved. The larger collector figures most likely counted nested replies.
- The group's Community Code of Conduct asks members to respect privacy and
  keep shared content in the group. The group is public (OPEN) and the posts
  are visible to everyone, so public-source research under the protocol is
  not barred, but the rule is a reuse caution for any future publication.
- The official Page could not be enumerated through the CLI; only the two
  recorded posts were read directly. No other Page comment was re-examined.
- fb-ssh-021 and fb-ssh-027 rest on thread context plus a firsthand stay
  account; the word rehab does not appear in either comment. Their SNF
  verification is weaker than fb-ssh-016, fb-ssh-017, fb-ssh-030 and
  fb-ssh-031, where the commenter uses rehab or skilled-nursing language
  directly.

## Counts for the parent

- Rows reviewed: 34 (fb-ssh-002 through fb-ssh-035), all re-read from source.
- Rows resolved: 6 with a verified entity (cms-225774: fb-ssh-016, fb-ssh-017,
  fb-ssh-021, fb-ssh-027, fb-ssh-030, fb-ssh-031) recorded for follow-up
  assignment, with the verification documented in proposed match_reason
  updates; 2 metadata corrections (fb-ssh-009 match_reason; fb-ssh-002
  and fb-ssh-003 independence_notes); 2 content corrections (fb-ssh-012
  care_level and summary; fb-ssh-021 summary). Total proposed amendment
  cells: 12 across 10 rows (independence_notes x2, match_reason x7,
  care_level x1, summary x2).
- Rows still unassigned in this batch: all 26 candidates keep a blank
  provider_id — 6 probable campus memory care (fb-ssh-010 through 015:
  likely unit not established, SNF not ruled out), 14 probable SNF on thread
  context only (fb-ssh-018, 019, 020, 022, 023, 024, 025, 026, 028, 029, 032,
  033, 034, 035: comment names no unit or service), and the 6 verified-SNF
  rows (fb-ssh-016, 017, 021, 027, 030, 031: entity verified but not in this
  batch's 20 IDs, so they stay blank here and go to the follow-up list).
- Exact-attributed rows unchanged in count: 8 (fb-ssh-002 through 009).
- Reconciliation: 8 exact + 26 candidates = 34 = coverage observations_found.
