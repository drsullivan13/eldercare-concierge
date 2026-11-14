import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import type { useOutreach } from "../src/hooks/use-outreach";
import type { Workspace } from "../src/lib/workspace";
import {
  parseOutreachRecord,
  type OutreachProvider,
  type OutreachRecord,
} from "../src/lib/outreach";
import { chromiumLaunchOptions } from "../scripts/lib/chromium.mjs";

type Harness = {
  api: ReturnType<typeof useOutreach>;
  workspace: Workspace;
  reject: boolean;
  blockedStorage: boolean;
  openings: {
    url: string;
    target: string;
    features: string;
    saved: Workspace;
  }[];
  edit(note: string): void;
  setReady(ready: boolean): void;
  unmount(): void;
};

declare global {
  interface Window {
    __outreach: Harness;
  }
}

const provider = {
  providerId: "care-1",
  providerName: "Care 海",
  phone: "201-555-0100",
};
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function mount(page: Page, editorProvider?: OutreachProvider) {
  // Use the bundler already shipped with the declared tsx test runner.
  const require = createRequire(resolve("package.json"));
  const { build } = createRequire(require.resolve("tsx/package.json"))(
    "esbuild",
  );
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import { createRoot } from "react-dom/client";
        import { useState, useRef, useCallback } from "react";
        import { useOutreach } from "./src/hooks/use-outreach";
        import { OutreachEditor } from "./src/components/dashboard/outreach";
        import { createEmptyWorkspace, validateWorkspace } from "./src/lib/workspace";
        import "./src/app/globals.css";
        const provider = ${JSON.stringify(editorProvider ?? null)};
        const key = "harbor.demo.workspace.v1";
        const h = window.__outreach = { reject: false, blockedStorage: false, openings: [] };
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (...args) {
          if (h.blockedStorage) throw new Error("Blocked storage");
          return originalSetItem.apply(this, args);
        };
        window.open = (url, target, features) => {
          h.openings.push({ url, target, features, saved: JSON.parse(localStorage.getItem(key)) });
          return null;
        };
        const root = createRoot(document.getElementById("root"));
        h.unmount = () => root.unmount();
        function App() {
          const [workspace, setWorkspace] = useState(() => JSON.parse(localStorage.getItem(key)) || createEmptyWorkspace());
          const current = useRef(workspace);
          const [ready, setReady] = useState(true);
          const [editing, setEditing] = useState(Boolean(provider));
          const update = useCallback(updater => {
            if (h.reject) return false;
            const checked = validateWorkspace({ ...updater(current.current), updatedAt: new Date().toISOString() });
            if (!checked.ok) return false;
            localStorage.setItem(key, JSON.stringify(checked.workspace));
            current.current = checked.workspace;
            setWorkspace(checked.workspace);
            return true;
          }, []);
          h.api = useOutreach(workspace, update, ready, true);
          h.workspace = workspace;
          h.setReady = setReady;
          h.edit = note => update(w => ({ ...w, notes: { ...w.notes, "care-1": note } }));
          return editing ? <OutreachEditor provider={provider} launch={h.api.launch} error={h.api.error} close={() => setEditing(false)} /> : null;
        }
        root.render(<App />);
      `,
    },
    bundle: true,
    write: false,
    outfile: "outreach-harness.js",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    tsconfig: "tsconfig.json",
  });
  await page.route("https://harbor.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://harbor.test/");
  await page.addStyleTag({
    content: bundle.outputFiles.find((file: { path: string }) =>
      file.path.endsWith(".css"),
    ).text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file: { path: string }) =>
      file.path.endsWith(".js"),
    ).text,
  });
  await page.waitForFunction(
    () => Boolean(window.__outreach?.api) && !window.__outreach.api.refreshing,
  );
}

test("outreach hook persists before opening, deduplicates clicks and recovers across reload and tabs", async () => {
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  try {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await context.route("**/api/outreach-result", (route) =>
      route.fulfill({ status: 404 }),
    );
    await mount(first);
    assert.equal(
      await first.evaluate(
        (p) => window.__outreach.api.launch(p, ["Costs", "Costs"], "Visit?"),
        provider,
      ),
      true,
    );
    await first.waitForFunction(
      () => window.__outreach.api.records.length === 1,
    );
    const opening = await first.evaluate(() => window.__outreach.openings[0]);
    assert.equal(opening.target, "_blank");
    assert.equal(opening.features, "noopener,noreferrer");
    assert.equal(opening.saved.outreach?.length, 1);
    const brief = JSON.parse(
      Buffer.from(new URL(opening.url).hash.slice(10), "base64url").toString(
        "utf8",
      ),
    );
    assert.deepEqual(brief, opening.saved.outreach![0].brief);
    assert.equal(
      await first.evaluate(
        (p) => window.__outreach.api.launch(p, ["Costs"], "Visit?"),
        provider,
      ),
      true,
    );
    assert.equal(
      await first.evaluate(() => window.__outreach.api.records.length),
      1,
    );

    await mount(second);
    await second.waitForFunction(
      () => window.__outreach.api.records.length === 1,
    );
    assert.equal(
      await second.evaluate(
        (p) => window.__outreach.api.launch(p, ["Staff"], "Night cover?"),
        provider,
      ),
      true,
    );
    await first.waitForFunction(
      () => window.__outreach.api.records.length === 2,
    );
    await first.evaluate(() => window.__outreach.edit("Keep this local edit"));
    await second.evaluate(() =>
      window.__outreach.api.reopen(window.__outreach.api.records[0]),
    );
    await first.waitForFunction(
      () =>
        window.__outreach.workspace.notes["care-1"] === "Keep this local edit",
    );
    const originalId = opening.saved.outreach![0].brief.requestId;
    assert.equal(
      await second.evaluate(
        () => window.__outreach.openings.at(-1)?.saved.outreach?.length,
      ),
      2,
    );
    assert.equal(
      await second.evaluate(
        () => window.__outreach.api.records[0].brief.requestId,
      ),
      originalId,
    );

    await first.reload();
    await mount(first);
    await first.waitForFunction(
      () => window.__outreach.api.records.length === 2,
    );
    assert.equal(
      await first.evaluate(() => window.__outreach.workspace.notes["care-1"]),
      "Keep this local edit",
    );
  } finally {
    await browser.close();
  }
});

test("outreach hook refuses unsaved launches and untrusted parent detail", async () => {
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route("**/api/outreach-result", (route) =>
      route.fulfill({ status: 404 }),
    );
    await mount(page);
    await page.evaluate(() => {
      window.__outreach.blockedStorage = true;
    });
    assert.equal(
      await page.evaluate(
        (p) => window.__outreach.api.launch(p, [], ""),
        provider,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() => window.__outreach.openings.length),
      0,
    );
    await page.evaluate(() => {
      window.__outreach.blockedStorage = false;
      window.__outreach.reject = true;
    });
    assert.equal(
      await page.evaluate(
        (p) => window.__outreach.api.launch(p, [], ""),
        provider,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() => window.__outreach.openings.length),
      0,
    );
    await page.evaluate(() => {
      window.__outreach.reject = false;
      window.__outreach.setReady(false);
    });
    await page.waitForTimeout(20);
    assert.equal(
      await page.evaluate(
        (p) => window.__outreach.api.launch(p, [], ""),
        provider,
      ),
      false,
    );
    await page.evaluate(() => window.__outreach.setReady(true));
    await page.waitForTimeout(20);
    assert.equal(
      await page.evaluate(
        (p) => window.__outreach.api.launch(p, [], "Start"),
        provider,
      ),
      true,
    );
    await page.waitForFunction(
      () => window.__outreach.api.records.length === 1,
    );
    assert.equal(
      await page.evaluate((p) => {
        const forged = {
          ...window.__outreach.api.records[0],
          findings: ["Forged finding"],
          nextSteps: ["Forged request"],
        };
        return window.__outreach.api.launch(p, [], "Follow up", forged);
      }, provider),
      true,
    );
    const child = await page.evaluate(() =>
      window.__outreach.api.records.at(-1)!,
    );
    assert.ok(!child.brief.previous?.includes("Forged"));
    assert.match(child.brief.previous!, /Prior user request: Start/);
    assert.equal(
      await page.evaluate((p) => {
        const forged = {
          ...window.__outreach.api.records[0],
          brief: {
            ...window.__outreach.api.records[0].brief,
            requestId: crypto.randomUUID(),
          },
        };
        return window.__outreach.api.launch(p, [], "Follow up again", forged);
      }, provider),
      false,
    );
  } finally {
    await browser.close();
  }
});

test("refresh validates results, limits concurrency, backs off and never regresses terminal status", async () => {
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    let live = 0;
    let maximum = 0;
    let calls = 0;
    let valid = false;
    let resultState = "completed";
    const bodies: { requestId: string; readKey: string }[] = [];
    await page.route("**/api/outreach-result", async (route) => {
      live++;
      maximum = Math.max(maximum, live);
      calls++;
      bodies.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 25));
      live--;
      await route.fulfill({
        json: {
          state: resultState,
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          findings: valid ? ["Rehearsal only"] : [42],
          nextSteps: ["Confirm with provider"],
        },
      });
    });
    await mount(page);
    for (let index = 0; index < 5; index++)
      assert.equal(
        await page.evaluate(
          ({ p, index }) =>
            window.__outreach.api.launch(p, [], `Question ${index}`),
          { p: provider, index },
        ),
        true,
      );
    await page.evaluate(() =>
      Promise.all([
        window.__outreach.api.refresh(),
        window.__outreach.api.refresh(),
      ]),
    );
    assert.equal(maximum, 2);
    assert.equal(calls, 5);
    assert.ok(await page.evaluate(() => Boolean(window.__outreach.api.error)));
    assert.equal(
      await page.evaluate(() =>
        window.__outreach.api.records.every(
          (record) => record.state === "requested",
        ),
      ),
      true,
    );
    for (const body of bodies) {
      assert.deepEqual(Object.keys(body).sort(), ["readKey", "requestId"]);
      assert.match(body.readKey, /^[0-9a-f]{64}$/);
    }
    await page.evaluate(() => window.__outreach.api.refresh(false));
    assert.equal(calls, 5);
    valid = true;
    await page.clock.install();
    await page.clock.fastForward(31_000);
    await page.evaluate(() => window.__outreach.api.refresh());
    await page.waitForFunction(() =>
      window.__outreach.api.records.every(
        (record) => record.state === "completed",
      ),
    );
    const terminal = await page.evaluate(
      () => window.__outreach.api.records[0],
    );
    assert.equal(calls, 10);
    resultState = "opened";
    await page.clock.fastForward(121_000);
    await page.evaluate(() => window.__outreach.api.refresh());
    assert.equal(calls, 10);
    const stale: OutreachRecord = {
      ...terminal,
      state: "opened",
      findings: ["Older retained detail"],
      updatedAt: terminal.createdAt,
    };
    await page.evaluate((record) => {
      const key = "harbor.demo.workspace.v1";
      const workspace = {
        ...window.__outreach.workspace,
        outreach: window.__outreach.api.records.map((item) =>
          item.brief.requestId === record.brief.requestId ? record : item,
        ),
      };
      localStorage.setItem(key, JSON.stringify(workspace));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: JSON.stringify(workspace),
        }),
      );
    }, stale);
    assert.deepEqual(
      await page.evaluate(() => window.__outreach.api.records[0]),
      terminal,
    );
  } finally {
    await browser.close();
  }
});

test("a late result cannot write after the workspace becomes unready", async () => {
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = () => {};
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  try {
    const page = await browser.newPage();
    await page.route("**/api/outreach-result", async (route) => {
      requested();
      await held;
      await route.fulfill({
        json: {
          state: "completed",
          updatedAt: new Date().toISOString(),
          findings: ["Late result"],
          nextSteps: [],
        },
      });
    });
    await mount(page);
    await page.evaluate(
      (p) => window.__outreach.api.launch(p, [], "Ask"),
      provider,
    );
    await page.evaluate(() => {
      void window.__outreach.api.refresh();
    });
    await started;
    await page.evaluate(() => window.__outreach.setReady(false));
    await page.waitForTimeout(20);
    release();
    await page.waitForTimeout(20);
    assert.equal(
      await page.evaluate(
        () => window.__outreach.workspace.outreach?.[0].state,
      ),
      "requested",
    );
    assert.deepEqual(
      await page.evaluate(
        () => window.__outreach.workspace.outreach?.[0].findings,
      ),
      [],
    );
  } finally {
    release();
    await browser.close();
  }
});

test("polling waits while hidden, resumes on focus, treats 404 as pending and supports manual refresh", async () => {
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    let calls = 0;
    let state = "";
    await page.route("**/api/outreach-result", (route) => {
      calls++;
      return state
        ? route.fulfill({
            json: {
              state,
              updatedAt: new Date().toISOString(),
              findings: ["Rehearsal finding"],
              nextSteps: [],
            },
          })
        : route.fulfill({ status: 404 });
    });
    await mount(page);
    await page.clock.install();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
    });
    assert.equal(
      await page.evaluate(
        (p) => window.__outreach.api.launch(p, [], "Ask"),
        provider,
      ),
      true,
    );
    await page.clock.fastForward(60_000);
    assert.equal(calls, 0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(() => !window.__outreach.api.refreshing);
    assert.equal(calls, 1);
    assert.equal(await page.evaluate(() => window.__outreach.api.error), "");
    assert.equal(
      await page.evaluate(() => window.__outreach.api.records[0].state),
      "requested",
    );
    state = "opened";
    await page.clock.fastForward(31_000);
    await page.evaluate(() => window.__outreach.api.refresh());
    await page.waitForFunction(
      () => window.__outreach.api.records[0].state === "opened",
    );
    state = "connected";
    await page.evaluate(() => window.__outreach.api.refresh());
    await page.waitForFunction(
      () => window.__outreach.api.records[0].state === "connected",
    );
    await page.evaluate(() => window.__outreach.edit("Keep the latest note"));
    state = "completed";
    await page.evaluate(() => window.__outreach.api.refresh());
    await page.waitForFunction(
      () => window.__outreach.api.records[0].state === "completed",
    );
    assert.equal(
      await page.evaluate(() => window.__outreach.workspace.notes["care-1"]),
      "Keep the latest note",
    );
    const beforeUnmount = calls;
    await page.evaluate(() => window.__outreach.unmount());
    await page.clock.fastForward(121_000);
    assert.equal(calls, beforeUnmount);
  } finally {
    await browser.close();
  }
});

test("failed records refresh manually and on focus, obey automatic backoff and stop at completion", async () => {
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    let calls = 0;
    let unavailable = false;
    let result = {
      state: "failed",
      updatedAt: "2026-11-13T10:00:00.000Z",
      findings: ["Interrupted"],
      nextSteps: ["Retry"],
    };
    await page.route("**/api/outreach-result", (route) => {
      calls++;
      return route.fulfill(unavailable ? { status: 503 } : { json: result });
    });
    await mount(page);
    await page.clock.install({ time: new Date("2026-11-14T12:00:00.000Z") });
    assert.equal(
      await page.evaluate(
        (p) => window.__outreach.api.launch(p, ["Pricing"], ""),
        { ...provider, phone: "" },
      ),
      true,
    );
    const original = await page.evaluate(
      () => window.__outreach.api.records[0],
    );
    await page.evaluate(() => window.__outreach.api.refresh());
    assert.equal(
      await page.evaluate(() => window.__outreach.api.records[0].state),
      "failed",
    );
    assert.equal(calls, 1);

    result = { ...result, state: "opened" };
    await page.evaluate(() => window.__outreach.api.refresh());
    assert.equal(calls, 2);
    assert.equal(
      await page.evaluate(() => window.__outreach.api.records[0].state),
      "failed",
    );
    result = {
      ...result,
      updatedAt: "2026-11-13T10:00:00.001Z",
      findings: ["Recovered"],
      nextSteps: [],
    };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(
      () => window.__outreach.api.records[0].state === "opened",
    );
    assert.equal(calls, 3);

    result = {
      ...result,
      state: "failed",
      updatedAt: "2026-11-13T10:00:01.000Z",
    };
    await page.evaluate(() => window.__outreach.api.refresh());
    unavailable = true;
    await page.evaluate(() => window.__outreach.api.refresh());
    assert.equal(calls, 5);
    assert.ok(await page.evaluate(() => Boolean(window.__outreach.api.error)));
    await page.evaluate(() => window.__outreach.api.refresh(false));
    await page.clock.fastForward(15_000);
    assert.equal(calls, 5);
    unavailable = false;
    result = {
      ...result,
      state: "connected",
      updatedAt: "2026-11-13T10:00:02.000Z",
    };
    await page.evaluate(() => window.__outreach.api.refresh());
    assert.equal(calls, 6);
    assert.equal(
      await page.evaluate(() => window.__outreach.api.records[0].state),
      "connected",
    );

    result = {
      ...result,
      state: "failed",
      updatedAt: "2026-11-13T10:00:03.000Z",
    };
    await page.evaluate(() => window.__outreach.api.refresh());
    result = {
      ...result,
      state: "completed",
      updatedAt: "2026-11-13T10:00:04.000Z",
    };
    await page.clock.fastForward(15_000);
    await page.waitForFunction(
      () => window.__outreach.api.records[0].state === "completed",
    );
    assert.equal(calls, 8);
    const completed = await page.evaluate(
      () => window.__outreach.api.records[0],
    );
    assert.deepEqual(completed.brief, original.brief);
    assert.equal(completed.createdAt, original.createdAt);
    assert.ok(completed.updatedAt < completed.createdAt);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.evaluate(() => window.__outreach.api.refresh());
    await page.clock.fastForward(121_000);
    assert.equal(calls, 8);
    assert.deepEqual(
      await page.evaluate(() => window.__outreach.api.records[0]),
      completed,
    );
  } finally {
    await browser.close();
  }
});

test("compact composer validates after submit and launches without a listed phone on short screens", async () => {
  const browser = await chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
  try {
    for (const viewport of [
      { width: 390, height: 480 },
      { width: 844, height: 390 },
    ]) {
      const page = await browser.newPage({ viewport });
      await page.route("**/api/outreach-result", (route) =>
        route.fulfill({ status: 404 }),
      );
      await mount(page, { ...provider, phone: "" });
      const editor = page.getByRole("dialog", { name: "Prepare outreach" });
      const submit = editor.getByRole("button", { name: "Open rehearsal" });
      const validation = editor.getByText(
        "Choose at least one goal or write a question.",
      );
      assert.equal(await validation.count(), 0);
      assert.match(
        await editor.innerText(),
        /Practice in the browser\. No provider will be called\./,
      );
      assert.doesNotMatch(
        await editor.innerText(),
        /No phone|Listed phone|unavailable/,
      );
      assert.equal(await submit.isEnabled(), true);
      await submit.click();
      assert.equal(await validation.isVisible(), true);
      assert.equal(
        await page.evaluate(() => window.__outreach.openings.length),
        0,
      );
      const goal = editor.getByRole("checkbox", {
        name: "Pricing",
        exact: true,
      });
      await goal.check();
      assert.equal(await validation.count(), 0);
      const question = editor.getByRole("textbox", {
        name: "Your question or another goal",
      });
      const textarea = await question.boundingBox();
      assert.ok(textarea && textarea.height <= 160);
      await submit.scrollIntoViewIfNeeded();
      const button = await submit.boundingBox();
      assert.ok(
        button && button.y >= 0 && button.y + button.height <= viewport.height,
      );
      assert.equal(
        await editor.evaluate(
          (dialog) => dialog.scrollWidth <= dialog.clientWidth,
        ),
        true,
      );
      await submit.click();
      await page.waitForFunction(() => window.__outreach.openings.length === 1);
      const opening = await page.evaluate(() => window.__outreach.openings[0]);
      const brief = JSON.parse(
        Buffer.from(new URL(opening.url).hash.slice(10), "base64url").toString(
          "utf8",
        ),
      );
      assert.equal(brief.phone, "");
      assert.deepEqual(brief.topics, ["Pricing"]);
      assert.deepEqual(
        parseOutreachRecord(opening.saved.outreach?.[0])?.brief,
        brief,
      );
      assert.equal(await editor.count(), 0);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
