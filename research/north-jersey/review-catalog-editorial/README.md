# Additional readable review accounts

This overlay adds 112 short editorial paraphrases from 25 exact-provider pages beyond the existing 41-page excerpt input. It does not publish them to the application. The combined inputs cover 66 distinct provider pages after integration.

An agent editor read all 123 original displayed articles on these pages. Eleven remain withheld. The released accounts include 86 positive, 14 mixed, and 12 critical assessments. These are selected visible accounts, not 123 independently verified people or a representative sample. No automated MyLivingChoice summary supplies a paraphrase. These assessments are not represented as human verification.

## Files and join contract

`decisions.json` holds the editorial decisions. Its page keys are source property slugs. Each native review ID maps to sentiment, relationship, experience stage, and a paraphrase. A withheld ID contains only its disposition and reason. Role and stage describe the account's own claims. Unsupported relationships and stages remain unknown.

`overlay.json` is the reproducible, source-bound integration artifact. Join pages by `providerId` and `sourceId`. Join individual accounts by `originalReviewKey`, the exact original Google review URL. `id` preserves the existing `mlc-external-<native ID>` convention, and `sourceReviewId` preserves the numeric MyLivingChoice report ID. Do not join by author or paraphrase.

Each page binds the original HTML, original cache receipt, and derived discovery receipt by SHA-256. Each row binds its whitespace-normalized original article body by SHA-256. No complete body, author identity, clinical history, personal age, or contact information appears in the overlay.

`source-receipts.json` retains only identity and per-article ID, original link, month, and body hash metadata from the private audit. `release-fingerprint.json` binds the reviewed overlay, editorial decisions, minimal receipts, and validator. `validate_public_release(release)` checks these bindings and current official identities without opening private raw HTML, cache receipts, or discovery pages. Replacing a provider, original link, or body hash fails validation. These public checks authenticate the reviewed release, not a fresh source-page inspection.

Render only rows with `publication` equal to `released`. Use `paraphrase` as editorial prose, never quotation text. The supplied `publicationLabel` distinguishes an account from verified care facts. A withheld row has no readable text and must never fall back to its original body. Keep the original link, underlying Google family, source month, role, and stage. Do not invent a publication day or infer a personal relationship from the page's marketing claims.

The longest released paraphrase has 165 characters. The largest word count is 26. Publication caps remain 240 characters and 40 words.

## Identity and publication boundaries

Every additional page passes the existing release validator's exact name, street, city, state, compatible care-unit, and unique included official-crosswalk checks. Original HTML corroborates the location heading and identity fields. This goes beyond a sitemap slug or the collector's candidate status. Source ZIP remains null when the page does not publish it. The official address retains its actual ZIP.

CareOne at Livingston's nursing page belongs to `cms-315479` at 68 Passaic Avenue. Its assisted-living page belongs to `north-jersey-doh-nj30a009` at 76 Passaic Avenue. They are separate locations and never share accounts.

Phoenix's unresolved adult and pediatric population remains held. Pages combining independent living with other units, or assisted living with nursing, were not admitted. Ambiguous same-address official units were not admitted. Earlier privacy, wrong-unit, and other excerpt exclusions remain blocked. The overlay never replaces an existing reviewed page or its decisions.

New withheld rows include professional collaborators, a volunteer, a professional performer, an account naming a different provider, an uncorroborated former location name, and a sensitive multi-provider narrative. Other new accounts may contain private details in the retained original. Their short paraphrases omit those details without converting allegations into established facts.

The source policy permits low-volume MyLivingChoice research, not unrestricted narrative redistribution. This overlay uses short paraphrases, not full bodies or newly licensed quotations. It makes no new requests to MyLivingChoice, Google, CareOne, Caring.com, or any restricted source. Google republication remains one source family. No aggregate, numeric score, or clinical evidence changes.

## Context retained

- Maple Glen's `305870` retains praise for therapy and improved meals alongside complaints about cleaning, staff conduct, supervision, and heating and hot water.
- Brighton Gardens of Saddle River's `547823` retains praise for daily care alongside reported falls and the requirement to pay for a private aide.
- Benchmark at Roseland's `628561` retains the reviewer's update about communication and staff departures rather than publishing only the earlier praise.
- Sunrise of Woodcliff Lake's `655970` remains an admissions complaint. Its paraphrase explicitly says the reviewer does not assess care quality.
- CareOne at Valley's `609214` distinguishes the author's observations from another resident's reported delay.
- CareOne at Livingston's `609458` follows its positive narrative rather than inferring negative sentiment from the article's two-star display.

## Reproduce and check

Run these public checks from the checkout. Private retained pages are not required.

```sh
python3 -B research/north-jersey/review-catalog-editorial/build.py --check
python3 -B research/north-jersey/review-catalog-editorial/test_publication.py
```

Run the strict private audit only where the original retained cache is installed. `build()` remains the private in-memory reconstruction API. `--write-public-receipts` intentionally rebuilds the overlay and minimal receipts after editorial changes.

```sh
python3 -B research/north-jersey/review-catalog-editorial/build.py --check --audit-private-captures
python3 -B research/north-jersey/review-catalog-editorial/build.py --write-public-receipts
python3 -B scripts/regions/review-excerpts-test.py
```

The new publication suite passes 23 tests with private evidence installed. Eleven strict private tests are explicitly skipped when it is absent. The existing excerpt suite passes 41 tests. The publication checks reject source hash changes, missing article decisions, access-policy denial, wrong source addresses, missing official identities, prior exclusions, and prior held pages. Earlier original links remain blocked even if a copied account has a different native ID. Baseline accounts cannot be counted again on a new page. Public tests reject provider, original-link, body-hash, and receipt-fingerprint changes without private reads. The tests also check deterministic bytes, source months, privacy boundaries, complete populations, mixed-account context, and derived counts.

An initial address-mutation test used an abbreviation absent from the actual receipt and did not mutate its fixture. The corrected test asserts that the original street text exists before changing it. It then proves that the source mismatch blocks release.

A temporary snapshot copied tracked repository files plus these new public editorial files. It contained zero private raw, cache, or discovery-page captures. Public `build.py --check` passed there. The publication suite passed its 12 public tests and explicitly skipped 11 private-only tests. The snapshot was removed automatically.

The catalog owner's integration suite also passed five tests through the real catalog join. This verifies that all released paraphrases reach their exact provider and original receipt while withheld rows stay absent. No application build or UI test was run. No commits were made by this editor.

## Throughput and ownership

The first unit established separate ownership and the join contract in `/tmp/harbor-catalog-editorial-interface.txt`. The second checked exact identities and read complete article populations in small batches. The third built the overlay and ran publication checks. This editor did not start nested agents.

Separate Before Serializing Shared State kept all repository writes in this directory. Model the Domain separated provider pages, original accounts, and withheld decisions. Prove It Works required rebuilding against the original HTML and official crosswalk instead of trusting candidate matches.

Nine additional already-approved pages lacked original review HTML in the inspected cache. Their aggregate-redacted receipts cannot supply readable accounts. They were sent to the acquire owner for possible capture. No source description or automated summary filled those gaps.
