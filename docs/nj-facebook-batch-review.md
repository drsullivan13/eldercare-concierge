# Union and Morris Facebook research reconciliation

The source branch is `research/north-jersey-fb-2026-11-12` at `0041ba3fa1c111f630865834d765206c3280e002`. The collector returned 17 assignments, 17 coverage rows, 65 observations and two aggregate candidates. Thirteen of Harbor's original 20 assignments have identifiable coverage in this batch. The twelve facility assignments retain their original IDs. The thirteenth, VNA, has a collector-local ID but its CMS source, certification number 317002, care setting, and complete Morristown office address match the Harbor kit.

The follow-up covers both historical campuses, four registered offices and the certified BAYADA office in Cranford. The source batch substituted a licensed unit at 537 Mountain Avenue for the Lantern Hill campus at 535, a different Commerce Drive address for BAYADA Cranford, and two Visiting Angels offices for registered-office assignments. Preserve these original rows for review. [Follow-up prompt](../research/north-jersey/facebook/reconciliation/followup-agent-prompt.md)

The 65 rows include 43 promotions and 12 records the collector classified as firsthand. Seven of the latter identify a family member or resident, and three of those match an exact location and describe current or previous care. The three Denville campus candidates remain unassigned to either licensed unit. The reported VNA and Atria aggregates came from search-indexed material and require live page checks. Six coverage rows have declared counts that cannot be reconstructed from exact observation links. Eleven observations have no provider ID. None of the observations or aggregate candidates have entered the runtime score.

## Reproduce the audit

Fetch the pinned research branch if it is absent locally. Run from the repository root.

```sh
python3 -B scripts/regions/facebook-kit.py --check
python3 -B scripts/regions/facebook-batch.py
python3 -B scripts/regions/facebook-batch.py --check
python3 -B scripts/regions/facebook-batch-test.py
```

The audit reads the pinned Git objects internally, validates identities against the generated kit and emits a redacted assignment ledger. Exit code 2 on this batch records the unresolved source-count discrepancies and keeps the private import pending. The follow-up roster concerns search coverage. An exact identity alone does not establish the truth of a narrative or the eligibility of a rating.
