import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { Page } from "@playwright/test";
import type { useWorkspace } from "../src/hooks/use-workspace";
import { createEmptyWorkspace, type Workspace } from "../src/lib/workspace";
import {
  bundleWorkspaceBrowser,
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REVISION = "2026-11-13T00:00:00.000001+00:00";
const KEY = "harbor.demo.workspace.v1";

type Harness = {
  api: ReturnType<typeof useWorkspace>;
  requests: {
    method: string;
    body: {
      workspace: Workspace;
      expectedOwner: string;
      expectedRevision: string | null;
    } | null;
  }[];
  reads: number;
  writes: number;
  blockedReads: boolean;
  checks: number;
  pauseAuth: boolean;
  authFailure: "network" | "throw" | null;
  result: boolean | null;
  pending: Promise<void>;
  answer(index: number, body: unknown, status?: number): void;
  fail(index: number): void;
  auth(owner: string | null): void;
  resolveAuth(owner: string | null): void;
  mode(demo: boolean): void;
  unmount(): void;
  importDemo(): void;
  reload(): void;
};

declare global {
  interface Window {
    __workspaceImport: Harness;
  }
}

let bundle: string;

function demoPlan(name = "Local family"): Workspace {
  const plan = createEmptyWorkspace();
  plan.profile.name = name;
  plan.savedProviderIds = ["care-1"];
  plan.notes = { "care-1": "Ask about evening support" };
  plan.tasks = [
    {
      id: "family-task",
      title: "Call about costs",
      category: "Care",
      dueDate: "",
      status: "todo",
    },
  ];
  plan.outreach = [
    {
      brief: {
        providerId: "care-1",
        providerName: "Care",
        phone: "",
        requestId: "33333333-3333-4333-8333-333333333333",
        readKey: "ab".repeat(32),
        topics: ["Pricing"],
        question: "What is included?",
      },
      state: "completed",
      findings: ["Confirm fees"],
      nextSteps: [],
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:01.000Z",
    },
  ];
  return plan;
}

async function mount(
  page: Page,
  stored: string | null = JSON.stringify(demoPlan()),
  demo = false,
) {
  if (!bundle) {
    bundle = await bundleWorkspaceBrowser(
      `
          import { createRoot } from "react-dom/client";
          import { useState } from "react";
          import { useWorkspace } from "./src/hooks/use-workspace";
          const h=window.__workspaceImport={requests:[],reads:0,writes:0,checks:0,blockedReads:false,pauseAuth:false,result:null};
          const key="${KEY}";
          if(window.__stored!==null) localStorage.setItem(key,window.__stored);
          const get=Storage.prototype.getItem, set=Storage.prototype.setItem;
          Storage.prototype.getItem=function(...args){h.reads++;if(h.blockedReads)throw new Error("Blocked");return get.apply(this,args)};
          Storage.prototype.setItem=function(...args){h.writes++;return set.apply(this,args)};
          const user=id=>id?{id,email:"family@test.invalid",user_metadata:{display_name:"Account name"}}:null;
          let callback;
          h.router={replace:()=>{}};
          h.client={auth:{
            onAuthStateChange:cb=>{callback=cb;return {data:{subscription:{unsubscribe:()=>{callback=null}}}}},
            getUser:()=>{
              h.checks++;
              if(h.authFailure==="throw") return Promise.reject(new Error("Auth unavailable"));
              if(h.authFailure==="network") return Promise.resolve({data:{user:null},error:new Error("Auth unavailable")});
              return h.pauseAuth?new Promise(resolve=>{h.resolveAuth=id=>resolve({data:{user:user(id)},error:null})}):Promise.resolve({data:{user:user("${OWNER}")},error:null})
            }
          }};
          h.auth=id=>callback?.("SIGNED_IN",id?{user:user(id)}:null);
          window.fetch=(_url,init={})=>new Promise((resolve,reject)=>h.requests.push({
            method:init.method||"GET",body:init.body?JSON.parse(init.body):null,resolve,reject
          }));
          h.answer=(index,body,status=200)=>h.requests[index].resolve(new Response(typeof body==="string"?body:JSON.stringify(body),{status}));
          h.fail=index=>h.requests[index].reject(new Error("Offline"));
          h.importDemo=()=>{h.result=null;h.pending=h.api.importDemo().then(value=>{h.result=value})};
          h.reload=()=>{h.result=null;h.pending=h.api.loadLatest().then(value=>{h.result=value})};
          const root=createRoot(document.getElementById("root"));
          h.unmount=()=>root.unmount();
          function App(){
            const [demo,setDemo]=useState(window.__demo);
            h.mode=setDemo;
            h.api=useWorkspace(demo);
            return <div>{h.api.workspace.profile.name}</div>;
          }
          root.render(<App/>);
        `,
      {
        router: "window.__workspaceImport.router",
        client: "window.__workspaceImport.client",
        tsconfig: resolve("tsconfig.json"),
      },
    );
  }
  await openWorkspacePage(page, { __stored: stored, __demo: demo });
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => Boolean(window.__workspaceImport?.api));
}

async function count(page: Page, value: number) {
  await page.waitForFunction(
    (n) => window.__workspaceImport.requests.length === n,
    value,
  );
}

async function answer(
  page: Page,
  index: number,
  workspace: Workspace | null,
  revision: string | null = workspace ? REVISION : null,
  owner = OWNER,
) {
  await page.evaluate(
    ({ index, workspace, revision, owner }) =>
      window.__workspaceImport.answer(index, { owner, revision, workspace }),
    { index, workspace, revision, owner },
  );
}

async function ready(page: Page, workspace: Workspace | null = null) {
  await count(page, 1);
  await answer(page, 0, workspace);
  await page.waitForFunction(() => window.__workspaceImport.api.ready);
}

async function checked(page: Page) {
  assert.equal(
    await page.evaluate(() => window.__workspaceImport.api.checkDemoImport()),
    true,
  );
  await page.waitForFunction(() => window.__workspaceImport.api.canImportDemo);
}

async function result(page: Page) {
  await page.waitForFunction(() => window.__workspaceImport.result !== null);
  return page.evaluate(() => window.__workspaceImport.result);
}

test(
  "opt-in import and reload through the actual workspace hook",
  { timeout: 90_000 },
  async (t) => {
    const browser = await launchWorkspaceBrowser();
    async function scenario(run: (page: Page) => Promise<void>) {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await run(page);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    }
    try {
      await t.test(
        "account initialization and unchecked import never access demo storage",
        () =>
          scenario(async (page) => {
            await mount(page);
            await page.evaluate(() => {
              window.__workspaceImport.blockedReads = true;
            });
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
            await ready(page);
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.importDemo(),
              ),
              false,
            );
            assert.deepEqual(
              await page.evaluate(() => ({
                reads: window.__workspaceImport.reads,
                writes: window.__workspaceImport.writes,
                canImport: window.__workspaceImport.api.canImportDemo,
                name: window.__workspaceImport.api.workspace.profile.name,
              })),
              { reads: 0, writes: 0, canImport: false, name: "Account name" },
            );
          }),
      );

      for (const [label, stored] of [
        ["missing", null],
        ["corrupt", "{"],
        ["invalid", '{"profile":{}}'],
        ["blank", JSON.stringify(createEmptyWorkspace())],
      ] as const) {
        await t.test(`${label} demo cannot be imported`, () =>
          scenario(async (page) => {
            await mount(page, stored);
            await ready(page);
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.importDemo(),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspaceImport.requests.length,
              ),
              1,
            );
          }),
        );
      }

      await t.test(
        "the real fresh demo defaults and timestamp changes never offer import",
        () =>
          scenario(async (page) => {
            await mount(page, null, true);
            await page.waitForFunction(
              () => window.__workspaceImport.api.ready,
            );
            await page.evaluate((key) => {
              const workspace = window.__workspaceImport.api.workspace;
              localStorage.setItem(
                key,
                JSON.stringify({
                  ...workspace,
                  updatedAt: "2026-01-01T00:00:00.000Z",
                }),
              );
              window.__workspaceImport.mode(false);
            }, KEY);
            await ready(page);
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.importDemo(),
              ),
              false,
            );
          }),
      );

      for (const field of [
        "name",
        "relationship",
        "zip",
        "careTypes",
        "savedProviderIds",
        "notes",
        "tasks",
        "outreach",
      ] as const) {
        await t.test(`${field} alone makes a demo meaningful`, () =>
          scenario(async (page) => {
            await mount(page, null, true);
            await page.waitForFunction(
              () => window.__workspaceImport.api.ready,
            );
            await page.evaluate(
              ({ field, key, outreach }) => {
                const workspace = structuredClone(
                  window.__workspaceImport.api.workspace,
                );
                if (field === "name") workspace.profile.name = "Family";
                else if (field === "relationship")
                  workspace.profile.relationship = "Myself";
                else if (field === "zip") workspace.profile.zip = "10001";
                else if (field === "careTypes")
                  workspace.profile.careTypes = ["Home care"];
                else if (field === "savedProviderIds")
                  workspace.savedProviderIds = ["care-1"];
                else if (field === "notes")
                  workspace.notes = { "care-1": "Ask about costs" };
                else if (field === "tasks") workspace.tasks[0].status = "done";
                else workspace.outreach = outreach;
                localStorage.setItem(key, JSON.stringify(workspace));
                window.__workspaceImport.mode(false);
              },
              { field, key: KEY, outreach: demoPlan().outreach },
            );
            await ready(page);
            await checked(page);
          }),
        );
      }

      await t.test(
        "explicit import waits for a validated save, rereads data, and preserves local demo and history",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await checked(page);
            const latest = demoPlan("Latest local edit");
            await page.evaluate(
              ({ key, plan }) =>
                localStorage.setItem(key, JSON.stringify(plan)),
              { key: KEY, plan: latest },
            );
            await page.evaluate(() => window.__workspaceImport.importDemo());
            await count(page, 2);
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.importDemo(),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.loadLatest(),
              ),
              false,
            );
            assert.deepEqual(
              await page.evaluate(() => ({
                result: window.__workspaceImport.result,
                checks: window.__workspaceImport.checks,
                name: window.__workspaceImport.requests[1].body!.workspace
                  .profile.name,
                owner: window.__workspaceImport.requests[1].body!.expectedOwner,
                revision:
                  window.__workspaceImport.requests[1].body!.expectedRevision,
                canImport: window.__workspaceImport.api.canImportDemo,
              })),
              {
                result: null,
                checks: 2,
                name: "Latest local edit",
                owner: OWNER,
                revision: null,
                canImport: false,
              },
            );
            assert.equal(
              await page.evaluate(() => {
                const plan =
                  window.__workspaceImport.requests[1].body!.workspace;
                return (
                  plan.outreach?.[0].brief.readKey === "ab".repeat(32) &&
                  plan.notes["care-1"] === "Ask about evening support" &&
                  plan.tasks[0].id === "family-task" &&
                  plan.savedProviderIds[0] === "care-1"
                );
              }),
              true,
            );
            await answer(page, 1, latest);
            assert.equal(await result(page), true);
            assert.equal(
              await page.evaluate(
                ({ key, plan }) =>
                  localStorage.getItem(key) === JSON.stringify(plan),
                { key: KEY, plan: latest },
              ),
              true,
            );
            assert.equal(
              await page.evaluate(() => window.__workspaceImport.api.dirty),
              false,
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
          }),
      );

      for (const label of ["removed", "corrupt", "blank", "blocked"] as const) {
        await t.test(`demo ${label} after check is rejected at commit`, () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await checked(page);
            await page.evaluate(
              ({ label, key, blank }) => {
                if (label === "blocked")
                  window.__workspaceImport.blockedReads = true;
                else if (label === "removed") localStorage.removeItem(key);
                else
                  localStorage.setItem(
                    key,
                    label === "corrupt" ? "{" : JSON.stringify(blank),
                  );
              },
              { label, key: KEY, blank: createEmptyWorkspace() },
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.importDemo(),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspaceImport.requests.length,
              ),
              1,
            );
          }),
        );
      }

      for (const workspace of [
        createEmptyWorkspace(),
        demoPlan("Existing account"),
      ]) {
        await t.test(
          `existing ${workspace.profile.name ? "meaningful" : "empty"} account row is never overwritten`,
          () =>
            scenario(async (page) => {
              await mount(page);
              await ready(page, workspace);
              assert.equal(
                await page.evaluate(() =>
                  window.__workspaceImport.api.checkDemoImport(),
                ),
                false,
              );
              assert.equal(
                await page.evaluate(() =>
                  window.__workspaceImport.api.importDemo(),
                ),
                false,
              );
              assert.equal(
                await page.evaluate(() => window.__workspaceImport.reads),
                0,
              );
              assert.equal(
                await page.evaluate(
                  () => window.__workspaceImport.requests.length,
                ),
                1,
              );
            }),
        );
      }

      await t.test(
        "pending and failed edits, and active reload, block checked imports",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await checked(page);
            await page.evaluate(() =>
              window.__workspaceImport.api.update((w) => ({
                ...w,
                profile: { ...w.profile, name: "Pending account edit" },
              })),
            );
            await count(page, 2);
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.importDemo(),
              ),
              false,
            );
            await page.evaluate(() => window.__workspaceImport.fail(1));
            await page.waitForFunction(
              () =>
                window.__workspaceImport.api.saveStatus === "Changes not saved",
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
            await page.evaluate(() => window.__workspaceImport.reload());
            await count(page, 3);
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.importDemo(),
              ),
              false,
            );
            await answer(page, 2, null);
            assert.equal(await result(page), true);
          }),
      );

      for (const owner of [OTHER, null]) {
        await t.test(
          `owner revalidation rejects ${owner ? "changed account" : "signed out account"} before reading demo again`,
          () =>
            scenario(async (page) => {
              await mount(page);
              await ready(page);
              await checked(page);
              await page.evaluate(() => {
                window.__workspaceImport.pauseAuth = true;
                window.__workspaceImport.importDemo();
              });
              await page.waitForFunction(
                () => window.__workspaceImport.checks === 2,
              );
              await page.evaluate(
                (id) => window.__workspaceImport.resolveAuth(id),
                owner,
              );
              assert.equal(await result(page), false);
              assert.equal(
                await page.evaluate(
                  () => window.__workspaceImport.requests.length,
                ),
                1,
              );
              assert.equal(
                await page.evaluate(() => window.__workspaceImport.reads),
                1,
              );
              assert.equal(
                await page.evaluate(() => window.__workspaceImport.api.ready),
                false,
              );
            }),
        );
      }

      for (const failure of ["network", "throw"] as const) {
        await t.test(
          `${failure} auth verification returns false without reading or saving demo`,
          () =>
            scenario(async (page) => {
              await mount(page);
              await ready(page);
              await checked(page);
              await page.evaluate((value) => {
                window.__workspaceImport.authFailure = value;
              }, failure);
              assert.equal(
                await page.evaluate(() =>
                  window.__workspaceImport.api.importDemo(),
                ),
                false,
              );
              assert.deepEqual(
                await page.evaluate(() => ({
                  reads: window.__workspaceImport.reads,
                  requests: window.__workspaceImport.requests.length,
                  ready: window.__workspaceImport.api.ready,
                  dirty: window.__workspaceImport.api.dirty,
                })),
                { reads: 1, requests: 1, ready: true, dirty: false },
              );
            }),
        );
      }

      for (const change of [
        "edit",
        "reload",
        "owner",
        "mode",
        "unmount",
      ] as const) {
        await t.test(
          `${change} during owner verification invalidates import`,
          () =>
            scenario(async (page) => {
              await mount(page);
              await ready(page);
              await checked(page);
              await page.evaluate(() => {
                window.__workspaceImport.pauseAuth = true;
                window.__workspaceImport.importDemo();
              });
              await page.waitForFunction(
                () => window.__workspaceImport.checks === 2,
              );
              await page.evaluate(
                ({ change, other }) => {
                  const h = window.__workspaceImport;
                  if (change === "edit")
                    h.api.update((w) => ({
                      ...w,
                      notes: { "care-2": "Keep me" },
                    }));
                  else if (change === "reload") void h.api.loadLatest();
                  else if (change === "owner") h.auth(other);
                  else if (change === "mode") h.mode(true);
                  else h.unmount();
                },
                { change, other: OTHER },
              );
              if (change === "mode")
                await page.waitForFunction(
                  () =>
                    window.__workspaceImport.api.workspace.profile.name ===
                    "Local family",
                );
              await page.evaluate(
                (id) => window.__workspaceImport.resolveAuth(id),
                OWNER,
              );
              assert.equal(await result(page), false);
              assert.equal(
                await page.evaluate(
                  () =>
                    window.__workspaceImport.requests.filter(
                      (r) => r.method === "PUT",
                    ).length,
                ),
                change === "edit" ? 1 : 0,
              );
            }),
        );
      }

      for (const failure of [
        "conflict",
        "offline",
        "malformed",
        "wrong-owner",
      ] as const) {
        await t.test(`${failure} save returns false and keeps local demo`, () =>
          scenario(async (page) => {
            const plan = demoPlan();
            await mount(page, JSON.stringify(plan));
            await ready(page);
            await checked(page);
            await page.evaluate(() => window.__workspaceImport.importDemo());
            await count(page, 2);
            if (failure === "offline")
              await page.evaluate(() => window.__workspaceImport.fail(1));
            else if (failure === "malformed")
              await page.evaluate(() =>
                window.__workspaceImport.answer(1, "not json"),
              );
            else if (failure === "wrong-owner")
              await answer(page, 1, plan, REVISION, OTHER);
            else
              await page.evaluate(() =>
                window.__workspaceImport.answer(
                  1,
                  { code: "CONFLICT", error: "Other tab saved" },
                  409,
                ),
              );
            assert.equal(await result(page), false);
            assert.equal(
              await page.evaluate(
                ({ key, plan }) =>
                  localStorage.getItem(key) === JSON.stringify(plan),
                { key: KEY, plan },
              ),
              true,
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspaceImport.api.checkDemoImport(),
              ),
              false,
            );
            if (failure === "conflict") {
              assert.equal(
                await page.evaluate(
                  () =>
                    window.__workspaceImport.api.conflict &&
                    window.__workspaceImport.api.dirty,
                ),
                true,
              );
              await page.evaluate(() =>
                window.__workspaceImport.api.retrySave(),
              );
              assert.equal(
                await page.evaluate(
                  () => window.__workspaceImport.requests.length,
                ),
                2,
              );
              await page.evaluate(() => window.__workspaceImport.reload());
              await count(page, 3);
              await page.evaluate(() => window.__workspaceImport.fail(2));
              assert.equal(await result(page), false);
              assert.equal(
                await page.evaluate(
                  () =>
                    window.__workspaceImport.api.conflict &&
                    window.__workspaceImport.api.dirty,
                ),
                true,
              );
              await page.evaluate(() => window.__workspaceImport.reload());
              await count(page, 4);
              await answer(page, 3, demoPlan("Other tab"));
              assert.equal(await result(page), true);
              assert.equal(
                await page.evaluate(
                  () => window.__workspaceImport.api.workspace.profile.name,
                ),
                "Other tab",
              );
            }
          }),
        );
      }

      await t.test("demo methods never call account APIs", () =>
        scenario(async (page) => {
          await mount(page, null, true);
          await page.waitForFunction(() => window.__workspaceImport.api.ready);
          assert.equal(
            await page.evaluate(() =>
              window.__workspaceImport.api.checkDemoImport(),
            ),
            false,
          );
          assert.equal(
            await page.evaluate(() =>
              window.__workspaceImport.api.importDemo(),
            ),
            false,
          );
          assert.equal(
            await page.evaluate(() =>
              window.__workspaceImport.api.loadLatest(),
            ),
            false,
          );
          assert.equal(
            await page.evaluate(() => window.__workspaceImport.requests.length),
            0,
          );
        }),
      );
    } finally {
      await browser.close();
    }
  },
);
