# Duplicate-candidate group review — fb-pilot-2026-11-12 (task 6b)

Date of review: 2026-11-12. Reviewer: follow-up agent (task 6b).
Sources read: `research/facebook-runs/fb-pilot-2026-11-12/observations.csv`
(71 rows), `collection-protocol.md` v0.1,
`src/lib/research-pipeline/import.ts` (duplicate-group logic),
`docs/facebook-pilot-review.md`, `docs/facebook-followup-prompt.md`, and the
per-market collector notes in `scratch/`. No CSV was edited. Findings and
proposed changes only; the parent applies them.

## Method

The importer's mechanical grouping was reproduced from its code, not from the
review's summary:

- `shared-source-or-source-edit`: rows sharing a source key, where the key is
  the identity URL of `source_url` (falling back to `thread_url`) plus the
  provider ID, or (match status + lowercase candidate name) when the ID is
  blank. Identity URLs strip fragments, drop `utm_*`/`fbclid`/`gclid`
  parameters, and sort remaining parameters.
- `shared-thread`: rows sharing the identity URL of `thread_url`.
- `repeated-location-summary`: rows sharing provider ID (or candidate name)
  plus the summary text lowercased.

A Python replica of that logic (kept at `/tmp/derive-groups.py`, not part of
the batch) was run against the original `observations.csv`.

## Derivation result — reproduced exactly

- **15 groups, 51 observations in the union** (60 group memberships).
  Breakdown: 11 shared-thread, 3 repeated-location-summary,
  1 shared-source-or-source-edit. This matches the human review's counts.
- **0 exact source+content collisions**: no pair of rows shares both a source
  key and a content hash, so the importer's `duplicate_content` rejection
  would not fire on this batch.
- Overlap structure: G03 and G15 contain the same two rows (one pair grouped
  twice, by thread and by source). G12 is a subset of G09, G13 a subset of
  G10, G14 a subset of G07 (the repeated-summary groups sit inside the
  shared-thread groups of the same threads).

| Group | Reason | Members |
| --- | --- | --- |
| G01 | shared-thread | fb-ssh-036, fb-ssh-037 |
| G02 | shared-thread | fb-bos-004, fb-bos-005 |
| G03 | shared-thread | fb-nsh-004, fb-nsh-005 |
| G04 | shared-thread | fb-nsh-007, fb-nsh-010, fb-nsh-011, fb-nsh-012 |
| G05 | shared-thread | fb-ssh-038, fb-ssh-039, fb-ssh-040, fb-ssh-041, fb-ssh-042, fb-ssh-043, fb-ssh-044 |
| G06 | shared-thread | fb-ssh-004, fb-ssh-005, fb-ssh-006, fb-ssh-007, fb-ssh-008 |
| G07 | shared-thread | fb-ssh-030, fb-ssh-031, fb-ssh-032, fb-ssh-033, fb-ssh-034, fb-ssh-035 |
| G08 | shared-thread | fb-ssh-009, fb-ssh-010, fb-ssh-011, fb-ssh-012, fb-ssh-013, fb-ssh-014, fb-ssh-015, fb-ssh-016, fb-ssh-017 |
| G09 | shared-thread | fb-ssh-021, fb-ssh-022, fb-ssh-023, fb-ssh-024, fb-ssh-025, fb-ssh-026, fb-ssh-027, fb-ssh-028, fb-ssh-029 |
| G10 | shared-thread | fb-ssh-018, fb-ssh-019, fb-ssh-020 |
| G11 | shared-thread | fb-ssh-046, fb-ssh-047 |
| G12 | repeated-location-summary | fb-ssh-022, fb-ssh-023, fb-ssh-026 |
| G13 | repeated-location-summary | fb-ssh-018, fb-ssh-020 |
| G14 | repeated-location-summary | fb-ssh-032, fb-ssh-034 |
| G15 | shared-source-or-source-edit | fb-nsh-004, fb-nsh-005 |

## Semantic verdicts — summary

- **Verified duplicates (`duplicate_of` proposed): 0.**
- **Related-but-distinct groups: 15 of 15.**
- No group contains two rows recording the same account twice. Every group
  is either distinct comments in one thread, one comment split into two
  provider attributions (G04, fb-nsh-011/012), or identical collector
  template summaries for distinct name-only comments (G12/G13/G14).
- The only comment ID appearing in more than one row's `source_url` is
  2141125203096414 (fb-nsh-011/012) — one comment, two provider-specific
  observations, not a duplicate account.
- The only identical `source_url` values are fb-nsh-004/005 (both use the
  bare post URL; each is a distinct comment on that post) and fb-nsh-011/012
  (same comment URL).

Evidence classes were kept distinct throughout: facility-published
testimonials stay `provider_promotion` (G02), staff/employment accounts stay
employment (G08 fb-ssh-009), tours stay tours (G04 fb-nsh-010, G05
fb-ssh-042), hearsay stays hearsay (G05 fb-ssh-043), and recommendations
without detail are not treated as care experiences. No group mixes a
testimonial with an independent care account as if they were the same kind
of evidence.

## Group reviews

### G01 — shared-thread — fb-ssh-036, fb-ssh-037

Thread: the All American Assisted Living at Wareham summer BBQ post
(2026-08-12). Two distinct comments with distinct comment IDs.
fb-ssh-036 is a family firsthand account praising staff on Rose Lane;
fb-ssh-037 is a family firsthand account saying a mother-in-law is genuinely
happy there. Different claims about different aspects of the same facility.
**Verdict: related-but-distinct. No `duplicate_of`.** Existing
independence notes already state the shared thread and different commenters;
no amendment proposed.

### G02 — shared-thread — fb-bos-004, fb-bos-005

Thread: the Laurel Ridge testimonial post (2026-09-17). fb-bos-004 is the
facility-published testimonial graphic itself (provider promotion, resident,
previous short-term rehab care). fb-bos-005 is a recommendation-without-detail
comment posted on that testimonial, by a different author, with no supporting
detail. Different evidence classes: promotional testimonial vs a comment
reacting to promotional material. The comment must not be counted as an
independent care account, and the two rows must not be counted as two
independent care experiences.
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes are
accurate (004 states the testimonial's provider-selected nature; 005 states
it is a comment on the same thread by a different author); no amendment
proposed.

### G03 — shared-thread — fb-nsh-004, fb-nsh-005

Thread: the Aberjona retirement-celebration post (2026-09-12). Both rows use
the bare post URL as `source_url`, which is why they also form G15.
**Re-read 2026-11-12 via facebook-cli** (`post comments read` on the post):
14 comments returned. The comment matching fb-nsh-004's summary (daily
visits and chats bringing joy to the commenter's mother and comfort to the
commenter) and the comment matching fb-nsh-005's summary (an aunt currently
resident, appreciation for the care) are two distinct comment objects with
distinct IDs, distinct text, and timestamps about 14 hours apart. Different
claims (mother's previous care vs aunt's current residence).
**Verdict: related-but-distinct. No `duplicate_of`.**
Gap: both rows' `independence_notes` currently read only "independence
unestablished" and do not mention the shared thread at all, even though the
importer groups them twice. Amendments proposed below.
Handoff to task 2 (not an amendment here): comment-level permalinks for both
rows are obtainable from the re-read — the thread URL plus
`?comment_id=1852042076229294` (fb-nsh-004) and `?comment_id=1063858716376990`
(fb-nsh-005). The comment text names the mother in fb-nsh-004; that name was
correctly redacted from the submitted summary and is not reproduced here.

### G04 — shared-thread — fb-nsh-007, fb-nsh-010, fb-nsh-011, fb-nsh-012

Thread: the 2026-03-28 assisted-living advice thread in the open group
"North Shore Resources for Seniors" (63 comments claimed; 32 top-level
comments read, nested replies not retrieved). Four distinct comment objects
with distinct comment IDs, except fb-nsh-011 and fb-nsh-012, which share
comment ID 2141125203096414: **one comment naming two providers, recorded as
one observation per provider.** fb-nsh-007 is a firsthand family account
(father at Brooksby, mixed, billing/personal-care/admission-transition).
fb-nsh-010 is a tour pricing note ($100,000 starting figure). fb-nsh-011
recommends Brooksby; fb-nsh-012 recommends Kaplan Estates — the same
comment's two provider-specific claims.
**Verdict: related-but-distinct. No `duplicate_of`.** 011/012 are not the
same experience recorded twice; they are two provider attributions of one
comment. They must not be counted as two independent recommendations.
Amendments proposed below for 011/012 to state the counting consequence
explicitly. The existing notes for 007/010 are accurate; no amendment
proposed for them.
Cross-reference (task 3, not this task): all four rows sit in an
assisted-living advice thread; care level is unstated for the campus
attributions.

### G05 — shared-thread — fb-ssh-038 through fb-ssh-044

Thread: the 2026-01-08/09 public opinions thread about All American Assisted
Living at Wareham (7 comments). Seven distinct comment objects with distinct
comment IDs, spanning four evidence classes that must stay separate:
recommendation without detail (038, 044), firsthand praise with no
relationship stated (039), family firsthand accounts (040 cousin resident
about a year; 041 brother-in-law's previous stay), a tour experience only
(042), and hearsay only (043). No two rows are the same comment and no two
describe the same experience.
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes already
state the shared thread and different commenters; no amendment proposed.
Counting caution: seven comments are not seven verified independent
households.

### G06 — shared-thread — fb-ssh-004 through fb-ssh-008

Thread: the June–July 2023 assisted-living recommendations thread in the open
Dedham/Westwood group. Five distinct comment objects with distinct comment
IDs and distinct claims: a sister's 1.5-year stay (004, family firsthand),
a name-only recommendation (005), a grandmother's stay (006, family
firsthand), a geriatric care manager's recommendation (007), and a mother's
long residence (008, family firsthand). All are historical accounts (2023),
kept with dates.
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes are
accurate; no amendment proposed.
Cross-reference (task 3, not this task): all five are attributed exact to the
life-plan campus from an assisted-living recommendations thread with no
stated care level.

### G07 — shared-thread — fb-ssh-030 through fb-ssh-035

Thread: the November 2024 skilled-nursing recommendations thread in the open
Dedham/Westwood group. Six distinct comment objects with distinct comment
IDs, all recorded as unresolved SNF candidates: a mother's good rehab care
(030, family firsthand), a "best, hard to get into for rehab" comment (031),
three name-only recommendations (032, 033 with an emphatic endorsement, 034),
and a recommendation naming Newbridge alongside another facility (035).
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes are
accurate; no amendment proposed. The G14 subset (032/034) is addressed
separately below — identical summaries, distinct comments.

### G08 — shared-thread — fb-ssh-009 through fb-ssh-017

Thread: the January 2025 memory-care recommendations thread in the open
Dedham/Westwood group. Nine distinct comment objects with distinct comment
IDs, and the most heterogeneous group in the batch: an employee endorsement
of the memory-care unit (009, staff, provider promotion — an employment
account, not a care account), mixed family firsthand (010, mother at both
NewBridge and Benchmark, Benchmark better), positive family firsthand (011,
012), a name-only recommendation with a superlative (013), a care manager's
list including NewBridge (014), a negative name-only reply (015, "stay away",
conflicting with the positive recommendations in the same thread), and two
firsthand rehab/SNF accounts (016, 017, unresolved SNF candidates).
Conflicting views in one thread are preserved, not resolved: 010 and 015
contradict the positive rows.
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes are
accurate; no amendment proposed. Evidence classes must stay distinct in any
synthesis: 009 is staff advocacy, 014 is professional recommendation, 016/017
concern the rehab unit, not memory care as experienced.

### G09 — shared-thread — fb-ssh-021 through fb-ssh-029

Thread: the March 2025 rehab recommendations thread in the open
Dedham/Westwood group. Nine distinct comment objects with distinct comment
IDs, all unresolved SNF candidates: a mother's two good rehab stays (021,
family firsthand), four name-only or emphatic recommendations (022, 023, 025,
026), a recommendation naming Newbridge alongside two other facilities
(024), a detailed negative firsthand account (027, husband's horrible
experience — terrible care, limited food, broken window, almost no evening
staff; concern type service), a negative recommendation (028, "never
NewBridge"), and a recommendation naming Newbridge or Hebrew Rehab while
ruling out two others (029). Positive and negative accounts sit in the same
thread; neither side may be read as the thread's consensus.
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes are
accurate; no amendment proposed. The G12 subset (022/023/026) is addressed
separately below — identical summaries, distinct comments.

### G10 — shared-thread — fb-ssh-018, fb-ssh-019, fb-ssh-020

Thread: the April 2025 short-term rehab recommendations thread in the open
Dedham/Westwood group. Three distinct comment objects with distinct comment
IDs: two name-only positive recommendations (018, 020) and one negative
firsthand account (019, "would put a loved one in a tree house before putting
anyone at Newbridge again", concern type unclear, conflicting with the
positive recommendations in the same thread).
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes are
accurate; no amendment proposed. The G13 subset (018/020) is addressed
separately below — identical summaries, distinct comments.

### G11 — shared-thread — fb-ssh-046, fb-ssh-047

Thread: a public personal-profile post dated 2026-11-07 (visibility verified
public in the re-read). **Re-read 2026-11-12 via facebook-cli** (`post read`
and `post comments read`): fb-ssh-046 is the original post itself (garbled
text about South Shore services, the visiting nurse, "pathways", and an
insurance company saying help is needed while none is sent). fb-ssh-047 is a
reply comment by a different commenter (about how "pathways" is run in the
VNA), posted 2026-11-08. The thread has four comments in total: the author's
own follow-up, the 047 comment, a sympathetic comment adding no content, and
a comment pointing the complaint at Old Colony Elder Services (not recorded
as an observation). The post author and the 047 commenter are different
profiles. The responsible entity remains unestablished in both rows.
**Verdict: related-but-distinct. No `duplicate_of`.** Existing notes already
state the shared thread and different commenters, and 047's note already
records the third commenter pointing at a different organization; no
amendment proposed. The two rows are distinct accounts in one thread, not
two independent cases and not one duplicated case.

### G12 — repeated-location-summary — fb-ssh-022, fb-ssh-023, fb-ssh-026

Members of G09. The three summaries are character-identical because the
collector used one template sentence for name-only recommendation comments
("replied to a rehab recommendations request with only the facility name").
Each row has a distinct comment ID and the collector notes record different
commenters. The identical text is a template artifact, not evidence of
duplication: three separate comments, each naming only the facility.
**Verdict: related-but-distinct (false positive of the mechanical check).
No `duplicate_of`.** Amendments proposed below: add to each row's
`independence_notes` that the identical summary text is a collector template
for name-only comments, so a future reader does not mistake it for one
comment recorded three times.

### G13 — repeated-location-summary — fb-ssh-018, fb-ssh-020

Members of G10. Same pattern as G12: identical template summaries for two
distinct name-only comments in the short-term rehab recommendations thread
(distinct comment IDs, different commenters per collector notes).
**Verdict: related-but-distinct (false positive of the mechanical check).
No `duplicate_of`.** Amendments proposed below.

### G14 — repeated-location-summary — fb-ssh-032, fb-ssh-034

Members of G07. Same pattern as G12/G13: identical template summaries for
two distinct name-only comments in the skilled-nursing recommendations
thread (distinct comment IDs, different commenters per collector notes).
**Verdict: related-but-distinct (false positive of the mechanical check).
No `duplicate_of`.** Amendments proposed below.

### G15 — shared-source-or-source-edit — fb-nsh-004, fb-nsh-005

Same pair as G03. The shared-source grouping arises because both rows use
the bare post URL as `source_url` (no comment ID), so the source key falls
back to the same identity URL plus the same provider ID. See G03 for the
re-read verification: two distinct comments on the retirement post, different
claims. **Verdict: related-but-distinct. No `duplicate_of`.** Same amendments
as G03 (shared-thread note missing from both rows). The obtainable
comment-level permalinks are a task-2 handoff, recorded under G03.

## Proposed amendments

All amendments are to `independence_notes` only. **No `duplicate_of` value is
proposed for any row** — no verified duplicate account was found. All other
rows in the 15 groups keep their existing `independence_notes`; their notes
already state the shared thread and distinct commenters accurately.

| observation_id | field | current value | proposed value | reason |
| --- | --- | --- | --- | --- |
| fb-nsh-004 | independence_notes | independence unestablished | Distinct comment on the facility's retirement-celebration post (2026-09-12); shares the thread and the bare post URL as source with fb-nsh-005, a separate comment about an aunt currently resident. Different claims (mother's previous care vs aunt's current residence); not duplicates; independence unestablished. | G03/G15: the shared thread is not mentioned in the current note at all, although the importer groups the pair twice. |
| fb-nsh-005 | independence_notes | independence unestablished | Distinct comment on the facility's retirement-celebration post (2026-09-12); shares the thread and the bare post URL as source with fb-nsh-004, a separate comment about a mother's previous care. Different claims; not duplicates; independence unestablished. | G03/G15: same gap as fb-nsh-004. |
| fb-nsh-011 | independence_notes | Same comment as fb-nsh-012; separate provider-specific claims from one comment. Same thread as fb-nsh-007 and fb-nsh-010. | Same comment as fb-nsh-012: one comment naming two providers, recorded as one observation per provider. Not two independent recommendations and not a duplicate account; shares the advice thread with fb-nsh-007 and fb-nsh-010, which are distinct comments; independence unestablished. | G04: the current note states the shared comment but not the counting consequence — the pair must never be read as two independent recommendations. |
| fb-nsh-012 | independence_notes | Same comment as fb-nsh-011; separate provider-specific claims from one comment. Found during the Brooksby Village thread review; counts toward Kaplan Estates coverage. | Same comment as fb-nsh-011: one comment naming two providers, recorded as one observation per provider. Not two independent recommendations and not a duplicate account; counts toward Kaplan Estates coverage; independence unestablished. | G04: same counting consequence as fb-nsh-011. |
| fb-ssh-018 | independence_notes | Shares thread with fb-ssh-019, fb-ssh-020; different commenters; independence unestablished | Shares thread with fb-ssh-019, fb-ssh-020; different commenters; independence unestablished. Summary text is identical to fb-ssh-020 because each comment named only the facility (collector template for name-only comments), not because it is the same comment; distinct comment objects, not duplicates. | G13: identical summaries are a template artifact; without this note a future reader would reasonably suspect duplication. |
| fb-ssh-020 | independence_notes | Shares thread with fb-ssh-018, fb-ssh-019; different commenters; independence unestablished | Shares thread with fb-ssh-018, fb-ssh-019; different commenters; independence unestablished. Summary text is identical to fb-ssh-018 because each comment named only the facility (collector template for name-only comments), not because it is the same comment; distinct comment objects, not duplicates. | G13: same as fb-ssh-018. |
| fb-ssh-022 | independence_notes | Shares thread with fb-ssh-021, fb-ssh-023 through fb-ssh-029; different commenters; independence unestablished | Shares thread with fb-ssh-021, fb-ssh-023 through fb-ssh-029; different commenters; independence unestablished. Summary text is identical to fb-ssh-023 and fb-ssh-026 because each comment named only the facility (collector template for name-only comments), not because it is the same comment; distinct comment objects, not duplicates. | G12: identical summaries are a template artifact. |
| fb-ssh-023 | independence_notes | Shares thread with fb-ssh-021, fb-ssh-022, fb-ssh-024 through fb-ssh-029; different commenters; independence unestablished | Shares thread with fb-ssh-021, fb-ssh-022, fb-ssh-024 through fb-ssh-029; different commenters; independence unestablished. Summary text is identical to fb-ssh-022 and fb-ssh-026 because each comment named only the facility (collector template for name-only comments), not because it is the same comment; distinct comment objects, not duplicates. | G12: same as fb-ssh-022. |
| fb-ssh-026 | independence_notes | Shares thread with fb-ssh-021 through fb-ssh-025, fb-ssh-027 through fb-ssh-029; different commenters; independence unestablished | Shares thread with fb-ssh-021 through fb-ssh-025, fb-ssh-027 through fb-ssh-029; different commenters; independence unestablished. Summary text is identical to fb-ssh-022 and fb-ssh-023 because each comment named only the facility (collector template for name-only comments), not because it is the same comment; distinct comment objects, not duplicates. | G12: same as fb-ssh-022. |
| fb-ssh-032 | independence_notes | Shares thread with fb-ssh-030, fb-ssh-031, fb-ssh-033 through fb-ssh-035; different commenters; independence unestablished | Shares thread with fb-ssh-030, fb-ssh-031, fb-ssh-033 through fb-ssh-035; different commenters; independence unestablished. Summary text is identical to fb-ssh-034 because each comment named only the facility (collector template for name-only comments), not because it is the same comment; distinct comment objects, not duplicates. | G14: identical summaries are a template artifact. |
| fb-ssh-034 | independence_notes | Shares thread with fb-ssh-030 through fb-ssh-033, fb-ssh-035; different commenters; independence unestablished | Shares thread with fb-ssh-030 through fb-ssh-033, fb-ssh-035; different commenters; independence unestablished. Summary text is identical to fb-ssh-032 because each comment named only the facility (collector template for name-only comments), not because it is the same comment; distinct comment objects, not duplicates. | G14: same as fb-ssh-032. |

## Out-of-scope observations (not amendments)

- **fb-ssh-002/003 thread-URL inconsistency** (follow-up task 2): the two rows
  do not share a thread URL and the importer does not group them. Their
  independence notes already flag the difference ("different post"). No
  duplicate question arises. Left for task 2.
- **Comment permalinks for fb-nsh-004/005** (follow-up task 2): obtainable
  from the G03 re-read (thread URL plus `?comment_id=1852042076229294` and
  `?comment_id=1063858716376990`). Not proposed here because this task's
  amendments cover duplicate/independence notes only.
- **fb-nsh-003** (All Care VNA, not in any mechanical group): a single row
  whose summary already covers two commenters in one thread, with an
  independence note stating the second comment endorses the first and so is
  not a second independent experience. No group, no amendment; noted here
  because it is the same pattern the groups were checked for.
- **NewBridge campus/ALR/SNF attribution** (follow-up task 3): G06 rows are
  attributed exact to the life-plan campus from an assisted-living thread
  with no stated care level, and G07–G10 rows are unresolved SNF candidates.
  Match questions, not duplicate questions; no match changes proposed here.

## Remaining uncertainty

- **Authorship.** Names are not collected by design, so "different
  commenters" rests on the collectors' reads plus distinct comment objects
  (distinct comment IDs, distinct text, distinct timestamps). It was directly
  re-verified only for G03 (two distinct comments on the retirement post)
  and G11 (post author vs reply commenter are different profiles). For the
  other groups, distinct comments are established; distinct households are
  not — two comments could in principle come from the same person, and no
  row should be counted as a verified independent household.
- **Incomplete pagination.** Two NewBridge threads returned partial comment
  sets (assisted-living thread 27/36, SNF thread 19/36, no further cursor);
  the Brooksby advice thread's nested replies were not retrieved (32 of 63
  top-level comments read). Comments beyond those retrieved could contain
  further duplicate-relevant material; nothing beyond the retrieved sample
  was assumed.
- **Closed/private groups.** No private-group material was re-read. The
  Brooksby advice thread sits in an open group whose rules include keeping
  shared content in the group; the review relied on the collector's notes
  and the distinct comment IDs already recorded rather than re-reading that
  thread. The Dedham/Westwood threads sit in an open group; re-reading them
  could not add authorship proof without collecting names, so it was not
  pursued.
- **Collector "different commenters" claims.** Taken as reported for groups
  other than G03/G11. If a future check finds two rows in any group share an
  author, the verdict for that pair should be revisited — but sharing an
  author alone would still not make two different comments about different
  experiences duplicates.
