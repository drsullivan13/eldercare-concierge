import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { chromium, expect, type Page } from "@playwright/test";
import { chromiumLaunchOptions } from "../scripts/lib/chromium.mjs";
import { createEmptyWorkspace, type Workspace } from "../src/lib/workspace";

type AccountState = {
  workspace: Workspace;
  owner: string;
  ready: boolean;
  conflict: boolean;
  dirty: boolean;
  canImportDemo: boolean;
  saveStatus: string;
  email: string;
  error: string;
};
type DashboardHarness = {
  state: AccountState;
  checks: number;
  imports: number;
  reloads: number;
  usableDemo: boolean;
  reloadFailure: boolean;
  latest: Workspace;
  demoReads: number;
  finishImport(success: boolean): void;
  patch(patch: Partial<AccountState>): void;
};
declare global {
  interface Window {
    __dashboardAccount: DashboardHarness;
  }
}

const original: Workspace = {
  ...createEmptyWorkspace(),
  profile: {
    name: "Alex",
    relationship: "A parent",
    zip: "07928",
    careTypes: [],
  },
  savedProviderIds: ["care-1"],
  notes: { "care-1": "Ask about weekend visits." },
  tasks: [
    {
      id: "task-1",
      title: "Call admissions",
      category: "Care",
      dueDate: "",
      status: "todo",
    },
  ],
  outreach: [
    {
      brief: {
        providerId: "care-1",
        providerName: "Test care",
        phone: "2015550100",
        requestId: "aabbee11-2233-4455-8899-aabbccddeeff",
        readKey: "ab".repeat(32),
        topics: ["Pricing"],
        question: "Can we visit?",
      },
      createdAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:00:00.000Z",
      state: "completed",
      findings: ["Confirm the price with the provider."],
      nextSteps: [],
    },
  ],
};

let bundle: Promise<{ js: string; css: string }> | undefined;
let integratedBundle: Promise<{ js: string; css: string }> | undefined;
function dashboardBundle(realHook = false) {
  const cached = realHook ? integratedBundle : bundle;
  if (cached) return cached;
  const building = (async () => {
    const require = createRequire(resolve("package.json"));
    const { build } = createRequire(require.resolve("tsx/package.json"))(
      "esbuild",
    );
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
          import { createRoot } from "react-dom/client";
          import { Dashboard } from "./src/components/dashboard";
          import "./src/app/globals.css";
          createRoot(document.getElementById("root")).render(<Dashboard demo={false} />);
        `,
      },
      plugins: [
        {
          name: "account-ui-boundaries",
          setup(build: {
            onResolve(
              options: { filter: RegExp },
              callback: (args: { path: string }) => unknown,
            ): void;
            onLoad(
              options: { filter: RegExp; namespace: string },
              callback: (args: { path: string }) => unknown,
            ): void;
          }) {
            build.onResolve(
              {
                filter:
                  /^(@\/hooks\/use-workspace|@\/lib\/supabase\/client|next\/navigation|next\/link)$/,
              },
              (args) =>
                realHook && args.path === "@/hooks/use-workspace"
                  ? undefined
                  : { path: args.path, namespace: "account-test" },
            );
            build.onLoad(
              { filter: /.*/, namespace: "account-test" },
              (args) => {
                if (args.path === "next/navigation")
                  return {
                    contents:
                      "const router = { push() {}, replace() {}, refresh() {} }; export const useRouter = () => router; export const useSearchParams = () => new URLSearchParams(location.search);",
                  };
                if (args.path === "next/link")
                  return {
                    loader: "tsx",
                    resolveDir: process.cwd(),
                    contents:
                      "export default function Link(props) { return <a {...props} />; }",
                  };
                if (args.path === "@/lib/supabase/client")
                  return {
                    contents: `
                      export const isSupabaseConfigured = () => true;
                      export const createClient = async () => ({
                        auth: {
                          getUser: async () => ({ data: { user: {
                            id: "11111111-1111-4111-8111-111111111111",
                            email: "test@example.invalid", user_metadata: {}
                          } }, error: null }),
                          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
                          signOut: async () => ({ error: null })
                        }
                      });
                    `,
                  };
                return {
                  loader: "tsx",
                  resolveDir: process.cwd(),
                  contents: `
              import { useState, useRef, useCallback } from "react";
              import { validateWorkspace } from "./src/lib/workspace";
              export function useWorkspace() {
                const h = window.__dashboardAccount;
                const [value, set] = useState(h.initial);
                const current = useRef(value);
                current.current = value;
                h.state = value;
                h.patch = patch => set(v => ({ ...v, ...patch }));
                const update = useCallback(updater => {
                  if (current.current.conflict) return false;
                  const result = validateWorkspace(updater(current.current.workspace));
                  if (!result.ok) { set(v => ({ ...v, error: result.error })); return false; }
                  current.current = { ...current.current, workspace: result.workspace, dirty: true, saveStatus: "Saving…" };
                  set(current.current);
                  return true;
                }, []);
                return {
                  ...value, update,
                  setError: error => set(v => ({ ...v, error })),
                  retrySave: () => set(v => ({ ...v, saveStatus: "Saving…" })),
                  checkDemoImport: () => {
                    h.checks++;
                    const available = h.usableDemo && !current.current.conflict;
                    set(v => ({ ...v, canImportDemo: available }));
                    return available;
                  },
                  importDemo: async () => {
                    h.imports++;
                    set(v => ({ ...v, saveStatus: "Saving…", dirty: true, canImportDemo: false }));
                    const success = await new Promise(resolve => h.finishImport = resolve);
                    set(v => success
                      ? { ...v, workspace: h.latest, canImportDemo: false, saveStatus: "Saved to your account", dirty: false }
                      : { ...v, error: "Import failed. Your demo is unchanged.", saveStatus: "Changes not saved" });
                    return success;
                  },
                  loadLatest: async () => {
                    h.reloads++;
                    if (h.reloadFailure) {
                      set(v => ({ ...v, error: "Reload failed. Try again." }));
                      return false;
                    }
                    set(v => ({ ...v, workspace: h.latest, conflict: false, dirty: false, error: "", saveStatus: "Saved to your account" }));
                    return true;
                  },
                };
              }
            `,
                };
              },
            );
          },
        },
      ],
      bundle: true,
      write: false,
      outfile: "dashboard-account-harness.js",
      loader: { ".png": "dataurl" },
      platform: "browser",
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
      tsconfig: "tsconfig.json",
    });
    return {
      js: result.outputFiles.find((file: { path: string }) =>
        file.path.endsWith(".js"),
      ).text,
      css: result.outputFiles.find((file: { path: string }) =>
        file.path.endsWith(".css"),
      ).text,
    };
  })();
  if (realHook) integratedBundle = building;
  else bundle = building;
  return building;
}

async function mount(
  page: Page,
  patch: Partial<AccountState> = {},
  realHook = false,
) {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  const initial: AccountState = {
    workspace: original,
    owner: "account-a",
    ready: true,
    conflict: false,
    dirty: false,
    canImportDemo: false,
    saveStatus: "Saved to your account",
    email: "test@example.invalid",
    error: "",
    ...patch,
  };
  await page.route("https://harbor.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        path === "/api/providers"
          ? { providers: [] }
          : {
              market: {
                id: "north-jersey",
                label: "North Jersey",
                state: "NJ",
              },
              providers: [],
              total: 0,
              origin: {
                zip: "07928",
                city: "Chatham",
                lat: 40.74,
                lng: -74.38,
              },
              radius: 25,
              catalogTotal: 0,
              asOf: "2026-11-13",
              categories: {},
              excludedWithoutCoordinates: 0,
              experienceCoverage: {
                scored: 0,
                unscored: 0,
                facebookFindings: 0,
                facebookCovered: 0,
              },
            },
    });
  });
  const writes: {
    workspace: Workspace;
    expectedOwner: string;
    expectedRevision: string | null;
  }[] = [];
  let cloud: Workspace | null = null;
  if (realHook)
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        writes.push(body);
        cloud = body.workspace;
      }
      await route.fulfill({
        json: {
          owner: "11111111-1111-4111-8111-111111111111",
          revision: cloud ? "2026-11-13T12:00:00.000001Z" : null,
          workspace: cloud,
        },
      });
    });
  await page.goto("https://harbor.test/");
  await page.evaluate(
    ({ initial, latest }) => {
      Object.assign(window, {
        __dashboardAccount: {
          initial,
          latest,
          checks: 0,
          imports: 0,
          reloads: 0,
          usableDemo: false,
          reloadFailure: false,
        },
      });
    },
    { initial, latest: original },
  );
  if (realHook)
    await page.evaluate((demo) => {
      localStorage.setItem("harbor.demo.workspace.v1", JSON.stringify(demo));
      window.__dashboardAccount.demoReads = 0;
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (key === "harbor.demo.workspace.v1")
          window.__dashboardAccount.demoReads++;
        return getItem.call(this, key);
      };
    }, original);
  const built = await dashboardBundle(realHook);
  await page.addStyleTag({ content: built.css });
  await page.addScriptTag({ content: built.js });
  try {
    await expect(page.locator(".app-shell")).toBeVisible();
  } catch (error) {
    throw new AggregateError(
      errors.length ? errors : [error],
      "Dashboard did not render",
    );
  }
  return writes;
}

async function openProfile(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".profile-button").click();
  return page.getByRole("dialog", { name: "Your care workspace", exact: true });
}

test("account dashboard preserves the plan and requires deliberate import and conflict recovery", async (t) => {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  try {
    await t.test(
      "real workspace hook imports only after consent and preserves the local demo",
      async () => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const writes = await mount(page, {}, true);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          assert.equal(
            await page.evaluate(() => window.__dashboardAccount.demoReads),
            0,
          );
          assert.equal(writes.length, 0);
          await page.getByText("About your workspace", { exact: true }).click();
          await page
            .getByRole("button", { name: "Check this device for a demo plan" })
            .click();
          await page
            .getByRole("button", { name: "Import demo plan", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Import your demo plan",
            exact: true,
          });
          assert.equal(writes.length, 0);
          await dialog.getByRole("checkbox").check();
          await dialog
            .getByRole("button", { name: "Import demo plan", exact: true })
            .click();
          await expect(dialog).toHaveCount(0);
          await expect(page.locator(".app-topbar")).toContainText(
            "Saved to your account",
          );
          assert.equal(writes.length, 1);
          assert.equal(
            writes[0].expectedOwner,
            "11111111-1111-4111-8111-111111111111",
          );
          assert.equal(writes[0].expectedRevision, null);
          assert.deepEqual(writes[0].workspace.profile, original.profile);
          assert.deepEqual(
            writes[0].workspace.savedProviderIds,
            original.savedProviderIds,
          );
          assert.deepEqual(writes[0].workspace.notes, original.notes);
          assert.deepEqual(writes[0].workspace.tasks, original.tasks);
          assert.deepEqual(writes[0].workspace.outreach, original.outreach);
          assert.deepEqual(
            await page.evaluate(() =>
              JSON.parse(localStorage.getItem("harbor.demo.workspace.v1")!),
            ),
            original,
          );
          await expect(
            page.getByRole("button", { name: "Import demo plan", exact: true }),
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      },
    );
    for (const width of [1440, 390]) {
      await t.test(
        `profile editing and pending saves at ${width}px`,
        async () => {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
          });
          try {
            const page = await context.newPage();
            await mount(page);
            const profile = await openProfile(page);
            await profile.getByLabel("Your first name").fill("Sam");
            await profile
              .getByRole("button", { name: "Save & continue" })
              .click();
            await expect(profile).toHaveCount(0);
            await expect(page.locator(".app-topbar")).toContainText("Saving…");
            const saved = await page.evaluate(
              () => window.__dashboardAccount.state.workspace,
            );
            assert.equal(saved.profile.name, "Sam");
            assert.deepEqual(saved.savedProviderIds, original.savedProviderIds);
            assert.deepEqual(saved.notes, original.notes);
            assert.deepEqual(saved.tasks, original.tasks);
            assert.deepEqual(saved.outreach, original.outreach);
            await page
              .getByText("About your workspace", { exact: true })
              .click();
            await expect(
              page.getByRole("button", { name: "Sign out", exact: true }),
            ).toBeDisabled();
            await expect(
              page.getByRole("link", { name: "Open demo", exact: true }),
            ).toHaveAttribute("href", "/dashboard?demo=1");
            await page.evaluate(() =>
              window.__dashboardAccount.patch({
                saveStatus: "Saved to your account",
                dirty: false,
              }),
            );
            await expect(page.locator(".app-topbar")).toContainText(
              "Saved to your account",
            );
          } finally {
            await context.close();
          }
        },
      );
    }

    await t.test(
      "empty account does not force a profile save or inspect the demo",
      async () => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await mount(page, { workspace: createEmptyWorkspace() });
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Import demo plan", exact: true }),
          ).toHaveCount(0);
          assert.equal(
            await page.evaluate(() => window.__dashboardAccount.checks),
            0,
          );
          assert.equal(
            await page.evaluate(() => window.__dashboardAccount.imports),
            0,
          );
          await page.getByText("About your workspace", { exact: true }).click();
          await page
            .getByRole("button", { name: "Check this device for a demo plan" })
            .click();
          await expect(
            page
              .getByRole("status")
              .filter({ hasText: "No demo plan is available" }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "Import demo plan", exact: true }),
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      },
    );

    await t.test(
      "demo import is checked, confirmed, pending and retryable",
      async () => {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
        });
        try {
          const page = await context.newPage();
          await mount(page, { workspace: createEmptyWorkspace() });
          await page.evaluate(() => {
            window.__dashboardAccount.usableDemo = true;
          });
          await page.getByText("About your workspace", { exact: true }).click();
          await page
            .getByRole("button", { name: "Check this device for a demo plan" })
            .click();
          await page
            .getByRole("button", { name: "Import demo plan", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Import your demo plan",
            exact: true,
          });
          await expect(dialog).toContainText("private rehearsal history");
          await expect(dialog).toContainText("Your demo stays in this browser");
          const submit = dialog.getByRole("button", {
            name: "Import demo plan",
            exact: true,
          });
          await expect(submit).toBeDisabled();
          await dialog
            .getByRole("button", {
              name: "Keep using my account without importing",
            })
            .click();
          assert.equal(
            await page.evaluate(() => window.__dashboardAccount.imports),
            0,
          );
          await page
            .getByRole("button", { name: "Import demo plan", exact: true })
            .click();
          await dialog.getByRole("checkbox").check();
          await submit.click();
          await expect(
            dialog.getByRole("button", { name: "Importing…" }),
          ).toBeDisabled();
          assert.equal(
            await page.evaluate(() => window.__dashboardAccount.imports),
            1,
          );
          await page.evaluate(() =>
            window.__dashboardAccount.finishImport(false),
          );
          await expect(dialog).toHaveCount(0);
          await expect(page.getByRole("alert")).toContainText("Import failed");
          await page
            .getByRole("button", { name: "Retry saving", exact: true })
            .click();
          await expect(page.locator(".app-topbar")).toContainText("Saving…");
          await expect(
            page.getByRole("button", { name: "Import demo plan", exact: true }),
          ).toHaveCount(0);
          assert.equal(
            await page.evaluate(() => window.__dashboardAccount.imports),
            1,
          );
        } finally {
          await context.close();
        }
      },
    );

    await t.test(
      "conflict blocks edits and retry, failed reload preserves edits, successful reload clears stale dialogs",
      async () => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await mount(page);
          const profile = await openProfile(page);
          await profile.getByLabel("Your first name").fill("Stale draft");
          await page.evaluate(() =>
            window.__dashboardAccount.patch({
              conflict: true,
              dirty: true,
              saveStatus: "Changes not saved",
              error: "Changed elsewhere",
            }),
          );
          await expect(
            profile.getByRole("button", { name: "Save & continue" }),
          ).toBeDisabled();
          await profile.getByRole("button", { name: "Close dialog" }).click();
          await expect(
            page.getByRole("button", { name: "Retry saving" }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Reload latest", exact: true }),
          ).toBeVisible();
          await page.evaluate(() => {
            window.__dashboardAccount.reloadFailure = true;
          });
          page.once("dialog", (dialog) => dialog.accept());
          await page
            .getByRole("button", { name: "Reload latest", exact: true })
            .click();
          assert.equal(
            await page.evaluate(() => window.__dashboardAccount.state.conflict),
            true,
          );
          assert.deepEqual(
            await page.evaluate(
              () => window.__dashboardAccount.state.workspace,
            ),
            original,
          );
          await page.evaluate(() => {
            window.__dashboardAccount.reloadFailure = false;
            window.__dashboardAccount.latest = {
              ...window.__dashboardAccount.state.workspace,
              profile: {
                ...window.__dashboardAccount.state.workspace.profile,
                name: "Latest",
              },
            };
          });
          page.once("dialog", (dialog) => dialog.accept());
          await page
            .getByRole("button", { name: "Reload latest", exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: "Reload latest", exact: true }),
          ).toHaveCount(0);
          const latestProfile = await openProfile(page);
          await expect(latestProfile.getByLabel("Your first name")).toHaveValue(
            "Latest",
          );
          await latestProfile
            .getByLabel("Your first name")
            .fill("Account A draft");
          await page.evaluate(() =>
            window.__dashboardAccount.patch({
              owner: "account-b",
              workspace: {
                ...window.__dashboardAccount.latest,
                profile: {
                  ...window.__dashboardAccount.latest.profile,
                  name: "Account B",
                },
              },
            }),
          );
          await expect(latestProfile).toHaveCount(0);
          await expect(
            (await openProfile(page)).getByLabel("Your first name"),
          ).toHaveValue("Account B");
        } finally {
          await context.close();
        }
      },
    );
  } finally {
    await browser.close();
  }
});
