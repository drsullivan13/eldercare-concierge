import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  bookingMessage,
  type Consultation,
} from "../src/lib/consultation-request";
import { outreachBookingState } from "../src/lib/outreach-booking-state";

const row: Consultation = {
  id: "booking",
  agency_name: "Office",
  provider_id: "office",
  source: "phone",
  status: "unknown",
  starts_at: null,
  ends_at: null,
  timezone: "America/New_York",
  office_callback_pending: true,
  window_end: "2099-01-01T12:00:00Z",
};
test("callback evidence stays pending without a confirmed time before and after expiry", () => {
  assert.match(
    bookingMessage(row),
    /Callback pending; no consultation time is confirmed/,
  );
  assert.match(
    bookingMessage({ ...row, status: "expired" }),
    /callback was pending when your availability window ended/,
  );
  assert.match(
    bookingMessage({ ...row, window_end: "2000-01-01T12:00:00Z" }),
    /No consultation was confirmed/,
  );
  assert.match(
    bookingMessage({ ...row, office_callback_pending: false }),
    /booking receipt/,
  );
  for (const status of ["unknown", "expired", "confirmed"]) {
    const projection = outreachBookingState({
      ...row,
      status,
      provider_id: "office",
      starts_at: "2099-01-01T12:00:00Z",
      window_end: status === "expired" ? "2000-01-01" : row.window_end,
    });
    assert.equal(projection.officeCallbackPending, true);
    assert.equal(projection.startsAt, null);
    assert.equal(
      projection.nextAction,
      status === "expired"
        ? "callback_window_ended"
        : "wait_for_office_callback",
    );
  }
});

test("callback migration defaults false, reruns, preserves expired evidence and active lock", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon;create role authenticated;create role service_role;
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
    await db.exec(readFileSync("supabase/consultation-bookings.sql", "utf8"));
    await db.exec(`alter table consultation_bookings drop constraint consultation_bookings_status_check;
      alter table consultation_bookings add constraint consultation_bookings_status_check check(status in ('searching','unknown','expired','confirmed'));`);
    const sql = readFileSync(
      "supabase/consultation-office-callback.sql",
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const user = crypto.randomUUID(),
      id = crypto.randomUUID();
    await db.query("insert into auth.users values ($1)", [user]);
    const insert = (booking: string) =>
      db.query(
        `insert into consultation_bookings
      (id,user_id,provider_id,agency_name,invitee_email,source,status,window_start,window_end,timezone)
      values($1,$2,'office','Office','test@example.invalid','phone','unknown',now(),now()+interval '1 hour','UTC')`,
        [booking, user],
      );
    await insert(id);
    assert.deepEqual(
      (
        await db.query(
          "select office_callback_pending from consultation_bookings",
        )
      ).rows,
      [{ office_callback_pending: false }],
    );
    await db.query(
      "update consultation_bookings set office_callback_pending=true where id=$1",
      [id],
    );
    await assert.rejects(insert(crypto.randomUUID()), /duplicate key/);
    await assert.rejects(
      db.query("update consultation_bookings set starts_at=now() where id=$1", [
        id,
      ]),
      /check constraint/,
    );
    await assert.rejects(
      db.query(
        "update consultation_bookings set source='calendly' where id=$1",
        [id],
      ),
      /check constraint/,
    );
    await db.query(
      "update consultation_bookings set status='expired' where id=$1",
      [id],
    );
    await insert(crypto.randomUUID());
    assert.deepEqual(
      (
        await db.query(
          "select office_callback_pending from consultation_bookings where id=$1",
          [id],
        )
      ).rows,
      [{ office_callback_pending: true }],
    );
  } finally {
    await db.close();
  }
});
