# Assignment list — follow-up pass 2026-11-12

Run: `fb-pilot-2026-11-12`. Each item is an explicit follow-up assignment
arising from this pass: a provider, a human step, or a method gap that this
batch does not resolve. Nothing here was silently assigned in the amended
batch. Items are ordered by how directly they unblock the next review
decision.

## A1 — ma-alr-edelweiss-village (Edelweiss Village, assisted-living, 2220 Centre St, Boston-West Roxbury)

- **Candidate observation:** fb-bos-006 (Sen. Mike Rush visit, 2026-02-18).
- **Why:** re-read confirms the visit was to the Edelweiss Village
  assisted-living unit. Name, care level and town all match this catalog
  record, which was not in the 20-provider batch.
- **Action:** include this record in a future batch, or confirm the
  assignment out of band. Do not silently reassign the row in this run:
  writing this provider_id would put an exact match outside the 20-ID
  assignment, which the importer rejects.
- **Status:** open.

## A2 — Human thread re-read for fb-ssh-001 (Care One at Weymouth)

- **Candidate observation:** fb-ssh-001 (probable, Care One).
- **Why:** 71 of 73 top-level comments were retrieved via the CLI and none
  names a location. Nested replies are not exposed by the CLI, and the one
  reply that might confirm Weymouth (the answer to "what hospital in?") is
  unretrieved. A web-search summary reports the author's own reply as
  naming Care One in Weymouth, but that is a secondary summary, not
  retrievable source text.
- **Action:** a human opens the thread directly (source URL in the row) and
  reads the nested reply. If it names Care One in Weymouth, fb-ssh-001 may
  upgrade to exact; if it names another location or is inconclusive, the
  row stays probable.
- **Status:** open.

## A3 — south-shore-vna address discrepancy

- **Provider:** south-shore-vna (South Shore Visiting Nurse Association).
- **Why:** the catalog lists 30 Reservoir Park Drive, Rockland; one
  directory listing gives 100 Bay State Drive, Rockland. Already noted in
  the collector's notes.
- **Action:** catalog correction, not a count issue. Verify the current
  address against a primary source.
- **Status:** open.

## A4 — cms-225774 (NewBridge on the Charles Skilled Nursing Facility, 7000 Great Meadow Road, Dedham)

- **Candidate observations, verified from the comment itself (6):**
  fb-ssh-016 (firsthand short-term rehab, links the Hebrew Rehabilitation
  Center rating page), fb-ssh-017 (explicit "skilled nursing section is
  excellent"), fb-ssh-021 (firsthand two-stay rehab account, compared with
  Hebrew Rehab), fb-ssh-027 (firsthand detailed negative rehab-stay
  account), fb-ssh-030 (classifies NewBridge as a rehabilitation facility),
  fb-ssh-031 (explicit rehab-admission framing, "just for rehab").
- **Second-tier candidates, probable on thread context only (14):**
  fb-ssh-018, fb-ssh-019, fb-ssh-020, fb-ssh-022, fb-ssh-023, fb-ssh-024,
  fb-ssh-025, fb-ssh-026, fb-ssh-028, fb-ssh-029, fb-ssh-032, fb-ssh-033,
  fb-ssh-034, fb-ssh-035. The intended service is indicated by the rehab
  or skilled-nursing thread, but the commenter did not describe it; re-
  examine in the follow-up assignment rather than auto-attach.
- **Action:** add cms-225774 to a follow-up assignment so these accounts can
  be attached to their entity there. The six verified rows are the priority;
  the fourteen probable rows are second-tier. Note the weaker verification
  on fb-ssh-021 and fb-ssh-027: the word "rehab" does not appear in either
  comment; the framing comes from the thread request and the Hebrew Rehab
  comparison.
- **Status:** open.

## A5 — ma-alr-newbridge-on-the-charles (assisted living, 6000 Great Meadow Road, Dedham)

- **Candidate observations:** none verified. However, fb-ssh-004 through
  fb-ssh-008 (exact campus rows) sit in an assisted-living recommendations
  thread, so the ALR is the likely unit for those five even though no
  comment states a care level.
- **Action:** if a follow-up assignment covers the ALR, re-examine
  fb-ssh-004 through fb-ssh-008 there. No change was made to them in this
  batch.
- **Status:** open.

## A6 — Comment-level permalinks for fb-nsh-004 and fb-nsh-005

- **Candidate observations:** fb-nsh-004, fb-nsh-005 (Aberjona
  retirement-celebration post, 2026-09-12).
- **Why:** direct re-read verified two distinct comments with distinct
  IDs. Comment-level permalinks are obtainable from the re-read (thread URL
  plus `?comment_id=1852042076229294` for fb-nsh-004 and
  `?comment_id=1063858716376990` for fb-nsh-005).
- **Action:** a reviewer may add the comment IDs to the rows' source URLs
  in a future amendment. Not applied in this pass: changing source URLs
  changes the importer's source keys and grouping, and the correction was
  outside the assigned scope.
- **Status:** open.

## A7 — Unverified Wareham negative-comment lead

- **Provider:** ma-alr-all-american-assisted-living-at-wareham.
- **Why:** a search summary described a detailed negative comment in the
  Wareham opinions thread (billing, medication/supply responsibility,
  falls, barred return) that was not among the 8 comments retrievable via
  the CLI. It was not recorded as an observation.
- **Action:** a human opens the thread directly and checks whether the
  comment exists and is attributable. Noted in the South Shore coverage and
  notes with the thread URL for direct review.
- **Status:** open (carried from the original run).

## A8 — Enumerate Facebook Recommendations for Page-heavy providers

- **Providers:** Lasell Village (lifeplan-lasell-village) and Waterstone at
  Wellesley (ma-alr-waterstone-at-wellesley) first; any provider with an
  active official Page second.
- **Why:** the Facebook CLI cannot list an unmanaged Page's timeline or its
  Recommendations/Reviews tab. Both providers have active official Pages,
  and Waterstone's own "review us" page confirms Facebook Recommendations
  exist for the community. This is the largest coverage gap in the batch.
- **Action:** enumerate Page Recommendations through a route the CLI cannot
  do (for example a browser session on the Page), under the same protocol
  rules. Record the method and its limits in the next run's coverage.
- **Status:** open (method gap, carried from the original run).
