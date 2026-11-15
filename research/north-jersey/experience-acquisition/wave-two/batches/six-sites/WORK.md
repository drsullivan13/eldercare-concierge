# Six-site conditional experience release

## Outcome

Release only the six-site evidence that passes exact identity, licensed-residence, population, and complete visible-window review. The reviewed batch approves Wayne and Canterbury/Eagle Rock and retains four holds.

The real application snapshot for 2026-11-15 has 104 scored NJ providers, up from 102. All 102 existing scores and their source evidence are unchanged. Exactly two of 1,375 runtime provider records change. The other 1,373 records are identical. Provider identities, registry crosswalk, scorer, location-research code, and coverage code are unchanged.

| Location | Runtime recipient | Previous score | Released score | Original aggregate |
|---|---|---|---|---|
| Arden Courts Wayne | `north-jersey-doh-nj70a002` | None | 9.4/10 | Google 4.7/5, 53 ratings |
| Canterbury/Eagle Rock | `north-jersey-doh-nj60729` | None | 7.2/10 | Google 3.6/5, 83 ratings |

Each result has one independent source family. MyLivingChoice republishes Google, so it is not a second family. These consumer estimates do not establish clinical quality or safety.

The release compiler produces 37 approvals across all immutable acquisition batches. The canonical release includes 107 providers. The scorer publishes 104 scores. All 73 existing published excerpts remain unchanged.

## Decisions

Wayne retains the observed `Memory Care / Respite / Short-Term Care` label. Its operator and state witnesses identify the same sole residence at 800 Hamburg Turnpike, Wayne 07470, license NJ70A002, with 56 licensed assisted-living beds. The operator describes exclusive memory care and short stays in that residence. The exact Google place identifier matches. The state roster and runtime care-unit search identify no separate independent-living or nursing unit there. The nearby address numbered 820 is not this residence.

The new optional `careUnitCorroboration` record binds exact identity, official ID, address, licensed setting, sole-residence status, and two separate primary witnesses. The release validator rejects other co-located included or CMS-only runtime units. Ordinary memory-care and respite labels still fail assisted-living compatibility without the narrow proof. No global equivalence changed.

Wayne's five rows are positive overall. Rows 629065, 629066, and 629067 describe family experience. Row 629068 describes a family inquiry, not employment. Row 629069 describes frequent visits without established kinship. Broad consumer feedback does not require every writer to be a resident's relative.

Canterbury's exact address, phone, 180 nursing beds, license NJ60729, operator evidence, and state rename application connect the listing to Eagle Rock Post Acute Care at Cedar Grove. The filed application documents old and new names, not completion of every proposed ownership transfer. Ratings may span operators.

Canterbury's five rows are negative overall. The lobby and therapy praise is incidental, not balanced mixed sentiment. Row 608755 describes a prospective-family tour, not employment. The October 2024 family row 608753 remains in the complete window despite being older than 730 days. `cms-315204` remains a distinct `included_cms_only` registry record. It receives no aggregate or score. Runtime replay finds exactly one Canterbury aggregate recipient.

| Held location | Original aggregate | Unresolved issue |
|---|---|---|
| West Orange, `north-jersey-doh-nj30a002` | 4.9/5, 68 ratings | Row 628395 contains conflicting county wording. A third-party helper and an overlapping visiting-speaker account leave contributor scope unresolved. Neither proves employment. |
| Whippany, `north-jersey-doh-nj60a003` | 4.9/5, 41 ratings | Row 629196's displayed name matches the published administrator name. The match does not prove personal identity. The coordinator retains a potential-workforce hold instead of the independent review's eligibility recommendation. |
| Birchwood, `cms-315091` | 4.1/5, 375 ratings | Separate personal-care unit NJ20C003 shares the nursing unit's address and phone. Five nursing-themed accounts cannot establish the full aggregate population. |
| Florham Park, `cms-315530` | 4.8/5, 219 ratings | Separate Terraces units NJ14C014 and NJ60A010 share the address and operator. Matching the Google place does not isolate all ratings to nursing. |

All held providers and their co-located care units remain unscored without aggregates. The coordinator's Whippany finding is retained without adding personal names. A newer negative family account in its operator widget overlaps Google and does not create another independent family.

Birchwood's operator terms restrict automation. Operator reads are excluded from eligibility evidence, including the earlier contact-page read. No further request to that host supports this release. The original MyLivingChoice access status and historical listing annotations remain intact.

## Evidence and checkpoint

The batch contains the original seven direct collection files and both independently supplied editorial files, byte-for-byte. All six complete five-row windows retain row IDs, original month precision, roles, and sentiment. Collection heuristics remain unchanged. The separate source checks carry the independently reviewed classifications. Unknown aggregate dates remain null.

`batch.json` binds the approvals, four holds, collections, editorial decisions, primary witnesses, source checks, historical annotations, and before-runtime fingerprints. `wave-two/batches.json` appends the new reference without changing earlier batches, including Sinai and Avalon.

The checkpoint was six inspected locations, 30 visible rows, two eligible recipients, and four unresolved holds. Rebuilds ran serially through acquisition approval, release, offerings, normalization, regional build, and staffing. No agent was spawned. No staging, commit, push, deployment, CoreQ edit, or JavaScript UI edit was performed by this task. Concurrent CoreQ changes in the shared working tree were left untouched.

Model the Domain kept dedicated-residence proof separate from generic care-type compatibility. Prove It Works required the real scorer and coverage snapshot, not just successful compilation.

## Validation

These existing suites ran against the final implementation. Eight new test methods were added to the release and approval suites.

| Python suite under `scripts/regions/` | Result |
|---|---|
| `release-reviews-test.py` | 73 passed |
| `approve-experience-acquisition-test.py` | 25 passed |
| `experience-acquisition-test.py` | 15 passed, one pre-existing failure |
| `reviews.test.py` | 21 passed |
| `reviews.integration.test.py` | 10 passed |
| `review-excerpts-test.py` | 41 passed |
| `review-catalog-test.py` | 15 passed |
| `review-catalog-integration-test.py` | 7 passed |
| `listing-release-test.py` | 5 passed |
| Total | 212 passed, one pre-existing failure |

The added tests cover proof omission and hash drift, freshly rebound invalid witnesses, stale dates, wrong addresses and identities, nonprimary hosts, separate care units, all 30 independently read rows, restricted operator access, the coordinator override, preservation of 102 existing scores and evidence, all held and co-located units, and exactly one nursing recipient. The existing minimal-public-artifact replay passes.

The following existing TypeScript suites passed all 84 tests through their normal entry points.

```sh
node --import tsx --test tests/nj-experience-acquisition.test.ts tests/location-research.test.ts tests/research-coverage.test.ts tests/experience-score.test.ts tests/experience-methodology.test.ts tests/market-runtime.test.ts tests/search.test.ts tests/family-experience.test.ts
```

The independent before-and-after application snapshots use `tests/nj-experience-acquisition.test.ts --snapshot 2026-11-15`. An exact comparison proves the two changed records and the 1,373 unchanged records. The retained `before-runtime-fingerprints.json` lets the new regression replay without `/tmp` inputs.

All canonical checks pass.

```sh
python3 -B scripts/regions/approve-experience-acquisition.py --check
python3 -B scripts/regions/release-reviews.py --check
python3 -B scripts/regions/provider-offerings.py --check
python3 -B scripts/regions/normalize-nj.py --check
python3 -B scripts/regions/build-region.py --check
python3 -B scripts/prepare-nursing-staffing.py --check
python3 -B research/north-jersey/review-catalog-editorial/build.py --check
git diff --check
```

A dry staffing build proved that only `inputs` changes before refreshing its fingerprint. Every clinical provider value is identical. A dry editorial build proved that only `releaseValidatorSha256` changes before refreshing its derived overlay and release fingerprint. All editorial pages, rows, text, decisions, counts, and public source receipts are identical.

Two broader checks remain red for previously recorded reasons. `experience-acquisition-test.py` fails `test_artifacts_cover_real_frozen_population_and_preserve_every_score`. Its historical 974-provider baseline predates the 1,375-provider inventory and 12 existing home-care identity changes. All 56 scores from that older baseline remain preserved by the existing runtime test. No baseline or migration rule was loosened.

`python3 -B scripts/regions/review-catalog.py check` exits 1 with `Catalog receipt has a mismatched provider, source or URL`. The prior Avalon work record documents eight retained receipts whose targets are now `permitted: false`. No receipt was deleted, reassigned, or authorized to make the check pass.

An exploratory snapshot comparison used a nonexistent `catalogProviders` key. The corrected comparison uses the actual `runtimeProviders` and `inputHashes` fields and passes. An initial guessed integration-test filename did not exist. The actual `reviews.integration.test.py` then passed all 10 tests.

No broad application build or browser test was run. Validation exercises the real data release, scorer, location research, coverage, runtime market, and search entry points. No temporary iteration script was added to the repository.

## Artifact paths

This directory is `research/north-jersey/experience-acquisition/wave-two/batches/six-sites/`.

- `batch.json` is the immutable batch input.
- `reviewed.json` records two approvals, four holds, and the coordinator override.
- `proposals.json`, `aliases.json`, and `access.json` are the new batch-local release inputs.
- `arden-editorial.json` and `nursing-editorial.json` preserve the independent review artifacts.
- `collection/` contains the seven original collection files.
- `source-checks/` contains all six complete population checks.
- `identity-checks/` contains the Wayne and Canterbury identity witnesses.
- `primary/` contains the operator, state, rename, short-stay, roster, and administrator-match witnesses.
- `wayne-care-unit-corroboration.json` binds the dedicated-residence exception.
- `original-listing-annotations.json` retains the original dispositions and source access.
- `before-runtime-fingerprints.json` preserves the pre-release comparison.

The compiled batch artifacts are:

```text
research/north-jersey/experience-acquisition/wave-two/compiled/mylivingchoice-six-sites/collector-receipts.json
research/north-jersey/experience-acquisition/wave-two/compiled/mylivingchoice-six-sites/independent-checks/arden-courts-wayne.json
research/north-jersey/experience-acquisition/wave-two/compiled/mylivingchoice-six-sites/independent-checks/canterbury-at-cedar-grove.json
```

The modified implementation and generated artifacts are:

```text
scripts/regions/approve-experience-acquisition.py
scripts/regions/approve-experience-acquisition-test.py
scripts/regions/release-reviews.py
scripts/regions/release-reviews-test.py
research/north-jersey/experience-acquisition/wave-two/batches.json
research/north-jersey/experience-acquisition/integration/approved-batches.json
research/north-jersey/review-release/approvals-audit.json
research/north-jersey/review-release/experience-verification.json
research/north-jersey/review-release/identity-corroboration.json
research/north-jersey/review-release/locationResearch.json
research/north-jersey/review-release/manifest.json
research/north-jersey/review-release/observation-registry.json
research/north-jersey/offerings/manifest.json
research/north-jersey/review-catalog-editorial/overlay.json
research/north-jersey/review-catalog-editorial/release-fingerprint.json
research/north-jersey/runtime-manifest.json
research/north-jersey/runtime/locationResearch.json
research/north-jersey/runtime/source-inputs.json
research/north-jersey/runtime/validation.json
src/data/regional-markets.json
src/data/nursing-staffing.json
```
