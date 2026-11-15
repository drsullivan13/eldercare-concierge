# NJ Medicaid home-care directory exports

For each of the nine counties in `compile.py`, open the public [NJMMIS Provider Directory](https://www.njmmis.com/providerDirectory.aspx?nonBilling=False), choose the county and **Home Care Provider**, then choose one specialty and press **Download Provider Directory**. The November 15, 2026 capture includes four PDFs per county. Name each original `harbor-njmmis-<tag>-<County>.pdf`.

| Tag | Specialty |
| --- | --- |
| pca | Personal Care Assistance - Aged & Disabled |
| pdn | Private Duty Nursing |
| respite | Respite |
| homemaker | Homemaker - CCPED |

Run these commands in this directory. Extracting or verifying the PDFs requires Poppler's `pdftotext`. Replaying the retained receipts requires only Python.

```sh
python3 -B compile.py --check
python3 -B test_compile.py
python3 -B compile.py --verify-pdfs /path/to/originals --check
```

For a new dated release, update the capture date, recapture with `python3 -B compile.py --capture /path/to/originals`, and audit changes to the source controls, specialty labels and identities before publication. A regenerated state download may have a different SHA-256.

The source digest, filters and page counts for all 36 PDFs are in `receipts.json`. For candidates whose registered name and full practice address match, receipts preserve the original specialty and status, office phone and PDF page references. A record can span two pages. Only the labeled office phone participates in matching. The second (billing) phone, emails, unrelated provider records and PDF files are excluded.

Publication requires an active registered health-service firm, matching registered legal or trade name, street and suite, city, ZIP and office phone, an explicit specialty in the record and an active directory status. A conflicting status at the same office holds that specialty. Pediatric-only and non-service locations are excluded from the older-adult directory evidence. The directory’s availability label is used solely for screening records. Members can check their own plan and current service availability with the office.

`audit.json` reconciles all PDF records, including duplicates across exports. `verified.json` is the application input, with specialties combined at the verified office. The counts represent offices rather than people, claims or coverage decisions.
