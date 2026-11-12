# Coverage-count reconciliation — task 5 (five providers, excluding NewBridge)

Run: `fb-pilot-2026-11-12`. Follow-up prompt:
`docs/facebook-followup-prompt.md`, item 5. Human review that motivated it:
`docs/facebook-pilot-review.md`. Protocol: `collection-protocol.md` v0.1.

Scope: reconcile `coverage.csv` `observations_found` against exact-attributed
rows for `cms-225540`, `cms-225759`, `abc-home-healthcare`, `cms-225634` and
`south-shore-vna`. NewBridge (`lifeplan-newbridge-on-the-charles`) is handled
by another agent and is not covered here.

Method: every source named below was re-read on 2026-11-12 (~12:16 UTC) via
`facebook-cli post read --url` and `facebook-cli post comments read
--post-id`, plus one `browser.search` used only to document a secondary
signal (see cms-225634). No CSV was edited. No groups were joined, no
messages sent, no private material copied. No names, medical details or new
quotations were added beyond the short redacted summaries already in the
batch; the only quoted fragments below are the few words needed to show what
a source does or does not say.

Standing rule applied throughout: `observations_found` counts rows found
while searching that provider (protocol: "counts rows, not people"). A row
that is a probable/unresolved candidate still counts as a row found. The
gap between the reported count and the exact-attributed count is therefore
expected wherever a candidate exists; it is not by itself an error. The
verdict on each count is whether the reported number equals the number of
rows actually retrieved for that provider's search.

## 1. cms-225540 — German Center for Extended Care (nursing-home, 2222 Centre St, Boston)

- Reported count: 1. Exact-attributed rows: 0.
- Candidate rows belonging to this provider's search: `fb-bos-006`
  (unresolved, provider_id blank).
- Verdict: **count stands as written (1).**
- Evidence: re-read of the source post (Senator Mike Rush, posted
  2026-02-18, public, visibility verified) confirms the caption names the
  visit as to "German Center Edelweiss Village assisted living in West
  Roxbury". The account is about the Edelweiss Village assisted-living unit
  on the same campus, not the German Center for Extended Care nursing unit.
  The collector's `match_reason` is accurate, and the row is correctly
  unresolved with a blank provider_id. No resident/family account about the
  nursing unit was found in this run, and the coverage row already says so
  (`status: ambiguous_only`).
- Additional finding: the candidate's subject matches a different catalog
  record, `ma-alr-edelweiss-village` (Edelweiss Village, assisted-living,
  2220 Centre St, Boston-West Roxbury). Name, care level and town all match
  the source. That record was not in the 20-provider batch, so the row was
  not assigned to it. This is recorded as a follow-up assignment below, not
  silently reassigned.
- Remaining uncertainty: none about the count or the match. Whether
  `fb-bos-006` should be reassigned to `ma-alr-edelweiss-village` is a
  parent decision (see proposed amendments): reassignment would put a
  provider_id outside the 20-ID manifest, and the importer behaviour for
  that is unconfirmed.

## 2. cms-225759 — RECUPERATIVE SERVICES UNIT-HEBREW REHAB CENTER (nursing-home, 1200 Centre St, Boston)

- Reported count: 1. Exact-attributed rows: 0.
- Candidate rows belonging to this provider's search: `fb-bos-008`
  (probable, provider_id blank).
- Verdict: **count stands as written (1).**
- Evidence: re-read of the source post (Hebrew SeniorLife, posted
  2026-08-19, public, visibility verified) confirms the caption is about
  annual floor cookouts at "Hebrew Rehabilitation Center - Boston"
  generally. It does not name the Recuperative Services Unit, any unit, or
  any care level. The row is correctly probable with a blank provider_id,
  and correctly classified `provider_promotion` (provider-published event
  post, not a resident or family care account). No resident/family account
  about the Recuperative Services Unit was found in this run, and the
  coverage row already says so (`status: ambiguous_only`).
- Additional finding: no center-level catalog record for Hebrew
  Rehabilitation Center - Boston exists (catalog search for "hebrew"
  returns only `cms-225759`), so there is no alternate record to assign
  this row to. The row stays a center-general probable candidate.
- Remaining uncertainty: none about the count or the match. The usual
  coverage limit applies (unmanaged Page posts cannot be listed via the
  CLI; only posts surfaced by search were read).

## 3. abc-home-healthcare — ABC Home Healthcare Professionals (staffing/home care, 233 Albion St, Wakefield)

- Reported count: 2. Exact-attributed rows: 1.
- Exact-attributed rows: `fb-nsh-002` (exact, provider_id
  `abc-home-healthcare`).
- Candidate rows belonging to this provider's search: `fb-nsh-001`
  (unresolved, provider_id blank).
- Verdict: **count stands as written (2).**
- Evidence: re-read of `fb-nsh-002` (staff hiring post, posted 2026-08-13,
  public, visibility verified) confirms the post itself directs applicants
  to "ABC home care Wakefield Ma". Town and home-care service match the
  catalog record (Wakefield, 233 Albion St). The exact match stands. The
  row is a staff recruitment post, not a care account, and is already
  recorded that way (`relationship: staff`, `experience_stage: employment`,
  no resident/family care described).
- Evidence: re-read of `fb-nsh-001` (recommendation post, posted 2026-08-24,
  public, visibility verified) confirms the caption names only "ABC Home
  Healthcare and Senior Services" with no town, address or other link to
  the Wakefield record. Its single comment (from the tagged person) adds
  no location information. The row is correctly unresolved with a blank
  provider_id. No catalog record matches the "and Senior Services" name
  variant (catalog search for "abc home" returns only
  `abc-home-healthcare`).
- Remaining uncertainty: none about the count or either match. The
  collector's notes record that a similarly named Maryland company
  dominates name searches; that exclusion is not re-verified here beyond
  the catalog check, but it does not affect these two rows.

## 4. cms-225634 — Care One at Weymouth (nursing-home, 64 Performance Dr, Weymouth)

- Reported count: 1. Exact-attributed rows: 0.
- Candidate rows belonging to this provider's search: `fb-ssh-001`
  (probable, provider_id blank).
- Verdict: **count stands as written (1). The match does not upgrade to
  exact on currently retrievable evidence.**
- Evidence: re-read of the source post (posted 2026-07-08, public)
  confirms the caption says only "I'm at Care One For rehabilitation for
  a couple of weeks" — no town, no address, no location. The post's
  comment thread was paged in full via the CLI: 71 of 73 top-level
  comments retrieved across 4 pages (2 short of the stated count; no
  further cursor returned). None of the 71 names Weymouth, Care One, or
  any location. The author's own comment in the thread states the medical
  reason for the stay (myocarditis, fractured ribs) but no location.
  Three comments carry nested replies (reply counts 1, 2 and 1); nested
  reply text is not exposed by the CLI, so the reply to "what hospital
  in?" cannot be read through this route.
- Secondary signal, not used as evidence: a web-search summary of the
  same thread reports the author's own reply as naming Care One in
  Weymouth. That is a secondary, generated summary, not retrievable
  source text, and per the task rules a search snippet alone cannot fill
  the gap. It is documented here only so a human reviewer knows exactly
  where to look: open the thread directly and read the nested reply to
  the "what hospital in?" comment.
- Remaining uncertainty: the one nested reply that may confirm Weymouth
  is unretrieved. Until a human opens the thread (or a browser session
  reads it), `fb-ssh-001` stays probable with a blank provider_id. The
  coverage row's `status: partial` already reflects the incomplete
  verification.

## 5. south-shore-vna — South Shore Visiting Nurse Association (South Shore Health) (home-health, 30 Reservoir Park Dr, Rockland)

- Reported count: 2. Exact-attributed rows: 0.
- Candidate rows belonging to this provider's search: `fb-ssh-046` and
  `fb-ssh-047` (both unresolved, provider_id blank).
- Verdict: **count stands as written (2).**
- Evidence: re-read of the source thread (posted 2026-11-07, public) and
  all 4 of its comments confirms the entity cannot be established. The
  post text is garbled and names only "South Shore" services and "the
  visiting nurse". The comments name "pathways", "the VNA", "meals on
  wheels" and Old Colony Elder Services ("Old colony elder services took
  over!"). No comment names "South Shore VNA" or "South Shore Visiting
  Nurse Association". Both rows are correctly unresolved with blank
  provider_ids. `fb-ssh-046` is the author's post; `fb-ssh-047` is a
  different commenter's comment in the same thread; they are related
  accounts in one thread, not independent signals, and the rows already
  record that in `independence_notes`. The coverage row's `status:
  partial` fits: no exact-match VNA care account was found.
- Remaining uncertainty: none about the count or the matches. Two standing
  notes, neither affecting the count: the catalog lists the VNA at 30
  Reservoir Park Drive while one directory listing gives 100 Bay State
  Drive, Rockland (address discrepancy already in the collector's notes,
  unresolved); and the thread's garbled text means the underlying
  complaint's target service remains unidentified even in principle —
  a human re-read is unlikely to resolve it beyond what is recorded.

## Summary of verdicts

| Provider | Reported | Exact | Candidates | Verdict |
| --- | --- | --- | --- | --- |
| cms-225540 | 1 | 0 | fb-bos-006 (unresolved) | stands |
| cms-225759 | 1 | 0 | fb-bos-008 (probable) | stands |
| abc-home-healthcare | 2 | 1 | fb-nsh-001 (unresolved); fb-nsh-002 (exact) | stands |
| cms-225634 | 1 | 0 | fb-ssh-001 (probable) | stands; no upgrade to exact |
| south-shore-vna | 2 | 0 | fb-ssh-046, fb-ssh-047 (unresolved) | stands |

All five reported counts equal the number of rows retrieved for that
provider's search. No count changes. No provider_id changes are proposed
as default; one reassignment is offered below as an explicit parent
decision.

## Proposed amendments

(Fields are in the original `observations.csv` / `coverage.csv` unless
noted. "No change" rows are listed so the parent can see each count was
considered.)

1. Coverage row `cms-225540`, field `coverage_notes`: current value ends
   "...must not be transferred to the nursing-home record. No
   resident/family account about the German Center for Extended Care
   nursing unit was found in this run." Proposed value: append "Re-read
   2026-11-12 confirms the visit was to the Edelweiss Village
   assisted-living unit. The candidate's subject matches catalog record
   ma-alr-edelweiss-village (Edelweiss Village, assisted-living, 2220
   Centre St, Boston-West Roxbury); see follow-up assignment A1." Reason:
   records the verified alternate-record match without changing the count
   or the row's status.
2. Coverage row `cms-225634`, field `coverage_notes`: current value ends
   "...Weymouth location not directly verifiable." Proposed value: append
   "Re-read 2026-11-12: 71 of 73 top-level comments retrieved via the
   CLI, none names a location; nested replies are not exposed by the CLI.
   A web-search summary of the thread reports the author's own reply as
   naming Care One in Weymouth, but that is a secondary summary, not
   retrievable source text. A human should open the thread directly and
   read the nested reply to the 'what hospital in?' comment before any
   upgrade to exact." Reason: preserves the exact state of verification
   and the one concrete step that could resolve it.
3. Observation `fb-ssh-001`, field `match_reason`: current value ends
   "...human review should verify on the thread before treating as
   exact." Proposed value: append "Re-read 2026-11-12: 71 of 73
   top-level comments retrieved, none names a location; nested replies
   not retrievable via the CLI." Reason: the row now carries the evidence
   for why it stays probable.
4. Coverage row `cms-225540`, field `observations_found`: current value
   1. Proposed value: no change. Reason: the row counts rows found
   during the search, and `fb-bos-006` was found during it.
5. Coverage row `cms-225759`, field `observations_found`: current value
   1. Proposed value: no change. Reason: `fb-bos-008` was found during
   the search and is correctly a probable candidate.
6. Coverage row `abc-home-healthcare`, field `observations_found`:
   current value 2. Proposed value: no change. Reason: `fb-nsh-002`
   exact plus `fb-nsh-001` unresolved candidate, both verified by
   re-read.
7. Coverage row `cms-225634`, field `observations_found`: current value
   1. Proposed value: no change. Reason: `fb-ssh-001` was found during
   the search and stays probable.
8. Coverage row `south-shore-vna`, field `observations_found`: current
   value 2. Proposed value: no change. Reason: `fb-ssh-046` and
   `fb-ssh-047` were found during the search and stay unresolved.
9. Observation `fb-bos-006`, fields `provider_id` / `match_status`:
   current values blank / unresolved. Proposed value: no change by
   default. Alternative for explicit parent decision only: set
   `provider_id` to `ma-alr-edelweiss-village` and `match_status` to
   exact, update `match_reason` to record the exact match to that
   record, and set `cms-225540` coverage `observations_found` to 0 with
   `status` `searched_no_relevant_result`. Reason for flagging rather
   than applying: the reassignment would put a provider_id outside the
   20-ID manifest and its effect on importer validation is unconfirmed;
   the safer default is to keep the row as an unresolved candidate and
   carry the alternate record as a follow-up assignment.

## Follow-up assignments arising from this task

- A1: `ma-alr-edelweiss-village` (Edelweiss Village, assisted-living, 2220
  Centre St, Boston-West Roxbury). Candidate observation `fb-bos-006`
  (Sen. Rush visit, 2026-02-18) appears to match this record exactly
  (name, assisted-living care level, West Roxbury). Include this record
  in a future batch or confirm the assignment out of band; do not
  silently reassign the row in this run.
- A2: `cms-225634` thread re-read. Human to open the fb-ssh-001 thread
  directly (source URL in the row) and read the nested reply to the
  "what hospital in?" comment. If the author's reply names Care One in
  Weymouth, `fb-ssh-001` may upgrade to exact; if it names another
  location or is inconclusive, the row stays probable. Thread URL is in
  the observation row; the post is also findable under the author's
  vanity URL.
- A3: `south-shore-vna` address discrepancy (catalog 30 Reservoir Park
  Drive vs a directory listing at 100 Bay State Drive, Rockland). Catalog
  correction, not a count issue; already noted in the collector's notes.
