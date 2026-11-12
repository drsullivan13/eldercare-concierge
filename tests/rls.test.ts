import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// This is a local PostgreSQL/WASM integration test, not a Supabase Auth or JWT test.
// The harness alone sets the subject claim; real deployments must obtain it from validated JWTs.
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const schema = readFileSync("supabase/schema.sql", "utf8");

function workspace(name: string) {
  return {
    profile: { name, relationship: "A parent", zip: "02108", careTypes: [] },
    savedProviderIds: [],
    notes: {},
    tasks: [],
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
}

describe(
  "actual Harbor schema: local PostgreSQL roles, RLS and constraints",
  { concurrency: false, timeout: 30_000 },
  () => {
    let db: PGlite;

    before(async () => {
      db = await PGlite.create({ dataDir: "memory://" });
      // Only the minimum Supabase-owned objects are supplied by this harness.
      // All user_workspaces DDL, grants and policies come unchanged from the real draft schema.
      await db.exec(`
      create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid
        language sql stable set search_path = ''
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      revoke all on auth.users from public, anon, authenticated;
      -- Model Supabase's broad default table grants so the schema must narrow them explicitly.
      alter default privileges in schema public grant all on tables to authenticated;
    `);
      await db.exec(schema);
    });

    after(async () => {
      if (db) await db.close();
    });

    beforeEach(async () => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
      await db.exec(
        "truncate public.user_workspaces; truncate auth.users cascade",
      );
      await db.query("insert into auth.users (id) values ($1), ($2)", [
        USER_A,
        USER_B,
      ]);
    });

    async function asUser(
      subject: string | null,
      role: "authenticated" | "anon" = "authenticated",
    ) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        subject ?? "",
      ]);
      await db.exec(
        role === "authenticated" ? "set role authenticated" : "set role anon",
      );
      const { rows } = await db.query<{
        current_role: string;
        subject: string | null;
        superuser: boolean;
        bypass: boolean;
        rls_active: boolean;
      }>(`
      select current_user as current_role, auth.uid()::text as subject,
        r.rolsuper as superuser, r.rolbypassrls as bypass,
        row_security_active('public.user_workspaces') as rls_active
      from pg_roles r where r.rolname = current_user
    `);
      assert.equal(rows[0].current_role, role);
      assert.equal(rows[0].subject, subject);
      assert.equal(
        rows[0].superuser,
        false,
        "Assertions must not run as a superuser",
      );
      assert.equal(
        rows[0].bypass,
        false,
        "Assertions must not run with BYPASSRLS",
      );
      assert.equal(
        rows[0].rls_active,
        true,
        "The engine must enforce RLS, not merely parse the schema",
      );
    }

    async function insert(userId: string, name: string) {
      return db.query(
        "insert into public.user_workspaces (user_id, data) values ($1, $2::jsonb) returning user_id",
        [userId, JSON.stringify(workspace(name))],
      );
    }

    async function seedBoth() {
      await db.exec("reset role");
      await insert(USER_A, "Test A");
      await insert(USER_B, "Test B");
    }

    async function expectDenied(query: Promise<unknown>) {
      await assert.rejects(query, (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "42501",
          "Expected PostgreSQL permission/RLS denial",
        );
        return true;
      });
    }

    test("each authenticated owner can insert, read, upsert, update and delete their own workspace", async () => {
      for (const [subject, name] of [
        [USER_A, "Test A"],
        [USER_B, "Test B"],
      ]) {
        await asUser(subject);
        const inserted = await insert(subject, name);
        assert.deepEqual(inserted.rows, [{ user_id: subject }]);
        const own = await db.query<{
          user_id: string;
          data: ReturnType<typeof workspace>;
        }>("select user_id, data from public.user_workspaces");
        assert.deepEqual(own.rows, [
          { user_id: subject, data: workspace(name) },
        ]);
        const upserted = await db.query<{
          user_id: string;
          data: ReturnType<typeof workspace>;
        }>(
          `
        insert into public.user_workspaces (user_id, data) values ($1, $2::jsonb)
        on conflict (user_id) do update set data = excluded.data returning user_id, data
      `,
          [subject, JSON.stringify(workspace(`${name} upserted`))],
        );
        assert.equal(upserted.rows[0].data.profile.name, `${name} upserted`);
        const updated = await db.query<{ name: string }>(
          `
        update public.user_workspaces set data = jsonb_set(data, '{profile,name}', to_jsonb($1::text))
        where user_id = $2 returning data->'profile'->>'name' as name
      `,
          [`${name} updated`, subject],
        );
        assert.deepEqual(updated.rows, [{ name: `${name} updated` }]);
        const deleted = await db.query(
          "delete from public.user_workspaces where user_id = $1 returning user_id",
          [subject],
        );
        assert.deepEqual(deleted.rows, [{ user_id: subject }]);
        assert.deepEqual(
          (await db.query("select * from public.user_workspaces")).rows,
          [],
        );
      }
    });

    test("unfiltered and guessed-ID queries cannot read or mutate the other owner’s existing row", async () => {
      await seedBoth();
      for (const [subject, other] of [
        [USER_A, USER_B],
        [USER_B, USER_A],
      ]) {
        await asUser(subject);
        assert.deepEqual(
          (await db.query("select user_id from public.user_workspaces")).rows,
          [{ user_id: subject }],
        );
        assert.deepEqual(
          (
            await db.query(
              "select * from public.user_workspaces where user_id = $1",
              [other],
            )
          ).rows,
          [],
        );
        const changed = await db.query(
          "update public.user_workspaces set data = $1::jsonb where user_id = $2 returning user_id",
          [JSON.stringify(workspace("Forged")), other],
        );
        assert.deepEqual(changed.rows, []);
        assert.equal(changed.affectedRows, 0);
        const deleted = await db.query(
          "delete from public.user_workspaces where user_id = $1 returning user_id",
          [other],
        );
        assert.deepEqual(deleted.rows, []);
        assert.equal(deleted.affectedRows, 0);
      }
      await db.exec("reset role");
      const all = await db.query<{ user_id: string; name: string }>(
        "select user_id, data->'profile'->>'name' as name from public.user_workspaces order by user_id",
      );
      assert.deepEqual(all.rows, [
        { user_id: USER_A, name: "Test A" },
        { user_id: USER_B, name: "Test B" },
      ]);
    });

    test("WITH CHECK denies foreign insertion, owner reassignment and conflict-upsert attacks", async () => {
      await asUser(USER_A);
      await insert(USER_A, "Test A");
      // B is a real fixture user, but has no workspace yet: no PK conflict can mask the RLS check.
      await expectDenied(insert(USER_B, "Forged B"));
      await expectDenied(
        db.query(
          "update public.user_workspaces set user_id = $1 where user_id = $2",
          [USER_B, USER_A],
        ),
      );
      await db.exec("reset role");
      await insert(USER_B, "Test B");
      await asUser(USER_A);
      await expectDenied(
        db.query(
          `
      insert into public.user_workspaces (user_id, data) values ($1, $2::jsonb)
      on conflict (user_id) do update set data = excluded.data returning user_id
    `,
          [USER_B, JSON.stringify(workspace("Forged upsert"))],
        ),
      );
      await db.exec("reset role");
      const rows = await db.query<{ user_id: string; name: string }>(
        "select user_id, data->'profile'->>'name' as name from public.user_workspaces order by user_id",
      );
      assert.deepEqual(rows.rows, [
        { user_id: USER_A, name: "Test A" },
        { user_id: USER_B, name: "Test B" },
      ]);
    });

    test("authenticated default privileges cannot bypass row isolation through TRUNCATE", async () => {
      await seedBoth();
      await asUser(USER_A);
      const privileges = await db.query<{
        truncate: boolean;
        references: boolean;
        trigger: boolean;
      }>(`
        select has_table_privilege(current_user, 'public.user_workspaces', 'TRUNCATE') as truncate,
          has_table_privilege(current_user, 'public.user_workspaces', 'REFERENCES') as references,
          has_table_privilege(current_user, 'public.user_workspaces', 'TRIGGER') as trigger
      `);
      assert.deepEqual(privileges.rows, [
        { truncate: false, references: false, trigger: false },
      ]);
      await expectDenied(db.query("truncate public.user_workspaces"));
      await db.exec("reset role");
      assert.equal(
        (await db.query("select user_id from public.user_workspaces")).rows
          .length,
        2,
      );
    });

    test("authenticated role without an identity sees no private rows and cannot insert", async () => {
      await seedBoth();
      await asUser(null);
      assert.deepEqual(
        (await db.query("select * from public.user_workspaces")).rows,
        [],
      );
      await expectDenied(insert(USER_A, "No verified subject"));
    });

    test("anon lacks table access even when the harness supplies a subject claim", async () => {
      await seedBoth();
      await asUser(USER_A, "anon");
      await expectDenied(db.query("select * from public.user_workspaces"));
      await expectDenied(insert(USER_A, "Anonymous write"));
      await expectDenied(
        db.query(
          "update public.user_workspaces set data = $1::jsonb where user_id = $2",
          [JSON.stringify(workspace("Anonymous update")), USER_A],
        ),
      );
      await expectDenied(
        db.query("delete from public.user_workspaces where user_id = $1", [
          USER_A,
        ]),
      );
    });

    test("the actual foreign key cascades user deletion and prevents an orphan workspace", async () => {
      await seedBoth();
      await db.exec("reset role");
      await db.query("delete from auth.users where id = $1", [USER_A]);
      assert.deepEqual(
        (await db.query("select user_id from public.user_workspaces")).rows,
        [{ user_id: USER_B }],
      );
      await asUser(USER_A);
      assert.deepEqual(
        (await db.query("select * from public.user_workspaces")).rows,
        [],
      );
      await assert.rejects(insert(USER_A, "Deleted user"), { code: "23503" });
      await asUser(USER_B);
      assert.deepEqual(
        (await db.query("select user_id from public.user_workspaces")).rows,
        [{ user_id: USER_B }],
      );
    });

    test("database shape and byte-size constraints reject malformed owner data", async () => {
      await asUser(USER_A);
      for (const data of [
        {},
        { ...workspace("A"), profile: null },
        { ...workspace("A"), savedProviderIds: {} },
        { ...workspace("A"), notes: [] },
        { ...workspace("A"), tasks: {} },
        { ...workspace("A"), notes: { oversized: "x".repeat(131072) } },
      ]) {
        await assert.rejects(
          db.query(
            "insert into public.user_workspaces (user_id, data) values ($1, $2::jsonb)",
            [USER_A, JSON.stringify(data)],
          ),
          { code: "23514" },
        );
      }
      assert.deepEqual(
        (await db.query("select * from public.user_workspaces")).rows,
        [],
      );
    });
  },
);
