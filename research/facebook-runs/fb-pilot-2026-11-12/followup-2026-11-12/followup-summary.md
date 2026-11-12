# Follow-up summary — fb-pilot-2026-11-12, 2026-11-12

This pass resolves the first pilot's gaps from the human review
(`docs/facebook-pilot-review.md`) and the follow-up prompt
(`docs/facebook-followup-prompt.md`). The original run is intact; all
amendments live in this dated follow-up directory. Nothing in the app's
curated inputs was touched. No scores were produced.

## Resolved

- **Coverage format (3 errors → 0).** The amended batch passes the dry-run
  importer: `ok: true`, 0 errors. The three `sources_checked` failures
  (rows 10, 15, 16) are fixed exactly as the review staged them: row 10's
  overlong item reduced to its source label with the narrative preserved
  verbatim in coverage_notes; rows 15/16 converted to JSON arrays with
  nothing added.
- **False review flags (5 warnings → 0).** The five provider-promotion rows
  with submitted `needs_human_review=false` (fb-bos-003/004/007,
  fb-nsh-008/009) now carry true. Their `provider_promotion` labels were
  confirmed correct on re-read; the flag now matches the importer's queue.
  A false flag is not approval.
- **NewBridge metadata (2 corrections).** fb-ssh-009's source context was
  wrong (group thread, not the official Page) and is corrected; fb-ssh-002
  and fb-ssh-003 do not share a thread (two different Page posts) and their
  notes say so now.
- **NewBridge candidates (26 rows, each verified from its own comment).**
  6 verified as the SNF cms-225774 (016, 017, 021, 027, 030, 031), 14
  probable SNF on thread context only, 6 probable campus memory care. The
  coverage count reconciles exactly: 8 exact + 26 candidates = 34. Two
  content errors also fixed: fb-ssh-012's care level is memory care (the
  comment explicitly mentions dementia care) and fb-ssh-021's summary now
  includes its Hebrew Rehab comparison.
- **MGB trio (1 linked case, not 3 events).** fb-nww-001/002/003 carry a
  linked-case note: three related staff accounts from the same MNA labor
  dispute, not three independent signals and not a prevalence measure.
  Allegations stay reported allegations, not confirmed events. No
  `duplicate_of` set — three distinct posts, dates and claims. fb-nww-003's
  source could not be re-read (404); the note records that the stored
  summary rests on the collector's read plus the public index match.
- **Coverage counts (6 providers).** All six importer-flagged counts
  reconciled with explicit observation IDs and stand as written. No count
  changed. fb-bos-006 was found to match a different catalog record
  (ma-alr-edelweiss-village) and is assignment A1, not a silent
  reassignment.
- **Duplicate groups (15 groups, 51 observations).** Re-derived mechanically
  and reviewed semantically. **0 verified duplicates**; no `duplicate_of`
  set anywhere. The three identical-summary groups are collector template
  sentences for distinct name-only comments. fb-nsh-011/012 are one comment
  recorded as two provider-specific observations — not a duplicate account
  and not two independent recommendations.

## Unresolved (still open)

- **Six importer warnings remain** (`unresolved_count`, one per provider:
  cms-225540, cms-225759, abc-home-healthcare, cms-225634,
  lifeplan-newbridge-on-the-charles, south-shore-vna). They are structural:
  the reported counts include unresolved candidates, which the importer
  cannot assign automatically. The reconciliation behind each count is
  documented in the amendment log; the warnings clear only when a future
  assignment resolves the underlying candidates.
- **All 71 rows still need human review** before any publication or scoring
  decision. This pass checked them (65 by an agent's source or group
  review, 6 by batch-file consistency check plus the importer's mechanical
  validation). A check record is not approval; the staged artifact still
  enforces `needsHumanReview=true`, `publishable=false`,
  `scoreEligible=false` on every row.
- **Entities verified but not in this batch's 20 IDs** stay unassigned here
  and go to the assignment list: cms-225774 (A4, 6 verified + 14 probable),
  ma-alr-edelweiss-village (A1), ma-alr-newbridge-on-the-charles (A5, no
  row verifies it yet).
- **Two threads need a human to open them directly:** fb-ssh-001's nested
  reply that might confirm Weymouth (A2) and the unverified Wareham
  negative-comment lead (A7). The CLI cannot retrieve nested replies.
- **fb-nww-003's source is unrecoverable through the CLI** (404). If the
  post was deleted, treat the source as unrecoverable rather than
  re-verified.
- **Method gap (A8):** Facebook Recommendations cannot be enumerated via
  the CLI, which bites hardest for Lasell Village and Waterstone at
  Wellesley.
- **Reuse caution:** the Everything Local Dedham/Westwood and Beyond group
  (OPEN, 32,000 members) and the North Shore Resources for Seniors group
  both ask that shared content stay in the group. The research used public
  sources under the protocol, but the rule is a caution for any future
  publication.

## Validation

- Diff of the amended files against the originals: exactly 38 changed
  cells (4 coverage-format + 34 substantive) and no others.
- Dry-run importer on the complete amended batch, run 2026-11-12 from the
  repository root with the original 20-ID assignment and the kit catalog:
  `ok: true`, 0 errors, 6 warnings (all `unresolved_count`, structural).
  Before this pass the same command gave 3 errors and 11 warnings.
- 71 observations, 20 coverage rows, 0 restricted rows rejected, 521
  catalog providers.

## Deliverables in this directory

- `observations-amended.csv`, `coverage-amended.csv` — the corrected batch.
- `amendment-log.md` — every changed cell plus the per-row review record
  for all 71 observations.
- `assignment-list.md` — A1–A8.
- `assigned-provider-ids.json` — the original 20-ID assignment used for
  the dry run.
- `apply-amendments.py` — the script that applied the amendments, with
  current-value assertions and field-length caps.
- `scratch/` — the four findings files behind this pass
  (`newbridge-findings.md`, `mgb-testimonials-findings.md`,
  `reconciliation-findings.md`, `duplicate-groups-findings.md`).
