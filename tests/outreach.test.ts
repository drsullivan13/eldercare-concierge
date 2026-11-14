import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import type { useOutreach } from "../src/hooks/use-outreach";
import type { Workspace } from "../src/lib/workspace";
import {
  createOutreachRecord,
  mergeOutreach,
  outreachPending,
  outreachUrl,
  parseOutreachRecord,
  parseOutreachResult,
} from "../src/lib/outreach";
import { createEmptyWorkspace, validateWorkspace } from "../src/lib/workspace";
import { carePlanText } from "../src/components/dashboard/export-plan";

const provider = {
  providerId: "care-1",
  providerName: "Résidence 海",
  phone: "+1 201 555 0100",
};

declare global {
  interface Window {
    __integration: {
      api: ReturnType<typeof useOutreach>;
      workspace: Workspace;
      writes: number;
      mode(demo: boolean, workspace: Workspace): void;
    };
  }
}

test("old workspaces remain valid and outreach survives validation and reload", () => {
  const workspace = createEmptyWorkspace();
  assert.deepEqual(validateWorkspace(workspace), { ok: true, workspace });
  assert.deepEqual(workspace.outreach ?? [], []);
  const record = createOutreachRecord(
    provider,
    ["Costs", "Costs"],
    "Ask about visits",
  );
  workspace.outreach = [record];
  const restored = validateWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(restored, { ok: true, workspace });
  assert.deepEqual(record.brief.topics, ["Costs"]);
  assert.equal(record.brief.readKey.length, 64);
  assert.match(record.brief.readKey, /^[0-9a-f]{64}$/);
  assert.notEqual(
    createOutreachRecord(provider, [], "").brief.readKey,
    record.brief.readKey,
  );
  assert.notEqual(
    createOutreachRecord(provider, [], "").brief.requestId,
    record.brief.requestId,
  );
});

test("the production fragment transports UTF-8 JSON without query-string credentials", () => {
  const record = createOutreachRecord(provider, ["介護"], "Quels coûts ?");
  const url = new URL(outreachUrl(record.brief));
  assert.equal(url.origin, "https://harbor-voice-lab.vercel.app");
  assert.equal(url.search, "");
  assert.match(url.hash, /^#outreach=[A-Za-z0-9_-]+$/);
  assert.deepEqual(
    JSON.parse(
      Buffer.from(
        new URLSearchParams(url.hash.slice(1)).get("outreach")!,
        "base64url",
      ).toString("utf8"),
    ),
    record.brief,
  );
});

test("account launches append only a fragment workspace hint and demo URLs stay byte-compatible", () => {
  const record = createOutreachRecord(
    provider,
    ["介護"],
    "Private question 海",
  );
  const legacy = `https://harbor-voice-lab.vercel.app/#outreach=${Buffer.from(JSON.stringify(record.brief), "utf8").toString("base64url")}`;
  assert.equal(outreachUrl(record.brief), legacy);
  assert.equal(outreachUrl(record.brief, "demo"), legacy);
  assert.equal(
    outreachUrl(record.brief, "account"),
    `${legacy}&workspace=account`,
  );
  for (const mode of ["demo", "account"] as const) {
    const url = new URL(outreachUrl(record.brief, mode));
    const fragment = new URLSearchParams(url.hash.slice(1));
    assert.equal(url.search, "");
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.ok(!url.href.split("#")[0].includes(record.brief.readKey));
    assert.ok(!url.href.split("#")[0].includes(record.brief.requestId));
    assert.ok(!url.href.includes(record.brief.question));
    assert.equal(
      fragment.get("workspace"),
      mode === "account" ? "account" : null,
    );
    assert.deepEqual(
      JSON.parse(
        Buffer.from(fragment.get("outreach")!, "base64url").toString("utf8"),
      ),
      record.brief,
    );
    assert.ok(parseOutreachRecord(record));
    assert.ok(!Object.hasOwn(record.brief, "workspace"));
  }
});

test("brief limits accept their exact maximum and reject excess or unknown fields", () => {
  const record = createOutreachRecord(
    provider,
    Array.from({ length: 6 }, (_, i) => `${i}${"x".repeat(79)}`),
    "q".repeat(1000),
  );
  record.brief.previous = "p".repeat(1200);
  assert.ok(parseOutreachRecord(record));
  for (const phone of ["", "x".repeat(64)])
    assert.ok(
      parseOutreachRecord({ ...record, brief: { ...record.brief, phone } }),
    );
  for (const brief of [
    { ...record.brief, topics: [...record.brief.topics, "extra"] },
    { ...record.brief, topics: ["x".repeat(81)] },
    { ...record.brief, question: "q".repeat(1001) },
    { ...record.brief, previous: "p".repeat(1201) },
    { ...record.brief, requestId: "not-a-uuid" },
    { ...record.brief, readKey: "z".repeat(64) },
    { ...record.brief, readKey: "a".repeat(63) },
    { ...record.brief, phone: null },
    { ...record.brief, phone: "x".repeat(65) },
    { ...record.brief, token: "extra" },
  ]) {
    assert.equal(parseOutreachRecord({ ...record, brief }), null);
    assert.equal(
      validateWorkspace({
        ...createEmptyWorkspace(),
        outreach: [{ ...record, brief }],
      }).ok,
      false,
    );
  }
  assert.equal(
    validateWorkspace({ ...createEmptyWorkspace(), outreach: [record, record] })
      .ok,
    false,
  );
  assert.equal(
    validateWorkspace({ ...createEmptyWorkspace(), outreach: null }).ok,
    false,
  );
});

test("result validation rejects invalid state, timestamp, findings and next steps", () => {
  const result = {
    state: "completed",
    updatedAt: "2026-11-13T10:00:00Z",
    findings: ["One"],
    nextSteps: ["Two"],
  };
  assert.deepEqual(parseOutreachResult(result), result);
  for (const change of [
    { state: "requested" },
    { state: { toString: () => "opened" } },
    { updatedAt: "tomorrow" },
    { updatedAt: "2026-02-30T10:00:00Z" },
    { findings: [12] },
    { findings: [""] },
    { nextSteps: null },
    { findings: ["x".repeat(1201)] },
    { findings: Array(17).fill("Finding") },
    { nextSteps: ["x".repeat(1201)] },
    { nextSteps: Array(13).fill("Next step") },
    { extra: true },
  ])
    assert.equal(parseOutreachResult({ ...result, ...change }), null);
  const maximum = {
    ...result,
    findings: Array.from({ length: 16 }, (_, i) => `${i}`.padEnd(1200, "f")),
    nextSteps: Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(1200, "n")),
  };
  assert.deepEqual(parseOutreachResult(maximum), maximum);
  const record = createOutreachRecord({ ...provider, phone: "" }, ["Tour"], "");
  assert.ok(parseOutreachRecord({ ...record, ...maximum }));
});

test("merging keeps the winning server snapshot, terminal state and immutable brief", () => {
  const base = createOutreachRecord(provider, [], "");
  const opened = {
    ...base,
    state: "opened" as const,
    updatedAt: new Date(Date.parse(base.createdAt) + 1000).toISOString(),
    findings: ["Opened detail"],
  };
  const connected = {
    ...base,
    state: "connected" as const,
    updatedAt: new Date(Date.parse(base.createdAt) + 2000).toISOString(),
    findings: ["Connected detail"],
  };
  const completed = {
    ...connected,
    state: "completed" as const,
    nextSteps: ["Call back"],
  };
  assert.equal(mergeOutreach([connected], [opened])[0].state, "connected");
  assert.equal(mergeOutreach([opened], [connected])[0].state, "connected");
  const merged = mergeOutreach(
    [completed],
    [
      {
        ...opened,
        updatedAt: new Date(Date.parse(base.createdAt) + 3000).toISOString(),
      },
    ],
  )[0];
  assert.equal(merged.state, "completed");
  assert.deepEqual(merged.findings, ["Connected detail"]);
  assert.deepEqual(merged.nextSteps, ["Call back"]);
  assert.equal(outreachPending(merged), false);
  assert.equal(
    mergeOutreach([completed], [{ ...completed, state: "failed" }])[0].state,
    "completed",
  );
  assert.equal(
    mergeOutreach([connected], [{ ...opened, state: "completed" }])[0].state,
    "completed",
  );
  assert.deepEqual(
    mergeOutreach(
      [connected],
      [{ ...opened, brief: { ...opened.brief, readKey: "0".repeat(64) } }],
    ),
    [connected],
  );
  assert.equal(
    mergeOutreach([base], [{ ...base, state: "connected" }])[0].state,
    "connected",
  );
});

test("equivalent cross-tab detail merges converge without storage rewrite loops", () => {
  const base = createOutreachRecord(provider, [], "");
  const a = {
    ...base,
    state: "opened" as const,
    findings: ["Queued"],
    nextSteps: ["Connect"],
  };
  const b = {
    ...base,
    state: "completed" as const,
    findings: ["Finished"],
    nextSteps: ["Confirm"],
  };
  assert.deepEqual(mergeOutreach([a], [b]), mergeOutreach([b], [a]));
  const second = createOutreachRecord(provider, [], "Second");
  assert.deepEqual(
    mergeOutreach([a, second], [b]),
    mergeOutreach([second, b], [a]),
  );
});

test("rejected regressions cannot move the status clock past a valid completion", () => {
  const base = createOutreachRecord(provider, [], "");
  const at = (seconds: number) =>
    new Date(Date.parse(base.createdAt) + seconds * 1000).toISOString();
  const connected = { ...base, state: "connected" as const, updatedAt: at(2) };
  const regressed = mergeOutreach(
    [connected],
    [{ ...base, state: "opened", updatedAt: at(4) }],
  )[0];
  assert.equal(regressed.updatedAt, at(2));
  const completed = mergeOutreach(
    [regressed],
    [{ ...base, state: "completed", updatedAt: at(3) }],
  )[0];
  assert.equal(completed.state, "completed");
  assert.equal(completed.updatedAt, at(3));
});

test("server time before browser creation is accepted without stale queued actions", () => {
  const base = createOutreachRecord(provider, [], "");
  const queued = {
    ...base,
    nextSteps: ["Open the queued rehearsal"],
  };
  const completed = {
    ...base,
    state: "completed" as const,
    updatedAt: new Date(Date.parse(base.createdAt) - 60_000).toISOString(),
    findings: ["Rehearsal complete"],
    nextSteps: ["Verify with provider"],
  };
  const combined = mergeOutreach([queued], [completed]);
  assert.deepEqual(combined, [completed]);
  assert.deepEqual(mergeOutreach(combined, [queued]), combined);
  assert.deepEqual(mergeOutreach(combined, [completed]), combined);
  assert.ok(
    validateWorkspace({ ...createEmptyWorkspace(), outreach: combined }).ok,
  );
});

test("failed rehearsals recover only from strictly newer server snapshots", () => {
  const base = createOutreachRecord(provider, [], "Keep this brief");
  const failed = {
    ...base,
    state: "failed" as const,
    updatedAt: "2026-11-13T10:00:00.000Z",
    findings: ["Interrupted"],
    nextSteps: ["Try again"],
  };
  for (const state of ["opened", "connected", "completed"] as const) {
    for (const updatedAt of [
      "2026-11-13T09:59:59.999Z",
      failed.updatedAt,
      "2026-11-13T10:00:00.001Z",
    ]) {
      const incoming = {
        ...failed,
        state,
        updatedAt,
        findings: ["Recovered"],
        nextSteps: ["Confirm with staff"],
      };
      assert.deepEqual(mergeOutreach([failed], [incoming]), [
        updatedAt > failed.updatedAt ? incoming : failed,
      ]);
    }
  }
  assert.deepEqual(
    mergeOutreach(
      [failed],
      [{ ...base, updatedAt: "2026-11-13T11:00:00.000Z" }],
    ),
    [failed],
  );
});

test("eligible merges keep the saved brief and apply a changed server snapshot", () => {
  const base = createOutreachRecord(provider, ["Costs"], "Ask about visits");
  const saved = {
    ...base,
    state: "opened" as const,
    updatedAt: "2026-11-13T10:00:00.000Z",
    findings: ["Opened detail"],
    nextSteps: ["Connect"],
  };
  const sameState = mergeOutreach(
    [saved],
    [
      {
        ...saved,
        updatedAt: "2026-11-13T10:00:01.000Z",
        findings: ["Newer detail"],
        nextSteps: ["Call back"],
      },
    ],
  )[0];
  assert.equal(sameState.state, "opened");
  assert.equal(sameState.updatedAt, "2026-11-13T10:00:01.000Z");
  assert.deepEqual(sameState.findings, ["Newer detail"]);
  assert.deepEqual(sameState.nextSteps, ["Call back"]);
  assert.equal(sameState.brief, saved.brief);
  assert.equal(sameState.createdAt, saved.createdAt);

  const advanced = mergeOutreach(
    [saved],
    [
      {
        ...saved,
        state: "connected",
        updatedAt: "2026-11-13T09:00:00.000Z",
        findings: ["Connected detail"],
        nextSteps: ["Confirm"],
      },
    ],
  )[0];
  assert.equal(advanced.state, "connected");
  assert.equal(advanced.updatedAt, "2026-11-13T09:00:00.000Z");
  assert.deepEqual(advanced.findings, ["Connected detail"]);
  assert.equal(advanced.brief, saved.brief);

  const failed = {
    ...saved,
    state: "failed" as const,
    findings: ["Interrupted"],
    nextSteps: ["Try again"],
  };
  const recovered = mergeOutreach(
    [failed],
    [
      {
        ...failed,
        state: "completed" as const,
        updatedAt: "2026-11-13T10:00:00.001Z",
        findings: ["Recovered"],
        nextSteps: ["Verify"],
      },
    ],
  )[0];
  assert.equal(recovered.state, "completed");
  assert.equal(recovered.updatedAt, "2026-11-13T10:00:00.001Z");
  assert.deepEqual(recovered.findings, ["Recovered"]);
  assert.equal(recovered.brief, failed.brief);

  const changedBrief = {
    ...saved,
    updatedAt: "2026-11-13T10:00:02.000Z",
    brief: { ...saved.brief, question: "Changed question" },
    findings: ["Must not apply"],
  };
  assert.deepEqual(mergeOutreach([saved], [changedBrief]), [saved]);
  assert.equal(mergeOutreach([saved], [changedBrief])[0].brief, saved.brief);
});

test("unchanged polled results skip brief serialization and return the saved record", () => {
  const saved = {
    ...createOutreachRecord(provider, ["Costs"], "Ask about visits"),
    state: "opened" as const,
    updatedAt: "2026-11-13T10:00:00.000Z",
    findings: ["Opened detail"],
    nextSteps: ["Connect"],
  };
  const duplicate = {
    ...saved,
    brief: { ...saved.brief },
    findings: [...saved.findings],
    nextSteps: [...saved.nextSteps],
  };
  const original = JSON.stringify;
  let calls = 0;
  JSON.stringify = ((value: unknown, replacer?: unknown, space?: unknown) => {
    calls += 1;
    return original(
      value,
      replacer as Parameters<typeof original>[1],
      space as Parameters<typeof original>[2],
    );
  }) as typeof JSON.stringify;
  try {
    assert.equal(mergeOutreach([saved], [duplicate])[0], saved);
    assert.equal(calls, 0);
  } finally {
    JSON.stringify = original;
  }
});

test("completed records never change state, timestamps, brief or payload", () => {
  const base = createOutreachRecord(provider, [], "Original question");
  const completed = {
    ...base,
    state: "completed" as const,
    updatedAt: "2026-11-13T10:00:00.000Z",
    findings: ["Z", "A"],
    nextSteps: ["Call", "Ask"],
  };
  for (const state of [
    "requested",
    "opened",
    "connected",
    "failed",
    "completed",
  ] as const) {
    for (const updatedAt of [
      "2026-11-13T09:59:59.999Z",
      completed.updatedAt,
      "2026-11-13T10:00:00.001Z",
    ])
      assert.deepEqual(
        mergeOutreach(
          [completed],
          [
            {
              ...completed,
              state,
              updatedAt,
              findings: ["Changed"],
              nextSteps: [],
            },
          ],
        ),
        [completed],
      );
  }
  for (const brief of [
    { ...base.brief, question: "Changed" },
    { ...base.brief, readKey: "0".repeat(64) },
  ])
    assert.deepEqual(
      mergeOutreach([base], [{ ...base, state: "opened", brief }]),
      [base],
    );
});

test("blank-phone briefs launch, round-trip through the fragment and reload", () => {
  const record = createOutreachRecord(
    { ...provider, phone: "" },
    ["Pricing"],
    "",
  );
  const brief = JSON.parse(
    Buffer.from(
      new URLSearchParams(new URL(outreachUrl(record.brief)).hash.slice(1)).get(
        "outreach",
      )!,
      "base64url",
    ).toString("utf8"),
  );
  assert.equal(brief.phone, "");
  assert.deepEqual(parseOutreachRecord({ ...record, brief }), record);
  assert.ok(
    validateWorkspace({ ...createEmptyWorkspace(), outreach: [record] }).ok,
  );
});

test("previous context uses only bounded rehearsal findings and unresolved requests", () => {
  const parent = createOutreachRecord(
    provider,
    [],
    "Original private question",
  );
  parent.state = "completed";
  parent.findings = ["A rehearsal observation"];
  parent.nextSteps = ["Confirm with staff"];
  parent.brief.previous = "Do not recursively forward this context";
  const child = createOutreachRecord(provider, [], "Follow up", parent);
  assert.equal(child.parentId, parent.brief.requestId);
  assert.match(
    child.brief.previous!,
    /Prior rehearsal finding: A rehearsal observation/,
  );
  assert.match(child.brief.previous!, /Unanswered request: Confirm with staff/);
  assert.ok(!child.brief.previous!.includes(parent.brief.question));
  assert.ok(!child.brief.previous!.includes(parent.brief.previous));
  assert.ok(!child.brief.previous!.includes(parent.brief.readKey));
  parent.findings = Array(10).fill("f".repeat(1000));
  assert.equal(
    createOutreachRecord(provider, [], "", parent).brief.previous!.length,
    1200,
  );
});

test("the existing plan export never serializes outreach credentials or the raw brief", () => {
  const record = createOutreachRecord(
    provider,
    ["Topic sentinel"],
    "Question sentinel",
  );
  const workspace = { ...createEmptyWorkspace(), outreach: [record] };
  const exported = carePlanText(workspace, [], "07030");
  for (const secret of [
    record.brief.readKey,
    record.brief.requestId,
    "readKey",
    "Question sentinel",
    outreachUrl(record.brief),
  ])
    assert.ok(!exported.includes(secret));
});

test("canonical demo sync is isolated, no-op refresh is read-only, and manual refresh bypasses backoff", async () => {
  const require = createRequire(resolve("package.json"));
  const { build } = createRequire(require.resolve("tsx/package.json"))(
    "esbuild",
  );
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import {createRoot} from "react-dom/client";
        import {useState,useRef,useCallback} from "react";
        import {useOutreach} from "./src/hooks/use-outreach";
        import {createEmptyWorkspace,validateWorkspace} from "./src/lib/workspace";
        const key="harbor.demo.workspace.v1";
        const h=window.__integration={writes:0};
        window.open=()=>null;
        function App(){
          const [workspace,setWorkspace]=useState(()=>JSON.parse(localStorage.getItem(key))||createEmptyWorkspace());
          const [demo,setDemo]=useState(true);
          const current=useRef(workspace);
          h.mode=(mode,value)=>{current.current=value;setWorkspace(value);setDemo(mode)};
          const update=useCallback(updater=>{
            const checked=validateWorkspace({...updater(current.current),updatedAt:new Date().toISOString()});
            if(!checked.ok)return false;
            h.writes++;
            if(demo)localStorage.setItem(key,JSON.stringify(checked.workspace));
            current.current=checked.workspace;setWorkspace(checked.workspace);return true;
          },[demo]);
          h.workspace=workspace;
          h.api=useOutreach(workspace,update,true,demo);
          return null;
        }
        createRoot(document.getElementById("root")).render(<App/>);
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const context = await browser.newContext();
    await context.route("https://harbor.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      }),
    );
    let calls = 0;
    let result: unknown = null;
    await context.route("**/api/outreach-result", (route) => {
      calls++;
      return route.fulfill(result ? { json: result } : { status: 404 });
    });
    const mount = async () => {
      const page = await context.newPage();
      await page.goto("https://harbor.test/");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.waitForFunction(() => Boolean(window.__integration?.api));
      return page;
    };
    const first = await mount();
    await first.evaluate(() => window.__integration.api.refresh());
    assert.equal(calls, 0);
    assert.equal(await first.evaluate(() => window.__integration.writes), 0);
    assert.equal(
      await first.evaluate(
        (p) =>
          window.__integration.api.launch({ ...p, phone: "" }, ["Tour"], ""),
        provider,
      ),
      true,
    );
    const second = await mount();
    await second.evaluate(
      (p) => window.__integration.api.launch(p, ["Pricing"], ""),
      provider,
    );
    await first.waitForFunction(
      () => window.__integration.api.records.length === 2,
    );
    await first.evaluate(() => {
      const key = "harbor.demo.workspace.v1";
      const value = JSON.parse(localStorage.getItem(key)!);
      value.notes["care-1"] = "Preserve the latest canonical note";
      localStorage.setItem(key, JSON.stringify(value));
    });
    await second.waitForFunction(
      () =>
        window.__integration.workspace.notes["care-1"] ===
        "Preserve the latest canonical note",
    );
    await second.evaluate(
      (p) => window.__integration.api.launch(p, ["Staff"], ""),
      provider,
    );
    await first.waitForFunction(
      () => window.__integration.api.records.length === 3,
    );
    assert.equal(
      await first.evaluate(
        () => window.__integration.workspace.notes["care-1"],
      ),
      "Preserve the latest canonical note",
    );
    assert.deepEqual(await first.evaluate(() => Object.keys(localStorage)), [
      "harbor.demo.workspace.v1",
    ]);

    await first.evaluate(() => window.__integration.api.refresh());
    const polled = calls;
    const writes = await first.evaluate(() => window.__integration.writes);
    await first.evaluate(() => window.__integration.api.refresh(false));
    assert.equal(calls, polled);
    assert.equal(
      await first.evaluate(() => window.__integration.writes),
      writes,
    );
    result = {
      state: "opened",
      updatedAt: "2026-11-13T00:00:00.000Z",
      findings: [],
      nextSteps: [],
    };
    await first.evaluate(() => window.dispatchEvent(new Event("focus")));
    await first.waitForFunction(() =>
      window.__integration.api.records.every(
        (record) => record.state === "opened",
      ),
    );
    await second.waitForFunction(() =>
      window.__integration.api.records.every(
        (record) => record.state === "opened",
      ),
    );
    const openedWrites = await first.evaluate(
      () => window.__integration.writes,
    );
    await first.evaluate(() => window.__integration.api.refresh());
    assert.equal(
      await first.evaluate(() => window.__integration.writes),
      openedWrites,
    );
    result = {
      state: "completed",
      updatedAt: "2026-11-13T00:00:01.000Z",
      findings: ["Rehearsal finished"],
      nextSteps: ["Verify with the real provider"],
    };
    await first.evaluate(() => window.__integration.api.refresh());
    assert.equal(calls, polled + 9);
    await second.waitForFunction(() =>
      window.__integration.api.records.every(
        (record) => record.state === "completed",
      ),
    );
    const completedWrites = await first.evaluate(
      () => window.__integration.writes,
    );
    await first.evaluate(() => window.__integration.api.refresh());
    await first.evaluate(() => window.__integration.api.refresh(false));
    assert.equal(calls, polled + 9);
    assert.equal(
      await first.evaluate(() => window.__integration.writes),
      completedWrites,
    );

    const account = createEmptyWorkspace();
    await first.evaluate((w) => window.__integration.mode(false, w), account);
    await first.waitForFunction(
      () => window.__integration.api.records.length === 0,
    );
    const accountWrites = await first.evaluate(
      () => window.__integration.writes,
    );
    await second.evaluate(() => {
      const value = localStorage.getItem("harbor.demo.workspace.v1")!;
      localStorage.setItem("unrelated.workspace", value);
      localStorage.setItem("harbor.outreach.v1.fake", value);
      localStorage.setItem("harbor.demo.workspace.v1", value);
    });
    await first.evaluate(() => window.__integration.api.refresh());
    assert.equal(
      await first.evaluate(() => window.__integration.writes),
      accountWrites,
    );
    assert.equal(
      await first.evaluate(() => window.__integration.api.records.length),
      0,
    );
    await first.evaluate(
      (p) => window.__integration.api.launch(p, ["Account-only"], ""),
      provider,
    );
    assert.equal(
      await second.evaluate(() => window.__integration.api.records.length),
      3,
    );
    await first.evaluate(
      (w) => window.__integration.mode(false, w),
      createEmptyWorkspace(),
    );
    await first.waitForFunction(
      () => window.__integration.api.records.length === 0,
    );
    await first.evaluate(() => window.__integration.api.refresh());
    assert.equal(
      await first.evaluate(() => window.__integration.api.records.length),
      0,
    );
  } finally {
    await browser.close();
  }
});
