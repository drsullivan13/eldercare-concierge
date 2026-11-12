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

Across the six counties there are now 26 locations with a published dollar figure and 37 rate facts with a confirmed period. One campus publishes an independent-living priority list. No dated, unit-specific vacancy was verified. The coverage file continues to carry all 974 locations, including the unsearched and conflicting-address rows.

The Massachusetts comparison suggests three repeatable checks. Search the operator's location page using the full licensed address and alternate URL spelling; this resolved Brookdale Wayne's NJ-specific path. Preserve the apartment or care setting, billing period, inclusions and effective date together. Read disclaimers even on property-branded pricing PDFs: a typical portfolio estimate, a public payer reimbursement rate and a hospital billing file do not establish a household quote for the exact unit.
