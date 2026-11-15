import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { useWorkspace } from "../src/hooks/use-workspace";
import {
  createEmptyWorkspace,
  validateWorkspace,
  type Workspace,
} from "../src/lib/workspace";
import { nextWorkspaceRevision } from "../src/lib/account-workspace";
import {
  homeCareProvider as provider,
  suitableHomeCareInterview as suitable,
} from "./helpers/home-care-outreach";
import {
  bundleWorkspaceBrowser,
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const key = "harbor.demo.workspace.v1";
type Api = ReturnType<typeof useWorkspace>;
declare global {
  interface Window {
    __homeCareAccount: {
      api: Api;
      auth(owner: string): void;
      schedule(): boolean;
      complete(): boolean;
      introduce(): boolean;
      render(): void;
    };
  }
}

test(
  "home-care-outreach real workspace hook saves and reloads per family, rejects invalid input and retries failed writes",
  { timeout: 90_000 },
  async () => {
    const bundle = await bundleWorkspaceBrowser(
      `
    import { createRoot } from "react-dom/client";
    import { useLayoutEffect } from "react";
    import { useWorkspace } from "./src/hooks/use-workspace";
    import { recordHomeCareInterview, recordHomeCareIntroduction } from "./src/lib/home-care-outreach";
    const h=window.__homeCareAccount={};
    let owner=window.__owner, callback;
    const user=()=>({id:owner,email:owner+"@example.invalid",user_metadata:{}});
    h.client={auth:{
      getUser:async()=>({data:{user:user()},error:null}),
      onAuthStateChange:cb=>{callback=cb;return {data:{subscription:{unsubscribe(){callback=null}}}}},
    }};
    h.router={replace(){}};
    h.auth=id=>{owner=id;callback?.("SIGNED_IN",{user:user()})};
    const provider=${JSON.stringify(provider)};
    const suitable=${JSON.stringify(suitable)};
    const change=record=>h.api.update(w=>({...w,homeCareOutreach:{...w.homeCareOutreach,[provider.id]:record}}));
    h.schedule=()=>change(recordHomeCareInterview(provider.name,undefined,{status:"scheduled",scheduledAt:"2026-11-20T10:00:00.000Z"},"Schedule notes"));
    h.complete=()=>change(suitable);
    h.introduce=()=>change(recordHomeCareIntroduction(h.api.workspace.homeCareOutreach[provider.id],{status:"confirmed",startsAt:"2026-11-20T14:00:00.000Z"}));
    function App(){
      const api=useWorkspace(false);
      useLayoutEffect(()=>{h.api=api});
      return <main><p role="status">{api.saveStatus}</p><p role="alert">{api.error}</p></main>;
    }
    createRoot(document.getElementById("root")).render(<App/>);
  `,
      {
        router: "window.__homeCareAccount.router",
        client: "window.__homeCareAccount.client",
        tsconfig: resolve("tsconfig.json"),
      },
    );
    const browser = await launchWorkspaceBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    let owner = A;
    let failWrites = false;
    const workspaces = new Map<
      string,
      { workspace: Workspace; revision: string }
    >();
    const legacy = createEmptyWorkspace();
    legacy.notes = { legacy: "Preserve an existing family's note" };
    legacy.tasks = [
      {
        id: "legacy-task",
        title: "Keep the facility visit",
        category: "Visits",
        dueDate: "",
        status: "todo",
      },
    ];
    legacy.outreach = [
      {
        brief: {
          providerId: "facility",
          providerName: "Existing facility",
          phone: "",
          requestId: "33333333-3333-4333-8333-333333333333",
          readKey: "ab".repeat(32),
          topics: ["Pricing"],
          question: "What are the fees?",
        },
        state: "completed",
        findings: ["A rehearsal only"],
        nextSteps: [],
        createdAt: "2026-11-13T00:00:00.000Z",
        updatedAt: "2026-11-13T00:00:01.000Z",
      },
    ];
    workspaces.set(A, {
      workspace: legacy,
      revision: "2026-11-14T00:00:00.000001+00:00",
    });
    const writes: { owner: string; workspace: Workspace }[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "GET") {
        const saved = workspaces.get(owner);
        return route.fulfill({
          json: {
            owner,
            revision: saved?.revision ?? null,
            workspace: saved?.workspace ?? null,
          },
        });
      }
      const body = route.request().postDataJSON();
      assert.equal(body.expectedOwner, owner);
      assert.equal(
        body.expectedRevision,
        workspaces.get(owner)?.revision ?? null,
      );
      const checked = validateWorkspace(body.workspace);
      assert.equal(checked.ok, true);
      if (failWrites)
        return route.fulfill({
          status: 503,
          json: { error: "Test save unavailable" },
        });
      const revision = nextWorkspaceRevision(body.expectedRevision);
      const workspace = { ...body.workspace, updatedAt: revision };
      workspaces.set(owner, { workspace, revision });
      writes.push({ owner, workspace });
      return route.fulfill({ json: { owner, revision, workspace } });
    });
    async function mount(page: Page) {
      await openWorkspacePage(page, { __owner: owner });
      await page.addScriptTag({ content: bundle });
      await page.waitForFunction(() => window.__homeCareAccount?.api?.ready);
    }
    async function saved() {
      await page.waitForFunction(() => !window.__homeCareAccount.api.dirty);
      await expect(page.getByRole("status")).toHaveText(
        "Saved to your account",
      );
    }
    try {
      await mount(page);
      assert.equal(
        await page.evaluate(() => window.__homeCareAccount.schedule()),
        true,
      );
      await saved();
      await mount(page);
      assert.deepEqual(
        await page.evaluate(
          (id) =>
            window.__homeCareAccount.api.workspace.homeCareOutreach?.[id]
              .interview,
          provider.id,
        ),
        {
          status: "scheduled",
          scheduledAt: "2026-11-20T10:00:00.000Z",
        },
      );
      assert.equal(
        await page.evaluate(() => window.__homeCareAccount.complete()),
        true,
      );
      await saved();
      assert.equal(
        await page.evaluate(() => window.__homeCareAccount.introduce()),
        true,
      );
      await saved();
      await mount(page);
      assert.equal(
        await page.evaluate((id) => {
          const record =
            window.__homeCareAccount.api.workspace.homeCareOutreach![id];
          return record.stage === "introduction" && record.introduction.status;
        }, provider.id),
        "confirmed",
      );
      assert.deepEqual(workspaces.get(A)!.workspace.outreach, legacy.outreach);
      assert.deepEqual(workspaces.get(A)!.workspace.tasks, legacy.tasks);
      assert.deepEqual(workspaces.get(A)!.workspace.notes, legacy.notes);
      const before = writes.length;
      assert.equal(
        await page.evaluate(
          (id) =>
            window.__homeCareAccount.api.update((w) => ({
              ...w,
              homeCareOutreach: {
                [id]: { ...w.homeCareOutreach![id], notes: "x".repeat(2001) },
              },
            })),
          provider.id,
        ),
        false,
      );
      assert.equal(writes.length, before);
      await expect(page.getByRole("alert")).toContainText(
        "valid interview stages",
      );
      failWrites = true;
      await page.evaluate(() => window.__homeCareAccount.schedule());
      await expect(page.getByRole("status")).toHaveText("Changes not saved");
      await expect(page.getByRole("alert")).toHaveText("Test save unavailable");
      assert.equal(
        workspaces.get(A)!.workspace.homeCareOutreach![provider.id].stage,
        "introduction",
      );
      failWrites = false;
      await page.evaluate(() => window.__homeCareAccount.api.retrySave());
      await saved();
      await mount(page);
      assert.equal(
        await page.evaluate(
          (id) =>
            window.__homeCareAccount.api.workspace.homeCareOutreach![id]
              .interview.status,
          provider.id,
        ),
        "scheduled",
      );
      await page.evaluate((other) => window.__homeCareAccount.auth(other), B);
      await page.waitForFunction(() => !window.__homeCareAccount.api.ready);
      assert.equal(
        await page.evaluate(
          () => window.__homeCareAccount.api.workspace.homeCareOutreach,
        ),
        undefined,
      );
      assert.equal(
        await page.evaluate(() => window.__homeCareAccount.schedule()),
        false,
      );
      owner = B;
      await mount(page);
      assert.equal(
        await page.evaluate(
          () => window.__homeCareAccount.api.workspace.homeCareOutreach,
        ),
        undefined,
      );
      await page.evaluate(() => window.__homeCareAccount.complete());
      await saved();
      assert.equal(
        workspaces.get(B)!.workspace.homeCareOutreach![provider.id].interview
          .status,
        "completed",
      );
      assert.equal(
        workspaces.get(A)!.workspace.homeCareOutreach![provider.id].interview
          .status,
        "scheduled",
      );
      owner = A;
      await mount(page);
      assert.equal(
        await page.evaluate(
          (id) =>
            window.__homeCareAccount.api.workspace.homeCareOutreach![id]
              .interview.status,
          provider.id,
        ),
        "scheduled",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "home-care-outreach opt-in demo import reaches account persistence with the complete staged record",
  { timeout: 60_000 },
  async () => {
    const imported: Workspace = {
      ...createEmptyWorkspace(),
      homeCareOutreach: { [provider.id]: suitable },
    };
    const bundle = await bundleWorkspaceBrowser(
      `
    import { createRoot } from "react-dom/client";
    import { useLayoutEffect } from "react";
    import { useWorkspace } from "./src/hooks/use-workspace";
    const h=window.__homeCareAccount={};
    h.router={replace(){}};
    h.client={auth:{
      getUser:async()=>({data:{user:{id:"${A}",user_metadata:{}}},error:null}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
    }};
    function App(){const api=useWorkspace(false);useLayoutEffect(()=>{h.api=api});return <div/>}
    createRoot(document.getElementById("root")).render(<App/>);
  `,
      {
        router: "window.__homeCareAccount.router",
        client: "window.__homeCareAccount.client",
        tsconfig: resolve("tsconfig.json"),
      },
    );
    const browser = await launchWorkspaceBrowser();
    const page = await browser.newPage();
    let stored: Workspace | null = null;
    await page.route("**/api/workspace", (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        assert.equal(body.expectedOwner, A);
        assert.equal(body.expectedRevision, null);
        stored = body.workspace;
      }
      return route.fulfill({
        json: {
          owner: A,
          revision: stored ? "2026-11-14T00:00:00.000001+00:00" : null,
          workspace: stored,
        },
      });
    });
    try {
      await openWorkspacePage(page, {});
      await page.evaluate(
        ({ key, imported }) =>
          localStorage.setItem(key, JSON.stringify(imported)),
        { key, imported },
      );
      await page.addScriptTag({ content: bundle });
      await page.waitForFunction(() => window.__homeCareAccount?.api?.ready);
      assert.equal(stored, null);
      assert.equal(
        await page.evaluate(() =>
          window.__homeCareAccount.api.checkDemoImport(),
        ),
        true,
      );
      await page.waitForFunction(
        () => window.__homeCareAccount.api.canImportDemo,
      );
      assert.equal(
        await page.evaluate(() => window.__homeCareAccount.api.importDemo()),
        true,
      );
      assert.deepEqual(
        (stored as Workspace | null)?.homeCareOutreach,
        imported.homeCareOutreach,
      );
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), key),
        JSON.stringify(imported),
      );
    } finally {
      await browser.close();
    }
  },
);
