# Four New Jersey nursing reviews

## Outcome

The immutable `mylivingchoice-four-nj-nursing` batch has two approvals and two holds. Families receive original Google means and concise population notes for the two approved nursing homes. The next maintainer receives the direct receipts, independent editorial decisions, primary identity witnesses and reproducible approval inputs.

| Facility | Sole potential state recipient | Separate CMS record | Original Google mean and count | Decision |
| --- | --- | --- | --- | --- |
| Elizabeth Nursing and Rehabilitation Center | `north-jersey-doh-nj62007x`, `NJ62007X` | `cms-315106` | 4.8/5, 358 | Hold professional-population overlap. |
| Inglemoor Rehabilitation & Care Center, Livingston | `north-jersey-doh-nj60708`, `NJ60708` | `cms-315322` | 4.2/5, 65 | Approve once on the state nursing record. |
| New Jersey Veterans Memorial Home At Paramus | `north-jersey-doh-nj60228`, `NJ60228` | `cms-315346` | 3.8/5, 38 | Approve once on the state nursing record, with selected concerns. |
| Livingston Post Acute Care | `north-jersey-doh-njnh07001`, `NJNH07001` | `cms-315526` | 4.3/5, 526 | Hold historical-license succession and unit attribution. |

The canonical release scorer returns 8.4 for Inglemoor and 7.6 for Paramus, both with limited confidence and one Google source family. These are release-artifact results, not a claim that the coordinator has rebuilt the application runtime. The release contains 109 approved providers. The immutable acquisition ledger contains 39 approvals.

## Evidence decisions

All four five-account windows remain complete. The archive preserves each original review link, identifier and calendar-month label. Paramus retains its February 2023 account, although the unchanged scorer counts only four recent eligible accounts. The source publication dates remain unknown.

All five Inglemoor accounts are positive, from three family members and two residents. The collector's mixed label for the first-person April rehabilitation account is not an editorial finding. Its original heuristic label remains in the unchanged direct receipt.

Paramus has three positive accounts, one negative account and one mixed account. One positive account describes a visitor's meal and wayfinding, not resident care. Another is the February 2023 family account. The critical family writer's reference to becoming a volunteer does not establish employment. Nursing wings and residential buildings remain parts of the same licensed nursing home.

Elizabeth's five mirror accounts are positive, with four family roles and one unknown role. Two may concern the same care episode. Separately inspected primary Google evidence describes a professional pharmacy interaction at the same selected place. Its inclusion in the older 358-rating population is unknown. The professional account is not appended to the five-account window, subtracted from the mean or asserted to belong to that older denominator. The population hold remains.

Livingston retains two positive, two negative and one mixed account. The mixed account has substantial daytime-care praise and night-care criticism. Its report of employee recognition through positive reviews remains a solicitation concern, not proof that the writer is employed or paid. Current primary evidence matches the nursing operator and CCN. It does not prove succession from former license `07NH000` to `NH07001`. A blank former-license page is not closure evidence. The separate neighboring assisted-living residence `NJ07A022` receives no rating.

State, CMS and operator evidence supports the same-site nursing identities without merging saved provider IDs. No consumer aggregate transfers to the separate CMS records. Inglemoor's Englewood namesake is excluded. Inglemoor's operator marketing says 130 beds while state and CMS say 138. Livingston's retained state roster says 134 beds while current DOH and CMS say 124. The witnesses retain these differences, alternate operator phones and the Paramus department-name change.

The five direct receipt files match `/tmp/harbor-four-nj-direct` byte for byte. The archived editorial matches `/tmp/harbor-four-nj-nursing.json` byte for byte. Its source log directory and audit links remain intact. No new reviewer names, medical narratives or excerpts were added.

## Throughput checkpoint

- Blocking first steps. Trace the immutable compiler and release guards. Reconcile all four direct windows, independent editorial findings and primary identity evidence before approval.
- Independent workstreams. No nested agents, as requested. Research and implementation stayed with this owner.
- Shared mutable state. Only this new batch, the batch index, compiled acquisition outputs, the approval ledger, review-release artifacts and focused tests were written. Downstream integration remains with the coordinator.
- Smallest safe decomposition. One batch keeps the four decisions and their original evidence together. Five new regression tests and an expanded clean canonical replay verify the release.

Separate Before Serializing Shared State determined the batch-local archive and the downstream write boundary. Prove It Works required the real compiler, canonical release, TypeScript scorer and clean public-input replay. Test Behavior, Not Implementation determined the assertions for means, complete windows, holds, sole recipients and family-readable notes.

## Compiler exception

The existing compiler replaces every reviewed nursing proposal reason with a long internal review explanation. The six-line change accepts an optional hash-bound `publicPopulationNotes` entry for each approved slug. Empty notes fail. Existing batches keep their prior output bytes. The new notes contain no row IDs or internal publication thresholds. Detailed source-access, identity and population evidence stays in the batch and compiled evidence references.

No scoring policy, release eligibility guard or care-unit equivalence changed.

## Verification

| Check | Result | Origin |
| --- | --- | --- |
| Immutable approval suite | 30 passed | Existing 25 tests, five new tests and expanded replay assertions. |
| Canonical release suite | 73 passed | Existing. |
| Excerpt suite | 41 passed | Existing. |
| TypeScript experience score, methodology, acquisition and public-confidentiality suites | 39 passed | Existing. |
| Approval compiler `--check` | Passed, 39 approvals | Existing canonical command. |
| Review release `--check` | Passed, 109 approved providers | Existing canonical command. |
| Minimal public-input approval and release replay | Passed byte for byte | Existing replay extended for this batch. |
| Prior compiled approvals and aliases | Unchanged except two new aliases and two new approvals | New additive regression. |
| Original direct receipts and editorial | Byte-identical to supplied temporary inputs | Direct comparison. |
| Acquisition inventory suite | 15 passed, one pre-existing failure | Existing frozen-population comparison. |

The inventory failure occurred before this batch changed approval or release inputs. `test_artifacts_cover_real_frozen_population_and_preserve_every_score` compares a 974-provider baseline with a current 1,375-provider snapshot. Inventory artifacts were not changed to make that unrelated assertion pass.

Two new mutation checks initially stopped at stale duplicate evidence hashes rather than their intended errors. Their temporary-fixture mutation now refreshes both references to the reviewed document. Both reject the intended invalid state. Production evidence hashes and publication guards were not relaxed.

The new regressions cover every source window, the two decisions of each kind, complete primary identity witnesses, tampering with held material, concise public notes, empty-note rejection, prior-batch preservation, canonical score values and absence of duplicate or neighboring recipients.

The full application build, lint, knip and browser suite were not run for this bounded data release. No regional rebuild was run. No KB writes, nested agents, commits, staging or pushes were performed.

## Changed and new files

Paths in this section are relative to the repository root. These are the 33 files with new or changed content from this task.

The new batch directory is `research/north-jersey/experience-acquisition/wave-two/batches/four-nj-nursing/`. Its exact files are:

```text
WORK.md
access.json
aliases.json
batch.json
nursing-editorial.json
proposals.json
reviewed.json
collection/access-evidence.json
collection/elizabeth-nursing-and-rehab-center.json
collection/inglemoor-rehabilitation-and-care-center.json
collection/livingston-post-acute-care.json
collection/new-jersey-veterans-memorial-home-at-paramus.json
identity-checks/elizabeth-nursing-and-rehab-center.json
identity-checks/inglemoor-rehabilitation-and-care-center.json
identity-checks/livingston-post-acute-care.json
identity-checks/new-jersey-veterans-memorial-home-at-paramus.json
source-checks/elizabeth-nursing-and-rehab-center.json
source-checks/inglemoor-rehabilitation-and-care-center.json
source-checks/livingston-post-acute-care.json
source-checks/new-jersey-veterans-memorial-home-at-paramus.json
```

The new compiled directory is `research/north-jersey/experience-acquisition/wave-two/compiled/mylivingchoice-four-nj-nursing/`. Its exact files are:

```text
collector-receipts.json
independent-checks/inglemoor-rehabilitation-and-care-center.json
independent-checks/new-jersey-veterans-memorial-home-at-paramus.json
```

The other changed files are:

```text
research/north-jersey/experience-acquisition/wave-two/batches.json
research/north-jersey/experience-acquisition/integration/approved-batches.json
research/north-jersey/review-release/identity-corroboration.json
research/north-jersey/review-release/approvals-audit.json
research/north-jersey/review-release/experience-verification.json
research/north-jersey/review-release/locationResearch.json
research/north-jersey/review-release/manifest.json
research/north-jersey/review-release/observation-registry.json
scripts/regions/approve-experience-acquisition.py
scripts/regions/approve-experience-acquisition-test.py
```

The canonical compiler also rewrote its previous generated files without byte changes. The release command rewrote `exclusions.json`, `staging.json` and `excerpt-audit.json` without byte changes. Earlier immutable batches remain unchanged. Concurrent changes outside the listed paths belong to other work.

## Coordinator commands

Run these downstream commands from the repository root after the parallel integration inputs are ready:

```sh
python3 -B scripts/regions/provider-offerings.py
python3 -B scripts/regions/normalize-nj.py
python3 -B scripts/regions/build-region.py
```

The offerings command refreshes its release-input metadata after this review release. It was not run by this task. Run any additional CMS, home-care, editorial, staffing or release-fingerprint steps in their owning integration workflow.

The approval and release artifacts are already compiled. Their checks are:

```sh
python3 -B scripts/regions/approve-experience-acquisition.py --check
python3 -B scripts/regions/release-reviews.py --check
python3 -B scripts/regions/approve-experience-acquisition-test.py
python3 -B scripts/regions/release-reviews-test.py
```

Elizabeth needs a dated, separable eligible aggregate or primary evidence that resolves the professional-feedback overlap. Livingston needs a primary historical-to-current license bridge and resolution of the solicitation and historical-operator interpretation. Neither hold can be cleared by omitting an account or recalculating a mean.
