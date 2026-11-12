# Harbor NJ roster notes — Union + Morris counties, 2026-11-12

Provisional first assignment for the North Jersey Facebook research run.
**Roster work only — no Facebook searching, no reviews, no review counts,
no facility or person contacted.** Selection was frozen before any review
information was seen. `harbor_id` is blank on every row (reconciled later).

Files in this directory:

- `assignments.csv` — 20 rows: `nj-u-01`–`nj-u-10` (Union), `nj-m-01`–`nj-m-10`
  (Morris). Headers as specified in the brief.
- `scratch/union-assignments.csv`, `scratch/morris-assignments.csv` — the
  per-county working files the combined CSV was assembled from.
- `scratch/union-notes.md`, `scratch/morris-notes.md` — the per-county
  source lists, ambiguities, failed leads and alternates in full.

## Assembly

The combined file is the two county files concatenated, with one correction
made at assembly: `nj-u-04` (Brighton Gardens Of Mountainside) had
`care_unit` = "memory care unit" in the Union file. Per the brief, `care_unit`
is for separately licensed units only; NJ DOH licenses Brighton Gardens as
an Assisted Living Residence and its memory care is a program within that
license, not a separate license — so `care_unit` was blanked and the
selection note amended. No other cell was changed.

Spot-check at assembly: the NJ DOH detail page for `nj-u-01` was re-opened
and confirms Mira Vie At Fanwood, 295 South Avenue, Fanwood, NJ 07023,
Assisted Living Residence, License 90A000 — exactly as rostered.

## Sources actually consulted

### Union County

- NJ Department of Health, Long-Term Care Facilities Search
  (`healthapps.nj.gov/facilities/`) — facility detail pages for nj-u-01
  through nj-u-08 (licenses 90A000, 90144, 82472, 90122, 062013, 062017,
  062004, 20016). Source of record for those 8 rows.
- CMS National Plan and Provider Enumeration System (NPPES) records, via
  the NPI profile mirror (`npiprofile.com/npi/1477804904` for BAYADA
  Cranford; `npiprofile.com/npi/1699250878` for Alangad/Visiting Angels
  Union) — the identifier source for nj-u-09 and nj-u-10. NPPES is
  CMS-operated; the `source_type` on those rows names the *issuer* of the
  identifier (NJ DOH for the BAYADA home-health license; NJ Division of
  Consumer Affairs for the Visiting Angels Health Care Service Firm
  registration), not the NPPES site itself.
- Operator websites, address/name confirmation only: Visiting Angels Union,
  Erickson/Lantern Hill, BAYADA Cranford.
- Corroborating only: Union County Division on Aging Resource Directory
  (`ucnj.org`); CMS-derived CCN cross-checks via CMS survey documents on
  `healthapps.nj.gov` (noted in selection notes, NJ DOH license is the
  identifier of record).
- **Not successfully used:** NJ DCA continuing-care/CCRC list — no
  DCA-published CCRC list page or Lantern Hill DCA record number was
  located via public web text. NJ Division of Consumer Affairs
  license-verification portal (`newjersey.mylicense.com/verification`) —
  form-based, no fetchable record page obtained. NJ DOH home-health-agency
  license lookup — no directly fetchable page for the BAYADA Cranford
  office; no Cranford-specific BAYADA Medicare CCN located (CCNs found
  belonged to other BAYADA offices), so no CCN is claimed for nj-u-09.

### Morris County

- NJ Department of Health, Long Term Care Facilities Search
  (`healthapps.nj.gov/Facilities/fsFacilityDetails.aspx`) — primary source
  for nj-m-01, nj-m-02, nj-m-04, nj-m-05, nj-m-06, nj-m-07, nj-m-08.
- NJ Department of Health, Long-Term Care Real Estate Transfer of
  Ownership notice list
  (`nj.gov/health/healthfacilities/certificate-need/real-estate-transfer-ownership/`)
  — confirms Troy Hills Center, License 061416 (nj-m-03).
- NJ DOH–hosted CMS survey forms (Form CMS-2567) — confirm Merry Heart
  Nursing Home, Facility ID NJ61410 / CMS CCN 315057 (nj-m-04).
- CMS Provider of Services file (dataset `6jpm-sxkc`), via the Morris
  County home-health directory — lists the 3 Medicare-certified home
  health agencies in Morris County; CCN 317002 for VNA of Northern New
  Jersey (nj-m-09). Corroborated by the NPPES/NPI record (NPI 1417010950,
  NJ home-health license 71401) and the agency's own site, which states it
  is licensed by NJ DOH.
- Visiting Angels of Morris and Somerset County official site
  (`visitingangels.com/morristown/home`) — address and CAHC-accreditation
  claim for nj-m-10. Its HCSF registration number could not be retrieved
  in this pass; `source_identifier` is blank and `source_type` is
  `official_website`.
- Morris County Office of Aging, Disabilities and Community, "Housing
  Options" (2024) — consulted for the continuing-care question; its CCRC
  heading is contradicted by operator/CMS evidence for Heath Village (see
  Omissions).
- Heath Village official FAQ — "Heath Village is not a Continuing Care
  Retirement Community (CCRC)… We are a 'pay as you go' organization."
- **Not successfully used:** data.nj.gov — only the acute-care facilities
  dataset surfaced, which does not cover long-term care, assisted living,
  or home health. No NJ DCA continuing-care registry list was retrievable.

## Care-type coverage achieved (20 rows)

| care_setting | Union | Morris | Total |
| --- | --- | --- | --- |
| assisted_living | 3 | 3 | 6 |
| nursing_home | 2 | 3 | 5 |
| memory_care | 1 | 1 | 2 |
| rehabilitation | 1 | 1 | 2 |
| home_health | 1 | 1 | 2 |
| home_care | 1 | 1 | 2 |
| continuing_care_campus | 1 | 0 | 1 |

- **Union:** all 7 care types covered. 8 municipalities: Fanwood, Westfield
  (x2), Cranford (x2), Mountainside, Linden, Union Township (x2), New
  Providence. Mix of large operators (Sunrise, Atria, Erickson/Lantern
  Hill, BAYADA) and smaller/local entities (Mira Vie, Cornell Hall,
  Complete Care, Aristacare, Alangad/Visiting Angels).
- **Morris:** 6 of 7 care types covered. Municipalities: Parsippany-Troy
  Hills (x2), Morristown (x3), Succasunna, Whippany, Morris Plains,
  Florham Park, Denville.

## OMISSIONS

1. **Morris County — continuing_care_campus: NO verified entity.** No
   NJ DCA-registered CCRC located in Morris County was verified, and no
   DCA CCRC registry list was retrievable. Closest candidate Heath Village
   (Hackettstown) is NOT a CCRC by its own FAQ and CMS flags its
   skilled-nursing unit as CCRC: No (CCN 315072); its NJ DOH record is a
   long-term care license (031402). The Oaks at Denville is a NJ DOH
   assisted living residence (60A002) with a separate nursing-care license,
   not a DCA CCRC. Nothing was imported from a neighboring county to fill
   this slot. The Morris quota is still 10 — the slot was filled by a
   third nursing-home row instead.
2. **Union County — no care-type omissions and no quota shortfall.**
   Qualifications, not omissions: memory care has no separate NJ license
   class (Brighton Gardens is licensed as an Assisted Living Residence;
   the memory-care designation is program-based; same applies to Sunrise
   Westfield and Atria Cranford, rostered as assisted_living). Rehabilitation
   has no freestanding rehab-only licensed entity in the roster (Cornell
   Hall is NJ DOH-licensed as a Long Term Care Facility and fills the
   rehabilitation slot as a care & rehabilitation center). Lantern Hill is
   the county's only CCRC campus identified; its NJ DOH record is the
   40-bed LTC/continuing-care unit (license 20016) — a secondary
   assisted-living license 20A105 cited for the same campus was not
   verified on NJ DOH and is not used as an identifier.
3. **Home-care verification gap (Morris, nj-m-10).** Visiting Angels of
   Morris and Somerset County is rostered on its official site's address
   and CAHC-accreditation claim only; its NJ Division of Consumer Affairs
   HCSF registration number could not be retrieved. `source_identifier` is
   blank; confirm via `newjersey.mylicense.com/verification` before any
   research use. Same gap applies to the alternate, Home Instead Morris
   County (Parsippany).
4. **Home-care / home-health identifier caveats (Union, nj-u-09, nj-u-10).**
   Both identifiers rest on CMS NPPES records (via the NPI profile mirror),
   not on a fetchable NJ DOH or Consumer Affairs page — the DCA portal is
   form-based and no DCA record number was located for Lantern Hill either.
   Confirm the DCA numbers via the verification portal before any
   publication use. The Visiting Angels HP0065000 identifier is
   corroborated by an archived NJ DCA personnel-services list showing
   "ALANGAD & ASSOCIATES INC. DBA VISITING ANGELS — Health Care Service
   Firm — 2816 MORRIS AVENUE, SUITE #37, UNION NJ 07083".

## Ambiguities / disagreements between sources

- **Name changes caught on the primary source (Union):** The Chelsea at
  Fanwood is now licensed as Mira Vie At Fanwood (nj-u-01); Westfield
  Center is now Complete Care At Westfield, LLC (nj-u-05); Aristacare At
  Parkside and Aristacare At Delaire share one license/CCN (nj-u-06).
  Former names are recorded as aliases; do not search under the old name
  alone.
- **Lantern Hill address (nj-u-08):** NJ DOH gives 537 Mountain Avenue,
  New Providence; the operator's site gives 535 Mountain Avenue. The NJ
  DOH address (537) is used; 535 is the campus's general mailing address.
- **Visiting Angels address (nj-u-10):** NPI-registered / DCA-listed
  address 2816 Morris Ave Ste 37, Union (to which HP0065000 attaches) vs
  the operator site's current office 485 Morris Ave #201, Springfield.
  The registered (Union) address is used; both are in Union County.
- **BAYADA Cranford addresses (nj-u-09):** NPI-registered location is
  6 Commerce Dr PH Suite, Cranford (NPI 1477804904, license HP0015342);
  BAYADA's site also lists an 11 Commerce Drive Suite 1, Cranford office.
  The NPI-registered address is used; the 11 Commerce Dr office was not
  separately verified.
- **Morris View Healthcare Center — Morristown vs Morris Plains (nj-m-02).**
  NJ DOH lists 540 West Hanover Avenue, Morristown, NJ 07960; secondary
  directories list the same street address as Morris Plains, NJ 07950.
  The CSV follows NJ DOH (Morristown, 07960); the address sits on the
  Morristown/Morris Plains border.
- **Heath Village — street number (not rostered).** NJ DOH gives 451
  Schooley's Mountain Rd; the operator gives 430 Schooley's Mountain Rd.
  Noted so the discrepancy is not carried forward silently.
- **Brighton Gardens of Florham Park — license expiry (nj-m-07).** An
  older NJ DOH crawl showed expiry 08/31/2026; a secondary summary says
  08/31/2027. Only the license number (60A001) is asserted; no expiry
  date is recorded.
- **CareOne naming (nj-m-01).** NJ DOH licensed name is "Careone At
  Parsippany" (license PSIFQU, 100 Mazdabrook Road); marketing name is
  "CareOne at Morris". A separate "CareOne at Morris Assisted Living"
  sits at 200 Mazda Brook Road (NJ DOH NJ60A007) and was NOT rostered.
- **Merry Heart naming and campus (nj-m-04).** CMS/NJ DOH survey forms
  name the nursing home "Merry Heart Nursing Home" (NJ61410, CCN 315057);
  marketing name is "Merry Heart Health Care Center". A separate "Merry
  Heart Assisted Living, LLC" at 118 Main Street, Succasunna (NJ14A002)
  was NOT rostered.
- **Atlantic Visiting Nurse — two CMS numbers, one name/address (not
  rostered).** 465 South Street, Suite 100, Morristown, carries
  home-health CCN 317054 and hospice CCN 311503. Verified alternate; if
  ever rostered, use the home-health CCN 317054 for a home_health row only.
- **Troy Hills Center CCN (nj-m-03).** CMS CCN 315138 appears only in
  CMS-derived secondary sources; the roster identifier is the NJ DOH
  license 061416 from the official NJ DOH page cited in the CSV.

## Failed starting leads (not rostered)

- **CareOne at Linden / CareOne at Union** — no such CareOne facilities
  exist in NJ DOH or CMS records; replaced by Aristacare At Parkside
  (Linden) and Cornell Hall / Complete Care At Westfield.
- **Brookdale Westfield** — no Brookdale in Westfield (nearest: West
  Orange, Florham Park).
- **Brookdale Morristown (NJ)** — every hit resolves to Brookdale
  Morristown, 2131 Walters Drive, Morristown, **Tennessee**. No NJ DOH
  record found. Do not re-add without a NJ DOH record.
- **Spring Hills Summit** — no Spring Hills in Summit; the Summit AL at
  41 Springfield Ave is Brandywine Living at Summit (NJ DOH 90A001).
- **Home Instead (Westfield)** — no Westfield office; nearest are
  Parsippany (Morris) and Millburn (Essex).
- **Comfort Keepers (Westfield)** — serves Westfield from its Mountainside
  office (1199 US-22 East, Union County); kept as a home-care alternate,
  no registration number located.

## Verified alternates (not in the 20; use first if a row must be replaced)

- **Sunrise Of Summit** — 26 River Road, Summit, NJ 07901; assisted
  living; NJ DOH 20A014.
- **Comfort Keepers of Mountainside** — 1199 US-22 East, Mountainside, NJ
  07092; home_care alternate; no registration number located — verify
  before use.
- **Manor Care Health Services Mountainside** — 1180 Route 22 West,
  Mountainside; nursing-home alternate; license 062021 cited in secondary
  directories, not opened on NJ DOH in this pass.
- **Cranford Rehab & Nursing Center** — 205 Birchwood Ave, Cranford;
  nursing-home alternate; license 062006 cited in secondary directories,
  not opened on NJ DOH in this pass.
- **Atlantic Visiting Nurse** — home_health, 465 South Street, Suite 100,
  Morristown, NJ 07960, CMS CCN 317054 (hospice CCN 311503 at same
  address — see ambiguity above).
- **Brookdale Florham Park** — assisted_living, 8 James Street, Florham
  Park, NJ 07932, NJ DOH ALR NJ60A000.
- **The Oaks at Denville — Nursing Care** — nursing_home, 21 Pocono Road,
  Denville, NJ 07834, NJ DOH LTC license 061424 (separate from the
  rostered ALR at 19 Pocono Road).
- **Merry Heart Assisted Living** — assisted_living, 118 Main Street,
  Succasunna, NJ 07876, NJ DOH NJ14A002.
- **CareOne at Morris Assisted Living** — assisted_living, 200 Mazda Brook
  Road, Parsippany, NJ 07054, NJ DOH NJ60A007.

## Somerset and Middlesex leads tracked separately (NOT in the 20)

### Somerset County

- **Fellowship Village** — 8000 Fellowship Drive, Basking Ridge, NJ 07920
  — CCRC/life-plan campus; the nearest DCA-type campus to Morris County.
  Noted because the brief named it as a do-not-import example.
- **Spring Hills Somerset** — 473 Demott Ln, Somerset, NJ 08873 — assisted
  living / memory care operator location.
- **CareOne at Somerset Valley** — 1621 Route 22 West, Bound Brook /
  Bridgewater, NJ — nursing/rehab.
- **Sunrise of Basking Ridge** — 404 King George Rd, Basking Ridge, NJ
  07920 — assisted living.
- **Spring Hills Morristown** — 17 Spring Pl, Morristown — Morris County
  (listed here only because it surfaced under the Spring Hills lead, not
  as a Somerset lead).

### Middlesex County

- **No Middlesex leads surfaced in this pass.** Neither county researcher
  encountered a Middlesex facility while working the official listings.
  Middlesex expansion will need its own roster pass.

### Other nearby counties (surfaced while checking the CCRC question)

- **Cedar Crest Village** — 1 Cedar Crest Village Drive, Pompton Plains,
  NJ 07444 — Morris County (Pequannock Township) — CCRC/life-plan campus.
  [Correction 2026-11-12: an earlier roster note said Passaic County;
  verified against Morris County records and the operator.]
- **Home Instead, Millburn office** — 215 Millburn Ave Suite 2B, Millburn,
  NJ 07041 — Essex County — HCSF license HP0118200. Noted to prevent
  misattribution to the Morris County office (the HP0118200 number must
  NOT be attributed to the Parsippany office).

## Method note

Municipality in the CSV follows the municipality in the official address
of record (NJ DOH / CMS / operator site), not the township it sits in
(e.g. Whippany is in Hanover Township; Succasunna is in Roxbury Township).
License numbers are transcribed exactly as shown by NJ DOH (case
preserved). CMS CCNs are 6-digit numbers as published in CMS data.
