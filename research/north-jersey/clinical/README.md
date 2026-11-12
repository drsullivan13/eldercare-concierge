# North Jersey clinical evidence

The clinical transform reconciles every nursing-home and home-health reporting unit by CMS Certification Number against retained Medicare Provider Data Catalog responses and the certification supplement. The 139 nursing facilities have 3,256 health citations and 107 penalty records. The consumer view caps each event list at its latest 25 records. The sidecars preserve the full source evidence and row references.

The home-health release has 18 certified offices in the six target counties. Eight additional reporting agencies have service ZIPs in the region and are retained separately. Each of the 18 offices has 16 percentage measures in the consumer fragment. The retained agency records preserve all 17 measures, including the Medicare spending ratio and published episode counts. Each rate retains its original unit, source column, reporting period, published raw value and footnotes.

The two supplementary HHCAHPS comparator captures use the same release as the agency survey. The records include their requested CMS URLs, retrieval date, response status and capture method. They are parsed CMS responses. Their hashes are pinned in `sources/capture-receipts.json`. A refresh requires independently inspecting the published dataset identity, state or national scope, release and query conditions before replacing those receipts.

Run these commands from the checkout with the project Node dependencies installed.

```sh
python3 -B scripts/regions/clinical-nj.py
python3 -B scripts/regions/clinical-nj.py --check
python3 -B scripts/regions/clinical-nj-test.py
node --import tsx scripts/regions/clinical-nj-consumer-test.ts
```

The Python tests compare the transformed values and missingness against original source rows. The consumer check injects the generated fragments into the published North Jersey roster, exercises all 139 nursing and 18 home-health detail lookups, and verifies TypeScript assignability using the actual JSON values. Run the regional normalizer and builder separately after refreshing clinical inputs.
