# Amendment log — follow-up pass 2026-11-12

Run: `fb-pilot-2026-11-12`. Follow-up prompt:
`docs/facebook-followup-prompt.md`. Human review that motivated it:
`docs/facebook-pilot-review.md`. All checks dated 2026-11-12.

The original run is intact in `research/facebook-runs/fb-pilot-2026-11-12/`
(`observations.csv`, `coverage.csv`). This directory holds versioned copies
(`observations-amended.csv`, `coverage-amended.csv`) with the changes below.
Nothing in the app's curated inputs was touched. No scores were produced.
Every row remains `internal_review_pending`; nothing here is approval for
publication or scoring.

Total changed cells: **38** — 4 coverage-format fixes (§1) and 34 substantive
amendments (§2–§3). A diff of the amended files against the originals shows
exactly these 38 cells and no others. Amendments were applied by
`apply-amendments.py`, which asserts each current cell value before changing
it and enforces the importer's field-length caps.

## 1. Coverage format fixes (task 1)

Deterministic corrections matching the review's privately staged copy. No
sources added, no facts changed.

| Coverage row | Provider | Field | Change |
| --- | --- | --- | --- |
| 10 | mgb-home-care | sources_checked | First item was 607 characters, over the 500-character item limit. Item reduced to its existing source label, `social.search (facebook, since 2024-11-12, top 25)`; the full 607-character narrative moved verbatim to coverage_notes with a format-move label. The other two items unchanged. |
| 10 | mgb-home-care | coverage_notes | Appended the original 607-character sources_checked item 1 verbatim, prefixed `[format move 2026-11-12: original sources_checked item 1 moved here verbatim; array item now holds only the source label]`. New length 1,122 characters, within the 1,500 cap. |
| 15 | lifeplan-brooksby-village | sources_checked | Semicolon-delimited string converted to a JSON array of the same 5 segments, separator whitespace trimmed only. No sources added. |
| 16 | ma-alr-harriett-and-ralph-kaplan-estates | sources_checked | Same conversion as row 15: 5 existing segments into a JSON array, whitespace trimmed only. No sources added. |

## 2. Observation amendments (32 cells)

### MGB trio — linked case (task 4)

| Observation | Field | Change | Reason |
| --- | --- | --- | --- |
| fb-nww-001 | independence_notes | Appended linked-case note (see below). | One of three MGB Home Care advocacy records from the same MNA labor dispute; must not be counted as three independent events. |
| fb-nww-002 | independence_notes | Appended the same linked-case note. | Same reason. |
| fb-nww-003 | independence_notes | Appended the linked-case note plus a re-read caveat (see below). | Same linkage reason; the source could not be re-read directly (HTTP 404 twice), though the public web index still returns the permalink with matching content. |

Linked-case note appended to all three: "Linked case, reviewed 2026-11-12: one of three MGB Home Care advocacy records (fb-nww-001, 2026-06-30; fb-nww-002, 2026-08-13; fb-nww-003, 2026-11-01) from the same Massachusetts Nurses Association labor dispute and post-strike bargaining. Related staff accounts from one linked dispute, not three independent events and not a prevalence measure. Reported allegations are staff-reported, not independently verified and not confirmed events." Re-read caveat on fb-nww-003 only: "Direct re-read failed 2026-11-12 (post unavailable to this account); the public web index still returns this permalink with content matching the recorded summary." `duplicate_of` stays blank on all three: three distinct posts, dates and claims; no verified duplicate account exists.

### Testimonial review flags (task 6a)

| Observation | Field | Change | Reason |
| --- | --- | --- | --- |
| fb-bos-003 | needs_human_review | false → true | Facility-published testimonial graphic; provider_promotion confirmed correct on re-read. The submitted false flag is not approval; the importer escalates it. |
| fb-bos-004 | needs_human_review | false → true | Same reason; facility-published patient testimonial graphic. |
| fb-bos-007 | needs_human_review | false → true | Same reason; operator announcement, kept as provider promotion, not a care account. |
| fb-nsh-008 | needs_human_review | false → true | Same reason; provider-produced Brooksby reel. |
| fb-nsh-009 | needs_human_review | false → true | Same reason; provider-produced Brooksby tour reel. |

No `account_type` changed: all five rows are correctly `provider_promotion`.

### NewBridge metadata and content corrections (tasks 2 and 3)

| Observation | Field | Change | Reason |
| --- | --- | --- | --- |
| fb-ssh-002 | independence_notes | "Shares thread with fb-ssh-003 (different post)" → "Separate post on the official NewBridge Page from fb-ssh-003; different commenters" | Post reads confirm two different Page posts (2026-06-27 Director post vs 2026-06-30 Club Fair post); the comments do not share a thread. |
| fb-ssh-003 | independence_notes | Mirror of fb-ssh-002. | Same reason. |
| fb-ssh-009 | match_reason | "Comment on the official NewBridge on the Charles Facebook Page thread" → "Comment in the public Everything Local Dedham/Westwood and Beyond group memory-care recommendations thread" (rest of the text unchanged) | Comments read confirms the comment is in group thread 2963697150466103, not on the official Page. Stored source_url, thread_url and public visibility were already correct. Exact attribution to the campus retained. |
| fb-ssh-012 | care_level | unknown → memory care | The comment explicitly says the campus cared for the commenter's mother with dementia; memory care is the source-stated care level. |
| fb-ssh-012 | summary | "No specific events, dates, or care level were stated." → "No specific events or dates were stated." and "cared for their mother" → "cared for their mother, who had dementia," | The stored claim that no care level was stated was inaccurate. |
| fb-ssh-016 | match_reason | Rewritten: comment is in the memory-care recommendations thread; commenter describes firsthand short-term rehab experience and links the Hebrew Rehabilitation Center rating page. | Stored text mislabeled the thread as a rehab thread. The rehab service points to the SNF at 7000 Great Meadow Road (not in this batch); provider_id stays blank. |
| fb-ssh-017 | match_reason | Rewritten: comment is in the memory-care thread; commenter states no memory-care experience but that the skilled nursing section is excellent. | Same thread correction; the comment explicitly names the skilled nursing section. |
| fb-ssh-021 | match_reason | Rewritten: comment is in the rehab-after-hip-surgery thread; commenter describes two good stays and compares NewBridge with Hebrew Rehab, both noted as owned by Hebrew Senior Life. | The comment can now be distinguished as a firsthand stay account answering a rehab request. The word "rehab" does not appear in the comment itself; the framing comes from the thread request and the Hebrew Rehab comparison. |
| fb-ssh-021 | summary | Added the Hebrew Rehab comparison: "and that she was also at Hebrew Rehab in Roslindale once, noting both are owned by Hebrew Senior Life." | The comparison was omitted from the stored summary and reinforces the rehab context. |
| fb-ssh-027 | match_reason | Rewritten: comment is in the rehab-after-hip-surgery thread; firsthand negative stay account (care, food, room, evening staffing). | Same distinguishing reason as fb-ssh-021; "rehab" framing comes from the thread request, not the comment's words. |
| fb-ssh-030 | match_reason | Rewritten: comment is in the skilled-nursing recommendations thread; commenter classifies NewBridge as a rehabilitation facility. | The comment itself classifies NewBridge as a rehabilitation facility; the unit can now be distinguished. |
| fb-ssh-031 | match_reason | Rewritten: comment is in the skilled-nursing thread; commenter calls it the best and notes it is difficult to get in if it is just for rehab. | The comment itself frames NewBridge as a rehab facility. |

No `provider_id` was written for any NewBridge candidate. The six rows whose
source verifies the SNF (fb-ssh-016, 017, 021, 027, 030, 031) and the fourteen
probable-SNF rows stay blank in this batch because cms-225774 is not among
the 20 assigned IDs; they are recorded in the assignment list (A4) instead.

### Reconciliation note (task 5)

| Observation | Field | Change | Reason |
| --- | --- | --- | --- |
| fb-ssh-001 | match_reason | Appended: "Re-read 2026-11-12: 71 of 73 top-level comments retrieved, none names a location; nested replies not retrievable via the CLI." | Records why the row stays probable: the one nested reply that might confirm Weymouth cannot be read through the CLI. |

### Duplicate groups — independence notes (task 6b)

No `duplicate_of` was set for any row: **0 verified duplicates** in the
batch. All changes below are to `independence_notes` only.

| Observation | Change | Reason |
| --- | --- | --- |
| fb-nsh-004 | Replaced "independence unestablished" with a note stating it is a distinct comment on the facility's retirement-celebration post (2026-09-12), shares the thread and bare post URL as source with fb-nsh-005, different claims (mother's previous care vs aunt's current residence), not duplicates. | G03/G15: the shared thread was not mentioned in the current note at all, although the importer groups the pair twice. Direct re-read verified two distinct comments. |
| fb-nsh-005 | Mirror of fb-nsh-004 (aunt's current residence vs mother's previous care). | Same gap as fb-nsh-004. |
| fb-nsh-011 | Replaced note with: one comment naming two providers, recorded as one observation per provider; not two independent recommendations and not a duplicate account. | G04: the current note stated the shared comment but not the counting consequence. |
| fb-nsh-012 | Mirror of fb-nsh-011, plus "counts toward Kaplan Estates coverage." | Same counting consequence as fb-nsh-011. |
| fb-ssh-018, fb-ssh-020 | Appended: identical summary text is a collector template for name-only comments, not the same comment; distinct comment objects, not duplicates. | G13: identical summaries are a template artifact. |
| fb-ssh-022, fb-ssh-023, fb-ssh-026 | Appended the same template explanation (each pair/triple named). | G12: identical summaries are a template artifact. |
| fb-ssh-032, fb-ssh-034 | Appended the same template explanation. | G14: identical summaries are a template artifact. |

## 3. Coverage note amendments (2 cells)

| Coverage row | Provider | Change | Reason |
| --- | --- | --- | --- |
| 4 | cms-225540 | coverage_notes appended: "Re-read 2026-11-12 confirms the visit was to the Edelweiss Village assisted-living unit. The candidate's subject matches catalog record ma-alr-edelweiss-village (Edelweiss Village, assisted-living, 2220 Centre St, Boston-West Roxbury); see follow-up assignment A1." | Records the verified alternate-record match without changing the count (1) or the row's status (ambiguous_only). |
| 17 | cms-225634 | coverage_notes appended: "Re-read 2026-11-12: 71 of 73 top-level comments retrieved via the CLI, none names a location; nested replies are not exposed by the CLI. A web-search summary of the thread reports the author's own reply as naming Care One in Weymouth, but that is a secondary summary, not retrievable source text. A human should open the thread directly and read the nested reply to the 'what hospital in?' comment before any upgrade to exact." | Preserves the exact state of verification and the one concrete step that could resolve it. Count (1) and status (partial) unchanged. |

No `observations_found` value changed anywhere. All six reported counts that
the importer flags as unresolved-count warnings were reconciled with explicit
observation IDs in §4 and stand as written.

## 4. Per-row review record — all 71 observations

Check types: **source re-read** (the stored source was opened again on
2026-11-12 via facebook-cli, browser search or public web search);
**group review** (the row was reviewed semantically as part of a duplicate-
candidate group, decided on distinct comment IDs, distinct claims and
collector notes; direct re-read only where stated); **batch-file check**
(the row was not in any agent's source-review scope this pass; the amended
batch passed the importer's mechanical validation — IDs unique, enums valid,
quote budget, provider rules — and the collector's metadata stands as
recorded). Every row, including amended ones, still needs human review
before any publication or scoring decision. A check record is not approval.

| Observation | Check | Result | Remaining uncertainty |
| --- | --- | --- | --- |
| fb-bos-001 | batch-file check | Unchanged. Boston Home tour visit by an elected official, as recorded. | No source revisit this pass. Tour visit, not a care account. |
| fb-bos-002 | batch-file check | Unchanged. Boston Home tour visit by an elected official, as recorded. | No source revisit this pass. Tour visit, not a care account. |
| fb-bos-003 | source re-read | Amended (§2): provider_promotion confirmed; needs_human_review false → true. | Facility-selected testimonial by definition; that is why the promotion label and review matter. |
| fb-bos-004 | source re-read | Amended (§2): provider_promotion confirmed; needs_human_review false → true. | Same facility-selection caveat as fb-bos-003. |
| fb-bos-005 | group review (G02) | Unchanged. Recommendation comment on the testimonial thread, different author from fb-bos-004; must not be counted as an independent care account. | No direct re-read; decided on distinct comment ID and collector notes. |
| fb-bos-006 | source re-read | Unchanged as a row; verified unresolved (Edelweiss Village AL unit, not the nursing unit). Coverage note amended (§3). Assignment A1. | Whether to reassign to ma-alr-edelweiss-village is a future-batch decision, not taken here. |
| fb-bos-007 | source re-read | Amended (§2): provider_promotion confirmed (operator announcement, not a care account); needs_human_review false → true. | Same graphic posted the same day by another operator-network page; no second observation row exists, so duplicate_of stays blank. |
| fb-bos-008 | source re-read | Unchanged. Probable confirmed: cookouts at Hebrew Rehabilitation Center - Boston generally, no unit named. | No center-level catalog record exists, so there is no alternate record to assign. |
| fb-nww-001 | source re-read | Amended (§2): linked-case note appended; duplicate_of stays blank. | Underlying caseload claim remains staff-reported and unverified; that is a property of the source. |
| fb-nww-002 | source re-read | Amended (§2): linked-case note appended; duplicate_of stays blank. | Supply claim remains staff-reported and unverified. |
| fb-nww-003 | source corroborated, direct re-read failed | Amended (§2): linked-case note plus re-read caveat appended; duplicate_of stays blank. | Facebook source returns 404; the stored summary rests on the collector's original read plus the public index match. Treat the source as unrecoverable rather than re-verified if the post was deleted. |
| fb-nsh-001 | source re-read | Unchanged. Unresolved confirmed: name variant with no town; its single comment adds no location. | None about the count or the match. |
| fb-nsh-002 | source re-read | Unchanged. Exact confirmed: post directs applicants to "ABC home care Wakefield Ma". | Staff recruitment post, not a care account. |
| fb-nsh-003 | batch-file check | Unchanged. Recommendation without detail from a community-group thread, as recorded. | No source revisit this pass. Its summary already covers two commenters, with a note that the second endorses the first and is not a second independent experience. |
| fb-nsh-004 | source re-read (G03) | Amended (§2): shared-thread note added. Distinct comment verified (distinct ID, text, timestamp). | Distinct comments established; distinct households are not — two comments could in principle come from the same person. |
| fb-nsh-005 | source re-read (G03) | Amended (§2): shared-thread note added. Distinct comment verified. | Same authorship caveat as fb-nsh-004. |
| fb-nsh-006 | batch-file check | Unchanged. Aberjona family comment on the facility's Page, as recorded. | No source revisit this pass. |
| fb-nsh-007 | group review (G04) | Unchanged. Firsthand family account (father at Brooksby, mixed); distinct comment in the advice thread. | Nested replies in the advice thread were not retrieved (32 of 63 top-level comments read). |
| fb-nsh-008 | source re-read | Amended (§2): provider_promotion confirmed; needs_human_review false → true. | Resident's words are provider-selected and provider-framed. |
| fb-nsh-009 | source re-read | Amended (§2): provider_promotion confirmed; needs_human_review false → true. | Stored excerpt is the caption's marketing call to action, not resident words; the summary already attributes the tour invitation to the caption. |
| fb-nsh-010 | group review (G04) | Unchanged. Tour pricing note; distinct comment in the advice thread. | Same nested-reply gap as fb-nsh-007. |
| fb-nsh-011 | group review (G04) | Amended (§2): counting note added. One comment naming two providers, one observation per provider. | Must never be counted as two independent recommendations. |
| fb-nsh-012 | group review (G04) | Amended (§2): counting note added. Same comment as fb-nsh-011. | Same counting consequence as fb-nsh-011. |
| fb-nsh-013 | batch-file check | Unchanged. Guided tour by a local business owner (2026-03-17), as recorded. | No source revisit this pass. |
| fb-ssh-001 | source re-read | Amended (§2, §3): match_reason and coverage note record the re-read; stays probable. Assignment A2. | The one nested reply that might confirm Weymouth is unretrieved. |
| fb-ssh-002 | source re-read | Amended (§2): independence note corrected (separate Page post, not a shared thread). | None on source. Care level unknown, as stored. |
| fb-ssh-003 | source re-read | Amended (§2): independence note corrected (separate Page post). | None on source. Relationship unknown, as stored. |
| fb-ssh-004 | source re-read | Unchanged. Exact verified; comment in the assisted-living thread, no care level stated. | ALR (ma-alr-newbridge-on-the-charles) is the likely unit; the comment does not state it. See assignment A5. |
| fb-ssh-005 | source re-read | Unchanged. Exact verified; name-only comment in the assisted-living thread. | Same ALR note as fb-ssh-004. |
| fb-ssh-006 | source re-read | Unchanged. Exact verified; grandmother resident, care level not stated. | Same ALR note as fb-ssh-004. |
| fb-ssh-007 | source re-read | Unchanged. Exact verified; care manager names NewBridge among good assisted-living options. | Same ALR note as fb-ssh-004. |
| fb-ssh-008 | source re-read | Unchanged. Exact verified; mother resident for many years, no care level stated. | Same ALR note as fb-ssh-004. |
| fb-ssh-009 | source re-read | Amended (§2): match_reason corrected to the group memory-care thread. Exact attribution retained. | Comment names no address; exact-to-campus rests on the memory-care unit being a campus residence. |
| fb-ssh-010 | source re-read | Unchanged. Probable campus memory care; no care level stated by the commenter. | SNF cannot be ruled out; no unit or address stated. |
| fb-ssh-011 | source re-read | Unchanged. Probable campus memory care. | SNF cannot be ruled out. |
| fb-ssh-012 | source re-read | Amended (§2): care_level memory care; summary corrected to record the dementia care. | SNF also provides dementia care, so the entity is not established. |
| fb-ssh-013 | source re-read | Unchanged. Probable campus memory care; name-plus-superlative, no detail. | SNF cannot be ruled out. |
| fb-ssh-014 | source re-read | Unchanged. Probable campus memory care; care manager lists NewBridge among memory-care options, long wait list noted. | SNF cannot be ruled out; no address stated. 4 nested replies not retrievable. |
| fb-ssh-015 | source re-read | Unchanged. Probable campus memory care; short negative comment, no detail. | SNF cannot be ruled out. |
| fb-ssh-016 | source re-read | Amended (§2): match_reason corrected (memory-care thread, firsthand short-term rehab). Verified entity cms-225774, recorded for assignment A4; provider_id stays blank in this batch. | Comment also infers the memory-care unit would meet the same standards; that inference is not experience and is already flagged in the summary. |
| fb-ssh-017 | source re-read | Amended (§2): match_reason corrected. Verified entity cms-225774, assignment A4; provider_id stays blank. | Comment names no address; the SNF is the only NewBridge entity with a skilled nursing section. |
| fb-ssh-018 | source re-read | Amended (§2): template-explanation note added. Probable SNF on thread context only. | Comment names no unit or service; the rehab link is the thread's request, not the commenter's words. |
| fb-ssh-019 | source re-read | Unchanged. Probable SNF on thread context only; negative name-only comment, concern unclear. | Same thread-context-only limitation as fb-ssh-018. |
| fb-ssh-020 | source re-read | Amended (§2): template-explanation note added. Probable SNF on thread context only. | Same limitation as fb-ssh-018. |
| fb-ssh-021 | source re-read | Amended (§2): match_reason and summary corrected (Hebrew Rehab comparison added). Verified entity cms-225774, assignment A4; provider_id stays blank. | The word "rehab" does not appear in the comment itself; the rehab framing comes from the thread request and the Hebrew Rehab comparison. Weaker verification than fb-ssh-016/017/030/031. |
| fb-ssh-022 | source re-read | Amended (§2): template-explanation note added. Probable SNF on thread context only. | Same limitation as fb-ssh-018. |
| fb-ssh-023 | source re-read | Amended (§2): template-explanation note added. Probable SNF on thread context only. | Same limitation as fb-ssh-018. |
| fb-ssh-024 | source re-read | Unchanged. Probable SNF on thread context only; names NewBridge alongside two other facilities. | Same limitation as fb-ssh-018. |
| fb-ssh-025 | source re-read | Unchanged. Probable SNF on thread context only; name-plus-emphatic-endorsement. | Same limitation as fb-ssh-018. |
| fb-ssh-026 | source re-read | Amended (§2): template-explanation note added. Probable SNF on thread context only. | Same limitation as fb-ssh-018; 7 nested replies not retrievable. |
| fb-ssh-027 | source re-read | Amended (§2): match_reason corrected. Verified entity cms-225774, assignment A4; provider_id stays blank. | Same weaker-verification caveat as fb-ssh-021. |
| fb-ssh-028 | source re-read | Unchanged. Probable SNF on thread context only; short negative recommendation, no experience described. | Same limitation as fb-ssh-018. |
| fb-ssh-029 | source re-read | Unchanged. Probable SNF on thread context only; names NewBridge or Hebrew Rehab, rules out two others. | Same limitation as fb-ssh-018. |
| fb-ssh-030 | source re-read | Amended (§2): match_reason corrected. Verified entity cms-225774, assignment A4; provider_id stays blank. | Comment names no address; the SNF is the only NewBridge rehabilitation facility. |
| fb-ssh-031 | source re-read | Amended (§2): match_reason corrected. Verified entity cms-225774, assignment A4; provider_id stays blank. | Comment names no address. |
| fb-ssh-032 | source re-read | Amended (§2): template-explanation note added. Probable SNF on thread context only. | Same limitation as fb-ssh-018. |
| fb-ssh-033 | source re-read | Unchanged. Probable SNF on thread context only; name-plus-superlative. | Same limitation as fb-ssh-018. |
| fb-ssh-034 | source re-read | Amended (§2): template-explanation note added. Probable SNF on thread context only. | Same limitation as fb-ssh-018. |
| fb-ssh-035 | source re-read | Unchanged. Probable SNF on thread context only; names Newbridge as one of the best alongside another facility. | Same limitation as fb-ssh-018; 2 nested replies not retrievable. |
| fb-ssh-036 | group review (G01) | Unchanged. Family firsthand account praising staff on Rose Lane; distinct comment. | No direct re-read; decided on distinct comment IDs and collector notes. |
| fb-ssh-037 | group review (G01) | Unchanged. Family firsthand account (mother-in-law genuinely happy); distinct comment. | Same authorship caveat as fb-ssh-036. |
| fb-ssh-038 | group review (G05) | Unchanged. Recommendation without detail; distinct comment in the opinions thread. | Counting caution: seven comments are not seven verified independent households. |
| fb-ssh-039 | group review (G05) | Unchanged. Firsthand praise with no relationship stated; distinct comment. | Same counting caution as fb-ssh-038. |
| fb-ssh-040 | group review (G05) | Unchanged. Family firsthand (cousin resident about a year); distinct comment. | Same counting caution as fb-ssh-038. |
| fb-ssh-041 | group review (G05) | Unchanged. Family firsthand (brother-in-law's previous stay); distinct comment. | Same counting caution as fb-ssh-038. |
| fb-ssh-042 | group review (G05) | Unchanged. Tour experience only; distinct comment. | Tour, not a care experience. |
| fb-ssh-043 | group review (G05) | Unchanged. Hearsay only; distinct comment. | Hearsay, not a care experience. |
| fb-ssh-044 | group review (G05) | Unchanged. Recommendation without detail; distinct comment. | Same counting caution as fb-ssh-038. |
| fb-ssh-045 | batch-file check | Unchanged. Wareham observation, as recorded. | No source revisit this pass. |
| fb-ssh-046 | source re-read (G11) | Unchanged. Original post in the 2026-11-07 thread; entity unestablished. | Thread mixes South Shore services, the visiting nurse, pathways, meals on wheels and Old Colony Elder Services; the responsible entity cannot be established from the text. |
| fb-ssh-047 | source re-read (G11) | Unchanged. Reply comment by a different commenter in the same thread; entity unestablished. | Same entity uncertainty as fb-ssh-046. Related accounts in one thread, not two independent cases. |

## 5. What was checked and not changed

- **Coverage counts:** all six importer-flagged counts reconciled with explicit
  IDs and stand as written: cms-225540 (1 = fb-bos-006), cms-225759
  (1 = fb-bos-008), abc-home-healthcare (2 = fb-nsh-001 + fb-nsh-002),
  cms-225634 (1 = fb-ssh-001), lifeplan-newbridge-on-the-charles
  (34 = 8 exact + 26 candidates, listed in the NewBridge findings),
  south-shore-vna (2 = fb-ssh-046 + fb-ssh-047). No `observations_found`
  value changed. The importer still emits the six `unresolved_count`
  warnings because those counts include unresolved candidates; the warnings
  are structural, and the reconciliation behind them is documented here.
- **Duplicate groups:** all 15 mechanical groups re-derived (identical to
  the review: 11 shared-thread, 3 repeated-location-summary, 1
  shared-source-or-source-edit; 51 observations). **0 verified duplicates**;
  no `duplicate_of` set. G12/G13/G14 identical summaries are collector
  template sentences for distinct name-only comments. G04 fb-nsh-011/012
  are one comment recorded as two provider-specific observations, not a
  duplicate account and not two independent recommendations.
- **No provider_id written** for any candidate row in this batch. Verified
  non-batch entities are recorded in the assignment list, not silently
  assigned.
- **One correction the agents flagged but this pass did not apply:**
  fb-bos-006 appears to match catalog record ma-alr-edelweiss-village
  exactly. Reassigning it would put a provider_id outside the 20-ID
  assignment, which the importer rejects (every exact-matched observation
  needs a coverage row, and coverage must contain exactly the assigned
  providers). It stays an unresolved candidate here and is assignment A1.
- **One agent misquote caught at assembly:** the reconciliation findings
  quoted the cms-225634 coverage_notes as ending "...Weymouth location not
  directly verifiable." The actual notes end "...CareOne New Bedford, not
  Weymouth - excluded; brand-confusion risk noted." The append was applied
  to the actual text; the log records the actual value.

## 6. Sources

- Findings files in `scratch/`: `newbridge-findings.md`,
  `mgb-testimonials-findings.md`, `reconciliation-findings.md`,
  `duplicate-groups-findings.md`. Each records its method, per-row evidence
  and remaining uncertainty.
- `apply-amendments.py` in this directory applied §1–§3 and asserts every
  current cell value before changing it.
- Dry-run importer result for the amended batch: `ok: true`, 0 errors,
  6 warnings (all `unresolved_count`, structural — see §5). Run 2026-11-12
  from the repository root with the original 20-ID assignment and the kit
  catalog.
