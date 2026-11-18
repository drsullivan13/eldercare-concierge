# Public office planning evidence

`publicOfficeEvidence(provider, research?, asOfDate?)` projects four planning facts for released North Jersey home-care registration offices. The existing provider-detail availability panel consumes it. It does not fetch, contact an agency, confirm capacity, change search coverage or affect experience scores.

The projection reuses the reviewed per-office inquiry-route input and the catalog's conservatively derived service ZIPs. A catalog service ZIP requires its existing retained first-party `serviceArea` source; neither office ZIP nor a county name alone creates coverage. Inquiry input `excluded` candidates remain excluded. A published form means an inquiry route exists, not that it accepts a family or books care. The static consultation booking configuration has no source check date and is not promoted to a dated public capacity claim.

Every usable source keeps its actual `checkedAt` and public URL. Evaluation never updates that date. `expiresAt` is a policy recheck deadline, not a source promise:

| Field                  | Recheck interval |
| ---------------------- | ---------------- |
| Public inquiry route   | 30 days          |
| Minimum hours          | 30 days          |
| Earliest care start    | 1 day            |
| Published service ZIPs | 90 days          |

A fact is stale at the start of its expiry date in UTC. Invalid or future check dates, insecure/non-public URL schemes and unsupported sources stay unknown. Stale values are withheld while their provenance remains visible for rechecking. Intake destinations are evaluated independently: only fresh destinations and their own source dates appear as known. An old or future sibling cannot borrow a fresh route’s date. Stale sibling routes remain in the coordinator queue even when the office has another usable route; `staleIntakeRoutes` counts those observations separately from office field states. Contradictory explicit statements are withheld even when one observation is older; a new check date alone does not reconcile them. Different wording is conservatively held for human review.

There are no reviewed minimum-hour or earliest-start facts in the current release. An editor may annotate an existing `OfferingFact` with `publicOfficeFact: { field: "minimum-hours" | "earliest-start", officeAddress, officeZip }`. This requires the exact research provider ID, exact current office address and ZIP, a full public provider page or PDF, and an excerpt containing the complete fact text. The existing `sourceId` and source check date remain the provenance; no second source model or fabricated verification date is added to the research snapshot. The annotation is a reviewed claim, not a text-extraction heuristic. Appointment slots and consultation booking receipts are never earliest care starts.

Private workspace notes, agency responses about one family and account consultation state are outside this interface. They cannot refresh public facts or feed the public coordinator report. Public research publication remains an editorial process; account evidence must not be copied into its inputs.

Run the read-only coordinator report with a fixed clock:

```sh
node --import tsx scripts/office-evidence-review.ts --as-of=2026-11-18 --limit=25
```

The report counts every eligible released office and each known/unknown/stale/conflicting field. Review output is capped at 100 items, prioritizes conflicts then stale observations, and reports the number of remaining items. It identifies the exact provider, field, public source and recheck action; it authorizes no outreach. Unknown items request explicit public evidence and otherwise remain unknown. Re-run after reviewing source inputs through the normal offline publication workflow.

At 2026-11-18, the released catalog has 824 eligible offices: 9 with known public inquiry routes, 9 with known service ZIP evidence, and no known minimum hours or earliest care start. All other fields are unknown, with no stale or contradictory released claims. The inquiry input has ten office records; one intentionally has no usable route. At 2027-03-01 those same 9 route and 9 ZIP observations are stale; their source check dates are unchanged. These are evidence coverage counts, not outreach results or agency availability measurements.

Focused checks:

```sh
node --import tsx --test tests/public-office-evidence.test.ts
npx tsc --noEmit
```
