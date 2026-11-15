# CAHC office accreditation evidence

Harbor matched the Commission on Accreditation for Home Care's public New Jersey directory to registered offices on November 14, 2026. The release contains 111 distinct offices from 119 accepted listings. Across the 405 listings reviewed, 15 had ambiguous identities and 271 were excluded. Only the accreditor's listed scope is published. Current service availability, renewal status and customer satisfaction require separate evidence.

## Office matching

Acceptance requires an exact primary business phone, New Jersey city and registered legal or trade name. The importer checks co-located registrations and other CAHC listings using the same number. Three listings had ZIP codes that conflicted with registry ZIPs; all three were withheld. The public record includes the source city. Missing ZIPs and original punctuation remain in the research record.

The source URL points to the county or state index page or the statewide alphabetical index where the office appears. To verify an office independently, open that page and search for its directory name. The date is the Harbor check date. [CAHC public provider index](https://www.cahcusa.org/archives/)

## Offline replay

From the repository root:

```sh
python3 -B research/north-jersey/home-care-pulse/cahc-generate.py --check
python3 -B research/north-jersey/home-care-pulse/cahc-test.py
```

The minimized discovery rows, exact-office DBA bridge, original capture hashes, extraction audit, and ordered decisions are stored next to the generator. The generator compares the hash of the underlying state-registry snapshot before release. The test suite reproduces the public records from a clean directory and exercises wrong ZIPs, co-locations, shared phones, mistaken branch names, conflicting headings, and approved scope labels.
