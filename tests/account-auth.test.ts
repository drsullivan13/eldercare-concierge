import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { chromium, expect, type Page } from "@playwright/test";
import { NextRequest } from "next/server";
import { chromiumLaunchOptions } from "../scripts/lib/chromium.mjs";

const require = createRequire(resolve("package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const publicEnv = {
  "process.env.NEXT_PUBLIC_ENABLE_ACCOUNTS": '"true"',
  "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://auth.harbor.test"',
  "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"public-test-key"',
};

type Harness = {
  calls: { method: string; args: unknown[] }[];
  paths: string[];
  userId: string | null;
  userError: boolean;
  updateError: boolean;
  requestError: string;
  throwRequest: boolean;
};

declare global {
  interface Window {
    __accountTest: Harness;
  }
}

function mocks(server = false) {
  return {
    name: "account-auth-boundaries",
    setup(builder: {
      onResolve: (
        options: { filter: RegExp },
        callback: (args: { path: string }) => unknown,
      ) => void;
      onLoad: (
        options: { filter: RegExp; namespace: string },
        callback: (args: { path: string }) => unknown,
      ) => void;
    }) {
      builder.onResolve(
        { filter: /^(next\/(?:navigation|link|headers)|@supabase\/ssr)$/ },
        ({ path }) => ({ path, namespace: "auth-test" }),
      );
      builder.onLoad({ filter: /.*/, namespace: "auth-test" }, ({ path }) => {
        if (path === "next/link")
          return {
            contents:
              'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }',
            resolveDir: process.cwd(),
          };
        if (path === "next/navigation")
          return {
            contents: server
              ? 'export function redirect(path) { throw new Error("REDIRECT " + path); } export function useRouter() { throw new Error("Client component rendered on server"); }'
              : `export function useRouter() { return {
                    push(path) { window.__accountTest.paths.push(path); },
                    refresh() {},
                  }; }`,
          };
        if (path === "next/headers")
          return {
            contents: `export async function cookies() { return {
                getAll: () => [{ name: "pkce-verifier", value: "test-verifier" }],
                set: (...args) => globalThis.__authServer.cookies.push(args),
              }; }`,
          };
        if (server)
          return {
            contents: `export function createServerClient(url, key, options) {
                const h = globalThis.__authServer;
                return { auth: {
                  async getClaims() {
                    return {data: {claims: {sub: h.user?.id, amr: [{method: h.method}]}}};
                  },
                  async getUser() {
                    if (h.throwUser) throw new Error("offline");
                    return { data: { user: h.user }, error: h.userError };
                  },
                  async exchangeCodeForSession(code) {
                    h.codes.push(code);
                    h.incomingCookies = options.cookies.getAll();
                    options.cookies.setAll([
                      { name: "session", value: "test-session", options: { path: "/", httpOnly: true } },
                      { name: "pkce-verifier", value: "", options: { path: "/", maxAge: 0 } },
                    ], { "Cache-Control": "private, no-store", "Pragma": "no-cache" });
                    if (h.throwExchange) throw new Error("private provider text");
                    return { error: h.exchangeError };
                  },
                } };
              }`,
          };
        return {
          contents: `export function createBrowserClient() {
              const h = window.__accountTest;
              function request(method, args, result = {}) {
                h.calls.push({ method, args });
                if (h.throwRequest) return Promise.reject(new Error("private provider text"));
                return Promise.resolve({ data: { session: null }, error: h.requestError
                  ? { status: 400, code: h.requestError, message: "private provider text" } : null, ...result });
              }
              return { auth: {
                getUser() {
                  return request("getUser", [], {
                    data: { user: h.userId ? { id: h.userId, email: "family@example.test" } : null },
                    error: h.userError,
                  });
                },
                updateUser(...args) {
                  return request("updateUser", args, { error: h.updateError ? { message: "private provider text" } : null });
                },
                resetPasswordForEmail(...args) { return request("resetPasswordForEmail", args); },
                signUp(...args) { return request("signUp", args); },
                signInWithPassword(...args) { return request("signInWithPassword", args, { data: { user: h.userId ? {id: h.userId} : null } }); },
              } };
            }`,
        };
      });
    },
  };
}

async function mount(
  page: Page,
  mode: "login" | "signup" | "forgot" | "reset" | "account",
  next = "/account",
  enabled = true,
) {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import { createRoot } from "react-dom/client";
        import { AuthForm } from "./src/components/auth-form";
        import { AccountSettings } from "./src/components/account-settings";
        import "./src/app/globals.css";
        window.__accountTest = { calls: [], paths: [], userId: "family-user", userError: false, updateError: false, requestError: "", throwRequest: false };
        createRoot(document.getElementById("root")).render(
          ${
            mode === "account"
              ? '<main className="auth-main"><AccountSettings userId="family-user" email="family@example.test" /></main>'
              : `<AuthForm mode=${JSON.stringify(mode)} userId="family-user" next=${JSON.stringify(next)} />`
          }
        );
      `,
    },
    bundle: true,
    write: false,
    outfile: "account-auth.js",
    platform: "browser",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    define: {
      ...publicEnv,
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_ENABLE_ACCOUNTS": JSON.stringify(
        String(enabled),
      ),
    },
    plugins: [mocks()],
  });
  await page.route("https://harbor.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://harbor.test/");
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith(".css"))
      await page.addStyleTag({ content: file.text });
    if (file.path.endsWith(".js"))
      await page.addScriptTag({ content: file.text });
  }
  await page.getByRole("button").first().waitFor();
}

test("recovery requests conceal account existence and use the PKCE callback", async () => {
  const browser = await chromium.launch({
    ...chromiumLaunchOptions,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    let message = "";
    for (const code of ["", "user_not_found", "over_email_send_rate_limit"]) {
      await mount(page, "forgot");
      await page.evaluate((value) => {
        window.__accountTest.requestError = value;
      }, code);
      await page.getByLabel("Email address").fill("family@example.test");
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.getByRole("status")).toBeVisible();
      const text = await page.getByRole("status").innerText();
      if (message) assert.equal(text, message);
      message = text;
      assert.deepEqual(await page.evaluate(() => window.__accountTest.calls), [
        {
          method: "resetPasswordForEmail",
          args: [
            "family@example.test",
            {
              redirectTo:
                "https://harbor.test/auth/callback?next=/reset-password",
            },
          ],
        },
      ]);
      assert.doesNotMatch(text, /private provider text|family@example/);
    }
    await mount(page, "forgot");
    await page.evaluate(() => {
      window.__accountTest.throwRequest = true;
    });
    await page.getByLabel("Email address").fill("family@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("alert")).toContainText("Please try again");
    await expect(
      page.getByRole("button", { name: "Send reset link" }),
    ).toBeEnabled();
  } finally {
    await browser.close();
  }
});

test("login and signup preserve safe destinations, generic errors and demo access", async () => {
  const browser = await chromium.launch({
    ...chromiumLaunchOptions,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await mount(page, "login", "//foreign.example");
    await expect(
      page.getByRole("link", { name: "Explore the demo" }),
    ).toHaveAttribute("href", "/dashboard?demo=1");
    await expect(
      page.getByRole("link", { name: "Forgot your password?" }),
    ).toHaveAttribute("href", "/forgot-password");
    await page.getByLabel("Email address").fill("family@example.test");
    await page.getByLabel("Password", { exact: true }).fill("incorrect");
    await page.evaluate(() => {
      window.__accountTest.requestError = "invalid_credentials";
    });
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Check your email and password",
    );
    await page.evaluate(() => {
      window.__accountTest.requestError = "";
    });
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForFunction(() => window.__accountTest.paths.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__accountTest.paths), [
      "/dashboard",
    ]);
    await mount(page, "login");
    await page.getByLabel("Email address").fill("family@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForFunction(() => window.__accountTest.paths.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__accountTest.paths), [
      "/account",
    ]);

    for (const code of ["", "user_already_exists", "email_exists"]) {
      await mount(page, "signup");
      await page.getByLabel("Your first name").fill("Family");
      await page.getByLabel("Email address").fill("family@example.test");
      await page.getByLabel("Password", { exact: true }).fill("test-password");
      await page.getByLabel("Confirm new password").fill("test-password");
      await page.evaluate((value) => {
        window.__accountTest.requestError = value;
      }, code);
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "If this address needs confirmation",
      );
    }
    await mount(page, "login", "/account", false);
    await expect(
      page.getByRole("button", { name: "Log in", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "Explore the demo" }),
    ).toBeVisible();
  } finally {
    await browser.close();
  }
});

test("reset requires matching passwords and revalidates the original user before updating", async () => {
  const browser = await chromium.launch({
    ...chromiumLaunchOptions,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await mount(page, "reset");
    await page.getByLabel("New password", { exact: true }).fill("new-password");
    await page.getByLabel("Confirm new password").fill("different-password");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("alert")).toContainText("do not match");
    assert.deepEqual(await page.evaluate(() => window.__accountTest.calls), []);
    await page.getByLabel("Confirm new password").fill("new-password");
    await page.evaluate(() => {
      window.__accountTest.userId = null;
    });
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("alert")).toContainText("expired");
    assert.equal(
      await page.evaluate(() =>
        window.__accountTest.calls.some((call) => call.method === "updateUser"),
      ),
      false,
    );
    await page.evaluate(() => {
      window.__accountTest.userId = "different-user";
    });
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("alert")).toContainText("expired");
    await page.evaluate(() => {
      window.__accountTest.userId = "family-user";
    });
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("status")).toContainText("Password updated");
    assert.deepEqual(
      await page.evaluate(() => window.__accountTest.calls.at(-1)),
      {
        method: "updateUser",
        args: [{ password: "new-password" }],
      },
    );
  } finally {
    await browser.close();
  }
});

test("account changes verify identity, pass current_password and retain the confirmed email", async () => {
  const browser = await chromium.launch({
    ...chromiumLaunchOptions,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await mount(page, "account");
    await page
      .getByLabel("Current password", { exact: true })
      .fill("current-password");
    await page.getByLabel("New password", { exact: true }).fill("new-password");
    await page.getByLabel("Confirm new password").fill("other-password");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("alert")).toContainText("do not match");
    assert.deepEqual(await page.evaluate(() => window.__accountTest.calls), []);
    await page.getByLabel("Confirm new password").fill("new-password");
    await page.evaluate(() => {
      window.__accountTest.updateError = true;
    });
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Check your current password",
    );
    assert.deepEqual(await page.evaluate(() => window.__accountTest.calls), [
      { method: "getUser", args: [] },
      {
        method: "signInWithPassword",
        args: [{ email: "family@example.test", password: "current-password" }],
      },
      {
        method: "updateUser",
        args: [
          { password: "new-password", current_password: "current-password" },
        ],
      },
    ]);
    await page.evaluate(() => {
      window.__accountTest.updateError = false;
    });
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("status")).toContainText(
      "password has been updated",
    );
    await expect(
      page.getByLabel("Current password", { exact: true }),
    ).toHaveValue("");
    await expect(page.getByLabel("New password", { exact: true })).toHaveValue(
      "",
    );
    await expect(page.getByLabel("Confirm new password")).toHaveValue("");
    await page.getByLabel("New email address").fill("new@example.test");
    await page.getByRole("button", { name: "Request email change" }).click();
    await expect(page.getByRole("status")).toContainText(
      "until the change is confirmed",
    );
    await expect(
      page.getByText("Signed in as family@example.test."),
    ).toBeVisible();
    assert.deepEqual(
      await page.evaluate(() => window.__accountTest.calls.slice(-2)),
      [
        { method: "getUser", args: [] },
        {
          method: "updateUser",
          args: [
            { email: "new@example.test" },
            {
              emailRedirectTo:
                "https://harbor.test/auth/callback?next=/account",
            },
          ],
        },
      ],
    );
    await page.getByLabel("New email address").fill("another@example.test");
    await page.evaluate(() => {
      window.__accountTest.userId = "different-user";
    });
    await page.getByRole("button", { name: "Request email change" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "session has expired or changed",
    );
    assert.equal(
      await page.evaluate(() => window.__accountTest.calls.at(-1)?.method),
      "getUser",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  } finally {
    await browser.close();
  }
});

type ServerHarness = {
  method: string;
  user: { id: string; email: string } | null;
  userError: boolean;
  throwUser: boolean;
  exchangeError: boolean;
  throwExchange: boolean;
  codes: string[];
  cookies: unknown[][];
  incomingCookies?: unknown[];
};
declare global {
  var __authServer: ServerHarness;
}

async function serverModule(
  flag = "true",
  url = publicEnv["process.env.NEXT_PUBLIC_SUPABASE_URL"],
  key = publicEnv["process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
) {
  globalThis.__authServer = {
    method: "recovery",
    user: { id: "family-user", email: "family@example.test" },
    userError: false,
    throwUser: false,
    exchangeError: false,
    throwExchange: false,
    codes: [],
    cookies: [],
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        export { default as account } from "./src/app/account/page";
        export { default as reset } from "./src/app/reset-password/page";
        export { default as forgot } from "./src/app/forgot-password/page";
        export { default as login } from "./src/app/login/page";
        export { default as signup } from "./src/app/signup/page";
        export { GET } from "./src/app/auth/callback/route";
        export { ACCOUNTS_ENABLED as enabled } from "./src/lib/features";
      `,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    outfile: "account-server.js",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    packages: "external",
    loader: { ".css": "empty", ".module.css": "empty" },
    define: {
      ...publicEnv,
      "process.env.NEXT_PUBLIC_ENABLE_ACCOUNTS": JSON.stringify(flag),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": url,
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": key,
    },
    plugins: [mocks(true)],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    require,
    loaded,
    loaded.exports,
  );
  return loaded.exports as {
    enabled: boolean;
    account(): Promise<{ props: { children: { props: { email: string } }[] } }>;
    reset(): Promise<{ props: { userId: string } }>;
    forgot(options: { searchParams: Promise<object> }): Promise<unknown>;
    login(options: {
      searchParams: Promise<object>;
    }): Promise<{ props: { next: string } }>;
    signup(options: {
      searchParams: Promise<object>;
    }): Promise<{ props: { next: string } }>;
    GET(request: NextRequest): Promise<Response>;
  };
}

test("account and reset routes require verified users and a complete enabled configuration", async () => {
  const routes = await serverModule();
  assert.equal((await routes.reset()).props.userId, "family-user");
  globalThis.__authServer.method = "password";
  await assert.rejects(routes.reset(), /forgot-password/);
  globalThis.__authServer.method = "recovery";
  assert.equal(
    (await routes.account()).props.children[1].props.email,
    "family@example.test",
  );
  for (const failure of ["missing", "error", "offline"]) {
    globalThis.__authServer.user =
      failure === "missing"
        ? null
        : { id: "family-user", email: "family@example.test" };
    globalThis.__authServer.userError = failure === "error";
    globalThis.__authServer.throwUser = failure === "offline";
    await assert.rejects(routes.account(), /REDIRECT \/login\?next=\/account/);
    await assert.rejects(
      routes.reset(),
      /REDIRECT \/forgot-password\?error=recovery_session/,
    );
  }
  assert.equal(
    (
      await routes.login({
        searchParams: Promise.resolve({ next: "//foreign.example" }),
      })
    ).props.next,
    "/dashboard",
  );
  assert.equal(
    (
      await routes.signup({
        searchParams: Promise.resolve({ next: "/account" }),
      })
    ).props.next,
    "/account",
  );
  for (const disabled of [
    await serverModule("false"),
    await serverModule("true", '""'),
    await serverModule("true", undefined, '""'),
  ]) {
    assert.equal(disabled.enabled, false);
    await assert.rejects(disabled.account(), /REDIRECT \/dashboard\?demo=1/);
    await assert.rejects(disabled.reset(), /REDIRECT \/dashboard\?demo=1/);
    await assert.rejects(
      disabled.login({ searchParams: Promise.resolve({}) }),
      /REDIRECT \/dashboard\?demo=1/,
    );
    await assert.rejects(
      disabled.signup({ searchParams: Promise.resolve({}) }),
      /REDIRECT \/dashboard\?demo=1/,
    );
    await assert.rejects(
      disabled.forgot({ searchParams: Promise.resolve({}) }),
      /REDIRECT \/dashboard\?demo=1/,
    );
  }
});

test("callback preserves PKCE cookie writes, no-store headers and safe recovery destinations", async () => {
  const routes = await serverModule();
  for (const next of [
    "/account",
    "/reset-password",
    "//foreign.example",
    "/%2f%2fforeign.example",
    "/auth/callback",
  ]) {
    const response = await routes.GET(
      new NextRequest(
        `https://harbor.test/auth/callback?code=test-code&next=${encodeURIComponent(next)}`,
      ),
    );
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      next === "/account" || next === "/reset-password" ? next : "/dashboard",
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
  }
  assert.deepEqual(globalThis.__authServer.incomingCookies, [
    { name: "pkce-verifier", value: "test-verifier" },
  ]);
  assert.deepEqual(globalThis.__authServer.cookies.slice(0, 2), [
    ["session", "test-session", { path: "/", httpOnly: true }],
    ["pkce-verifier", "", { path: "/", maxAge: 0 }],
  ]);
  for (const failure of ["error", "throw", "missing"]) {
    globalThis.__authServer.exchangeError = failure === "error";
    globalThis.__authServer.throwExchange = failure === "throw";
    const response = await routes.GET(
      new NextRequest(
        `https://harbor.test/auth/callback?next=/reset-password${failure === "missing" ? "" : "&code=test-code"}`,
      ),
    );
    assert.equal(
      response.headers.get("location"),
      "/forgot-password?error=auth_callback",
    );
    assert.doesNotMatch(
      await response.text(),
      /private provider text|test-code/,
    );
  }
});
