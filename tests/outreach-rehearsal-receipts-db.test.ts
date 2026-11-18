import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = randomUUID();
const otherOwner = randomUUID();
const request = randomUUID();
const digest = () => randomBytes(32).toString("hex");
const outcome = {
  status: "completed",
  takeaways: ["Ask about weekend coverage"],
  nextSteps: ["Confirm scheduling with the provider"],
};

describe(
  "bounded rehearsal receipts in PostgreSQL",
  { timeout: 60_000 },
  () => {
    let db: PGlite;
    let run: string;
    let key: string;
    async function record(
      value: unknown = outcome,
      runId = run,
      runKey: string | null = key,
    ) {
      const result = await db.query<{ receipt: unknown }>(
        "select public.record_outreach_rehearsal_receipt($1,$2,$3) receipt",
        [runId, runKey, value],
      );
      return result.rows[0].receipt;
    }
    async function launch() {
      const token = digest();
      const runId = randomUUID();
      const runKey = digest();
      await db.query("select public.issue_outreach_handoff($1,$2,$3)", [
        owner,
        request,
        token,
      ]);
      await db.query("select public.exchange_outreach_handoff($1,$2,$3)", [
        token,
        runId,
        runKey,
      ]);
      return { runId, runKey };
    }
    before(async () => {
      db = await PGlite.create();
      await db.exec(`
      create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create role service_role nologin nosuperuser bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
    `);
      for (const file of [
        "outreach-requests",
        "outreach-handoffs",
        "outreach-rehearsal-receipts",
      ]) {
        await db.exec(readFileSync(`supabase/${file}.sql`, "utf8"));
      }
      await db.query("insert into auth.users values ($1),($2)", [
        owner,
        otherOwner,
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
        owner,
        request,
        "north-jersey-hp-hp1234567",
        { topics: ["Weekend coverage"], question: "" },
      ]);
      const launched = await launch();
      run = launched.runId;
      key = launched.runKey;
    });
    test("records one terminal receipt per run and permits further rehearsals", async () => {
      const first = await record();
      assert.ok(first);
      assert.deepEqual(await record(), first);
      await assert.rejects(record({ ...outcome, status: "failed" }), {
        code: "23505",
      });
      const next = await launch();
      assert.ok(
        await record(
          { status: "failed", takeaways: [], nextSteps: [] },
          next.runId,
          next.runKey,
        ),
      );
      await db.exec("reset role");
      assert.deepEqual(
        (await db.query("select status from public.outreach_requests")).rows,
        [{ status: "requested" }],
      );
      assert.equal(
        (await db.query("select * from public.outreach_rehearsal_receipts"))
          .rows.length,
        2,
      );
      assert.equal(
        (await db.query("select * from public.outreach_request_events")).rows
          .length,
        1,
      );
    });
    test("rejects malformed, oversized and unstructured outcomes", async () => {
      for (const value of [
        null,
        [],
        {},
        { ...outcome, status: "requested" },
        { ...outcome, transcript: "raw" },
        { ...outcome, token: "raw" },
        { ...outcome, takeaways: null },
        { ...outcome, takeaways: [["nested"]] },
        { ...outcome, nextSteps: [7] },
        { ...outcome, takeaways: [" "] },
        { ...outcome, nextSteps: ["x".repeat(241)] },
        { ...outcome, takeaways: Array(7).fill("item") },
        {
          ...outcome,
          takeaways: Array(6).fill("😀".repeat(240)),
          nextSteps: Array(6).fill("😀".repeat(240)),
        },
      ]) {
        await assert.rejects(record(value), (error: unknown) =>
          ["23502", "23514"].includes((error as { code: string }).code),
        );
      }
      assert.ok(
        await record({
          status: "completed",
          takeaways: Array(6).fill("x".repeat(240)),
          nextSteps: Array(6).fill("y".repeat(240)),
        }),
      );
    });
    test("requires the correct live run credential even for retries", async () => {
      for (const bad of [null, "invalid", digest()])
        assert.equal(await record(outcome, run, bad), null);
      assert.equal(await record(outcome, randomUUID(), key), null);
      assert.ok(await record());
      await db.exec(
        "reset role; update harbor_outreach_handoff.handoffs set run_expires_at = clock_timestamp() - interval '1 second'; set role service_role",
      );
      assert.equal(await record(), null);
      const fresh = await launch();
      await db.exec(
        "reset role; update harbor_outreach_handoff.handoffs set run_expires_at = clock_timestamp() - interval '1 second'; set role service_role",
      );
      assert.equal(await record(outcome, fresh.runId, fresh.runKey), null);
    });
    test("allows only the owner to read and only the RPC to write", async () => {
      await record();
      await assert.rejects(
        db.query("select * from public.outreach_rehearsal_receipts"),
        { code: "42501" },
      );
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`reset role; set role ${role}`);
        await assert.rejects(record(), { code: "42501" });
        await assert.rejects(
          db.query("delete from public.outreach_rehearsal_receipts"),
          { code: "42501" },
        );
      }
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        otherOwner,
      ]);
      assert.deepEqual(
        (await db.query("select * from public.outreach_rehearsal_receipts"))
          .rows,
        [],
      );
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        owner,
      ]);
      const rows = (
        await db.query<{ outcome: unknown }>(
          "select * from public.outreach_rehearsal_receipts",
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].outcome, outcome);
      assert.deepEqual(Object.keys(rows[0]).sort(), [
        "created_at",
        "outcome",
        "owner_id",
        "request_id",
        "run_id",
      ]);
      await db.exec("reset role");
      await db.query(
        "delete from harbor_outreach_handoff.handoffs where run_id=$1",
        [run],
      );
      assert.equal(
        (await db.query("select * from public.outreach_rehearsal_receipts"))
          .rows.length,
        1,
      );
      await db.exec("set role service_role");
      assert.equal(await record(), null);
      await db.exec("reset role");
      await db.query("delete from public.outreach_requests where owner_id=$1", [
        owner,
      ]);
      assert.equal(
        (await db.query("select * from public.outreach_rehearsal_receipts"))
          .rows.length,
        0,
      );
    });
  },
);
