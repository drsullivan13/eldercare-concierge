# Exact-location daily-life evidence

This release contains 228 provider-reported facts for 46 locations, including 41 in NJ and five in MA. It covers 22 locations with existing review aggregates. These are property counts, not review counts.

## Files and provenance

- `reviewed-pages.json` contains manually reviewed quotes and their exact-location assignments.
- `source-captures.json` retains selected excerpts from 73 full-page acquisitions. It omits testimonials, forms, images, and widget code.
- `live-source-audit.json` records a second `FetchUrl` read for every retained capture. All 73 confirmed the retained excerpts.
- `coverage.json` contains generated counts, exclusions, and SHA256 receipts for 71 captures used in published records.
- `excluded-pages.json` withholds Fox Trail Paramus and Park Ridge because their published addresses disagree with the catalog.
- `../../src/data/daily-life-evidence.json` is the generated reader artifact.

The receipts hash canonical JSON for each retained excerpt capture, not the original HTML. Canonical encoding uses sorted keys, two-space indentation, UTF-8, and a final newline. The `access` value `full-page` describes acquisition, not storage.

The offline rebuild command is `python3 scripts/prepare-daily-life.py` from the repository root. `python3 scripts/prepare-daily-life.py --check` compares both generated files without writing. Both commands use Python's standard library and the retained repository inputs.

## Evidence meaning

Facts distinguish dining, care support, numeric staffing, activities, trips, and transport. The builder checks catalog identities, location paths, retrieval dates, quoted support, and fact-source links.

The only numeric staffing claim is Monarch Paramus's advertised licensed-nursing coverage of 24 hours daily. It is not a staff count, ratio, measured hours per resident, or independent quality finding. Included weekly personal-care hours remain service allowances. On-call staff remain care-support claims.

Shuttle services do not establish organized excursions. Hamilton Park's embedded provider post supplies an undated park-outing example, not a current schedule. No missing fact establishes that a service is absent.

## Reader and checks

`getDailyLifeResearch(providerId)` returns a cloned exact-location record or `null`. Its public types live separately from the bundled data. Unknown IDs and withheld properties do not inherit another location's evidence.

The focused acquisition tests are in `tests/daily-life-acquisition.test.ts`. They cover source meaning, location isolation, semantic rejection, invalid dates, source receipts, and deterministic rebuilds. Existing integration tests exercise delivery through the research API and display helper.
