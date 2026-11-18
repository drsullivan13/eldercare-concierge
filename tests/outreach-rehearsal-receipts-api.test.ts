import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("rehearsal report read is owner and request scoped, paginated, and only returns report fields", async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherRequest = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const createdAt = "2026-11-18T19:14:00.000001+00:00";
  const runId = (number: number) =>
    `33333333-3333-4333-8333-${String(number).padStart(12, "0")}`;
  const row = (id: number, ownerId = owner, request = requestId) => ({
    owner_id: ownerId,
    request_id: request,
    run_id: runId(id),
    created_at: createdAt,
    outcome: {
      status: "completed",
      takeaways: ["Ask about weekend availability."],
      nextSteps: [],
    },
    transcript: "raw transcript must not be projected",
  });
  const rows = [
    ...Array.from({ length: 12 }, (_, index) => row(12 - index)),
    row(13, other),
    row(14, owner, otherRequest),
  ];
  let signedIn: string | null = null;
  let anonymous = false;
  let unavailable = false;
  const stubs = {
    client() {
      return {
        auth: {
          getUser: async () => ({
            data: {
              user: signedIn ? { id: signedIn, is_anonymous: anonymous } : null,
            },
          }),
        },
        from(table: string) {
          assert.equal(table, "outreach_rehearsal_receipts");
          const filters = new Map<string, string>();
          let before: string | undefined;
          const order: string[] = [];
          const query = {
            select(columns: string) {
              assert.equal(columns, "run_id, request_id, outcome, created_at");
              return query;
            },
            eq(key: string, value: string) {
              filters.set(key, value);
              return query;
            },
            or(condition: string) {
              const matched = condition.match(
                /^created_at\.lt\.([^,]+),and\(created_at\.eq\.\1,run_id\.lt\.([0-9a-f-]+)\)$/,
              );
              assert.ok(matched);
              assert.equal(matched[1], createdAt);
              before = matched[2];
              return query;
            },
            order(column: string, options: { ascending: boolean }) {
              assert.equal(options.ascending, false);
              order.push(column);
              return query;
            },
            async limit(size: number) {
              assert.deepEqual(order, ["created_at", "run_id"]);
              assert.equal(size, 11);
              assert.equal(filters.get("owner_id"), signedIn);
              assert.equal(filters.size, 2);
              if (unavailable)
                return {
                  data: null,
                  error: new Error("Private database message"),
                };
              return {
                data: rows
                  .filter(
                    (candidate) =>
                      candidate.owner_id === filters.get("owner_id") &&
                      candidate.request_id === filters.get("request_id") &&
                      (!before || candidate.run_id < before),
                  )
                  .slice(0, size),
                error: null,
              };
            },
          };
          return query;
        },
      };
    },
  };
  const bundle = await build({
    entryPoints: ["src/app/api/outreach-rehearsal-receipts/route.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "authenticated-rehearsal-test",
        setup(builder) {
          builder.onResolve(
            { filter: /^@\/lib\/supabase\/server$/ },
            ({ path }) => ({ namespace: "test", path }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const isSupabaseConfigured=()=>true; export const createClient=()=>stubs.client();",
          }));
        },
      },
    ],
  });
  const bundled = {
    exports:
      {} as typeof import("../src/app/api/outreach-rehearsal-receipts/route"),
  };
  new Function(
    "require",
    "stubs",
    "module",
    "exports",
    bundle.outputFiles[0].text,
  )(require, stubs, bundled, bundled.exports);
  const get = (params: Record<string, string>) =>
    bundled.exports.GET(
      new Request(
        `https://harbor.example/api/outreach-rehearsal-receipts?${new URLSearchParams(params)}`,
      ),
    );

  assert.equal((await get({ requestId })).status, 401);
  signedIn = owner;
  anonymous = true;
  assert.equal((await get({ requestId })).status, 401);
  anonymous = false;
  assert.equal(
    (await get({ requestId, before: "invalid,or(injection)" })).status,
    400,
  );
  assert.equal((await get({ requestId, owner })).status, 400);

  const first = await get({ requestId });
  assert.equal(first.status, 200);
  assert.equal(
    first.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.equal(first.headers.get("vary"), "Cookie");
  const firstPage = await first.json();
  assert.deepEqual(
    firstPage.receipts.map(({ runId }: { runId: string }) => runId),
    Array.from({ length: 10 }, (_, index) => runId(12 - index)),
  );
  assert.deepEqual(firstPage.receipts[0], {
    runId: runId(12),
    requestId,
    createdAt,
    outcome: rows[0].outcome,
  });
  assert.equal(firstPage.nextCursor, `${createdAt}|${runId(3)}`);
  const second = await get({ requestId, before: firstPage.nextCursor });
  const secondPage = await second.json();
  assert.deepEqual(
    secondPage.receipts.map(({ runId }: { runId: string }) => runId),
    [runId(2), runId(1)],
  );
  assert.equal(secondPage.nextCursor, null);
  signedIn = other;
  assert.deepEqual(
    (await (await get({ requestId })).json()).receipts.map(
      ({ runId }: { runId: string }) => runId,
    ),
    [runId(13)],
  );
  assert.deepEqual(await (await get({ requestId: otherRequest })).json(), {
    receipts: [],
    nextCursor: null,
  });
  unavailable = true;
  assert.equal((await get({ requestId })).status, 503);
});
