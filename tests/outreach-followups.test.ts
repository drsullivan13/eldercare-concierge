import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parseFollowup } from "../src/lib/outreach-followups";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
test("follow-up parser requires human provenance and timezone", () => {
  const b = {
    followupId: id,
    requestId: id,
    kind: "promised_callback",
    assignee: "office",
    note: "Office said they would call.",
    source: "user_reported",
    channel: "phone",
    dueAt: "2026-11-18T09:00:00-05:00",
  };
  assert.equal(parseFollowup(b)?.dueAt, "2026-11-18T14:00:00.000Z");
  for (const override of [
    { source: "validated_service" },
    { dueAt: "2026-11-18T09:00:00" },
    { status: "confirmed" },
    { transcript: "raw" },
  ])
    assert.equal(parseFollowup({ ...b, ...override }), null);
});
test("durable follow-ups enforce ownership, replay, immutable evidence and no booking promotion", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      `create role anon; create role authenticated; create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,service_role;`,
    );
    await db.exec(readFileSync("supabase/outreach-requests.sql", "utf8"));
    const migration = readFileSync("supabase/outreach-followups.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.query("insert into auth.users(id) values ($1),($2)", [
      owner,
      other,
    ]);
    await db.query(
      `select public.create_outreach_request($1,$2,'north-jersey-hp-hp0000001','{"topics":[],"question":"Call?"}')`,
      [owner, id],
    );
    const identify = (account: string) =>
      db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        account,
      ]);
    const record = () =>
      db.query<{ r: { replayed: boolean } }>(
        `select public.record_outreach_followup($1,$1,'promised_callback','office','Call promised','2026-11-18T09:00:00-05:00','phone') r`,
        [id],
      );
    const complete = () =>
      db.query("select public.complete_outreach_followup($1)", [id]);
    await identify(owner);
    await db.exec("set role authenticated");
    assert.equal((await record()).rows[0].r.replayed, false);
    assert.equal((await record()).rows[0].r.replayed, true);
    await assert.rejects(
      db.query(
        `select public.record_outreach_followup($1,$1,'next_action','family','Different',null,'email')`,
        [id],
      ),
    );
    await identify(other);
    await assert.rejects(record()); // Cannot attach to the other owner's request.
    await assert.rejects(complete()); // Cannot complete the other owner's item.
    await identify("");
    await assert.rejects(record());
    await identify(owner);
    await db.exec("reset role");
    await db.query("update auth.users set is_anonymous=true where id=$1", [
      owner,
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(record());
    await assert.rejects(complete());
    await db.exec("reset role");
    await db.query("update auth.users set is_anonymous=false where id=$1", [
      owner,
    ]);
    for (const role of ["anon", "service_role"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(record());
      await assert.rejects(complete());
      await db.exec("reset role");
    }
    await db.exec("set role authenticated");
    await complete();
    await complete();
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from public.outreach_followup_events",
        )
      ).rows[0].count,
      2,
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from public.outreach_requests",
        )
      ).rows[0].status,
      "requested",
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from public.outreach_followups")).rows.length,
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    assert.equal(
      (await db.query("select * from public.outreach_followups")).rows.length,
      1,
    );
    await assert.rejects(
      db.exec(
        "update public.outreach_followups set source='validated_service'",
      ),
    );
    await assert.rejects(
      db.exec("delete from public.outreach_followup_events"),
    );
  } finally {
    await db.close();
  }
});

test("follow-up route uses the verified user's client without a server-only key", () => {
  const route = readFileSync("src/app/api/outreach-followups/route.ts", "utf8");
  assert.match(route, /client\.auth\.getUser\(\)/);
  assert.match(route, /user\.is_anonymous/);
  assert.match(route, /client\.rpc\("record_outreach_followup"/);
  assert.match(route, /client\.rpc\("complete_outreach_followup"/);
  assert.doesNotMatch(route, /bookingAdmin|p_owner_id|SERVICE_ROLE|SECRET_KEY/);
});
