import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("public form jobs bind verified approval, block repeat submissions and protect worker writes", async () => {
  const db = await PGlite.create();
  const a = randomUUID(),
    b = randomUUID(),
    id = randomUUID();
  const email = "ada@example.test",
    provider = "north-jersey-hp-hp0265900";
  const begin = new Date(Date.now() + 86400000),
    end = new Date(+begin + 3600000);
  const args = [
    id,
    provider,
    begin.toISOString(),
    end.toISOString(),
    "Ada Doe",
    "+12025550101",
    "elderly-savior-v1",
    email,
  ];
  const book = (overrides: Record<number, string | null> = {}) =>
    db.query<{ j: Record<string, unknown> }>(
      "select public.request_public_form_booking($1,$2,$3,$4,$5,$6,$7,$8) j",
      Object.assign([...args], overrides),
    );
  const defaults = async () =>
    (
      await db.query<{
        d: {
          name: string;
          phone: string;
          windowStart: string;
          windowEnd: string;
        } | null;
      }>("select public.public_form_booking_defaults() d")
    ).rows[0].d;
  async function role(name: string, owner = a) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await db.exec("set role " + name);
  }
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key, email text,email_confirmed_at timestamptz,is_anonymous boolean);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;`);
    const sql = readFileSync("supabase/public-form-bookings.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    await db.query(
      "insert into auth.users values($1,$2,now(),false),($3,'bea@example.test',null,false)",
      [a, email, b],
    );
    await role("anon");
    await assert.rejects(book(), /permission denied/);
    await assert.rejects(defaults(), /permission denied/);
    await role("authenticated", b);
    await assert.rejects(book(), /Verified account required/);
    assert.equal(await defaults(), null);
    await role("authenticated");
    await assert.rejects(book({ 7: "foreign@example.test" }), /email changed/);
    await assert.rejects(book({ 6: "outdated" }), /Invalid booking approval/);
    await assert.rejects(
      book({ 3: begin.toISOString() }),
      /Invalid booking approval/,
    );
    assert.equal(await defaults(), null);
    const job = (await book()).rows[0].j;
    assert.equal(await defaults(), null);
    assert.equal(job.id, id);
    assert.equal(job.status, "queued_booking");
    assert.deepEqual(
      Object.keys(job).sort(),
      [
        "id",
        "status",
        "windowStart",
        "windowEnd",
        "startTime",
        "receipt",
      ].sort(),
    );
    assert.deepEqual((await book()).rows[0].j, job);
    await assert.rejects(
      book({ 4: "Anonymous Example" }),
      /Request ID already used/,
    );
    const wellcare = "north-jersey-hp-hp0054400";
    const wellcareId = randomUUID();
    await assert.rejects(
      book({ 1: wellcare, 6: "wellcare-v1" }),
      /Request ID already used/,
    );
    await assert.rejects(
      book({ 0: wellcareId, 1: wellcare }),
      /Invalid booking approval/,
    );
    await assert.rejects(
      book({ 0: wellcareId, 6: "wellcare-v1" }),
      /Invalid booking approval/,
    );
    await assert.rejects(
      book({ 0: wellcareId, 1: null, 6: null }),
      /Invalid booking approval/,
    );
    // Keep this test independent of historical fixture counts and later all-row updates.
    await db.exec("begin");
    const wellcareArgs = { 0: wellcareId, 1: wellcare, 6: "wellcare-v1" };
    assert.equal((await book(wellcareArgs)).rows[0].j.id, wellcareId);
    await assert.rejects(
      book({ ...wellcareArgs, 0: randomUUID() }),
      /previous booking/,
    );
    await db.exec("rollback");
    await assert.rejects(book({ 0: randomUUID() }), /previous booking/);
    await assert.rejects(
      db.exec("update public.public_form_bookings set status='confirmed'"),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("select invitee_phone from public.public_form_bookings"),
      /permission denied/,
    );
    await role("authenticated", b);
    assert.deepEqual(
      (await db.query("select id from public.public_form_bookings")).rows,
      [],
    );
    await role("harbor_public_form_worker");
    assert.equal(
      (
        await db.query<{ invitee_email: string }>(
          "select invitee_email from public.public_form_bookings",
        )
      ).rows[0].invitee_email,
      email,
    );
    await assert.rejects(
      db.exec(
        "update public.public_form_bookings set invitee_name='Another Name'",
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.exec(
        "update public.public_form_bookings set status='confirmed',receipt='ok'",
      ),
      /check constraint/,
    );
    await assert.rejects(
      db.query(
        "update public.public_form_bookings set start_time=$1,status='submitting'",
        [end],
      ),
      /check constraint/,
    );
    await db.query(
      "update public.public_form_bookings set start_time=$1,status='unknown'",
      [begin],
    );
    await role("authenticated");
    await assert.rejects(book({ 0: randomUUID() }), /previous booking/);
    await role("harbor_public_form_worker");
    await db.exec("update public.public_form_bookings set status='failed'");
    await role("authenticated");
    const own = await defaults();
    assert.equal(
      (
        await db.query<{ d: unknown }>(
          "select public.public_form_booking_defaults($1) d",
          [wellcare],
        )
      ).rows[0].d,
      null,
    );
    assert.equal(own?.name, "Ada Doe");
    assert.equal(own?.phone, "+12025550101");
    assert.equal(Date.parse(own!.windowStart), +begin);
    assert.equal(Date.parse(own!.windowEnd), +end);
    await db.exec("reset role");
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [b],
    );
    await role("authenticated", b);
    assert.equal(await defaults(), null);
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='changed@example.test' where id=$1",
      [a],
    );
    await role("authenticated");
    assert.equal(await defaults(), null);
    await db.exec("reset role");
    await db.query("update auth.users set email=$2 where id=$1", [a, email]);
    for (let n = 1; n < 6; n++) {
      await role("authenticated");
      await book({ 0: randomUUID() });
      await role("harbor_public_form_worker");
      await db.exec(
        "update public.public_form_bookings set status='unavailable'",
      );
    }
    await role("authenticated");
    await assert.rejects(book({ 0: randomUUID() }), /Hourly booking limit/);
  } finally {
    await db.close();
  }
});
