# Regional research import contract

`scripts/import-research.ts` accepts a verified regional kit without replacing the application catalog. Authority comes only from published app snapshots in the current working directory. Run the CLI from the trusted checkout root, not from a collector's kit directory.

The [research import contract](research-import.md) still defines observation fields, coverage states, source review, restricted-content rejection, and private staging. This document adds geographic assignments and subset kit validation. It does not change the shared validator or publish research.

## Authoritative state catalog

A geographic assignment selects the complete authoritative catalog for its explicit state before kit, assignment, observation, and coverage validation:

- MA uses the legacy `src/data/providers.json` records.
- NJ uses the reviewed `north-jersey` snapshot in `src/data/regional-markets.json`, matching the app registry's registered market ID and state. The importer validates snapshot metadata, ZIP locations, provider identity and state, globally unique provider IDs, and CMS ID/CCN consistency across MA and registered snapshots. A provider claiming a different state from its snapshot fails validation.
- `regional-markets.json` is optional. An absent file adds no published IDs. A present malformed JSON file, invalid snapshot, duplicate market or colliding identity rejects geographic imports, including MA imports. It does not silently fall back to MA.
- Other states require an app registry integration; a kit cannot register a market. There is no caller-provided authority-file option. `--catalog` supplies rows to verify, never new authoritative IDs.

Legacy ID arrays and commands without an assignment keep the MA-only catalog and do not load the regional registry. Registering NJ therefore does not change their full-catalog or ID-only compatibility.

The selected catalog is the complete state catalog, not a city/ZIP-filtered authority or the submitted kit. Every kit ID must belong to it. Explicit assigned IDs and geographic constraints still apply, and observations outside the assignment are rejected rather than filtered.

## Geographic assignment manifest

`--assigned /path/to/assigned.json` accepts this object:

```json
{
  "geography": {
    "state": "MA",
    "cities": ["Newton"],
    "zips": ["02459"]
  },
  "providerIds": ["ma-alr-adelaide-of-newton-centre", "mgb-home-care"]
}
```

- `state` is required and must be an uppercase two-letter code matching each assigned app record.
- `cities` and `zips` are optional nonempty lists. Values within a list are alternatives. State, city, and ZIP constraints intersect.
- City names match the app exactly, including case. ZIPs are five-digit strings. `"02459"` is not `2459`.
- Geography describes the catalog location, including an agency's office. It does not establish service territory, licensing, a radius, county membership, or availability.
- `providerIds` defines the exact assignment. Geography constrains those IDs; it does not automatically assign every matching record. A collector may receive fewer than all locations in a city.
- IDs and list values must be unique and nonempty. IDs must already exist in the app. Unknown manifest or geography properties fail, so a misspelled selector cannot silently broaden the scope.
- A registered state can be used when matching records exist in its authoritative app catalog. A kit cannot introduce an unpublished NJ record or relabel an MA record as NJ.

State-only geography, such as `{"state":"MA"}`, is valid. The ID list is still explicit. Without `--catalog`, geographic assignments use app identity and geography directly.

## Kit catalog CSV

A proper subset supplied through `--catalog` requires the geographic manifest above. Its ID set must equal `providerIds`, regardless of order. A legacy ID array alone cannot authorize a subset kit.

This two-row catalog matches the example assignment in the current MA snapshot:

```csv
provider_id,name,care_category,address,city,state,zip
ma-alr-adelaide-of-newton-centre,Adelaide of Newton Centre,assisted-living,"157 Herrick Road, Newton, MA 02459",Newton,MA,02459
mgb-home-care,Mass General Brigham Home Care,home-health,"95 Wells Avenue, Suite 320",Newton,MA,02459
```

`provider_id`, name, address, city, and ZIP columns are required for a subset. State is read from the app even when the kit omits it. This preserves the retained research checklist's location columns, which do not include state.

Every supplied column in the following table is checked against the app record found by `provider_id`. Both aliases are checked when both appear.

| App field      | Accepted CSV columns            | Required for a subset |
| -------------- | ------------------------------- | --------------------- |
| `id`           | `provider_id`                   | Yes                   |
| `name`         | `name`, `provider_name`         | Yes, either           |
| `address`      | `address`                       | Yes                   |
| `city`         | `city`                          | Yes                   |
| `state`        | `state`                         | No                    |
| `zip`          | `zip`, `postal_code`            | Yes, either           |
| `category`     | `category`, `care_category`     | No                    |
| `lat`          | `lat`, `latitude`               | No                    |
| `lng`          | `lng`, `longitude`              | No                    |
| `locationKind` | `location_kind`, `locationKind` | No                    |

Text must match exactly. The importer does not normalize names, addresses, capitalization, or ZIPs. Present-but-blank fields fail if the app field is nonempty. Known coordinates require nonblank finite numeric values equal to the app values, without a rounding tolerance. An app coordinate of `null` requires an empty CSV cell, not zero or the string `"null"`. The current `privatus-boston` record has null coordinates.

Additional checklist metadata columns remain accepted but are not authoritative evidence or part of geographic selection. They cannot substitute for the required columns. Use the documented column names for identity and geography.

Duplicate or empty headers, malformed row widths, empty catalogs, duplicate IDs, blank IDs, unknown IDs, and forged identity or geography fields fail before staging. Checking an external row's state against its own claimed state is not verification.

## Observation and coverage CSVs

Observation and coverage schemas are unchanged. These example files form an honest, unsearched assignment with no observations.

`observations.csv` contains only the exact template header:

```csv
observation_id,run_id,provider_id,candidate_provider_name,match_status,match_reason,source_url,thread_url,source_visibility,retrieved_at_utc,posted_at,experience_period,relationship,account_type,care_level,experience_stage,themes,sentiment,summary,supporting_public_excerpt,concern_type,duplicate_of,independence_notes,use_status,needs_human_review
```

`coverage.csv` accounts for both assigned IDs:

```csv
run_id,provider_id,searched_at_utc,queries_used,sources_checked,status,observations_found,access_limits,coverage_notes
newton-2026-11-12,ma-alr-adelaide-of-newton-centre,,[],[],not_searched,0,,
newton-2026-11-12,mgb-home-care,,[],[],not_searched,0,,
```

Coverage must contain exactly one row for every assigned ID. Missing, extra, duplicate, blank, and unknown coverage identities fail. An exact-matched observation outside the assignment fails, whether its coverage row is omitted or added. The importer rejects the batch instead of filtering those observations.

Existing probable or unresolved observations retain blank provider IDs and explicit candidate names under the shared validator's rules. They remain unassigned human-review candidates, not geographically verified matches. Their coverage counts require human reconciliation. An exact match with a blank or unknown provider ID fails.

## CLI commands and results

Save the manifest as `assigned.json` and the three CSV blocks as `catalog.csv`, `observations.csv`, and `coverage.csv` under `/path/to/newton`. From the checkout root, run:

```sh
npx tsx scripts/import-research.ts \
  --observations /path/to/newton/observations.csv \
  --coverage /path/to/newton/coverage.csv \
  --catalog /path/to/newton/catalog.csv \
  --assigned /path/to/newton/assigned.json \
  --as-of 2026-11-12T23:59:59Z
```

The default is dry-run. There is no separate `--dry-run` flag. The MA example reports zero observations, two coverage rows, zero restricted rows, and 521 catalog providers. Its `scope` reports 521 app providers, two kit providers, two assigned providers, and the submitted geography. An NJ geographic assignment currently reports 956 catalog/app providers, even for a smaller kit. `catalogProviders` remains the full selected state count, not the number searched or the combined MA/NJ count. No artifact is written.

To stage a validated batch locally, add `--write`:

```sh
npx tsx scripts/import-research.ts \
  --observations /path/to/newton/observations.csv \
  --coverage /path/to/newton/coverage.csv \
  --catalog /path/to/newton/catalog.csv \
  --assigned /path/to/newton/assigned.json \
  --as-of 2026-11-12T23:59:59Z \
  --write
```

Private output remains fixed to Git-ignored, untracked `artifacts/research-imports/batch_<digest>.json`. Directories use `0700`; files use `0600`. Symlink destinations and conflicting artifacts fail. Identical reruns report `unchanged`. Restricted content still rejects the batch without echoing its text.

Valid batches exit with status 0. Rejected batches exit with status 1 and write no artifact. Scope, catalog, file, and CLI preflight failures use the existing generic stderr message without echoing input values. Observation and coverage validation failures retain structured issues on stdout.

The stdout `scope` summary is not added to the staging schema or batch hash. Staging retains the validated coverage IDs, not a persistent geographic authorization record. Keep the assignment and kit with the permitted research inputs when an audit requires them.

## Legacy callers

For legacy arrays or no assignment, full-catalog `--catalog` files still require all 521 MA app IDs exactly once. Registered NJ IDs are not part of that legacy full set and are rejected. With a geographic assignment, a full catalog means the complete selected state catalog. A CSV containing only `provider_id` remains valid for a full-set case. Any recognized identity or geography columns supplied in a full catalog are checked, just as in a subset.

Legacy `--assigned` JSON arrays remain valid with a full catalog or no `--catalog`:

```json
["ma-alr-adelaide-of-newton-centre", "mgb-home-care"]
```

The original command without optional flags also remains valid:

```sh
npx tsx scripts/import-research.ts \
  --observations /path/to/newton/observations.csv \
  --coverage /path/to/newton/coverage.csv
```

Without `--assigned`, assignment completeness remains unknown and the existing warning remains. Supplying a full catalog does not claim that all locations were searched.

## Snapshot counts and verification

The legacy MA snapshot inspected for this change contains 521 records, six with city `Newton`, and two with both city `Newton` and ZIP `02459`. Category counts are 280 nursing homes, 224 assisted-living records, seven life-plan campuses, six home-health records, two home-care records, and two staffing records.

The current published `north-jersey` snapshot contains 956 NJ records, comprising 160 nursing homes, 116 assisted-living records, seven life-plan campuses, and 673 home-care records. Its metadata is dated 2026-11-12. Together the app snapshots contain 1,477 records, but the importer never treats that combined number as a state authority. These are mutable published snapshots, not permanent limits or permission to add IDs through a kit.

Recalculate location counts from the current checkout:

```sh
node - <<'JS'
const fs = require("node:fs");
const providers = JSON.parse(fs.readFileSync("src/data/providers.json", "utf8"));
const regionalPath = "src/data/regional-markets.json";
const regional = fs.existsSync(regionalPath)
  ? JSON.parse(fs.readFileSync(regionalPath, "utf8"))
  : [];
console.log({
  total: providers.length,
  ma: providers.filter((p) => p.state === "MA").length,
  newton: providers.filter((p) => p.state === "MA" && p.city === "Newton").length,
  newton02459: providers.filter((p) => p.state === "MA" && p.city === "Newton" && p.zip === "02459").length,
  registered: regional.map((m) => ({
    id: m.id, state: m.state, total: m.providers.length, asOf: m.meta.asOf,
  })),
});
JS
```

Run the focused acceptance checks:

```sh
npx tsx --test tests/research-import.test.ts
npx eslint scripts/import-research.ts tests/research-import.test.ts
npx tsc --noEmit --incremental false --strict --skipLibCheck \
  --target ES2017 --lib esnext,dom,dom.iterable \
  --module esnext --moduleResolution bundler --resolveJsonModule --esModuleInterop \
  scripts/import-research.ts tests/research-import.test.ts
```

Tests use disposable local Git repositories and synthetic observation text. Existing checks exercise actual CLI dry-run and private staging, the documented CSVs, full MA coverage, full-catalog ID-only compatibility, tampering, assignment disagreement, and out-of-assignment observations. Added CLI checks use the real MA catalog plus a synthetic registered NJ snapshot to verify state authority selection, unpublished ID and forged state rejection, malformed registry rejection without MA fallback, null-coordinate tampering, and unchanged MA-only legacy behavior with NJ registered. Synthetic IDs are never added to the real app.

The external `/workspace/harbor-experience-research-kit/` directory referenced by the original guide was unavailable in this checkout. Compatibility is grounded in the retained observation and coverage contracts, existing importer tests, and the research checklist columns. No external kit download or completed research collection was performed.
