# Optional experience acquisition inputs

`release-reviews.py` consumes `integration/approved-batches.json` when it exists and contains approvals. The path is relative to `research/north-jersey/experience-acquisition/`. Collectors do not write this ledger. The coordinator adds explicit reviewed approvals after collection.

## Data shape

The ledger has exactly `schemaVersion` and `batches`. Version is `1`. Each batch has exactly `id`, `assessmentDate`, and `approvals`. Batch IDs are unique lowercase hyphenated identifiers. Dates are ISO calendar dates no later than today. Each approval uses the existing `review-release/approvals.json` shape without changing that file.

An approval has exactly these fields:

- `id`, `providerId`, `officialId`, `url`, `checkedAt`, `access`, `platform`, and `reason`.
- `identity` has `name`, `address`, `city`, `state`, `zip`, and `careUnit`. These are observed values, not roster substitutions. A missing observed ZIP stays `null`. A certified home-health listing can also carry `publishedCcn` when the review page prints its Medicare identifier. Both source readings must agree. An omitted suite is accepted only with an exact CCN, official office ID, street, city, state, ZIP and care unit.
- `aggregate` has `rating`, `scale`, `count`, `asOf`, `scope`, and `sourceFamily`. Preserve the published original mean and count. Do not convert a mean to ten points or sum reviews across pages. `asOf` is the source's published date or `null`, not the collection date.
- `observation` has `path`, `sha256`, and `pointer`. It references one compact receipt using an RFC 6901 JSON pointer. An empty pointer selects a single-receipt file.
- `material` has `path` and `sha256`. It references a separate compact independent source check.

Approval IDs are unique across legacy approvals and every acquisition batch. Receipt and material paths must be repository-relative regular files inside `research/north-jersey/experience-acquisition/`. Their SHA-256 values bind the exact retained bytes.

## Collector receipt and independent check

A compact receipt has exactly `providerId`, `officialId`, `url`, `platform`, `sourceType`, `inspection`, `checkedAt`, `access_decision`, `httpStatus`, `identity`, `aggregate`, `reviewSample`, and `evidence`. Identity and aggregate use the approval field names above.

`reviewSample` has exactly `sourceFamily`, `selection`, `visibleCount`, and `observations`. Selection is `all-visible-before-highlighting`. Every visible row appears once, including negative, mixed and neutral observations. Count equals the observation length. Each observation has exactly `id`, `date`, and `sentiment`. Dates retain their observed year, month or day precision, or remain `null`. IDs are unique within the window. The receipt and independent check must agree on the full window. The transformer binds its source ID and sends it through the existing TypeScript publication guard before and after source exclusion.

`evidence` lists repository-relative `path` and `sha256` references inside experience-acquisition. The manifest binds these bytes too. Production MyLivingChoice records bind the sanitized original full-page check, access assessment and separately authored direct-review decisions. Raw captures remain private and are not needed to replay publication.

The independent check has exactly the same fields. It records the second reading of the actual page, not an automatically copied approval. It has a separate file and hash. Both records must report `httpStatus: 200`, `inspection: "full-page"`, and a permitted `access_decision`. `sourceType` is `review-platform`. `access` on the approval is `full-page`. The independent check's `checkedAt` equals the approval check date. Receipt date is no later than that date. Both dates are bounded by their own batch assessment date.

The source URL, platform, identity, original aggregate, and access decision must agree between the receipt, independent check, and approval. Exact provider and official IDs must be present and agree. Runtime roster and official crosswalk validation still apply. No name-only or inferred match can publish. The `reason` explains the exact-unit and population decision. Store permission evidence and collection limits alongside collector outputs. A permitted label cannot authorize bypassing robots, terms, authentication, or other access restrictions.

MyLivingChoice carries Google reviews and must use `sourceFamily: "google"`. Original sources retain their real family. The unchanged TypeScript scorer deduplicates families and excludes unsupported populations, counts, scales, and dates. A second carrier never creates an independent Google vote.

## Publication boundaries

Only explicitly listed approvals are read. Discovery, blocked pages, rejected matches, and pending candidates stay in collector coverage files. An absent ledger, empty ledger, or batches without approvals have no effect on serialized outputs. Merely collecting files cannot publish them.

Legacy approvals retain their original date validation. New approvals use their own batch dates. Scoring uses the latest active assessment date across legacy and acquisition inputs. Existing excerpt approvals retain their own date and publication guards. Acquisition receipts publish only aggregates and complete privacy-safe review-sample metadata. They do not publish individual narratives, excerpts, descriptions, facts, prices, or availability.

The normalizer already merges the review release with offerings and preserves review samples. It needs no second acquisition reader. New source IDs use the existing `review-release-<approval-id>` convention. Duplicate IDs fail instead of overwriting old entries. All active ledger, receipt, and check bytes appear in the release manifest.

Code changes necessarily update the manifest's transformer SHA-256. The no-op guarantee compares the same transformer with absent versus empty acquisition inputs. It does not conceal a changed transformer behind its previous hash.

## Integration sequence

The coordinator records a second reading in `reviewed-mylivingchoice.json`. Run `python3 -B scripts/regions/approve-experience-acquisition.py` to compare that reading with collection and compile the compact receipts, separate checks and approved batch. Its `--check` mode verifies byte equality without private captures or network requests. `ledger.example.json` is an empty, safe starting point. `contract.schema.json` describes the structural contract. Runtime validation adds hashes, exact identity, date chronology, access, and real scorer checks.

After authorization, the canonical rebuild command is:

```sh
python3 -B scripts/regions/workflow.py rebuild --config research/region-workflows/north-jersey.json --step release-reviews --step normalize --step runtime
```

The selected stages execute in configuration order. Selection does not automatically run dependencies. Existing offering, clinical, geography, and Facebook inputs remain unchanged. `release-reviews.py --check` verifies already-built output and does not write.

The workflow wrapper currently blocks the release transformer's TypeScript scorer subprocess with `offline child process blocked`. Do not disable that guard. Run the same canonical owners directly, in order, then verify each with `--check`:

```sh
python3 -B scripts/regions/release-reviews.py
python3 -B scripts/regions/provider-offerings.py
python3 -B scripts/regions/normalize-nj.py
python3 -B scripts/regions/build-region.py
```

The offerings rebuild refreshes only its release-input hash. Its facts and coverage bytes stay unchanged. The Facebook kit is not regenerated.
