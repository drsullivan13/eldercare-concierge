# Rebuild North Jersey ZIP geography

Run these commands from the repository root with Python 3.10 or newer.
The scripts use only the Python standard library.

1. Verify the retained snapshot without network access or file writes.

   ```sh
   python3 scripts/regions/zip-build.py --check
   ```

2. Rebuild from the retained inputs.

   ```sh
   python3 scripts/regions/zip-build.py --offline
   ```

   The six generated JSON files remain byte-identical when the retained inputs and generator are unchanged.
   A plain invocation also rebuilds offline.

3. Run the source-backed acceptance tests.

   ```sh
   python3 scripts/regions/zip-test.py
   ```

4. To fetch a new snapshot, run the refresh command.

   ```sh
   python3 scripts/regions/zip-build.py --refresh
   ```

   Refresh replaces the retained inputs and source manifest only after downloading and parsing all sources.
   It then regenerates the outputs.
   Review changed source hashes, counts, exclusions, and provenance before integrating the new data.
   The acceptance tests pin the reviewed example coordinates and snapshot counts, so review those expectations if a future source release changes them.

On a macOS Python installation without a configured CA bundle, use the system bundle.
Do not disable certificate verification.

```sh
SSL_CERT_FILE=/etc/ssl/cert.pem python3 scripts/regions/zip-build.py --refresh
```

To prepare a separate candidate snapshot, pass an absolute output directory.

```sh
python3 scripts/regions/zip-build.py --refresh --output-dir /tmp/harbor-nj-geography
python3 scripts/regions/zip-build.py --check --output-dir /tmp/harbor-nj-geography
```

Only `--refresh` downloads sources.
A missing source, changed source hash, malformed schema, invalid NJ coordinate, missing county relationship, or changed example causes a nonzero exit.
`--check` also fails if any generated output is missing or differs from a fresh offline build.
