# County-reported payment and care services

The Morris County Office on Aging directory is a historical source for a named office’s services and accepted payment. Page references are preserved. An active NJ registration and an exact office match are required for each public record. A missing entry says nothing about whether the family can obtain care. Harbor does not turn private-pay acceptance into a quoted rate, availability or a verified care visit.

Run `python3 research/north-jersey/home-care-pay-services/transform.py` from the repository root to rebuild the county observations from the retained state, county and office inputs. Run `python3 research/north-jersey/home-care-pay-services/test_transform.py` for transformation tests. The North Jersey market build joins accepted entries through `scripts/regions/nj_pay_context.py`. Only offices in the published market are displayed. The supplementary first-party fee schedule for Bonjour could not be tied to an active branch and is excluded.

The HHS history uses two releases covering 2018 through 2024. The claims extract requires the same verified organization NPI to be both billing and servicing provider for personal care (T1019 or T1020). The enrollment extract selects active NJ Medicaid group segments, clips open ends at December 2024, and excludes CHIP. Each fact uses the last documented month for that measure. The data identify organizations and do not supply a place of service, a family rating or current plan acceptance.

To reproduce the reviewed history, download the Parquet from [HHS spending](https://opendata.hhs.gov/datasets/medicaid-provider-spending/) and the ZIP from [HHS enrollment](https://opendata.hhs.gov/datasets/medicaid-provider-enrollment-segments/). With Python 3.11+ and PyArrow, run from the project root:

```sh
nppes=research/north-jersey/home-care-nppes/verified-branch-facts.json
python3 scripts/regions/audit-medicaid-personal-care.py --parquet /tmp/spending.parquet --nppes "$nppes" --output /tmp/claims.json
python3 scripts/regions/build-medicaid-history.py /tmp/enrollment.zip /tmp/claims.json "$nppes" research/north-jersey/home-care-pay-services/federal-program-history.json --checked-at 2026-11-15
```
