# North Jersey address points

This snapshot bulk-matches the official published business locations in
`research/north-jersey/runtime/providers.json` (974 records across Bergen, Essex,
Hudson, Morris, Passaic, and Union) against official public geocoders.
It does not change the runtime catalog, the normalizer, or the application.

## Sources

| Source | Role | Accuracy labels |
| --- | --- | --- |
| [NJ Office of GIS `NJ_Geocode` locator](https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer) | First pass, rooftop queries | `nj-address-point` (`PointAddress`, `Subaddress`), `nj-street-interpolated` (`StreetAddress`) |
| [Census Geocoding Services](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) | Second pass for records NJ did not uniquely validate | `census-street-interpolated` (address-range match, never a site point) |

Both are approved public official sources. Every request is retained under
`raw/<source>/<query-hash>.json` with its response body, byte count, SHA-256, and
check timestamp. The release is rebuilt offline from those retained responses.
The NJ locator is refreshed from NJOGIS address points and road centerlines; the
Census service documents its results as interpolated along an address range.

## Result (checked 2026-11-12)

| Outcome | Records |
| --- | ---: |
| Matched, NJ address point | 784 |
| Matched, NJ street interpolated | 13 |
| Matched, Census street interpolated | 56 |
| Fallback, supplied coordinate kept (not verified) | 30 |
| Fallback, ZIP representative point kept | 91 |
| Total | 974 |

`coverage.json` breaks matched and fallback counts down by county, setting, and
county-setting, lists exception counts, and holds the two same-ZIP examples
(`07002` Bayonne, `07003` Bloomfield) where distinct validated street points
replace a shared ZIP representative point.

## Commands

```sh
python scripts/regions/address-points.py collect   # fetch missing or failed queries, then build
python scripts/regions/address-points.py build     # offline rebuild from retained responses
python scripts/regions/address-points-test.py      # parsing, acceptance, and release tests
```

Collection is incremental. A retained successful response is reused; a retained
error stub is refetched. `build` reruns are byte-identical, verified by comparing
SHA-256 hashes of all four release outputs across consecutive runs.
On macOS the fetch uses `/etc/ssl/cert.pem` (or `$SSL_CERT_FILE`), matching
`cms_collect.py`; the stock python.org interpreter cannot verify these hosts
otherwise.

## Record shape (`providers-by-id.json`)

One record per provider ID, keyed by that ID. Each record keeps:

- `suppliedAddress` and `addressParts`: the original address, plus the parsed
  base street and the preserved unit text (suites, floors, `STE`, `#`).
- `suppliedCoordinate` and `zipFallback`: the catalog coordinate and the ZIP
  representative point, both labeled, both kept as fallback.
- `status`, `lat`, `lng`, `coordinateAccuracy`: the selected point. A matched
  point is always street-level. A fallback point is labeled
  `zip-representative-point` or `supplied-coordinate-unverified`.
- `match`: matched address, per-field checks, match type, score, source
  location identity (NJ block/lot or Census TIGER line), source URL, check
  date, and retained-body hash.
- `attempts`: every source tried, with its candidates and any access error.
- `exceptions`: explicit conditions such as
  `unit_preserved_but_not_geospatially_verified`,
  `city_label_differs_exact_street_and_zip_validate_match`,
  `unparseable_or_postal_only_address`, and
  `no_unique_validated_official_street_match`.

`locationId` is a deterministic hash of normalized base street, ZIP, and unit.
`premisesId` drops the unit, so suites in one building share a premises record
in `shared-premises.json` without merging provider identities.

## Acceptance policy

A candidate becomes a verified street point only when all of these hold:

1. Exact street number and street name after conservative abbreviation
   normalization (`STREET` to `ST`, direction words, and so on).
2. Exact five-digit ZIP.
3. State is NJ and the geocoder's county agrees with the record's supplied
   county (Census county comes from its county geoLookup).
4. The match type is a site or street-range match, never a postal or locality
   match.
5. The coordinate is finite, inside the NJ envelope, and not equal to any
   retained ZIP representative point.

City label differences (for example `New Providence` versus
`New Providence Borough`) never validate a match alone; they are recorded as an
exception while street number, name, and ZIP carry the validation.
Two distinct validated coordinates for one address reject the match as
ambiguous. County and ZIP centroids are never accepted as street points.

## Limitations

- `entranceVerified` is always false and `accuracyMeters` is always null. An
  address point is the published site location, not a surveyed entrance.
- Unit designators are preserved as text but not geospatially verified; the
  point identifies the building or street, not the suite.
- A Census match is interpolated along an address range. Treat it as less
  precise than an NJ address point.
- Fallback rows keep the catalog coordinate. They assert nothing new.
