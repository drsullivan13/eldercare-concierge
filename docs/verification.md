# Verification record

The user flow is landing/signup → personal or explicitly local demo workspace → ZIP/radius search → actual provider evidence → shortlist/comparison/notes → coordination tasks → persisted reload.

## Latest check results · November 12, 2026

- Production build and ESLint: pass.
- 32 data, input-validation and actual local SQL tests: pass.
- 18 desktop/mobile browser scenarios: pass, including the added campus and failed-storage cases. The inspection assertions were updated for the new source-derived severity explanation and rechecked on both sizes.
- Twelve public/dashboard accessibility checks plus eight scrolled evidence, comparison and map states: no violations returned after contrast fixes.
- Production dependency audit: no known vulnerabilities reported.
- Catalog normalization and retained inspection-source rebuild: byte-identical.

## Completed locally

- Production compilation and TypeScript checking.
- ESLint across the application and tests.
- Geographic checks using actual published ZIP/provider coordinates; malformed, unknown, out-of-state and out-of-pilot ZIP handling; radius enforcement and deterministic order.
- Care-category separation, missing/zero preservation and nursing-only CMS sorting.
- Campus identities remain separate from licensed care units. No campus CMS rating is inferred. Two approximate campus points use the exact published Census ZIP values with explicit labels.
- Bounded inspection APIs use real CMS records, preserve dates and codes, sort newest first and distinguish absent data from a published zero.
- Workspace validation rejects forged ownership, malformed dates, unsupported statuses, duplicate IDs, prototype keys and oversized input.
- Callback redirects remain on the current app origin. Same-origin writes are accepted at the origin gate; cross-site writes are rejected.
- Desktop (1440 px) and mobile (390 px) browser flows exercise actual API results, maps, saves, comparison, notes, tasks, reloads, failed requests and inspection pagination.
- Automated axe checks cover public pages, the dashboard, search, details, planning and dialogs. Automated checks complement manual visual review; they do not constitute an accessibility certification.

### Actual SQL access-control tests

`tests/rls.test.ts` executes `supabase/schema.sql` in PGlite's PostgreSQL engine. It creates only test `auth.users`, an `auth.uid()` harness and the expected roles, then changes to a role without superuser/BYPASSRLS privileges. It asserts that row-level security is active before testing owner CRUD, foreign reads/writes, owner reassignment, anonymous access, size constraints and foreign-key behavior.

These are real local database checks. They do not validate a Supabase project's JWTs, settings, grants, email delivery, session lifecycle or deployed endpoints.

## Required after connecting a dedicated Supabase project

1. Inspect the selected project's existing schema, apply the reviewed schema, and run its security advisors.
2. Create two controlled test accounts through the actual email-confirmation flow. Confirm delivery, canonical callback origin, login, logout and expired-link behavior.
3. Save different shortlists/notes/tasks for both users, reload and sign in from a second browser. Verify account isolation through both the app API and direct authenticated Data API.
4. Attempt foreign-owner insert, update, delete and owner reassignment with ordinary user tokens. Verify failures without privileged credentials.
5. Inspect production response headers and ensure personal pages/API responses are not publicly cached.
6. Interrupt a save, show a visible error, retry successfully, and verify the stored value. Confirm that pending saves prevent sign-out until completed.
7. Check that demo data stays in its separate local-storage key and is not silently imported into an account.
8. Test password recovery and account deletion workflows before a broader public launch; these are not implemented in the POC UI.

## Hosting status

No remote repository or Vercel deployment has been created. GitHub's current integration rejected repository creation; Vercel requires a team-specific access grant. Supabase has two connected organizations and the requested selection is pending. The app has been tested locally while those access requirements remain unresolved.

Do not describe the current demo as a deployed, independently vetted care service or a live account system.
