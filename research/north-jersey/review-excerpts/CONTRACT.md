# Releasing original review excerpts

The North Jersey release joins each public review page to an approved provider and care unit. The observations file records every review visible on each retained page, including excluded rows. A page on MyLivingChoice can carry Google reviews. The underlying Google review ID identifies the account across copies.

The source-checks manifest binds each page receipt and the observations file by SHA-256. Each receipt identifies the location, original publication date and its precision, review URL, original body hash and approved short excerpt. Excluded rows retain their disposition. Full review bodies and author names stay outside the shared release. The reviewed.json file separately supplies provider-selected testimonials and outbound review links.

The release selects the newest eligible excerpt for each observed sentiment per provider. A displayed quotation and its editorial summary have distinct fields. The score also receives the eligible observations from the full visible page before excerpt selection. Its date and eligibility rules are documented in the experience score methodology. A visible page can contain just five of hundreds of reported reviews.

From the Harbor checkout with its supported Node version:

```sh
python3 -B scripts/regions/release-reviews.py --check
python3 -B scripts/regions/normalize-nj.py --check
python3 -B scripts/regions/build-region.py --check
```

A machine with the original local acquisition archive can verify that every public receipt reproduces the source HTML and original fetch evidence:

```sh
python3 -B scripts/regions/release-reviews.py --check --audit-private-captures
```
