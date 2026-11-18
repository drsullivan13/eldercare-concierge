import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ledger = readFileSync("supabase/outreach-requests.sql", "utf8");
const migration = readFileSync("supabase/outreach-handoffs.sql", "utf8");
const digest = () => randomBytes(32).toString("hex");
const ownerId = randomUUID();
const secondOwnerId = randomUUID();
const requestId = randomUUID();
const providerId = "north-jersey-hp-hp1234567";
const secondProviderId = "north-jersey-hp-hp7654321";
const brief = { topics: ["Weekend coverage"], question: "" };

describe(
  "outreach rehearsal handoffs in PostgreSQL",
  { timeout: 60_000 },
  () => {
    let db: PGlite;

    before(async () => {
      db = await PGlite.create();
      await db.exec(`
      create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create role service_role nologin nosuperuser bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
    `);
      await db.exec(ledger);
      await db.exec(migration);
      await db.query("insert into auth.users values ($1), ($2)", [
        ownerId,
        secondOwnerId,
      ]);
    });

    after(async () => {
      await db?.close();
    });

    beforeEach(async () => {
      await db.exec(
        "reset role; truncate public.outreach_requests cascade; set role service_role",
      );
      await db.query("select public.create_outreach_request($1,$2,$3,$4)", [
        ownerId,
        requestId,
        providerId,
        brief,
      ]);
    });

    async function rpc<T>(call: string, args: unknown[]) {
      const result = await db.query<{ result: T }>(
        `select public.${call} as result`,
        args,
      );
      return result.rows[0].result;
    }

    function issue(token = digest(), owner: string = ownerId) {
      return rpc<{ expiresAt: string } | null>(
        "issue_outreach_handoff($1,$2,$3)",
        [owner, requestId, token],
      );
    }

    function exchange(
      token: string | null,
      runId: string | null,
      runKey: string | null,
    ) {
      return rpc("exchange_outreach_handoff($1,$2,$3)", [token, runId, runKey]);
    }

    function authorize(runId: string, runKey: string) {
      return rpc("authorize_outreach_run($1,$2)", [runId, runKey]);
    }

    test("only the service role can use the RPCs and API roles cannot read credentials", async () => {
      const token = digest();
      const runId = randomUUID();
      const runKey = digest();
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`reset role; set role ${role}`);
        await assert.rejects(issue(token), { code: "42501" });
        await assert.rejects(exchange(token, runId, runKey), { code: "42501" });
        await assert.rejects(authorize(runId, runKey), { code: "42501" });
        await assert.rejects(
          db.query("select * from harbor_outreach_handoff.handoffs"),
          {
            code: "42501",
          },
        );
      }
      await db.exec("reset role; set role service_role");
      assert.ok(await issue(token));
      await assert.rejects(
        db.query("select * from harbor_outreach_handoff.handoffs"),
        {
          code: "42501",
        },
      );
      await db.exec("reset role; set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        ownerId,
      ]);
      const { rows } = await db.query<{ event_type: string }>(
        "select event_type from public.outreach_request_events",
      );
      assert.deepEqual(rows, [{ event_type: "requested" }]);
    });

    test("rotation invalidates only the pending token and run authorization survives a later issue", async () => {
      const first = digest();
      const replacement = digest();
      const runId = randomUUID();
      const runKey = digest();
      const grant = await issue(first);
      assert.ok(grant);
      assert.deepEqual(Object.keys(grant), ["expiresAt"]);
      const { rows } = await db.query<{ remaining: number }>(
        "select extract(epoch from ($1::timestamptz - clock_timestamp()))::int remaining",
        [grant.expiresAt],
      );
      assert.ok(rows[0].remaining > 115 && rows[0].remaining <= 120);
      assert.ok(await issue(replacement));
      assert.equal(await exchange(first, runId, runKey), null);
      const expected = { runId, requestId, providerId, brief };
      assert.deepEqual(await exchange(replacement, runId, runKey), expected);
      assert.equal(await exchange(replacement, randomUUID(), digest()), null);
      assert.ok(await issue());
      assert.deepEqual(await authorize(runId, runKey), expected);
      assert.equal(await authorize(randomUUID(), runKey), null);
      assert.equal(await authorize(runId, replacement), null);
    });

    test("binds issuance to the composite owner and request identity", async () => {
      const token = digest();
      const otherToken = digest();
      assert.equal(await issue(token, secondOwnerId), null);
      await db.query("select public.create_outreach_request($1,$2,$3,$4)", [
        secondOwnerId,
        requestId,
        secondProviderId,
        brief,
      ]);
      assert.ok(await issue(token));
      assert.ok(await issue(otherToken, secondOwnerId));
      const firstRunId = randomUUID();
      const secondRunId = randomUUID();
      const firstKey = digest();
      const secondKey = digest();
      assert.deepEqual(await exchange(token, firstRunId, firstKey), {
        runId: firstRunId,
        requestId,
        providerId,
        brief,
      });
      assert.deepEqual(await exchange(otherToken, secondRunId, secondKey), {
        runId: secondRunId,
        requestId,
        providerId: secondProviderId,
        brief,
      });
      assert.equal(await authorize(firstRunId, secondKey), null);
    });

    test("rejects malformed and expired handoffs and expires run credentials", async () => {
      const token = digest();
      const runId = randomUUID();
      const runKey = digest();
      assert.equal(await issue("invalid"), null);
      assert.ok(await issue(token));
      assert.equal(await exchange(null, runId, runKey), null);
      assert.equal(await exchange(token, null, runKey), null);
      assert.equal(await exchange(token, runId, "invalid"), null);
      assert.equal(await exchange(token, runId, token), null);
      assert.equal(await exchange(digest(), runId, runKey), null);

      await db.exec(
        "reset role; update harbor_outreach_handoff.handoffs set expires_at = clock_timestamp() - interval '1 second'; set role service_role",
      );
      assert.equal(await exchange(token, runId, runKey), null);

      const freshToken = digest();
      assert.ok(await issue(freshToken));
      assert.ok(await exchange(freshToken, runId, runKey));
      await db.exec("reset role");
      const { rows } = await db.query<{ expiry: number }>(
        "select extract(epoch from (run_expires_at - consumed_at))::int expiry from harbor_outreach_handoff.handoffs",
      );
      assert.deepEqual(rows, [{ expiry: 3600 }]);
      await db.exec(
        "update harbor_outreach_handoff.handoffs set run_expires_at = clock_timestamp() - interval '1 second'; set role service_role",
      );
      assert.equal(await authorize(runId, runKey), null);
    });

    test("rollbacks and run credential collisions preserve the pending grant", async () => {
      const token = digest();
      const runId = randomUUID();
      const runKey = digest();
      assert.ok(await issue(token));
      await db.exec("begin");
      try {
        assert.ok(await exchange(token, runId, runKey));
      } finally {
        await db.exec("rollback");
      }
      assert.equal(await authorize(runId, runKey), null);
      assert.ok(await exchange(token, runId, runKey));

      const nextToken = digest();
      assert.ok(await issue(nextToken));
      assert.equal(await issue(token), null);
      assert.equal(await exchange(nextToken, runId, digest()), null);
      assert.equal(await exchange(nextToken, randomUUID(), runKey), null);
      assert.ok(await exchange(nextToken, randomUUID(), digest()));
    });

    test("removing the request revokes its rehearsal credential", async () => {
      const token = digest();
      const runId = randomUUID();
      const runKey = digest();
      assert.ok(await issue(token));
      assert.ok(await exchange(token, runId, runKey));
      await db.exec("reset role");
      await db.query(
        "delete from public.outreach_requests where owner_id = $1 and request_id = $2",
        [ownerId, requestId],
      );
      await db.exec("set role service_role");
      assert.equal(await authorize(runId, runKey), null);
      assert.equal(await issue(), null);
    });
  },
);
