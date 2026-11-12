import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Actual SQL in local PostgreSQL/WASM. Does not validate hosted claims, Edge auth,
// concurrent database sessions, pg_net, Vault, or external API entitlements.
const schema = readFileSync("supabase/research-pipeline.sql", "utf8");
const catalog = JSON.parse(readFileSync("src/data/providers.json", "utf8")) as {
  id: string;
  name: string;
  category: string;
  address?: string;
}[];
type Job = {
  job_id: string;
  lease_token: string;
  source_key: string;
  attempt: number;
  source_last_snapshot_hash: string | null;
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe(
  "research pipeline: actual private schema and service-only RPCs",
  { concurrency: false, timeout: 60_000 },
  () => {
    let db: PGlite;
    before(async () => {
      db = await PGlite.create();
      await db.exec(`
      create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create role service_role nologin nosuperuser nobypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges grant execute on functions to public;
    `);
      await db.exec(schema);
    });
    after(async () => {
      if (db) await db.close();
    });
    beforeEach(async () => {
      await db.exec("reset role");
      await db.exec(`truncate harbor_research.candidates,harbor_research.snapshots,
      harbor_research.attempts,harbor_research.jobs,harbor_research.coverage,
      harbor_research.sources,harbor_research.catalog_entities,harbor_research.daily_budgets`);
      await db.query(
        `insert into harbor_research.catalog_entities(provider_id,name,care_category,address)
      select x->>'id',x->>'name',x->>'category',x->>'address' from jsonb_array_elements($1::jsonb) x`,
        [JSON.stringify(catalog)],
      );
      await db.query(
        `insert into harbor_research.sources(source_key,connector,enabled,rights_approved,collection_scope,config) values
      ('catalog','catalog',false,false,'manual_only','{}'),
      ('survey:227068','cms',true,true,'official_public_data',$1::jsonb),
      ('survey:227098','cms',true,true,'official_public_data',$2::jsonb),
      ('yelp:brooksby','yelp',true,true,'identifiers_capability_only',$3::jsonb),
      ('disabled','cms',false,true,'official_public_data','{}'),
      ('unapproved','cms',true,false,'official_public_data','{}')`,
        [
          JSON.stringify({
            provider_id: "vna-care",
            ccn: "227068",
            dataset_id: "ccn4-8vby",
            repeat: true,
          }),
          JSON.stringify({
            provider_id: "vna-care",
            ccn: "227098",
            dataset_id: "ccn4-8vby",
            repeat: true,
          }),
          JSON.stringify({
            provider_id: "lifeplan-brooksby-village",
            repeat: false,
          }),
        ],
      );
      await db.exec(`insert into harbor_research.coverage(provider_id,source_key)
      select provider_id,'catalog' from harbor_research.catalog_entities`);
      await db.exec("set role service_role");
    });
    async function enqueue(
      source = "survey:227068",
      key = crypto.randomUUID(),
      provider = "vna-care",
      payload = {},
    ) {
      const r = await db.query<{ id: string }>(
        `select public.harbor_research_enqueue_job($1,$2,$3::jsonb,$4) as id`,
        [source, provider, JSON.stringify(payload), key],
      );
      return r.rows[0].id;
    }
    async function claim(worker = "local-test", count = 1) {
      return (
        await db.query<Job>(
          "select * from public.harbor_research_claim_jobs($1,$2)",
          [worker, count],
        )
      ).rows;
    }
    async function complete(job: Job, outcome: Record<string, unknown>) {
      return (
        await db.query<{
          result: { status: string; candidates_queued: number };
        }>(
          "select public.harbor_research_complete_job($1,$2,$3::jsonb) as result",
          [job.job_id, job.lease_token, JSON.stringify(outcome)],
        )
      ).rows[0].result;
    }
    function observation(
      content = '{"ccn":"227068","stars":4,"completed_surveys":512}',
    ) {
      return {
        status: "succeeded",
        http_status: 200,
        source_url:
          "https://data.cms.gov/provider-data/api/1/datastore/query/ccn4-8vby/0",
        snapshot: {
          sha256: hash(content),
          content,
          metadata: { dataset_id: "ccn4-8vby", checked_at: "2026-11-12" },
        },
        candidates: [
          {
            kind: "cms-survey",
            summary:
              "New exact reporting-unit survey row; review before publication.",
            data: {
              ccn: "227068",
              stars: 4,
              completed_surveys: 512,
              period: "2025-04-01/2026-03-31",
              parser_version: "test-1",
            },
          },
        ],
      };
    }
    async function denied(promise: Promise<unknown>, code = "42501") {
      await assert.rejects(promise, (error: unknown) => {
        assert.equal((error as { code?: string }).code, code);
        return true;
      });
    }

    test("521 real catalog identities retain source coverage without pretending collection succeeded", async () => {
      assert.equal(catalog.length, 521);
      const r = await db.query<{
        state: { registry_count: number; coverage_count: number; jobs: object };
      }>("select public.harbor_research_status() as state");
      assert.equal(r.rows[0].state.registry_count, 521);
      assert.equal(r.rows[0].state.coverage_count, 521);
      assert.deepEqual(r.rows[0].state.jobs, {});
      assert.deepEqual(
        (await db.query("select distinct status from harbor_research.coverage"))
          .rows,
        [{ status: "not_checked" }],
      );
      await assert.rejects(
        enqueue("disabled", "bad-entity", "not-a-real-provider"),
        { code: "23503" },
      );
      await denied(
        enqueue("survey:227068", "wrong-unit-owner", "south-shore-vna"),
        "22023",
      );
    });

    test("anon/authenticated cannot read evidence, alter tables, reserve budget, or invoke any worker RPC", async () => {
      const calls = [
        "select public.harbor_research_status()",
        "select public.harbor_research_enqueue_due_jobs()",
        "select * from public.harbor_research_claim_jobs('attack',1)",
        "select public.harbor_research_reserve_budget('yelp',1)",
        "select public.harbor_research_enqueue_job('survey:227068','vna-care','{}','attack')",
        'select public.harbor_research_complete_job(gen_random_uuid(),gen_random_uuid(),\'{"status":"succeeded"}\')',
      ];
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`reset role; set role ${role}`);
        for (const query of calls) await denied(db.query(query));
        for (const table of [
          "catalog_entities",
          "sources",
          "coverage",
          "jobs",
          "attempts",
          "snapshots",
          "candidates",
          "daily_budgets",
        ]) {
          await denied(db.query(`select * from harbor_research.${table}`));
          await denied(db.exec(`truncate harbor_research.${table} cascade`));
        }
      }
      await db.exec("reset role; set role service_role");
      await denied(db.exec("truncate harbor_research.jobs cascade"));
      const attrs = await db.query<{
        superuser: boolean;
        bypass: boolean;
        rls: boolean;
      }>(`select r.rolsuper superuser,r.rolbypassrls bypass,
      row_security_active('harbor_research.jobs') rls from pg_roles r where r.rolname=current_user`);
      assert.deepEqual(attrs.rows, [
        { superuser: false, bypass: false, rls: true },
      ]);
      const fn = await db.query<{
        unsafe: number;
      }>(`select count(*)::int unsafe from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'harbor_research_%' and p.prosecdef`);
      assert.equal(
        fn.rows[0].unsafe,
        0,
        "RPCs must not silently become SECURITY DEFINER",
      );
    });

    test("enqueue is idempotent, rejects reused identities, skips disabled sources and creates UTC recurrence once", async () => {
      const first = await enqueue("survey:227068", "same-work");
      assert.equal(await enqueue("survey:227068", "same-work"), first);
      await denied(enqueue("survey:227098", "same-work"), "22023");
      await enqueue("disabled", "disabled");
      await enqueue("unapproved", "unapproved");
      const initial = await db.query<{ n: number }>(
        "select public.harbor_research_enqueue_due_jobs() n",
      );
      assert.equal(initial.rows[0].n, 3);
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select public.harbor_research_enqueue_due_jobs() n",
          )
        ).rows[0].n,
        0,
      );
      const jobs = await claim("worker-A", 10);
      assert.equal(jobs.length, 4); // Explicit first job + two recurring CMS + initial Yelp.
      assert.ok(
        jobs.every((j) => !["disabled", "unapproved"].includes(j.source_key)),
      );
      assert.equal(
        (await claim("worker-B", 10)).length,
        0,
        "Live leases cannot be claimed twice",
      );
      await denied(claim("bad", 100), "22023");
    });

    test("RLS still denies HTTP roles if table/schema grants are accidentally broadened", async () => {
      await enqueue();
      await db.exec(`reset role; grant usage on schema harbor_research to authenticated;
      grant select,insert,update,delete on harbor_research.jobs to authenticated; set role authenticated`);
      assert.deepEqual(
        (await db.query("select id from harbor_research.jobs")).rows,
        [],
      );
      await denied(
        db.query(`insert into harbor_research.jobs(source_key,provider_id,dedupe_key)
      values('survey:227068','vna-care','forged')`),
      );
      assert.deepEqual(
        (
          await db.query(
            "update harbor_research.jobs set status='failed' returning id",
          )
        ).rows,
        [],
      );
      assert.deepEqual(
        (await db.query("delete from harbor_research.jobs returning id")).rows,
        [],
      );
      await db.exec(`reset role; revoke all on harbor_research.jobs from authenticated;
      revoke usage on schema harbor_research from authenticated; set role service_role`);
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from harbor_research.jobs",
          )
        ).rows[0].n,
        1,
      );
    });

    test("disabling a source after claim blocks completion and leaves no staged content", async () => {
      await enqueue();
      const [j] = await claim();
      await db.query(
        "update harbor_research.sources set enabled=false where source_key=$1",
        [j.source_key],
      );
      await denied(complete(j, observation()));
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from harbor_research.snapshots",
          )
        ).rows[0].n,
        0,
      );
    });

    test("successful CMS completion atomically stores hash-verified raw evidence and a human-review candidate", async () => {
      await enqueue();
      const [job] = await claim();
      const result = await complete(job, observation());
      assert.equal(result.status, "succeeded");
      assert.equal(result.candidates_queued, 1);
      const rows = await db.query<{
        status: string;
        content: string;
        sha256: string;
        review_status: string;
        cc: string;
      }>(`
      select a.status,sn.content,sn.sha256,c.review_status,c.data->>'ccn' cc
      from harbor_research.attempts a join harbor_research.snapshots sn on sn.job_id=a.job_id
      join harbor_research.candidates c on c.snapshot_id=sn.id`);
      assert.equal(rows.rows[0].sha256, hash(rows.rows[0].content));
      assert.equal(rows.rows[0].review_status, "pending");
      assert.equal(rows.rows[0].cc, "227068");
      await denied(complete(job, observation()), "55000");
      const cov = await db.query<{
        status: string;
        success: boolean;
      }>(`select status,last_success_at is not null success
      from harbor_research.coverage where source_key='survey:227068'`);
      assert.deepEqual(cov.rows, [{ status: "collected", success: true }]);
    });

    test("invalid late candidate or hash mismatch rolls back snapshot, attempt, coverage and queue changes", async () => {
      await enqueue();
      const [job] = await claim();
      const wrongHash = observation();
      wrongHash.snapshot.sha256 = "0".repeat(64);
      await denied(complete(job, wrongHash), "22023");
      const badCandidate = {
        ...observation(),
        candidates: [
          ...observation().candidates,
          { kind: "unsafe", summary: "bad", data: {} },
        ],
      };
      await denied(complete(job, badCandidate), "22023");
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from harbor_research.snapshots",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from harbor_research.candidates",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from harbor_research.attempts",
          )
        ).rows[0].status,
        "running",
      );
      await denied(
        complete(job, { status: "succeeded", http_status: 200 }),
        "22023",
      );
      await complete(job, observation());
    });

    test("expired lease is fenced, recovered once, and old worker cannot commit after recovery", async () => {
      await enqueue();
      const [old] = await claim("old-worker");
      await db.query(
        "update harbor_research.jobs set lease_expires_at=now()-interval '1 second' where id=$1",
        [old.job_id],
      );
      await denied(complete(old, observation()), "55000");
      const [fresh] = await claim("new-worker");
      assert.equal(fresh.job_id, old.job_id);
      assert.notEqual(fresh.lease_token, old.lease_token);
      assert.equal(fresh.attempt, 2);
      await denied(complete(old, observation()), "55000");
      await complete(fresh, observation());
      assert.deepEqual(
        (
          await db.query(
            "select status from harbor_research.attempts order by attempt",
          )
        ).rows,
        [{ status: "lease_expired" }, { status: "succeeded" }],
      );
    });

    test("same content is deduplicated and last hash stays scoped to exact CCN, including reverting content", async () => {
      await enqueue();
      let [j] = await claim();
      const a = observation();
      await complete(j, a);
      await enqueue();
      [j] = await claim();
      assert.equal(j.source_last_snapshot_hash, a.snapshot.sha256);
      await complete(j, a);
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from harbor_research.candidates",
          )
        ).rows[0].n,
        1,
      );
      const b = observation('{"ccn":"227068","stars":3}');
      await enqueue();
      [j] = await claim();
      await complete(j, b);
      await enqueue();
      [j] = await claim();
      assert.equal(j.source_last_snapshot_hash, b.snapshot.sha256);
      await complete(j, a);
      await enqueue();
      [j] = await claim();
      assert.equal(j.source_last_snapshot_hash, a.snapshot.sha256);
      await complete(j, { status: "unchanged", http_status: 304 });
      await enqueue("survey:227098");
      [j] = await claim();
      assert.equal(j.source_last_snapshot_hash, null);
      await denied(
        complete(j, { status: "unchanged", http_status: 304 }),
        "22023",
      );
    });

    test("retry honors Retry-After, cannot run early, stops at4attempts, and HTTP403 is blocked", async () => {
      const id = await enqueue();
      for (let n = 1; n <= 4; n++) {
        const [j] = await claim();
        assert.equal(j.attempt, n);
        const out = await complete(j, {
          status: "retry",
          http_status: 429,
          error_code: "RATE_LIMITED",
          retry_after_seconds: 600,
        });
        assert.equal(out.status, n === 4 ? "failed" : "retry");
        assert.equal((await claim()).length, 0);
        if (n < 4) {
          const d = await db.query<{ seconds: number }>(
            "select extract(epoch from run_after-now())::int seconds from harbor_research.jobs where id=$1",
            [id],
          );
          assert.ok(d.rows[0].seconds >= 599);
          await db.query(
            "update harbor_research.jobs set run_after=now()-interval '1 second' where id=$1",
            [id],
          );
        }
      }
      await enqueue();
      const [blocked] = await claim();
      assert.equal(
        (
          await complete(blocked, {
            status: "retry",
            http_status: 403,
            error_code: "FORBIDDEN",
          })
        ).status,
        "blocked",
      );
      assert.equal((await claim()).length, 0);
    });

    test("all Yelp jobs share25requests/day; failed reservations and callers cannot overspend", async () => {
      for (let i = 0; i < 25; i++) {
        const r = await db.query<{ r: { reserved: boolean; used: number } }>(
          "select public.harbor_research_reserve_budget('yelp',1) r",
        );
        assert.equal(r.rows[0].r.reserved, true);
        assert.equal(r.rows[0].r.used, i + 1);
      }
      const r = await db.query<{
        r: { reserved: boolean; used: number; remaining: number };
      }>("select public.harbor_research_reserve_budget('yelp',1) r");
      assert.equal(r.rows[0].r.reserved, false);
      assert.equal(r.rows[0].r.used, 25);
      assert.equal(r.rows[0].r.remaining, 0);
      await denied(
        db.query("select public.harbor_research_reserve_budget('yelp',-1)"),
        "22023",
      );
    });

    test("Yelp capability collection retains only listing IDs/URL and bounded capability flags, rejects reviews/ratings/raw text", async () => {
      await enqueue("yelp:brooksby", "yelp-pilot", "lifeplan-brooksby-village");
      const [j] = await claim();
      for (const forbidden of [
        { snapshot: { content: "review", sha256: hash("review") } },
        { candidates: [] },
        { reviews: ["review excerpt"] },
        { rating: 4.5 },
        { error_message: "Bearer super-secret-key" },
        { capabilities: { reviews: "unbounded raw text" } },
        { listing_url: "https://www.yelp.com/biz/example?api_key=secret" },
        { source_url: "https://attacker.invalid/?token=secret" },
      ])
        await denied(
          complete(j, { status: "succeeded", http_status: 200, ...forbidden }),
          "22023",
        );
      const r = await complete(j, {
        status: "blocked",
        http_status: 403,
        error_code: "ENDPOINT_NOT_AUTHORIZED",
        listing_id: "known-location-id",
        listing_url: "https://www.yelp.com/biz/known-location",
        capabilities: {
          business_match: "available",
          business_details: "available",
          reviews: "forbidden",
        },
      });
      assert.equal(r.status, "blocked");
      const a = await db.query<{ safe_metadata: object }>(
        "select safe_metadata from harbor_research.attempts",
      );
      assert.deepEqual(a.rows[0].safe_metadata, {
        listing_id: "known-location-id",
        listing_url: "https://www.yelp.com/biz/known-location",
        capabilities: {
          reviews: "forbidden",
          business_match: "available",
          business_details: "available",
        },
      });
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from harbor_research.snapshots",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from harbor_research.candidates",
          )
        ).rows[0].n,
        0,
      );
    });
  },
);
