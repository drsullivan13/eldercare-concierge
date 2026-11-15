# External home-care review destinations

Harbor links families directly to office-specific review profiles. The evidence records pair local office identifiers and addresses with search metadata or links published by the agency. Links do not create review counts, first-person testimony or additional independent scoring sources.

Run `python3 research/north-jersey/home-care-review-links/validate.py` to check the branch matches, coverage and exact public projection against retained evidence. To regenerate the compact portal input after a reviewed change, use `--write-portal`. The survey links use an exact office and a dated identity record. Some survey publishers let offices select which feedback appears publicly. These links carry no score weight. Coverage includes the original research batch and the additional office checks. Separate releases cover newly registered offices and independently reviewed consumer accounts.
