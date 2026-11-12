# Verification record

The current user flow is landing → browser-local workspace without sign-in → ZIP/radius search → actual provider evidence → shortlist/comparison/notes → coordination tasks → persisted reload. Accounts are deferred and hidden behind `NEXT_PUBLIC_ENABLE_ACCOUNTS=false`.

## Latest check results · November 12, 2026

- Production build and ESLint: pass.
- 39 data, input-validation and actual local SQL tests: pass.
- 24 desktop/mobile browser scenarios: pass, including direct entry without sign-in, old account URLs redirecting to the local workspace, real evidence, save/reload and failed-request recovery.
- Twelve public/dashboard accessibility checks plus eight scrolled evidence, comparison and map states: no violations returned after contrast fixes.
- Production dependency audit: no known vulnerabilities reported.
- Catalog, inspection and home-health evidence rebuilds: byte-identical.
- Hosted Vercel smoke check: pass at 01:56 UTC. Direct dashboard access, 521-record catalog, 57 nursing-home results within 10 miles of 02459, inspection and home-health endpoints, shortlist save/reload, legacy account redirects, mobile layout and anonymous workspace denial all passed with no uncaught browser errors.

## Completed locally

- Production compilation and TypeScript checking.
- ESLint across the application and tests.
- Geographic checks using actual published ZIP/provider coordinates; malformed, unknown, out-of-state and out-of-pilot ZIP handling; radius enforcement and deterministic order.
- Care-category separation, missing/zero preservation and nursing-only CMS sorting.
- Campus identities remain separate from licensed care units. No campus CMS rating is inferred. Two approximate campus points use the exact published Census ZIP values with explicit labels.
- Bounded inspection APIs use real CMS records, preserve dates and codes, sort newest first and distinguish absent data from a published zero.
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

Source is published at [drsullivan13/eldercare-concierge](https://github.com/drsullivan13/eldercare-concierge). The Vercel project is `eldercare-concierge`, with alias `https://eldercare-concierge-one.vercel.app`; deployment protection remains enabled. Application commit `ab3ef91` deployed successfully as `dpl_C2cJD18CmQKu9QY7xchSC4PCV3Yk`, and the hosted browser check passed. Subsequent documentation/test-script changes do not change application behavior.

`scripts/check-hosted.mjs` repeats the hosted smoke test when supplied an authorized preview URL through `HARBOR_PREVIEW_URL`. It uses the browser's actual network path and deployment-access cookie. Its local report stores only the app origin and results, not the share URL or cookies. A Vercel share link grants temporary preview access; it is separate from the deferred Harbor account flow.

The dedicated Supabase project `harbor-eldercare-poc` has the workspace schema and owner policies applied. Live grants are restricted to authenticated SELECT/INSERT/UPDATE/DELETE, with no anonymous/PUBLIC table access. Security and performance advisors return no findings. Anonymous REST reads are denied. Only a URL and publishable key are configured; the app has no secret/service-role key.

Accounts were intentionally deferred. Before activation, update the Supabase Site URL and allowed callback URLs: the current observed fallback is localhost. Keep confirmation enabled, configure an appropriate mail sender, and verify real signup/session/two-user isolation. None of those deferred steps is required to use the current browser-local POC. No test emails were sent.

Deployment readiness, database access, signup email delivery and provider vetting are separate checks. A hosted demo alone does not establish that the others have been completed.
