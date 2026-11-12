# Consumer-review and provider-offering staging CLI

`scripts/regions/reviews.py` freezes the actual North Jersey rosters, retains unresolved and out-of-scope rows, and validates manually supplied, tool-checked observations. The queue puts Union and Morris first, then Essex, Bergen, Hudson and Passaic, then other counties and unresolved geography. It never fetches a page, derives a new county, invents an identity or computes a score. Its outputs are review candidates awaiting Harbor's existing experience policy (`docs/experience-score.md`), not published evidence.

## Commands

```sh
python3 scripts/regions/reviews.py inventory --as-of 2026-11-12
python3 scripts/regions/reviews.py stage --as-of 2026-11-12 \
  --observations research/north-jersey/reviews/public-inventory/checked-batch.json
python3 scripts/regions/reviews.test.py
```

- `--as-of` is the assessment date. No clock is read, so the same inputs give the same bytes.
- `--counties` takes a comma-separated list of New Jersey counties. The default is `union,morris,essex,bergen,hudson,passaic`. Union and Morris always sort first, then Essex, Bergen, Hudson and Passaic, then any other county alphabetically.
- `inventory` is `stage` without observations. Every location is `not-checked`, including unresolved and out-of-scope locations.
- The observations file must be inside the repository and outside `research/north-jersey/reviews/runs/`.

Exit codes: `0` means the run is written with no errors. `1` means the run is written and `errors.json` is not empty. `2` means a usage or observations-file error, and nothing is written. `3` means the CLI refused to overwrite a run folder.

## Reproducing the published pilot

The public replay input contains 31 normalized observation outcomes and 11 discovery leads. It omits raw property pages, reviewer names and narratives. Its companion evidence file records the receipt hashes of the original locally checked material and source fields needed for the staging replay. The original documents are not needed to reproduce the staged candidates.

For an exact input inventory, see `research/north-jersey/reviews/public-inventory/inputs.json`. The collector reads 26 official roster inputs and seven dependencies, including the policy registry at `research/north-jersey/reviews/source-access.json`. The registry governs access; permission does not establish a source's accuracy or a location match. These source rows and all-status registration keys are a separate denominator from the 974 published runtime locations. The subsequent redacted editorial release rechecks evidence against current runtime IDs and actual source pages before computing review scores.

## Roster inputs

These are the roster paths, relative to `research/north-jersey/`. Referenced raw source files, the CMS manifest and `reviews/source-access.json` are also read and hashed as dependencies. Other files are not rosters.

| Path                                                                   | Identifier                               | Care setting                                             |
| ---------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `cms/manifest.json`, else `cms/manifest.partial.json`                  | n/a                                      | Lists CMS pages. Dataset and partitions must be complete |
| Pages of dataset `4pq5-n9py` named by the manifest                     | `cms-ccn:<CCN>`                          | `nursing-home`                                           |
| Pages of dataset `6jpm-sxkc` named by the manifest                     | `cms-ccn:<CCN>`                          | `home-health`                                            |
| `cms/nursing-homes/*.csv\|json`, `cms/home-health/*.csv\|json`         | `cms-ccn:<CCN>`                          | From the folder name                                     |
| `state/<county>/care-units.json` (`licensed_care_unit`)                | `nj-doh:<official_facility_id>`          | Record's `official_type`                                 |
| `state/<county>/home-care-firms.json` (`home_care_firm_registration`)  | `nj-dca-hcsf:<official_registration_id>` | Record's `official_type`                                 |
| `state/<county>/ccrc-campuses.json` (`historical_ccrc_campus_listing`) | `source-row:<repository path>#<record index>` when no official ID exists | Null when the guide does not publish a care setting |
| `state/unresolved-home-care-counties.json`                             | `nj-dca-hcsf:<official_registration_id>` | Record's `official_type`                                 |

A CMS page must hash to its manifest receipt. A file is CSV with a header row, a JSON array of objects, or a JSON object with a `records` or `results` array. Columns resolve through case- and punctuation-insensitive aliases, so `CMS Certification Number (CCN)` and `cms_certification_number_ccn` are the same column. Two columns that resolve to one field make the file an unknown schema.

| Field    | Accepted column names                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| CCN      | CMS Certification Number (CCN), CMS Certification Number, Federal Provider Number, CCN                                 |
| State ID | official_facility_id, official_registration_id, License Number, License No, State ID, Facility ID, Registration Number |
| Name     | Provider Name, Facility Name, Name                                                                                     |
| Street   | Provider Address, Address, Street Address, Address 1, Address Line 1, Street                                           |
| City     | City/Town, Provider City, City, Municipality                                                                           |
| State    | State, Provider State                                                                                                  |
| ZIP      | ZIP Code, Provider Zip Code, ZIP, Postal Code                                                                          |
| County   | County/Parish, Provider County Name, County Name, County                                                               |
| Setting  | Setting, Care Setting, official_type, License Type, Facility Type                                                      |
| Unit     | Unit, Care Unit, Unit Name (optional)                                                                                  |

Roster retention and staging eligibility are separate. The normal CMS nursing and DOH unit schemas still require their identity columns. Numeric identifiers or ZIPs, malformed CCNs, ambiguous aliases and contradictory county folders are not repaired. Rejected rows keep their original input, source reference and reasons, with a `not-checked` entry in `coverage.sourceRows`.

The actual source schemas have these explicit exceptions.

- CMS home-health dataset `6jpm-sxkc` has no county column. Each office keeps its CCN and address, with null county and unresolved geography. All 43 captured rows remain, including five Pennsylvania offices marked out of scope. Service-ZIP edges in `cms/home_health_service_zip_edges.json` describe documented service relationships, not physical-office counties. This CLI does not use those edges to assign an office county or claim six-county office coverage.
- Home-care registrations may have null county or an empty license-type label. Both stay missing. A missing type sets `setting` to null and blocks exact-unit staging. `recordKind` still identifies the row as a registration, without inventing a care offering. The row's `license_status` (Active, Expired, Closed or Revoked) is carried verbatim into roster rows, location `licenseStatuses` and `licenseStatusRows`, and the county status summaries. Duplicate rows that disagree keep every status and set `licenseStatusConflict`.
- Historical CCRC objects contain a name, complete address string and explicit county, but no official identifier or separate city, state, ZIP or care setting. They keep the complete address in `address.street`; the absent components and `identifier` stay null. Their provisional `source-row:` key is not an official ID. `sourceDate` remains `2018-01`, and `input.source` retains the PDF hash and page. These rows remain `unresolved-identity` and cannot produce candidates or provider facts. The record kind also blocks staging by itself: even a future historical row with a complete identity produces no candidates or provider facts.
- A malformed published string ZIP remains verbatim and sets `identityStatus` to `unresolved-identity`. It cannot pass staging even when an observation repeats it. The current firm capture contains one such row. No ZIP repair is performed.

County comes from the supplied row, never a new town or ZIP lookup. Explicit county bases remain `Explicit DOH source COUNTY field` and `Explicit DCA directory county heading`. Firm rows also accept the upstream bases `NJ municipality name match` and `NJ locality name match`, optionally followed by ` disambiguated by DOH city and ZIP county`. These rows require the documented official municipality and locality references, plus the DOH workbook for disambiguation. Each reference must have an official NJ URL, retained file and matching SHA-256. The output labels the geography `derived` and preserves the exact basis and reference receipts. This accepts the existing state collector's documented relationship, not an independent address-level verification.

Every supplied `source.sha256` and county-reference hash is checked against the retained file. The manifest records those dependency hashes, so a changed raw source changes the run identity even if a normalized roster file did not change. Missing or mismatched provenance rejects the row rather than trusting its geography.

`scope` is `in-scope`, `out-of-scope` or `unresolved-geography`. Geography status is independently `explicit`, `derived` or `unresolved`. Unknown-county NJ offices do not enter county totals. A known non-NJ office is out of scope even when its county is unresolved. All retained rows appear in the frozen roster and row-level coverage. Duplicate official identifiers remain separate source rows and share one location key. Separately licensed units keep separate keys even at one address.

An empty JSON array or header-only CSV is a loaded source with zero rows. Missing files, invalid schemas and incomplete CMS datasets remain gaps. County `rosterStatus` is `loaded` when all expected sources load, `partial-roster` when only some load, or `missing-roster` when none load. A zero count alone never means a source is missing.

## Observation file

```json
{
  "schemaVersion": 1,
  "observations": [
    {
      "id": "obs-0001",
      "rosterKey": "cms-ccn:<CCN from roster.json>",
      "outcome": "observed",
      "kind": "consumer-listing",
      "platform": "<platform name>",
      "sourceFamily": "<platform or family name>",
      "sourceType": "review-platform",
      "population": "consumer",
      "url": "https://<page as visited>",
      "canonicalUrl": "https://<page's canonical URL>",
      "checkedAt": "YYYY-MM-DD",
      "inspection": "full-page",
      "access": {
        "decision": "permitted",
        "basis": "<terms or robots finding>"
      },
      "identity": {
        "name": "<name shown on page>",
        "street": "<street shown on page>",
        "city": "<city>",
        "zip": "<ZIP>",
        "careSetting": "<roster setting, e.g. nursing-home>",
        "careUnitText": "<page's category or unit label, quoted>",
        "unit": null
      },
      "rating": {
        "kind": "consumer-average",
        "value": 0,
        "scale": 5,
        "count": 1,
        "asOf": null
      },
      "syndication": { "status": "original" }
    }
  ],
  "leads": [
    {
      "id": "lead-1",
      "name": "<provider>",
      "url": "https://<where found>",
      "foundAt": "YYYY-MM-DD"
    }
  ]
}
```

The values above are placeholders, not evidence. Each observation's `outcome` is one of three:

- `observed` with `kind` `consumer-listing` (above) or `provider-page`.
- `not-listed` with `platform`, `checkedAt` and `method` (how the platform was searched).
- `access-gap` with `platform`, `checkedAt` and `reason` (the retrieval failure).

A `provider-page` replaces `rating`, `syndication`, `sourceFamily` and `population` with these fields:

```json
{
  "sourceType": "provider-website",
  "sourceClaimDate": null,
  "offerings": ["<offering label as published>"],
  "prices": [
    {
      "amount": 1,
      "currency": "USD",
      "period": "month",
      "label": "<as published>",
      "claimDate": null
    }
  ],
  "openings": "not-listed"
}
```

`prices` and `openings` are either `"not-listed"` or a non-empty list. Not listed is staged as `unknown`, never as zero or no vacancy. `period` is one of `hour`, `day`, `week`, `month`, `year` or `one-time`. Each opening is `{ "claim": "<quoted>", "claimDate": "YYYY-MM-DD" | null }`.

## Validation rules

An observation is `invalid` when its id is missing or repeated, its `rosterKey` is not in this run's roster, `outcome` or `kind` is unknown, `checkedAt` is not a real date, or `platform` is missing. An invalid observation does not count as a check.

An `observed` record is `excluded`, with reasons, unless all of these hold:

- `inspection` is `full-page` and neither URL is a search-engine page.
- `access.decision` is `permitted` and `access.basis` is not empty. This self-assertion is a cross-check only; it never establishes permission on its own.
- Every observed and canonical URL host must hold a permitted entry in `reviews/source-access.json`; the gate fails closed. Hosts are lowercased, trailing DNS dots are stripped and a `www.` prefix is removed, then matched exactly or on a subdomain boundary. A registry record grants permission only when its `access_decision` starts with `permitted`. A record whose decision starts with `restricted`, `excluded`, `disabled` or `authentication` denies its hosts, and a denial overrides any permission for the same host. `caring.com`, `care-one.com`, `seniorcare.com` and `yelp.com`, including subdomains, stay denied even without a registry record. Registry hosts come only from a record's `host`, `terms_url`, `robots_url` or `url`, never from its source label; a record such as MyLivingChoice that names no `host` is identified by its URL fields. `retain_as_eligible: false` records an identity withholding, not an access denial, so `360healthcare.online` is not a forbidden host; its pages stage only after a future registry record grants a permitted decision. A missing or malformed registry is a run error and excludes observed pages, and a URL host with no permitted entry is excluded. The registry hash enters the run identity.
- After case, punctuation and common street-suffix normalization, the observed name, street, city and ZIP equal the roster row. A trailing `(<identifier>)` and the words `the`, `inc` and `llc` are ignored in names. `careSetting` must equal the roster setting, `unit` must equal the roster unit (both may be empty), and `careUnitText` must be present. Roster rows that disagree for one identifier block staging.
- The roster exact-unit identity is resolved, and the location is not out of scope. Retention of an incomplete source row does not relax any observation identity check.
- `checkedAt` is no later than `--as-of`.
- For a consumer listing, `sourceType` is `review-platform` or `public-discussion`, and `population` is `consumer`. `rating.kind` is `consumer-average`. `scale` is 5 or 10, `value` is between zero and `scale`, and `count` is a positive integer. `checkedAt` is at most 180 days old, and `asOf` is null or a date no later than `checkedAt` and at most 365 days old. Syndication `status` is `original`, or `syndicated` with a `family`.
- For a provider page, `sourceType` is `provider-website`, `sourceClaimDate` is present as a date or null, and prices and openings follow the shapes above.

Third-party offering claims remain in the observation's original input. They never become provider-confirmed facts in `provider-facts.json`.

Source family follows `src/lib/experience-score.ts`. A syndicated listing takes the family it republishes. A Place for Mom, APFM and SeniorAdvisor become `aplaceformom`, and Caring.com becomes `caring`.

Each checked location gets a `sampleStatus`. It is `no-eligible-aggregate` when there are no candidates. It is `insufficient-sample` when the largest count per source family sums to fewer than 10, so the existing policy cannot rate the location. Otherwise it is `awaiting-review`. This is a bound, not a score. The policy's own deduplication and calculation still decide.

## Run output

Each run is written to `research/north-jersey/reviews/runs/<as-of>-<digest>/`. The digest covers the as-of date, the counties, this script's hash and each roster, dependency and observation input's path and hash. Identical inputs reuse the folder and report `unchanged`. A folder with different contents is never overwritten. Writes go to a `.tmp-` folder first and are then renamed. The run manifest uses `schemaVersion: 2`; observation input stays at version 1.

| File                  | Contents                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`       | As-of date, counties, tool hash, roster inputs with load status and per-file row counts, dependency hashes, observations input, counts, rejected rows by reason |
| `roster.json`         | Frozen rows with key, identifier, source path, hash and row, and the input row verbatim. Also rejected rows, duplicate identifiers, shared addresses and declared crosswalks |
| `observations.json`   | Every supplied observation with `accepted`, `excluded` or `invalid` and its reasons                                                                                          |
| `candidates.json`     | Accepted consumer aggregates as `ExperienceAggregate` and `ExperienceSource` shapes, status `awaiting-review`                                                                |
| `provider-facts.json` | Accepted provider-page offerings, prices and openings with check and claim dates                                                                                             |
| `leads.json`          | Discovery-only leads. They never enter the roster or coverage                                                                                                                |
| `coverage.json`       | Per county source availability, license-status, geography and record-kind summaries, historical-CCRC counts, and counts by setting. Every retained location's scope, identity, license statuses, geography, source rows and check outcomes. Every parsed source row, including rejected rows. Separate unresolved-geography and out-of-scope summaries |
| `errors.json`         | Missing directories or rosters, incomplete CMS datasets, hash mismatches, unknown schemas, parse errors, invalid observations and leads                                      |

For JSON roster files, `row` is the 1-based record index. For CSV files, it is the source line number.

Per-file `accepted` means retained, not eligible for scoring. `outOfScope`, `unresolvedGeography` and `unresolvedIdentity` are subsets of retained rows, not additional rows. `unresolvedGeography` includes known non-NJ offices whose county is absent, so it overlaps `outOfScope`. County totals include only in-scope locations with a documented county. The `unknown` setting bucket is a reporting label for null settings, not a clinical classification. County `locations` and setting counts are distinct location keys, while `rosterRows`, `licenseStatuses`, `geography` and `recordKinds` keep the all-row denominators. `historicalCCRC` counts the 2018 campuses separately from `nonHistoricalLocations`. `inventoryMeaning` labels every county and run total as an all-status/historical roster inventory, not a current-provider catalog.

## Actual-input inventory on November 12, 2026

The normal command `python3 scripts/regions/reviews.py inventory --as-of 2026-11-12` retains all 2,094 supplied source rows as 2,080 distinct location keys. It reports zero rejected rows and zero errors. The source-row total reconciles as follows.

| Source | Retained rows | County treatment |
| --- | ---: | --- |
| CMS nursing | 348 | 139 in the six counties; 209 out of scope |
| CMS home health | 43 | 38 NJ offices with unresolved county; five PA offices out of scope with unresolved county |
| DOH care units | 119 | Explicit six-county locations |
| State firm county files | 1,518 | Existing derived county, all registration statuses retained |
| State unresolved firm file | 59 | Unresolved county, including one repeated registration ID |
| Historical CCRC campuses | 7 | Explicit county, provisional source-row identity, January 2018 source |

The 1,783 in-scope source rows produce 1,770 location keys. Fourteen repeated firm rows across all inputs account for the difference between 2,094 rows and 2,080 keys. Thirteen repeats are in county files and one is in the unresolved file.

| County, in queue order | CMS nursing rows | DOH rows | Firm rows | Historical CCRC rows | All source rows | Distinct location keys |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Union | 23 | 12 | 260 | 1 | 296 | 295 |
| Morris | 21 | 30 | 139 | 2 | 192 | 191 |
| Essex | 32 | 21 | 473 | 2 | 528 | 526 |
| Bergen | 29 | 44 | 352 | 0 | 425 | 421 |
| Hudson | 15 | 2 | 164 | 1 | 182 | 178 |
| Passaic | 19 | 10 | 130 | 1 | 160 | 159 |
| Total | 139 | 119 | 1,518 | 7 | 1,783 | 1,770 |

The separate unresolved-geography denominator has 102 rows and 101 keys. Five keys are also out of scope. The out-of-scope denominator has 214 rows and keys. The inventory checks no review pages and produces zero observations, candidates or provider facts. All 2,080 locations are `not-checked`; these counts do not imply an absence of reviews. License status stays attached to the registration rows: 686 Active, 806 Expired, 24 Closed and 2 Revoked firm rows form 674 distinct active registered offices, so all-status denominators cannot pass as a current-provider catalog. County summaries also split geography (1,505 derived-county firm locations; the CMS, DOH and CCRC rows are explicit) and record kinds, with the 7 historical campuses counted apart.

There are 699 source rows with unresolved exact-unit identity. They comprise 691 blank firm type labels, seven historical campuses and one malformed firm ZIP. Their known counties still contribute to coverage, not score eligibility. The real nursing CCN `315488` is retained from the CMS manifest page. The normalized DOH export covers the listed care-unit types, not the whole SNF roster, so no extra XLSX parsing or fabricated crosswalk is needed.

The suite runs 21 synthetic CLI tests. They cover actual derived-county shapes, referenced-source hashes and repeatability, null-county HHA and firm rows, historical source-row campuses, empty source denominators, forbidden-host contradictions, access-policy hashing, third-party offering exclusions and malformed-ZIP staging blocks. The access-gate tests cover unknown and lookalike hosts, trailing-dot and redirected denied hosts, registry host derivation from URL fields, missing and malformed registries, and identity withholding distinct from an access denial. Further tests cover license-status retention and county summaries and the historical record-kind staging block with complete identity. Fixtures carry explicit synthetic host permissions and live only in temporary test roots, never in real observation batches.
