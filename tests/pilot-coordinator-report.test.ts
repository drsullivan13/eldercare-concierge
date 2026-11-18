import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const source = readFileSync(
  new URL("../scripts/pilot-coordinator-report.sql", import.meta.url),
  "utf8",
);
function report(size = 100, offset = 0) {
  return source
    .slice(source.indexOf("begin isolation"))
    .replaceAll(":'as_of'", "'2026-11-18T15:00:00Z'")
    .replaceAll(":'page_size'", `'${size}'`)
    .replaceAll(":'page_offset'", `'${offset}'`);
}
test("read-only PostgreSQL report preserves meaning, privacy and complete deterministic paging", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table outreach_requests(owner_id uuid, request_id uuid, provider_id text, brief jsonb);
      create table outreach_followups(owner_id uuid, followup_id uuid, request_id uuid, kind text, source text, status text, due_at timestamptz, note text);
      create table consultation_bookings(id uuid, user_id uuid, provider_id text, status text, created_at timestamptz, invitee_email text);
      create table consultation_invites(booking_id uuid, status text, first_attempt_at timestamptz, lease_at timestamptz, email_id text);
      insert into outreach_requests values
        ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','provider-a','{"secret":"PRIVATE"}'),
        ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','provider-b','{"secret":"PRIVATE"}');
      insert into outreach_followups
      select owner_id, '20000000-0000-0000-0000-000000000001', request_id, 'promised_callback','user_reported','open','2026-11-18T14:00Z','PRIVATE' from outreach_requests;
      insert into outreach_followups
      select owner_id, gen_random_uuid(), request_id, kind, source, status, due_at, 'PRIVATE' from outreach_requests
      cross join (values
        ('promised_callback','user_reported','open','2026-11-18T15:00Z'::timestamptz),
        ('promised_callback','user_reported','done','2026-11-18T14:00Z'::timestamptz),
        ('next_action','user_reported','open','2026-11-18T14:00Z'::timestamptz),
        ('promised_callback','validated_service','open','2026-11-18T14:00Z'::timestamptz),
        ('promised_callback','user_reported','open',null::timestamptz)) v(kind,source,status,due_at);
      insert into consultation_bookings
      select ('30000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
        '00000000-0000-0000-0000-000000000001', 'provider-' || n,
        case when n = 1 then 'unknown' when n = 8 then 'past' else 'confirmed' end,
        '2026-11-18T13:00Z','PRIVATE@example.test' from generate_series(1,8) n;
      insert into consultation_invites
      select id, v.status, v.first_attempt_at::timestamptz, v.lease_at::timestamptz, 'PRIVATE'
      from (values
        (2,'review','2026-11-18T14:00Z','2026-11-18T14:00Z'),
        (3,'ready','2026-11-18T14:00Z','2026-11-18T14:00Z'),
        (4,'sending','2026-11-18T14:00Z','2026-11-18T14:59:30Z'),
        (5,'sending','2026-11-18T14:00Z','2026-11-18T14:59:31Z'),
        (6,'accepted','2026-11-18T14:00Z','2026-11-18T14:00Z'),
        (7,'sending','2026-11-17T16:00Z','2026-11-18T15:00Z'),
        (8,'review','2026-11-18T14:00Z','2026-11-18T14:00Z')) v(n,status,first_attempt_at,lease_at)
      join consultation_bookings b on b.provider_id = 'provider-' || v.n;
    `);
    async function rows(size = 100, offset = 0) {
      const result = await db.exec(report(size, offset));
      return result.find((r) => r.fields.some((f) => f.name === "record_key"))!
        .rows as Record<string, unknown>[];
    }
    const all = await rows();
    assert.equal(all.length, 8);
    assert.equal(
      all.filter((r) => r.exception === "callback_overdue_human_reported")
        .length,
      2,
    );
    assert.deepEqual(
      all
        .filter((r) => r.exception === "callback_overdue_human_reported")
        .map((r) => r.provider_id),
      ["provider-a", "provider-b"],
    );
    assert.equal(
      new Set(
        all
          .filter((r) => r.exception === "callback_overdue_human_reported")
          .map((r) => r.record_key),
      ).size,
      2,
    );
    assert.equal(
      all.filter((r) => r.exception === "invitation_needs_review").length,
      3,
    );
    assert.equal(
      all.filter((r) => r.exception === "invitation_stale_sending").length,
      1,
    );
    assert.ok(all.every((r) => r.total_rows === 8));
    assert.deepEqual(
      [...(await rows(3, 0)), ...(await rows(3, 3)), ...(await rows(3, 6))],
      all,
    );
    assert.deepEqual(await rows(3, 9), []);
    assert.deepEqual(await rows(0, -1), all.slice(0, 1));
    assert.deepEqual(await rows(), all);
    const serialized = JSON.stringify(all);
    for (const forbidden of [
      "PRIVATE",
      "owner_id",
      "user_id",
      "invitee_email",
      "note",
      "brief",
      "00000000-0000-0000-0000-000000000001",
    ])
      assert.ok(!serialized.includes(forbidden));
    assert.deepEqual(Object.keys(all[0]), [
      "row_number",
      "total_rows",
      "exception",
      "record_key",
      "record_id",
      "provider_id",
      "attention_at",
      "next_action",
    ]);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from outreach_followups",
        )
      ).rows[0].n,
      12,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from consultation_invites where status='sending'",
        )
      ).rows[0].n,
      3,
    );
  } finally {
    await db.close();
  }
});
