# New Jersey home-care office evidence

This directory holds the reviewed operator-evidence patch for New Jersey nonmedical home-care offices. The generator reconciles retained first-party evidence against the current official health-care service firm registry. It does not fetch live pages, infer missing facts, or edit registry identity.

## Inputs

- `../source/firms.xlsx` and `../source/firms.xlsx.json` contain the current registry export and its checksum metadata. The build requires all 3,628 displayed and exported rows.
- `../../home-care-first-party/records.json` contains the 39 prior matched offices. Their receipts remain under `../../home-care-first-party/receipts/`.
- `new-branches.json` contains newer reviewed branch facts. If it is absent, the default build treats it as an empty input and records that state.
- `receipts/` contains retained page excerpts for `new-branches.json`. A receipt must have a successful integer HTTP status, original and effective URLs on the same publisher domain, a check date, a title, and unique factual excerpt lines.

## Outputs

- `release.json` is the compact consumer patch. It has `schemaVersion: 1` and `byProviderID`. Each value can contain `website`, `serviceArea`, `services`, `phone`, and `sources`.
- `reconciliation.json` is the audit record. It contains registry exceptions, per-record identity decisions, receipt SHA-256 values, cited lines, rejected facts, gaps, phone conflicts, attempts, and the explicit separation of inactive predecessor `HP0166900` from active `HP0374000`.
- `validation.json` contains row counts, release counts, field counts, input hashes, retained receipt counts, phone-conflict IDs, and the release hash.

Every released field maps to retained receipt lines in `reconciliation.json`. `release.json` repeats that provenance in each source's `supports` text. Sources use the existing provider source shape with `kind: "provider"`.

## Evidence rules

A record is eligible only when the current registry row is active, in New Jersey, and unambiguous. The office name must match the registered legal name or DBA. The published street, city, and ZIP must match the registry. A conflicting suite or unit blocks release. Formatting differences, suite omission, ZIP+4 precision, and documented postal street aliases do not change registry identity.

A website must be a retained local office URL. Brand locators, state directories, generic service pages, and guessed paths are not office websites. New branch facts must come from the same publisher domain and a linked branch path, unless the identity receipt explicitly links the local URL.

A service or area claim needs an excerpt that asserts the local offer or coverage. Navigation labels, form options, review text, private quotes, and negated statements are rejected. The patch excludes private-pay, insurance, eligibility, capacity, staffing, clinical, quality, safety, and availability claims.

A phone must appear in cited receipt text. A branch phone that differs from the registry phone can be released only with branch evidence. The reconciliation keeps the registry phone and records a warning. The patch does not change the registry phone.

## Registry anomalies

The current export contains duplicate rows and one malformed expired registration ID. The generator preserves them in `reconciliation.json`. Identical duplicates share one selected row. When one active variant and one or more inactive variants share an ID, the active variant is matchable and the inactive variants remain recorded. Ambiguous variants block release for that ID.

`HP0166900` remains an inactive predecessor. It is never rematched to `HP0374000`, and it receives no patch.

## Rebuild and verify

Run these commands from the repository root with Python 3.11 or newer. They do not contact providers.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/regions/homecare-office-evidence.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/regions/homecare-office-evidence.py --check
PYTHONDONTWRITEBYTECODE=1 python3 scripts/regions/homecare-office-evidence-test.py -v
```

The first command rewrites the three JSON outputs. The second command compares the checked outputs byte for byte without writing. The test command runs acceptance and input-mutation tests in memory.

To reproduce the earlier handoff without new branch facts, run the generator with `--prior-only`. That mode also rewrites the outputs, so rerun the default command afterward to restore the current combined release.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/regions/homecare-office-evidence.py --prior-only
```

Do not edit generated JSON by hand. Update the reviewed inputs or receipts, then rerun the generator and tests.
