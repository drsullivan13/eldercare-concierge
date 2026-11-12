# Home-health inspection source boundary

The [CMS QCOR HHA provider-reports page](https://qcor.cms.gov/HHAs) displayed this notice when checked on November 12, 2026.

> Due to systems migrations, HHA information generated from the Provider, Survey, and Deficiency Reports on this page is only accurate and/or available through May 19, 2021.

That page identified its CASPER source date as November 8, 2026. The displayed source date does not remove the explicit 2021 coverage limitation.

The separate [HHA 2567 report listing](https://qcor.cms.gov/HHA_2567_Reports) displayed 11,919 records across 1,192 pages. Its first page contained survey dates after the migration cutoff, including June 18, 2025. It linked the [full HHA 2567 XLSX export](https://qcor.cms.gov/downloadHHA2567).

The report listing says that its default selection contains surveys with deficiencies. Its filters also offer all surveys and surveys without deficiencies. Export completeness therefore needs its own verification. A published export is not proof that every survey or every agency appears.

The listing distinguishes condition, standard, and element tags from initial-comment memo tags. In particular, `E0000` and `G0000` say "Initial Comments - Not a Deficiency Citation". They must not contribute to deficiency counts.

The `qcor/` collection retains its own source receipts and coverage limits. It remains separate from the PDC HHCAHPS patient-experience survey data and the iQIES office-certification supplement.
