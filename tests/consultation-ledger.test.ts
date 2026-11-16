import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parseInstruction } from "../src/lib/consultation-request";

test("only verified time windows and international or US callback numbers enter the booking flow", () => {
  const now = Date.UTC(2027, 0, 1);
  const input = {
    requestId: crypto.randomUUID(),
    providerId: "agency",
    name: " Priya ",
    phone: "(312) 555-0136",
    timezone: "America/New_York",
    startTime: "2027-01-02T14:00:00Z",
    endTime: "2027-01-02T17:00:00Z",
  };
  assert.equal(parseInstruction(input, now)?.phone, "+13125550136");
  assert.equal(parseInstruction(input, now)?.name, "Priya");
  for (const change of [
    { endTime: "2026-12-30" },
    { timezone: "Nowhere/Here" },
    { endTime: "2027-02-02T14:00:00Z" },
    { phone: "bad" },
  ]) {
    assert.equal(parseInstruction({ ...input, ...change }, now), undefined);
  }
});

test("claims serialize a family's agency booking, keep uncertain writes claimed, and protect receipts across accounts", async () => {
  const db = await PGlite.create();
  try {
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      id = crypto.randomUUID();
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.subject',true),'')::uuid $$;`);
    await db.exec(readFileSync("supabase/consultation-bookings.sql", "utf8"));
    await db.query("insert into auth.users values ($1),($2)", [a, b]);
    await db.exec("set role service_role");
    const claim = (user: string, row: string) =>
      db.query(
        `insert into public.consultation_bookings(id,user_id,provider_id,agency_name,invitee_email,source,status,window_start,window_end,timezone) values($1,$2,'agency','Agency','test@example.invalid','phone','searching',now(), now()+interval '1 hour','America/New_York')`,
        [row, user],
      );
    await claim(a, id);
    await claim(b, crypto.randomUUID());
    await db.query(
      "update public.consultation_bookings set status='unknown' where id=$1",
      [id],
    );
    await assert.rejects(claim(a, crypto.randomUUID()), /duplicate key/);
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set status='confirmed', starts_at=now() where id=$1",
        [id],
      ),
      /check constraint/,
    );
    await db.query(
      "update public.consultation_bookings set status='confirmed',call_sid='real-test-call',starts_at=now() where id=$1",
      [id],
    );
    await db.exec("reset role");
    const upgrade = readFileSync("supabase/consultation-highlevel.sql", "utf8");
    await db.exec(upgrade);
    await db.exec(upgrade);
    assert.deepEqual(
      (
        await db.query(
          "select distinct invite_delivery from public.consultation_bookings",
        )
      ).rows,
      [{ invite_delivery: "harbor" }],
    );
    await db.exec("set role service_role");
    await db.query(
      "update public.consultation_bookings set status='past' where id=$1",
      [id],
    );
    const third = crypto.randomUUID();
    await claim(a, third);
    await db.query(
      "update public.consultation_bookings set source='highlevel' where id=$1",
      [third],
    );
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set window_end=window_start where id=$1",
        [third],
      ),
      /check constraint/,
    );
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set status='confirmed',starts_at=now() where id=$1",
        [third],
      ),
      /check constraint/,
    );
    await db.query(
      "update public.consultation_bookings set status='confirmed',starts_at=now(),event_uri='event',invitee_uri='person' where id=$1",
      [third],
    );
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('test.subject',$1,false)", [a]);
    assert.deepEqual(
      (
        await db.query(
          "select id from public.consultation_bookings where source='phone'",
        )
      ).rows,
      [{ id }],
    );
    await assert.rejects(
      db.query("update public.consultation_bookings set status='failed'"),
      /permission denied/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query(
        "select id from public.consultation_bookings where source='phone'",
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
