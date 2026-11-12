# Targeted residential price check

The November 12, 2026 pass inspected 21 Hudson residential records and ten Passaic assisted-living records. Coverage follows Harbor IDs, preserving overlapping licensed units and independent CMS rows at conflicting addresses. Each row in `checks.json` includes the selected source, date, outcome and reason. An inaccessible operator page and a licensing-only check are distinct from a verified operator price. This pass made no provider contact.

Passaic yielded four new location-specific price observations. The Bristal at Wayne quotes a studio minimum of $7,200/month, subject to availability. Brookdale Wayne lists November 10, 2026 starting base rates of $5,975/month for assisted living and $9,365/month for memory care, with care and other fees separate. Mira Vie shows $4,275 in Clifton and $3,095 in West Milford, both without a verified billing period. Sunrise of Wayne's $4,200/month is already in the November release. Brightview's Wayne-branded PDF says its figures are typical estimates and that each community's prices vary.

The Hudson pass established no comparable private-pay rate. The contact address for Harbour View differs from both licensed units. The Optima Care Fountains operator page matches the state's 505 County Avenue facility, while CMS lists 595 County Avenue. A general hospital price file does not identify the complete family charge for the transitional-care unit. These rows are natural candidates for a coordinator to verify with the exact unit later.

Stage this supplement separately using the repository root and a disposable output directory:

```sh
python3 -B scripts/regions/provider-offerings.py \
  --additional-pages research/north-jersey/offerings/hudson-passaic/pages.json \
  --output-dir /tmp/harbor-hudson-passaic-offerings
```

Run the same command with `--check` to verify byte-for-byte. The four reviewed records were promoted on November 12. The ordinary build reads the baseline operator input and has no dependency on the supplemental files. Replaying the identical supplement leaves the evidence unchanged. A conflicting record fails verification. The two Mira Vie amounts remain textual.
