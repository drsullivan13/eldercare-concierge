# Additional consumer aggregates from retained listing pages

Run from the project root after collecting a permitted listing batch. The assessor reads stored full-page responses, the official location roster and the approved baseline ledger. It makes no network requests. A sitemap or URL candidate alone cannot supply a location match, a rating or a count.

```sh
python3 -B scripts/regions/listing-release.py scan --output-dir /tmp/harbor-listing-next-wave
```

Use the scratch `page-inventory.json` to inspect every response disposition and `candidates.json` for potential new approvals. Check each source capture. Match the actual listing title, street, locality, care unit and review population against the exact provider identity. Compare the visible Google panel to the named-location attribution. Review employment, competing-place and mixed-campus indications in the underlying section before making a decision. Keep ambiguous rows pending. Multiple posts, platforms or syndicated renderings can refer to the same underlying source.

Record each approved decision in `research/north-jersey/listing-index/release/decisions.json` with exact `url`, `providerId`, `captureSha256` and a specific `reason`. Preserve existing approvals. The following commands build the additive records, freeze a compact historical wave, validate the combined release and publish the regional snapshot.

```sh
python3 -B scripts/regions/listing-release.py release
python3 -B scripts/regions/listing-release.py archive-wave
python3 -B scripts/regions/release-reviews.py
python3 -B scripts/regions/release-reviews.py --check
python3 -B scripts/regions/normalize-nj.py
python3 -B scripts/regions/build-region.py
python3 -B scripts/regions/build-region.py --check
```

The active addendum consists of `approvals.json`, `source-observations.json` and `source-checks/`. The main review release reads those records alongside the original baseline and computes scores with the application scorer. The addendum reports its approved IDs separately from the base. Other page statuses describe the search and identity outcomes; they do not measure whether an unverified page or location has reviews elsewhere.

Each frozen wave stores the pinned decision ledger, observations, independent checks and compact per-location capture receipts in `release/history/<digest>/`. Receipts preserve the actual address header, care setting, Google aggregate panel, attribution and source checks, with the full capture's original SHA-256 and check time. Reviewer names and narratives are omitted. An archived wave verifies even when the mutable collector cache has been cleared or replaced. If a changed capture invalidates an old decision, preserve its prior wave and adjudicate the new bytes before updating the active decision.

```sh
python3 -B scripts/regions/listing-release.py verify-history --wave research/north-jersey/listing-index/release/history/c0fc5f2160fdf4a6
python3 -B scripts/regions/listing-release-test.py
```

Use `verify` to replay the active wave against the current full-page captures. Coverage may expand as the collector runs. Re-assess new candidates in a scratch directory before replacing the active addendum. Direct public aggregate evidence, eligible for a score and sufficient to meet the published minimum count are separate states.
