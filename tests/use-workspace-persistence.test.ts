import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "@playwright/test";
import type { useWorkspace } from "../src/hooks/use-workspace";
import { createEmptyWorkspace, type Workspace } from "../src/lib/workspace";
import {
  bundleWorkspaceBrowser,
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const R1 = "2026-11-13T00:00:00.000001+00:00";
const R2 = "2026-11-13T00:00:00.000002+00:00";
const R3 = "2026-11-13T00:00:00.000003+00:00";
const KEY = "harbor.demo.workspace.v1";
type Api = ReturnType<typeof useWorkspace>;
type Harness = {
  api: Api;
  oldApi?: Api;
  requests: {
    method: string;
    aborted: boolean;
    body: {
      workspace: Workspace;
      expectedOwner: string;
      expectedRevision: string | null;
    } | null;
  }[];
  errors: string[];
  blockedStorage: boolean;
  unsubscribed: number;
  redirects: string[];
  edit(name: string): boolean;
  answer(index: number, body: unknown, status?: number): void;
  fail(index: number): void;
  auth(owner: string | null): void;
  resolveAuth(owner: string | null): void;
  resolveClient(): void;
  mode(demo: boolean): void;
  transitionDemo(): void;
  renderedDemo: boolean;
  unmount(): void;
};
declare global {
  interface Window {
    __workspace: Harness;
  }
}
let bundle: string;

async function mount(
  page: Page,
  options: {
    demo?: boolean;
    deferredAuth?: boolean;
    deferredClient?: boolean;
    storedDemo?: Workspace;
    blockedStorage?: boolean;
    authError?: boolean;
  } = {},
) {
  if (!bundle) {
    bundle = await bundleWorkspaceBrowser(
      `
          import { createRoot } from "react-dom/client";
          import React, { useState, useLayoutEffect, Suspense, startTransition } from "react";
          import { useWorkspace } from "./src/hooks/use-workspace";
          const options=window.__options;
          const h=window.__workspace={ requests:[], errors:[], redirects:[], blockedStorage:Boolean(options.blockedStorage), unsubscribed:0 };
          window.addEventListener("unhandledrejection", event=>{ h.errors.push(String(event.reason)); event.preventDefault(); });
          const original=Storage.prototype.setItem;
          Storage.prototype.setItem=function(...args){ if(h.blockedStorage) throw new Error("storage blocked"); return original.apply(this,args); };
          if(options.storedDemo) localStorage.setItem("${KEY}",JSON.stringify(options.storedDemo));
          let callback;
          const user=id=>id?{id,email:id===${JSON.stringify(A)}?"a@test.invalid":"b@test.invalid",user_metadata:{display_name:"Account name"}}:null;
          h.auth=id=>callback?.(id?"SIGNED_IN":"SIGNED_OUT",id?{user:user(id)}:null);
          const client={auth:{
            onAuthStateChange:cb=>{callback=cb;return {data:{subscription:{unsubscribe:()=>{h.unsubscribed++;callback=null}}}}},
            getUser:()=>options.authError?Promise.resolve({data:{user:null},error:Object.assign(new Error("Account service unavailable"),{name:"AuthRetryableFetchError"})}):options.deferredAuth?new Promise(resolve=>{h.resolveAuth=id=>resolve({data:{user:user(id)},error:null})}):Promise.resolve({data:{user:user(${JSON.stringify(A)})},error:null})
          }};
          h.client=()=>options.deferredClient?new Promise(resolve=>{h.resolveClient=()=>resolve(client)}):Promise.resolve(client);
          h.router={replace:path=>h.redirects.push(path)};
          window.fetch=(url,init={})=>new Promise((resolve,reject)=>{
            const request={method:init.method||"GET",body:init.body?JSON.parse(init.body):null,aborted:false,resolve,reject};
            init.signal?.addEventListener("abort",()=>{ request.aborted=true; });
            h.requests.push(request);
          });
          h.answer=(index,body,status=200)=>h.requests[index].resolve(new Response(typeof body==="string"?body:JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}));
          h.fail=index=>h.requests[index].reject(new Error("Network unavailable"));
          const root=createRoot(document.getElementById("root"));
          h.unmount=()=>root.unmount();
          const suspension=new Promise(()=>{});
          function App(){
            const [demo,setDemo]=useState(Boolean(options.demo));
            h.mode=setDemo;
            h.transitionDemo=()=>{h.suspendDemo=true;startTransition(()=>setDemo(true));};
            h.renderedDemo=demo;
            const api=useWorkspace(demo);
            useLayoutEffect(()=>{
              h.api=api;
              h.edit=name=>h.api.update(w=>({...w,profile:{...w.profile,name}}));
            });
            if(demo && h.suspendDemo) throw suspension;
            return <div>{api.workspace.profile.name}</div>;
          }
          root.render(<Suspense fallback={<div>Loading</div>}><App/></Suspense>);
        `,
      {
        router: "window.__workspace.router",
        client: "window.__workspace.client()",
      },
    );
  }
  await openWorkspacePage(page, { __options: options });
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => Boolean(window.__workspace?.api));
}

function snapshot(name: string, revision: string | null = R1, owner = A) {
  return {
    owner,
    revision,
    workspace:
      revision === null
        ? null
        : {
            ...createEmptyWorkspace(),
            profile: { name, relationship: "", zip: "", careTypes: [] },
          },
  };
}
async function count(page: Page, count: number) {
  await page.waitForFunction(
    (n) => window.__workspace.requests.length === n,
    count,
  );
}
async function answer(page: Page, index: number, body: unknown, status = 200) {
  await page.evaluate(
    ({ index, body, status }) => window.__workspace.answer(index, body, status),
    { index, body, status },
  );
}
async function ready(page: Page) {
  await count(page, 1);
  await answer(page, 0, snapshot("Saved"));
  await page.waitForFunction(() => window.__workspace.api.ready);
}
async function failed(page: Page) {
  await page.waitForFunction(
    () => window.__workspace.api.saveStatus === "Changes not saved",
  );
}

test(
  "actual workspace hook lifecycle protects account identity, revisions and pending work",
  { timeout: 60_000 },
  async (t) => {
    const browser = await launchWorkspaceBrowser();
    async function scenario(run: (page: Page) => Promise<void>) {
      const page = await browser.newPage();
      page.setDefaultTimeout(3000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await run(page);
        assert.deepEqual(
          await page.evaluate(() => window.__workspace.errors),
          [],
        );
        assert.deepEqual(errors, []);
      } catch (error) {
        if (errors.length)
          throw new Error(
            `${String(error)}; browser errors: ${errors.join("; ")}`,
          );
        throw error;
      } finally {
        await page.close();
      }
    }
    try {
      await t.test(
        "serial saves retain newer optimistic work and use each returned exact revision",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => window.__workspace.edit("First"));
            await count(page, 2);
            await page.evaluate(() => window.__workspace.edit("Second"));
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
            await answer(page, 1, snapshot("First", R2));
            await count(page, 3);
            assert.deepEqual(
              await page.evaluate(() => ({
                first: window.__workspace.requests[1].body!.expectedRevision,
                second: window.__workspace.requests[2].body!.expectedRevision,
                name: window.__workspace.requests[2].body!.workspace.profile
                  .name,
                owner: window.__workspace.requests[2].body!.expectedOwner,
                visible: window.__workspace.api.workspace.profile.name,
              })),
              {
                first: R1,
                second: R2,
                name: "Second",
                owner: A,
                visible: "Second",
              },
            );
            await answer(page, 2, snapshot("Second", R3));
            await page.waitForFunction(() => !window.__workspace.api.dirty);
            assert.equal(
              await page.evaluate(() => window.__workspace.api.saveStatus),
              "Saved to your account",
            );
          }),
      );

      await t.test(
        "loadLatest declines while PUT is active without aborting or racing its commit",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => window.__workspace.edit("First"));
            await count(page, 2);
            await page.evaluate(() => window.__workspace.edit("Second"));
            assert.equal(
              await page.evaluate(() => window.__workspace.api.loadLatest()),
              false,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests[1].aborted),
              false,
            );
            await answer(page, 1, snapshot("First", R2));
            await count(page, 3);
            await answer(page, 2, snapshot("Second", R3));
            await page.waitForFunction(() => !window.__workspace.api.dirty);
            await page.evaluate(() => {
              void window.__workspace.api.loadLatest();
            });
            await count(page, 4);
            await answer(page, 3, snapshot("Latest server", R3));
            await page.waitForFunction(
              () =>
                window.__workspace.api.workspace.profile.name ===
                "Latest server",
            );
          }),
      );

      await t.test(
        "suspended demo transition cannot poison the committed account lifecycle",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() =>
              window.__workspace.edit("Pending account edit"),
            );
            await count(page, 2);
            await page.evaluate(() => window.__workspace.transitionDemo());
            await page.waitForFunction(() => window.__workspace.renderedDemo);
            await answer(page, 1, snapshot("Pending account edit", R2));
            await page.waitForFunction(() => !window.__workspace.api.dirty);
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "Pending account edit",
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspace.edit("Still account"),
              ),
              true,
            );
            await count(page, 3);
            assert.equal(
              await page.evaluate(
                () => window.__workspace.requests[2].body!.expectedRevision,
              ),
              R2,
            );
            await answer(page, 2, snapshot("Still account", R3));
            await page.waitForFunction(() => !window.__workspace.api.dirty);
          }),
      );

      await t.test(
        "temporary auth failure is reported without pretending the user signed out",
        () =>
          scenario(async (page) => {
            await mount(page, { authError: true });
            await failed(page);
            assert.equal(
              await page.evaluate(() => window.__workspace.api.error),
              "Account service unavailable",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.api.ready),
              false,
            );
            assert.deepEqual(
              await page.evaluate(() => window.__workspace.redirects),
              [],
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              0,
            );
          }),
      );

      await t.test(
        "network and malformed responses halt pending queue, retry keeps original revision",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => window.__workspace.edit("First"));
            await count(page, 2);
            await page.evaluate(() => window.__workspace.edit("Latest"));
            await page.evaluate(() => window.__workspace.fail(1));
            await failed(page);
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
            await page.evaluate(() => window.__workspace.api.retrySave());
            await count(page, 3);
            assert.equal(
              await page.evaluate(
                () => window.__workspace.requests[2].body!.expectedRevision,
              ),
              R1,
            );
            assert.equal(
              await page.evaluate(
                () =>
                  window.__workspace.requests[2].body!.workspace.profile.name,
              ),
              "Latest",
            );
            await answer(page, 2, "not json");
            await failed(page);
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "Latest",
            );
            await page.evaluate(() => window.__workspace.api.retrySave());
            await count(page, 4);
            assert.equal(
              await page.evaluate(
                () => window.__workspace.requests[3].body!.expectedRevision,
              ),
              R1,
            );
            await answer(page, 3, snapshot("Latest", R2));
            await page.waitForFunction(() => !window.__workspace.api.dirty);
          }),
      );

      await t.test(
        "conflict is sticky, failed reload preserves edits, successful explicit reload discards them",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => window.__workspace.edit("Pending"));
            await count(page, 2);
            await answer(
              page,
              1,
              { code: "CONFLICT", error: "Other tab saved" },
              409,
            );
            await page.waitForFunction(() => window.__workspace.api.conflict);
            assert.equal(
              await page.evaluate(() => window.__workspace.edit("Blocked")),
              false,
            );
            await page.evaluate(() => window.__workspace.api.retrySave());
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
            await page.evaluate(() => {
              void window.__workspace.api.loadLatest();
            });
            await count(page, 3);
            await page.evaluate(() => window.__workspace.fail(2));
            await page.waitForFunction(
              () => window.__workspace.api.error === "Network unavailable",
            );
            assert.deepEqual(
              await page.evaluate(() => ({
                conflict: window.__workspace.api.conflict,
                dirty: window.__workspace.api.dirty,
                name: window.__workspace.api.workspace.profile.name,
              })),
              { conflict: true, dirty: true, name: "Pending" },
            );
            await page.evaluate(() => window.__workspace.api.retrySave());
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              3,
            );
            await page.evaluate(() => {
              void window.__workspace.api.loadLatest();
            });
            await count(page, 4);
            await answer(page, 3, snapshot("Other tab", R3));
            await page.waitForFunction(
              () =>
                !window.__workspace.api.conflict &&
                !window.__workspace.api.dirty,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "Other tab",
            );
          }),
      );

      await t.test(
        "stale A saves use A precondition with B cookies and owner mismatch clears private data",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => window.__workspace.edit("Private A"));
            await count(page, 2);
            assert.equal(
              await page.evaluate(
                () => window.__workspace.requests[1].body!.expectedOwner,
              ),
              A,
            );
            await answer(
              page,
              1,
              { code: "OWNER_MISMATCH", error: "Account changed" },
              409,
            );
            await page.waitForFunction(() => !window.__workspace.api.ready);
            assert.deepEqual(
              await page.evaluate(() => [
                window.__workspace.api.email,
                window.__workspace.api.owner,
                window.__workspace.api.workspace.profile.name,
              ]),
              ["", null, ""],
            );
            await page.evaluate(() => {
              window.__workspace.api.retrySave();
              void window.__workspace.api.loadLatest();
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
          }),
      );

      await t.test(
        "logout aborts active save, cancels newer pending work and ignores late success",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => {
              window.__workspace.edit("Private");
              window.__workspace.edit("Queued");
              window.__workspace.auth(null);
            });
            await page.waitForFunction(() => !window.__workspace.api.ready);
            assert.equal(
              await page.evaluate(() => window.__workspace.requests[1].aborted),
              true,
            );
            await answer(page, 1, snapshot("Private", R2));
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.edit("No")),
              false,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
          }),
      );

      await t.test(
        "auth initialization race cannot publish old identity or start a GET",
        () =>
          scenario(async (page) => {
            await mount(page, { deferredAuth: true });
            assert.equal(
              await page.evaluate(() => window.__workspace.edit("No")),
              false,
            );
            await page.evaluate(() => window.__workspace.api.retrySave());
            await page.evaluate((b) => {
              window.__workspace.auth(b);
              window.__workspace.resolveAuth(
                "11111111-1111-4111-8111-111111111111",
              );
            }, B);
            await page.waitForFunction(
              () => window.__workspace.api.saveStatus === "Account changed",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              0,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.api.email),
              "",
            );
          }),
      );

      await t.test(
        "logout and unmount during getUser ignore late authentication completions",
        () =>
          scenario(async (page) => {
            await mount(page, { deferredAuth: true });
            await page.evaluate((owner) => {
              window.__workspace.auth(null);
              window.__workspace.resolveAuth(owner);
            }, A);
            await page.waitForFunction(
              () => window.__workspace.api.saveStatus === "Account changed",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              0,
            );
            await page.evaluate(() => window.__workspace.unmount());
          }),
      );

      await t.test(
        "same-owner auth event during GET preserves initialization and malformed GET can reload",
        () =>
          scenario(async (page) => {
            await mount(page);
            await count(page, 1);
            await page.evaluate((owner) => window.__workspace.auth(owner), A);
            await answer(page, 0, {
              owner: A,
              revision: R1,
              workspace: { invalid: true },
            });
            await failed(page);
            assert.equal(
              await page.evaluate(() => window.__workspace.api.ready),
              false,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.api.email),
              "",
            );
            await page.evaluate(() => {
              void window.__workspace.api.loadLatest();
            });
            await count(page, 2);
            await answer(page, 1, snapshot("Recovered"));
            await page.waitForFunction(() => window.__workspace.api.ready);
            assert.equal(
              await page.evaluate(() => window.__workspace.api.email),
              "a@test.invalid",
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspace.api.update((w) => {
                  w.profile.name = "Mutated";
                  throw new Error("Failed updater");
                }),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "Recovered",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
          }),
      );

      await t.test(
        "account switch during initial GET ignores late A response",
        () =>
          scenario(async (page) => {
            await mount(page);
            await count(page, 1);
            await page.evaluate((b) => window.__workspace.auth(b), B);
            await answer(page, 0, snapshot("Private A"));
            await page.waitForFunction(
              () => window.__workspace.api.saveStatus === "Account changed",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests[0].aborted),
              true,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "",
            );
          }),
      );

      await t.test(
        "GET owner mismatch never publishes ready or private email",
        () =>
          scenario(async (page) => {
            await mount(page);
            await count(page, 1);
            await answer(page, 0, snapshot("Private B", R1, B));
            await page.waitForFunction(
              () => window.__workspace.api.saveStatus === "Account changed",
            );
            assert.deepEqual(
              await page.evaluate(() => [
                window.__workspace.api.ready,
                window.__workspace.api.email,
                window.__workspace.api.owner,
              ]),
              [false, "", null],
            );
          }),
      );

      await t.test(
        "account switch during explicit reload cannot restore old private display",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => {
              void window.__workspace.api.loadLatest();
            });
            await count(page, 2);
            await page.evaluate((b) => window.__workspace.auth(b), B);
            await answer(page, 1, snapshot("Private A", R2));
            await page.waitForFunction(
              () => window.__workspace.api.saveStatus === "Account changed",
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "",
            );
            await page.evaluate(() => {
              void window.__workspace.api.loadLatest();
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
          }),
      );

      await t.test(
        "unmount aborts in-flight request and old callbacks cannot queue another save",
        () =>
          scenario(async (page) => {
            await mount(page);
            await ready(page);
            await page.evaluate(() => {
              window.__workspace.edit("Private");
              window.__workspace.edit("Queued");
              window.__workspace.oldApi = window.__workspace.api;
              window.__workspace.unmount();
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.requests[1].aborted),
              true,
            );
            await answer(page, 1, snapshot("Private", R2));
            assert.equal(
              await page.evaluate(() =>
                window.__workspace.oldApi!.update((w) => w),
              ),
              false,
            );
            await page.evaluate(() => {
              window.__workspace.oldApi!.retrySave();
              void window.__workspace.oldApi!.loadLatest();
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.unsubscribed),
              1,
            );
          }),
      );

      await t.test(
        "unmount before client resolves never subscribes or fetches",
        () =>
          scenario(async (page) => {
            await mount(page, { deferredClient: true });
            await page.evaluate(() => {
              window.__workspace.unmount();
              window.__workspace.resolveClient();
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              0,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.unsubscribed),
              0,
            );
          }),
      );

      await t.test(
        "unmount while getUser runs unsubscribes and prevents a later GET",
        () =>
          scenario(async (page) => {
            await mount(page, { deferredAuth: true });
            await page.evaluate((owner) => {
              window.__workspace.unmount();
              window.__workspace.resolveAuth(owner);
            }, A);
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              0,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.unsubscribed),
              1,
            );
          }),
      );

      await t.test(
        "demo initial storage failure still permits search but rejects unsaved edits",
        () =>
          scenario(async (page) => {
            await mount(page, { demo: true, blockedStorage: true });
            await page.waitForFunction(() => window.__workspace.api.ready);
            assert.equal(
              await page.evaluate(() => window.__workspace.api.saveStatus),
              "Demo not saved",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.edit("Unsaved")),
              false,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              0,
            );
          }),
      );

      await t.test(
        "demo is isolated, handles storage/updater failure and never retries through cloud",
        () =>
          scenario(async (page) => {
            await mount(page, { demo: true });
            await page.waitForFunction(() => window.__workspace.api.ready);
            await page.evaluate(() => window.__workspace.edit("Demo only"));
            await page.evaluate(() => {
              window.__workspace.blockedStorage = true;
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.edit("Lost")),
              false,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "Demo only",
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspace.api.update(() => {
                  throw new Error("Updater failed");
                }),
              ),
              false,
            );
            await page.evaluate(() => {
              window.__workspace.api.retrySave();
              void window.__workspace.api.loadLatest();
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              0,
            );
            assert.equal(
              await page.evaluate(
                (key) => JSON.parse(localStorage.getItem(key)!).profile.name,
                KEY,
              ),
              "Demo only",
            );
          }),
      );

      await t.test(
        "new cloud account never imports demo and mode switch cancels cloud lifecycle",
        () =>
          scenario(async (page) => {
            const storedDemo = createEmptyWorkspace();
            storedDemo.profile.name = "Local demo";
            await mount(page, { storedDemo });
            await count(page, 1);
            await answer(page, 0, snapshot("", null));
            await page.waitForFunction(() => window.__workspace.api.ready);
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "Account name",
            );
            await page.evaluate(() => {
              window.__workspace.edit("Account private");
              window.__workspace.oldApi = window.__workspace.api;
              window.__workspace.mode(true);
            });
            await page.waitForFunction(
              () =>
                window.__workspace.api.workspace.profile.name === "Local demo",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests[1].aborted),
              true,
            );
            await answer(page, 1, snapshot("Account private", R2));
            await page.evaluate(() => {
              window.__workspace.oldApi!.retrySave();
              void window.__workspace.oldApi!.loadLatest();
            });
            assert.equal(
              await page.evaluate(() =>
                window.__workspace.oldApi!.update((w) => w),
              ),
              false,
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "Local demo",
            );
          }),
      );

      await t.test(
        "captured A callbacks stay invalid after cloud to demo to B cloud",
        () =>
          scenario(async (page) => {
            await mount(page, { deferredAuth: true });
            await page.evaluate(
              (owner) => window.__workspace.resolveAuth(owner),
              A,
            );
            await ready(page);
            await page.evaluate(() => {
              window.__workspace.oldApi = window.__workspace.api;
              window.__workspace.mode(true);
            });
            await page.waitForFunction(
              () =>
                window.__workspace.api.saveStatus === "Saved in this browser",
            );
            await page.evaluate(() => window.__workspace.mode(false));
            await page.waitForFunction(() => !window.__workspace.api.ready);
            await page.evaluate(
              (owner) => window.__workspace.resolveAuth(owner),
              B,
            );
            await count(page, 2);
            await answer(page, 1, snapshot("B private", R1, B));
            await page.waitForFunction(
              () =>
                window.__workspace.api.owner ===
                "22222222-2222-4222-8222-222222222222",
            );
            assert.equal(
              await page.evaluate(() =>
                window.__workspace.oldApi!.update((w) => ({
                  ...w,
                  profile: { ...w.profile, name: "A stale" },
                })),
              ),
              false,
            );
            await page.evaluate(() => {
              window.__workspace.oldApi!.retrySave();
              void window.__workspace.oldApi!.loadLatest();
              window.__workspace.oldApi!.setError("A stale error");
            });
            assert.equal(
              await page.evaluate(() => window.__workspace.requests.length),
              2,
            );
            assert.equal(
              await page.evaluate(
                () => window.__workspace.api.workspace.profile.name,
              ),
              "B private",
            );
            assert.equal(
              await page.evaluate(() => window.__workspace.api.error),
              "",
            );
          }),
      );
    } finally {
      await browser.close();
    }
  },
);
