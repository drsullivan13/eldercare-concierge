# North Jersey services, rates and availability

Run from the application checkout:

```sh
python3 -B scripts/regions/provider-offerings.py
python3 -B scripts/regions/provider-offerings.py --check
python3 -B scripts/regions/provider-offerings-test.py
```

The command reads the reviewed offices/facilities and their county crosswalk, then joins curated operator-page observations by stable ID, category, normalized street, municipality, state, ZIP and operator name. Normalized names are corroboration only. Observations retain exact URLs and check dates separately from the effective dates the provider actually states. The collector treats the year in the agency filing or an observation date as insufficient evidence for a current vacancy or guaranteed price.

The source selection covers the Sunrise/Brighton Gardens, Arbor Terrace and Brookdale communities identifiable from the roster, Atria Cranford, the two core-county Erickson campuses, a Hudson multi-unit contact page, and Agape's registered home-care office. A missing page is not a completed search. The federal and state projections cover every certified home-health office with services and every licensed long-term-care unit in the runtime with a published unit type or capacity. A registration alone has no service claims attached.

## Outputs

- `locationResearch.json` holds source-linked provider facts keyed by application provider ID. Keep review aggregates and clinical scores in their respective datasets. Use the source IDs when combining records.
- `coverage.json` counts each catalog record exactly once, including unsearched, mismatched and regulatory-only records. It uses the office or facility county. Office coverage does not establish the service territory of an agency.
- `manifest.json` supplies totals by county and care category and hashes of the consumed inputs and evidence outputs. Its roster projection omits map coordinates and downstream review enrichment so confirmed geocodes can change without invalidating pricing.
- `provider-page-checks.json` contains factual observations made from underlying public operator pages, not search snippets. It is an editorial input: do not use a URL candidate or a matching brand as a checked page.

## Reading rates and availability

For instance, the provider's dated November 5 Florham Park page gives separate private-pay starting base rates for assisted living and memory care. Independent-living campus tables give one-time entrance fees and separate monthly service packages with both ends of a range. A published priority list describes a route to an apartment. It supplies neither a wait time nor confirmation that a unit is empty. For Lantern Hill the January 1, 2027 fee change warrants a new pricing check. No fee is an individual quote.

Sources with missing billing periods remain textual and supply no normalizable rate. Atria Cranford's FAQ gives a different starting price from the operator's NJ community listing. The rates are withheld pending a floor-plan-specific check. [FAQ](https://www.atriaseniorliving.com/retirement-communities/atria-cranford-cranford-nj/faq-and-resources) and [community listing](https://www.atriaseniorliving.com/senior-living-communities/senior-living-in-new-jersey/).

Current exclusions include different ZIPs for Woodcliff Lake, a street direction mismatch for Randolph, conflicting street names for Cedar Crest, and a different campus street on the Harbour View contact page. Regional price estimates, inquiry forms and marketing phrases such as limited availability are not availability confirmations.

## Refreshing or adding a market

Review the rows in county and setting order, starting with the priority counties, and record the underlying operator page, exact name and address, unit scope, inclusions, currency, billing period, effective date, and date checked. Record unknown billing periods and unresolved identity differences. Open the provider's availability page before asserting a priority list or a dated opening. Preserve both the operator identity URL and list URL when those claims are on different pages. Demand location-specific published facts for an office's services; the registration establishes only a business identity.

Run with `--market /path/to/market` for compatible directories containing `runtime/providers.json`, `runtime/crosswalk.json` and `offerings/provider-page-checks.json`. Reuse the provider-page and coverage projection. Map another jurisdiction's official source semantics before interpreting its facility capacity or licensure fields. Keep operator checks dated and rerun the offline build before release. The Massachusetts public-data comparison becomes clearer when one records unit scope, price components and availability evidence separately; a state license, base fee, campus deposit and live unit offer answer different family questions.


## November 12, 2026 Hudson and Passaic price follow-up

The [targeted pass](hudson-passaic/README.md) covered all 21 Hudson residential catalog identities and all ten Passaic assisted-living identities. Four new Passaic operator pages publish a starting price. The Bristal and Brookdale add three monthly rate facts. Two Mira Vie prices are textual because the checked source does not establish the billing period. Hudson yielded no comparable private-pay price in the checked evidence.

After the Hudson and Passaic pass there were 26 locations with a published dollar figure and 37 rate facts with a confirmed period. One campus publishes an independent-living priority list. No dated, unit-specific vacancy was verified. The coverage file continues to carry all 974 locations, including the unsearched and conflicting-address rows.

The Massachusetts comparison suggests three repeatable checks. Search the operator's location page using the full licensed address and alternate URL spelling; this resolved Brookdale Wayne's NJ-specific path. Preserve the apartment or care setting, billing period, inclusions and effective date together. Read disclaimers even on property-branded pricing PDFs: a typical portfolio estimate, a public payer reimbursement rate and a hospital billing file do not establish a household quote for the exact unit.


## November 12, 2026 rooms, dining and household costs

Of 974 catalog locations, 79 have at least one room, dining, activity or amenity fact. Room information is available for 70 locations and dining information for 55. Practical coverage is 17 of 239 locations in Bergen, 12 of 272 in Essex, 8 of 94 in Hudson, 14 of 121 in Morris, 9 of 94 in Passaic and 19 of 154 in Union. The denominator includes licensed offices as well as residential settings. Across the catalog, 27 locations publish a dollar amount and 23 have a price with a known period, yielding 108 rate entries. Hudson has no confirmed private-pay rate. None of the six counties has a verified dated vacancy.

The canonical inputs are the roster, county crosswalk, checked operator pages, directory amenities and approved exact-location review source records. An offline build needs no full-page captures or review narratives. The directory input retains 414 nonclinical attributes from 66 exact-location listings, their URLs, check dates and original capture hashes. Directory attributes display with the source and a confirmation instruction. A complementary detail such as a listed private bathroom can appear alongside the operator's private-room description. Neither source establishes which room is available for a particular family.

At Cedar Crest, the state continuing-care directory links the Pompton Plains campus and its roster address to the operator, whose website shortens the street name. The independent-living price table pairs each floor plan's entrance fee with its monthly package and lists a separate second-person charge. The operator says the schedule changes on January 1, 2027. These prices apply only to the campus independent-living record. [State directory, Appendix VII](https://www.nj.gov/dca/codes/publications/pdf_ccrc/ccrc2011.pdf) · [Operator price table](https://www.ericksonseniorliving.com/cedar-crest/pricing)

Complete Care at Harborage describes private and semi-private rooms, dining and therapy at its North Bergen nursing facility. Victoria Mews lists private suites in six layouts, meals and a secure memory-care program. Its contact page uses Boonton as the postal locality for the same street, ZIP and name that the licensing authority places in Boonton Township. Neither operator published a verified household rate on the pages checked. [Harborage facilities and services](https://ccharborage.com/what-to-expect) · [Victoria Mews suites](https://victoriamews.net/services/suites/) · [Victoria Mews license record](https://healthapps.nj.gov/facilities/fsFacilityDetailsPrint.aspx?item=NJ60A004)

For Sunrise locations the price line is tied to the named setting, room type and monthly period before assessed care costs. Independent-living lines from multi-service pages are excluded from assisted-living unit rates. Address mismatches remain withheld. [Westfield room and care pricing](https://www.sunriseseniorliving.com/communities/nj/sunrise-of-westfield)
