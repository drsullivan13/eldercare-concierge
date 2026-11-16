import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  consultationCalendar,
  deliverConsultationInvite,
} from "../src/lib/consultation-invite";
const user = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002",
  other = "00000000-0000-4000-8000-000000000003";
const booking = {
  id,
  invite_delivery: "harbor",
  agency_name:
    "Agence à domicile; NJ,\r\nATTENDEE:other@example.org " + "é".repeat(70),
  invitee_email: "family@example.org",
  created_at: "2030-11-15T13:10:00Z",
  starts_at: "2030-11-16T10:30:00-05:00",
  ends_at: null,
  timezone: "America/New_York",
};
test("calendar download and email share a stable event in UTC with no invented duration", () => {
  const download = consultationCalendar(booking);
  const attachment = consultationCalendar(booking, "calendar@example.org");
  assert.match(download, /METHOD:PUBLISH/);
  assert.match(attachment, /METHOD:REQUEST/);
  for (const cal of [download, attachment]) {
    assert.ok(cal.includes(`UID:${id}@harbor-consultations\r\n`));
    assert.match(cal, /DTSTART:20301116T153000Z\r\n/);
    assert.doesNotMatch(cal, /DTEND|\r\nATTENDEE:other/);
    for (const line of cal.split("\r\n"))
      assert.ok(Buffer.byteLength(line) <= 75);
  }
  assert.match(attachment, /ATTENDEE;RSVP=FALSE:mailto:family@example.org/);
  assert.match(
    consultationCalendar({ ...booking, ends_at: "2030-11-16T16:00:00Z" }),
    /DTEND:20301116T160000Z/,
  );
});
test("delivery submits a repeatable attachment to the verified owner, honoring accepted claims", async (t) => {
  const oldSender = process.env.HARBOR_INVITE_FROM,
    oldToken = process.env.RESEND_API_KEY;
  process.env.HARBOR_INVITE_FROM = "calendar@example.org";
  process.env.RESEND_API_KEY = "test-token";
  t.after(() => {
    if (oldSender === undefined) delete process.env.HARBOR_INVITE_FROM;
    else process.env.HARBOR_INVITE_FROM = oldSender;
    if (oldToken === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldToken;
  });
  let claim = "send",
    accepted = false,
    email = booking.invitee_email;
  const client = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email, email_confirmed_at: "confirmed" } },
        }),
      },
    },
    rpc: async () => ({ data: claim }),
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        gt: () => builder,
        update: (record: { status: string; email_id: string }) => {
          assert.equal(record.email_id, "receipt-id");
          accepted = record.status === "accepted";
          return builder;
        },
        maybeSingle: async () => ({
          data:
            table === "consultation_bookings"
              ? booking
              : { status: "accepted" },
        }),
      };
      return builder;
    },
  } as unknown as Parameters<typeof deliverConsultationInvite>[0];
  const key = { bookingId: id, userId: user };
  const send = t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(
        new Headers(init.headers).get("Idempotency-Key"),
        "consultation-invite/" + id,
      );
      const sent = JSON.parse(String(init.body));
      assert.deepEqual(sent.to, [booking.invitee_email]);
      assert.match(
        Buffer.from(sent.attachments[0].content, "base64").toString(),
        /METHOD:REQUEST/,
      );
      return Response.json({ id: "receipt-id" });
    },
  );
  assert.deepEqual(await deliverConsultationInvite(client, key), {
    status: "accepted",
  });
  assert.equal(accepted, true);
  claim = "accepted";
  assert.deepEqual(await deliverConsultationInvite(client, key), {
    status: "accepted",
  });
  email = "changed@example.org";
  assert.deepEqual(await deliverConsultationInvite(client, key), {
    status: "review",
  });
  assert.equal(send.mock.callCount(), 1);
});
test("real SQL serializes email claims, protects other users, preserves ambiguous results past key expiry", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as 'select null::uuid';`,
    );
    await db.exec(readFileSync("supabase/consultation-bookings.sql", "utf8"));
    await db.exec(readFileSync("supabase/consultation-invites.sql", "utf8"));
    await db.query("insert into auth.users values ($1)", [user]);
    await db.query(
      "insert into public.consultation_bookings (id,user_id,provider_id,agency_name,invitee_email,source,call_sid,status,starts_at,window_start,window_end,timezone) values ($1,$2,'agency','Test Agency','family@example.org','phone','test-call','confirmed',now()+interval '2 hours',now(),now()+interval '4 hours','America/New_York')",
      [id, user],
    );
    await db.exec(readFileSync("supabase/consultation-highlevel.sql", "utf8"));
    await db.exec(
      readFileSync("supabase/consultation-invites-highlevel.sql", "utf8"),
    );
    const claim = async (owner: string, lease: string) =>
      (
        await db.query<{ state: string }>(
          "select public.claim_consultation_invite($1,$2,$3) as state",
          [id, owner, lease],
        )
      ).rows[0].state;
    await db.exec("set role authenticated");
    await assert.rejects(claim(user, user), /permission denied/);
    await db.exec("set role service_role");
    assert.equal(await claim(other, user), "missing");
    assert.equal(await claim(user, id), "send");
    assert.equal(await claim(user, user), "pending");
    await db.exec(
      "update public.consultation_invites set lease_at=now()-interval '2 minutes'",
    );
    assert.equal(await claim(user, user), "send");
    await db.exec(
      "update public.consultation_invites set first_attempt_at=now()-interval '24 hours'",
    );
    assert.equal(await claim(user, id), "review");
    await db.exec("update public.consultation_invites set status='accepted'");
    assert.equal(await claim(user, id), "accepted");
    await db.exec(
      "update public.consultation_bookings set source='highlevel',call_sid=null,event_uri='appointment',invitee_uri='contact',invite_delivery='agency'",
    );
    assert.equal(await claim(user, id), "missing");
    await db.exec(
      "update public.consultation_bookings set invite_delivery='harbor'",
    );
    assert.equal(await claim(user, id), "accepted");
  } finally {
    await db.close();
  }
});
