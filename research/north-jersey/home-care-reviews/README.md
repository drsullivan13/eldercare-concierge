# North Jersey home-care reviews

The expanded release contains 330 readable, source-linked accounts across 96 registered offices. Across the full 1,074-office dashboard, 37 offices have an eligible published review average and 11 meet Harbor’s sample and population requirements for a numeric experience score. These 11 source averages report 615 ratings in total. The score formula is unchanged.

The original release had 57 summaries across 15 offices and two scores. A second inspection of every visible row on the original 122 pages, 146 additional town checks, a statewide publisher-sitemap match against the registered names and DBAs, and targeted operator and federal identity checks expanded coverage. The Teaneck SYNERGY office still has readable family accounts. Its average is now held because one visible account does not establish the writer’s relationship to the agency. The Livingston BAYADA office was matched using the operator’s office-specific personal-care page, exact suite and the state license number recorded by NPPES.

The current evidence dispositions are in [office-expansion](office-expansion/). The [whole-roster coverage audit](../home-care-coverage/README.md) measures the entries returned through the application. Multiple websites displaying the same Google ratings count as one source family.

## Source trail

- `public-acquisition-audit.json` records checked pages, branch addresses, original source values, source hashes, displayed counts and independent decisions. Published review dates preserve their original precision. The audit contains no reviewer names or review bodies.
- `batches/` contains the redacted reviewed input. Each approved account has a direct source URL and a human-written summary. The current immutable batch is pinned by `manifest.json`; `decisions.json` records the compiler results.
- `../home-care-review-links/portal-links.json` holds separate links to external office profiles. These provide another route to read feedback; the link alone contributes zero reviews or score weight.

## Replay

Run from the repository root:

```sh
python3 -B scripts/regions/home-care-reviews.py --check
python3 -B scripts/regions/home-care-reviews-test.py
node --import tsx --test tests/home-care-reviews.test.ts
```

The publisher resolves every approved agency against the current regional market and the exact official registration source row. It generates `src/data/home-care-reviews.json`. The web application merges it at market registration and uses the existing location, review and experience-score APIs. After an intentional source update, run the publisher without `--check` to regenerate the bundle and manifest.
