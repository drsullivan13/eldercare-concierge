# North Jersey consumer review release

```sh
python3 -B scripts/regions/release-reviews.py
python3 -B scripts/regions/release-reviews.py --check
python3 -B scripts/regions/release-reviews-test.py
```

The November 12 baseline contains 22 location-specific, independently checked public aggregates. Nineteen clear Harbor’s ten-review minimum. The published counts of one, two and six remain visible as source facts with an unrated index. The score is computed by the application's TypeScript implementation. Each aggregate was republished by MyLivingChoice and attributes its data to Google, so the two names represent one source family. Ten additional public pages had unresolved location/scope or mixed populations. Their dispositions are in `staging.json`.

## Reproducibility and publication

Use a project checkout with the Node dependencies installed. The required published files are the paths listed in `manifest.json` under `inputs`, the reviewed `runtime/providers.json` identity projection, `src/lib/experience-score.ts`, and `scripts/regions/release-reviews.py`. Run the first command to regenerate the six JSON outputs and the manifest, and the second to compare every byte offline. The registry snapshot contains normalized evidence, the original collection receipts, and source families. The 22 independent source checks contain minimal public aggregate and identity excerpts. No account credentials, testimonials, reviewer narratives, or whole third-party property pages are needed for generation. The release was rebuilt and checked in a disposable directory without the development cache or discovery directories.

The two identity checks are separate. First, the original observation must agree with the independent full-page check on the property, address, unit, Google rating, review count and inspected population. Then the location is matched to the current official catalog. A missing observed ZIP is preserved only if one authoritative unit matches the complete known street, city and setting. A corporate suffix or standard street abbreviation is normalized deterministically. Substantive aliases require a separate operator-specific location record. `identity-corroboration.json` holds those records for Cornell, Brandywine and BAYADA. Reconciliation notes alone cannot grant a match.

`scripts/regions/release-reviews-freeze.py` prepares a new compact source-observation snapshot from a locally reviewed ledger referencing the original local collection. The original raw paths may have different retention rights than the compact release. The freeze command validates the original evidence before rewriting any approval references. Use the ordinary release and check commands on a clean checkout.

## Checking another result

First identify the exact licensed service, campus or branch. Check the public rating scale and consumer population, including whether an embedded block belongs to a neighboring community, employer or parent brand. If the listing and operator use different names, independently confirm the operator street and identity before adding a narrow corroboration entry. Retain the source URL, actual retrieval date, observed rating, denominator, a short aggregate/identity excerpt and the local source receipt. Include ambiguous and excluded findings in the separate queue with their reasons. This preserves score coverage and the uncovered denominator without turning missing ratings into zero.

When the regional listing index supplies additional independently checked locations, place its sanitized observations and their approval ledger together in `listing-index/release/`. They must share the same assessment date as the baseline ledger. Duplicate platform families remain subject to the same location-level deduplication. A partial addendum fails verification. The same command rebuilds the combined publication.
