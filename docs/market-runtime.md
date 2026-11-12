# Regional runtime artifacts

## Publication status

`src/data/regional-markets.json` is a JSON array of additional market snapshots.
Its value is `[]` until a reviewed manifest exists. Massachusetts continues to use its existing files.
The regional builder does not rewrite those files or run their preparation scripts.

North Jersey geography has generated ZIP artifacts under
`research/north-jersey/geography/`. State, CMS, Facebook, and consumer-review
collection work is separate. Raw downloads, collection manifests, assignment
lists, and access checks are not reviewed runtime provider catalogs.
The reviewed `research/north-jersey/runtime-manifest.json` now publishes the
normalized provider catalog. The build summary reports its current provider and
ZIP counts. The manifest also retains nursing-home inspection history and
home-health evidence. Location and Facebook evidence are absent from this
manifest. Those optional datasets remain pending, not implicitly negative.
The catalog contains source-linked discovery records, not claims of current
availability or service coverage.

## Build command

The offline CLI requires Python 3.9 or newer and has no third-party dependencies.
Commands run from the checkout root.

```sh
python3 scripts/regions/build-region.py
python3 scripts/regions/build-region.py --check
python3 scripts/regions/build-region.py \
	--manifest research/north-jersey/runtime-manifest.json \
	--output src/data/regional-markets.json
```

With no explicit manifest, the builder uses
`research/north-jersey/runtime-manifest.json`. If that file is absent, the builder
emits `[]` and reports `pending-reviewed-manifest`. It refuses to erase a
nonempty published output in that state. An explicitly supplied missing manifest
is always an error.

`--check` compares the complete deterministic output bytes without writing.
Validation or I/O errors exit with status 1. A successful build prints the market,
provider, and ZIP counts. The builder only permits
`src/data/regional-markets.json` as an output inside the checkout. External output
paths support isolated validation and tests. Output cannot overwrite the manifest
or any referenced input.

## Normalized manifest

The input is an editorially reviewed manifest, not a CMS or state collection
manifest. Schema version 1 has these fields.

```text
{
	schemaVersion: 1,
	markets: [{
		id: "north-jersey",
		label: "North Jersey",
		state: "NJ",
		defaultZip: string,
		review: {
			status: "reviewed",
			reviewedAt: "YYYY-MM-DD",
			reviewer: string
		},
		artifacts: {
			zips: {path, sha256, count},
			meta: {path, sha256, count},
			providers: {path, sha256, count},
			locationResearch?: {path, sha256, count},
			facebookResearch?: {path, sha256, count},
			inspectionHistory?: {path, sha256, count},
			homeHealthEvidence?: {path, sha256, count}
		}
	}]
}
```

This is a shape description, not a publishable sample. `defaultZip`, input paths,
hashes, dates, reviewer attribution, and evidence must come from the actual
reviewed artifacts. `markets: []` is an explicit empty publication.
The only supported additional market identity is exactly `north-jersey` with
state `NJ`. Other pairs fail before publication. Massachusetts remains in its
existing snapshots, not this manifest.

Each artifact is a separate UTF-8 JSON file. `path` is relative to the manifest
directory. Absolute paths and paths or symlinks that escape that directory fail.
`sha256` is the lowercase SHA-256 of the exact file bytes. A hash binds the
reviewed version, but does not prove that its contents are true.

The reference counts have the following meanings.

| Artifact             | JSON value                                                   | Reference count      |
| -------------------- | ------------------------------------------------------------ | -------------------- |
| `zips`               | `Record<zip, {city, lat, lng}>`                              | ZIP entries          |
| `meta`               | `{asOf, catalogTotal, categories, ...}`                      | `catalogTotal`       |
| `providers`          | `Provider[]`                                                 | Providers            |
| `locationResearch`   | `Record<providerId, LocationResearch>`                       | Provider entries     |
| `facebookResearch`   | `FacebookResearchDataset`                                    | `locations` entries  |
| `inspectionHistory`  | Existing inspection snapshot                                 | `facilities` entries |
| `homeHealthEvidence` | Existing home-health snapshot with market-scoped comparators | Agencies             |

`meta.asOf` is the catalog's ISO calendar date, not necessarily its retrieval
date. The UI labels it "catalog as of". `meta.catalogTotal` is the exact provider
count. `meta.categories` contains counts by primary care category, not by
`searchCategories`. Zero-count known categories are permitted. Other metadata
passes through without a new wrapper.

The output contains only the runtime fields below. The manifest's review and
artifact references do not appear in the runtime snapshot. Retaining the reviewed
manifest alongside its inputs preserves that publication provenance.

```text
MarketSnapshot[] = [{
	id, label, state, defaultZip,
	zips, meta, providers,
	locationResearch?,
	facebookResearch?,
	inspectionHistory?,
	homeHealthEvidence?
}]
```

The builder copies evidence, validates it, sorts markets and providers by ID,
sorts home-health agencies by CCN, sorts object keys, and writes one trailing
newline. It preserves the order of source, fact, review, finding, and inspection
record arrays. It performs no matching by name, city, brand, or ZIP.
It does not calculate scores or generate `Provider.research` summaries.
Normalized providers must omit those derived summaries.

## Identity, geography, and provenance checks

Provider fields follow `Provider` in `src/lib/providers.ts`. Location and Facebook
evidence follow `src/lib/location-research-types.ts` and
`src/lib/facebook-research.ts`. Inspection and home-health evidence retain their
existing nested snapshot fields. Unknown provider or evidence fields fail instead
of disappearing silently. Metadata permits additional fields.

- CMS provider IDs are exactly `cms-CCN`, with a six-digit CCN. They are never
  prefixed with a region. `provider.cms` contains nursing-home ratings and is
  valid only for nursing-home records. A home-health provider uses its stable
  `cms-CCN` ID without a `cms` ratings object. Agency evidence remains separate.
- Non-CMS IDs start with the market ID and a hyphen, such as
  `north-jersey-<stable-local-identifier>`. The builder never invents or rewrites IDs.
- Duplicate IDs, CCNs, market IDs, and JSON object keys fail. Additional market
  provider IDs and CCNs cannot collide with the Massachusetts catalog or another
  additional market.
- Every default ZIP, provider address ZIP, and home-health reporting-address ZIP
  belongs to that market's reviewed ZIP lookup. ZIP prefixes must agree with the
  market state in `src/data/us-zip-prefix-states.json`. Markets cannot share ZIPs,
  including with Massachusetts. The manifest cannot publish a replacement MA
  market.
- Coordinates are finite and within latitude and longitude limits. A provider's
  coordinates are either both present or both null. The builder does not geocode
  or substitute a ZIP centroid for a missing facility coordinate.
- Every provider has source provenance. Calendar source dates are valid ISO dates,
  cannot be in the future, and cannot be later than `meta.asOf`. Review cannot
  predate `meta.asOf`. Missing nullable evidence dates stay null.
- Location evidence keys equal their `providerId` and refer to a provider in that
  same market. Facts, reviews, review aggregates, and restrictions refer only to
  that location's source IDs.
- Facebook locations refer only to that market's providers. Published counts equal
  distinct published observation IDs. Found counts cover published and withheld
  observations. Findings remain qualitative and separate from scores.
- Inspection keys refer to exact nursing-home CCNs in the same market. Collections
  retain their totals and at most 25 records. Retained record counts equal the
  smaller of the total and the declared cap. Penalty subtotals reconcile.
- Home-health `organizationId` refers to an exact home-health provider in the same
  market. Its `organizationId` must equal `cms-<ccn>` exactly. No organization-wide or
  brand-wide clinical average is inferred.

These checks verify structure and publication consistency. They cannot establish
source accuracy, licensing scope, source-to-care-unit identity, or editorial
approval independently of the reviewer.

## Home-health comparators

The Massachusetts snapshot uses a literal `massachusetts` key under
`patientExperienceComparators`. That name cannot mean New Jersey.
The current regional consumer accepts `national` plus an optional
`state` comparator with `code` and `label`, or a comparator keyed by the market ID.
The builder matches that contract. For NJ, `state.code` must be `NJ`, or the
market-keyed comparator must use `north-jersey`. Both forms together fail as
ambiguous. Missing state data may remain absent while national data is retained.

The builder rejects a transplanted `massachusetts` comparator rather than
relabeling it. The reviewer must supply actual NJ data. No MA evidence is copied
into the generated regional output. There is no runtime contract deviation.

## Agency location and service coverage

An office address or office-to-search distance does not prove that an agency
serves the family's ZIP. `locationKind`, address, and coordinates describe the
recorded location. `serviceArea` must retain only documented coverage and its
supporting provider sources. Missing coverage stays missing.

The reviewed ZIP lookup defines the search market, not a service-area claim.
This version requires provider office addresses inside the market. An agency
outside the market that documents coverage inside it needs a separately agreed
coverage-based inclusion contract. The builder does not move its office into the
market or use a served ZIP as its address.

## Upstream handoff and verification

The existing geography output `geography/nj-zips.json` already has the required ZIP
lookup shape and can be referenced directly from the reviewed manifest. Its
collection manifest is not the runtime manifest.

The reviewed provider bundle now supplies normalized `Provider[]`, catalog
metadata with reconciled counts, review attribution, and SHA-256 references.
Optional evidence still needs exact provider or CCN joins. Source-specific raw
schemas remain the collecting teams' responsibility. Raw-schema ingestion would
duplicate their parsers and identity decisions, so this builder accepts only the
normalized boundary.

The new CLI tests use temporary fixtures and clean them up. They cover successful
publication, retained evidence shapes, deterministic bytes, validation failures,
input tampering, and preservation of existing output and Massachusetts files.

```sh
node_modules/.bin/tsx --test tests/region-build.test.ts
```

After every input has passed validation, the builder flushes a temporary file in
the output directory and atomically replaces the output. Validation failure never
opens the existing output for writing. Failed replacement removes the temporary
file. Atomic replacement prevents partial JSON, but does not coordinate competing
publishers. One publisher owns this output at a time.
