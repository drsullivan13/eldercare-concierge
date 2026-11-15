# UHC June 2026 exact-branch PCA research

This release gives Harbor maintainers provider-ID-keyed historical directory evidence for exact published offices. It does not change the application or promise insurance coverage.

The result is **47 distinct offices and 255 county-specific listing occurrences**. All 886 supplied source rows and all 1,074 published home-care provider IDs have written dispositions. An accepted listing means that one source row passes the specific organization, complete address including suite, city, state, ZIP, primary phone, and branch-quality checks.

## Source evidence and its limits

The official [NJ MLTSS plan page](https://www.uhc.com/communityplan/new-jersey/plans/medicaid/familycare/mltss) links "Download the directory of MLTSS providers and facilities" under "Find a provider" to the [official directory PDF](https://www.uhc.com/communityplan/assets/plandocuments/providerdirectory/NJ_MLTSS_Provider_List_by_County.pdf). The landing page and exact link were read through FetchUrl on 2026-11-14.

**The PDF could not be independently retrieved in this run.** FetchUrl rejects binary files. Certificate-validating curl requests returned HTTP 403, including a browser user agent and an HTTP/1.1 retry. No PDF bytes, PDF hash, cover text, or independent page extraction are claimed. `sourcePdfSha256` is null. A page-specific audit against the PDF itself remains blocked.

The retained source is the byte-for-byte supplied `/tmp/harbor-pulse/uhc-pca.json`. Every accepted listing includes its complete original body and continuation, original extraction line, physical page, source-row ordinal, extract hash, and page-group extract hash. Tests reconstruct all clean listing lines literally against those immutable inputs. These checks establish fidelity to the supplied extract, not independent accuracy of the PDF extraction.

The user identified a 373-page June 2026 edition. Accordingly, `sourceDate` is exactly `2026-06`, with month precision. The review date is separately `2026-11-14`. No June day is inferred. `physicalPage` is the supplied one-based physical PDF page. `printedPage` is always null because no printed labels were supplied. `sourceLine` retains the supplied extraction index without assuming its index base.

The extract contains PCA rows for nine named servicing counties on 35 physical pages. It is not a complete scan of all counties or specialties in the PDF. A servicing county is not the branch's physical county, a verified service area, a current contract, an authorization, or a promise that a member's care is covered. Not found is not nonparticipation.

## Results by named servicing county

Each accepted source row in this snapshot maps to one provider ID. Branch and listing counts are therefore equal within each county. The same office may appear in several counties. The county counts must not be summed to obtain distinct offices.

| Servicing county | Source rows | Accepted branch IDs | Accepted listing occurrences | Excluded rows |
| --- | ---: | ---: | ---: | ---: |
| Bergen | 95 | 32 | 32 | 63 |
| Essex | 127 | 40 | 40 | 87 |
| Hudson | 92 | 30 | 30 | 62 |
| Middlesex | 83 | 24 | 24 | 59 |
| Monmouth | 80 | 18 | 18 | 62 |
| Morris | 89 | 22 | 22 | 67 |
| Passaic | 103 | 31 | 31 | 72 |
| Somerset | 98 | 21 | 21 | 77 |
| Union | 119 | 37 | 37 | 82 |
| Total occurrences | 886 | Not additive | 255 | 631 |

The mutually exclusive source-row dispositions are:

| Disposition | Rows |
| --- | ---: |
| Accepted exact branch | 255 |
| Office discrepancy after a specific organization match | 359 |
| Organization discrepancy despite a phone or full-location anchor | 132 |
| No anchor in the published roster | 114 |
| Unresolved source wrap | 12 |
| Explicit pediatric identity | 9 |
| Uncertain question-mark source name | 5 |

The roster dispositions total 1,074:

| Disposition | Provider IDs |
| --- | ---: |
| Accepted exact branch | 47 |
| No exact anchor in the supplied county extract | 912 |
| Office discrepancy | 67 |
| Organization discrepancy | 29 |
| Explicit pediatric identity | 10 |
| Bridge identity conflict | 5 |
| Existing roster location hold | 4 |

`uhc-counts.json` includes the county-specific exclusion breakdown and reason definitions. `uhc-row-dispositions.json` records all source-row decisions and anchored candidates. `uhc-roster-dispositions.json` records every roster ID, its unmatched reason, all nine scanned counties, and candidate discrepancies.

## Retained inputs and data contract

The data shape separates immutable source occurrences, a complete provider-ID-keyed office roster, organization identity evidence, source-row decisions, and provider-keyed listing arrays.

- `uhc-source-rows.json` preserves the original 886 extracted rows unchanged.
- `uhc-roster.json` retains every published NJ home-care ID from `src/data/regional-markets.json`, not a Fidelis subset. Its compact projection keeps the complete identity, location kind, description, and warnings. It omits coordinates and repeated source and limitation arrays.
- `uhc-bridge.csv` preserves the supplied `/tmp/harbor-agency-exact-office-dba-bridge.csv` unchanged.
- `uhc-registration-identities.json` separately retains each provider's legal name, complete registered trade-name string, registration ID, source rows, and state-source provenance from `src/data/nj-registration-facts.json`.
- `uhc-manifest.json` records original-file and compact-input SHA-256 hashes, byte counts, page-group hashes, edition authority, physical-page semantics, landing-page link evidence, and the blocked PDF retrieval.
- `uhc-directory-listings.json` contains all parsed source occurrences, including exclusions and raw evidence. It is not a publication list.
- `uhc-verified.json` follows the existing Fidelis `verified.json` provider-keyed contract. Each value has `evidenceType`, `payer`, `program`, `checkedDate`, `caveat`, and `listings`. Listings retain the existing identity and source fields and add the servicing county, source-line evidence, and registered identity proof.
- `uhc-quality-checks.json` records all 255 accepted provider-listing pairs and their exact identity, population, location-hold, co-location, and source-page checks.
- `uhc-replay.py` owns deterministic parsing, matching, validation, and all six generated outputs. It uses only Python's standard library.
- `uhc-test.py` is the new focused regression suite.
- `uhc-validation.json` records the final fresh-process replay measurement, checks, and output hashes.

The retained state-source metadata has a 2026-11-15 capture date. That date remains unaltered even though this review is dated 2026-11-14. The supplied local snapshot corroborates the legal and registered DBA identity tie. It does not prove that the registration or DBA was effective in June. Every listing using that proof carries this limitation.

## Written identity decisions

1. Compare all 1,074 published home-care IDs, independently of the earlier Fidelis results. Do not turn an application geocoding label into a care restriction. `locationKind: zip` means approximate map placement in this roster, not a service-area-only office. Explicit headquarters, service-area-only, moved-office descriptions, non-office kinds, and bridge location holds block release.
2. Require the complete published street and every suite, unit, floor, tower, and unit-list token. Normalization handles only the explicit street-abbreviation table, punctuation, case, ordinal floors, and `&` versus `AND`. House and suite hyphens, slash-separated units, and `#` stay meaningful. `#503` does not silently become `STE 503`. Missing floors or suites do not pass.
3. Compare literal normalized city names and the complete published five-digit ZIP. No city aliases, municipal geography, or inferred ZIPs are used. Only the bridge boundary accepts a well-formed ZIP+4 and compares its five-digit part to the published five-digit ZIP. Malformed bridge ZIPs fail.
4. Preserve every organization word and corporate suffix. Normalization ignores formatting, punctuation, whitespace, case, and `&` versus `AND`. It never deletes `HOME`, `HEALTH`, `CARE`, `SERVICES`, `INC`, or `LLC` to make names agree.
5. Permit legal names, the complete state-registered trade-name string, and explicit ` DBA ` components only after the bridge agrees with that exact provider's published office, primary phone, full legal identity, and retained state registration source row. Two literal multi-name fields use the same reviewed partitions as the existing research subsystem. Their components must reconstruct the complete original field. Other commas are not automatic alias separators.
6. Require the directory primary phone as an additional conservative identity check. A shared phone alone never proves organization or branch identity. Do not mix evidence from different source rows.
7. Reject ambiguous co-location when distinct registered legal identities share the full office address, or a different source organization at that same address lacks an evidenced alias tie. The real Acadia and Citadel entries at 7 Glenwood Avenue, Suite 412 are not released. Matching their street must not transfer one organization's evidence to the other.
8. Reject explicit pediatric, children, and kids identities even if they are categorized as PCA. The nine Towne Pediatric occurrences remain excluded. Nearby adult Towne branding cannot rescue the pediatric entity.
9. Leave twelve wrapped records unresolved. Examples include `Inc ... 615 Main StToms River, NJ 08753` and a wrapped Visiting Nurse Association name. Do not reconstruct a missing boundary or city from another county row. The five `Gracious Home Care, LLC?` rows also remain excluded.
10. Treat a same-organization alternate street, suite, city, ZIP, or phone as an office discrepancy. It may reflect a moved office, but this release does not assert a move without evidence. A June directory listing never proves a current location or current participation.

The specific registered DBA tie releases Crosslinks Care LLC under its registered organization rather than guessing that "Crosslinks" is a sufficient brand match. Confident Care Corp is supported by its registered trade-name field, not by automatically expanding `CORP` to `CORPORATION`. Claremont's exact Suite 405 entity remains separate from the older similarly named Suite 404 record.

## Replay and validation

Run from the repository root with Python 3.10 or newer:

```sh
python3 -B research/north-jersey/home-care-network/uhc-replay.py
python3 -B research/north-jersey/home-care-network/uhc-replay.py --check
python3 -B -W error research/north-jersey/home-care-network/uhc-test.py
```

The default command regenerates only the six `uhc-*` outputs. `--check` compares exact bytes without writing. Paths resolve relative to the script, so absolute script paths also work from another working directory. Neither replay command needs network access, `/tmp` inputs, the current application snapshot, the original spreadsheet, or a PDF tool. `-B` prevents bytecode helper files outside the owned filename prefix.

All 24 new checks pass. They audit every source row and accepted listing, the complete roster, exact registered identity ties, page-group hashes, deterministic default CLI regeneration, and read-only check mode. Mutation tests reject suite, city, ZIP, state, phone, organization-word, DBA-proof, co-location, moved-office, headquarters, service-area-only, pediatric, line, date, specialty, and physical-page errors. Source-page tampering fails even when the whole-extract hash is recomputed. Output drift also fails.

One fresh-process default replay took **0.243259 seconds**. That measurement includes startup, imports, all retained input reads and hashes, matching, checks, serialization, all six output writes, and stdout capture. It processed 886 source rows against the full 1,074-ID roster and produced the 47-office, 255-listing result with exit code zero and no stderr. Output hashes were identical before and after regeneration, and a separate `--check` passed. Filesystem caches were not flushed. The eight-CPU host had concurrent work and a one-minute load average of 8.39. This is one observed duration, not a median or performance guarantee. A separate unreported-duration profile identified JSON encoding as the largest self-time work. `uhc-validation.json` retains the measurement boundaries, host context, profile evidence, and hashes.

The existing Fidelis schema, source manifest, replay, tests, and documentation were inspected. No existing application or Fidelis tests were run for this isolated research release. No application integration, commit, or knowledge-base writes were performed.

During validation, `--check` deliberately exposed stale generated files after the directory section was changed to the literal `Personal Care Assistant` source label. Regeneration resolved that expected failure. All final checks pass. Initial PDF retrieval failures remain disclosed rather than being counted as successful source verification.

## Decision trail

The throughput checkpoint kept source inspection and roster reconciliation first. There were no independent implementation workstreams because parsing, identity gates, and dispositions share one contract. Only new `uhc-*` files were mutable. One assigned Droid implemented and reviewed the work directly, as requested.

Two designs were considered. A hand-edited verified map was rejected because it could not explain all source and roster exclusions or reproduce its own decisions. An indexed, deterministic replay was selected. It retains the original source rows and all keyed offices and derives every disposition and accepted listing.

Model the Domain kept source occurrences separate from published offices and independently tied organization identities. Build the Lever led to the durable stdlib replay rather than edited result JSON. Prove It Works led to literal source reconstruction, a review of all 47 accepted branch identities, and negative tests through the complete replay.

The remaining verification gap is independent retrieval and page-by-page audit of the official PDF. It does not justify inventing a PDF hash, a printed page, a day in June, or a coverage claim.
