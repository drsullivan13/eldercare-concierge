import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
const require = createRequire(resolve("package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const providerId = "north-jersey-hp-hp0265900",
  email = "ada@example.test",
  id = "00000000-0000-4000-8000-000000000001";
test("public-form route scopes reads to the account and sends only validated approvals to the queue", async () => {
  let verified = true;
  const job = {
    id,
    status: "queued_booking",
    windowStart: "2027-02-01T16:00:00Z",
    windowEnd: "2027-02-01T18:00:00Z",
    startTime: null,
    receipt: null,
  };
  const writes: Record<string, unknown>[] = [];
  let dbError: string | null = null;
  const filters: Record<string, string> = {};
  const query = {
    select: (s: string) => {
      assert.doesNotMatch(s, /phone|email|invitee/);
      return query;
    },
    eq: (k: string, v: string) => {
      filters[k] = v;
      return query;
    },
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: job, error: null }),
  };
  const mock = {
    async createClient(headers: Headers) {
      headers.set("Set-Cookie", "fresh=test; HttpOnly");
      return {
        auth: {
          getUser: async () => ({
            data: {
              user: {
                id: "owner",
                email,
                email_confirmed_at: verified ? new Date().toISOString() : null,
              },
            },
            error: null,
          }),
        },
        from: (table: string) => {
          assert.equal(table, "public_form_bookings");
          return query;
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          assert.equal(name, "request_public_form_booking");
          writes.push(args);
          return { data: job, error: dbError ? { code: dbError } : null };
        },
      };
    },
  };
  const bundle = await build({
    entryPoints: ["src/app/api/public-form-bookings/route.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "public-booking-auth",
        setup(b: {
          onResolve: (o: object, c: () => object) => void;
          onLoad: (o: object, c: () => object) => void;
        }) {
          b.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({
            path: "auth",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export const createClient=__auth.createClient;",
          }));
        },
      },
    ],
  });
  const routeModule = {
    exports: {} as typeof import("../src/app/api/public-form-bookings/route"),
  };
  new Function("__auth", "module", "exports", bundle.outputFiles[0].text)(
    mock,
    routeModule,
    routeModule.exports,
  );
  const url = "https://harbor.test/api/public-form-bookings";
  const { GET, POST } = routeModule.exports;
  const payload = {
    action: "bookWindow",
    providerId,
    requestId: id,
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    name: "Ada Doe",
    phone: "(202) 555-0101",
    expectedEmail: email,
    consentVersion: "elderly-savior-v1",
  };
  const post = (
    patch: Record<string, unknown> = {},
    origin = "https://harbor.test",
  ) =>
    POST(
      new Request(url, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...patch }),
      }),
    );
  const read = await GET(new Request(url + "?providerId=" + providerId));
  assert.match(read.headers.get("Cache-Control") ?? "", /private, no-store/);
  assert.ok(read.headers.get("Set-cookie"));
  assert.deepEqual(await read.json(), { email, job });
  assert.deepEqual(filters, { owner_id: "owner", provider_id: providerId });
  assert.equal((await post({}, "https://evil.test")).status, 403);
  verified = false;
  assert.equal((await post()).status, 403);
  verified = true;
  assert.equal((await post({ ownerId: "foreign" })).status, 400);
  assert.equal(
    (await post({ expectedEmail: "foreign@example.test" })).status,
    409,
  );
  assert.equal((await post({ windowEnd: "2027-02-01T18:00:00" })).status, 400);
  assert.equal((await post({ name: "a".repeat(5000) })).status, 413);
  assert.equal(writes.length, 0);
  assert.deepEqual(await (await post()).json(), { email, job });
  assert.equal(writes[0].p_phone, "+12025550101");
  for (const [code, status] of [
    ["P0429", 429],
    ["55000", 409],
    ["08006", 503],
  ] as const) {
    dbError = code;
    assert.equal((await post()).status, status);
  }
});
