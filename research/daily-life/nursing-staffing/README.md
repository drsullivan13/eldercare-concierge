# Nursing staffing evidence

This snapshot covers 419 published nursing homes with exact CMS certification numbers, 280 in Massachusetts and 139 in New Jersey. Twenty-one New Jersey state-only nursing listings have no published exact CCN and receive no staffing evidence. The artifact records those exclusions. Names, brands and campuses do not join clinical evidence.

## Sources and meaning

[CMS Provider Information](https://data.cms.gov/provider-data/dataset/4pq5-n9py) supplies reported total, RN, LPN and aide hours per resident-day, weekend total and RN hours, turnover percentages and average residents per day. The snapshot uses reported fields, never case-mix or adjusted hours. It does not calculate ratios or headcounts.

The retained Massachusetts input is `src/data/inputs/boston-region-providers.json`. It contains full role and weekend fields for every published Massachusetts CCN, plus nonempty footnotes and original CMS download provenance. It is a retained projection, not an original API response. No additional Massachusetts provider acquisition was needed. The official CMS endpoint was independently reachable at `https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0?limit=1`.

The New Jersey input is the original CMS response at `research/north-jersey/cms/raw/4pq5-n9py/primary/page-0000000.json`. Its adjacent receipt supplies the retrieval timestamp, source URL, byte count and SHA-256 hash.

[CMS Data Collection Intervals](https://data.cms.gov/provider-data/dataset/qmdc-9999) supplies separate `STAFFING_LEVELS` and `STAFFING_TURNOVER` periods. The builder requires the metadata processing date to equal the provider processing date. The retained records processed on October 1, 2026 report staffing from April 1 through June 30, 2026. Turnover covers April 1, 2025 through March 31, 2026. Neither interval is inferred from a download or release date. The census is the published MDS-based daily average, not occupancy or a staff headcount. A separate census interval is not established in the retained period metadata.

The [October 2026 CMS dictionary](https://data.cms.gov/provider-data/sites/default/files/data_dictionaries/nursing_home/NH_Data_Dictionary.pdf), Table 15 on page 25, defines the footnotes transcribed in `footnotes.json`. The original PDF remains at `research/north-jersey/cms/raw/reference/dictionary-1.payload`. Its SHA-256 hash matches an independent download.

## Suppression and missing evidence

Each metric has `reported`, `unavailable` or `suppressed` status. Only `reported` has a numeric value. Missing values remain null. A published zero remains zero. Invalid or suppressed footnotes override any numeric value and retain the CMS explanation. Unknown footnotes stop the rebuild for review.

Staffing-rating notes are separate from staffing-hour footnotes. A rating note about days without an RN onsite stays visible without suppressing valid published RN hours. The current snapshot has suppressed staffing hours for CCNs 225281, 225668 and 315146.

## Delivery and provenance

`src/data/nursing-staffing.json` stores only selected provider rows, shared field definitions, matched periods, input hashes and exclusions. Each row identifies its source file and row index. The server reader adds the source SHA-256 receipt and field definitions to one provider response. The component imports only shared types. Statewide data does not enter the client through the component.

`getNursingStaffingResearch` returns null for an unknown provider, a non-nursing setting or a listing without an exact published CCN. The research response delivers the optional `nursingStaffing` object. Missing evidence does not fall back to the older summary hours because those fields lack suppression context.

## Rebuild and verification

Run from the repository root.

```sh
python3 scripts/prepare-nursing-staffing.py
python3 scripts/prepare-nursing-staffing.py --check
npx tsx --test tests/nursing-staffing.test.ts
```

The rebuild is offline and deterministic. It verifies original CMS receipts, complete retained pages, exact CCN identity, state, source fields and matching periods. A newly published CCN without retained evidence stops the rebuild instead of guessing a match.

The new tests compare every reported metric with its retained source row in both markets. They also check applicability, source hashes, periods, nulls, suppression, zero values, rating notes, response isolation and rendered component copy. Eight Python boundary tests exercise invalid values, footnotes, mismatched periods, duplicate periods and truncated responses. Existing application-wide checks remain in `CONTRIBUTING.md`.
