import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  R = "44444444-4444-4444-8444-444444444444",
  I = "33333333-3333-4333-8333-333333333333",
  P = "north-jersey-hp-hp1234567";
test("private history uses actual PostgreSQL RLS, append-only permissions, scope binding and hard limits", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      `create role anon nologin nosuperuser nobypassrls; create role authenticated nologin nosuperuser nobypassrls; create role service_role nologin nosuperuser bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; create table public.outreach_requests(owner_id uuid not null references auth.users(id),request_id uuid not null,provider_id text not null,primary key(owner_id,request_id));`,
    );
    const migration = readFileSync("supabase/inquiry-facts.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.query("insert into auth.users values ($1),($2)", [A, B]);
    await db.query(
      "insert into outreach_requests values ($1,$2,$3),($4,$2,$3)",
      [A, R, P, B],
    );
    const f = {
      id: I,
      requestId: R,
      providerId: P,
      careZip: "07601",
      kind: "coverage_zip",
      value: "serves",
      checkedOn: "2020-01-01",
      validUntil: null,
      source: "family_reported_office_response",
    };
    async function role(owner: string, name = "authenticated") {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        owner,
      ]);
      await db.exec(`set role ${name}`);
    }
    async function insert(
      owner = A,
      id = I,
      patch: Record<string, unknown> = {},
    ) {
      return db.query(
        "insert into inquiry_facts(owner_id,id,request_id,provider_id,fact) values ($1,$2,$3,$4,$5)",
        [owner, id, R, P, JSON.stringify({ ...f, id, ...patch })],
      );
    }
    await role(A);
    await insert();
    await assert.rejects(insert(), /duplicate key/);
    await assert.rejects(insert(B), /row-level security/);
    await assert.rejects(
      db.exec("update inquiry_facts set fact='{}'"),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("delete from inquiry_facts"),
      /permission denied/,
    );
    await role(B);
    assert.equal(
      (await db.query("select * from inquiry_facts")).rows.length,
      0,
    );
    await insert(B);
    assert.equal(
      (await db.query("select * from inquiry_facts")).rows.length,
      1,
    );
    await role(A);
    for (const patch of [
      { kind: null },
      { careZip: null },
      { source: null },
      { value: "maybe" },
      { checkedOn: "2020-02-30" },
      { kind: "hourly_rate", value: "10001" },
    ])
      await assert.rejects(
        insert(A, "55555555-5555-4555-8555-555555555555", patch),
      );
    await assert.rejects(
      db.query(
        "insert into inquiry_facts(owner_id,id,request_id,provider_id,fact) values ($1,$2,$3,'other',$4)",
        [
          A,
          "55555555-5555-4555-8555-555555555555",
          R,
          JSON.stringify({
            ...f,
            id: "55555555-5555-4555-8555-555555555555",
            providerId: "other",
          }),
        ],
      ),
      /Request\/provider mismatch/,
    );
    for (let n = 1; n < 200; n++)
      await insert(A, `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
    await assert.rejects(
      insert(A, "66666666-6666-4666-8666-666666666666"),
      /history limit/,
    );
    assert.equal(
      (await db.query("select * from inquiry_facts")).rows.length,
      200,
    );
    await role("", "anon");
    await assert.rejects(
      db.exec("select * from inquiry_facts"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
