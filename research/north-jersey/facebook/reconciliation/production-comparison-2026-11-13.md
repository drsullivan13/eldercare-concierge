# North Jersey Facebook production comparison

## Scope and source baseline

The goal is exact-location firsthand evidence in the existing family-facing Profiles and Reviews, with privacy and source provenance intact.

The remote branch was fetched on November 13, 2026. Its latest inspected release is `1a52d72a7c415ed5318527543fccf2c371decd66`. The accepted release already includes that correction, the base batch at `0041ba3fa1c111f630865834d765206c3280e002`, and the follow-up at `ac85b0b0654ad709ea4c429feeae264b35d21fde`.

The accepted release and all verified sources remain unchanged. This work does not publish a new source row or regenerate regional snapshots.

## Complete row reconciliation

An independent CSV read from the latest inspected remote branch matched all 84 unique observation IDs to the retained release audit. The base contributes 65 rows. The follow-up contributes 19.

| Disposition | Rows |
| --- | ---: |
| Published | 8 |
| Excluded | 55 |
| Withheld | 2 |
| Quarantined | 7 |
| Unassigned | 12 |
| Total | 84 |

The eight published observations are exact-matched firsthand family accounts. They form two original-thread findings at two locations. Every observation remains ineligible for numeric scoring.

The four aggregate candidates concern two locations. None has independently established eligibility for publication as a platform aggregate. They remain excluded.

The 20 trusted coverage keys contain two locations with findings, eight with withheld material, two with partial coverage, and eight with no relevant result in the retained search. An absent location remains unsearched. It does not become a searched zero.

The public coverage field `withheldCount` counts all unpublished exact-location candidate rows, including excluded material. Its total is 57. It is not the two-row audit disposition named `withheld`, nor a count of usable family experiences.

## Production comparison

All 20 location-specific responses from the [production research API](https://eldercare-concierge-one.vercel.app/api/research?id=north-jersey-campus-cedar-crest-village-07444) returned HTTP 200 during the November 13 check. Each `facebookResearch` location matched the accepted `reviewed-coverage.json` fields. None exposed a Facebook platform aggregate.

| Location | Existing published observations | Existing findings | New findings |
| --- | ---: | ---: | ---: |
| Cedar Crest Village campus | 7 | 1 | 0 |
| Victoria Mews Assisted Living | 1 | 1 | 0 |

The live Cedar Crest profile showed its retained short quotation. The fuller deidentified research summary was inside the closed "Context and limits" disclosure. The UI change puts the summary beside the quotation and adds a separate source-provenance disclosure. The same component improves Victoria Mews.

The North Jersey result is **zero new findings and two better-surfaced findings**, supported by eight already-published observations. Improvements to other markets through the shared component are not counted as new North Jersey evidence.

## Direct-source checks and limits

The [Victoria Mews community thread](https://www.facebook.com/groups/765406577175744/permalink/2904082416641472/) and the [Cedar Crest community thread](https://facebook.com/groups/226332979096/permalink/10161753433779097/) rendered in a browser without authentication after the sign-in overlay was dismissed. Their retained short excerpts and post dates were present. The named location appeared in each discussion.

The HTTP fetch tool returned 403 for both sources. Browser access is a separate observation, not proof that automated fetches work. These checks do not authenticate authors, establish independent households, revalidate every source row, or establish current care conditions.

No names, personal-profile links, new raw narratives, or medical details were added to application inputs. Atria's personal-profile accounts remain withheld. Lantern Hill's index-only accounts remain excluded. Promotion and employment material do not become family experience.

## Application contract

The data shape remains the existing exact-provider finding and coverage record. Observation IDs, original thread URLs, post dates, review dates, grouped sources, and limitations remain attached to each finding. A post date is not an inferred care date.

No downstream regional projection is needed because the accepted findings and release hashes did not change. This work does not edit scores, review lists, regional snapshots, or overviews. No commit, push, or deployment is part of this task.

## Verification and integration blockers

Existing source validators pass. The kit has 36 passing tests, the base-batch reconciliation has 23, and the release has 12. `facebook-release.py --check` reproduces the retained release. The existing regional consumer integration suite has three passing tests.

The Facebook unit file has seven passing tests. This change adds its all-assignment API regression, including exact observation provenance and distinct unsearched coverage. The browser suite adds real North Jersey profile checks for the visible summary, original source, post date, source observation IDs, keyboard disclosures, accessibility, and horizontal overflow. It also adds explicit North Jersey held, partial, no-result, and unsearched cases.

Workspace ESLint, Knip, and scoped `git diff --check` pass. `normalize-nj.py --check` also passes without rewriting a regional artifact. Independent SHA-256 checks confirm that all six trusted release inputs and both release outputs remain unchanged.

The first browser attempt could not launch because Playwright's bundled browser was absent. The existing `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override selects installed Google Chrome without changing project configuration. The initial eight desktop and mobile browser cases pass with that override.

The expanded ten-case run initially had eight passes and two desktop timeouts. Both captured error overlays showed an unrelated missing `src/data/location-descriptions.json` during shared regeneration. No Facebook assertion failed in those cases. After that artifact became available, a fresh full run passed all ten cases on desktop and mobile. No test was skipped or retried automatically.

The final combined reader and integration rerun passed all ten tests. A later combined lint and type-check command timed out after those tests completed. Earlier standalone workspace lint and scoped lint runs passed. The earlier type-check diagnostics below remain recorded rather than being represented as a successful final type check.

The complete workspace unit run has 317 passes and five failures in concurrently changed areas. One family-experience test still expects removed tie-ordering copy. Four location-description tests fail their inventory, replay, or lookup expectations. No failing test is in `tests/facebook-research.test.ts`.

The workspace type check reports six errors outside the owned Facebook files. Four concern `DescriptionState` in `src/components/property-overview.tsx`. Two concern the `sourceFamily` aggregate contract in `tests/e2e/readreviews-ui.spec.ts`. Those files remain with their existing owners. A production build is not claimed while these integration errors remain.
