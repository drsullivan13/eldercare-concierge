# North Jersey home-care reviews

The initial office release contains 57 original summaries across 15 registered home-care offices. Four source-reported Google averages qualify as consumer aggregates. Two meet Harbor’s existing sample requirement for a public index: FirstLight Home Care of Piscataway at its Somerset office (39 ratings), and SYNERGY HomeCare in Teaneck (58). Smaller samples remain available on their office pages. Mixed professional or employee populations, unsupported branches and unrelated clinical reviews are withheld. Families can still read an individually attributable account when the overall rating population is unclear.

The November 14, 2026 acquisition audit covers 72 distinct city directory pages and 122 public office profiles, with 470 displayed review rows before editorial selection. A city redirect or an unsuccessful match is a coverage gap. A Google aggregate shown by MyLivingChoice is one Google source family. The displayed review window is often much smaller than the published rating count. The wider catalog includes offices for which no family account has been released.

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
