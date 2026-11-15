# NJ Home Care accreditor directory check

The November 15, 2026 UTC snapshot adds 88 exact offices to the 1,074-office Harbor in-home roster. All 88 were absent from the existing CAHC release. These are dated business credentials and directory facts. Experience scoring is unchanged.

| Official lookup | NJ Home Care results | Offices with a current, location-specific scope | Listed office only | Expired or otherwise outside the check date | No unique accepted identity |
| --- | ---: | ---: | ---: | ---: | ---: |
| [ACHC](https://ams.achc.org/accredited_organizations.aspx) | 137 | 47 | 0 | 0 | 90 |
| [CHAP](https://locator.chaplinq.org/) | 167 | 24 | 2 | 4 | 137 |
| [NIHCA](https://members.nihcaccreditation.com/af_memberdirectory.asp) | 86 | 0 | 15 | 0 | 71 |

## Reproduce the release

From the repository root run:

```sh
python3 -B research/north-jersey/home-care-accreditation-extension/replay.py --check
python3 -B research/north-jersey/home-care-accreditation-extension/test_replay.py
```

Omit `--check` to regenerate `src/data/home-care-accreditation-extension.json`, `decisions.json`, and `summary.json`. Inputs comprise the six JSON receipts under `sources/`, the canonical regional market, the retained NJ registration workbook and registration ledger, and the previous CAHC release. Replay checks every CHAP page digest and the directory query filters. The summary records source receipt hashes; the decision file accounts for all 390 source rows.

## Recheck an office

For ACHC select Home Care as the program, wait for the state selector to reload, then select New Jersey and search. Look up the office by source name and listed street and expand **Show/Hide Accreditation Details**. The relevant program must be Home Care and its dates must contain the snapshot date. The dates and listed services come from the same program block.

For CHAP select Home Care and NJ. Review the location card's address and the dated program under **Location Accreditation**. Nine result pages covered 167 distinct offices. Several offices can share a CHAP organization ID. Source keys therefore also include a discriminator derived from the listing's name, address and phone. If the ID repeats across offices, only the verified directory listing is eligible. CHAP organization-level accreditation anniversaries do not attest an individual office's program.

The join requires a unique active Harbor registration, the registry's legal or trade name, and the full normalized street, unit, city and ZIP. A nonempty CHAP phone must also agree. ACHC search rows omit phone. Unconfirmed matches and out-of-period scopes stay in the decision ledger. Check dates and accreditation end dates are visible in the released source facts.

All three accreditors provide public, unauthenticated lookups. The release attributes minimal organization names, addresses and program facts; no directory images or editorial descriptions are reproduced. Public access does not establish broader rights to reuse the directory. [ACHC site terms](https://achc.org/terms/).

For NIHCA use Advanced Search, United States, New Jersey and category **NIHCA Accredited**. The result count is 86; one record lacks a public street address. All 15 accepted records also had their individual public office pages reopened to verify the directory category, exact name, street/unit and office phone. `sources/nihca-details.json` records the SHA-256 of each checked public page. The general category gives neither a clinical service scope nor an expiration date. NIHCA Accredited PDN is a separate category. The public artifacts omit staff names, email and membership contact records. [Publisher directory](https://members.nihcaccreditation.com/af_memberdirectory.asp) · [Privacy and return policies](https://nihca.membershipsoftware.org/content.asp?admin=Y&contentid=147).
