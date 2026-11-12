# North Jersey Facebook research kit

This kit maps the fixed 20 North Jersey Facebook assignments to current market application IDs. It gives the research collector an importer-ready catalog and blank templates. It contains no observations, no coverage statuses and no findings, and it publishes nothing.

## Files

| File | Contents |
| --- | --- |
| `kit.csv` | One row per exactly matched assignment. Identity and geography columns are copied from the published app record, so the importer's exact comparison passes. `assignment_id` is checklist metadata. |
| `assigned.json` | The importer's `--assigned` manifest: state `NJ`, the ZIPs of the matched records and their provider IDs. |
| `assignment-manifest.json` | All 20 assignments with their original source identity and one result each. A result is `exact` with a provider ID, basis and evidence, or `unresolved` with a reason code and detail. It also records the SHA-256 of every input read. |
| `observations.csv`, `coverage.csv` | Header-only templates. The headers are read from `OBSERVATION_COLUMNS` and `COVERAGE_COLUMNS` in `src/lib/research-pipeline/import.ts` on every run. |

Every file except this README is generated. Do not edit them by hand.

## Commands

Run from the repository root.

```sh
python3 scripts/regions/facebook-kit.py
python3 scripts/regions/facebook-kit.py --check
python3 scripts/regions/facebook-kit-test.py
```

The first command rewrites only the outputs whose bytes changed and prints the counts. `--check` writes nothing and exits 1 when any output is stale. Rerun the generator whenever the NJ runtime release, the retained state or CMS sources, or `src/data/regional-markets.json` change.

The generator rewrites every file in this directory on each run, so do not collect into the templates here. Copy the kit to a separate working batch and fill the copies there.

```sh
batch=research/north-jersey/facebook/batch-1
mkdir -p "$batch"
cp research/north-jersey/facebook/kit/kit.csv \
   research/north-jersey/facebook/kit/assigned.json \
   research/north-jersey/facebook/kit/observations.csv \
   research/north-jersey/facebook/kit/coverage.csv \
   "$batch"/
```

Fill `$batch/coverage.csv` (and `$batch/observations.csv`, if there are observations), then validate the batch with the real importer against the working copies.

```sh
npx tsx scripts/import-research.ts \
  --observations "$batch/observations.csv" \
  --coverage "$batch/coverage.csv" \
  --catalog "$batch/kit.csv" \
  --assigned "$batch/assigned.json" \
  --as-of 2026-11-12T23:59:59Z
```

With the templates still blank, this dry run passes the kit and assignment scope checks. It reports only `run_mismatch` and `assignment_mismatch`, because no run or coverage rows exist yet.

## Design

The original CSVs, `../first-facility-assignments.csv` and `../campus-and-office-assignments.csv`, are the static table of assignment source identities. Resolution is a dynamic join against the current authoritative crosswalk, not a stored table of app IDs. A stored table would go stale when a DOH unit moves from its provisional `north-jersey-doh-*` ID to a `cms-CCN` ID, or when a certified home-health office is published.

The assignment ID prefix selects one resolver.

| Prefix | Kind | Exact match requires |
| --- | --- | --- |
| `nj-doh-` | Licensed care unit | One included `NJ DOH All_LTC` crosswalk row for the facility ID. Its license, licensed name, setting and county must equal the assignment and the retained workbook row it cites. The workbook address and ZIP must equal the assignment. With no CMS link, the ID must be the stable provisional `north-jersey-doh-<facid>`. With a CMS link, the unit must be licensed as a nursing home, the match basis must be `unique_nursing_unit_normalized_name_street_and_zip`, and the ID must be `cms-<CCN>`. The crosswalk's CMS name and street must equal the retained CMS row, and that row's name, street, city, state and ZIP must equal the licensed unit, using the source normalizer's `name_key` for names. When the crosswalk cites a CMS source file, row index and SHA-256, they must match the retained bytes. |
| `nj-reg-` | Registered health care services office | One included `NJ HP registry` crosswalk row. It must resolve to `north-jersey-hp-<registration>` with no CCN. The cited row in the retained export must be active and must have the same name, street with unit, city and ZIP. |
| `nj-campus-` | Historical CCRC campus | One retained DCA listing whose full address equals the assignment, with the same name. One crosswalk row with `included_historical` status and no official ID must cite that county file and PDF page, and the ID must be `north-jersey-campus-<name>-<zip>`. |
| `nj-hha-` | CMS-certified home-health office | The retained POS and PDC rows for the CCN must have the assigned office address. Every crosswalk row for the CCN must map to `cms-<CCN>` and cite the retained snapshot bytes. The agency must be present in `runtime/providers.json`. |

Every resolver then requires the runtime provider to have the expected category, address and unit, city, ZIP and CMS CCN, or no CCN. The published app record in `src/data/regional-markets.json` must also equal the runtime record. Addresses are compared after collapsing whitespace and ignoring case. No other normalization is applied, so a different suite, street number or ZIP fails. No step matches on name alone or by fuzzy similarity.

Any failed check leaves the assignment unresolved with a reason. It never falls back to another ID. Two assignments that resolve to one provider ID are both unresolved. The generator stops without writing when `runtime/providers.json` does not match the SHA-256 in `../../runtime-manifest.json`, or when a retained raw source does not match its receipt.

These rules keep the known look-alikes apart.

- The Oaks at Denville assisted-living unit `NJ60A002` at 19 Pocono Road stays `north-jersey-doh-nj60a002`. The nursing unit `NJ61424` at 21 Pocono Road is `cms-315329`.
- BAYADA's Morristown registration `HP0015347` stays a registered office. It can never take the CCN or ID of the Cranford CMS agency `317020`.
- Lantern Hill's campus at 535 Mountain Avenue does not inherit the IDs of the care units at 537 Mountain Avenue.

## Current result

`assignment-manifest.json` holds the authoritative counts. For the local snapshot used to generate this kit, all 20 assignments match exactly: 12 licensed units (four through CMS CCNs), four registered offices, two campuses and two CMS-certified home-health offices. Regeneration after a runtime release can change these counts.

## Retained sources

All paths are relative to `research/north-jersey/`.

- `runtime-manifest.json`, `runtime/providers.json`, `runtime/crosswalk.json` and `runtime/home-health-release-inputs.json` are the NJ runtime release inputs. See `runtime/HANDOFF.md`.
- `state/raw/ltc.xlsx` is the NJ DOH All_LTC workbook ([source](https://healthapps.nj.gov/facilities/documents2/All_LTC.xlsx)).
- `state/raw/firms.xlsx` is the NJ Consumer Affairs HP registration export ([source](https://rgbportal.dca.njoag.gov/public-view/)).
- `state/raw/ccrc.pdf` and `state/*/ccrc-campuses.json` are the DCA CCRC guide, revised January 2018 ([source](https://www.nj.gov/dca/codes/publications/pdf_ccrc/ccrc2011.pdf)), and its campus listings. See `state/README.md`.
- `cms/raw/4pq5-n9py/` holds CMS nursing home provider information ([source](https://data.cms.gov/provider-data/dataset/4pq5-n9py)).
- `cms/pos/latest.json` and the snapshot it names hold CMS iQIES Provider of Services rows ([documentation](https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-internet-quality-improvement-and-evaluation-system/api-docs)) and home health provider data catalog rows ([source](https://data.cms.gov/provider-data/dataset/6jpm-sxkc)).
- `src/data/regional-markets.json` is the published app catalog that the importer validates against.

## Limitations

A match establishes catalog identity only. It does not establish service area, current licensing, availability or a Facebook finding. The campus listings are historical, and the assignment file still asks for a current location check. The Denville campus-level matching rule in `docs/north-jersey-facebook-prompt.md` still governs posts that do not name a specific unit.
