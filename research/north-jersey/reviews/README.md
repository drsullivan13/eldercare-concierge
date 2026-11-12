# North Jersey reviews and offerings, November 12, 2026

This is a bounded first research pass, not an exhaustive survey or published application data. It starts at 151 Madison Avenue, then processes Union and Morris before Essex, Bergen, Hudson, and Passaic.

The clean, shareable replay uses [the public batch](public-inventory/checked-batch.json) and [its provenance](public-inventory/evidence.json). The [input manifest](public-inventory/inputs.json) names the exact 26 roster files and seven dependencies. A clean Git snapshot can reproduce both the blank inventory and this staged pass without the local collection archive.

The results below describe the initial discovery pass. The later [independent publication](../review-release/implementation-handoff.md) rechecks permitted pages, resolves unit identity and computes eligible scores. Its 40 published location aggregates and this pass's 31 discovery outcomes have different selection rules and denominators.

## Retained results

The assembled batch contains 31 outcomes across 25 official location keys. It retains seven directly checked consumer listings, two provider-page observations, 18 discovery gaps, and four access gaps.

- Jewish Home Assisted Living, River Vale, has one staged consumer candidate. Its exact listing publishes 4.3 out of 5 from 11 Google ratings. MyLivingChoice republishes Google, so it is not a second independent source. The candidate awaits editorial review.
- Agape Home Care Agency has one staged provider record. The provider homepage and contact page jointly match its Lincoln Park office and suite. Offerings remain attributed provider claims. Price and openings are unknown.
- The pilot and five Union or Morris consumer listings lack a visible ZIP in the retained page evidence. All six are excluded by the strict staging identity rule. Official ZIPs were not copied into observations.
- Sunrise of Summit also has a wrong-location reviewer-population ambiguity. Sunrise of Westfield keeps its observed name rather than silently adopting the official name.
- The Springfield 360Healthcare homepage does not establish its street address. Its facts remain excluded.
- MyLivingChoice offerings and monthly starting prices remain third-party directory claims in the raw observations. They do not become provider-confirmed facts.

This staging step produced a queue for independent editorial review.

## Coverage denominator

The frozen inventory retains 2,094 source rows as 2,080 keys, with no rejected rows. The six-county denominator has 1,783 rows and 1,770 keys. It includes every registration status and seven historical CCRC listings, not only current operating providers.

| County | Official keys, all statuses and historical listings | Checked keys | Not checked |
| --- | ---: | ---: | ---: |
| Union | 295 | 6 | 289 |
| Morris | 191 | 7 | 184 |
| Essex | 526 | 3 | 523 |
| Bergen | 421 | 3 | 418 |
| Hudson | 178 | 3 | 175 |
| Passaic | 159 | 3 | 156 |
| Total | 1,770 | 25 | 1,745 |

"Checked" means at least one retained research outcome, including discovery or an access gap. It does not mean every review source or provider offering was checked.

Another 102 rows have unresolved geography and stay outside county totals. These include 59 home-care registration rows and all 43 CMS home-health offices. Five home-health offices are outside New Jersey. A service ZIP is not an office county. Unknown county does not mean no agency serves the county.

Home-care county assignments come from the upstream state collector's official municipality and locality references, not a published firm county. Coverage preserves that derived basis. Historical CCRC entries date to January 2018 and cannot stage as current exact-unit evidence. Registration status and an expiration date can disagree. Neither an Active label nor catalog inclusion establishes current availability.

## Reproduce staging

Run from the repository root.

```sh
python3 -B scripts/regions/reviews.py stage --as-of 2026-11-12 \
  --observations research/north-jersey/reviews/public-inventory/checked-batch.json
python3 -B scripts/regions/reviews.test.py
python3 -B scripts/regions/reviews.integration.test.py
npx tsx --test tests/experience-score.test.ts tests/location-research.test.ts
```

The CLI is offline. It validates saved observations against actual retained rosters and the source-access registry. It does not discover or fetch new pages. A new research pass must reassess access rules and supply new directly checked observations.

Identical inputs reuse the same immutable run folder and return `unchanged`. The run digest covers code, date, selected counties, rosters, raw-source dependencies, access registry, and observation bytes. See [the CLI contract](../../../scripts/regions/reviews.md) for the schema and exit codes.

The final run and check results are recorded in `verification.json`. Earlier run folders remain as failed or superseded checkpoints. Do not mistake an earlier inventory-only run for the final staged result.

## Evidence and review

- `pilot-direct-check.json` retains the pilot, DOH worksheet row 685, and the verified CMS crosswalk to CCN 315488.
- `home-care-direct-checks.json`, `union-morris/`, and `remaining/` retain direct observations and explicit discovery gaps.
- `public-inventory/checked-batch.json` contains normalized observations and hashed copies of their input checkpoints.
- `source-access.json` records access decisions. [Minimal retained access evidence](access-evidence.md) preserves findings and original log hashes. Full historical responses remain session-local.
- `decisions.tsv` is append-only. Its correction row supersedes the estimated times in the first five rows. Later checkpoint timestamps are not individual event timestamps.
- `review-audit.md` retains the independent Opus 5.5 findings before fixes. `review-disposition.md` records their final resolution. `review-final-evidence.md` records the independent assembled-evidence review.

The initial and current firms workbook hashes differ. Both remain in the research records. Matching row identities do not prove why the workbook bytes changed. Source snapshots and disagreements must remain visible.

The existing scoring and location-research suites exercise application evidence rules. The new standalone Python suites exercise the staging CLI and the actual retained batch. Full application build, browser, lint, and end-to-end checks are outside this research-only change.

Model the Domain separated official rows, discovery, observations, and eligible candidates. Build the Lever produced the rerunnable staging CLI. Prove It Works required actual-input reconciliation and repeat-run byte checks.
