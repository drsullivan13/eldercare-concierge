# From a directory to a care research service

The first useful outcome is a shortlist a family can investigate with less repeated work. The next outcome is a decision supported by current records, the parent's preferences and direct checks. Those are different levels of work, and the interface should say which has been completed.

## What this version establishes

A ZIP search, documented provider identity, care-setting-specific public evidence and a place to organize follow-up. CMS nursing-home data adds inspections, staffing, turnover and penalties beyond public review averages. Matched home-health agencies include clinical-quality measures and a separate patient survey, with participation and reporting dates. Massachusetts assisted-living records establish a different kind of regulatory record. Agency service descriptions are attributed to the agency.

The app does not establish live staffing, admission suitability, openings, total cost or individual caregiver competence. No amount of interface polish should turn a source link into a claim that those checks happened.

## Next evidence work

1. **Provider identity.** Keep CCN/state identifiers, street address, operating entity, ownership and individual service divisions separate. Reviews of a brand or another building must not silently transfer to a location. Add reviewed merge/split history when organizations rename, move or change ownership.
2. **Freshness.** Build scheduled source retrieval, checksum and schema checks, record diffs and a human review queue. Publish source date and retrieval date independently. A failed refresh must retain the old date and show stale coverage, not reset a 'verified' badge.
3. **Home-service coverage.** Replace office-radius-only discovery with explicit, dated service-area evidence. Provider-advertised towns, historical CMS patient ZIPs and a confirmed available caregiver at an address are three different assertions. Let users see each separately.
4. **Broader experience evidence.** Add review feeds only with permitted API or licensing access. Preserve platform, location, review date, volume, distribution, response history and known verification limits. Deduplicate syndicated content and repeated brand reviews. Do not equate review count, affluent ZIP codes or an online presence with care quality.
5. **Direct checks.** Record structured calls, references, visit observations and provider responses with consent, the person who performed each check, its scope and date. Show unresolved contradictions. A professional license is distinct from an employment reference, identity check, background check and the ability to perform a specific role.
6. **Staff sourcing.** Begin with credible agency/referral routes and a defined household need. An individual profile needs consent and a separate credentialing process. Do not publish private candidate information or present a recruiting lead as an available, cleared worker.

## Ranking that can be defended

Keep care fit, travel burden, published quality, availability and evidence coverage separate. The current distance and CMS-rating sorts are transparent. A later recommendation system needs a written objective, category-specific inputs, missing-data rules, source-age rules, explicit risk flags and an explanation attached to each result.

Before using a weighted score, evaluate it against independent care-manager reviews across care settings and neighborhoods. Test whether it rewards large online marketing footprints or penalizes providers serving people with higher needs. Preserve severe findings and unresolved discrepancies even when a composite result would otherwise look strong. A family should be able to change priorities without hiding risk evidence.

## Build sequence after the POC

| Milestone                     | Concrete result                                                       | Evidence needed to move on                                                                             |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Hosted personal workspace     | Confirmed signup, reliable email delivery and persistent account data | Two-user RLS test, expiry/sign-out tests, failed-save recovery, database backup/restore check          |
| Research operations           | Refreshable official records and a correction queue                   | Schema-change alarms, identity-match samples, date/coverage checks, visible stale-data behavior        |
| Better home-service discovery | Address/service-area evidence and actual sourcing tasks               | Agency-confirmed coverage, scope-specific reference checks, explicit availability timestamps           |
| Family collaboration          | Invitations, roles, task ownership and shared notes                   | Parent-authority and sharing decisions, row-level access tests, edit conflict handling and audit trail |
| Concierge execution           | Recorded approvals for calls, visits, travel and equipment            | Vendor confirmations, spending limits, receipts, change/cancel handling and human escalation           |

A research note is not permission to book, spend, share medical information or make a care decision. Those actions need explicit scopes and a record of who authorized them when execution is added.
