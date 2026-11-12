# North Jersey ZIP geography

This snapshot prepares approximate search origins and county indexes for Harbor across Bergen, Essex, Hudson, Morris, Passaic, and Union.
It does not change application search or publish a provider catalog.

## Snapshot

The retained sources were retrieved on November 12, 2026.
`validation.json` records the counts and examples.

| Measure | Count |
| --- | ---: |
| NJ postal ZIPs in GeoNames | 723 |
| Included ZIPs | 270 |
| Census representative points | 224 |
| GeoNames postal-point fallbacks without a matching ZCTA | 46 |
| Excluded NJ postal ZIPs outside the six counties | 453 |
| Included ZIPs with multiple county memberships | 19 |
| Target ZCTAs without a GeoNames NJ postal record | 0 |

| County | County FIPS | ZIP memberships |
| --- | --- | ---: |
| Bergen | `34003` | 71 |
| Essex | `34013` | 45 |
| Hudson | `34017` | 23 |
| Morris | `34027` | 64 |
| Passaic | `34031` | 43 |
| Union | `34039` | 31 |

The county counts total 277 memberships, not 277 distinct ZIPs.
A ZIP can belong to multiple target counties.
The 19 cross-county ZIPs also include overlaps with counties outside the six-county scope.

## Files

`nj-zips.json` preserves the MA lookup shape.
Its keys are five-character ZIP strings with leading zeros.
Each value contains `city`, `lat`, and `lng`.
City labels come from GeoNames, not from the name of a Census municipality.

`nj-zips-provenance.json` records the coordinate source, ZCTA status, all county memberships, target county memberships, and original GeoNames records.
GeoNames source line numbers refer to `US.txt` inside the retained archive.
The Census row keys are the ZIP's `zcta` and each membership's `countyFips`.
Water-only overlaps remain separate from land memberships.

`nj-county-zips.json` indexes included ZIPs by five-character county FIPS.
`exclusions.json` lists every excluded NJ postal record and any unmatched target ZCTA.
`source-manifest.json` records original and effective download URLs, retrieval times, byte counts, and SHA-256 hashes.
`manifest.json` records source metadata and generated-output hashes.
`raw/` retains the unmodified downloaded bytes, including both GeoNames license readmes.
The second GeoNames readme is inside `geonames-US.zip`.

## Selection and county meaning

The candidate postal universe is GeoNames records whose country is `US` and state code is `NJ`.
For a matching Census ZCTA, inclusion requires a positive land-area overlap with at least one target county.
Every positive land-area county overlap is retained, including counties outside the target scope.
No minimum percentage hides small overlaps.
Water-only county overlaps do not establish membership.
The displayed `primaryCountyFips` is the county with the largest ZCTA land overlap, with the larger FIPS breaking a tie.
It is not a postal address majority or an exclusive county assignment.

For a postal ZIP without a matching ZCTA, inclusion uses GeoNames county attribution.
Its provenance explicitly uses `geonames_postal_county_attribution`.
That attribution is not a Census boundary claim or a verified address-based ZIP-to-county crosswalk.
If GeoNames has multiple place labels, the alphabetically first label supplies the lookup label and fallback point.
All source records remain in provenance.

The generator audits every target land-overlap ZCTA against the NJ postal universe.
An unmatched ZCTA appears in exclusions rather than receiving an invented city label.
The current snapshot has none.
No included GeoNames county attribution falls outside its matching ZCTA's land memberships.

## ZIPs are not ZCTAs

[Census guidance](https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html) defines ZIP codes as point-based postal delivery data.
ZCTAs are statistical areas built from Census blocks.
Not every postal ZIP has a ZCTA.
Some ZCTAs can represent institutional, corporate, or PO Box delivery.
Absence from the ZCTA file does not prove that a ZIP is PO Box-only or classify its USPS delivery type.

The 2026 Gazetteer publishes representative internal points for 2020-based ZCTAs.
`INTPTLAT` and `INTPTLONG` are copied without transformation.
These points are not guaranteed mathematical centroids, street addresses, town centers, or provider entrances.
The county relationship file describes 2020 geography.
Its square-meter overlaps are land and water areas, not population or address counts.

GeoNames describes its WGS84 postal coordinates as estimates.
Accuracy `4` means a GeoNames place match, not surveyed precision.
Harbor copies those published points without interpolation or manual repositioning.
Fallback coordinates can differ substantially from the nearby town center.

This snapshot is not USPS ZIP validity verification or an exhaustive current postal directory.
It does not establish provider coverage, availability, drive time, county residence, or licensure.
Use these points only for approximate straight-line discovery.
Confirm actual addresses and service areas before making a care decision.

## Examples

| ZIP | Source label | Latitude | Longitude | County | Coordinate source |
| --- | --- | ---: | ---: | --- | --- |
| `07960` | Morristown | 40.779235 | -74.502462 | Morris, `34027` | Census ZCTA representative point |
| `07083` | Union | 40.695266 | -74.269078 | Union, `34039` | Census ZCTA representative point |
| `07962` | Morristown | 40.8673 | -74.5783 | Morris, `34027` | GeoNames postal-point fallback |

`07963` is another Morristown postal ZIP without a matching ZCTA.
It is not silently mapped to the `07960` representative point.

Plainfield `07060` demonstrates why a single county field is insufficient.
Its ZCTA overlaps Union by 8,075,903 square meters of land, Somerset by 4,863,069, and Middlesex by 7,944.
It is included through Union, but all three memberships remain in provenance.
A county index match does not establish the county of an individual address.

## Sources and reuse

The coordinates follow the existing `src/data/ma-zips.json` conventions.
The MA provenance and `zip-data-sources.txt` use the same Census-first, GeoNames-fallback policy.
This NJ preparation adds explicit many-to-many county memberships instead of treating one GeoNames county label as a geographic boundary.

| Source | Retained file | Fields used |
| --- | --- | --- |
| [Census 2026 ZCTA Gazetteer](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_zcta_national.zip) | `raw/census-2026-zcta.zip` | `GEOID`, `INTPTLAT`, `INTPTLONG` |
| [Census 2020 ZCTA-to-county relationships](https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt) | `raw/census-2020-zcta-county.txt` | ZCTA and county GEOIDs, county names, land and water overlap areas |
| [GeoNames US postal export](https://download.geonames.org/export/zip/US.zip) | `raw/geonames-US.zip` | Country, ZIP, place name, state, county name and code, latitude, longitude, accuracy |
| [GeoNames download readme](https://download.geonames.org/export/zip/readme.txt) | `raw/geonames-readme.txt` | Field definitions, precision limitations, license |

[Census record layouts](https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/2020-zcta-record-layout.html) define the relationship fields.
The [official download page](https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.2020.html) distinguishes same-vintage relationships from change-over-time relationships.
The downloaded 2026 Gazetteer is pipe-delimited, unlike older tab-delimited Gazetteer examples.

Census data are US government works.
Retain Census Bureau attribution.
GeoNames licenses the retained data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Retain the license and [GeoNames](https://www.geonames.org/) attribution when integrating or redistributing these files.
The transformation is an NJ six-county subset, Census coordinate replacement where available, and county-overlap indexing.

Suggested product attribution is "ZIP locations from the U.S. Census Bureau, 2026 Gazetteer. Postal labels and additional estimated points from GeoNames, CC BY 4.0. North Jersey subset combined with Census 2020 county overlaps."

## Verification and unresolved integration

`zip-test.py` independently reads retained source columns and compares every output coordinate and county membership.
It verifies Morristown, Union, postal-only fallback behavior, cross-county memberships, exclusions, source corruption rejection, and output corruption rejection.
It also runs two offline rebuilds and checks byte-identical outputs.
`--check` verifies all source hashes and compares every generated output without writing.
These are new geography checks, not the application's existing MA search tests.
See [rebuild instructions](REBUILD.md).

Application integration remains outside this task.
The current search module still imports the MA lookup and applies Boston pilot limits.
An integrator must add region-aware search, preserve coordinate-source disclosure, and avoid inferring provider service coverage from county membership.
Current USPS validity, address-level county assignment, and delivery-type classification remain unverified.
