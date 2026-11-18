# Pilot coordinator exception report

An authorized operator runs this read-only report with `psql` against an explicitly selected database. It creates no endpoint, database object, grants, or service credentials. Existing database privileges and RLS apply: an owner-scoped connection sees only its permitted rows, and cannot establish pilot-wide coverage. Pilot-wide operations require an already approved operator connection with SELECT access to all four source tables and appropriate existing RLS access. The report does not provision that access. Do not use a browser session or public application credentials.

```sh
psql "$OPERATOR_DATABASE_URL" -X --set=ON_ERROR_STOP=1 \
  --set=as_of='2026-11-18T15:00:00Z' --set=page_size=100 --set=page_offset=0 \
  --file=scripts/pilot-coordinator-report.sql
```

Supply a fixed UTC `as_of` for repeatable time boundaries; default is transaction time. Use a read replica or approved snapshot when a stable multi-page export is required: separate invocations can observe concurrent source changes even with the same cutoff. Default page size is 100, clamped to 1–1000; offset is clamped to zero. Increase offset by page size until `row_number` reaches `total_rows`. Empty output means no visible remaining rows. For accessible output without a terminal pager, add `--pset=pager=off --csv` and read the header-labelled CSV in an approved local tool. No rows are silently capped: every visible exception is reachable with offset paging.

Callbacks are open human-reported promises strictly before the cutoff, joined using both owner and request IDs. A due time exactly at cutoff is not overdue. Unknown bookings require reconciliation, not a new booking. Invitations include explicit review, ready for guarded retry, and sending leases aged at least 30 seconds; sending attempts aged at least 23 hours require manual review, matching the claim guard. Accepted and fresh sending rows are excluded. Invitation exceptions are retained even for past bookings so uncertain invitation state can be reviewed; they do not imply attendance, absence, or failed delivery. No send, retry, completion, or other state mutation occurs.

Only opaque record IDs/keys, provider IDs, times, exception meaning and next action are projected, plus row counts for paging. Notes, briefs, names, contacts, transport IDs, and owner/user IDs are excluded. The opaque callback key distinguishes identical follow-up IDs belonging to different owners. Internal owner sorting resolves collisions deterministically. These remain sensitive operational records: keep output within the approved pilot access boundary. Resolve the opaque IDs through existing authorized operator tooling; this report is not a family contact directory.

Local verification: `node --import tsx --test tests/pilot-coordinator-report.test.ts` (requires installed project dependencies). Tests use isolated in-memory PostgreSQL through PGlite, never a live database.
