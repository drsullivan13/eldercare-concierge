# New Jersey official state collection

This collection retains state records for Union, Morris, Essex, Bergen, Hudson, and Passaic. It does not update the application catalog.

## Retained sources

| Source | Coverage | Source date and limitations |
| --- | --- | --- |
| [NJ DOH long-term-care directory](https://healthapps.nj.gov/facilities/fssearch.aspx) and its [All_LTC.xlsx export](https://healthapps.nj.gov/facilities/documents2/All_LTC.xlsx) | Statewide workbook, filtered to assisted living residences, assisted living programs, comprehensive personal care homes, and residential dementia care homes in the six counties. | The retained workbook has a November 6, 2026 run date. It has facility IDs and license IDs, which can differ. It does not supply current license status or establish memory care services within assisted living licenses. |
| [DCA CCRC program](https://www.nj.gov/dca/codes/offices/ccrc.shtml) and its [consumer guide](https://www.nj.gov/dca/codes/publications/pdf_ccrc/ccrc2011.pdf) | Appendix VII, printed pages 36 through 40, lists campuses by county. The six target counties contain seven entries. | The guide says revised January 2018. Its filename, HTTP modification date in 2023, and retrieval in 2026 are not its source revision date. It supplies no campus certificate or registration IDs. These are historical listings, not a verified current CCRC register. Bergen has no entry in the guide, not a confirmed absence of campuses. |
| [NJ Consumer Affairs health-care service firms](https://www.njconsumeraffairs.gov/hcservice) and its linked [public registration search](https://rgbportal.dca.njoag.gov/public-view/) | The public portal's `HP*` registration search and XLSX export. All statuses remain in the retained source and county outputs. HP is the health-care-service-firm registration series. | Captured November 12, 2026. The portal publishes no dataset effective date. The complete filtered export has 3,623 rows, equal to the displayed result count and below the portal's 5,000-result cap. It includes old registrations, duplicates, missing license-type labels, and one lowercase `hp` identifier. |
| [NJ municipality dataset](https://data.nj.gov/Reference-Data/Municipalities-of-New-Jersey/k9xb-zgh4) and [state locality search](https://www.nj.gov/cgi-bin/infobank/localsearch.pl) | Official municipality and local-name county relationships. | Home-care registry rows do not include county. The collector derives county from these references. For ambiguous names, it requires a unique intersecting DOH city and ZIP county. This is a location inference, not a source-supplied firm county or address-level geocode. |

Each raw input has a JSON sidecar with its URL, retrieval timestamp, SHA-256, and size. HTTP modification dates remain separate. Generated records point to the exact source row or PDF page.

The municipality response has 564 rows, matching the state API's count query. The locality table has 3,301 rows, matching its displayed total. One malformed Cumberland locality row has no county cell and cannot support a county assignment. Its original HTML remains in the capture.

## Counts in this capture

Home-care counts describe registrations at business addresses assigned to each county. They do not describe service areas, private-pay acceptance, or Medicare home-health agencies. A firm outside these counties may serve residents inside them.

| County | Licensed care-unit rows | Explicit dementia care homes | Historical CCRC campuses | Home-care rows, all statuses | Distinct HP IDs, all statuses | Distinct HP IDs with an Active row |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Union | 12 | 0 | 1 | 260 | 259 | 117 |
| Morris | 30 | 5 | 2 | 139 | 138 | 60 |
| Essex | 21 | 1 | 2 | 473 | 471 | 208 |
| Bergen | 44 | 12 | 0 | 352 | 348 | 161 |
| Hudson | 2 | 0 | 1 | 164 | 160 | 70 |
| Passaic | 10 | 0 | 1 | 130 | 129 | 58 |
| Total | 119 | 18 | 7 | 1,518 | 1,505 | 674 |

The county home-care counts are lower bounds. `unresolved-home-care-counties.json` retains 59 NJ rows with unrecognized spellings or ambiguous county relationships. They include target-area candidates such as `PINE BROOK`, `Washington Township`, `Newfoundland`, and misspellings such as `Elizabeith`, `BERLELEY HEIGHTS`, and `FLORAM PARK`. The collector does not silently repair them or assign them to the most convenient county.

## Record identity

The collector models three separate record kinds.

- A licensed care unit retains both `FacID` and `LIC#`, source address, county, source date, expiration, license type, and original source fields. Two units with the same campus name remain separate. Morris contains separate assisted living and personal care licenses for The Terraces at Florham Park.
- A historical CCRC campus retains the guide's name and campus address. Its official ID and license status are null because the guide does not supply them. Lantern Hill's guide address is 535 Mountain Avenue, while its DOH assisted living unit is at 537 Mountain Avenue. The collector does not merge them.
- A home-care registration retains the exact registration ID, legal name, DBA, business address, status, expiration, and source row. Duplicate registration rows remain separate. Distinct-ID counts do not resolve conflicting histories or establish distinct operating agencies.

An `Active` label can coexist with a past expiration date. Both facts remain intact. A state listing does not establish current availability, care quality, or an endorsement.

## Rebuild and verify

Requirements are Python 3.11 or newer and Poppler's `pdftotext`. Live collection and DOH verification also need the installed `agent-browser` CLI and its Chromium browser. No Python packages or credentials are needed.

Run from the repository root.

```sh
python3 scripts/regions/nj_collect.py
python3 scripts/regions/nj_test.py
```

The first command rebuilds county JSON and coverage from retained sources without a network request. The tests verify actual outputs, source hashes, exact source-field retention, source disagreement reporting, county ambiguity handling, duplicate preservation, and deterministic rebuilding.

To refresh all inputs and cross-check the live DOH searches, run the following command.

```sh
python3 scripts/regions/nj_collect.py --download --collect-firms --verify-live
```

On this Mac, the Python.org installation needs the system certificate bundle. If Python reports a certificate-chain error, use the verified bundle without disabling TLS verification.

```sh
SSL_CERT_FILE=/etc/ssl/cert.pem python3 scripts/regions/nj_collect.py --download --collect-firms --verify-live
```

To start with Union and Morris, use the following command. It writes only those county folders, but coverage describes only the selected counties until the default all-county build runs.

```sh
python3 scripts/regions/nj_collect.py --counties Union Morris --verify-live
```

Source refresh overwrites the local capture. Copy the state directory elsewhere first if retaining a previous vintage matters. The collector performs public reads, including the portal's read-only search and export POST requests. It does not register, update, publish, or send data to the state.

## Verification and open work

Union and Morris passed first, with exact live-search ID sets of 12 and 30. All six counties then passed the same comparison for 119 IDs. The retained live result rows also agree with all 119 workbook street addresses and ZIP codes.

The live result names disagree with the workbook on one ID. `NJ5A003` is `MONARCH PARAMUS` in the workbook and `SUNRISE ASSISTED LIVING OF PARAMUS` in the live search. Both records say 567 Paramus Road, Paramus, NJ 07652. `live-doh-verification.json` records the disagreement. Neither name replaces the other.

Open work includes a current DCA CCRC register with certificate IDs, address-level resolution of the 59 home-care rows, and provider-specific memory care evidence for assisted living units. Current license status and private-pay arrangements need their own checks.

The new Python acceptance suite is scoped beside the collector because this task owns only `scripts/regions/nj*` and this state research directory. Existing application tests do not exercise this standalone collector. No application code changed.

## Execution decisions

- Blocking first steps. Read the repository's evidence rules and inspect actual official source formats before writing extraction logic.
- Independent workstreams. The XLSX, PDF, and portal discoveries are independent reads. Their outputs feed one county build.
- Shared mutable state. One collector owns the state output tree. Builds and live verification run serially.
- Smallest safe decomposition. One assigned implementation owner keeps source capture, county assignment, and provenance consistent. No nested coding agent is needed for this bounded assigned task.

Model the Domain kept licensed units, campus listings, and firm registrations separate. Build the Lever produced the rerunnable collector instead of hand-entered lists. Prove It Works required the live ID comparisons, retained disagreements, full export reconciliation, and acceptance tests.

Commits, pushes, external writes, publication, and deployment are excluded by the task.
