# Independent CMS source checks

The coordinating agent checked these live CMS responses separately from the collector on November 12, 2026.

## Nursing-home roster

The [CMS Provider Information API](https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0?conditions%5B0%5D%5Bproperty%5D=state&conditions%5B0%5D%5Bvalue%5D=NJ&conditions%5B0%5D%5Boperator%5D=%3D&limit=500) returned 348 NJ rows and a count of 348.

Filtering the returned `countyparish` values gives the following active roster.

| County | Nursing homes |
| --- | ---: |
| Union | 23 |
| Morris | 21 |
| Essex | 32 |
| Bergen | 29 |
| Hudson | 15 |
| Passaic | 19 |
| Total | 139 |

The [roster metadata](https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/4pq5-n9py) reports modification on October 1, 2026 and release on October 28, 2026. These are publication dates, not the reporting periods of every measure.

## Independent evidence counts

For each source below, the agent issued four fresh count-only API queries against the 139 roster CCNs. Each query used a disjoint batch of at most 35 CCNs.

The query shape was `conditions[0][property]=cms_certification_number_ccn`, `conditions[0][operator]=in`, one `conditions[0][value][i]` per CCN, `limit=1`, `results=false`, and `schema=false`. The agent summed CMS's returned `count` values. All 32 count queries succeeded.

| Dataset | Source | Six-county rows |
| --- | --- | ---: |
| `r5ix-sfxw` | [Health deficiencies](https://data.cms.gov/provider-data/dataset/r5ix-sfxw) | 3,256 |
| `ifjz-ge4w` | [Fire safety deficiencies](https://data.cms.gov/provider-data/dataset/ifjz-ge4w) | 2,293 |
| `g6vv-u9sr` | [Penalties](https://data.cms.gov/provider-data/dataset/g6vv-u9sr) | 107 |
| `djen-97ju` | [MDS quality measures](https://data.cms.gov/provider-data/dataset/djen-97ju) | 2,363 |
| `ijh5-nb2v` | [Medicare claims quality measures](https://data.cms.gov/provider-data/dataset/ijh5-nb2v) | 556 |
| `tbry-pc2d` | [Survey summary](https://data.cms.gov/provider-data/dataset/tbry-pc2d) | 415 |
| `svdt-c123` | [Inspection dates](https://data.cms.gov/provider-data/dataset/svdt-c123) | 1,161 |
| `fykj-qjee` | [SNF quality reporting](https://data.cms.gov/provider-data/dataset/fykj-qjee) | 7,923 |

Counts describe source rows, not unique events, people, or facilities with adverse findings. Clinical rows can contain suppressed values. A missing penalty row is not a lifetime clean record.

## Home-health office counties

The [CMS home-health roster](https://data.cms.gov/provider-data/dataset/6jpm-sxkc) returns 38 NJ agencies and has no county column.

The separate [CMS iQIES API documentation](https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-internet-quality-improvement-and-evaluation-system/api-docs) identifies Q3 2026 version `8b2c0a70-7e47-4b0f-a592-e51eb315cead`.

A [direct NJ home-health certification query](https://data.cms.gov/data-api/v1/dataset/8b2c0a70-7e47-4b0f-a592-e51eb315cead/data?filter%5Bstate_cd%5D=NJ&filter%5Bprvdr_type_id%5D=3&limit=500&offset=0) returned 75 records. Of these, 38 have `fed_crtfctn_stus_name` equal to `Certified`. Direct source county codes place 18 certified agency offices in the six counties.

| County | FIPS | Certified agency offices |
| --- | --- | ---: |
| Union | `34039` | 1 |
| Morris | `34027` | 3 |
| Essex | `34013` | 4 |
| Bergen | `34003` | 5 |
| Hudson | `34017` | 3 |
| Passaic | `34031` | 2 |
| Total | | 18 |

These are office locations. They do not identify service areas. The `pos/` supplement retains the certification records and the CCN reconciliation separately from the PDC roster.

## Reporting periods

The [nursing-home collection intervals](https://data.cms.gov/provider-data/dataset/qmdc-9999) specify April 1 through June 30, 2026 for staffing levels. Staffing turnover covers April 1, 2025 through March 31, 2026.

The [HHCAHPS measure dates](https://data.cms.gov/provider-data/dataset/fa88-6ff2) specify April 1, 2025 through March 31, 2026. The [home-health clinical periods](https://data.cms.gov/provider-data/dataset/c886-nwpj) differ by measure. For example, OASIS clinical measures cover calendar 2025, while Medicare spending covers 2023 through 2024.

## Verification boundary

This note records independent live observations, not a second raw archive. The source-specific manifests, raw responses, and offline verification commands provide the retained audit trail. No application catalog was updated by this collection.
