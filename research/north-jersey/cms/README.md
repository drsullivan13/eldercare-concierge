# North Jersey CMS evidence

This collection retains official CMS source responses for nursing homes and home-health agencies. It does not update the application catalog.

The November 12, 2026 direct collection completed with 17 datasets, 73 response pages, and 362 checksum-verified artifacts. Offline verification and all 39 regression and retained-artifact tests pass. The suite preserves the existing 29 tests and adds 10 partition-coverage, registry, page-size, and request-URL checks.

## Reproduce and verify

Run these commands from the repository root.

```sh
python3 scripts/regions/cms_collect.py collect
python3 scripts/regions/cms_collect.py verify
python3 scripts/regions/cms_test.py
```

`collect` resumes an incomplete root collection. It refuses to overwrite a completed manifest. For a new release or an independent fresh collection, supply a new directory.

```sh
python3 scripts/regions/cms_collect.py collect --output /absolute/path/to/new-cms-collection
python3 scripts/regions/cms_collect.py verify --output /absolute/path/to/new-cms-collection
```

The collector uses the default Python user agent and verified HTTPS. It honors `SSL_CERT_FILE`. When that variable is absent and `/etc/ssl/cert.pem` exists, it uses that system CA bundle. It never disables certificate or hostname verification. The [transport checks](transport-verification.md) record the custom-user-agent 403 that blocked the prior attempt.

Incomplete runs reuse checksum-verified direct-response pages only when the saved source metadata still equals the fresh catalog metadata. Every run refreshes the catalog, per-source metadata, count probes, count-after responses, and metadata-after responses. A source-release change requires a new output directory. Legacy extracted bridge payloads are replaced with direct responses, not reused as original source bytes.

## Evidence scope

The active NJ nursing roster has 348 facilities. The target roster has 139 facilities.

| County | Active nursing homes |
| --- | ---: |
| Bergen | 29 |
| Essex | 32 |
| Hudson | 15 |
| Morris | 21 |
| Passaic | 19 |
| Union | 23 |

Nursing evidence joins only on exact six-character CCNs. State-filtered pulls retain NJ records outside the active target roster. Inspection dates use the NJ CCN range because that source has no state field. No brand matching occurs.

The independent nursing evidence counts below come from [32 separate live CCN-filtered queries](independent-verification.md). `cms_test.py` compares the emitted target rows with each count, not just their total. All eight counts match. Retained totals include broader NJ records, national definitions and periods, or the discovered non-NJ home-health offices, depending on the source.

| Dataset | Evidence | Retained rows | Target nursing rows |
| --- | --- | ---: | ---: |
| `4pq5-n9py` | Nursing roster and staffing summary | 348 | 139 |
| `r5ix-sfxw` | Health deficiencies | 8,214 | 3,256 |
| `ifjz-ge4w` | Fire safety deficiencies | 5,672 | 2,293 |
| `g6vv-u9sr` | Penalties | 248 | 107 |
| `djen-97ju` | MDS clinical quality | 5,916 | 2,363 |
| `ijh5-nb2v` | Claims quality | 1,392 | 556 |
| `tbry-pc2d` | Survey summary | 1,042 | 415 |
| `svdt-c123` | Inspection dates | 2,951 | 1,161 |
| `fykj-qjee` | SNF quality reporting | 19,836 | 7,923 |
| `qmdc-9999` | Nursing measure and staffing periods | 47 | Not applicable |
| `tagd-9999` | Citation dictionary | 643 | Not applicable |
| `hicp-9999` | NJ inspection-rating cutpoints | 1 | Not applicable |
| `6jpm-sxkc` | Home-health roster and clinical measures | 43 | Not applicable |
| `ccn4-8vby` | HHCAHPS | 43 | Not applicable |
| `m5eg-upu5` | Reported home-health service ZIPs | 2,606 | Not applicable |
| `c886-nwpj` | Home-health clinical periods | 18 | Not applicable |
| `fa88-6ff2` | HHCAHPS periods | 5 | Not applicable |

The other nursing sources retain provider-level staffing, turnover, ratings, abuse and special-focus flags, collection intervals, citation definitions, and inspection-rating cutpoints. The home-health sources retain clinical measures, HHCAHPS surveys, service ZIPs, and both sets of measure periods. All original fields, blanks, suppression markers, and footnotes remain intact.

## Office location and reported service are separate

CMS PDC has 38 NJ home-health offices and no office-county field. Root office counties remain unknown. The separately owned [`pos/` supplement](pos/) collects CMS certification county codes and exact-CCN reconciliation. The independent source check found 18 certified offices in the target counties. The root collector neither modifies nor hashes that supplement.

The separately owned [`qcor/` supplement](qcor/) retains additional CMS survey evidence. It remains separate from the PDC collection and its manifest.

Service-ZIP discovery searches the NJ ZIP range without filtering office state, then also pulls all NJ-office service ZIPs. Each discovered non-NJ CCN gets its own clinical-roster and HHCAHPS query. Office location does not establish a service area. A CMS-reported service ZIP does not establish current acceptance or countywide service.

The collection retains 5 non-NJ offices alongside the 38 NJ offices, with no unmatched service CCNs. The target-county ZIP projection has 1,246 associations. Of these, 1,012 use single-county ZIPs, and 234 remain ambiguous candidates.

ZIP associations use the CMSgov-hosted HUD county-to-ZIP workbook for **2025Q3** at pinned Git revision `10943335a9088114d94b215e5b174bb050b8fd95`. This workbook is stale relative to the 2026 CMS release. A multi-county ZIP remains a set of candidates, even if only one candidate is a target county. It never becomes an exact county assignment.

## Retained provenance and limits

`manifest.json` identifies all 17 sources, query partitions, release dates, retrieval times, byte counts, and SHA256 checksums. `raw/` retains source metadata before and after collection, every response page and count probe, two original PDF dictionaries, and the pinned workbook with its repository provenance. `datasets/` retains each source's complete collected projection. Root JSON files retain the target rosters, nursing evidence, service-ZIP associations, and county coverage.

`verification.json` records offline verification. The verifier checks hashes, metadata equality, family release consistency, pagination, filter values, exact raw-to-dataset projection, workbook projection, derived outputs, and service-CCN roster coverage. It requires exactly one canonical `primary` partition per registry source, the NJ-office service-ZIP partition, and an exact-CCN clinical and HHCAHPS partition for each non-NJ office in the reconstructed service records. It rejects missing, duplicate, unexpected, or substituted partitions, changed source roles or scopes, and invalid page sizes. Every probe, page, and count-after request URL must equal the canonical query for that dataset, filters, pagination, and ordering. The current archive has 28 required partitions, including queries for all 5 non-NJ offices in both home-health sources.

The manifest includes only collector-owned raw, dataset, and derived files. It excludes `pos/`, `qcor/`, and the independently owned verification documents. These verifier changes do not rewrite the manifest or retained responses.

Nursing sources report release on October 28, 2026. Home-health sources report release on October 21, 2026. Publication dates are not measure periods. The retained intervals specify April through June 2026 for staffing levels and April 2025 through March 2026 for turnover and HHCAHPS. Clinical periods differ by measure.

Citations, inspections, and penalties have bounded reporting windows. They are not lifetime histories or original survey statements. A missing penalty row does not prove a clean record. Suppressed clinical values do not become zeros. Provider Information retains PBJ-derived staffing summaries, not standalone daily PBJ submissions.
