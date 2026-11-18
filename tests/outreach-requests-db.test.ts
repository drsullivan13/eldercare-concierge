import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const providerId = "north-jersey-hp-hp1234567";
const brief = {
  topics: ["Weekend coverage"],
  question: "Is Saturday available?",
  careZip: "07601",
  timing: "Next month",
  situation: "Help with morning routines",
  scenarioId: "home-care-priya",
};
const migration = readFileSync("supabase/outreach-requests.sql", "utf8");

describe("outreach request ledger in PostgreSQL", { timeout: 30_000 }, () => {
  let db: PGlite;

  before(async () => {
    db = await PGlite.create();
    await db.exec(`
      create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create role service_role nologin nosuperuser bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid
        language sql stable set search_path = ''
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    `);
    await db.exec(migration);
    // Upgrade an existing deployment, and prove the upgrade is rerunnable.
    await db.query("insert into auth.users values ($1)", [ownerA]);
    await db.query(
      "insert into public.outreach_requests(owner_id,request_id,provider_id,brief) values ($1,$2,$3,$4)",
      [ownerA, requestId, providerId, JSON.stringify(brief)],
    );
    const v2Migration = readFileSync("supabase/outreach-brief-v2.sql", "utf8");
    await db.exec(v2Migration);
    await db.exec(v2Migration);
    assert.equal(
      (await db.query("select * from public.outreach_requests")).rows.length,
      1,
    );
  });

  after(async () => {
    if (db) await db.close();
  });

  beforeEach(async () => {
    await db.exec("reset role; truncate auth.users cascade");
    await db.query("insert into auth.users (id) values ($1), ($2)", [
      ownerA,
      ownerB,
    ]);
  });

  async function setRole(
    role: "authenticated" | "anon" | "service_role",
    owner?: string,
  ) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      owner ?? "",
    ]);
    await db.exec(`set role ${role}`);
  }

  async function create(
    owner = ownerA,
    provider = providerId,
    payload: Record<string, unknown> = brief,
  ) {
    const { rows } = await db.query<{
      request: {
        requestId: string;
        providerId: string;
        status: string;
        createdAt: string;
        replayed: boolean;
      };
    }>("select public.create_outreach_request($1,$2,$3,$4) request", [
      owner,
      requestId,
      provider,
      JSON.stringify(payload),
    ]);
    return rows[0].request;
  }

  test("v2 arrays enforce version, bounds, Unicode and controls under the server role", async () => {
    await setRole("service_role");
    for (const payload of [
      {
        ...brief,
        briefVersion: 2,
        knownAnswers: ["😀".repeat(160)],
        outstandingQuestions: ["One\tTwo\nThree\r"],
      },
      { ...brief, briefVersion: 2 },
      { ...brief, briefVersion: 2, knownAnswers: [], outstandingQuestions: [] },
    ]) {
      await create(ownerA, providerId, payload);
      await db.exec(
        "reset role; delete from public.outreach_requests; set role service_role",
      );
    }
    for (const extra of [
      { knownAnswers: [] },
      { briefVersion: 1 },
      { briefVersion: null },
      { briefVersion: 2, knownAnswers: null },
      { briefVersion: 2, knownAnswers: [["nested"]] },
      { briefVersion: 2, knownAnswers: [" "] },
      { briefVersion: 2, knownAnswers: ["\u00a0\ufeff"] },
      { briefVersion: 2, knownAnswers: Array(4).fill("answer") },
      { briefVersion: 2, outstandingQuestions: ["😀".repeat(161)] },
      ...["\u0001", "\u000b", "\u007f", "\u0085"].map((control) => ({
        briefVersion: 2,
        knownAnswers: ["a" + control],
      })),
    ])
      await assert.rejects(create(ownerA, providerId, { ...brief, ...extra }), {
        code: "23514",
      });
  });

  test("creates one ordered event and replays the request without writing", async () => {
    await setRole("service_role");
    const result = await create();
    assert.deepEqual(result, {
      requestId,
      providerId,
      status: "requested",
      createdAt: result.createdAt,
      replayed: false,
    });
    assert.ok(Number.isFinite(Date.parse(result.createdAt)));
    assert.deepEqual(await create(), { ...result, replayed: true });
    await assert.rejects(create(ownerA, "north-jersey-hp-hp7654321"), {
      code: "23505",
    });
    await assert.rejects(
      create(ownerA, providerId, { ...brief, question: "A new question" }),
      { code: "23505" },
    );

    await setRole("authenticated", ownerA);
    const { rows } = await db.query(
      `select sequence, event_type, to_jsonb(created_at) created_at
      from public.outreach_request_events
      where request_id = $1 order by sequence`,
      [requestId],
    );
    assert.deepEqual(rows, [
      { sequence: 1, event_type: "requested", created_at: result.createdAt },
    ]);
  });

  test("owner reads are isolated even when both owners reuse the same request ID", async () => {
    await setRole("service_role");
    await create();
    await create(ownerB, "north-jersey-hp-hp7654321");

    for (const owner of [ownerA, ownerB]) {
      await setRole("authenticated", owner);
      for (const table of ["outreach_requests", "outreach_request_events"]) {
        const result = await db.query(
          `select owner_id, request_id from public.${table} where request_id = $1`,
          [requestId],
        );
        assert.deepEqual(result.rows, [
          { owner_id: owner, request_id: requestId },
        ]);
      }
    }
    await setRole("authenticated");
    assert.deepEqual(
      (await db.query("select * from public.outreach_requests")).rows,
      [],
    );
    assert.deepEqual(
      (await db.query("select * from public.outreach_request_events")).rows,
      [],
    );

    await setRole("anon", ownerA);
    await assert.rejects(db.query("select * from public.outreach_requests"), {
      code: "42501",
    });
    await assert.rejects(
      db.query("select * from public.outreach_request_events"),
      {
        code: "42501",
      },
    );
  });

  test("only the server creates requests and API roles cannot change history", async () => {
    await setRole("service_role");
    await create();
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      await setRole(role, ownerA);
      if (role !== "service_role") {
        await assert.rejects(create(), { code: "42501" });
        await assert.rejects(
          db.exec("insert into public.outreach_requests default values"),
          {
            code: "42501",
          },
        );
      }
      for (const table of ["outreach_requests", "outreach_request_events"]) {
        await assert.rejects(
          db.exec(`update public.${table} set created_at = now()`),
          { code: "42501" },
        );
        await assert.rejects(db.exec(`delete from public.${table}`), {
          code: "42501",
        });
        await assert.rejects(db.exec(`truncate public.${table}`), {
          code: "42501",
        });
      }
      await assert.rejects(
        db.exec("insert into public.outreach_request_events default values"),
        { code: "42501" },
      );
    }
  });

  test("only the bounded brief is accepted and invalid inputs persist no rows", async () => {
    await setRole("service_role");
    for (const invalid of [
      { question: "Hello" },
      { topics: [], question: "  " },
      { ...brief, topics: [["nested"]] },
      { ...brief, topics: [{}] },
      { ...brief, topics: [null] },
      { ...brief, topics: [""] },
      { ...brief, topics: [" \t"] },
      { ...brief, topics: ["x".repeat(81)] },
      { ...brief, topics: Array(7).fill("topic") },
      { ...brief, question: "x".repeat(1001) },
      { ...brief, careZip: 7601 },
      { ...brief, timing: "" },
      { ...brief, situation: "x".repeat(501) },
      { ...brief, scenarioId: "unknown" },
      { ...brief, transcript: "raw transcript" },
      { ...brief, liveSessionToken: "capability" },
    ]) {
      await assert.rejects(create(ownerA, providerId, invalid), {
        code: "23514",
      });
    }
    await assert.rejects(create(ownerA, "unknown"), { code: "23514" });
    await assert.rejects(create("44444444-4444-4444-8444-444444444444"), {
      code: "23503",
    });
    await setRole("authenticated", ownerA);
    assert.deepEqual(
      (await db.query("select * from public.outreach_requests")).rows,
      [],
    );
    assert.deepEqual(
      (await db.query("select * from public.outreach_request_events")).rows,
      [],
    );
  });

  test("a failed event insert rolls back the request and permits a clean retry", async () => {
    await db.exec(`alter table public.outreach_request_events
      add constraint reject_test_event check (event_type <> 'requested')`);
    try {
      await setRole("service_role");
      await assert.rejects(create(), {
        code: "23514",
        constraint: "reject_test_event",
      });
      assert.deepEqual(
        (await db.query("select * from public.outreach_requests")).rows,
        [],
      );
    } finally {
      await db.exec(`reset role; alter table public.outreach_request_events
        drop constraint reject_test_event`);
    }
    await setRole("service_role");
    assert.equal((await create()).replayed, false);
    await setRole("authenticated", ownerA);
    assert.equal(
      (await db.query("select sequence from public.outreach_request_events"))
        .rows.length,
      1,
    );
  });
});
