# Private Facebook follow-up assignment

Research only the actionable exact provider IDs below. The blocked records are context, not search assignments.
Do not invent IDs, substitute a brand, infer a service area, or map a name or address to an ID.
Confirm the exact office, campus, or licensed unit before retaining a candidate.
Lantern Hill campus is 535 Mountain Avenue, not the care units at 537.
Keep the Oaks at Denville assisted-living unit at 19 Pocono Road separate from nursing at 21.
Keep BAYADA Morristown registration HP0015347 separate from Cranford CMS agency 317020.
Do not substitute Visiting Angels offices for the assigned Union registrations or CSS Morris office.

## Actionable exact kit assignments

- `nj-campus-lantern-hill` -> `north-jersey-campus-lantern-hill-07974`. Lantern Hill. Continuing-care campus. 535 Mountain Avenue, New Providence, NJ 07974.
- `nj-campus-cedar-crest-village` -> `north-jersey-campus-cedar-crest-village-07444`. Cedar Crest Village. Continuing-care campus. 1 Cedar Crest Village Drive, Pompton Plains, NJ 07444.
- `nj-reg-HP0254700` -> `north-jersey-hp-hp0254700`. A1 PLUS HOME CARE SERVICES LLC. Registered health care services office. 2424 MORRIS AVENUE, SUITE 107, UNION, NJ 07083. Official ID HP0254700.
- `nj-reg-HP0364600` -> `north-jersey-hp-hp0364600`. AAK HEALTHCARE INSTITUTE LLC. Registered health care services office. 1460 Morris Avenue, Union, NJ 07083. Official ID HP0364600.
- `nj-reg-HP0015347` -> `north-jersey-hp-hp0015347`. BAYADA HOME HEALTH CARE, INC. Registered health care services office. 32 MAPLE AVENUE,1ST FL, MORRISTOWN, NJ 07960. Official ID HP0015347.
- `nj-reg-HP0414500` -> `north-jersey-hp-hp0414500`. CSS Morris, LLC. Registered health care services office. 15 Wychwood Rd, Morristown, NJ 07960-2621. Official ID HP0414500.
- `nj-hha-317020` -> `cms-317020`. BAYADA HOME HEALTH CARE, INC. CMS-certified home health office. 11 COMMERCE DRIVE, CRANFORD, NJ 07016. Official ID 317020.

## Blocked records, do not research or import

None under the current kit.

## Reconcile counts in the original batch

Return a correction keyed to each original assignment. Identify exactly linked observations by stable ID and count ambiguous campus leads separately.

| Original assignment | Declared | Linked to exact assignment |
|---|---:|---:|
| nj-doh-NJ60A004 | 17 | 16 |
| nj-doh-NJ60A002 | 3 | 0 |
| nj-doh-NJ90A120 | 3 | 2 |
| nj-doh-NJ20A013 | 8 | 7 |
| nj-doh-NJ62016 | 13 | 9 |
| nj-doh-NJ22001L | 3 | 2 |

## Verify existing leads

Open the live pages for VNA of Northern New Jersey (reported 4.0/5 from 10) and Atria Cranford (reported 4.9/5 from 18). Record the location, permalink, check date, scale and count only if visible.
Recheck the original Lantern Hill outage thread and Arbor Terrace nested reply if publicly accessible. Keep inaccessible and ambiguous claims as leads.

## Required private output contract

Use the trusted kit.csv identity rows and the unchanged kit observations.csv and coverage.csv headers.
Return assignments.csv with exact assignment_id and provider_id pairs from the actionable list.
Return one coverage.csv row per actionable provider_id, including zero findings and access limits.
Use one run_id, UTC search dates, JSON arrays for queries_used and sources_checked, and explicit observation counts.
Every assigned observation must link to that provider's coverage row. Leave ambiguous unit matches unassigned.
Use stable observation IDs. Mark every observation internal_review_pending with needs_human_review=true.
Inspect only permitted public underlying sources. Search snippets are leads, not evidence.
Do not enter private groups, bypass access controls, contact anyone, or retain personal or medical identifiers.
Keep tours, promotions, staff accounts, and provider-selected testimonials distinct from post-care family accounts.
Record uncertainty and duplicate candidates. Do not infer independence from separate posts.
Retain source links, neutral paraphrases, and any necessary evidence only in authorized private storage.
Do not print raw content, social URLs, excerpts, or reviewer names in terminal output or the handoff.
Return a separate redacted handoff with counts, exact IDs, coverage outcomes, and unresolved identity reasons.
Keep rating candidates separate for eligibility review. Do not derive ratings, score providers, or publish anything.
Do not update application data, create a PR, commit, or change branches.
