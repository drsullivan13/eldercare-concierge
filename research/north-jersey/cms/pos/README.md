# CMS iQIES office certification supplement

This retained supplement joins official New Jersey iQIES Provider of Services records to current CMS Provider Data Catalog rosters by exact CCN. It supplies provider-location county evidence for Bergen, Essex, Hudson, Morris, Passaic and Union. It does not describe an agency's service area or publish evidence into the application.

## Reproduce

Run from the repository root with Python 3.9 or later.

```sh
python3 scripts/regions/cms_pos.py pull
python3 scripts/regions/cms_pos.py verify
python3 scripts/regions/cms_pos_test.py
```

`pull` retrieves public CMS sources with the default Python user agent and verified TLS. It honors `SSL_CERT_FILE`, otherwise uses `/etc/ssl/cert.pem` when present, otherwise uses Python's default trust configuration. It never disables certificate or hostname verification. The custom Harbor user agent is not sent.

Each pull creates an exclusive timestamped directory under `snapshots/`. It retains response bytes before deriving records. A failed pull leaves its partial snapshot for inspection and does not change `latest.json`. Only a successfully verified snapshot becomes the latest snapshot. Previous snapshots and the older `raw/` helpers remain untouched. There are no remote writes.

`verify` performs no network requests. It reads `latest.json`, checks every retained response's official HTTPS URL, retrieval timestamp, HTTP status, SHA-256 and byte count, validates release discovery, dictionary provider types, the API schema and complete pagination, then rebuilds and compares the entire supplement.

## Sources and dates

The pinned [iQIES dataset](https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-internet-quality-improvement-and-evaluation-system) is Q3 2026.

| Source property | Retained value |
| --- | --- |
| Dataset type | `086e48c4-87a6-4be1-8823-29e8da8f225b` |
| Dataset version | `8b2c0a70-7e47-4b0f-a592-e51eb315cead` |
| Release period start | `2026-07-01` |
| CMS page created date | `2026-10-14` |
| CMS page modified date | `2026-10-16` |
| Metadata revision timestamp | `2026-10-16T18:38:14+00:00` |
| Home-health PDC modified / issued / released | `2026-09-21` / `2026-09-21` / `2026-10-21` |
| Nursing PDC modified / issued / released | `2026-10-01` / `2026-09-01` / `2026-10-28` |

The collector checks the current JSONAPI discovery result against the pinned version and type. It compares the pinned and latest primary resource URLs and labels. A changed release fails collection rather than silently changing the baseline.

The manifest identifies the official [primary CSV](https://data.cms.gov/sites/default/files/2026-10/d7e32873-6bf0-4719-9048-376972900d5c/POS_iQIES.DATA.Q3_2026.csv). Collection retains bounded NJ JSON API responses instead of downloading that nationwide CSV. It also retains the [API documentation](https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-internet-quality-improvement-and-evaluation-system/api-docs), [official dictionary](https://data.cms.gov/sites/default/files/2026-10/1fea27a3-7603-4fd2-bc2a-3e868934a9bf/iQIES%20POS%20Data%20Dictionary%20Oct2026.xlsx), schema, metadata and discovery responses.

The completed snapshot for this fix round is [`snapshots/20261112T150611097460Z/`](snapshots/20261112T150611097460Z/). Its 15 retained responses contain 4,765,795 bytes. Retrieval timestamps range from `2026-11-12T15:06:11.383208+00:00` through `2026-11-12T15:06:13.882338+00:00`. The [manifest](snapshots/20261112T150611097460Z/manifest.json) contains each exact request URL, effective URL, HTTP status, retrieval time, response headers, byte count and SHA-256.

| Retained POS response | Bytes | SHA-256 |
| --- | ---: | --- |
| `raw/home_health/pos-00000.json` | 457,286 | `cb6dd2ddea08f18e83a49233ad2b2a8be33fb0e95ef370293c976cdc3f87cb31` |
| `raw/nursing/pos-00000.json` | 2,357,997 | `6679c1a48a847563fa3a192cc3d48b56f694c95d2cd7978aae96a705d90abce8` |

## Exact CCN and county results

The retained home-health responses contain 75 NJ records. Their federal certification statuses are 38 `Certified` and 37 `Terminated`. All 38 Certified CCNs exactly match the 38-record NJ [PDC home-health roster](https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/6jpm-sxkc). There are no unmatched CCNs in either direction. The verifier enforces this identity, not merely equal counts.

Eighteen Certified records have an office in the six target counties.

| POS office county | Certified records | Exact CCNs matched to PDC |
| --- | ---: | --- |
| Bergen | 5 | `317008`, `317022`, `317047`, `317077`, `317082` |
| Essex | 4 | `317009`, `317021`, `317060`, `317061` |
| Hudson | 3 | `317006`, `317050`, `317064` |
| Morris | 3 | `317002`, `317054`, `317092` |
| Passaic | 2 | `317017`, `317058` |
| Union | 1 | `317020` |

The remaining 20 Certified home-health records are not selected for the target office counties. The PDC home-health schema has no county field. Its independently valid county-unknown result is not overwritten or treated as a disagreement. This supplement supplies county from the exact matched POS CCN, not from agency name, ZIP inference or service geography.

The existing nursing supplement contains 387 NJ POS records, including 348 Certified and 39 Terminated records. All 348 Certified CCNs match the 348-record NJ [PDC nursing roster](https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/4pq5-n9py). The 139 target-county Certified records comprise Bergen 29, Essex 32, Hudson 15, Morris 21, Passaic 19 and Union 23. No target-office-county disagreements with PDC `countyparish` were observed. Future nursing roster or target-county disagreements remain explicit reconciliation gaps. The collector does not force the sources to agree.

## Meaning and limitations

[`supplement.json`](snapshots/20261112T150611097460Z/supplement.json) retains every POS field as source text in `source_record`. That includes leading zeros, date strings, `Not Available`, certification IDs and names, compliance fields and terminated records. Each projected record identifies its retained response file, row index, response hash and dataset version.

County selection uses exact POS `fips_state_cd` `34` and three-character `fips_cnty_cd` values. Only `003`, `013`, `017`, `027`, `031` and `039` map to the target counties. Missing or differently formatted county values are not padded or guessed. Provider-location FIPS is not a service-area assertion.

Federal certification status controls selection. Survey compliance does not replace it. Five Certified home-health CCNs have compliance `No` in this source, namely `317022`, `317043`, `317045`, `317058` and `317064`. Nursing CCN `315492` also has that combination. Both source facts remain intact. Certification is not a quality rating, an endorsement or proof of current availability.

The retained API schema has 186 unique fields. The official dictionary differs from the API. API-only names are `fed_fundd_fqhc_sw` and `ot_emplee_sw`; the dictionary instead contains `ot_emplee_sw ` with a trailing space and repeats `physn_arngmt_sw`. These differences are reported in the supplement rather than used to rename or discard source fields.

## Verification observed

The existing `pull` and offline `verify` commands both passed through their default CLI entry points after the final script change. The new `cms_pos_test.py` suite passed all 19 tests. It covers default-user-agent verified TLS, invalid-CA failure, HTTP 403 failure, source hashes and sizes, exact strings and leading zeros, missing counties, certification versus compliance, exact-CCN reconciliation, nursing disagreement gaps, duplicate CCNs, discovery drift, terminal pagination, derived-record tampering and a fresh-process CLI verification from outside the checkout.

Application-wide checks were not run for this bounded research-script change. No PDC or QCOR worker files were changed.
