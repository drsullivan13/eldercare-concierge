# Official NPPES organization identifiers

The release contains 254 verified organization identifiers. Each accepted office has a separate exact-number response, a matched practice location, and a legal or corroborated trade name. Phone matching compares the base business number and preserves the state-listed contact string, including any extension. The indicator describes organizational identity. A taxonomy, billing number or directory entry alone cannot establish offered care, availability or payment coverage.

The application release includes the [accepted branch facts](verified-branch-facts.json), [coverage decisions](coverage.csv), [acquisition totals](report.json), discovery receipt headers cited by accepted records, and the underlying successful exact-number responses used by the application tests. The full frozen acquisition, including unmatched responses, remains in the research checkout.

Run the release and verify its source boundaries from the repository root.

```sh
node --import tsx scripts/release-home-care-office-identifiers.ts --check
node --import tsx --test tests/home-care-office-identifiers.test.ts
python3 -B research/north-jersey/home-care-nppes/test_homecare_nppes.py
```

To repeat discovery against a new roster, use a new acquisition directory. The harvest stores its source hashes, receipts, response bytes and query plan there. Regenerating the final release requires auditing differences against the frozen office roster.

```sh
python3 -B scripts/regions/homecare-nppes.py collect --output /tmp/harbor-new-nppes-acquisition
python3 -B scripts/regions/homecare-nppes.py build --output /tmp/harbor-new-nppes-acquisition
python3 -B scripts/regions/homecare-nppes.py check --output /tmp/harbor-new-nppes-acquisition
```
