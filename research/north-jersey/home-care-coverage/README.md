# Harbor home-care coverage audit

Run from the checkout root with installed dependencies and Node 24.

```sh
node research/north-jersey/home-care-coverage/audit.cjs
node research/north-jersey/home-care-coverage/audit.cjs --self-test
node research/north-jersey/home-care-coverage/audit.cjs --self-test --origin https://eldercare-concierge-one.vercel.app
```

The first command writes `report.json`. All commands run synthetic fixtures, audit the full published HCSF roster through default `getLocationResearch` and `publicLocationResearch`, and compare two runtime passes. `--self-test` does not write. The optional production check compares only two sampled, locally scored offices through `/api/research`. Coverage describes this checkout, not the deployed roster or all New Jersey registrations.

## Reading the report

The published NJ HCSF roster must exactly match included `NJ HP registry` crosswalk rows. Those rows supply counties. Roster size and counties are derived, not hard-coded. Overall, county, source and publisher summaries keep exact numerators and denominators. Provider fractions always use the complete applicable roster. Publisher summaries include every published county, including zero coverage. Source, publisher and provider entries each occupy one JSON line.

- `score` is the actual public numeric score or `null`. `aggregates` retains only scorer-included source IDs, platforms, canonical `sourceFamily` values and reported review counts. Overall and county `platforms` and `families` separate `scoredProviders` from `eligibleAggregateProviders`, and `scoredAggregates` / `scoredAggregateReportedReviews` from all `eligibleAggregates` / `aggregateReportedReviews`. Source and publisher summaries use the same distinctions. Counts are not unique people.
- `individual` preserves raw merged, deduplicated account totals. `withText` and summary `readableIndividualReviews` mean trimmed excerpt or summary, without eligibility filtering. `eligibleReadable` and summary `eligibleReadableReviews` additionally require a non-link-only representation, a linked research or catalog source, no provider selection, no search-result-only flag and a non-staff relationship. Compact `eligibleReadableRelationships` counts keep unknown, family, resident and visitor relationships separate. These narratives do not supply numeric scores.
- `unscoredWithEligibleReadableReviews` coverage counts offices with `score === null` and eligible readable accounts. The same key under `counts`, or in source/publisher summaries, counts their eligible accounts. Source/publisher `unscoredWithEligibleReadableProviders` is the office fraction. By contrast, `unrated` / `unratedWithText` and summary `unratedIndividualReviews` / `unratedReadableIndividualReviews` require **account** `rating === null`, regardless of office score or narrative eligibility.
- `evidence` counts source-linked published items. Services include typed directory services and explicit service facts, not address observations, service areas, NPPES taxonomy or accreditation scopes. Accreditation uses typed directory fields. Payments include typed payment options and cost facts. Insurance counts only typed payment options explicitly naming insurance. Neither insurance options nor association Medicaid payment codes verify current insurance acceptance. Other non-registry facts remain `otherFacts`.
- `clientSurveyAwardYears` counts distinct Provider of Choice years for each verified office. Coverage counts distinct offices. Recognition contributes no reviews or numeric score. An office without a published award has unknown survey performance.
- `historicalInsuranceDirectories` means a historical network directory listing, never verified current insurance acceptance. The audit consumes `officeIdentifiers.historicalDirectories[]` from the runtime getter through the public projection. Its evidence map counts each office/source directory membership once, even when several pages reference that office. The provider flag and coverage fractions count offices. Source and publisher summaries retain the payer as publisher, the membership count, and the applicable roster denominator. These listings do not increase `insurance` or `payments`.
- `historicalInsuranceDirectoryPageReferences` keeps per-office page-reference counts by synthesized source ID. Overall and county `counts.pageReferenceCount`, and source and publisher `pageReferenceCount`, total these references separately from directory memberships.
- `registration` uses the runtime registration projection. `registry-only` means sources exist but are entirely regulator evidence, including registration and NPPES identifiers. Historical payer directory listings are research beyond registry-only evidence. `no-research` means neither exists. `retainedLocationRecord` separately counts retained research objects. Catalog presence alone proves no researched service or review. External profiles count navigation links separately and never supply scores or accounts.

Evidence counts measure published items, not distinct concepts or verified current availability. Per-office publisher labels remain intact. Identifier source IDs hash source URLs without retaining those URLs.

The generated report contains the latest office totals.

Fixtures cover narrative exclusions, relationships, scored versus unscored offices, sparse aggregates, source families, catalog deduplication and registry classification. A two-page historical payer fixture proves one listing, two page references, and no current insurance or payment claim. A runtime assertion verifies that the public projection preserves the getter's plural directory field and that the audit consumes its source memberships. Live assertions reconcile counties, sources, publishers, platforms, families, accounts and evidence. A JSON round-trip guards serialization. The UTC `asOfDate` comes from Node; freshness can change later results. Unchanged inputs on the same UTC date produce identical bytes.

The report retains no review text, account IDs, reviewer data or scoring weights. The production check sends no credentials, follows no redirects, and fails on mismatched sampled scores, aggregate counts or source IDs. It does not bypass deployment protection or enter the report.
