# Research collection

Harbor now has a private collection service in Supabase. It tracks the 521 catalog records, fetches selected CMS sources, and records what happened on each attempt. New observations enter a review queue. The public dashboard continues to use its reviewed research snapshot.

## Current coverage

| Source                  | What runs                                                                                                                                          | What the result means                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| CMS                     | Daily checks of five dataset metadata records, two reporting-period datasets, and survey/clinical records for seven certified home-health agencies | A dated official source observation. A changed response needs review before it replaces published evidence.         |
| Yelp Places             | Paused; the three-location evaluation is complete                                                                                                  | Listing identity and API capability only. No Yelp ratings, review text or reviewer profiles are retained or scored. |
| Facebook                | Validation of collector-supplied CSV batches                                                                                                       | Local private staging, with every row pending review. This is not a Facebook API feed or automatic database import. |
| Existing public reviews | Coverage records for all 521 locations, including the 17 with reviewed aggregate evidence                                                          | A record of the current manual snapshot, not a claim that all sources were searched.                                |

The registry has 1,577 provider/source coverage rows: three tracks per location, plus 14 CMS agency records. That count is not a count of reviews. The nursing-home metadata check detects a source release; it does not yet refresh all 280 nursing-home records. No Google, Reddit, X or licensed full-text review connector is active.

## Processing and publication

The scheduler wakes every 15 minutes. Enabled recurring sources receive one job per UTC day. Each worker handles at most three jobs, claims one at a time, and stops starting work after 65 seconds. A five-minute lease and an atomic database claim prevent two workers from completing the same attempt. Failed network calls can retry; missing access and unresolved identities stop for review. Four attempts is the maximum per job.

CMS responses are bounded to 1 MB and stored with a SHA-256 digest of the retrieved text. The database verifies the digest. An identical response records an unchanged attempt without creating another snapshot or review candidate. Dataset IDs and agency certification numbers are checked before acceptance. A malformed or unexpectedly broad response fails closed.

Jobs, attempts, coverage, snapshots, review candidates and daily request budgets live in the private `harbor_research` schema. The app's anonymous and authenticated roles have no access. Backend RPCs use the server role; no service key is shipped to Vercel or browser code.

There is no automatic publication step. A reviewer must confirm the provider/unit match, reporting period, source changes and interpretation before updating the curated inputs in `src/data/inputs/`. Rebuild the derived application data and run the relevant data/scoring tests after that review. Selected comments, allegations and provider testimonials do not become numerical ratings.

## Credentials and scheduling

`YELP_API_KEY` and `YELP_CLIENT_ID` are stored in Supabase Edge Function secrets. The API key authenticates Yelp requests; the client ID is recorded only as configured/not configured in the worker's status check. Credential values are never returned or logged. Keep them out of Git, chat, source configuration and any `NEXT_PUBLIC_` environment variable.

The Edge Function performs its own authentication, so its gateway JWT check is off. An operator-only database function creates a random single-use ticket, retains only its hash, and sends the ticket to the fixed worker URL. The worker hashes the presented ticket and atomically consumes it through a service-only RPC. A ticket expires after two minutes and is bound to either `run` or `status`. Replay, expiry and a different operation are rejected.

This design accounts for a hosted Supabase constraint: `pg_net` request headers are readable by database roles while queued, and the project `postgres` role cannot revoke those platform-owned grants. No Yelp key, project key or reusable worker secret is sent through that queue. A database role that can read a live ticket could still race the intended request once during its short lifetime. The bound operation, one-time consumption and shared request limits constrain that risk; they do not make the queue confidential. Keep `net` outside the exposed Data API schemas and do not add a public SQL proxy. See [Supabase's queue permission explanation](https://supabase.com/kb/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357).

Yelp collection is paused under the free-sources-only plan: all 521 Yelp sources are disabled, including the three previously evaluated locations. The registry generator also defaults Yelp to disabled. Existing evaluation results are retained. CMS collection remains active. Daily request ceilings in the code are 25 for Yelp if explicitly re-enabled and 1,000 for CMS; a configured ceiling does not enable a source or authorize paid access. Each HTTP attempt reserves its allowance before sending. A failed lookup never means that a provider has no reviews or poor care.

## Reproduce the setup

Use a dedicated project and inspect it before applying SQL. The files are ordered migrations, not a script to run repeatedly over an existing database.

1. Apply `supabase/research-pipeline.sql`, then `supabase/research-indexes.sql`.
2. Apply `supabase/research-scheduling.sql`, then `supabase/research-worker-tickets.sql`.
3. For another project, change the fixed worker origin in the ticket migration to that project's origin before applying it.
4. Run `python scripts/prepare-research-registry.py`. Inspect and apply the generated `artifacts/research-registry-seed.sql`. Existing rows are preserved; this seed does not update an existing registry when the catalog changes.
5. CMS needs no key. Yelp secrets are optional and do not enable its paused sources; revisit access and budget before activating them.
6. Deploy `research-collector` from `supabase/functions/research-collector/index.ts`, including its `deno.json`, `deno.lock` and `../_shared/research-collectors.ts`. Disable gateway JWT verification only because the handler enforces the ticket protocol.
7. Invoke `status` and `run` as a database operator. Check their HTTP responses and database outcomes; dispatch success alone does not prove that collection succeeded.
8. Apply `supabase/enable-research-schedule.sql` after those checks.

The Edge dependency is pinned. Check it separately from Next.js:

```sh
npx --yes deno@2.9.6 check --config supabase/functions/research-collector/deno.json supabase/functions/research-collector/index.ts
npm test
npm run lint
npm run build
```

## Operate it

These queries are for a trusted database operator. They return status, not credentials:

```sql
select public.harbor_research_status();
select connector, budget_day, used, request_limit
from harbor_research.daily_budgets order by budget_day desc;

select harbor_research.invoke_worker('status');
-- The returned request ID is asynchronous. Check it after dispatch:
select id, status_code, error_msg, content
from net._http_response order by id desc limit 5;

select source_key, provider_id, status, attempt, run_after
from harbor_research.jobs where status in ('retry','blocked','failed');

select jobname, schedule, active from cron.job;
select status, start_time, end_time, return_message
from cron.job_run_details order by start_time desc limit 5;
```

To pause the scheduler, use `cron.alter_job` with the job ID returned by the preceding query and `active := false`. Re-enable with `active := true`. To stop one source, set its `enabled` flag to false; claiming and completing work both check that flag. Review the source and cause before enqueueing a new job with a new dedupe key. Do not clear failure history or turn no-match results into empty reviews.

There is no operations UI or external failure notification yet. The SQL status and review queue are the current operating interface. Monitor failures and pending review volume before expanding the registry or adding paid feeds. Facebook import details are in [research-import.md](research-import.md); source access requirements and a vendor inquiry draft are in [data-access.md](data-access.md).
