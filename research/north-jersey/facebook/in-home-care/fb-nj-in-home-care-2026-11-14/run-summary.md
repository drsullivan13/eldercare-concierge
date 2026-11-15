# Run summary — fb-nj-in-home-care-2026-11-14

North Jersey in-home care research for Harbor: public recommendations and
firsthand family experiences about paid, nonmedical help in an older adult's
home (companionship, personal care, respite, help with daily activities).
Branch-level evidence a family could use when deciding which agencies to
interview. No contact with agencies or people. All rows
`internal_review_pending`; nothing imported, published, or scored.

- **Run:** `fb-nj-in-home-care-2026-11-14`
- **Collection date:** 2026-11-14 (all times UTC in the CSVs)
- **Assignment source:** Dan Sullivan's message 2026-11-14 19:20 ET (16
  seeds) + updated repo assignment
  `research/north-jersey/facebook/home-care-assignment.md`, main commit
  `7ba7adc` (4 more seeds: Somerset x2, Middlesex x2). A copy of the repo
  assignment is in this batch as `supplied-home-care-assignment.md`.
- **Branch:** `research/north-jersey-in-home-care-2026-11-14`
- **Path:** `research/north-jersey/facebook/in-home-care/fb-nj-in-home-care-2026-11-14/`
- **Protocol:** collection-protocol.md v0.1. Validation: `compile-run.py`
  exit 0.

## Assigned seeds (20)

Harbor ID = `north-jersey-hp-` + lowercase HCSF registration. Addresses were
verified against operator websites before searching (see `assignments.csv`
for address, phone, registry source, and per-seed cautions).

| County | Seed (Harbor ID) |
| --- | --- |
| Union | Visiting Angels Union `north-jersey-hp-hp0065000`; HomeWell Care Services `north-jersey-hp-hp0249500`; BrightStar Care Westfield & Summit `north-jersey-hp-hp0191600`; BAYADA Union County `north-jersey-hp-hp0015320` |
| Morris | Senior Helpers Madison `north-jersey-hp-hp0104400`; Home Instead Morris County `north-jersey-hp-hp0397500`; Life Home Care `north-jersey-hp-hp0285900`; BAYADA Morris County `north-jersey-hp-hp0015347` |
| Essex | Visiting Angels Montclair `north-jersey-hp-hp0119000`; Right at Home Essex County `north-jersey-hp-hp0058900`; Home Instead Millburn `north-jersey-hp-hp0118200`; Comfort Keepers Montclair `north-jersey-hp-hp0179100` |
| Somerset | Right at Home Somerset & Hunterdon `north-jersey-hp-hp0101000`; Home Instead Somerset `north-jersey-hp-hp0289000` |
| Middlesex | Visiting Angels East Brunswick `north-jersey-hp-hp0436900`; Senior Helpers Plainsboro `north-jersey-hp-hp0347100` |
| Comparison | Senior Helpers Bergen County `north-jersey-hp-hp0171100`; Visiting Angels Ramsey `north-jersey-hp-hp0151500`; BAYADA Passaic County `north-jersey-hp-hp0015321`; Senior Helpers Fairfield `north-jersey-hp-hp0242300` |

## Counts (retrieved sample only — not representative of any population)

- **31 observations** (exact 21, probable 5, unresolved 5). 10 rows carry a
  blank `provider_id` by design; `needs_human_review=true` on 10 rows.
- Account types: provider_promotion 27, firsthand 2, recommendation_without_detail 1, unclear 1.
- Sentiment: neutral 20, positive 9, negative 2.
- Concern: none 29, service 1, safety_allegation 1.
- **Coverage: 21 rows** (20 seeds + `lane-discovery`): evidence_found 9,
  searched_no_relevant_result 9, ambiguous_only 2, partial 1.
- **9 of 21 coverage rows have evidence** (8 seeds + the discovery lane).
  Seeds with exact-match observations: BrightStar Westfield & Summit (7),
  Senior Helpers Plainsboro (3), Home Instead Millburn (2), Comfort Keepers
  Montclair (2), Senior Helpers Madison (2), HomeWell Care Services (2),
  Right at Home Essex County (1), Right at Home Somerset & Hunterdon (1),
  Visiting Angels Union (1).
- **Discovery lane:** 4 observations (all probable/unresolved), 74
  unresolved leads (`discovery-leads.csv`), 9 town-search rows
  (`discovery-town-searches.csv`): Chatham, Westfield, Bridgewater, Edison
  `evidence_found`; Summit, Morristown, Montclair, Somerville, New
  Brunswick `partial` (leads only, no experience accounts).
- **Aggregate candidates: 18 rows, all NOT VISIBLE, all values blank.** No
  rating was confirmed on any exact local Page itself. Index-card and
  place-card values were recorded only as unconfirmed leads in the notes,
  never as ratings.

## Findings

- **Almost everything found is provider promotion.** 27 of 31 observations
  are provider-published posts, reels, hiring notices, or reposted
  testimonials. That is a property of what public Facebook surfaces for
  these offices, not a finding about the quality of their care.
- **Only two firsthand family accounts, and neither is branch-attributable:**
  - `fb-njm-003` — a family member's positive recommendation of "Senior
    Helpers" (staff "wonderful," mother cared for "with respect &
    dignity"). No office, town, address, or phone in the post or its reply,
    so no branch can be established. Unresolved, blank provider_id.
  - `fb-nju-012` — a negative service comment ("Terrible decision when we
    called Bayada.") on a BAYADA BBQ post. Unresolved, blank provider_id,
    and **carries a retrieval caveat**: the public search index reports the
    comment, but `facebook-cli post comments read` returns 0 comments on
    that post under every invocation, so it could not be opened directly. A
    human must confirm it on the live post before any use. The commenter
    names no office.
- **One safety allegation, brand-level only:** `fb-njc-001` — a one-line
  accusation of corruption against the Senior Helpers brand, with no
  examples, details, office, town, or care episode. Recorded as a reported
  allegation, unresolved, blank provider_id, `needs_human_review=true`. It
  does not attach to the Paramus office or any branch.
- **Discovery seed-link:** `fb-njd-003` is a provider-published BrightStar
  testimonial suspected to be the Westfield & Summit seed (HP0191600);
  recorded as probable with blank provider_id per the discovery rule. The
  Union slice is the authoritative matcher for that seed.
- **New agencies surfaced by the discovery lane** (leads only, no
  experience accounts yet): Aquinas Healthcare (Chatham/Summit), SAGE
  Eldercare (Summit nonprofit), One You Love Homecare of Bridgewater,
  2ndFamily of Montclair, First Day Homecare (HCSF HP0397600 on its own
  brochure), A Place At Home (Montclair / Somerville / East Brunswick
  offices), Home Helpers (West Essex and Morristown franchises), Seniors
  Helping Seniors (Morris County). See `discovery-leads.csv` (74 rows) and
  `discovery-notes.md`.

## Identity holds and corrections — read before reconciling

- **Visiting Angels East Brunswick (HP0436900) — address NOT verified.**
  The repo assignment gives "A2 Brier Hill Ct Suite 3, East Brunswick."
  The freeze (three web searches) and the Somerset/Middlesex researcher
  (four more search rounds) found no Visiting Angels office at that
  address on visitingangels.com. The Brier Hill Ct address belongs to
  BrightStar Care of East Brunswick (C2 Brier Hill Ct, Bldg C, Ste 206)
  and Premier Home Care Inc (2 Brier Hill Ct Bldg C Ste 209) — the repo
  assignment's address looks like a mix-up with the BrightStar office in
  the same complex. Phone and website are blank in `assignments.csv`. No
  post was linked to this seed; coverage is `searched_no_relevant_result`.
  The seed needs verification by another route (e.g. the DCA registry or a
  direct check of the office) before any matching.
- **Somerset identity hold (from the repo assignment):** two active HP
  registrations share the Senior Helpers address at 764 Easton Ave Suite 8
  (HP0423200 and HP0175500). That office was left unassigned. It is
  separate from the Plainsboro assignment (HP0347100). No discovery
  material named that address.
- **Visiting Angels Union (HP0065000) — address discrepancy still open.**
  Operator site says 485 Morris Ave #201, Springfield (frozen as primary,
  matches the assignment); an earlier Harbor run recorded the NJ DCA
  registry address as 2816 Morris Ave Ste 37, Union. The DCA registry PDF
  returned HTTP 403 from two routes on 2026-11-14 and could not be
  re-checked. A post naming only "2816 Morris Ave, Union" is an unresolved
  lead until the registry is checked by another route.
- **Same-brand traps caught and not transferred** (see per-slice notes):
  BAYADA 324 Chestnut St, Union vs the Westfield seed; BAYADA Live-In
  Services (2nd Floor, 32 Maple Ave, Morristown) vs BAYADA Morris County
  (1st Floor); Life Home Care Livingston/Glen Rock/Somerset offices vs
  East Hanover; Senior Helpers of North Hudson and Senior Helpers of
  Fairfield & New Haven County, CT vs the NJ seeds; Right at Home Central
  New Jersey (Old Bridge) vs both the Essex and Hillsborough seeds; Home
  Instead Springfield/Hamilton vs Somerset; Hillsborough and Morris &
  Somerset Visiting Angels offices vs East Brunswick.

## Access gaps and limitations

- **No Page rating was confirmed anywhere.** Local office Pages return
  HTTP 403 "Profile Not Accessible" via the CLI, or browser stubs with no
  rating block. Recommendations tabs and full Page timelines are not
  enumerable via the CLI. A logged-in human browser session is the
  remaining route to Page ratings/Recommendations.
- **Comment enumeration fails on at least one post** (`fb-nju-012`, same
  limit as the earlier Lantern Hill case): CLI returns 0 comments while the
  search index describes comments. Rows affected carry a retrieval caveat.
- **Closed groups were not searched.** Notable ones: Hillsborough's three
  groups (one states content stays in the group), Somerset County Moms
  Group, "I Love Living In The Caldwells" (16,000 members), several East
  Brunswick, Plainsboro, Madison, Parsippany, East Hanover, Morristown,
  Springfield, and Westfield groups. The Westfield, NJ group (181023518704974)
  is private with a "content stays in the group" rule. Community pages and
  public groups were searched wherever open (see per-slice notes for the
  full list).
- **Social search is selected and personalized, not exhaustive.** Zero
  results means nothing relevant surfaced on these surfaces, not that no
  experiences exist. Do not describe blank results as "no experiences
  exist."
- **Community pages were searched per Dan's instruction** in every slice:
  town community forums and public groups for Springfield, Union,
  Westfield, Cranford, Madison, Parsippany, East Hanover, Morristown,
  Caldwell, West Orange, Millburn, Montclair, Paramus, Ramsey, Clifton,
  Totowa, Hillsborough, Somerset, East Brunswick, Plainsboro, plus the nine
  discovery towns. Every page/group checked is recorded in the slice notes,
  including zero results.

## Files in this batch

- `assignments.csv` — 20 seeds with address, phone, registry source, notes
- `batch-manifest.json` / `batch-manifest.md` — frozen roster (20 seeds +
  `lane-discovery`), prefixes, identity holds
- `supplied-home-care-assignment.md` — repo assignment as frozen (main 7ba7adc)
- `researcher-brief-in-home-care.md` — brief given to all six researchers
- `observations.csv` — 31 rows, compiled + validated
- `coverage.csv` — 21 rows, compiled + validated
- `aggregate-candidates.csv` — 18 rows, all NOT VISIBLE
- `discovery-leads.csv` — 74 unresolved leads, Harbor ID blank
- `discovery-town-searches.csv` — 9 town rows
- `collection-protocol.md`, `observations-template.csv`,
  `coverage-template.csv`
- `scratch/` — per-slice observations, coverage, aggregate candidates, and
  notes (union, morris, essex, comparison, somerset-middlesex, discovery)

## Human review still needed

Every observation needs human review before any import, publication, or
scoring. Priority: the two firsthand accounts (`fb-njm-003`,
`fb-nju-012` — the latter needs a live-post confirmation first), the
safety allegation (`fb-njc-001`), the seed-linked discovery row
(`fb-njd-003`), the East Brunswick office verification (HP0436900), the
HP0065000 registry cross-check, and the 74 discovery leads (none is a
confirmed Harbor provider yet).
