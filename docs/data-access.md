# Review data access

The next useful purchase is access to evidence we are allowed to analyze, with enough coverage to improve decisions. Another star-rating widget would not establish that a facility provides good care.

## What is available now

| Source                   | Access and limits                                                                                                                                           | Next step                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMS                      | Public official data; scheduled collection is active for the sources listed in the automation guide                                                         | Review changed survey/clinical records and extend exact facility refreshes. Keep clinical and regulatory evidence separate from consumer experience.                                                           |
| Yelp Places              | Key verified for business matching and details. Standard Places access does not permit commercial analysis, and content caching is limited.                 | Keep the current connector to identity/capability evaluation. Request an Insights agreement covering the intended analysis before expanding.                                                                   |
| Facebook pilot           | Collector supplies public observations and a coverage ledger                                                                                                | Validate, resolve provider/unit identities, review sources and reuse restrictions, then decide what can be retained or published. Provider-selected testimonials and employment disputes need distinct labels. |
| Google Places            | No key configured. Place Details supplies an aggregate and up to five selected reviews, not a complete history. Storage and attribution restrictions apply. | Establish the permitted display/use case and budget before connecting it. Do not assume a Places key permits durable review analytics.                                                                         |
| Caring / A Place for Mom | Existing reviewed public evidence; no ongoing licensed feed established                                                                                     | Ask about location-level coverage, historical records, rights to summarize and derive scores, duplicates and deletion handling.                                                                                |
| Reddit / X               | No commercial collection agreement or production API integration configured                                                                                 | Confirm source-specific access, costs and reuse rights before adding a collector. A web-search result is a lead, not verified review evidence.                                                                 |

Yelp's [Places FAQ](https://docs.developer.yelp.com/docs/places-faq) distinguishes short-lived content caching from permanent business-ID storage and explicitly excludes commercial analysis. Its [Insights documentation](https://docs.developer.yelp.com/docs/yelp-insights) describes a separate product. A working key or a higher Places tier is not proof that Harbor can retain and analyze reviews. Any contracted exception should be recorded with the source configuration and reviewed before changing the connector.

Google references: [Place Details fields](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places) and [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies). Reddit reference: [Data API terms](https://redditinc.com/policies/data-api-terms).

## Yelp inquiry draft

This is a draft for the operator to send. No message has been sent on Harbor's behalf.

**Subject: Yelp Insights access for elder-care location research**

We are building Harbor, a care-research and coordination product for families. Our initial catalog contains 521 Greater Boston care-resource records, including nursing homes, assisted-living residences, continuing-care campuses and home-care organizations. We plan to expand nationally.

We currently have standard Yelp Places developer access. We would like to evaluate an Insights agreement for location-level review analysis. Could you confirm whether your agreement would permit:

- Matching Yelp businesses to our catalog, with separate records for separately licensed units and campuses.
- Retrieving historical review text, dates, ratings and stable review identifiers, plus later updates and deletions.
- Retaining the licensed data and using it to identify experience themes and changes over time.
- Using an external model provider for inference, under a no-training arrangement, where contractually permitted.
- Publishing attributed summaries and a derived experience score that also incorporates other licensed sources, with clear source attribution and coverage limits.
- Maintaining an audit trail and applying required deletion, retention and contract-end rules.

Please share coverage estimates for these care categories in Greater Boston, historical depth, known sampling limits, update frequency, permitted outputs, required attribution, evaluation options and pricing. We can provide a catalog sample for a coverage assessment. We would prefer to measure useful matched coverage before committing to a national contract.

## What to decide before expansion

Set a monthly data budget and require a coverage sample from each vendor. Measure exact-location matches, independent resident/family accounts, review age, duplicate distribution and access rights. Count unresolved entities and inaccessible sources explicitly. A provider with no eligible evidence should remain unscored.

The first Facebook batch and CMS feeds can be reviewed without another credential. Further Yelp analysis depends on agreed rights. Google, search and other platform credentials should be added only when their intended use and cost are clear; use server-side secret storage again, never chat or Git.
