# Regional data workflow

Use the same runner to plan, refresh, rebuild or verify a configured geography. Run commands from the Harbor checkout. Massachusetts is a read-only baseline. North Jersey covers Union, Morris, Essex, Bergen, Hudson and Passaic; county assignment describes an office or care location.

```sh
python3 -B scripts/regions/workflow.py plan --config research/region-workflows/north-jersey.json --mode refresh
python3 -B scripts/regions/workflow.py verify --config research/region-workflows/massachusetts.json
python3 -B scripts/regions/workflow.py verify --config research/region-workflows/north-jersey.json
python3 -B scripts/regions/workflow-evidence.py comparison
python3 -B scripts/regions/workflow-test.py
```

To retain a timestamped report, pass `--report research/region-workflows/<unique-filename>.json`. Existing reports are immutable. Each records the config, mode, scope, tool hashes, commands, exits, per-artifact provenance, missing data and hashes. Reports from previous runs describe the files verified at that time. The comparison command reads the two **published application snapshots** every time. Use it after publishing and keep the output alongside the run report.

## Verifying a fresh checkout

The shared release contains the review and price evidence used in Harbor plus the public CMS captures. Six large clinical sidecars are reproducible offline. Recreate them before running shared verification:

```sh
python3 -B scripts/regions/clinical-nj.py
python3 -B scripts/regions/workflow.py verify --scope shared --config research/region-workflows/north-jersey.json
python3 -B scripts/regions/workflow.py verify --scope shared --config research/region-workflows/massachusetts.json
```

The full review acquisition and listing discovery archives stay local. The shared scope explicitly reports those two stages as unselected, while verifying the approved inputs and actual released review records. Default `--scope all` exercises the archives where present. A shared verification result cannot establish live page access or reproduce an unpublished acquisition.

## Running a collection

1. Inspect the plan. Use repeated `--step` flags to select a stage or group. The runner executes selected steps in config order. Selection does not automatically run dependencies.
2. Refresh the inputs that need an updated source reading. The state, ZIP, CMS, POS, QCOR and address collectors have different release cycles. Record source dates and actual retrieval dates separately. The statewide NJ campus guide is historical. Date its records to its 2018 revision until someone checks the current campus.
3. Rebuild from retained bytes offline. Start with geography, clinical normalization and a provider roster. Freeze the provider assignment IDs before researching reviews. Use a dated identity roster as the input to geocoding and review discovery. Recheck the number of eligible records after any identity change. City or ZIP presence alone cannot select a licensed unit or establish home-visit service area.
4. For an existing roster, the NJ config orders the address, offering and approved-review stages before normalization, runtime publication and the Facebook kit. For a new roster, explicitly select the initial normalization and runtime stages to bootstrap the identity snapshot. Run the manual approval and TypeScript review-release transform on reviewed candidates before the final integrated pass. Rerun normalization and runtime publication after a later evidence pass. Generate the Facebook kit against the newly published catalog. A family account assigned to a campus keeps that scope when multiple licensed units share the name.
5. Verify again. Each stage can fail independently. An offline archive may be internally consistent even when the current source or roster has changed. Review the emitted status and dates for both. Validate the production build and UI through the project tests before publishing.

For example, update just the ZIP source and recheck its retained bytes:

```sh
python3 -B scripts/regions/workflow.py refresh --config research/region-workflows/north-jersey.json --step geography
python3 -B scripts/regions/workflow.py verify --config research/region-workflows/north-jersey.json --step geography
```

The CMS collector preserves completed captures. Use a fresh dated archive for another round and verify it before explicitly selecting it as an input for normalization:

```sh
python3 -B scripts/regions/cms_collect.py collect --output research/north-jersey/cms-archives/<new-run>
python3 -B scripts/regions/cms_collect.py verify --output research/north-jersey/cms-archives/<new-run>
```

The source-specific tools retain their schemas and measure definitions. The workflow records integrity with a referenced hash (`hash_verified`) or the declared owner's check (`verified`). `present_unverified` indicates inventory. Missing, stale, inconsistent, or changed-during-check outputs cause verification failure. Exit 0 means the requested commands or declared checks passed; exit 1 indicates a failed step and exit 2 indicates an invalid request. A successful run is not a measure of pricing, review, or opening coverage.

## Lessons from Massachusetts and North Jersey

| Published coverage, November 12, 2026 checkpoint | Massachusetts | North Jersey |
|---|---:|---:|
| Catalog records | 521 | 974 |
| Recognized ZIPs | 685 | 270 |
| Facilities with nursing inspection histories | 280 | 139 |
| Certified reporting entities with home-health evidence | 7 | 18 |
| Locations with source-linked offering or research facts | 521 | 282 |
| Locations with a positive published price amount | 35 | 20 |
| Locations with a consumer aggregate in the published snapshot | 311 | 40 |
| Published opening claims / waitlist claims | 7 / 8 | 0 / 1 |
| Facebook locations with coverage / with published findings | 22 / 10 | 0 / 0 |

The compact [verification capture](../research/region-workflows/verification-2026-11-12.json) records the audited data revision, runner hashes, step results, local acquisition limits and shared-checkout commands. The table records the integrated catalog after 40 approved New Jersey review aggregates were published. At that checkpoint, 37 met the numeric experience-score threshold. The comparison command gives current counts. Massachusetts used a 55-mile Boston discovery radius and statewide ZIP lookup. North Jersey used six official counties, crosswalked local facility licenses to CMS CCNs, and represented registered service offices separately from certified home health. Its much larger home-care office count (673 versus 2 in MA) reflects different source coverage. Count market size, office service area and real availability separately.

**Identity and location.** Massachusetts has an explicit provider correction ledger. Keep that ledger when reconciling ZIP/address conflicts. North Jersey's separate state and CMS identifiers, campus records and agency offices made name-only joins unreliable. Keep explicit crosswalks, unmatched records, source dates, and distinct units. The NJ address workflow matched 853 of 974 records to a state address point or street interpolation at this checkpoint. Keep ZIP representative points and other fallbacks labeled separately.

**Reviews.** MA's 311 locations with published aggregates describe collection coverage. The scorer additionally checks source access, sample size, date, care setting and shared source family. NJ listing discovery found 62,088 property URLs nationally and created a county-scoped candidate queue. Its denominator is recomputed from eligible regional records, independent of how many profiles have reviews. Compare the queue's provider IDs, number with candidates, retained page checks and final approved releases separately. Historical runs with older tool hashes retain archive-integrity status. Use the current-tool verifier for reproducibility. The Facebook pilot also showed that the number of firsthand accounts exceeds the number of exact-unit family/resident care accounts. Preserve the distinction in future batches.

**Price and availability.** Collection includes 22 NJ locations with a provider-published pricing fact at the offerings checkpoint. Positive comparable amounts, disclosed fee schedules, starting prices and third-party estimates have different denominators. A phone number, inquiry form or tour booking link supplies a concierge next action. It cannot establish a vacancy. Attach a dated location-specific check to any availability claim.

**Clinical evidence.** Keep CMS measured quality separate from consumer experience. A nursing-home citation, home-health survey response rate, provider-level count and consumer review have different subjects and reporting periods. POS verification checks current office certification against the latest retained supplement. Earlier snapshots are checked against their archived receipts and source rows. Partial historical attempts are reported separately. Only exact office CCNs enter published home-health clinical records; reported service ZIPs remain a separate relationship.

## Adding another geography

1. Choose a precise inclusion policy for physical locations and record whether broader ZIPs are search origins, county overlaps or service-area evidence. Freeze the geographic boundary and publish its limitations.
2. Create a config in `research/region-workflows/` with the region's ID, state, source adapters, ordered steps and verification commands. Reuse the existing source adapters where licenses, geography rules and outputs agree. Use relative artifact paths, source hash references, clear owners and explicit coverage gaps.
3. Start with official identity and location, then attach CMS evidence, address precision, offerings, price and review evidence to trusted provider IDs. Keep unknowns and inaccessible sources in the coverage denominator.
4. Run plan, selected refreshes, offline rebuild and read-only verify. Recompute coverage with distinct denominators for cataloged locations, source checks, approved pricing and eligible experience scores. Use the MA and NJ results as method comparisons.
5. Register the region in the shared builder, market registry and importer, including tests for ID or ZIP collisions, exact office/unit joins and default-market behavior. A runner config alone does not publish a new market. Check the new geography through search, provider detail and coverage export after publication.

The read-only comparison verifier checks referential integrity, source counts and retained evidence without running the modifying MA preparation scripts. Supplementary clinical comparator captures require independent release review. Review-score release uses the existing TypeScript scoring policy; run `python3 -B scripts/regions/release-reviews.py --check` with Node and tsx for a full recalculation. The workflow's offline release check verifies the saved inputs, scorer version and output hashes.
