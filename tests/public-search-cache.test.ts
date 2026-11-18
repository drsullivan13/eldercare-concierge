import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as search } from "../src/app/api/search/route";
import { GET as suggest } from "../src/app/api/search-suggestions/route";
import { proxy } from "../src/proxy";

const origin = "https://harbor.example";
const privateCache = "private, no-store";
const dashboardQuery =
  "zip=07928&radius=25&category=home-care&sort=distance&q=&evidence=all";

test("validated dashboard searches use a shared cache until the next UTC date", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-11-18T23:00:00Z"),
  });
  const request = new Request(`${origin}/api/search?${dashboardQuery}`, {
    headers: { cookie: "example=session" },
  });
  const response = search(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, s-maxage=300, must-revalidate",
  );

  t.mock.timers.setTime(Date.parse("2026-11-18T23:59:57.500Z"));
  assert.match(search(request).headers.get("cache-control")!, /s-maxage=2,/);
  t.mock.timers.setTime(Date.parse("2026-11-18T23:59:59.900Z"));
  assert.equal(search(request).headers.get("cache-control"), privateCache);
});

test("only bounded search URLs can enter the shared cache", () => {
  for (const [query, status] of [
    ["zip=07928&q=care", 200],
    ["zip=07928&q=+", 200],
    ["zip=%3007928", 400],
    ["zip=%307928", 200],
    ["zip=07928&radius=25.001", 200],
    ["zip=07928&radius=050", 200],
    ["zip=07928&unknown=value", 400],
    ["zip=07928&zip=07928", 400],
    ["zip=07928&radius=51", 400],
  ] as const) {
    const response = search(new Request(`${origin}/api/search?${query}`));
    assert.equal(response.status, status, query);
    assert.equal(response.headers.get("cache-control"), privateCache, query);
  }
});

test("search suggestions explicitly disable caching for success and validation errors", () => {
  for (const [query, status] of [
    ["zip=07928&q=chat", 200],
    ["zip=invalid&q=chat", 400],
  ] as const) {
    const response = suggest(
      new Request(`${origin}/api/search-suggestions?${query}`),
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), privateCache);
  }
});

test("only exact search paths bypass the session proxy", async (t) => {
  const authOrigin = "https://test-project.supabase.co";
  for (const [key, value] of [
    ["NEXT_PUBLIC_SUPABASE_URL", authOrigin],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key"],
  ] as const) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = encode({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const user = { id: "00000000-0000-4000-8000-000000000001" };
  const refresh = t.mock.method(
    globalThis,
    "fetch",
    async (url: Parameters<typeof fetch>[0]) =>
      String(url).endsWith("/auth/v1/user")
        ? Response.json(user)
        : Response.json({
            access_token: `${encode({ alg: "HS256" })}.${claims}.c2ln`,
            refresh_token: "new-refresh-token",
            expires_in: 3600,
            user,
          }),
  );
  const expiredSession = encode({
    access_token: "expired-access-token",
    refresh_token: "expired-refresh-token",
    expires_at: 1,
  });
  const cookie = `sb-test-project-auth-token=base64-${expiredSession}`;
  for (const [path, authCalls] of [
    [`/api/search?${dashboardQuery}`, 0],
    ["/api/search-suggestions?q=care", 0],
    ["/api/search/other", 2],
    ["/api/search-suggestions-extra", 2],
    ["/api/workspace", 2],
    ["/dashboard", 2],
  ] as const) {
    refresh.mock.resetCalls();
    const response = await proxy(
      new NextRequest(`${origin}${path}`, { headers: { cookie } }),
    );
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
    assert.equal(refresh.mock.callCount(), authCalls, path);
    if (authCalls) {
      assert.equal(
        refresh.mock.calls[0].arguments[0],
        `${authOrigin}/auth/v1/token?grant_type=refresh_token`,
        path,
      );
      assert.ok(response.cookies.has("sb-test-project-auth-token"), path);
    } else {
      assert.equal(response.headers.get("set-cookie"), null, path);
    }
  }
});
