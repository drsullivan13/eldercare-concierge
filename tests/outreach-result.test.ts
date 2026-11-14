import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/outreach-result/route";

const capability = {
  requestId: "aabbee11-2233-4455-8899-aabbccddeeff",
  readKey: "ab".repeat(32),
};
const result = {
  state: "completed",
  updatedAt: "2026-11-13T12:34:56.123Z",
  findings: ["Availability needs confirmation."],
  nextSteps: ["Call the care coordinator."],
};
const retry = { error: "Outreach result could not be loaded. Please retry." };
const secret = "private-upstream-detail";
const encoder = new TextEncoder();

function request(body = JSON.stringify(capability), headers?: HeadersInit) {
  const allHeaders = new Headers({
    "content-type": "application/json",
    origin: "https://harbor.example",
    host: "harbor.example",
  });
  new Headers(headers).forEach((value, key) => allHeaders.set(key, value));
  return new Request("https://harbor.example/api/outreach-result", {
    method: "POST",
    headers: allHeaders,
    body,
  });
}

async function invoke(input = request(), status = 200) {
  const response = await POST(input);
  assert.equal(response.status, status);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.deepEqual(
    [...response.headers.keys()],
    ["cache-control", "content-type"],
  );
  const body: unknown = await response.json();
  for (const privateValue of [capability.requestId, capability.readKey, secret])
    assert.ok(!JSON.stringify(body).includes(privateValue));
  return body;
}

test("roundtrip uses the fixed lab and projects only safe result fields", async (t) => {
  let state = "opened";
  t.mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL, options?: RequestInit) => {
      assert.equal(
        url,
        "https://harbor-voice-lab.vercel.app/api/outreach-result",
      );
      assert.equal(options?.method, "POST");
      assert.deepEqual(options?.headers, {
        "Content-Type": "application/json",
      });
      assert.deepEqual(JSON.parse(String(options?.body)), capability);
      assert.equal(options?.redirect, "error");
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.credentials, "omit");
      assert.ok(options?.signal instanceof AbortSignal);
      return Response.json(
        {
          ...result,
          state,
          ...capability,
          transcript: secret,
          nested: { secret },
        },
        { headers: { "set-cookie": secret, "x-private": secret } },
      );
    },
  );
  for (state of ["opened", "connected", "completed", "failed"])
    assert.deepEqual(
      await invoke(
        request(undefined, {
          cookie: secret,
          authorization: `Bearer ${secret}`,
        }),
      ),
      { ...result, state },
    );
});

test("same-origin, JSON and capability validation reject before contacting the lab", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json(result),
  );
  const disallowedHeaders: HeadersInit[] = [
    { origin: "https://foreign.example" },
    { origin: "null" },
    { origin: "https://harbor.example/path" },
    { "sec-fetch-site": "cross-site" },
    { host: "harbor.example,foreign.example" },
  ];
  for (const headers of disallowedHeaders)
    await invoke(request(undefined, headers), 403);
  for (const type of ["text/plain", "application/jsonp", ""])
    await invoke(request(undefined, { "content-type": type }), 415);
  for (const body of [
    "{",
    "null",
    "[]",
    "{}",
    JSON.stringify({ requestId: capability.requestId }),
    JSON.stringify({ ...capability, requestId: "not-a-uuid" }),
    JSON.stringify({ ...capability, readKey: "a".repeat(63) }),
    JSON.stringify({ ...capability, readKey: "g".repeat(64) }),
    JSON.stringify({ ...capability, destination: "https://foreign.example" }),
  ])
    await invoke(request(body), 400);
  await invoke(
    request(JSON.stringify(capability).padEnd(1025), { "content-length": "1" }),
    413,
  );
  await invoke(
    request(JSON.stringify({ ...capability, readKey: "界".repeat(400) })),
    413,
  );
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(
    await invoke(request(JSON.stringify(capability).padEnd(1024))),
    result,
  );
  assert.deepEqual(
    await invoke(
      new Request("http://0.0.0.0:3000/api/outreach-result", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          host: "harbor.example",
          origin: "https://harbor.example",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify(capability),
      }),
    ),
    result,
  );
});

test("service limits accept full Unicode results and reject oversized or malformed fields", async (t) => {
  let payload: unknown = result;
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  for (const fill of ["界", "\u0001"]) {
    const full = {
      ...result,
      findings: Array.from({ length: 16 }, (_, i) => `${i}`.padEnd(1200, fill)),
      nextSteps: Array.from({ length: 12 }, (_, i) =>
        `${i}`.padEnd(1200, fill),
      ),
    };
    payload = full;
    assert.deepEqual(await invoke(), full);
  }
  for (payload of [
    { ...result, findings: Array(17).fill("Finding") },
    { ...result, nextSteps: Array(13).fill("Next step") },
    { ...result, findings: ["a".repeat(1201)] },
    { ...result, nextSteps: ["a".repeat(1201)] },
    { ...result, findings: [null] },
    { ...result, nextSteps: "not a list" },
    { ...result, state: "requested" },
    { ...result, updatedAt: "2026-02-30T12:34:56.000Z" },
    { ...result, updatedAt: "not a timestamp" },
    { ...result, updatedAt: null },
    { ...result, findings: undefined },
    null,
  ])
    assert.deepEqual(await invoke(request(), 503), retry);
});

test("upstream streams enforce 256 KiB of actual bytes and cancel without waiting", async (t) => {
  let upstream: Response;
  t.mock.method(globalThis, "fetch", async () => upstream);
  const json = JSON.stringify({ ...result, discarded: "界".repeat(80_000) });
  const atLimit =
    json + " ".repeat(256 * 1024 - encoder.encode(json).byteLength);
  upstream = new Response(atLimit, {
    headers: { "content-type": "application/json" },
  });
  assert.deepEqual(await invoke(), result);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(atLimit));
      controller.enqueue(encoder.encode("界"));
    },
    cancel() {
      cancelled = true;
      return new Promise<void>(() => {});
    },
  });
  upstream = new Response(body, {
    headers: { "content-type": "application/json", "content-length": "1" },
  });
  assert.deepEqual(await invoke(request(), 503), retry);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  for (const invalid of ["{", new Uint8Array([0xff])]) {
    upstream = new Response(invalid, {
      headers: { "content-type": "application/json" },
    });
    assert.deepEqual(await invoke(request(), 503), retry);
  }
});

test("only 404 is relayed and upstream errors, redirects and media types stay private", async (t) => {
  let upstream = new Response(secret, {
    status: 404,
    headers: { "set-cookie": secret, location: "https://foreign.example" },
  });
  t.mock.method(globalThis, "fetch", async () => upstream);
  assert.deepEqual(await invoke(request(), 404), {
    error: "Outreach result is not available.",
  });
  for (const status of [302, 401, 403, 429, 500]) {
    upstream = new Response(secret, { status });
    assert.deepEqual(await invoke(request(), 503), retry);
  }
  upstream = new Response(secret, { headers: { "content-type": "text/html" } });
  assert.deepEqual(await invoke(request(), 503), retry);
  upstream = Response.json(result);
  Object.defineProperty(upstream, "redirected", { value: true });
  assert.deepEqual(await invoke(request(), 503), retry);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error(secret);
  });
  assert.deepEqual(await invoke(request(), 503), retry);
});

test("the ten-second deadline covers headers and stalled body reads", async (t) => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 10_000);
    return timeout(20);
  });
  let stalledBody = false;
  let cancelled = false;
  let body: ReadableStream<Uint8Array> | undefined;
  let signal: AbortSignal | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    (_url: RequestInfo | URL, options?: RequestInit) => {
      signal = options?.signal ?? undefined;
      if (!stalledBody)
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason), {
            once: true,
          });
        });
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"state":'));
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      });
      return Promise.resolve(
        new Response(body, { headers: { "content-type": "application/json" } }),
      );
    },
  );
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    assert.deepEqual(await invoke(request(), 503), retry);
    assert.equal(signal?.aborted, true);
    stalledBody = true;
    assert.deepEqual(await invoke(request(), 503), retry);
    assert.equal(signal?.aborted, true);
    assert.equal(cancelled, true);
    assert.equal(body?.locked, false);
  } finally {
    clearTimeout(keepAlive);
  }
});
