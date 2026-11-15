# Service geography evidence

This directory retains the Census relationship evidence used by
`scripts/regions/homecare_service_zips.py`. It does not publish agency coverage.
The operator release must supply verified source-area claims separately.
The legacy first-party branch records are not inputs.

## Retained relationship

`nj-cousub-2020.psv` preserves the original Census header and rows, in source
order. It includes every nationwide relationship for each ZCTA intersecting an
NJ county subdivision, plus the NJ rows with no assigned ZCTA. The extraction
does not remove water, undefined subdivisions, or potential out-of-state parts.

`manifest.json` records the source URL, retrieval time, original source hash,
retained-file hash, byte lengths, extraction rule, and counts.

- The national source has 112,565 rows.
- The retained file has 1,340 rows covering 598 ZCTAs.
- There are 24 rows without an assigned ZCTA and no out-of-state rows.
- All 598 ZCTAs have exact integer land and water part sums matching the
  published ZCTA totals. Their totals also agree with the independently
  retained Census county relationship.
- There are 21 ZCTAs with positive water area in an undefined subdivision.
  These parts must not disappear from municipal containment checks.

The independently retained NJ postal list has 723 ZIPs. All 598 NJ relationship
ZCTAs appear in that list. The other 125 postal ZIPs cannot acquire geographic
coverage from these ZCTA relationships. An explicit agency ZIP claim remains
possible.

## Official interpretation

The [Census record layout](https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/2020-zcta-record-layout.html)
defines `AREALAND_PART` and `AREAWATER_PART` as the area of the overlapping part
in square meters. Whole-ZCTA containment requires both totals, not merely
positive overlap or the largest part.

The [Census class definitions](https://www.census.gov/library/reference/code-lists/ansi.html#cousub)
identify `T1` as an active county subdivision and `C5` as an active incorporated
place serving as a county subdivision equivalent. NJ's retained rows use
`T1/A` and `C5/F` for named municipalities. Functional status `F` alone is not
grounds to discard an NJ borough or city. `Z9` means a county subdivision not
defined. An undefined subdivision is not a served municipality.

The official [relationship directory](https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/)
provides the national source. To reproduce the retained file, download the
manifest's source URL and first verify its SHA-256. Parse its pipe-delimited
rows. Collect nonempty `GEOID_ZCTA5_20` values from rows whose
`GEOID_COUSUB_20` starts with `34`. Keep all national rows for those ZCTAs,
plus rows with an empty ZCTA and an NJ subdivision. Serialize the original
header and columns with `|` delimiters and LF line endings. Verify the
result against `retained.sha256`.

## Independent acceptance examples

These counts come directly from the retained relationships and NJ postal list,
not agency claims. Market membership uses `research/north-jersey/runtime/zips.json`
as observed during this task. It is diagnostic and does not enlarge the market.

| Verified full source area | Whole postal ZCTAs | In current market | Missing from current market |
| --- | ---: | ---: | ---: |
| Essex County | 28 | 28 | 0 |
| Somerset County | 19 | 0 | 19 |
| Edison township | 0 | 0 | 0 |
| Bridgewater township | 2 | 0 | 2 |

Essex overlap does not prove `07009`, `07043`, or `07110`. Each crosses a county
boundary. Somerset overlap does not prove `07060`, `07062`, `07063`, `07920`,
`07931`, `07934`, `07979`, `08525`, `08528`, `08540`, `08558`, `08812`,
`08853`, or `08876`.

Edison's overlapping ZCTAs are `08817`, `08820`, `08837`, and `08854`.
Each also includes another municipality. Edison alone proves none of them.
Bridgewater contains all of `08807` and `08836`, but only parts of `07920`
and `08805`. A ZIP's mailing name is not a containment rule.

These are Census geography proofs, not USPS delivery-boundary guarantees,
agency availability, or confirmation of service at an individual address.
