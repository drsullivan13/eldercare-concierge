# Batch manifest — fb-nj-in-home-care-2026-11-14

- **Run ID:** fb-nj-in-home-care-2026-11-14
- **Date:** 2026-11-14
- **Markets:** union, morris, essex, comparison, discovery
- **Protocol version:** 0.1
- **Selection method:** explicit assignment from Dan Sullivan 2026-11-14 (16 HCSF-registered offices) + discovery lane across Union/Morris/Essex/Somerset/Middlesex
- **Observation prefixes:** union `fb-nju-`, morris `fb-njm-`, essex `fb-nje-`, comparison `fb-njc-`, discovery `fb-njd-`
- **Status:** batch frozen. Setup only — no Facebook searching, no experience evidence collected in this step.

## Sources

Every address below was verified against the operator's own website first. Where noted, a CMS NPPES/NPI record or BBB listing corroborated the address or license number. **The NJ Division of Consumer Affairs HCSF registry was NOT consulted this run:** the registry PDF (`njconsumeraffairs.gov/ocp/agency.pdf`) returned HTTP 403 when fetched on 2026-11-14, so no registry address could be checked. Registration numbers (HP…) are the ones Dan supplied in the assignment and, where the operator site displays them, were confirmed there (BrightStar HP0191600 via BBB; Right at Home HP0058900, Home Instead Millburn HP0118200, Senior Helpers Bergen HP0171100, Senior Helpers Fairfield HP0242300 on their operator sites).

## The 16 frozen assignments

### Union

| Harbor ID | Office | Address | Phone | Website |
|---|---|---|---|---|
| north-jersey-hp-hp0065000 | Visiting Angels Union | 485 Morris Ave #201, Springfield, NJ 07081 | 908-497-7016 | visitingangels.com/union |
| north-jersey-hp-hp0249500 | HomeWell Care Services | 1600 US Highway 22 E, Suite 301, Union, NJ 07083 | 908-302-0200 | homewellcares.com/in-home-care-nj-union-nj1112/ |
| north-jersey-hp-hp0191600 | BrightStar Care Westfield & Summit | 560 Springfield Ave, Second Floor, Ste G, Westfield, NJ 07090 | 908-322-8200 | brightstarcare.com/locations/westfield/ |
| north-jersey-hp-hp0015320 | BAYADA Union County | 251 North Ave W, Suite 201, Westfield, NJ 07090 | 908-652-9713 | bayada.com |

### Morris

| Harbor ID | Office | Address | Phone | Website |
|---|---|---|---|---|
| north-jersey-hp-hp0104400 | Senior Helpers Madison | 214 Main Street, 2nd Floor, Madison, NJ 07940 | 973-360-1500 | seniorhelpers.com/nj/madison/ |
| north-jersey-hp-hp0397500 | Home Instead Morris County | 1719 NJ-10, Suite 317, Parsippany, NJ 07054 | 973-797-9055 | homeinstead.com/home-care/usa/nj/morris-county/322/ |
| north-jersey-hp-hp0285900 | Life Home Care | 120 Eagle Rock Ave, Suite 200, East Hanover, NJ 07936 | 973-273-3441 | homecare.life |
| north-jersey-hp-hp0015347 | BAYADA Morris County | 32 Maple Avenue, 1st Floor, Morristown, NJ 07960 | 973-867-3000 | bayada.com |

### Essex

| Harbor ID | Office | Address | Phone | Website |
|---|---|---|---|---|
| north-jersey-hp-hp0119000 | Visiting Angels Montclair | 7 Cleveland St, Caldwell, NJ 07006 | 973-226-9090 | visitingangels.com/montclair |
| north-jersey-hp-hp0058900 | Right at Home Essex County | 735 Northfield Ave, West Orange, NJ 07052 | 973-669-1822 | rightathome.net/essex-county/ |
| north-jersey-hp-hp0118200 | Home Instead Millburn | 215 Millburn Ave, Suite 2B, Millburn, NJ 07041 | 973-379-4910 | homeinstead.com/home-care/usa/nj/millburn/288/ |
| north-jersey-hp-hp0179100 | Comfort Keepers Montclair | 31 Park St, 2nd Floor, Montclair, NJ 07042 | 973-707-2310 | comfortkeepers.com/offices/new-jersey/montclair |

### Comparison (Bergen / Passaic)

| Harbor ID | Office | Address | Phone | Website |
|---|---|---|---|---|
| north-jersey-hp-hp0171100 | Senior Helpers Bergen County | 22 Madison Avenue, Suite 305, Paramus, NJ 07652 | 201-968-5777 | seniorhelpers.com/nj/bergen-county/ |
| north-jersey-hp-hp0151500 | Visiting Angels Ramsey | 17 S. Franklin Tpk, 1st Floor #3, Ramsey, NJ 07446 | 201-825-7900 | visitingangels.com/ramsey |
| north-jersey-hp-hp0015321 | BAYADA Passaic County | 1117 Main Avenue, Suite 101, Clifton, NJ 07011 | 973-333-4477 | bayada.com |
| north-jersey-hp-hp0242300 | Senior Helpers Fairfield | 547 Union Blvd, Totowa, NJ 07512 | 973-362-0130 | seniorhelpers.com/nj/fairfield-montville/ |

## Discovery lane

`lane-discovery` — "Discovery lane (town searches, Union/Morris/Essex/Somerset/Middlesex)", county `multi`, type `discovery_lane`. **This is NOT a provider.** It exists only so discovery-lane observations (town searches, community pages/groups, newly surfaced agencies) can be counted in coverage. It has no address, no registration, and no Harbor ID. New agencies found in the discovery lane go in the leads file with a blank Harbor ID until an official address/registration is confirmed.

## Discrepancies and cautions

### 1. Visiting Angels Union (HP0065000) — address discrepancy, LEFT OPEN
- Operator site (current): **485 Morris Ave #201, Springfield, NJ 07081**, phone 908-497-7016.
- Earlier Harbor run recorded the NJ DCA registry address as **2816 Morris Ave Ste 37, Union, NJ**.
- Dan's assignment table says Springfield for HP0065000.
- Resolution: Springfield address used as the frozen primary (operator site, current, matches Dan's table). The Union address is recorded in `assignments.csv` selection_notes, not discarded. The registry value could **not** be re-verified this run because the DCA registry PDF returned HTTP 403. Researchers must not treat the Springfield address as registry-confirmed; if a post names only "2816 Morris Ave, Union", treat it as an unresolved lead, not an exact match to this assignment, until the registry is checked by another route.

### 2. BAYADA Passaic County (HP0015321) — three phone numbers, phone unresolved
- Operator site (most recent crawl): **973-333-4477**.
- CMS NPPES/NPI record 1730110230 (last updated 2026-03-26) and BAYADA job postings: **973-574-1120**.
- Place listing: **973-968-6386**.
- Address is consistent across all sources (1117 Main Ave, Suite 101, Clifton). Phone recorded as 973-333-4477 with the variants in `assignments.csv`. Phone is not an identity field for this run, so the batch is not blocked.

### 3. BAYADA Union County (HP0015320) — two phone numbers
- Operator site Assistive Care page: **908-652-9713**.
- NPI record 1659689206: **908-789-1717** at the same address.
- Address consistent. Phone recorded as 908-652-9713 with the variant noted. Not blocking.

### 4. Home Instead Morris County (HP0397500) — three phones on the operator site
- 973-797-9055 (location description), (862) 800-3126 (Contact Us), (973) 970-9250 (Get Started). All from homeinstead.com. Phone recorded as 973-797-9055 with the others noted. Not blocking.

### 5. Minor phone variants (place listings only — operator site taken as authoritative)
- Senior Helpers Madison (HP0104400): place listing 973-354-2136 vs operator site 973-360-1500.
- BAYADA Morris County (HP0015347): place listing 973-761-2923 and 973-520-2998 vs operator site 973-867-3000.
- Senior Helpers Bergen County (HP0171100): place listing 201-257-5260 vs operator site 201-968-5777.
- Senior Helpers Fairfield (HP0242300): place listing 973-358-2329 vs operator site 973-362-0130.
- BrightStar Care Westfield & Summit (HP0191600): Summit contact page lists 908-594-6812 at the same address vs main 908-322-8200.
- Home Instead Millburn (HP0118200): alternate (862) 810-8778 in Contact Us blocks vs main 973-379-4910.

### 6. Brand name vs office town — NOT discrepancies, recorded for matching
- **Visiting Angels Montclair (HP0119000)** is branded "Montclair" but the office is in **Caldwell** (7 Cleveland St). Matches Dan's table. Do not transfer Montclair-town material to this office on the brand name alone.
- **Senior Helpers Fairfield (HP0242300)** is branded "Fairfield" but the office is in **Totowa** (547 Union Blvd). Matches Dan's table. Same caution.

### 7. Nearby same-brand locations — do NOT transfer
- **BAYADA Union County (HP0015320):** a separate BAYADA presence at 324 Chestnut St, Union is not this seed.
- **BAYADA Morris County (HP0015347):** the 2nd Floor at 32 Maple Ave, Morristown is Live-In Services, Northern NJ — a different service line, not this seed.
- **Life Home Care (HP0285900):** NPI record shows a Livingston location (70 S Orange Ave Ste 220) with East Hanover as mailing address; Glen Rock and Somerset offices also exist. Match only the East Hanover office.
- **BAYADA Passaic County (HP0015321):** BAYADA Pediatrics Passaic County is a separate unit at 163 E. Main St, Little Falls — not this seed.

## Files in this run directory

- `assignments.csv` — the 16 frozen assignments (assignment_id = harbor_id = north-jersey-hp-&lt;lowercase registration&gt;)
- `batch-manifest.json` — machine-readable manifest (16 providers + lane-discovery entry)
- `batch-manifest.md` — this file
- `collection-protocol.md` — Harbor collection protocol v0.1 (copied in at run start)
- `observations-template.csv`, `coverage-template.csv` — Harbor kit templates (copied in at run start)
- `scratch/` — researcher working files (empty at freeze)

## Update 2026-11-14 ~19:35 ET — repo assignment 7ba7adc

Dan supplied the updated repo assignment (`supplied-home-care-assignment.md`,
main commit 7ba7adc). It adds 4 seeds, bringing the batch from 16 to 20 seeds:

- Somerset: Right at Home Somerset & Hunterdon (105 Omni Dr, Hillsborough,
  HP0101000) — verified on operator site; Home Instead Somerset (220 Davidson
  Ave Suite 98, Somerset, HP0289000) — verified on operator site.
- Middlesex: Visiting Angels East Brunswick (A2 Brier Hill Ct Suite 3,
  HP0436900) — address per repo assignment ONLY, not corroborated on the
  operator site in the freeze (three searches surfaced the Hillsborough
  Visiting Angels office instead); researcher must verify before linking any
  post. Senior Helpers Plainsboro (2 Hospital Dr Building B, Plainsboro,
  HP0347100) — verified on operator site; branded "Senior Helpers of
  Princeton" but located in Plainsboro.

**Somerset identity hold (from the repo assignment):** two active HP
registrations share the Senior Helpers address at 764 Easton Ave Suite 8
(HP0423200 and HP0175500). Leave that office unassigned until the current
operator can be corroborated. It is separate from the Plainsboro assignment.
