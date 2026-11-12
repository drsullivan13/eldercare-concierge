# Follow-up findings — MGB trio and testimonial labels (tasks 4 and 6a)

Run: `fb-pilot-2026-11-12`. Review date: 2026-11-12.
Scope: fb-nww-001/002/003 (MGB Home Care labor-dispute records) and
fb-bos-003/004/007, fb-nsh-008/009 (facility-published / provider-produced
testimonials and one operator announcement).
Method: each stored source URL was re-read with `facebook-cli post read --url`
on 2026-11-12; fb-nww-003 was additionally checked with a public web search
because the direct re-read failed. No groups were joined, no messages sent,
no private material copied. No names, medical details or new quotations are
added here; speakers are described by role only. No CSV was edited — all
changes below are proposals for the parent to apply.

## 1. The MGB trio — what the three rows share

- Same employer and care entity: Mass General Brigham Home Care, the
  home-health branch (Newton), explicitly identified in all three sources.
- Same advocacy source family: the Massachusetts Nurses Association.
  fb-nww-001 and fb-nww-002 were published by the MNA page; fb-nww-003 was
  published by the union-affiliated "Mgbhomecare Mna" account.
- Same labor dispute: the 2026 MNA dispute over staffing, caseloads and
  contract terms, including the July 8–15, 2026 strike and post-strike
  bargaining that continued at least through November 1, 2026.
- Same record class in all three rows: relationship staff, experience stage
  employment, account type firsthand, sentiment negative, use status
  internal_review_pending, needs_human_review already true.
- Same evidentiary status: every claim in all three is staff-reported
  advocacy material, not independently verified, and none is a confirmed
  event. None of the three is a resident or family account of receiving care.

## 2. What distinguishes the three rows

- fb-nww-001 (posted 2026-06-30, pre-strike): a compilation video of several
  MGB Home Care clinicians (physical therapy, speech-language pathology and
  others) speaking in sequence about working conditions. The recorded claim
  is a caseload figure for one clinician's schedule, described by the speaker
  as unsafe for staff and patients. concern_type safety_allegation.
- fb-nww-002 (posted 2026-08-13, post-strike): a bargaining-update video
  with three clinicians (two nurses, one occupational therapist) speaking in
  sequence. The recorded claim is different: stalled negotiations and reduced
  patient supplies, with clinicians instructed to tell patients to improvise.
  concern_type service, not safety_allegation.
- fb-nww-003 (posted 2026-11-01, months later): a single-claim static
  graphic over a hospital-entrance photo, no people depicted. The recorded
  claim is that home-care case managers are expected to manage an unsafe
  number of patients at a time and are not paid for behind-the-scenes care
  management. concern_type safety_allegation.

The caseload theme recurs in fb-nww-001 and fb-nww-003, but the sources,
dates, formats, speakers and specific claims differ. They are related
perspectives on one dispute, not the same account told twice.

## 3. MGB per-row table

| observation_id | verdict | evidence | remaining uncertainty |
|---|---|---|---|
| fb-nww-001 | Confirmed as recorded. Related-event note proposed; duplicate_of stays blank. | Direct re-read 2026-11-12: MNA reel, created 2026-06-30, interviews with MGB Home Care clinicians about working conditions and patient safety, pre-strike. Stored posted_at, relationship, account_type, concern_type and excerpt all match the source. | None on the source itself. The underlying caseload claim remains staff-reported and unverified; that is a property of the source, not a gap in the record. |
| fb-nww-002 | Confirmed as recorded. Related-event note proposed; duplicate_of stays blank. | Direct re-read 2026-11-12: MNA reel, created 2026-08-13, post-strike bargaining update with three MGB Home Care clinicians; supply-reduction claim matches the stored summary and excerpt. Stored posted_at, relationship, account_type and concern_type all match. | None on the source itself. The supply claim remains staff-reported and unverified. |
| fb-nww-003 | Content corroborated but direct re-read failed; related-event note plus re-read caveat proposed; duplicate_of stays blank. | Direct re-read failed twice on 2026-11-12 (HTTP 404, post unavailable to this account — deleted or visibility changed). A public web search still returns the exact stored permalink with a summary matching the recorded content, author account, and posted date 2026-11-01. The same graphic also appears on the union account's Instagram the same day. The stored summary and excerpt match the indexed content. | The Facebook source could not be re-read directly, so the stored summary and excerpt rest on the collector's original 2026-11-12 read plus the indexed summary. If the post was deleted, the importer should treat the source as unrecoverable rather than re-verified. No new facts were taken from the search snippet; it was used only to corroborate existence and content match. |

## 4. Proposed related-event note (exact text)

Append the following to the `independence_notes` field of fb-nww-001,
fb-nww-002 and fb-nww-003, after the existing text:

> Linked case, reviewed 2026-11-12: one of three MGB Home Care advocacy records (fb-nww-001, 2026-06-30; fb-nww-002, 2026-08-13; fb-nww-003, 2026-11-01) from the same Massachusetts Nurses Association labor dispute and post-strike bargaining. Related staff accounts from one linked dispute, not three independent events and not a prevalence measure. Reported allegations are staff-reported, not independently verified and not confirmed events.

For fb-nww-003 only, append this additional sentence after the note above:

> Direct re-read failed 2026-11-12 (post unavailable to this account); the public web index still returns this permalink with content matching the recorded summary.

`duplicate_of` stays blank on all three rows. No verified duplicate account
exists: three distinct posts, three distinct dates, three distinct claims.
The multi-speaker videos (001, 002) compile several clinicians inside a
single post, but that is within-row compilation, not a cross-row duplicate.

## 5. Testimonial label check — per-row table

| observation_id | verdict | evidence | remaining uncertainty |
|---|---|---|---|
| fb-bos-003 | account_type provider_promotion confirmed correct. Summary does not present it as an independent consumer review. Propose needs_human_review false to true. | Direct re-read 2026-11-12: post on the facility's own page (Laurel Ridge Center for Health & Rehabilitation), created 2026-10-15, visibility public. Caption thanks the speaker for sharing a 5-star review; the graphic is a facility-published testimonial. Stored summary opens "In a testimonial graphic published by the facility" and keeps the speaker's relationship (family) without treating the post as independent. Stored excerpt is 10 words, within cap. | None. The underlying family account is facility-selected by definition; that is why the promotion label and human review matter, not a gap to close. |
| fb-bos-004 | account_type provider_promotion confirmed correct. Summary does not present it as an independent consumer review. Propose needs_human_review false to true. | Direct re-read 2026-11-12: post on the facility's own page (Laurel Ridge Rehabilitation and Skilled Care Center), created 2026-09-17, visibility public. Caption introduces the speaker's short-term rehab stay; the graphic is a facility-published patient testimonial. Stored summary opens "In a testimonial graphic published by the facility" and preserves relationship resident and care level short-term rehabilitation. Stored excerpt is 13 words, within cap. | None. Same facility-selection caveat as fb-bos-003. |
| fb-bos-007 | account_type provider_promotion confirmed correct. This is an operator announcement, not a testimonial and not a care account; the summary already says so. Propose needs_human_review false to true. | Direct re-read 2026-11-12: post on the Allaire Health Services page, created 2026-08-25, visibility public. Caption announces the operator's Massachusetts expansion and welcoming The Benjamin Healthcare Center. Stored summary states "This is a corporate announcement, not a resident or family care account." Stored excerpt is the announcement's welcome line, 10 words. | None on this source. The stored independence note records the same graphic/caption posted the same day by another operator-network page; there is no second observation row for that publication, so duplicate_of stays blank. |
| fb-nsh-008 | account_type provider_promotion confirmed correct. Summary does not present it as an independent consumer review. Propose needs_human_review false to true. | Direct re-read 2026-11-12: reel on the Brooksby Village page, created 2026-08-18, visibility public. Provider-produced video of a resident describing on-site medical services; the video's stated intent is to showcase the community to potential residents. Stored summary opens "In a provider-produced video" and preserves relationship resident. Stored excerpt is 11 words, within cap. | None. The resident's words are provider-selected and provider-framed; the promotion label captures that. |
| fb-nsh-009 | account_type provider_promotion confirmed correct. Summary does not present it as an independent consumer review. Propose needs_human_review false to true. | Direct re-read 2026-11-12: reel on the Brooksby Village page, created 2026-07-17, visibility public. Provider-produced video of residents describing a tour visit and deciding to move; the video's stated intent is promotion and an event RSVP call to action. Stored summary opens "In a provider-produced video" and records the tour invitation as caption content, with experience_stage touring. | None on classification. Minor reviewer note, no change proposed: the stored excerpt is the caption's marketing call to action rather than resident words; the summary already attributes the tour invitation to the caption, so context is preserved. |

## 6. Proposed-amendments list

| observation_id | field | current value | proposed value | reason |
|---|---|---|---|---|
| fb-nww-001 | independence_notes | "Single advocacy video compiling testimonies from several MGB Home Care clinicians; the testimonies are not independent accounts of separate households. Independence unestablished beyond the shared source." | Existing text + " Linked case, reviewed 2026-11-12: one of three MGB Home Care advocacy records (fb-nww-001, 2026-06-30; fb-nww-002, 2026-08-13; fb-nww-003, 2026-11-01) from the same Massachusetts Nurses Association labor dispute and post-strike bargaining. Related staff accounts from one linked dispute, not three independent events and not a prevalence measure. Reported allegations are staff-reported, not independently verified and not confirmed events." | Links the trio as one review case so the three rows are never counted as three independent signals. |
| fb-nww-002 | independence_notes | "Single advocacy video with three MGB Home Care clinicians speaking in sequence; not independent accounts of separate households. Independence unestablished beyond the shared source." | Existing text + the same linked-case sentence as fb-nww-001. | Same reason as fb-nww-001. |
| fb-nww-003 | independence_notes | "Single advocacy graphic; one claim from one source. Independence unestablished." | Existing text + the same linked-case sentence as fb-nww-001 + " Direct re-read failed 2026-11-12 (post unavailable to this account); the public web index still returns this permalink with content matching the recorded summary." | Same linkage reason as fb-nww-001/002, plus records that the source could not be re-read directly. |
| fb-bos-003 | needs_human_review | false | true | Provider-promotion record with a false review flag; the importer escalates it. Human review must confirm the promotional classification and that the summary is not read as an independent consumer review. A false flag is not approval. |
| fb-bos-004 | needs_human_review | false | true | Same reason as fb-bos-003. |
| fb-bos-007 | needs_human_review | false | true | Same reason as fb-bos-003; this row is an operator announcement, and review must confirm it is kept as promotion, not a care account. |
| fb-nsh-008 | needs_human_review | false | true | Same reason as fb-bos-003. |
| fb-nsh-009 | needs_human_review | false | true | Same reason as fb-bos-003. |

No change proposed to any `account_type` (all five testimonial rows are
correctly `provider_promotion`), to any `duplicate_of` (no verified duplicate
account in either group), or to any summary, excerpt, date or concern_type.
