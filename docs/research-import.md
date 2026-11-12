# Research-kit CSV import

This local CLI validates the Facebook research kit's `observations.csv` and `coverage.csv` and optionally writes a **private, review-only JSON artifact**. It does not fetch sources, contact anyone, write to a database, publish to Harbor, change scores or establish author authenticity. Existing public application data is untouched.

The contract follows `/workspace/harbor-experience-research-kit/collection-protocol.md` and the two supplied CSV templates. The kit's empty templates are headers, not a completed run. Use the exact current application catalog IDs; preserve leading zeroes in any catalog fields. No new dependencies or credentials are needed.

## Run it

From the repository root, with completed research files:

```sh
npx tsx scripts/import-research.ts \
  --observations /path/to/observations.csv \
  --coverage /path/to/coverage.csv \
  --catalog /workspace/harbor-experience-research-kit/harbor-catalog-521.csv \
  --assigned /path/to/assigned-provider-ids.json
```

The default is a dry run. It prints counts, structured validation issues and a batch identifier, with no observation text or artifact writes. Exit status is 0 for a valid batch and 1 for a rejected batch or CLI failure. `--help` lists arguments. An optional `--as-of 2026-11-12T23:59:59Z` makes date validation reproducible; otherwise the current UTC time is used. Do not set a future assessment time to disguise future-dated research.

`--assigned` contains a JSON array of exact provider IDs for this assignment. When supplied, coverage must include each assigned provider exactly once, including `not_searched` rows. Without it, the importer warns that assignment completeness is unknown. A small batch never implies that all 521 catalog locations were searched. `--catalog` checks that the supplied kit catalog matches the application's current ID set; it cannot introduce arbitrary provider IDs.

Add `--write` only to stage a validated batch:

```sh
npx tsx scripts/import-research.ts \
  --observations /path/to/observations.csv \
  --coverage /path/to/coverage.csv \
  --assigned /path/to/assigned-provider-ids.json \
  --write
```

Output is fixed to `artifacts/research-imports/batch_<digest>.json`. The CLI refuses a destination that is not Git-ignored or is already tracked, refuses symbolic-link output directories/files, and uses directory mode `0700` and file mode `0600`. It atomically exposes a completed artifact without overwriting an existing file. An identical rerun reports `unchanged`; conflicting content is not overwritten. These are local filesystem protections, not an encrypted or authorized restricted-content database.

## Validation and review behavior

- CSV is strict UTF-8 with the template columns, no extras or duplicate headers. Column order may vary. Quoted commas, doubled quotes, embedded CRLF/LF and a leading UTF-8 BOM are supported. Malformed quoting, wrong field counts, control characters, files over 10 MiB, more than 10,000 data rows or cells over 12,000 characters fail validation. Individual fields have tighter limits.
- Enums follow the kit. Exact matches require a real catalog ID and a match explanation. Probable/unresolved matches require a candidate name and a **blank** provider ID; the importer never guesses an identity. Source-stated relationships remain self-described or unknown, never independently verified.
- Retrieval/search times must be real UTC ISO timestamps ending in `Z`, with optional millisecond precision, and cannot be later than assessment. Post dates must be real calendar dates no later than retrieval. Unknown dates stay blank/null; approximate experience periods remain text and are not converted to invented dates.
- Source/thread URLs are bounded HTTP(S) links without credentials, whitespace or local/IP hosts. This is syntax validation, not proof that a page is accessible, public, authentic or reusable. Missing permalinks are allowed only as explicit human-review candidates. Quoted text without either source or thread link is rejected.
- Public excerpts have a **25-word total cap per linked source/thread across the batch**, not 25 words per comment. Keep summaries redacted. The importer cannot reliably detect every personal name, medical detail, falsely asserted relationship or unauthorized reuse; every accepted row still requires source, redaction and rights review.
- `private_authorized`, any other non-public visibility, or `restricted_no_publication` is rejected. There is no override flag or authorized restricted store here. The full batch returns no staging payload and writes nothing if any row is invalid or restricted. Diagnostics contain row/field/error codes, not the restricted summary or excerpt. Retain only a non-content access limitation in coverage; do not copy a private discussion into that field.
- Every observation has `publishable: false`, `scoreEligible: false`, `useStatus: "internal_review_pending"` and `needsHumanReview: true`, even if the collector submitted `needs_human_review=false`. The submitted flag is retained separately. Explicit safety allegations enter the priority queue. A small keyword rule also escalates possible serious allegations such as abuse or theft; it does not establish truth or reliably identify every serious issue. Ordinary records still receive human review, so keyword silence is not clearance.
- Employment views, provider promotion, ambiguous identities, missing links and duplicate/source-edit candidates have separate review reasons. Nothing here converts qualitative sentiment, recommendations or likes into a rating.

## Coverage honesty

Coverage preserves `evidence_found`, `searched_no_relevant_result`, `access_restricted`, `ambiguous_only`, `partial` and `not_searched`. A search attempt requires its actual time and query or source descriptions. `partial` and `access_restricted` need an access/interruption explanation. `not_searched` cannot claim queries, checked sources, a search time or observations. No-result/access-restricted states have zero observation rows; use `partial` when public findings coexist with an access limitation.

Counts describe rows, not residents, households, independent experiences or prevalence. Exact-match counts reconcile to the submitted observations. Extra reported rows can only be unresolved candidates from the same run; this produces a warning and requires human reconciliation because a blank provider ID cannot be automatically assigned. A completed import does not mean a platform was searched exhaustively or private sources were accessed.

## Identity, duplicates and versioning

`sourceKey` hashes the source permalink plus the matched provider/candidate identity. Relevant query parameters such as Facebook `comment_id` are preserved; only known tracking parameters and fragments are removed from the identity URL. `contentHash` hashes the normalized extracted content, and `id` combines source identity with content version. The original source/thread URLs, local observation/run IDs and retrieval time remain in the artifact.

The same public source/content/location gets the same observation ID across repeated runs. A source edit creates a new content-version ID while retaining its source key; it is not silently treated as a new independent experience. Missing-link records use the run/local ID as a fallback, with their uncertainty explicit. This CLI does **not** maintain a persistent cross-run retrieval-history, permission-change or deletion ledger. A later reviewed persistence layer must reconcile these IDs and retain the permitted history.

Repeated local IDs, exact duplicate content within a batch, missing duplicate targets and duplicate cycles are rejected for reconciliation. Known `duplicate_of` links resolve to normalized IDs. Shared threads, shared source keys and repeated same-location summaries form `duplicateGroups` for human review; they are not automatically merged or labeled fake. Per-row candidate lists are capped at 50; groups retain full membership. Different comments are not assumed to be different households.

## Code contract

`src/lib/research-pipeline/import.ts` exports:

```ts
validateResearchImport({
  observationsCsv,
  coverageCsv,
  catalogProviderIds,
  assignedProviderIds, // Optional; recommended.
  asOfUtc,
});
```

The result contains `ok`, structured `errors`/`warnings`, input counts and `staging` (null on any validation error). Valid staging uses `schemaVersion: "harbor-research-import/1"`, deterministic `batchId`, one `runId`, normalized observations, coverage, duplicate groups, a human-review queue and explicit limitations. Multi-run files must be split into separate imports. No public-app ingestion code consumes this output automatically.

Only JSON artifacts are exported. Formula-like text is retained as data; it is never executed or emitted into a spreadsheet CSV. Any future CSV exporter must escape cells beginning with formula/control prefixes (including whitespace followed by `=`, `+`, `-`, `@`, tab or carriage return) rather than sending raw observation text to a spreadsheet.

## Tests

Run `npx tsx --test tests/research-import.test.ts`. Fixtures are synthetic and contain no real provider reviews or private material. Tests cover CSV grammar, field/date/URL bounds, catalog identity, restricted-content rejection without diagnostic leakage, allegation escalation, stable IDs/source edits, duplicates/cycles, shared-thread quote budgets, honest partial/no-result coverage, and CLI dry-run/write behavior. CLI tests use disposable Git repositories to check ignored paths, private permissions, idempotency and symlink rejection without changing the application or its Git history.
