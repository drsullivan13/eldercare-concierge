# Location details and public reviews

The November 12, 2026 research pass adds four sections to each location: Life here, Rooms & costs, Availability, and Reviews. Families can inspect the source behind a fact, compare options and add an availability check to their plan. Adding a task does not contact the provider.

## Coverage

| Evidence                                                      | Locations |
| ------------------------------------------------------------- | --------: |
| At least one sourced fact                                     |       521 |
| Provider pages reviewed for detailed offerings                |        86 |
| Published positive dollar amounts with a known billing period |        35 |
| Review aggregates found, including excluded sources           |        17 |
| Selected public review accounts                               |        16 |
| Eligible consumer experience score                            |         6 |
| Published opening claims                                      |         7 |
| Published waitlist or priority-list claims                    |         8 |

These groups overlap. The six scores all have limited evidence under the current policy. The remaining locations are unrated. Counts reflect this snapshot, and score eligibility changes as sources age.

The broad baseline includes CMS capacity and historical resident averages for 280 nursing homes, plus state capacity figures for 221 assisted-living residences. Three assisted-living records lack a matching capacity row. Those facts help describe a location's size; they cannot establish open rooms. Detailed provider research covers western suburbs, selected North and South Shore residences, seven continuing-care campuses, ten home-service organizations and fifteen nursing homes. Coverage is incomplete and is not a random sample of providers.

## Prices and offerings

Each claim retains its location, source URL and retrieval date. Care levels, meals, activities, transport and room arrangements remain provider descriptions until independently checked. A service advertised for rehabilitation is not automatically assigned to long-term residents or another unit on the campus.

Prices retain their billing period and conditions. Entrance fees, co-op stock, refundable priority deposits, monthly rent, assessed care and hourly nursing charges have different meanings. They are displayed separately. Free assessments remain in the details but do not make a location appear in the published-prices filter. An undated rate stays undated; a future fee schedule keeps its future effective date. Conflicting prices remain visible in the notes.

An itemized quote still needs the person's care assessment, room selection, move-in date and contract terms. The POC does not calculate an all-in monthly price from incomplete components.

## Availability

Seven public pages describe openings or limited availability. Eight describe waitlists or priority lists. These are source observations, with the source's effective date where supplied. None is a confirmed reservation or case-specific offer of admission. Several opening claims are undated, so a recent page check cannot establish that the room is still open.

The Massachusetts DPH capacity workbook also contains a field labeled available beds. Inspection of the workbook showed capacity minus average occupancy, rather than confirmed admissions inventory. Harbor does not convert that field, CMS capacity, floor-plan pages or a contact form into a current opening.

The next useful integration is an opt-in provider update with a timestamp, room type, care level, admission restrictions and expiration. Public-page monitoring can detect changed offers in the meantime. A failed fetch should retain the last observation and its date; it cannot establish that a provider is full.

## Review evidence and the score

The [consumer experience policy](experience-score.md) defines the numerical calculation and its tests. Eligible published averages are normalized to ten points. Source weights use the square root of reported review count, capped at 100 reviews per source family. Known syndicated sources and duplicate pages count once. At least ten eligible reported reviews are required.

The score describes published consumer ratings. CMS inspections, clinical measures and patient surveys keep their own fields and explanations. A positive consumer score cannot remove a regulatory warning. Counts are reported reviews, not verified unique people, and broad location averages may include tour experiences or multiple care levels.

Caring.com and A Place for Mom supplied directly observed averages for some locations. APFM's proprietary recency score is distinct from its published all-time review average. Some listings mix industry reviewers with consumers; those aggregates are excluded when the populations cannot be separated. SeniorAdvisor and APFM share a source family.

Public Reddit discussions and a Facebook-origin account republished by another site add context. Google-labeled reviews observed through other directories are identified as republications. Google Maps pages did not expose a usable direct aggregate in this research, Yelp access was blocked, and the X search produced no attributable consumer matches. Private Facebook groups were not accessed. The POC has no connected Google, Yelp, Facebook, Reddit or X feed.

Selected accounts keep a source link, date where known and self-described relationship. Reviewer identities and medical details are omitted. These accounts can help families form questions, but selection prevents them from establishing how common a problem is. They do not change the numerical score. Search-result snippets remain labeled and cannot contribute to it.

## Rebuild and next steps

`src/data/inputs/location-research/` retains seven reviewed input files. `python scripts/prepare-location-research.py` validates references and exact catalog IDs, then writes the combined snapshot and coverage counts. This is an offline rebuild. Running it does not retrieve new evidence or advance source dates.

`GET /api/research?id=<catalog-id>` returns one location and its score calculated for the request's UTC date. Search and saved-provider responses include a compact summary. Research filters select reviewed details, published prices, opening claims or eligible review scores. Experience sorting requires a care category and always preserves the geographic radius. Missing scores remain discoverable.

The next pass should broaden exact-location review coverage, reconcile address discrepancies and retain rating distributions when a permitted source provides them. A refresh service needs source checksums, separate retrieval and effective dates, and a review queue for changed identities or contradictory claims. Before using sentiment extraction to recommend care, evaluate it against care-manager assessments and test for differences in source coverage across neighborhoods and care settings.
