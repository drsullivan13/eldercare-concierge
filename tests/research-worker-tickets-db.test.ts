import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Real PostgreSQL SQL and pgcrypto, with only pg_net's external transport mocked.
// These tests do not prove hosted pg_net ACLs, Edge authorization, or concurrent
// independent database sessions. No bearer value is printed or written to disk.
const migration = readFileSync("supabase/research-worker-tickets.sql", "utf8");
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const testHash = () => digest(randomBytes(32).toString("hex"));

describe(
  "one-use worker tickets: actual private SQL and cryptography",
  { concurrency: false, timeout: 60_000 },
  () => {
    let db: PGlite;
    before(async () => {
      db = await PGlite.create({ extensions: { pgcrypto } });
      await db.exec(`
      create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create role service_role nologin nosuperuser nobypassrls;
      create schema harbor_research; create schema extensions; create schema net;
      create extension pgcrypto with schema extensions;
      grant usage on schema public to anon,authenticated,service_role;
      alter default privileges in schema harbor_research grant all on tables to anon,authenticated,service_role;
      create table net.test_requests(id bigint generated always as identity primary key,
        url text,body jsonb,headers jsonb,timeout_ms integer);
      create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',
        headers jsonb default '{}',timeout_milliseconds integer default 2000)
      returns bigint language sql security invoker as $$
        insert into net.test_requests(url,body,headers,timeout_ms)
        values($1,$2,$4,$5) returning id
      $$;
      -- Model the signature already used by Cron. It must be replaced, not renamed.
      create function harbor_research.invoke_worker(operation text default 'run')
        returns bigint language sql as $$ select 0::bigint $$;
    `);
      await db.exec(migration);
    });
    after(async () => {
      if (db) await db.close();
    });
    beforeEach(async () => {
      await db.exec(
        "reset role; truncate harbor_research.worker_tickets; truncate net.test_requests restart identity",
      );
    });
    async function seed(
      hash = testHash(),
      operation = "run",
      ageSeconds = 0,
      used = false,
    ) {
      await db.exec("reset role");
      await db.query(
        `insert into harbor_research.worker_tickets(hash,operation,created_at,expires_at,used_at)
      values($1,$2,clock_timestamp()-make_interval(secs=>$3::integer),
        clock_timestamp()-make_interval(secs=>$3::integer)+interval '90 seconds',
        case when $4 then clock_timestamp()-make_interval(secs=>$3::integer)+interval '1 second' else null end)`,
        [hash, operation, ageSeconds, used],
      );
      return hash;
    }
    async function consume(
      hash: string | null,
      operation: string | null = "run",
    ) {
      const r = await db.query<{ consumed: boolean }>(
        "select public.harbor_research_consume_worker_ticket($1,$2) consumed",
        [hash, operation],
      );
      return r.rows[0].consumed;
    }
    async function service() {
      await db.exec("reset role; set role service_role");
    }
    async function denied(p: Promise<unknown>) {
      await assert.rejects(p, { code: "42501" });
    }

    test("a correct ticket succeeds once, replay fails and used_at records consumption", async () => {
      const h = await seed();
      await service();
      assert.equal(await consume(h), true);
      assert.equal(await consume(h), false);
      const r = await db.query<{ used: boolean }>(
        "select used_at is not null used from harbor_research.worker_tickets",
      );
      assert.deepEqual(r.rows, [{ used: true }]);
    });

    test("wrong operation/hash and malformed input fail without consuming a usable ticket", async () => {
      const h = await seed();
      await service();
      for (const [value, op] of [
        [h, "status"],
        [testHash(), "run"],
        ["bad", "run"],
        [null, "run"],
        [h, null],
        [h, "other"],
      ]) {
        assert.equal(await consume(value, op), false);
      }
      assert.equal(await consume(h), true);
      const status = await seed(testHash(), "status");
      await service();
      assert.equal(await consume(status, "run"), false);
      assert.equal(await consume(status, "status"), true);
    });

    test("expired tickets fail and the table rejects a lifetime greater than two minutes", async () => {
      const h = await seed(testHash(), "run", 180);
      await service();
      assert.equal(await consume(h), false);
      await db.exec("reset role");
      await assert.rejects(
        db.query(
          `insert into harbor_research.worker_tickets(hash,operation,expires_at)
      values($1,'run',clock_timestamp()+interval '3 minutes')`,
          [testHash()],
        ),
        { code: "23514" },
      );
    });

    test("SQL consumption is one conditional atomic update and rolled-back consumption does not persist", async () => {
      const h = await seed();
      await service();
      await db.exec("begin");
      assert.equal(await consume(h), true);
      await db.exec("rollback");
      const results = await Promise.all(
        Array.from({ length: 8 }, () => consume(h)),
      );
      assert.equal(results.filter(Boolean).length, 1);
      // PGlite serializes its connection. Multi-session contention still needs a hosted test.
      assert.equal(await consume(h), false);
    });

    test("anon/authenticated cannot read/insert/update/truncate tickets or invoke either function", async () => {
      const h = await seed();
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`reset role; set role ${role}`);
        await denied(db.query("select * from harbor_research.worker_tickets"));
        await denied(
          db.query("update harbor_research.worker_tickets set used_at=null"),
        );
        await denied(db.exec("truncate harbor_research.worker_tickets"));
        await denied(consume(h));
        await denied(db.query("select harbor_research.invoke_worker('run')"));
      }
      await service();
      await denied(db.query("select harbor_research.invoke_worker('run')"));
      await denied(db.exec("truncate harbor_research.worker_tickets"));
      await denied(db.query("delete from harbor_research.worker_tickets"));
      await denied(
        db.query(
          "update harbor_research.worker_tickets set expires_at=clock_timestamp()+interval '2 minutes'",
        ),
      );
      await denied(
        db.query(
          `insert into harbor_research.worker_tickets(hash,operation,expires_at)
      values($1,'run',clock_timestamp()+interval '1 minute')`,
          [testHash()],
        ),
      );
      assert.equal(await consume(h), true);
    });

    test("RLS remains protective after accidental table/schema grants", async () => {
      const h = await seed();
      await db.exec(`grant usage on schema harbor_research to authenticated;
      grant select,insert,update,delete on harbor_research.worker_tickets to authenticated;
      set role authenticated`);
      assert.deepEqual(
        (await db.query("select hash from harbor_research.worker_tickets"))
          .rows,
        [],
      );
      assert.deepEqual(
        (
          await db.query(
            "update harbor_research.worker_tickets set used_at=clock_timestamp() returning hash",
          )
        ).rows,
        [],
      );
      await denied(
        db.query(
          `insert into harbor_research.worker_tickets(hash,operation,expires_at)
      values($1,'run',clock_timestamp()+interval '1 minute')`,
          [testHash()],
        ),
      );
      await db.exec(`reset role; revoke all on harbor_research.worker_tickets from authenticated;
      revoke usage on schema harbor_research from authenticated`);
      await service();
      assert.equal(await consume(h), true);
    });

    test("invoker generates a new32-byte token, stores only its hash and binds fixed URL/body/expiry", async () => {
      await db.query("select harbor_research.invoke_worker('run')");
      await db.query("select harbor_research.invoke_worker('status')");
      // Examine mock transport in memory only. Assertions never echo the header/token.
      const r = await db.query<{
        id: number;
        url: string;
        body: { operation: string };
        headers: Record<string, string>;
        timeout_ms: number;
      }>("select * from net.test_requests order by id");
      const tickets = await db.query<{
        hash: string;
        operation: string;
        lifetime: number;
        used: boolean;
      }>(`select hash,operation,
      extract(epoch from expires_at-created_at)::int lifetime,used_at is not null used from harbor_research.worker_tickets`);
      const hashes = new Set<string>();
      for (const req of r.rows) {
        const token = req.headers.Authorization.replace(/^Bearer /, "");
        assert.equal(
          /^[0-9a-f]{64}$/.test(token),
          true,
          "Expected32randombytes encoded as64hex characters",
        );
        const h = digest(token);
        hashes.add(h);
        const ticket = tickets.rows.find((t) => t.hash === h);
        assert.equal(
          Boolean(ticket),
          true,
          "Transport token must map to its SHA256-only database ticket",
        );
        assert.equal(ticket?.operation, req.body.operation);
        assert.equal(ticket?.lifetime, 120);
        assert.equal(ticket?.used, false);
        assert.equal(
          req.url,
          "https://bewwwrokhfowjmzqrglo.supabase.co/functions/v1/research-collector",
        );
        assert.equal(req.timeout_ms, 95000);
        assert.deepEqual(Object.keys(req.headers).sort(), [
          "Authorization",
          "Content-Type",
        ]);
      }
      assert.equal(hashes.size, 2);
      await service();
      for (const ticket of tickets.rows)
        assert.equal(await consume(ticket.hash, ticket.operation), true);
    });

    test("invocation prunes only tickets older than one day, and invalid operations send nothing", async () => {
      await seed(testHash(), "run", 90000);
      await seed(testHash(), "status", 90000, true);
      const recent = await seed(testHash(), "run", 300);
      await db.query("select harbor_research.invoke_worker('run')");
      const r = await db.query<{ n: number }>(
        "select count(*)::int n from harbor_research.worker_tickets",
      );
      assert.equal(r.rows[0].n, 2); // Recently expired ticket + newly generated ticket.
      assert.equal(
        (
          await db.query(
            "select 1 from harbor_research.worker_tickets where hash=$1",
            [recent],
          )
        ).rows.length,
        1,
      );
      await assert.rejects(
        db.query("select harbor_research.invoke_worker('arbitrary')"),
        { code: "22023" },
      );
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from net.test_requests",
          )
        ).rows[0].n,
        1,
      );
      const fn = await db.query<{
        unsafe: number;
      }>(`select count(*)::int unsafe from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='harbor_research' and p.proname='invoke_worker'
        or n.nspname='public' and p.proname='harbor_research_consume_worker_ticket') and p.prosecdef`);
      assert.equal(fn.rows[0].unsafe, 0);
    });
  },
);
