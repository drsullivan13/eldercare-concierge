# Original review catalog

This additive catalog supplies individual source-linked accounts without changing the existing location evidence or score inputs. `src/lib/review-catalog.ts` reads `src/data/review-catalog.json` on the server. Its type-only contract lives in `src/lib/review-catalog-types.ts`.

Reported counts belong to the source's rating aggregate. Retained counts describe distinct acquired accounts. A page reporting 39 ratings can expose only five original review articles. `exhausted-visible-pages` means all reachable permitted public pages were traversed, not that all underlying Google reviews were acquired.

## Collection boundary

`access.json` records operational access assessments. MyLivingChoice allows low-volume public property reads. Its internal APIs remain excluded. Caring.com, A Place for Mom, Birdeye, Find Candor and TrustAnalytica are not automated collection targets. Unavailable access policies remain unresolved rather than being treated as permission.

`plan.json` contains exact provider and public source URL targets derived from both released markets and approved editorial identities. `pages/` contains privacy-safe receipts from actual FetchUrl responses. Each receipt keeps the page hash, original review permalink, native review ID, source month and exclusions. It omits reviewer names, bodies, diagnoses, contact information and author-profile URLs.

The collector exposes an offline transport boundary. Run `queue`, fetch those public URLs through FetchUrl, then pass a temporary JSON array of FetchUrl responses to `ingest --input /absolute/path.json`. Each response also needs `sourceId`, `requestedUrl` and the actual `checkedAt` date. Do not retain that raw temporary response file after ingestion. The checked-in collector never starts a network request or discovers private endpoints.

Pagination follows explicit next links in the review section to the identical location path. It stops on missing links, repeated URLs/content/IDs, no new rows, the reported total, failed access, identity/parser mismatch, 20 pages per source or a two-million-byte returned page. Unsupported pagination is recorded as a limit. The collector never guesses cursors or query parameters.

New acquisitions are link-only unless an independently reviewed editorial release supplies a short safe paraphrase. Existing privacy-approved excerpts retain their original wording. Neither representation implies a redistribution license. Month-only dates remain month-only. Google material republished on MyLivingChoice is still one Google source family.

## Replay

Run from the checkout root.

```sh
python3 -B scripts/regions/review-catalog.py plan
python3 -B scripts/regions/review-catalog.py queue
python3 -B scripts/regions/review-catalog.py build
python3 -B scripts/regions/review-catalog.py check
python3 -B scripts/regions/review-catalog-test.py
npx tsx --test tests/review-catalog.test.ts
```

`manifest.json` binds reviewed inputs, all 95 sanitized NJ page receipts and output hashes. `check` also rejects a stale plan. Default replay validates public editorial fingerprints and redacted Massachusetts receipts without opening private original HTML. Optional original-evidence audit belongs to each source release generator.

The Massachusetts owner supplies `research/massachusetts/review-catalog/catalog.json`. The shared producer verifies its replay, then merges exact providers and original Google IDs. Two proven retained aliases keep their stable published IDs and record the previous provisional link in `retainedReview`. `scopeNote` keeps the North Hill campus population distinct from its four eligible Pines Edge nursing accounts.

`coverage.json` records per-source reported and retained counts, previously unseen IDs, pages checked and exact stop reasons. Previously unseen means absent from the approved original-row baseline for that exact provider and original source. It is not a claim that a person never reviewed another location.

The collector preserves published account IDs when the exact original review is already in the released location evidence. Other IDs hash the exact provider and underlying original review key. Google wrapper and place-ID variants deduplicate by the original review token. The optional `nativeReviewId` supports editorial joins without replacing stable account IDs.
