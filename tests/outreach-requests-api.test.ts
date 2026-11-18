import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { getProviderEntry } from "../src/lib/markets";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const requestId = "abcdefab-abcd-4abc-8abc-abcdefabcd00";
// A published office outside the smaller reviewed email/form launch registry.
const providerId = "north-jersey-hp-hp0000216";
const url = "https://harbor.example/api/outreach-requests";
const brief = {
  topics: ["Availability"],
  question: "When could visits begin?",
};
const createdAt = "2026-11-18T12:00:00Z";

test("outreach request route authenticates, validates, writes idempotently and exposes only owner reads", async () => {
  let signedIn: string | null = null;
  let calls = 0;
  const rows: Array<{
    owner_id: string;
    request_id: string;
    provider_id: string;
    brief: typeof brief;
    status: string;
    created_at: string;
  }> = [];
  const stubs = {
    async userClient() {
      return {
        auth: {
          getUser: async () => ({
            data: { user: signedIn && { id: signedIn } },
          }),
        },
        from(table: string) {
          const filters = new Map<string, string>();
          const selectRows = () => {
            assert.equal(filters.get("owner_id"), signedIn);
            const scoped = rows.filter(
              (row) =>
                row.owner_id === signedIn &&
                (!filters.has("request_id") ||
                  filters.get("request_id") === row.request_id),
            );
            if (table === "outreach_requests") return scoped;
            assert.equal(table, "outreach_request_events");
            return scoped.map(() => ({
              sequence: 1,
              event_type: "requested",
              created_at: createdAt,
              secret: "discard",
            }));
          };
          const rowsPromise = Promise.resolve().then(() => ({
            data: selectRows(),
          }));
          const query = Object.assign(rowsPromise, {
            select: () => query,
            eq(key: string, value: string) {
              filters.set(key, value);
              return query;
            },
            order: () => query,
            limit(max: number) {
              assert.equal(max, 50);
              return { data: selectRows().slice(0, max) };
            },
            maybeSingle: () => ({ data: selectRows()[0] ?? null }),
          });
          return query;
        },
      };
    },
    adminClient() {
      return {
        async rpc(
          name: string,
          args: {
            p_owner_id: string;
            p_request_id: string;
            p_provider_id: string;
            p_brief: typeof brief;
          },
        ) {
          calls += 1;
          assert.equal(name, "create_outreach_request");
          assert.equal(args.p_owner_id, signedIn);
          const old = rows.find(
            (row) =>
              row.owner_id === args.p_owner_id &&
              row.request_id === args.p_request_id,
          );
          if (
            old &&
            (JSON.stringify(old.brief) !== JSON.stringify(args.p_brief) ||
              old.provider_id !== args.p_provider_id)
          )
            return { error: { code: "23505", message: "private" } };
          if (!old)
            rows.push({
              owner_id: args.p_owner_id,
              request_id: args.p_request_id,
              provider_id: args.p_provider_id,
              brief: args.p_brief,
              status: "requested",
              created_at: createdAt,
            });
          return {
            data: {
              requestId: args.p_request_id,
              providerId: args.p_provider_id,
              status: "requested",
              createdAt,
              replayed: Boolean(old),
              secret: "discard",
            },
          };
        },
      };
    },
  };
  const bundle = await build({
    entryPoints: ["src/app/api/outreach-requests/route.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "authenticated-outreach-test",
        setup(builder) {
          builder.onResolve(
            { filter: /^@\/lib\/supabase\/(server|booking-admin)$/ },
            ({ path }) => ({
              namespace: "test",
              path,
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
            contents: path.endsWith("/server")
              ? "export const isSupabaseConfigured=()=>true; export const createClient=()=>stubs.userClient();"
              : "export const bookingAdmin=()=>stubs.adminClient();",
          }));
        },
      },
    ],
  });
  const bundled = {
    exports: {} as typeof import("../src/app/api/outreach-requests/route"),
  };
  new Function(
    "require",
    "stubs",
    "module",
    "exports",
    bundle.outputFiles[0].text,
  )(require, stubs, bundled, bundled.exports);
  const { GET, POST } = bundled.exports;
  const payload = { requestId, providerId, brief };
  const post = (body: unknown, origin = "https://harbor.example") =>
    POST(
      new Request(url, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const detail = () => GET(new Request(`${url}?requestId=${requestId}`));

  assert.equal((await post(payload)).status, 401);
  assert.equal((await GET(new Request(url))).status, 401);
  signedIn = owner;
  assert.equal((await post(payload, "https://other.example")).status, 403);
  assert.equal((await post({ ...payload, owner })).status, 400);
  assert.equal(
    (await post({ ...payload, providerId: "cms-317002" })).status,
    404,
  );
  const invalidQuery = new Request(
    `${url}?requestId=${requestId}&owner=${other}`,
  );
  assert.equal((await GET(invalidQuery)).status, 400);
  assert.equal(
    (await post({ ...payload, brief: { ...brief, phone: "555-0100" } })).status,
    400,
  );
  assert.equal(
    (await post({ ...payload, providerId: "north-jersey-hp-hp0000000" }))
      .status,
    404,
  );
  assert.equal(
    (
      await post({
        ...payload,
        brief: { ...brief, question: "x".repeat(17_000) },
      })
    ).status,
    413,
  );
  assert.equal(calls, 0);

  for (const extra of [
    { knownAnswers: [] },
    { briefVersion: 1 },
    { briefVersion: null },
    { briefVersion: 2, knownAnswers: null },
    { briefVersion: 2, knownAnswers: [["nested"]] },
    { briefVersion: 2, knownAnswers: [" "] },
    { briefVersion: 2, knownAnswers: Array(4).fill("a") },
    { briefVersion: 2, outstandingQuestions: ["😀".repeat(161)] },
    ...["\u0001", "\u000b", "\u007f", "\u0085"].map((control) => ({
      briefVersion: 2,
      knownAnswers: ["a" + control],
    })),
  ])
    assert.equal(
      (await post({ ...payload, brief: { ...brief, ...extra } })).status,
      400,
    );
  assert.equal(calls, 0);
  const v2Payload = {
    ...payload,
    requestId: "abcdefab-abcd-4abc-8abc-abcdefabcd01",
    brief: {
      ...brief,
      briefVersion: 2,
      knownAnswers: ["😀".repeat(160)],
      outstandingQuestions: ["A\tB\nC\r"],
    },
  };
  assert.equal((await post(v2Payload)).status, 201);
  assert.equal((await post(v2Payload)).status, 200);
  const v2Detail = await GET(
    new Request(`${url}?requestId=${v2Payload.requestId}`),
  );
  assert.deepEqual((await v2Detail.json()).request.brief, v2Payload.brief);
  assert.equal(
    (
      await post({
        ...v2Payload,
        brief: { ...v2Payload.brief, knownAnswers: ["Changed"] },
      })
    ).status,
    409,
  );
  rows.length = 0;

  const created = await post({
    ...payload,
    requestId: requestId.toUpperCase(),
  });
  assert.equal(created.status, 201);
  assert.match(created.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(created.headers.get("vary"), "Cookie");
  assert.deepEqual(await created.json(), {
    requestId,
    providerId,
    status: "requested",
    createdAt,
    replayed: false,
  });
  assert.equal((await post(payload)).status, 200);
  assert.equal(
    (await post({ ...payload, brief: { ...brief, question: "Different" } }))
      .status,
    409,
  );
  assert.equal(rows.length, 1);

  const summary = {
    requestId,
    providerId,
    providerName: getProviderEntry(providerId)?.provider.name,
    status: "requested",
    createdAt,
  };
  assert.deepEqual(await (await GET(new Request(url))).json(), {
    requests: [summary],
  });
  assert.deepEqual(await (await detail()).json(), {
    request: { ...summary, brief },
    events: [{ sequence: 1, type: "requested", createdAt }],
  });

  signedIn = other;
  assert.equal((await detail()).status, 404);
  assert.deepEqual(await (await GET(new Request(url))).json(), {
    requests: [],
  });
  assert.equal((await post(payload)).status, 201);
  assert.equal(rows.length, 2);
});
