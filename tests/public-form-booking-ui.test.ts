import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { expect, type Browser, type Page } from "@playwright/test";
import { launchWorkspaceBrowser } from "./helpers/workspace-browser";
import { homeCareProvider } from "./helpers/home-care-outreach";
import { createEmptyWorkspace } from "../src/lib/workspace";

const office = "north-jersey-hp-hp0265900";
const email = "pilot@example.test";
const time = "2026-11-19T10:00:00Z";
const defaults = {
  name: "Test Family",
  phone: "2015550123",
  windowStart: "2026-11-30T15:00:00.000Z",
  windowEnd: "2026-11-30T17:00:00.000Z",
};
type Job = {
  id: string;
  status: string;
  windowStart: string;
  windowEnd: string;
  startTime: string | null;
  receipt: string | null;
};
function prior(status = "failed"): Job {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status,
    windowStart: defaults.windowStart,
    windowEnd: defaults.windowEnd,
    startTime: null,
    receipt: null,
  };
}
const provider = {
  ...homeCareProvider,
  id: office,
  name: "Elderly Savior Homecare LLC",
};
let bundle: Promise<{ js: string; css: string }>;
function fixtureBundle() {
  return (bundle ??= build({
    stdin: {
      contents: `
        import {createRoot} from "react-dom/client";
        import {Dashboard} from "./src/components/dashboard";
        import {PublicFormBooking} from "./src/components/dashboard/public-form-booking";
        import "./src/app/globals.css";
        const f = window.__concierge;
        createRoot(document.getElementById("root")).render(
          f.direct ? <PublicFormBooking email={f.email} historyOnly={f.historyOnly}/> :
          <Dashboard demo={f.demo} accountOutreachAvailable={false}/>
        );`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    plugins: [
      {
        name: "local-concierge-boundaries",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(@\/hooks\/use-workspace|@\/lib\/supabase\/client|next\/navigation|next\/link)$/,
            },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
            if (args.path === "next/navigation")
              return {
                contents:
                  "export const useRouter=()=>({push(){},refresh(){}}); export const useSearchParams=()=>new URLSearchParams();",
              };
            if (args.path === "next/link")
              return {
                contents:
                  "export default function Link(props){return <a {...props}/>}",
                loader: "tsx",
                resolveDir: process.cwd(),
              };
            if (args.path === "@/lib/supabase/client")
              return {
                contents:
                  "export const createClient=()=>{throw Error('No live account access in fixture')};",
              };
            return {
              contents: `export const useWorkspace=()=>({
              ...window.__concierge.state,
              update:()=>false, setError(){}, retrySave(){}, checkDemoImport(){},
            });`,
            };
          });
        },
      },
    ],
    bundle: true,
    write: false,
    outfile: "concierge-fixture.js",
    platform: "browser",
    loader: { ".png": "dataurl" },
    tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  }).then((result) => ({
    js: result.outputFiles.find((file) => file.path.endsWith(".js"))!.text,
    css: result.outputFiles.find((file) => file.path.endsWith(".css"))!.text,
  })));
}

async function mount(
  browser: Browser,
  options: {
    job?: Job | null;
    defaults?: unknown;
    direct?: boolean;
    historyOnly?: boolean;
    demo?: boolean;
    otherOffice?: boolean;
    responseEmail?: string;
    lostResponse?: boolean;
    legacy?: Record<string, unknown>[];
    mobile?: boolean;
  } = {},
) {
  const page = await browser.newPage({
    timezoneId: "America/Los_Angeles",
    viewport: options.mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
    serviceWorkers: "block",
  });
  await page.clock.install({ time: new Date(time) });
  page.setDefaultTimeout(5000);
  const errors: Error[] = [];
  const unexpected: string[] = [];
  const gets: URL[] = [];
  const posts: Record<string, unknown>[] = [];
  let job = options.job ?? null;
  const currentProvider = options.otherOffice
    ? { ...provider, id: "other-office", name: "Other local fixture office" }
    : provider;
  page.on("pageerror", (error) => errors.push(error));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://harbor.test") {
      unexpected.push(request.url());
      return route.abort();
    }
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<html><body><div id="root"></div></body></html>',
      });
    if (url.pathname === "/api/public-form-bookings") {
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        posts.push(body);
        job = {
          id: body.requestId,
          status: "queued_booking",
          windowStart: body.windowStart,
          windowEnd: body.windowEnd,
          startTime: null,
          receipt: null,
        };
        if (options.lostResponse) return route.abort();
      } else gets.push(url);
      return route.fulfill({
        json: {
          email: options.responseEmail ?? email,
          job,
          ...(url.searchParams.has("prefill")
            ? { defaults: options.defaults }
            : {}),
        },
      });
    }
    if (request.method() !== "GET") {
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (url.pathname === "/api/consultations")
      return route.fulfill({
        json: {
          configured: false,
          publicUrl: "https://agency.example.invalid/calendar",
          bookings: options.legacy ?? [],
        },
      });
    if (url.pathname === "/api/providers")
      return route.fulfill({
        json: { providers: [currentProvider] },
      });
    if (url.pathname === "/api/search")
      return route.fulfill({
        json: {
          market: { id: "north-jersey", label: "North Jersey", state: "NJ" },
          providers: [],
          total: 0,
          origin: { zip: "07928", city: "Chatham", lat: 40.74, lng: -74.38 },
          radius: 25,
          catalogTotal: 0,
          asOf: "2026-11-19",
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
    if (url.pathname === "/api/outreach-requests")
      return route.fulfill({
        json: { email, requests: [] },
      });
    return route.fulfill({
      status: 404,
      json: { error: "Not part of this local fixture." },
    });
  });
  await page.goto("https://harbor.test/");
  const workspace = createEmptyWorkspace();
  workspace.savedProviderIds = [currentProvider.id];
  await page.evaluate(
    (fixture) => Object.assign(window, { __concierge: fixture }),
    {
      direct: options.direct ?? false,
      historyOnly: options.historyOnly ?? false,
      demo: options.demo ?? false,
      email,
      state: {
        workspace,
        email,
        owner: "fixture-account",
        ready: true,
        conflict: false,
        dirty: false,
        canImportDemo: false,
        saveStatus: "Saved to your account",
        error: "",
      },
    },
  );
  const built = await fixtureBundle();
  await page.addStyleTag({ content: built.css });
  await page.addScriptTag({ content: built.js });
  return {
    page,
    gets,
    posts,
    setJob(value: Job) {
      job = value;
    },
    async openProfile() {
      if (options.mobile)
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByRole("button", { name: "Your shortlist", exact: true })
        .click();
      await page
        .getByRole("button", { name: currentProvider.name, exact: true })
        .click();
      return page.getByRole("dialog");
    },
    async finish() {
      assert.deepEqual(errors, [], "No browser errors");
      assert.deepEqual(
        unexpected,
        [],
        "Every request is fulfilled locally; no provider contact",
      );
      await page.close();
    },
  };
}
async function fillFirstTime(page: Page) {
  await page.getByLabel("Earliest start").fill("2026-11-30T07:00");
  await page.getByLabel("Latest finish").fill("2026-11-30T09:00");
  await page.getByLabel("Full name").fill(defaults.name);
  await page.getByLabel("US phone number").fill(defaults.phone);
}
const consent = (page: Page) =>
  page.getByRole("checkbox", { name: /I authorize Harbor/ });
const approve = (page: Page) =>
  page.getByRole("button", { name: "Approve reach out", exact: true });

test(
  "local family concierge, actual profile and plan entry points",
  { timeout: 120000 },
  async (t) => {
    const browser = await launchWorkspaceBrowser();
    try {
      await t.test(
        "first-time approval keeps POST unchanged and navigates to the real plan",
        async () => {
          const f = await mount(browser, { mobile: true });
          const dialog = await f.openProfile();
          const reachOut = dialog.getByRole("button", {
            name: "Reach out for me",
            exact: true,
          });
          await expect(reachOut).toBeVisible();
          await reachOut.click();
          await expect(dialog.getByText("Set up your request")).toBeVisible();
          await expect(
            dialog.getByText(/Free 30-minute Google Meet/),
          ).toBeVisible();
          await expect(
            dialog.getByText(`Invitation email · ${email}`),
          ).toBeVisible();
          await expect(dialog.getByLabel("Full name")).toHaveValue("");
          await expect(dialog.getByLabel("US phone number")).toHaveValue("");
          await expect(
            dialog.getByRole("link", { name: /booking calendar/ }),
          ).toHaveCount(0);
          await expect(dialog.locator("iframe")).toHaveCount(0);
          const manual = dialog.locator("details").filter({
            has: dialog.getByText("Manual interview & introduction tools", {
              exact: true,
            }),
          });
          await expect(manual).not.toHaveAttribute("open", "");
          await fillFirstTime(f.page);
          await expect(dialog.getByText(/New Jersey time/)).toContainText(
            "10:00",
          );
          await expect(approve(f.page)).toBeDisabled();
          await consent(f.page).check();
          await approve(f.page).click();
          await expect(
            f.page.getByText(/Harbor received your approval/),
          ).toBeVisible();
          await expect(approve(f.page)).toHaveCount(0);
          assert.equal(f.posts.length, 1);
          assert.deepEqual(f.posts[0], {
            action: "bookWindow",
            providerId: office,
            windowStart: defaults.windowStart,
            windowEnd: defaults.windowEnd,
            name: defaults.name,
            phone: defaults.phone,
            expectedEmail: email,
            consentVersion: "elderly-savior-v1",
            requestId: f.posts[0].requestId,
          });
          assert.match(String(f.posts[0].requestId), /^[a-f0-9-]{36}$/);
          assert.equal(f.gets[0].searchParams.get("prefill"), "1");
          await expect(f.page.getByRole("dialog")).toHaveCount(0);
          await expect(
            f.page.getByRole("heading", { name: "Your plan", exact: true }),
          ).toBeVisible();
          await expect(
            f.page.getByRole("heading", {
              name: "Latest Elderly Savior consultation",
            }),
          ).toBeVisible();
          assert.equal(f.gets.at(-1)!.searchParams.has("prefill"), false);
          await f.finish();
        },
      );

      await t.test(
        "repeat request is a compact editable summary with fresh consent",
        async () => {
          const f = await mount(browser, { job: prior(), defaults });
          const dialog = await f.openProfile();
          await dialog
            .getByRole("button", { name: "Reach out for me", exact: true })
            .click();
          await expect(
            dialog.getByText("Review your request", { exact: true }),
          ).toBeVisible();
          await expect(
            dialog.getByText(`${defaults.name} · ${defaults.phone}`),
          ).toBeVisible();
          await expect(dialog.getByLabel("Full name")).toBeHidden();
          await expect(consent(f.page)).not.toBeChecked();
          await expect(approve(f.page)).toBeDisabled();
          await dialog
            .getByText("Edit contact details & time", { exact: true })
            .click();
          await expect(dialog.getByLabel("Earliest start")).toHaveValue(
            "2026-11-30T07:00",
          );
          for (const [label, value] of [
            ["Full name", "Updated Family"],
            ["US phone number", "2015550199"],
            ["Earliest start", "2026-11-30T07:30"],
            ["Latest finish", "2026-11-30T10:00"],
          ]) {
            await consent(f.page).check();
            await expect(approve(f.page)).toBeEnabled();
            await dialog.getByLabel(label).fill(value);
            await expect(consent(f.page)).not.toBeChecked();
            await expect(approve(f.page)).toBeDisabled();
          }
          await consent(f.page).check();
          await approve(f.page).click();
          await expect(
            f.page.getByRole("heading", { name: "Your plan", exact: true }),
          ).toBeVisible();
          assert.equal(f.posts.length, 1);
          assert.equal(f.posts[0].name, "Updated Family");
          assert.equal(f.posts[0].windowStart, "2026-11-30T15:30:00.000Z");
          assert.equal(
            await f.page.evaluate(() =>
              Object.values(localStorage).some((value) =>
                value.includes("Updated Family"),
              ),
            ),
            false,
          );
          await f.finish();
        },
      );

      for (const status of [
        "queued_booking",
        "booking",
        "submitting",
        "pending",
        "unknown",
        "needs_human",
        "confirmed",
      ]) {
        await t.test(
          `existing ${status} cannot duplicate, receipt stays closed`,
          async () => {
            const job = {
              ...prior(status),
              startTime: "2026-11-30T15:15:00Z",
              receipt: "HTTP 200 · fixture receipt",
            };
            const f = await mount(browser, { job, defaults });
            const dialog = await f.openProfile();
            await dialog
              .getByRole("button", { name: "Reach out for me", exact: true })
              .click();
            await expect(
              dialog.getByRole("button", { name: "Go to Your plan" }),
            ).toBeVisible();
            await expect(approve(f.page)).toHaveCount(0);
            await expect(consent(f.page)).toHaveCount(0);
            await expect(dialog.getByText(job.receipt)).toBeHidden();
            if (["pending", "unknown"].includes(status))
              await expect(
                dialog
                  .getByRole("status")
                  .filter({ hasText: "Waiting for agency confirmation" }),
              ).toBeVisible();
            await expect(
              dialog.getByText("Scheduled", { exact: true }),
            ).toHaveCount(status === "confirmed" ? 1 : 0);
            await expect(
              dialog.getByText(
                status === "confirmed"
                  ? /Scheduled time ·/
                  : /Intended start ·/,
              ),
            ).toContainText("10:15");
            await dialog
              .getByRole("button", { name: "Go to Your plan" })
              .click();
            await expect(
              f.page.getByRole("heading", { name: "Your plan", exact: true }),
            ).toBeVisible();
            assert.equal(f.posts.length, 0);
            assert.equal(f.gets.at(-1)!.searchParams.has("prefill"), false);
            await f.finish();
          },
        );
      }

      await t.test(
        "expired, invalid, unverified and out-of-range defaults never prefill",
        async () => {
          for (const invalid of [
            { ...defaults, windowStart: "2026-11-18T15:00:00Z" },
            { ...defaults, phone: "invalid" },
            { ...defaults, windowEnd: "2027-01-01T17:00:00Z" },
            { ...defaults, windowEnd: "2026-11-30T15:29:00Z" },
            { ...defaults, windowStart: "not a date" },
          ]) {
            const f = await mount(browser, {
              direct: true,
              job: prior(),
              defaults: invalid,
            });
            await expect(f.page.getByText("Set up your request")).toBeVisible();
            await expect(f.page.getByLabel("Full name")).toHaveValue(
              invalid.phone === "invalid" ? "" : defaults.name,
            );
            await expect(f.page.getByLabel("Earliest start")).toHaveValue("");
            await expect(approve(f.page)).toBeDisabled();
            await f.finish();
          }
          const f = await mount(browser, { direct: true, defaults });
          await expect(f.page.getByText("Set up your request")).toBeVisible();
          await expect(f.page.getByLabel("Full name")).toHaveValue("");
          await f.finish();
        },
      );

      await t.test(
        "prefilled window expiring while open clears consent and requires a new window",
        async () => {
          const f = await mount(browser, {
            direct: true,
            job: prior(),
            defaults: {
              ...defaults,
              windowStart: "2026-11-19T10:01:00Z",
              windowEnd: "2026-11-19T11:01:00Z",
            },
          });
          await expect(
            f.page.getByText("Review your request", { exact: true }),
          ).toBeVisible();
          await consent(f.page).check();
          await expect(approve(f.page)).toBeEnabled();
          await f.page.clock.fastForward(61000);
          await expect(consent(f.page)).not.toBeChecked();
          await expect(approve(f.page)).toBeDisabled();
          await expect(
            f.page.getByText(/Your time window has expired/),
          ).toBeVisible();
          assert.equal(f.posts.length, 0);
          await f.finish();
        },
      );

      await t.test(
        "lost approval response recovers the stored request without a second POST",
        async () => {
          const f = await mount(browser, { direct: true, lostResponse: true });
          await expect(f.page.getByText("Set up your request")).toBeVisible();
          await fillFirstTime(f.page);
          await consent(f.page).check();
          await approve(f.page).click();
          await expect(f.page.getByRole("alert")).toBeVisible();
          await expect(approve(f.page)).toHaveCount(0);
          await f.page
            .getByRole("button", { name: "Check booking status" })
            .click();
          await expect(
            f.page.getByText(/Harbor received your approval/),
          ).toBeVisible();
          f.setJob({ ...prior("unknown"), startTime: "2026-11-30T15:15:00Z" });
          await f.page.clock.fastForward(4000);
          await expect(
            f.page.getByText("Waiting for agency confirmation", {
              exact: true,
            }),
          ).toBeVisible();
          f.setJob({
            ...prior("confirmed"),
            startTime: "2026-11-30T15:15:00Z",
            receipt: "Fixture receipt",
          });
          await f.page.getByRole("button", { name: "Refresh status" }).click();
          await expect(
            f.page.getByText("Scheduled", { exact: true }),
          ).toBeVisible();
          assert.equal(f.posts.length, 1);
          assert.equal(
            f.gets.filter((url) => url.searchParams.has("prefill")).length,
            1,
          );
          await f.finish();
        },
      );

      await t.test(
        "history never requests personal defaults and mismatched accounts fail closed",
        async () => {
          const history = await mount(browser, {
            direct: true,
            historyOnly: true,
            job: prior("pending"),
            defaults,
          });
          await expect(
            history.page.getByText("Waiting for agency confirmation", {
              exact: true,
            }),
          ).toBeVisible();
          assert.ok(
            history.gets.every((url) => !url.searchParams.has("prefill")),
          );
          await expect(approve(history.page)).toHaveCount(0);
          await history.finish();
          const mismatch = await mount(browser, {
            direct: true,
            responseEmail: "other@example.test",
            job: prior(),
            defaults,
          });
          await expect(mismatch.page.getByRole("alert")).toContainText(
            "signed-in account changed",
          );
          await expect(approve(mismatch.page)).toHaveCount(0);
          await expect(
            mismatch.page.getByText(`${defaults.name} · ${defaults.phone}`),
          ).toHaveCount(0);
          await mismatch.finish();
        },
      );

      await t.test(
        "legacy unresolved consultation also blocks a duplicate pilot request",
        async () => {
          const f = await mount(browser, {
            legacy: [
              {
                id: "legacy-fixture",
                provider_id: office,
                agency_name: provider.name,
                status: "unknown",
                source: "highlevel",
                starts_at: null,
                ends_at: null,
                timezone: "America/New_York",
              },
            ],
          });
          const dialog = await f.openProfile();
          await dialog
            .getByRole("button", { name: "Reach out for me", exact: true })
            .click();
          await expect(
            dialog.getByRole("button", { name: "Go to Your plan" }),
          ).toBeVisible();
          await expect(approve(f.page)).toHaveCount(0);
          assert.equal(f.gets.length, 0);
          await f.finish();
        },
      );

      for (const demo of [false, true]) {
        await t.test(
          demo
            ? "guest demo has no concierge entry"
            : "other offices keep the existing workflow",
          async () => {
            const f = await mount(browser, { demo, otherOffice: !demo });
            const dialog = await f.openProfile();
            await expect(
              dialog.getByRole("button", {
                name: "Reach out for me",
                exact: true,
              }),
            ).toHaveCount(0);
            await dialog
              .getByRole("button", { name: "Agency interview & introduction" })
              .click();
            await expect(
              dialog.getByText("Manual interview & introduction tools"),
            ).toHaveCount(0);
            await expect(approve(f.page)).toHaveCount(0);
            assert.equal(f.gets.length, 0);
            await f.finish();
          },
        );
      }
    } finally {
      await browser.close();
    }
  },
);
