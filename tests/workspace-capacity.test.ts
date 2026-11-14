import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createEmptyWorkspace, MAX_WORKSPACE_BYTES, validateWorkspace, type Workspace } from "../src/lib/workspace";
import type { OutreachRecord } from "../src/lib/outreach";

const LIMIT = 2_097_152;
const DB_LIMIT = 3_145_728;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const schema = readFileSync("supabase/schema.sql", "utf8");
const migration = readFileSync("supabase/workspace-capacity.sql", "utf8");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const at = "2026-11-14T00:00:00.000Z";

function reportsAt(target: number, unit = "x"): Workspace {
  const workspace = createEmptyWorkspace();
  workspace.updatedAt = at;
  workspace.profile.careTypes = Array.from({ length: 20 }, (_, i) => `Care ${i}`);
  workspace.savedProviderIds = Array.from({ length: 100 }, (_, i) => `provider-${i}`);
  workspace.notes = Object.fromEntries(workspace.savedProviderIds.map((id) => [id, "Confirm the visit."]));
  workspace.tasks = workspace.savedProviderIds.map((providerId, i) => ({
    id: `task-${i}`, title: "Call the office", category: "Care",
    dueDate: "2026-12-01", status: "todo", providerId,
  }));
  workspace.outreach = workspace.savedProviderIds.map((providerId, i): OutreachRecord => ({
    brief: {
      providerId, providerName: `Care office ${i}`, phone: "+12015550100",
      requestId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      readKey: "a".repeat(64), topics: ["Costs", "Visits", "Staff", "Transport", "Meals", "Availability"],
      question: "What should the family confirm?", previous: "Confirm costs and transport.",
    },
    createdAt: at, updatedAt: at, state: "completed",
    parentId: `00000000-0000-4000-8001-${String(i).padStart(12, "0")}`,
    findings: Array.from({ length: 16 }, (_, n) => `Finding ${n}: Confirm care options.`),
    nextSteps: Array.from({ length: 12 }, (_, n) => `Step ${n}: Contact the care team.`),
    activity: Array.from({ length: 128 }, (_, n) => ({
      state: "connected", at: new Date(Date.parse(at) + n * 1000).toISOString(),
    })),
    commitments: Array.from({ length: 8 }, (_, n) => ({
      kind: "proposed", text: `Proposal ${n}: `.padEnd(320, "a"),
    })),
  }));
  let remaining = target - bytes(workspace);
  assert.ok(remaining >= 0);
  for (const record of workspace.outreach) {
    for (const details of [record.findings, record.nextSteps]) {
      for (let i = 0; i < details.length; i++) {
        const count = Math.min(1200 - details[i].length, Math.floor(remaining / Buffer.byteLength(unit)));
        details[i] += unit.repeat(count);
        remaining -= count * Buffer.byteLength(unit);
        const tail = Math.min(1200 - details[i].length, remaining % Buffer.byteLength(unit));
        details[i] += "x".repeat(tail);
        remaining -= tail;
      }
    }
  }
  assert.equal(remaining, 0, "Target fits bounded report fields");
  assert.equal(bytes(workspace), target);
  return workspace;
}

for (const unit of ["x", "家"]) {
  test(`compact ${unit === "x" ? "ASCII" : "UTF-8"} accepts 2 MiB and rejects one byte over`, () => {
    assert.equal(MAX_WORKSPACE_BYTES, LIMIT);
    for (const size of [LIMIT - 1, LIMIT, LIMIT + 1]) {
      const workspace = reportsAt(size, unit);
      if (unit === "家") assert.ok(JSON.stringify(workspace).includes(unit));
      assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(workspace))), size <= LIMIT
        ? { ok: true, workspace }
        : { ok: false, error: "Workspace exceeds the 2 MiB limit." });
    }
  });
}

test("fresh and live 128 KiB schemas converge without losing rows and enforce 3 MiB JSONB", { timeout: 30_000 }, async () => {
  let freshConstraint: unknown;
  for (const legacy of [false, true]) {
    const db = await PGlite.create();
    try {
      await db.exec(`
        create role anon; create role authenticated;
        create schema auth; create table auth.users (id uuid primary key);
        create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      `);
      await db.exec(schema);
      if (legacy) await db.exec(`alter table public.user_workspaces
        drop constraint workspace_size,
        add constraint workspace_size check (octet_length(data::text) <= 131072)`);
      await db.query("insert into auth.users values ($1), ($2)", [A, B]);
      const old = createEmptyWorkspace();
      await db.query("insert into public.user_workspaces (user_id, data) values ($1, $3::jsonb), ($2, $3::jsonb)", [A, B, JSON.stringify(old)]);
      const update = (data: unknown) => db.query("update public.user_workspaces set data=$1::jsonb where user_id=$2 returning data", [JSON.stringify(data), A]);
      const rows = () => db.query("select * from public.user_workspaces order by user_id");
      if (legacy) {
        await assert.rejects(update(reportsAt(LIMIT)), { code: "23514", constraint: "workspace_size" });
        const before = await rows();
        const metadata = () => db.query(`select c.oid, c.relacl::text, c.relrowsecurity, c.relforcerowsecurity,
          (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid=c.oid) as policies,
          (select jsonb_agg(to_jsonb(k) order by k.oid) from pg_constraint k
            where k.conrelid=c.oid and k.conname <> 'workspace_size') as constraints
          from pg_class c where c.oid='public.user_workspaces'::regclass`);
        const unchanged = await metadata();
        for (let retry = 0; retry < 2; retry++) {
          await db.exec(migration);
          assert.deepEqual(await rows(), before);
          assert.deepEqual(await metadata(), unchanged);
        }
      }
      const constraint = (await db.query(`select pg_get_constraintdef(oid) as definition, convalidated
        from pg_constraint where conrelid='public.user_workspaces'::regclass and conname='workspace_size'`)).rows;
      if (legacy) assert.deepEqual(constraint, freshConstraint);
      else freshConstraint = constraint;
      for (const unit of ["x", "家"]) {
        const workspace = reportsAt(LIMIT, unit);
        assert.deepEqual(validateWorkspace(workspace), { ok: true, workspace });
        await db.query("delete from public.user_workspaces where user_id=$1", [A]);
        assert.deepEqual((await db.query("insert into public.user_workspaces (user_id, data) values ($1, $2::jsonb) returning data", [A, JSON.stringify(workspace)])).rows, [{ data: workspace }]);
        assert.deepEqual((await update(workspace)).rows, [{ data: workspace }]);
        assert.deepEqual((await db.query("select data from public.user_workspaces where user_id=$1", [A])).rows, [{ data: workspace }]);
        const { rows: sizes } = await db.query<{ size: number }>("select octet_length(data::text) as size from public.user_workspaces where user_id=$1", [A]);
        assert.ok(sizes[0].size > LIMIT && sizes[0].size < DB_LIMIT);
      }
      const base = { ...old, notes: { p: "" } };
      const { rows: sizes } = await db.query<{ size: number }>("select octet_length($1::jsonb::text) as size", [JSON.stringify(base)]);
      base.notes.p = "a".repeat(DB_LIMIT - sizes[0].size);
      await update(base);
      base.notes.p += "a";
      await assert.rejects(update(base), { code: "23514", constraint: "workspace_size" });
      assert.deepEqual((await db.query("select octet_length(data::text) as size from public.user_workspaces where user_id=$1", [A])).rows, [{ size: DB_LIMIT }]);
      await db.query("delete from public.user_workspaces where user_id=$1", [B]);
      await assert.rejects(db.query("insert into public.user_workspaces (user_id, data) values ($1, $2::jsonb)", [B, JSON.stringify(base)]), { code: "23514", constraint: "workspace_size" });
      base.notes.p = base.notes.p.slice(0, -1);
      assert.deepEqual((await db.query("insert into public.user_workspaces (user_id, data) values ($1, $2::jsonb) returning data", [B, JSON.stringify(base)])).rows, [{ data: base }]);
    } finally {
      await db.close();
    }
  }
});
