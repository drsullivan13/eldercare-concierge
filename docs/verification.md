# Verification record

The dated sections below preserve historical demo and research-service results. Their descriptions of deferred accounts are not current setup instructions. Hosted builds with `NEXT_PUBLIC_ENABLE_ACCOUNTS=true` and the public Supabase values use sign-in and save each plan to the user's own Supabase row. The explicit local demo at `/dashboard?demo=1` needs no sign-in and stores its plan in the browser. This record has no hosted result yet for email delivery, the confirmation callback, session refresh or two-user isolation.

## Code and interface cleanup · November 12, 2026

- Final application commit: `8be6a78d6a111cc552acd85f3ab1c61c5360704f`. Vercel deployment `dpl_3BusZxYvBsWnNAde9imKqGZbNSac` reached READY in the existing production project, with deployment protection preserved.
- Production build, TypeScript, ESLint and Knip passed. All 115 data, domain, rebuild and local PostgreSQL tests passed. Knip reports no unused dependencies; unused declarations were removed or made private, and standalone tools remain explicit entrypoints.
- [GitHub CI run 43229808816](https://github.com/drsullivan13/eldercare-concierge/actions/runs/43229808816) passed on the final application commit, including the complete unit and browser suites.
- The complete 44-scenario desktop/mobile browser suite passed again after the final CSS removal. It covers search, maps, comparison, evidence, notes, tasks, storage failures and request recovery. New regressions verify visible care alerts and complete plan downloads when saved-provider lookup fails.
- Twelve page/dialog axe scans returned zero violations after the final style changes. The browser suite also checks five Facebook states on each viewport. Final visual review covered desktop and mobile layouts, sources, reviews and untruncated care alerts. A final hosted mobile check verified 13px phone/action text, a single-result label, provider saving and the sourced score.
- Hosted verification passed at **13:43 UTC** against that application commit: 521 catalog records, 122 scores, 399 unrated records, 22 Facebook coverage entities, findings at ten locations, the 521-row CSV, category/radius search, inspection/home-health endpoints, expanded Facebook findings, shortlist save/reload, downloaded plan and old account redirects. Anonymous workspace access remained denied. No horizontal mobile overflow or uncaught browser errors occurred.
- The deployment-scoped error/fatal log query at 13:43 UTC returned no matching logs in the preceding ten minutes. This is a release check, not continuous monitoring.
- Retained research and generated data files are byte-identical to baseline `c45b6d1`. Python formatting preserved rebuild behavior; the home-health rebuild now rejects mismatched comparator metadata, measures and footnotes before writing output.

The [code review](code-review-2026-11-12.md) records the independent standards and requirements reviews, resolved findings and bounded follow-up candidates. The [architecture map](architecture.md) describes the resulting modules. Current screenshots are in `docs/screenshots/`; local acceptance reports are in `artifacts/`.

## Facebook and score expansion · November 12, 2026

- Production build and TypeScript: pass, including the final plain-language Facebook copy. ESLint: pass.
- All 110 data, API, scoring, import, collection and actual local PostgreSQL tests passed. The four Facebook tests passed again after the copy edit.
- All 40 desktop/mobile browser scenarios passed: 34 existing flows plus six Facebook/coverage cases. The new cases exercise live local APIs, finding filters, keyboard expansion, source links, distinct missing states, the geographic filters and the 521-row CSV download.
- Scoped axe checks returned zero violations across five Facebook states on desktop/mobile. Expanded findings screenshots were visually inspected; neither viewport had horizontal overflow. A duplicate-name test selector was corrected to distinguish a campus from its separate assisted-living unit; no application behavior was changed for that test fix.
- Independently reviewed frozen research inputs produce 122 numerical scores, all with limited source coverage. Known wrong-unit, industry-mixed, snippet-only and syndicated populations remain excluded. The same source-family rules and ten-review threshold apply.
- The Facebook projection contains 31 findings from 39 observations across ten locations, with 32 observations withheld and coverage for 22 entities. The original importer still treats all 71 raw observations as pending; the separate [publication audit](facebook-publication.md) records the editorial projection and its limits.
- Eight provider-confirmed address corrections were applied to both the local catalog and private Supabase registry. The database check confirmed zero enabled Yelp sources afterward.
- Hosted smoke check passed at 12:49 UTC on application commit `498fafaf14200b83bd8854bf522250b0258cacdf`, deployment `dpl_EJSYqBMBpowjkqu6XeN4xDvwsABT`, through the existing protected production alias. It verified 122 scores, 399 unrated records, 22 Facebook coverage entities, findings at ten locations, expanded source-linked findings, the 521-row CSV, geographic/category sorting, old account redirects, local save/reload, anonymous workspace denial and mobile layout. No uncaught browser errors occurred; the deployment error/fatal log query returned no matching logs. The local evidence is `artifacts/hosted-smoke.json`.

## Earlier baseline checks · November 12, 2026

- Production build and ESLint: pass.
- 102 data, scoring, import, collection, worker-ticket, input-validation and actual local SQL tests: pass.
- 34 desktop/mobile browser scenarios: pass, including direct entry without sign-in, old account URLs redirecting to the local workspace, real evidence, save/reload, research filters, review scores, pricing periods, future effective dates and failed-request recovery.
- Eight additional research-tab accessibility states: no violations returned. The close control remains visible after scrolling long details; desktop and mobile screenshots were visually reviewed.
- Twelve public/dashboard accessibility checks plus eight scrolled evidence, comparison and map states: no violations returned after contrast fixes.
- Production dependency audit: no known vulnerabilities reported.
- Catalog, inspection and home-health evidence rebuilds: byte-identical.
- Hosted Vercel smoke check: pass at 10:52 UTC. Direct dashboard access, 521-record catalog, 57 nursing-home results within 10 miles of 02459, inspection and home-health endpoints, shortlist save/reload, legacy account redirects, mobile layout and anonymous workspace denial all passed with no uncaught browser errors. The research endpoint returned Brooksby's 7.4/10 score, 44 reported reviews and published waitlist; category sorting and Sunrise's review/price tabs also passed. The local report is `artifacts/hosted-smoke.json`.
- Location-research snapshot rebuild: byte-identical. All six numerical scores in that earlier snapshot had limited evidence.

## Completed locally

- Production compilation and TypeScript checking.
- ESLint across the application and tests.
- Geographic checks using actual published ZIP/provider coordinates; malformed, unknown, out-of-state and out-of-pilot ZIP handling; radius enforcement and deterministic order.
- Care-category separation, missing/zero preservation and nursing-only CMS sorting.
- Campus identities remain separate from licensed care units. No campus CMS rating is inferred. Two approximate campus points use the exact published Census ZIP values with explicit labels.
- Bounded inspection APIs use real CMS records, preserve dates and codes, sort newest first and distinguish absent data from a published zero.
- Location research validates exact catalog identities and linked sources. Tests cover score eligibility, source deduplication, stale evidence, exclusion of snippets/ambiguous populations, missing prices, availability status and retry behavior. Selected review excerpts cannot alter numerical scores.
- Home-health evidence preserves seven exact agency identities, clinical half stars, five survey measures, seven clinical measures and actual reporting periods. VNA's two agency results remain separate. Synthetic missing values, long footnotes, stale responses and retry states were also checked in the browser.
- Workspace validation rejects forged ownership, malformed dates, unsupported statuses, duplicate IDs, prototype keys and oversized input.
- Callback redirects remain on the current app origin. Same-origin writes are accepted at the origin gate; cross-site writes are rejected.
- Desktop (1440 px) and mobile (390 px) browser flows exercise actual API results, maps, saves, comparison, notes, tasks, reloads, failed requests and inspection pagination.
- Automated axe checks cover public pages, the dashboard, search, details, planning and dialogs. Automated checks complement manual visual review; they do not constitute an accessibility certification.

### Actual SQL access-control tests

`tests/rls.test.ts` executes `supabase/schema.sql` in PGlite's PostgreSQL engine. It creates only test `auth.users`, an `auth.uid()` harness and the expected roles, then changes to a role without superuser/BYPASSRLS privileges. It asserts that row-level security is active before testing owner CRUD, foreign reads/writes, owner reassignment, anonymous access, size constraints and foreign-key behavior.

These are real local database checks. They include a regression against broad default table privileges: authenticated users cannot TRUNCATE the table. They do not validate a Supabase project's JWTs, email delivery or session lifecycle.

## Required before activating accounts

1. Inspect the selected project's existing schema, apply the reviewed schema, and run its security advisors.
2. Create two controlled test accounts through the actual email-confirmation flow. Confirm delivery, canonical callback origin, login, logout and expired-link behavior.
3. Save different shortlists/notes/tasks for both users, reload and sign in from a second browser. Verify account isolation through both the app API and direct authenticated Data API.
4. Attempt foreign-owner insert, update, delete and owner reassignment with ordinary user tokens. Verify failures without privileged credentials.
5. Inspect production response headers and ensure personal pages/API responses are not publicly cached.
6. Interrupt a save, show a visible error, retry successfully, and verify the stored value. Confirm that pending saves prevent sign-out until completed.
7. Check that demo data stays in its separate local-storage key and is not silently imported into an account.
8. Test password recovery and account deletion workflows before a broader public launch; these are not implemented in the POC UI.

## Hosting status

Source is published at [drsullivan13/eldercare-concierge](https://github.com/drsullivan13/eldercare-concierge). The Vercel project is `eldercare-concierge`, with alias `https://eldercare-concierge-one.vercel.app`; deployment protection remains enabled. An earlier application commit, `53339fc`, deployed successfully as `dpl_DVke2nLQMWk21Z5gswGkwFsyib1B` (production, READY, Next.js, approximately 28-second build). The earlier hosted browser check passed against that deployment. The newest application check is recorded at the top of this document.

A deployment-scoped runtime scan at 10:52 UTC returned no error/fatal logs in the preceding ten minutes. This is a short verification window. The project has no configured log drains or independent continuous error monitoring.

`scripts/check-hosted.mjs` repeats the hosted smoke test when supplied an authorized preview URL through `HARBOR_PREVIEW_URL`. It uses the browser's actual network path and deployment-access cookie. Its local report stores only the app origin and results, not the share URL or cookies. A Vercel share link grants temporary preview access; it is separate from the deferred Harbor account flow.

The dedicated Supabase project `harbor-eldercare-poc` has the workspace schema and owner policies applied. Workspace grants are restricted to authenticated SELECT/INSERT/UPDATE/DELETE, with no anonymous/PUBLIC table access. At the workspace setup check, security and performance advisors returned no findings. Anonymous workspace REST reads are denied. Only a URL and publishable key are configured in Vercel; the dashboard has no secret/service-role key. The separately deployed research worker uses its platform-injected server credential as described below.

Accounts were intentionally deferred. Before activation, update the Supabase Site URL and allowed callback URLs: the current observed fallback is localhost. Keep confirmation enabled, configure an appropriate mail sender, and verify real signup/session/two-user isolation. None of those deferred steps is required to use the current browser-local POC. No test emails were sent.

Deployment readiness, database access, signup email delivery and provider vetting are separate checks. A hosted demo alone does not establish that the others have been completed.

## Research automation check · November 12, 2026

The dedicated Supabase project has the private research schema, source registry, service-only RPCs and `research-collector` version 2 deployed. The registry contains 521 providers and 1,577 provider/source coverage rows. All 21 initial CMS jobs succeeded and produced 21 source snapshots with 21 pending review candidates. These are baseline observations for review, not 21 newly established changes to care quality.

The worker verified that both Yelp secrets are configured without returning either value. The initial three-location evaluation used five requests: Brooksby matched exactly and its details endpoint worked; its reviews endpoint returned 404. The first two other match requests returned no listing. A subsequent address-format correction strips only an exact known town/state/ZIP suffix from a catalog street address. A bounded follow-up still returned no listing for Sunrise of Newton and Allerton House at Harbor Park, bringing total Yelp usage to seven requests. These outcomes do not establish missing reviews or poor care, and no Yelp review content is stored or scored.

The scheduler itself dispatched the version 2 worker at 12:02 UTC during a temporary one-minute verification interval. Its HTTP response was 200: the CMS repeat returned `unchanged`, both Yelp follow-ups recorded their no-match outcomes, and snapshot/review-candidate counts remained 21. The schedule was then restored and verified as active every 15 minutes. CMS jobs repeat daily; the three Yelp evaluation sources do not. Both dispatch and worker outcomes were checked.

The final authorization design uses operation-bound, single-use tickets with a two-minute lifetime. Both authenticated status and run invocations returned HTTP 200 and consumed their tickets. An unauthenticated call and a fabricated ticket both returned 401. Anonymous REST requests to the `net` and `harbor_research` schemas returned 406 (`PGRST106`); the private status RPC returned 401 (`42501`). Anonymous/authenticated database roles cannot read research data or tickets, consume tickets, or invoke the worker. The server role can consume but cannot mint tickets.

Hosted `pg_net` queue grants cannot be revoked by the project role. The earlier reusable invocation token was removed after replacing it with tickets; neither Yelp credentials nor a project-wide API key passes through that queue. The remaining brief ticket-race risk is documented in the automation guide. Security advisors returned no findings; live privilege checks identified the platform constraint. A performance check identified eight uncovered foreign keys, now indexed in `research-indexes.sql`. New, lightly used indexes may still be reported as unused; that is not a load-test result.

Production compilation, ESLint, all 102 tests and the pinned Deno type check passed. Eight new PostgreSQL ticket tests cover roles, expiry, replay, operation binding, atomic consumption, pruning and rollback with a mocked transport. The rest of the database pipeline tests cover leases, budgets, snapshot hashes and rollback. No UI component changed in this release; the 34 browser scenarios above are the preceding application check, not a fresh run for this backend change.

The Facebook pilot was read from commit `8b9f8eb7` without merging the research branch. Three deterministic coverage-format corrections allowed private staging. All 71 observations remain review-pending and score-ineligible. The [pilot review](facebook-pilot-review.md) records the counts, source/unit inconsistencies, related-event grouping, hashes and corrections. No Facebook sources were independently revisited during this metadata/import review.

## Free-source configuration · November 12, 2026

After the decision to use free sources only, all 521 Yelp source entries were disabled. A live database check confirmed zero enabled Yelp sources and zero running Yelp jobs, with all 21 CMS sources still enabled and the 15-minute scheduler active. The registry generator now defaults Yelp to disabled as well. No Yelp billing or subscription setting was changed.
