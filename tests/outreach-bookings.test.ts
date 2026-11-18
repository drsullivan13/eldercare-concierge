import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { outreachBookingState } from "../src/lib/outreach-booking-state";
import { parseInstruction } from "../src/lib/consultation-request";

test("linked claims enforce exact account and office, immutable attribution, and existing receipt authority", async () => {
  const db = await PGlite.create();
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID(),
    request = crypto.randomUUID();
  const office = "north-jersey-hp-hp0000216";
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public, auth to authenticated, anon, service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.subject',true),'')::uuid $$;`);
    for (const migration of [
      "consultation-bookings",
      "consultation-highlevel",
      "outreach-requests",
      "outreach-consultation-links",
      "outreach-consultation-links",
    ])
      await db.exec(readFileSync(`supabase/${migration}.sql`, "utf8"));
    await db.query("insert into auth.users values ($1),($2)", [owner, other]);
    await db.exec("set role service_role");
    await db.query(
      "select public.create_outreach_request($1,$2,$3,$4::jsonb)",
      [
        owner,
        request,
        office,
        JSON.stringify({ topics: ["Availability"], question: "" }),
      ],
    );
    const claim = (
      user: string,
      provider: string,
      link: string | null,
      id = crypto.randomUUID(),
    ) =>
      db.query(
        `insert into public.consultation_bookings(id,user_id,provider_id,agency_name,invitee_email,source,status,window_start,window_end,timezone,outreach_request_id)
      values($1,$2,$3,'Office','test@example.invalid','phone','searching',now(),now()+interval '1 hour','America/New_York',$4)`,
        [id, user, provider, link],
      );
    await assert.rejects(claim(other, office, request), /foreign key/);
    await assert.rejects(
      claim(owner, "north-jersey-hp-hp0000217", request),
      /foreign key/,
    );
    const booking = crypto.randomUUID();
    await claim(owner, office, request, booking);
    await assert.rejects(
      claim(owner, office, request, booking),
      /duplicate key/,
    );
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set outreach_request_id=null where id=$1",
        [booking],
      ),
      /immutable/,
    );
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set user_id=$1 where id=$2",
        [other, booking],
      ),
      /immutable/,
    );
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set provider_id='other' where id=$1",
        [booking],
      ),
      /immutable/,
    );
    await db.query(
      "update public.consultation_bookings set status='submitting',starts_at=now() where id=$1",
      [booking],
    );
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set status='confirmed' where id=$1",
        [booking],
      ),
      /check constraint/,
    );
    await db.query(
      "update public.consultation_bookings set status='confirmed',call_sid='test-receipt' where id=$1",
      [booking],
    );
    await claim(other, office, null); // legacy callers need no outreach request
    await assert.rejects(
      db.query(
        "update public.consultation_bookings set outreach_request_id=$1 where user_id=$2",
        [request, other],
      ),
      /immutable/,
    );
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('test.subject',$1,false)", [other]);
    assert.equal(
      (
        await db.query(
          "select id from public.consultation_bookings where outreach_request_id is not null",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("insert into public.consultation_bookings(id) values($1)", [
        crypto.randomUUID(),
      ]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("timeline hides tentative times and private transport data and separates pending from confirmation", () => {
  const row = {
    id: "booking",
    provider_id: "office",
    status: "submitting",
    source: "phone",
    starts_at: "2027-01-01T12:00:00Z",
    ends_at: null,
    timezone: "America/New_York",
    created_at: "2026-11-18",
    call_sid: "private",
    invitee_email: "private",
  };
  for (const status of ["searching", "submitting", "unknown"]) {
    const result = outreachBookingState({ ...row, status });
    assert.equal(result.startsAt, null);
    assert.equal(result.nextAction, "wait_for_receipt");
    assert.equal("call_sid" in result, false);
    assert.equal("invitee_email" in result, false);
  }
  const confirmed = outreachBookingState({ ...row, status: "confirmed" });
  assert.equal(confirmed.startsAt, row.starts_at);
  assert.equal(confirmed.nextAction, "review_confirmation");
  assert.throws(() => outreachBookingState({ ...row, source: "simulation" }));
});

test("booking instructions accept only an explicit valid outreach ID and keep legacy callers valid", () => {
  const now = Date.UTC(2027, 0, 1);
  const input = {
    requestId: crypto.randomUUID(),
    providerId: "office",
    name: "Family",
    startTime: "2027-01-02T12:00:00Z",
    endTime: "2027-01-02T14:00:00Z",
    timezone: "America/New_York",
  };
  assert.ok(parseInstruction(input, now));
  assert.equal(
    parseInstruction({ ...input, outreachRequestId: "scenario" }, now),
    undefined,
  );
  const id = crypto.randomUUID().toUpperCase();
  assert.equal(
    parseInstruction({ ...input, outreachRequestId: id }, now)
      ?.outreachRequestId,
    id.toLowerCase(),
  );
});
