import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
const require = createRequire(resolve("package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  R = "44444444-4444-4444-8444-444444444444";
const fact = {
  id: "33333333-3333-4333-8333-333333333333",
  requestId: R,
  providerId: "north-jersey-hp-hp1234567",
  careZip: "07601",
  kind: "hourly_rate",
  value: "35.00",
  checkedOn: "2020-01-01",
  validUntil: null,
  source: "family_reported_office_response",
};
test("actual private fact handlers verify auth, owner, scope, append retries and payload bounds", async () => {
  let owner: string | null = A,
    unavailable = false,
    queries = 0;
  const rows: Record<string, unknown>[] = [];
  const auth = {
    configured: true,
    createClient: async (headers: Headers) => {
      headers.set("Set-Cookie", "refresh=test; HttpOnly");
      return {
        auth: {
          getUser: async () => ({
            data: { user: owner ? { id: owner } : null },
            error: null,
          }),
        },
        from: (table: string) => {
          assert.equal(table, "inquiry_facts");
          let inserted: Record<string, unknown> | null = null;
          const filters: Record<string, unknown> = {};
          const result = () => {
            queries++;
            assert.equal(filters.owner_id ?? inserted?.owner_id, owner);
            if (unavailable) return { data: null, error: { code: "08006" } };
            if (inserted) {
              if (
                rows.some(
                  (r) =>
                    r.owner_id === inserted!.owner_id && r.id === inserted!.id,
                )
              )
                return { data: null, error: { code: "23505" } };
              rows.push(inserted);
              return { data: { fact: inserted.fact }, error: null };
            }
            return {
              data: rows
                .filter((r) =>
                  Object.entries(filters).every(([k, v]) => r[k] === v),
                )
                .map((r) => ({ fact: r.fact })),
              error: null,
            };
          };
          const q = {
            select: (columns: string) => {
              assert.equal(columns, "fact");
              return q;
            },
            insert: (v: Record<string, unknown>) => {
              inserted = v;
              return q;
            },
            eq: (k: string, v: unknown) => {
              filters[k] = v;
              return q;
            },
            order: () => q,
            limit: (n: number) => {
              assert.equal(n, 200);
              return q;
            },
            single: async () => result(),
            maybeSingle: async () => {
              const r = result();
              return {
                ...r,
                data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
              };
            },
            then: (ok: (v: unknown) => void) =>
              Promise.resolve(result()).then(ok),
          };
          return q;
        },
      };
    },
  };
  const bundle = await build({
    entryPoints: [resolve("src/app/api/inquiry-facts/route.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "test-auth",
        setup(b: {
          onResolve: (o: object, c: () => object) => void;
          onLoad: (o: object, c: () => object) => void;
        }) {
          b.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({
            path: "auth",
            namespace: "test",
          }));
          b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const isSupabaseConfigured=()=>__auth.configured; export const createClient=(headers)=>__auth.createClient(headers);",
          }));
        },
      },
    ],
  });
  const module = {
    exports: {} as {
      GET: (r: Request) => Promise<Response>;
      POST: (r: Request) => Promise<Response>;
    },
  };
  new Function("__auth", "module", "exports", bundle.outputFiles[0].text)(
    auth,
    module,
    module.exports,
  );
  const { GET, POST } = module.exports;
  const get = () =>
    GET(new Request(`https://harbor.test/api/inquiry-facts?requestId=${R}`));
  const post = (
    body: unknown = { expectedOwner: A, fact },
    headers: Record<string, string> = {},
  ) =>
    POST(
      new Request("https://harbor.test/api/inquiry-facts", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  owner = null;
  assert.equal((await get()).status, 401);
  assert.equal((await post()).status, 401);
  assert.equal(queries, 0);
  owner = A;
  const initial = await get();
  assert.equal(
    initial.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.equal(initial.headers.get("vary"), "Cookie");
  assert.ok(initial.headers.get("set-cookie"));
  assert.deepEqual(await initial.json(), { owner: A, facts: [] });
  assert.equal(
    (await post(undefined, { origin: "https://evil.test" })).status,
    403,
  );
  assert.equal((await post({ expectedOwner: B, fact })).status, 409);
  assert.equal(
    (await post({ expectedOwner: A, fact: { ...fact, confirmed: true } }))
      .status,
    400,
  );
  assert.equal(
    (
      await post({
        expectedOwner: A,
        fact: { ...fact, value: "x".repeat(5000) },
      })
    ).status,
    413,
  );
  assert.equal((await post()).status, 201);
  assert.equal(rows.length, 1);
  const replay = await post();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(rows.length, 1);
  assert.equal(
    (await post({ expectedOwner: A, fact: { ...fact, value: "40" } })).status,
    409,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual((await (await get()).json()).facts, [fact]);
  owner = B;
  assert.deepEqual((await (await get()).json()).facts, []);
  assert.equal((await post()).status, 409);
  owner = A;
  unavailable = true;
  assert.equal((await get()).status, 503);
  assert.equal((await post()).status, 503);
});
