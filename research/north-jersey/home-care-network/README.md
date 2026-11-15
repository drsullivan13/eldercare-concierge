# Exact-office NJ FamilyCare directory evidence

This research gives portal maintainers provider-ID-keyed historical directory facts for all 1,074 offices in the supplied roster. It does not change the application.

**Verification means only that one organization listing matches the roster's organization, full address, city, ZIP, and phone.** It does not establish current participation, eligibility, an active contract, authorization, availability, unlisted services, or guaranteed insurance coverage. It does not transfer payer evidence between care units or services. Not found is not nonparticipation.

## Final results

The check date is 2026-11-14. Every PDF states "This directory is updated as of 10/06/2026." Each cover carries a `NOV26` edition code. The source date is therefore 2026-10-06, not the check date or an inferred November update.

| Mutually exclusive disposition | Provider IDs |
| --- | ---: |
| Verified exact office | 31 |
| Hold with an identity discrepancy | 182 |
| Hold with no directory phone hit or home-care identity anchor | 857 |
| Hold carried from the roster's location flag | 4 |
| Total | 1,074 |

There are 1,043 holds. The 31 verified IDs represent 30 distinct listed office identities and 42 listing occurrences. Two Broadway Respite and Home Care roster IDs share one office identity. Both IDs remain separate.

The original 30 verified records and their 41 occurrences remain unchanged. The only appended exact match is `north-jersey-hp-hp0174100`.

### Valley's Hospice-only directory fact

The [official region 1_1 PDF](https://www.fideliscarenj.com/content/dam/centene/wellcare/nj/pdfs/directories/NJ_Caid_Provider_Directory_Region_1_1_Eng_Spa_R.PDF#page=212) lists the following on physical page 212, printed page 197.

| Field | Printed value |
| --- | --- |
| Heading | Hospice |
| Organization | Valley Home Care Inc |
| Practice name | Valley Hospice |
| Payer provider ID | 3452476 |
| Address | 15 Essex Rd, Ste 301 |
| City and ZIP | Paramus, NJ 07652-1457 |
| Phone | (201) 291-6000 |

This is a historical Hospice-only listing. It is **NOT a PCA/home-care payer claim**. It does not establish hospice eligibility either. The new listing's `serviceEvidenceLimitation` carries these limits into `verified.json`. The practice name remains separate from the organization name.

## Complete phone-audit coverage

Every strict match must share a roster phone. Replay scans every original raw page for all 1,047 distinct roster base phones, including the base numbers of four phones with extensions. Verification still compares the complete roster phone and does not silently drop extensions.

| Region | Published counties | All PDF pages scanned | Home-care occurrences | Phone hits | Broader-directory candidate occurrences |
| --- | --- | ---: | ---: | ---: | ---: |
| 1_1 | Bergen, Warren | 360 | 49 | 32 | 2 |
| 1_2 | Passaic, Sussex | 240 | 29 | 12 | 0 |
| 2_1 | Essex | 292 | 49 | 26 | 1 |
| 2_2 | Hudson | 188 | 29 | 21 | 0 |
| 3_1 | Middlesex | 312 | 68 | 47 | 4 |
| 3_2 | Morris, Union | 320 | 52 | 32 | 14 |
| 4_2 | Monmouth, Somerset | 300 | 22 | 14 | 3 |
| Total | | 2,012 | 298 | 184 | 24 |

All 184 phone hits resolve to a reviewed listing occurrence. There are 160 home-care phone hits and 24 broader-directory hits. The existing 298 home-care occurrences include listings without a roster phone hit. Adding the 24 broader candidates produces 322 audited listing occurrences, not a count of every listing in the PDFs.

The pipeline runs 345,828 strict roster-to-candidate comparisons. The original home-care subset remains 320,052 comparisons. All 1,074 roster IDs receive one mutually exclusive disposition, including their base-phone scan and hit IDs.

No source page or phone-anchored candidate remains unexamined. This is a complete phone gate across all sections, not a claim that every unrelated listing was manually transcribed. Names without a roster phone cannot pass the strict identity gate.

Warren and Sussex appear because they share PDFs with target counties. They do not expand the roster. The CSV has no county column, so inferred county assignments do not restrict the comparisons.

### Reviewed non-home-care blocks

The 24 additional blocks retain their actual printed headings.

| Heading | Occurrences | Decision |
| --- | ---: | --- |
| Hospice | 5 | Valley verifies. Three Caliberhealth Plus FC listings fail the full organization name. Faith Hospice Care LLC is a different organization and adds an unlisted roster suite. |
| Psychology | 1 | An individual clinician at Children's Specialized Hospital has a different office address. |
| Skilled Nursing Facility | 4 | Springpoint At Half Acre Road A, Merry Heart Nursing Conv Cent, The Oaks At Denville, and Bridgeway Care Center do not establish the roster organization and full office identity. |
| Retail, under Pharmacy | 3 | Rwjbarnabas Health Infusion An is truncated. Infucare Rx Of Nj has a different name and office. Hackensack Meridian At Home In is truncated and has a different unit. |
| Internal Medicine | 1 | Individual clinician Philip, Shawn DO practices at Advanced Gastroenterology Group Ll. This is not ACE Home Healthcare's organization or office. |
| Substance Abuse | 1 | Owen Home Health Agency Inc is not the roster's Owen Health Care Inc. |
| Child Development Center | 1 | Childrens Specialized Hospital lists Mountainside, not the roster's 888 Easton Avenue office. |
| Licensed Clinical Social Worker | 7 | Individual clinicians list the truncated practice Jewish Family Service Agency Of Cen. They do not establish organization participation. |
| Assisted Living Services | 1 | Merry Heart Assisted Living is a different organization and office from Merry Heart Home Care LLC. |

Five of these blocks use phones already present in home-care listings. They are the three Caliberhealth Plus FC Hospice occurrences, Faith Hospice Care LLC, and Owen Home Health Agency Inc. They were audited rather than excluded by the earlier home-care phone scan.

The Bridgeway Care Center hit uses the base number of roster phone `(908) 722-7022 X218`. Both organization and complete phone fail. The base-phone audit broadens discovery only.

## Replay offline

Python 3.10 or newer is sufficient. Offline replay needs no packages, network, original temporary CSV, downloaded PDFs, or application build.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 research/north-jersey/home-care-network/replay.py
PYTHONDONTWRITEBYTECODE=1 python3 research/north-jersey/home-care-network/replay.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -W error::ResourceWarning -m unittest discover -s research/north-jersey/home-care-network -p 'test_*.py' -v
```

Run these commands from the repository root. Absolute script paths also work from another directory. The default command regenerates six outputs. `--check` compares their bytes without writing.

Capture requires certificate-validating `curl` and Poppler's `pdftotext` and `pdftohtml`.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 research/north-jersey/home-care-network/replay.py --capture --check
```

Capture downloads each original PDF, checks its existing manifest SHA-256, and reproduces both old and new evidence. It fails if an official PDF changes. Poppler 26.11.0 produced this snapshot. A different extraction version can fail byte comparisons. Downloads use an automatically removed temporary directory inside `sources/`.

## Files and data contract

- [`verified.json`](verified.json) contains historical publication facts keyed by Harbor `providerId`. Its payer provider IDs are separate from Harbor IDs. Only new broader-directory facts add `providerKind`, `directoryGroup`, and `serviceEvidenceLimitation`.
- [`dispositions.json`](dispositions.json) contains every roster ID once, all candidate checks and discrepancies, and complete phone-audit coverage. `scannedListingCount` remains the original home-care count of 298. `broaderDirectoryCandidateCount` separately reports 24.
- [`counts.json`](counts.json) reconciles dispositions, publication occurrences, candidate comparisons, per-source coverage, and phone-audit coverage.
- [`directory-listings.json`](directory-listings.json) preserves the original 298 home-care occurrences unchanged.
- [`broader-directory-listings.json`](broader-directory-listings.json) contains 24 additional phone-anchored source projections, including rejected candidates. They feed the same matching and disposition pipeline. They are not a separate publication verdict.
- [`phone-audit.json`](phone-audit.json) contains all 184 hits with region, physical page, original line and column, raw phone line, scope, and resolved listing ID.
- [`replay.py`](replay.py) owns capture, parsing, strict matching, validation, and deterministic output generation.
- [`test_replay.py`](test_replay.py) contains the 20 pre-existing focused tests and 12 tests added for this completeness fix. Disposition expectations in existing tests now reflect the broader audit.
- [`sources/roster.csv`](sources/roster.csv) is the original supplied roster bridge. Source row numbers, location holds, and registered trade names remain intact.
- [`sources/manifest.json`](sources/manifest.json) is unchanged. It pins roster bytes, official URLs, full-PDF hashes and sizes, page counts, source dates, and original retained-page hashes.
- [`sources/full-raw-pages.json.gz`](sources/full-raw-pages.json.gz) retains complete, original `pdftotext -raw` text for all 2,012 pages. Each region includes its original PDF hash, URL, source date, and check date. The gzip file is 948,169 bytes.
- [`sources/full-raw-manifest.json`](sources/full-raw-manifest.json) binds the complete extraction and roster. The uncompressed evidence SHA-256 is `3fd24ee253150c9fff713e8d0e565ec4ae3fd0f7518bb5b54a9a897ae6f7a245`, also pinned in replay. Compression-library differences cannot change its meaning.
- [`sources/broader-review.json`](sources/broader-review.json) selects the 24 reviewed source line ranges, printed heading ranges, and organization or practitioner kind. Names, addresses, phones, payer IDs, and headings are extracted from original raw text rather than hand-entered as matching overrides.
- [`sources/discovery.md`](sources/discovery.md) preserves the original official landing-page discovery.
- The seven `sources/region-*.pages.json` files preserve the original 164 pages of raw text, layout text, and positioned XML. They include 143 ancillary and MLTSS listing pages and each cover, contents page, and English introduction.
- [`sources/ancillary-all-pages.json`](sources/ancillary-all-pages.json) remains unchanged. It separately retains the seven ancillary `All` pages, for 171 pages in the original detailed evidence set. The new full-raw archive includes these pages too.

## Strict identity and service rules

All identity fields must pass on one organization listing. Organization, complete street and unit or floor, city, five-digit ZIP, and complete phone must agree. A roster `locationHold` always blocks verification. The pipeline cannot combine fields across listings.

Organization normalization ignores case, whitespace, punctuation, and `&` versus `AND`. It does not remove legal suffixes, reorder words, expand abbreviations or truncated names, or use approximate brand matching. Allowed names are the legal name and supplied state-registered trade names. An explicit ` DBA ` delimiter permits its literal before and after names.

Two reviewed multi-name registered fields have literal partitions in `DBA_PARTITIONS`. Joining each partition with `, ` must reconstruct the original field exactly.

- `PRIORITY NURSING SERVICES, WESTERN MEDICAL SERVICES A DIV. OF` permits its two complete components.
- `ALWAYS THERE, INC., ALWAYS THERE HOME HEALTH CARE` permits `ALWAYS THERE, INC.` and `ALWAYS THERE HOME HEALTH CARE`.

Other commas do not split names automatically. DBA authority comes from the supplied roster, not independent registration research in this task.

Street normalization uses the literal `ADDRESS_WORDS` table for street types, cardinal directions, suite, floor, and first through third floor words. Numeric ordinal suffixes disappear. `Fl2`, `2nd Floor`, and `Floor 2` normalize to `FL 2`. Unit values, street numbers, floors, and suite lists cannot disappear. The pipeline does not infer missing suites or city aliases. ZIP+4 remains in source projections while identity compares the first five digits.

Home-care candidate discovery uses an exact organization, phone, or normalized street-and-city anchor. Discovery may omit a `STE` suffix to expose a discrepancy. Verification never omits it. Broader candidates come from the complete base-phone inventory. A candidate is not a match.

Practitioner records keep their primary clinician name separate from their practice name. `organizationProvider` must pass for broader-directory verification. Even an exact practice alias or a roster name equal to a clinician name cannot promote an individual listing into organization participation.

`directorySection` is the explicit printed heading with only the continuation marker removed. Pharmacy records preserve `directoryGroup` as `Pharmacy` and `directorySection` as `Retail`. The Internal Medicine listing is not relabeled Gastroenterology based on its practice name.

Home-care headings remain Home Health Care, Licensed Home Care Service Agency, Personal Care Services, Respite Care Services, Chore/Housekeeping Services, Adult Family Home Care, and Attendant Care. Private Duty Nursing is recognized but has no heading occurrences in these PDFs. `specialty` comes only from an explicit `Subspecialty:` field. The original three occurrences remain unchanged. Personal Care Services is not rewritten as PCA certification or an authorized benefit.

The introduction directs members to the live provider lookup for current information. This task audits only these seven historical Fidelis Care PDFs. It does not search other plans or investigate member benefits, eligibility, authorizations, or current contracts.

## Decision trail and validation

1. The initial artifact retained the roster and all ancillary and MLTSS listing pages. Strict matching produced 30 verified IDs, 41 published occurrences, and 298 home-care occurrences.
2. The first follow-up added seven ancillary `All` pages, capture validation, and three tests. These contain Labcorp, Quest Diagnostics, and transportation contact numbers, not exact-office provider records. The original 20-test baseline passed before this fix.
3. This task reproduced the scope gap with a Valley regression test. It failed with `KeyError: 'north-jersey-hp-hp0174100'`. The parser's home-care-heading filter excluded a strict Hospice match.
4. Considered parsing every PDF record versus retaining complete raw pages and reviewing every roster-phone hit. Chose the latter because every strict match must share a phone. It proves completeness without changing existing name or address rules.
5. Captured all seven PDFs again, matched their original hashes, and retained complete raw pages. The new archive also agrees with every previously retained raw page.
6. Reviewed all 24 non-home-care blocks, including five using phones already found under home-care headings. Retained exact headings and practitioner boundaries. Added their checks to the main disposition pipeline.
7. Included base numbers for all four roster phones with extensions after an initial audit assertion exposed their formatting. Verification still requires the full phone. Bridgeway's additional base-phone hit remains a hold.
8. Bound phone hits to source-ordered original listing blocks. Repeated identical listings on one page remain distinct occurrences under their actual headings.
9. A new test initially expected six broader blocks with phones already present in home-care listings. The retained source shows five. Springpoint At Half Acre Road A's phone is absent from the home-care subset. Corrected that test expectation without changing matching rules.
10. Added 12 tests for Valley's service meaning, preservation of original facts, independent full-page phone coverage, original-page agreement, literal broader blocks, repeated-phone coverage, practitioner rejection, integrated holds, extensions, missing reviews, tampered raw evidence, and reconciled counts.

The completed focused suite has 32 passing tests with resource warnings treated as errors. Offline regeneration and `--check` pass. The original 30-record preservation test pins their complete JSON meaning to SHA-256 `dcdb563cb2183f1a96fda2348afb771f13f07775f898d01b5569ece9f29ce858`.

Model the Domain kept directory occurrences, phone hits, and provider dispositions separate. Build the Lever put the completeness proof in replay rather than a one-time hand audit. Prove It Works required the original failing Valley scenario, independent source scans, and fresh source capture.

No whole-application checks, commits, knowledge-base changes, delegates, or writes outside this folder are part of this task. Temporary helpers and downloads are removed.
