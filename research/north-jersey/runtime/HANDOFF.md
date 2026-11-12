# North Jersey release

Run the following commands from the Harbor checkout after rebuilding the regional source collections.

```sh
python3 -B scripts/regions/normalize-nj.py
python3 -B scripts/regions/normalize-nj.py --check
python3 -B scripts/regions/normalize-nj-test.py
python3 -B scripts/regions/build-region.py
python3 -B scripts/regions/build-region.py --check
```

The normalizer verifies source and release checksums, resolves licensed units and CMS offices, and writes the builder inputs and reviewed manifest. The builder publishes the runtime snapshot. The separate county selection supports Union and Morris validation in memory. Running the CLI with a county subset rewrites the local release for that subset.

## Inputs and coverage

* State DOH, the home-care registry and the historical CCRC guide provide licensed unit, registered office and campus records. The historical guide has January 2018 month precision. Active registrations can have past expiration dates. Both fields remain visible.
* CMS nursing records join by exact compatible unit, normalized name, street and ZIP. Unresolved certified identities retain their own CCN. Provider-of-Services office county identifies the 18 certified home-health offices. Service ZIP edges remain separate. The clinical adapter preserves source reporting periods, footnotes and suppressed values, and produces exact-CCN nursing histories and agency metrics.
* The address release matches the original address, setting, county and catalog coordinates for every included record. The address source link and accuracy class accompany every accepted point. Each unmatched location retains its baseline coordinate. Denville's two separately licensed units remain distinct.
* Published offerings and approved review aggregates join by exact Harbor ID. The release manifest records the locationResearch input hash. The normalizer combines references and facts, rejects conflicting availability and validates every linked source ID with the regional builder. The review collector's working files and the private Facebook batch do not enter this adapter.
* `validation.json` records county and category coverage, the CMS join count, clinical evidence totals and representative records. `source-inputs.json` records consumed input digests. `crosswalk.json` and `unresolved-exclusions.json` preserve the provenance and disposition of official records.

## Fresh source baseline

For a new source capture use a new output directory so that location checks start from official address and coordinate fields. This command runs the same state and clinical normalization before the address and consumer-enrichment stages.

```sh
python3 -B scripts/regions/normalize-nj.py --base-output /tmp/harbor-nj-new-address-inputs
```

The output contains the source providers, crosswalk, ZIPs and catalog metadata. The current address capture keeps these original inputs under `../address-points/inputs/` for offline replay. Keep these files with each historical capture. Recheck provider IDs and exact street/office/campus identities when a source changes before reusing prior evidence.

## Examples

Morristown nursing unit NJ60921 resolves to CMS 315488. Cornell Hall in Union resolves to CMS 315104. The Oaks at Denville assisted living at 19 Pocono Road retains NJ60A002, while nursing at 21 Pocono Road resolves to CMS 315329. VNA in Morristown uses CMS 317002. Its patient survey population is separate from public consumer reviews.
