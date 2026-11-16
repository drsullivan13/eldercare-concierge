import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("one-use recovery tickets lease unresolved bookings, release expired windows, and exclude accepted invitations", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      "create schema auth;create table auth.users(id uuid primary key);create role service_role bypassrls;create role anon;create role authenticated;create function auth.uid() returns uuid language sql as $$select null::uuid$$;",
    );
    for (const file of [
      "consultation-bookings",
      "consultation-invites",
      "consultation-highlevel",
      "consultation-recovery",
    ])
      await db.exec(readFileSync("supabase/" + file + ".sql", "utf8"));
    const owner = crypto.randomUUID(),
      upcoming = crypto.randomUUID(),
      expired = crypto.randomUUID(),
      delivered = crypto.randomUUID(),
      ticket = crypto.randomUUID();
    await db.query("insert into auth.users values($1)", [owner]);
    async function fixture(
      id: string,
      source: string,
      status: string,
      past: boolean,
    ) {
      await db.query(
        `insert into public.consultation_bookings(id,user_id,provider_id,agency_name,invitee_email,source,status,window_start,window_end,timezone,created_at,starts_at,call_sid)
   values ($1,$2,$3,'Office','test@example.invalid',$4,$5,now()-interval '2 hours',now()+$6::interval,'UTC',now()-interval '1 hour',now()+interval '30 minutes',$7)`,
        [
          id,
          owner,
          id,
          source,
          status,
          past ? "-1 hour" : "1 hour",
          source === "phone" ? id : null,
        ],
      );
    }
    await fixture(upcoming, "highlevel", "unknown", false);
    await fixture(expired, "phone", "unknown", true);
    await fixture(delivered, "phone", "confirmed", false);
    await db.query(
      "insert into consultation_invites(booking_id,status,lease_id) values($1,'accepted',$2)",
      [delivered, crypto.randomUUID()],
    );
    await db.query(
      "insert into harbor_consultations.recovery_tickets(id) values($1)",
      [ticket],
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select id from public.claim_consultation_recovery($1)", [
        ticket,
      ]),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    const claimed = await db.query<{ id: string }>(
      "select id from public.claim_consultation_recovery($1)",
      [ticket],
    );
    assert.deepEqual(
      claimed.rows.map((x) => x.id).sort(),
      [upcoming, expired].sort(),
    );
    await assert.rejects(
      db.query("select id from public.claim_consultation_recovery($1)", [
        ticket,
      ]),
      /Invalid recovery ticket/,
    );
    await db.query(
      "update consultation_bookings set status='expired' where id=$1",
      [expired],
    );
    await db.exec("reset role");
    await fixture(crypto.randomUUID(), "phone", "searching", false);
    assert.equal(
      (
        await db.query(
          "select id from harbor_consultations.due_bookings where id=$1",
          [expired],
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
