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
  endpoint:
    | "outreach-handoff"
    | "outreach-exchange"
    | "outreach-run"
    | "outreach-receipt",
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

test("run lookup requires service authorization and a matching run credential", async (t) => {
  const previous = process.env.HARBOR_OUTREACH_SERVICE_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.HARBOR_OUTREACH_SERVICE_KEY;
    else process.env.HARBOR_OUTREACH_SERVICE_KEY = previous;
  });
  const runId = "aaaabbbb-cccc-4123-8234-abcdefabcd00";
  const runKey = "ab".repeat(32);
  const otherRunId = "ddddbbbb-cccc-4123-8234-abcdefabcd00";
  const otherRunKey = "cd".repeat(32);
  const calls: unknown[] = [];
  let rpcUnavailable = false;
  const resolve = await bundleRoute("outreach-run", {
    getProviderEntry,
    rpc(name: string, args: Record<string, string>) {
      calls.push([name, args]);
      if (rpcUnavailable) return { error: { message: "internal error" } };
      if (args.p_run_id !== runId || args.p_run_key_digest !== digest(runKey))
        return { data: null };
      return {
        data: {
          runId,
          requestId,
          providerId,
          brief,
          phone: "ignored",
          ownerId,
          runKey,
        },
      };
    },
  });
  const credentials = { runId, runKey };
  const request = (body: unknown = credentials, key = secret) =>
    post("outreach-run", body, { Authorization: `Bearer ${key}` });

  delete process.env.HARBOR_OUTREACH_SERVICE_KEY;
  assert.equal((await resolve(request())).status, 401);
  process.env.HARBOR_OUTREACH_SERVICE_KEY = secret;
  assert.equal((await resolve(request(credentials, runKey))).status, 401);
  assert.equal((await resolve(post("outreach-run", credentials))).status, 401);
  assert.equal(
    (await resolve(request({ ...credentials, requestId }))).status,
    404,
  );
  assert.equal((await resolve(request({ token: runKey }))).status, 404);
  assert.equal(
    (await resolve(request({ runId: "wrong", runKey }))).status,
    404,
  );
  assert.equal(
    (await resolve(request({ runId, runKey: "wrong" }))).status,
    404,
  );
  assert.equal(
    (await resolve(request({ runId, runKey: runKey.repeat(20) }))).status,
    413,
  );
  assert.equal(calls.length, 0);

  const result = await resolve(request({ runId: runId.toUpperCase(), runKey }));
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control") ?? "", /private, no-store/);
  assert.deepEqual(calls, [
    [
      "authorize_outreach_run",
      {
        p_run_id: runId,
        p_run_key_digest: digest(runKey),
      },
    ],
  ]);
  const office = getProviderEntry(providerId)?.provider;
  assert.ok(office);
  assert.deepEqual(await result.json(), {
    runId,
    requestId,
    providerId,
    providerName: office.name,
    phone: office.phone || null,
    brief,
  });

  const wrongKey = await resolve(request({ runId, runKey: otherRunKey }));
  const wrongRun = await resolve(request({ runId: otherRunId, runKey }));
  const malformed = await resolve(request({ runId }));
  assert.equal(wrongKey.status, 404);
  assert.equal(wrongRun.status, 404);
  assert.equal(malformed.status, 404);
  const failure = await wrongKey.text();
  assert.equal(await wrongRun.text(), failure);
  assert.equal(await malformed.text(), failure);

  rpcUnavailable = true;
  const unavailable = await resolve(request());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: "Outreach run is temporarily unavailable.",
  });
});

test("receipt records terminal outcomes, retries safely, and contains failures", async (t) => {
  const previous = process.env.HARBOR_OUTREACH_SERVICE_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.HARBOR_OUTREACH_SERVICE_KEY;
    else process.env.HARBOR_OUTREACH_SERVICE_KEY = previous;
  });
  process.env.HARBOR_OUTREACH_SERVICE_KEY = secret;
  const runId = "aaaabbbb-cccc-4123-8234-abcdefabcd00";
  const runKey = "ab".repeat(32);
  const outcome = {
    status: "completed",
    takeaways: ["Simulated availability."],
    nextSteps: [],
  };
  let mode = "normal";
  let stored: unknown;
  const calls: unknown[] = [];
  const receipt = await bundleRoute("outreach-receipt", {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push([name, args]);
      if (mode === "throw") throw new Error("sensitive backend detail");
      if (mode === "error")
        return { error: { message: "sensitive backend detail" } };
      if (mode === "constraint") return { error: { code: "23514" } };
      if (mode === "takeaways-mismatch" || mode === "nextSteps-mismatch")
        return {
          data: {
            runId,
            requestId,
            outcome: {
              ...outcome,
              [mode === "takeaways-mismatch" ? "takeaways" : "nextSteps"]: [
                "Different summary.",
              ],
            },
            createdAt: expiresAt,
          },
        };
      if (mode === "mismatch")
        return {
          data: {
            runId,
            requestId,
            outcome: { ...outcome, status: "failed" },
            createdAt: expiresAt,
          },
        };
      if (mode === "reordered")
        return {
          data: {
            runId,
            requestId,
            outcome: {
              nextSteps: outcome.nextSteps,
              takeaways: outcome.takeaways,
              status: outcome.status,
            },
            createdAt: expiresAt,
          },
        };
      if (mode === "malformed") return { data: { runId, ownerId, runKey } };
      if (mode === "missing" || args.p_run_key_digest !== digest(runKey))
        return { data: null };
      if (stored && JSON.stringify(stored) !== JSON.stringify(args.p_outcome))
        return {
          error: { code: "23505", message: "sensitive backend detail" },
        };
      stored = args.p_outcome;
      return {
        data: {
          runId,
          requestId,
          outcome: stored,
          createdAt: expiresAt,
          ownerId,
          runKey,
        },
      };
    },
  });
  const body = { runId, runKey, outcome };
  const request = (value: unknown = body) =>
    post("outreach-receipt", value, { Authorization: `Bearer ${secret}` });
  assert.equal((await receipt(post("outreach-receipt", body))).status, 401);
  for (const value of [
    { ...body, ownerId },
    { ...body, runId: "bad" },
    { ...body, runKey: "bad" },
    { ...body, outcome: { ...outcome, transcript: "private" } },
    { ...body, outcome: { ...outcome, status: "requested" } },
    { ...body, outcome: { ...outcome, takeaways: [" "] } },
    { ...body, outcome: { ...outcome, takeaways: ["x".repeat(241)] } },
    { ...body, outcome: { ...outcome, nextSteps: Array(7).fill("next") } },
    { ...body, outcome: { ...outcome, takeaways: [null] } },
    { ...body, outcome: { ...outcome, takeaways: ["\u0000"] } },
  ])
    assert.equal((await receipt(request(value))).status, 400);
  const malformed = new Request("https://harbor.example/api/outreach-receipt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: "{",
  });
  assert.equal((await receipt(malformed)).status, 400);
  assert.equal(
    (await receipt(request({ ...body, runKey: "x".repeat(13000) }))).status,
    400,
  );
  assert.equal(
    (
      await receipt(
        new Request("https://harbor.example/api/outreach-receipt", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "text/plain",
          },
          body: JSON.stringify(body),
        }),
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await receipt(
      request({ ...body, runId: runId.toUpperCase() }),
    );
    assert.equal(result.status, 200);
    assert.match(
      result.headers.get("cache-control") ?? "",
      /private, no-store/,
    );
    assert.deepEqual(await result.json(), { recorded: true });
  }
  assert.deepEqual(calls[0], [
    "record_outreach_rehearsal_receipt",
    {
      p_run_id: runId,
      p_run_key_digest: digest(runKey),
      p_outcome: outcome,
    },
  ]);
  const conflict = await receipt(
    request({ ...body, outcome: { ...outcome, status: "failed" } }),
  );
  assert.equal(conflict.status, 409);
  stored = undefined;
  assert.equal(
    (
      await receipt(
        request({
          ...body,
          outcome: {
            status: "failed",
            takeaways: [],
            nextSteps: ["Retry rehearsal."],
          },
        }),
      )
    ).status,
    200,
  );
  stored = undefined;
  assert.equal(
    (
      await receipt(
        request({
          ...body,
          outcome: {
            status: "completed",
            takeaways: Array(6).fill("x".repeat(240)),
            nextSteps: Array(6).fill("y".repeat(240)),
          },
        }),
      )
    ).status,
    200,
  );
  mode = "reordered";
  assert.equal((await receipt(request())).status, 200);
  mode = "normal";
  const wrongKey = await receipt(request({ ...body, runKey: "cd".repeat(32) }));
  assert.equal(wrongKey.status, 404);
  for (const [failure, status] of [
    ["missing", 404],
    ["error", 503],
    ["throw", 503],
    ["malformed", 503],
    ["mismatch", 503],
    ["takeaways-mismatch", 503],
    ["nextSteps-mismatch", 503],
    ["constraint", 400],
  ] as const) {
    mode = failure;
    const result = await receipt(request());
    assert.equal(result.status, status);
    assert.match(
      result.headers.get("cache-control") ?? "",
      /private, no-store/,
    );
    assert.doesNotMatch(
      await result.text(),
      /sensitive|ownerId|runKey|Simulated/,
    );
  }
});
