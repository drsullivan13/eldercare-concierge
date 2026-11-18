import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";
import { getProviderEntry } from "../src/lib/markets";

const ownerId = "11111111-1111-4111-8111-111111111111";
const requestId = "abcdefab-abcd-4abc-8abc-abcdefabcd00";
const providerId = "north-jersey-hp-hp0000216";
const expiresAt = "2026-11-18T12:02:00Z";
const secret = "test-service-key-at-least-32-chars";
const brief = {
  topics: ["Availability"],
  question: "When could visits begin?",
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function bundleRoute(
  endpoint: "outreach-handoff" | "outreach-exchange",
  stubs: object,
) {
  const bundle = await build({
    entryPoints: [`src/app/api/${endpoint}/route.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "handoff-api-test",
        setup(builder) {
          builder.onResolve(
            { filter: /^@\/lib\/(markets|supabase\/(server|booking-admin))$/ },
            ({ path }) => ({ namespace: "test", path }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
            contents: path.endsWith("/server")
              ? "export const isSupabaseConfigured=()=>true; export const createClient=()=>stubs.userClient();"
              : path.endsWith("/markets")
                ? "export const getProviderEntry=stubs.getProviderEntry;"
                : "export const bookingAdmin=()=>({rpc:stubs.rpc});",
          }));
        },
      },
    ],
  });
  const bundled = {
    exports: {} as { POST(request: Request): Promise<Response> },
  };
  new Function(
    "require",
    "stubs",
    "module",
    "exports",
    bundle.outputFiles[0].text,
  )(require, stubs, bundled, bundled.exports);
  return bundled.exports.POST;
}

function post(endpoint: string, body: unknown, headers?: HeadersInit) {
  return new Request(`https://harbor.example/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("issue requires a confirmed account and passes only the owner-scoped token digest", async () => {
  let user: {
    id: string;
    email?: string;
    email_confirmed_at?: string;
    is_anonymous?: boolean;
  } | null = null;
  const calls: unknown[] = [];
  const issue = await bundleRoute("outreach-handoff", {
    userClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
    rpc(name: string, args: Record<string, string>) {
      calls.push([name, args]);
      return { data: { expiresAt, internal: "redacted" } };
    },
  });
  const request = (body: unknown = { requestId }, headers?: HeadersInit) =>
    post("outreach-handoff", body, headers);
  assert.equal((await issue(request())).status, 401);
  user = {
    id: ownerId,
    is_anonymous: true,
    email: "test@example.com",
    email_confirmed_at: expiresAt,
  };
  assert.equal((await issue(request())).status, 401);
  user = { id: ownerId, email: "test@example.com" };
  assert.equal((await issue(request())).status, 403);
  user.email_confirmed_at = expiresAt;
  assert.equal(
    (await issue(request({ requestId }, { Origin: "https://other.example" })))
      .status,
    403,
  );
  assert.equal((await issue(request({ requestId, ownerId }))).status, 400);
  assert.equal(
    (await issue(request({ requestId: "x".repeat(1100) }))).status,
    413,
  );
  assert.equal(calls.length, 0);

  const result = await issue(
    request(
      { requestId: requestId.toUpperCase() },
      { Origin: "https://harbor.example" },
    ),
  );
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control") ?? "", /private, no-store/);
  const { token } = await result.clone().json();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.deepEqual(await result.json(), { token, expiresAt });
  assert.deepEqual(calls, [
    [
      "issue_outreach_handoff",
      {
        p_owner_user_id: ownerId,
        p_request_id: requestId,
        p_token_digest: digest(token),
      },
    ],
  ]);
});

test("exchange rejects unauthorized callers and exposes a run only once", async (t) => {
  const previous = process.env.HARBOR_OUTREACH_SERVICE_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.HARBOR_OUTREACH_SERVICE_KEY;
    else process.env.HARBOR_OUTREACH_SERVICE_KEY = previous;
  });
  const token = "ab".repeat(32);
  const calls: Record<string, string>[] = [];
  const exchange = await bundleRoute("outreach-exchange", {
    getProviderEntry,
    rpc(name: string, args: Record<string, string>) {
      assert.equal(name, "exchange_outreach_handoff");
      calls.push(args);
      if (args.p_token_digest !== digest(token) || calls.length > 1)
        return { data: null };
      return {
        data: {
          runId: args.p_run_id,
          requestId,
          providerId,
          brief,
          phone: "ignored",
          ownerId,
        },
      };
    },
  });
  const request = (body: unknown, key = secret) =>
    post("outreach-exchange", body, { Authorization: `Bearer ${key}` });
  process.env.HARBOR_OUTREACH_SERVICE_KEY = "short";
  assert.equal((await exchange(request({ token }, "short"))).status, 401);
  process.env.HARBOR_OUTREACH_SERVICE_KEY = secret;
  assert.equal((await exchange(request({ token }, "wrong"))).status, 401);
  const malformed = await exchange(request({ token, requestId }));
  assert.equal(malformed.status, 404);
  assert.equal(
    (await exchange(request({ token: token.repeat(20) }))).status,
    413,
  );
  assert.equal(calls.length, 0);

  const result = await exchange(request({ token }));
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control") ?? "", /private, no-store/);
  const { runId, runKey } = await result.clone().json();
  assert.match(runId, /^[0-9a-f-]{36}$/);
  assert.match(runKey, /^[0-9a-f]{64}$/);
  assert.deepEqual(calls, [
    {
      p_token_digest: digest(token),
      p_run_id: runId,
      p_run_key_digest: digest(runKey),
    },
  ]);
  const office = getProviderEntry(providerId)?.provider;
  assert.ok(office);
  assert.deepEqual(await result.json(), {
    runId,
    runKey,
    requestId,
    providerId,
    providerName: office.name,
    phone: office.phone || null,
    brief,
  });

  const reused = await exchange(request({ token }));
  const unknown = await exchange(request({ token: "cd".repeat(32) }));
  assert.equal(reused.status, 404);
  assert.equal(unknown.status, 404);
  assert.equal(await reused.text(), await unknown.text());
});
