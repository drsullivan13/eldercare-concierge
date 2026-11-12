# CMS QCOR home-health survey evidence

This collection retains the complete [official HHA 2567 XLSX export](https://qcor.cms.gov/downloadHHA2567) retrieved on November 12, 2026.
It selects every NJ source row and joins current POS office counties by exact CCN.
It does not establish every inspection ever conducted or a complete current inspection history.
It does not change the public application.

## Retained evidence

| Artifact | Contents |
| --- | --- |
| `raw/hha-2567.xlsx` | Exact national export bytes, 65,769,232 bytes. |
| `raw/*.http.json` | Requested URL, effective URL, retrieval time, HTTP status, available HTTP metadata, byte count, and SHA-256. Session cookies are excluded. |
| `raw/listing.html` | Default national listing, which selects surveys with deficiencies. |
| `raw/national-all.html` | National All listing header, 21,531 surveys. |
| `raw/national-without.html` | National surveys-without-deficiencies listing header, 9,612 surveys. |
| `raw/nj-all-001.html` through `raw/nj-all-014.html` | Every NJ All listing page, with official combined web and PDF report URLs. |
| `raw/nj-with.html`, `raw/nj-without.html` | NJ filtered headers, 84 and 47 surveys respectively. |
| `raw/hhas.html` | Official migration warning and CASPER source-date text. |
| `raw/pos-nj-home-health.json` | Exact 75-record NJ POS HHA API page reused from the independent POS supplement. |
| `pos-source.json` | POS release, original supplement path, and supplement hash. |
| `surveys.json` | All 131 NJ events and 506 event-tag rows, including every decoded source field and all four narrative cells. |
| `agencies.json` | All 75 NJ POS offices, including 18 selected certified offices and explicit missing-export status. |
| `manifest.json` | Source receipts, output hashes, counts, checks, limitations, and unresolved source discrepancies. |

The parser uses Python's standard library, including `zipfile` and streaming `ElementTree`.
It preserves text CCNs, leading-zero ZIP codes, source dates, event IDs, tag types, and narrative whitespace.
The source workbook contains no report hyperlinks.
The 14 NJ listing pages supply those URLs without downloading individual reports.
All NJ event identities and tag sets match between the export and the listing.

The workbook records creation at `2026-11-11T04:50:32Z` and modification at `2026-11-11T04:51:59Z`.
These are source workbook dates, not collection dates.
The HHAs page labels its separate CASPER source date `11/08/2026`.

## Observed coverage

| Selection | Survey events | Event-tag rows |
| --- | ---: | ---: |
| Entire national export | 21,531 | 95,296 |
| All NJ export records, 39 CCNs | 131 | 506 |
| Current certified offices in the six target counties | 60 | 262 |

NJ source survey dates run from January 9, 2018 through September 10, 2026.
The national export runs from January 2, 2018 through October 30, 2026.
The unfiltered export includes memo-only events that the default listing excludes.

The selected offices use POS Q3 2026 version `8b2c0a70-7e47-4b0f-a592-e51eb315cead`.
POS reports 38 certified NJ agencies among its 75 historical and current records.
Eighteen certified offices lie in Bergen, Essex, Hudson, Morris, Passaic, or Union.
Seventeen have published surveys in this export.
Their 262 rows comprise 6 Condition, 80 Standard, 81 Element, and 95 Memo rows.
The 95 Memo rows are not deficiency citations.

| Current POS office county | Certified offices |
| --- | ---: |
| Bergen | 5 |
| Essex | 4 |
| Hudson | 3 |
| Morris | 3 |
| Passaic | 2 |
| Union | 1 |

CCN `317022`, Visiting Nurse Association of Englewood, has no rows in this published export.
That absence is not a clean inspection record.
CCNs `317077` and `317082` have published memo-only events.
Their memos remain available as source narratives, not deficiency findings.

Every current and historical NJ export row remains in `surveys.json`, including records outside the target office counties.
Current office FIPS assignments do not establish where an agency had its office when a historical survey occurred.
An agency with an office elsewhere may serve the target counties.
`service_counties` remains null because this source does not establish service geography.
The office join does not merge agencies by name, brand, campus, ZIP, or service area.

## Citation meaning and source limits

The export distinguishes Condition, Standard, Element, and Memo tag types.
`E0000` and `G0000` have the source description `Initial Comments - Not A Deficiency Citation`.
They are always Memo rows and never count as citations.
The collection does not assign severity, penalties, substantiation, or findings beyond the source fields.
The four narrative parts remain separate, unchanged source strings.
Any truncation in the published workbook remains a source limitation.

The [official HHAs page](https://qcor.cms.gov/HHAs) states:

> Due to systems migrations, HHA information generated from the Provider, Survey, and Deficiency Reports on this page is only accurate and/or available through May 19, 2021.

The separate [HHA 2567 listing](https://qcor.cms.gov/HHA_2567_Reports) and export contain later records, including 2022, 2025, and 2026 surveys.
That observation does not override the warning or prove complete inspection history.
Coverage means the complete published-export NJ selection at collection time, not all surveys ever.

The default listing's 11,919 records are not its All count.
The All count of 21,531 matches the export's distinct CCN, event ID, and survey-date keys.
Export tag types identify 11,905 national events with citation rows and 9,626 memo-only events.
The national listing instead labels 11,919 with deficiencies and 9,612 without.
This 14-event classification discrepancy remains unresolved.
The NJ counts do reconcile, with 84 citation-bearing events and 47 memo-only events.
No national filter label overrides an individual row's Memo classification.

The official combined report URLs identify records by CCN and survey date, not event ID.
The separate event ID remains in each survey record.
These are source-listed links, not evidence that each individual report was fetched or independently checked.
The export already supplies the narratives.

## Reproduction

The collector's commands are:

```sh
python3 scripts/regions/cms_qcor.py pull
python3 scripts/regions/cms_qcor.py verify
python3 scripts/regions/cms_qcor_test.py -v
```

`pull` downloads missing sources, checks existing source hashes, then rebuilds derived files.
`build` rebuilds without network access.
`verify` checks every source hash and output hash and independently rebuilds the selection in memory.
It compares all NJ event identities and tag sets against the complete paginated NJ All listing.
It also compares the national distinct survey count against the All listing header.

`--output /absolute/path` selects another retained collection directory.
Existing raw files are not silently refreshed.
A new directory collects a fresh snapshot.
The live-source regression counts and workbook hash identify this specific retained snapshot and require review when the source changes.

TLS certificate verification stays enabled.
The collector honors `SSL_CERT_FILE`, or uses `/etc/ssl/cert.pem` when available.
Requests use Python's default user agent.
The POS page is copied from the existing supplement when available.
Otherwise the collector requests the bounded official NJ HHA API page directly.

All 18 tests were added for this collector.
They cover exact decoded fields, inline and shared-string XLSX cells, sparse columns, leading zeros, alphanumeric national CCNs, event identity, Memo exclusion, distinct tag types, report links, cache hashes, real source counts, office-only county scope, and incomplete-selection rejection.
The repository's application checks were not used to validate this offline research-only slice.
