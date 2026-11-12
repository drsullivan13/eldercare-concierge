# Massachusetts individual review acquisition

This feed adds exact-provider accounts for the Massachusetts catalog without changing scores or aggregates. The acquisition covers six Newton-area cities and the supplied West Newton listing. It is not a statewide coverage claim.

## Released evidence

`catalog.json` is a provider-keyed `ReviewCatalog` feed. It contains 101 acquired accounts for 23 providers, including 98 brief paraphrases and three link-only accounts. Two accounts match previously retained syndication, so 99 are newly identified. Two additional provider records document checked sources with no released accounts.

`receipts.json` records all 123 visible articles from 26 checked listings. Each article has the native MyLivingChoice ID, original Google identity and link, source month, and body hash. No original review body or author name is retained. `reviewed.json` holds the publication decisions and pins the receipts hash.

`browser-pagination.json` records the rendered review sections. Every visible native-ID set agrees with the FetchUrl receipts. None of the 26 sections has a review pagination button or link. "Exhausted visible pages" does not mean that every Google rating was acquired.

`coverage.json` gives every source's counts, stop reason, and all 22 article exclusions. `source-access.json` distinguishes allowed public-page access from blocked automation on Caring and A Place for Mom. No new pages were acquired from those blocked sources.

## Identity and publication limits

The [38-rating North Hill listing](https://www.mylivingchoice.com/property/skilled-nursing-facility-at-north-hill-the) mixes campus and nursing-unit accounts. Four articles explicitly describing Pines Edge rehabilitation attach to `cms-225281`. The campus-only article does not. The source's `scopeNote` discloses the mixed population. Its reported total is not a nursing-unit aggregate or an acquired-account count.

The [Waterstone listing](https://www.mylivingchoice.com/property/waterstone-at-wellesley) says 27 Washington Street, while the catalog says 23. All five articles remain withheld. [Ezra](https://www.mylivingchoice.com/property/ezra-home-care-llc) has no exact provider in the current Massachusetts catalog, so its five articles also remain withheld.

The Sunrise article naming Alexandria and the Avita article naming Wayland are excluded. Professional recommendations, networking events, staff training, and unresolved care-unit accounts have explicit exclusion reasons.

Google is the underlying source family, not a second independent source beside MyLivingChoice. The original Google pages were not fetched. Verification used the individual articles actually displayed on the allowed syndicator, not its automated summaries. Neither the authors' identities nor their claims were independently verified.

## Merge contract

`retained-aliases.json` identifies two proven matches to previously retained Google-syndicated accounts. The original-article verifier checks the matching retained phrases. The shared producer must replace or reconcile those provisional accounts rather than duplicate them.

`merge-examples.json` shows actual retained accounts combined with this feed. The resulting counts are eight for Sunrise, nine for The Falls, and seven each for Adelaide and Goddard House. Those are cross-source examples, not claims of more than five acquired articles on a single MyLivingChoice page.

`nativeReviewId` uses `mlc-external-<external report ID>`. Stable account IDs use the provider ID and underlying Google native ID. Source IDs use `mlc-<property slug>`. The handoff at `/tmp/harbor-ma-catalog-interface.txt` gives the shared producer owner the exact feed path and alias requirements. This owner does not edit that producer, the UI, or the scorer.

## Replay and verification

Run from the repository root.

```sh
python3 research/massachusetts/review-catalog/generate.py build
python3 research/massachusetts/review-catalog/generate.py check
python3 research/massachusetts/review-catalog/test_generate.py
node_modules/.bin/tsx --test research/massachusetts/review-catalog/test_integrated.ts
```

Normal replay needs only the retained redacted artifacts and the current catalog. The generator fails on stale editorial receipts, identity drift, an unreviewed article, or newly recorded pagination controls.

The explicit original-receipt check accepts a directory containing the original FetchUrl JSON responses named `harbor-ma-<property slug>.json`.

```sh
python3 research/massachusetts/review-catalog/generate.py verify-originals --input-dir /absolute/receipt-directory
```

That check passed for all 26 pages before the temporary responses were removed. It verified both retained aliases and all 98 paraphrases. The longest consecutive copied source phrase was four words. A short overlap is a publication safeguard, not a redistribution license.

`validation.json` records the completed checks. Nine new Massachusetts Python tests, one new integrated-reader test, eleven existing Python catalog tests, and seven existing TypeScript catalog tests passed. The integrated-reader test verifies all 101 acquired accounts, the four nursing-unit accounts, and the nine-account merged example through `getReviewCatalog`. The shared producer owner completed the merge. No frontend build or browser test of Harbor was run because this owner changed only research artifacts and their offline generator.
