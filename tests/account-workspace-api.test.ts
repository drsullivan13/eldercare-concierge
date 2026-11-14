import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createEmptyWorkspace } from "../src/lib/workspace";
import {
  nextWorkspaceRevision,
  parseAccountSnapshot,
} from "../src/lib/account-workspace";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const require = createRequire(resolve("package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");

test("actual workspace handlers enforce owner preconditions and atomic PostgreSQL revision writes", async () => {
  const db = await PGlite.create();
  await db.exec(
    "create table user_workspaces (user_id uuid primary key, data jsonb not null, updated_at timestamptz not null)",
  );
  let owner = A;
  let queries = 0;
  const auth = {
    configured: true,
    createClient: async (headers: Headers) => {
      headers.set("Set-Cookie", "refreshed=test; HttpOnly");
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: owner } }, error: null }),
        },
        from: (table: string) => {
          assert.equal(table, "user_workspaces");
          let mode = "get";
          let values: Record<string, unknown> = {};
          const filters: Record<string, unknown> = {};
          const query = {
            select: (columns: string) => {
              assert.equal(columns, "data, updated_at");
              return query;
            },
            insert: (data: Record<string, unknown>) => {
              mode = "insert";
              values = data;
              return query;
            },
            update: (data: Record<string, unknown>) => {
              mode = "update";
              values = data;
              return query;
            },
            eq: (key: string, value: unknown) => {
              filters[key] = value;
              return query;
            },
            maybeSingle: async () => {
              queries++;
              try {
                const projection =
                  "data, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"') as updated_at";
                const result =
                  mode === "insert"
                    ? await db.query(
                        `insert into user_workspaces (user_id,data,updated_at) values ($1,$2,$3) returning ${projection}`,
                        [
                          values.user_id,
                          JSON.stringify(values.data),
                          values.updated_at,
                        ],
                      )
                    : mode === "update"
                      ? await db.query(
                          `update user_workspaces set data=$1, updated_at=$2 where user_id=$3 and updated_at=$4 returning ${projection}`,
                          [
                            JSON.stringify(values.data),
                            values.updated_at,
                            filters.user_id,
                            filters.updated_at,
                          ],
                        )
                      : await db.query(
                          `select ${projection} from user_workspaces where user_id=$1`,
                          [filters.user_id],
                        );
                if (mode === "update") {
                  assert.deepEqual(Object.keys(filters).sort(), [
                    "updated_at",
                    "user_id",
                  ]);
                  assert.equal(filters.user_id, owner);
                }
                return { data: result.rows[0] || null, error: null };
              } catch (error) {
                return { data: null, error };
              }
            },
          };
          return query;
        },
      };
    },
  };
  const bundle = await build({
    entryPoints: [resolve("src/app/api/workspace/route.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "authenticated-test-client",
        setup(builder: {
          onResolve: (options: object, callback: () => object) => void;
          onLoad: (options: object, callback: () => object) => void;
        }) {
          builder.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({
            path: "auth",
            namespace: "test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const isSupabaseConfigured=()=>__auth.configured; export const createClient=(headers)=>__auth.createClient(headers);",
          }));
        },
      },
    ],
  });
  const bundled = {
    exports: {} as {
      GET: () => Promise<Response>;
      PUT: (request: Request) => Promise<Response>;
    },
  };
  new Function("__auth", "module", "exports", bundle.outputFiles[0].text)(
    auth,
    bundled,
    bundled.exports,
  );
  const { GET, PUT } = bundled.exports;
  const workspace = createEmptyWorkspace();
  const put = (body: unknown, headers = {}) =>
    PUT(
      new Request("https://harbor.test/api/workspace", {
        method: "PUT",
        headers: {
          Origin: "https://harbor.test",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  try {
    const missing = await GET();
    assert.deepEqual(await missing.json(), {
      owner: A,
      revision: null,
      workspace: null,
    });
    assert.match(missing.headers.get("cache-control")!, /no-store/);
    assert.equal(missing.headers.get("vary"), "Cookie");
    assert.match(missing.headers.get("set-cookie")!, /refreshed/);
    for (const body of [
      { workspace },
      { workspace, expectedOwner: A },
      { workspace, expectedOwner: A, expectedRevision: "" },
      { workspace, expectedOwner: "bad", expectedRevision: null },
      { workspace, expectedOwner: A, expectedRevision: "2026-02-30T00:00:00Z" },
      { workspace, expectedOwner: A, expectedRevision: null, unexpected: true },
    ])
      assert.equal((await put(body)).status, 400);
    assert.equal(
      (
        await put(
          { workspace, expectedOwner: A, expectedRevision: null },
          { Origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await put(
          { workspace, expectedOwner: A, expectedRevision: null },
          { "Content-Type": "text/plain" },
        )
      ).status,
      415,
    );
    assert.equal(
      (
        await put({
          workspace: { ...workspace, notes: { p: "x".repeat(140_000) } },
          expectedOwner: A,
          expectedRevision: null,
        })
      ).status,
      413,
    );
    const firstRace = await Promise.all([
      put({ workspace, expectedOwner: A, expectedRevision: null }),
      put({ workspace, expectedOwner: A, expectedRevision: null }),
    ]);
    assert.deepEqual(
      firstRace.map((result) => result.status).sort(),
      [200, 409],
    );
    const first = parseAccountSnapshot(
      await firstRace.find((result) => result.status === 200)!.json(),
    );
    assert.equal(
      (await firstRace.find((result) => result.status === 409)!.json()).code,
      "CONFLICT",
    );
    const future = "2099-01-01T00:00:00.123456+00:00";
    await db.query(
      "update user_workspaces set updated_at=$1 where user_id=$2",
      [future, A],
    );
    const loaded = parseAccountSnapshot(await (await GET()).json());
    assert.equal(loaded.revision, future);
    const next = await Promise.all(
      ["one", "two"].map((name) =>
        put({
          workspace: { ...workspace, profile: { ...workspace.profile, name } },
          expectedOwner: A,
          expectedRevision: loaded.revision,
        }),
      ),
    );
    assert.deepEqual(next.map((result) => result.status).sort(), [200, 409]);
    const saved = parseAccountSnapshot(
      await next.find((result) => result.status === 200)!.json(),
    );
    assert.equal(saved.revision, "2099-01-01T00:00:00.123457+00:00");
    assert.equal(saved.workspace!.updatedAt, saved.revision);
    assert.notEqual(first.revision, saved.revision);
    owner = B;
    const before = queries;
    const wrongOwner = await put({
      workspace,
      expectedOwner: A,
      expectedRevision: saved.revision,
    });
    assert.equal(wrongOwner.status, 409);
    assert.equal((await wrongOwner.json()).code, "OWNER_MISMATCH");
    assert.equal(queries, before);
    assert.deepEqual(await (await GET()).json(), {
      owner: B,
      revision: null,
      workspace: null,
    });
    owner = A;
    assert.equal(
      parseAccountSnapshot(await (await GET()).json()).revision,
      saved.revision,
    );
    assert.equal(
      (
        await put({
          workspace,
          expectedOwner: A,
          expectedRevision: new Date(future).toISOString(),
        })
      ).status,
      409,
    );
  } finally {
    await db.close();
  }
});

test("revision generation advances within one millisecond and beyond future microsecond tokens", () => {
  const now = Date.parse("2026-11-13T00:00:00.123Z");
  assert.equal(nextWorkspaceRevision(null, now), "2026-11-13T00:00:00.123000Z");
  assert.equal(
    nextWorkspaceRevision("2026-11-13T00:00:00.123000+00:00", now),
    "2026-11-13T00:00:00.123001Z",
  );
  assert.equal(
    nextWorkspaceRevision("2099-01-01T00:00:00.999999Z", now),
    "2099-01-01T00:00:01.000000Z",
  );
  assert.equal(
    nextWorkspaceRevision("2099-01-01T01:00:00.123456+01:00", now),
    "2099-01-01T00:00:00.123457Z",
  );
  assert.throws(() =>
    parseAccountSnapshot({
      owner: A,
      revision: null,
      workspace: createEmptyWorkspace(),
    }),
  );
});
