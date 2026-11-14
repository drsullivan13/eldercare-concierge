import { expect, test, type Locator, type Page } from "@playwright/test";
import type { OutreachBrief, OutreachRecord } from "../../src/lib/outreach";
import type { SearchProvider, SearchResponse } from "../../src/lib/providers";
import type { Workspace } from "../../src/lib/workspace";

type OutreachResultResponse = Pick<
  OutreachRecord,
  "updatedAt" | "findings" | "nextSteps" | "commitments" | "activity"
> & { state: Exclude<OutreachRecord["state"], "requested"> };

const KEY = "harbor.demo.workspace.v1";
const provider: SearchProvider = {
  id: "test-outreach-chatham",
  name: "Test Chatham care residence",
  category: "assisted-living",
  address: "1 Test Lane",
  city: "Chatham",
  state: "NJ",
  zip: "07928",
  lat: 40.74,
  lng: -74.38,
  locationKind: "facility",
  phone: "9735550100",
  description: "A test facility, not a production provider.",
  services: [],
  officialRecord: false,
  sources: [],
  warnings: [],
  limitations: [],
  distanceMiles: 1,
};
const decoy: SearchProvider = {
  ...provider,
  id: "test-outreach-decoy",
  name: "Test Maple care residence",
  phone: "9735550199",
};
const identity = {
  providerId: provider.id,
  providerName: provider.name,
  phone: provider.phone!,
};
const pending: OutreachRecord = {
  brief: {
    ...identity,
    requestId: "aabbee11-2233-4455-8899-aabbccddeeff",
    readKey: "ab".repeat(32),
    topics: ["Pricing"],
    question: "Can we visit on a weekend?",
  },
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  state: "requested",
  findings: [],
  nextSteps: [],
};
const completed: OutreachResultResponse = {
  state: "completed",
  updatedAt: "2026-11-13T12:34:56.123Z",
  findings: ["Rehearsal note: weekend tours still need provider confirmation."],
  nextSteps: ["Confirm the weekend tour time with admissions."],
};

async function openWorkspace(
  page: Page,
  outreach: OutreachRecord[] = [],
  path = "/dashboard?demo=1",
) {
  await page.clock.setFixedTime(new Date("2026-11-13T13:00:00.000Z"));
  const workspace: Workspace = {
    profile: {
      name: "",
      relationship: "A parent",
      zip: "07928",
      careTypes: [],
    },
    savedProviderIds: [],
    notes: {},
    tasks: [],
    outreach,
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  await page.addInitScript(
    ({ key, workspace }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(workspace));
    },
    { key: KEY, workspace },
  );
  const providers: SearchProvider[] = [decoy, provider];
  const search: SearchResponse = {
    market: { id: "north-jersey", label: "North Jersey", state: "NJ" },
    providers,
    total: providers.length,
    origin: { zip: "07928", city: "Chatham", lat: 40.74, lng: -74.38 },
    radius: 25,
    catalogTotal: providers.length,
    asOf: "2026-11-13",
    categories: { "assisted-living": providers.length },
    excludedWithoutCoordinates: 0,
    experienceCoverage: {
      scored: 0,
      unscored: providers.length,
      facebookFindings: 0,
      facebookCovered: 0,
    },
  };
  await page.route("**/api/search?**", (route) =>
    route.fulfill({ json: search }),
  );
  await page
    .context()
    .route("https://harbor-voice-lab.vercel.app/**", (route) => {
      expect(route.request().resourceType()).toBe("document");
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Mock rehearsal</title><p>Browser rehearsal stub.</p>",
      });
    });
  await page.goto(path);
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function navigate(page: Page, name: "Find care" | "Your plan") {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name, exact: true })
    .click();
}

async function openProfile(page: Page) {
  await navigate(page, "Find care");
  await page
    .locator(".provider-card")
    .getByRole("button", {
      name: provider.name,
      exact: true,
    })
    .click();
  const profile = page.getByRole("dialog", {
    name: provider.name,
    exact: true,
  });
  await expect(profile).toBeVisible();
  await expect(
    profile.getByRole("button", { name: "Prepare outreach", exact: true }),
  ).toBeVisible();
  return profile;
}

async function launchRehearsal(
  page: Page,
  editor: Locator,
): Promise<OutreachBrief> {
  const opened = page.context().waitForEvent("page");
  await editor
    .getByRole("button", { name: "Open rehearsal", exact: true })
    .click();
  const popup = await opened;
  await expect(popup).toHaveURL(
    /^https:\/\/harbor-voice-lab\.vercel\.app\/#outreach=/,
  );
  const url = new URL(popup.url());
  const fragment = new URLSearchParams(url.hash.slice(1));
  const encoded = fragment.get("outreach")!;
  const brief: OutreachBrief = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );
  expect(url.search).toBe("");
  expect(fragment.has("workspace")).toBe(false);
  expect(url.href.split("#")[0]).toBe("https://harbor-voice-lab.vercel.app/");
  expect(brief).toMatchObject(identity);
  expect(brief.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(brief.readKey).toMatch(/^[0-9a-f]{64}$/i);
  await popup.close();
  await expect(editor).toHaveCount(0);
  return brief;
}

async function persisted(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
}

async function expectPrivateCredentials(page: Page, briefs: OutreachBrief[]) {
  const visible = await page.locator("body").innerText();
  for (const brief of briefs) {
    expect(visible).not.toContain(brief.readKey);
    expect(visible).not.toContain(brief.requestId);
  }
  expect(visible).not.toContain("#outreach=");
}

test("first profile request submits preset goals and Unicode without saving the facility", async ({
  page,
}) => {
  await page.route("**/api/outreach-result", (route) =>
    route.fulfill({
      status: 404,
      json: { error: "Outreach result is not available." },
    }),
  );
  await openWorkspace(page);
  const profile = await openProfile(page);
  await profile
    .getByRole("button", { name: "Prepare outreach", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Prepare outreach",
    exact: true,
  });
  await expect(editor).toContainText(provider.name);
  await expect(editor).toContainText("No provider will be called");
  await editor
    .getByRole("checkbox", { name: "Arrange tour", exact: true })
    .check();
  await editor
    .getByRole("checkbox", { name: "Availability", exact: true })
    .check();
  const question =
    "Is café seating available for a tour? 日本語でも質問できますか？ 🏡";
  await editor
    .getByRole("textbox", { name: "Your question or another goal" })
    .fill(question);
  const brief = await launchRehearsal(page, editor);
  expect(brief.topics).toEqual(["Arrange tour", "Availability"]);
  expect(brief.question).toBe(question);
  expect(brief.previous).toBeUndefined();
  const history = profile.getByRole("region", { name: "Outreach history" });
  await expect(history.getByRole("article")).toHaveCount(1);
  await expect(history).toContainText(question);
  await expect(history).toContainText("Ready to open");
  const saved = await persisted(page);
  expect(saved.savedProviderIds).toEqual([]);
  expect(saved.outreach).toEqual([
    expect.objectContaining({
      brief,
      state: "requested",
      findings: [],
      nextSteps: [],
    }),
  ]);
  expect(saved.outreach![0].parentId).toBeUndefined();
  await expectPrivateCredentials(page, [brief]);
  await page.reload();
  await navigate(page, "Your plan");
  const restored = page.getByRole("region", { name: "Outreach history" });
  await expect(restored.getByRole("article")).toHaveCount(1);
  await expect(restored).toContainText(provider.name);
  await expect(restored).toContainText(question);
  expect((await persisted(page)).outreach).toEqual(saved.outreach);
  await expectPrivateCredentials(page, [brief]);
});

test("pending 404 refreshes to completed notes and next steps, then persists a linked follow-up", async ({
  page,
}) => {
  let resultAvailable = false;
  await page.route("**/api/outreach-result", (route) => {
    const available =
      resultAvailable &&
      route.request().postDataJSON().requestId === pending.brief.requestId;
    return route.fulfill(
      available
        ? { json: completed }
        : { status: 404, json: { error: "Outreach result is not available." } },
    );
  });
  const unavailable = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/outreach-result" &&
      response.status() === 404,
  );
  await openWorkspace(page, [pending]);
  const response = await unavailable;
  expect(response.request().method()).toBe("POST");
  expect(response.request().postDataJSON()).toEqual({
    requestId: pending.brief.requestId,
    readKey: pending.brief.readKey,
  });
  const profile = await openProfile(page);
  const history = profile.getByRole("region", { name: "Outreach history" });
  const refresh = history.getByRole("button", {
    name: "Refresh outreach",
    exact: true,
  });
  await expect(refresh).toBeEnabled();
  await expect(history).toContainText("Ready to open");
  await expect(history).toContainText("No findings yet.");
  expect((await persisted(page)).outreach).toEqual([pending]);
  resultAvailable = true;
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/outreach-result" &&
      response.status() === 200,
    { timeout: 5_000 },
  );
  await refresh.click();
  const resultResponse = await refreshed;
  expect(resultResponse.request().postDataJSON()).toEqual({
    requestId: pending.brief.requestId,
    readKey: pending.brief.readKey,
  });
  await expect(history).toContainText("Rehearsal completed");
  for (const text of [...completed.findings, ...completed.nextSteps])
    await expect(history.getByText(text, { exact: true })).toBeVisible();
  await history
    .getByRole("button", {
      name: `Add to plan: ${completed.nextSteps[0]}`,
      exact: true,
    })
    .click();
  await expect(
    history.getByRole("button", {
      name: `Added to plan: ${completed.nextSteps[0]}`,
      exact: true,
    }),
  ).toBeDisabled();
  await expectPrivateCredentials(page, [pending.brief]);
  await profile
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await navigate(page, "Your plan");
  const planHistory = page.getByRole("region", { name: "Outreach history" });
  await expect(planHistory).toContainText(provider.name);
  await expect(planHistory).toContainText("Rehearsal completed");
  for (const text of [...completed.findings, ...completed.nextSteps])
    await expect(planHistory.getByText(text, { exact: true })).toBeVisible();
  await expect(page.locator(".plan-task")).toContainText(
    completed.nextSteps[0],
  );
  await planHistory
    .getByRole("button", { name: "Prepare follow-up", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Follow-up rehearsal",
    exact: true,
  });
  await expect(
    editor.getByRole("checkbox", { name: "Pricing", exact: true }),
  ).toBeChecked();
  const question = completed.nextSteps[0];
  await editor
    .getByRole("button", { name: "Use as question", exact: true })
    .click();
  await expect(
    editor.getByRole("textbox", { name: "Your question or another goal" }),
  ).toHaveValue(question);
  const followUp = await launchRehearsal(page, editor);
  expect(followUp.requestId).not.toBe(pending.brief.requestId);
  expect(followUp.readKey).not.toBe(pending.brief.readKey);
  expect(followUp.topics).toEqual(["Pricing"]);
  expect(followUp.question).toBe(question);
  expect(followUp.previous).toBe(
    `Prior rehearsal finding: ${completed.findings[0]}\nUnanswered request: ${completed.nextSteps[0]}`,
  );
  const saved = await persisted(page);
  expect(saved.savedProviderIds).toEqual([]);
  expect(saved.outreach).toEqual([
    { ...pending, ...completed },
    expect.objectContaining({
      brief: followUp,
      parentId: pending.brief.requestId,
      state: "requested",
      findings: [],
      nextSteps: [],
    }),
  ]);
  expect(saved.tasks).toEqual([
    expect.objectContaining({
      title: completed.nextSteps[0],
      providerId: provider.id,
      category: "Outreach",
      status: "todo",
    }),
  ]);
  await page.reload();
  await navigate(page, "Your plan");
  const restored = page.getByRole("region", { name: "Outreach history" });
  await expect(restored.getByRole("article")).toHaveCount(2);
  await expect(restored).toContainText(question);
  await expect(restored).toContainText("Follow-up rehearsal");
  const original = restored
    .getByRole("article")
    .filter({ hasText: pending.brief.question });
  for (const text of [...completed.findings, ...completed.nextSteps])
    await expect(original.getByText(text, { exact: true })).toBeVisible();
  expect((await persisted(page)).outreach).toEqual(saved.outreach);
  expect((await persisted(page)).tasks).toEqual(saved.tasks);
  await expectPrivateCredentials(page, [pending.brief, followUp]);
});

test("return from the voice lab opens plan history and focuses the results", async ({
  page,
}) => {
  await page.route("**/api/outreach-result", (route) =>
    route.fulfill({ json: completed }),
  );
  await openWorkspace(page, [pending], "/dashboard?demo=1#outreach-history");
  const history = page.locator("#outreach-history");
  await expect(history).toBeFocused();
  await expect(history).toContainText(provider.name);
  await expect(history).toContainText(completed.findings[0]);
});

const appointment = "Tour on November 18 at 10 am, confirm with admissions.";
const agreement =
  "Admissions agreed to send the fee schedule in the rehearsal.";
const proposal = "A Saturday visit was proposed, with no time confirmed.";
const cancellation = "The earlier Friday visit was cancelled in the rehearsal.";
const rehearsalNote =
  "Ask admissions whether a family member may join remotely.";
const richResult: OutreachResultResponse = {
  ...completed,
  commitments: [
    { kind: "scheduled", text: appointment },
    { kind: "agreed", text: agreement },
    { kind: "proposed", text: proposal },
    { kind: "cancelled", text: cancellation },
  ],
  findings: [appointment, agreement, proposal, cancellation, rehearsalNote].map(
    (quote) => `Receptionist said: "${quote}"`,
  ),
  nextSteps: [appointment],
  activity: [
    { state: "completed", at: completed.updatedAt },
    { state: "connected", at: "2026-11-13T12:32:00.000Z" },
    { state: "opened", at: "2026-11-13T12:30:00.000Z" },
  ],
};

test("refreshed commitments lead the history without repeating notes or losing plan actions", async ({
  page,
}, testInfo) => {
  let resultAvailable = false;
  await page.route("**/api/outreach-result", (route) =>
    route.fulfill(
      resultAvailable
        ? { json: richResult }
        : { status: 404, json: { error: "Not available yet." } },
    ),
  );
  await openWorkspace(page, [pending]);
  await page.getByRole("button", { name: /^Outreach history/ }).click();
  const history = page.getByRole("region", { name: "Outreach history" });
  const entry = history.getByRole("article");
  await expect(entry).toContainText("Ready to open");
  resultAvailable = true;
  await history
    .getByRole("button", { name: "Refresh outreach", exact: true })
    .click();
  await expect(entry).toContainText("Rehearsal completed");
  await expect(history).toContainText("No provider is dialed.");
  await expect(entry).toContainText(
    "Confirm any appointment with the provider.",
  );
  await expect(entry.getByRole("heading", { level: 4 })).toHaveText([
    "Appointments & agreements",
    "Questions & goals",
    "Rehearsal notes",
  ]);
  for (const text of [
    appointment,
    agreement,
    proposal,
    cancellation,
    rehearsalNote,
  ]) {
    await expect(entry.getByText(text, { exact: true })).toHaveCount(1);
    await expect(entry.getByText(text, { exact: true })).toBeVisible();
  }
  for (const kind of ["Scheduled", "Agreed", "Proposed", "Cancelled"])
    await expect(entry.getByText(kind, { exact: true })).toBeVisible();
  await expect(entry).toContainText(pending.brief.question);
  await expect(entry).toContainText("Pricing");
  await expect(
    entry.getByRole("button", { name: "Reopen rehearsal" }),
  ).toHaveCount(0);
  const add = entry.getByRole("button", {
    name: `Add to plan: ${appointment}`,
    exact: true,
  });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(
    entry.getByRole("button", {
      name: `Added to plan: ${appointment}`,
      exact: true,
    }),
  ).toBeDisabled();
  expect((await persisted(page)).tasks).toEqual([
    expect.objectContaining({
      title: appointment,
      providerId: provider.id,
      category: "Outreach",
    }),
  ]);
  const activity = entry.getByText("Rehearsal activity", { exact: true });
  await activity.focus();
  await page.keyboard.press("Enter");
  const timeline = entry.getByRole("list", {
    name: "Rehearsal activity, oldest first",
  });
  await expect(timeline.getByRole("listitem")).toHaveText([
    /Outreach prepared/,
    /Rehearsal opened/,
    /Browser agent connected/,
    /Rehearsal completed/,
  ]);
  expect(
    await timeline
      .locator("time")
      .evaluateAll((times) =>
        times.map((time) => time.getAttribute("datetime")),
      ),
  ).toEqual([
    pending.createdAt,
    "2026-11-13T12:30:00.000Z",
    "2026-11-13T12:32:00.000Z",
    completed.updatedAt,
  ]);
  await expectPrivateCredentials(page, [pending.brief]);
  await testInfo.attach("outreach history", {
    body: await entry.screenshot(),
    contentType: "image/png",
  });
  await page.reload();
  await navigate(page, "Your plan");
  await expect(
    page.getByRole("region", { name: "Outreach history" }),
  ).toContainText(cancellation);
  expect((await persisted(page)).outreach?.[0]).toMatchObject({
    ...richResult,
    activity: [...richResult.activity!].sort((left, right) =>
      left.at.localeCompare(right.at),
    ),
  });
});

test("provider history stays scoped and linked follow-ups are keyboard navigable in all-provider history", async ({
  page,
}) => {
  const original: OutreachRecord = { ...pending, ...richResult };
  const followUp: OutreachRecord = {
    ...pending,
    brief: {
      ...pending.brief,
      requestId: "bbccdd22-2233-4455-8899-aabbccddeeff",
      question: "Confirm the proposed tour.",
    },
    parentId: pending.brief.requestId,
    createdAt: "2026-11-13T12:40:00.000Z",
    updatedAt: "2026-11-13T12:40:00.000Z",
  };
  const unrelated: OutreachRecord = {
    ...original,
    brief: {
      ...original.brief,
      providerId: decoy.id,
      providerName: decoy.name,
      phone: decoy.phone!,
      requestId: "ccddee33-2233-4455-8899-aabbccddeeff",
    },
    updatedAt: "2026-11-13T12:45:00.000Z",
  };
  await page.route("**/api/outreach-result", (route) =>
    route.fulfill({ status: 404, json: { error: "Not available yet." } }),
  );
  await openWorkspace(page, [followUp, unrelated, original]);
  const profile = await openProfile(page);
  const scoped = profile.getByRole("region", { name: "Outreach history" });
  await expect(scoped.getByRole("article")).toHaveCount(2);
  await expect(scoped).not.toContainText(decoy.name);
  await scoped
    .getByRole("button", { name: "View all outreach in Your plan" })
    .click();
  await expect(profile).toHaveCount(0);
  const history = page.getByRole("region", { name: "Outreach history" });
  await expect(
    history.getByRole("article").getByRole("heading", { level: 3 }),
  ).toHaveText([decoy.name, provider.name, provider.name]);
  const previous = history.getByRole("link", {
    name: "Follow-up rehearsal · View previous rehearsal",
  });
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect(
    history
      .getByRole("article")
      .filter({ has: page.getByText(pending.brief.question, { exact: true }) })
      .filter({
        has: page.getByRole("heading", { name: "Appointments & agreements" }),
      })
      .last(),
  ).toBeFocused();
  const pendingEntry = history
    .getByRole("article")
    .filter({ hasText: followUp.brief.question });
  const reopen = pendingEntry.getByRole("button", { name: "Reopen rehearsal" });
  const opened = page.context().waitForEvent("page");
  await reopen.focus();
  await page.keyboard.press("Enter");
  const popup = await opened;
  await expect(popup).toHaveURL(
    /^https:\/\/harbor-voice-lab\.vercel\.app\/#outreach=/,
  );
  await popup.close();
  await expectPrivateCredentials(page, [
    original.brief,
    followUp.brief,
    unrelated.brief,
  ]);
});

test("legacy failed and orphaned follow-ups remain readable while offline", async ({
  page,
}) => {
  const failed: OutreachRecord = {
    ...pending,
    state: "failed",
    parentId: "ddeeff44-2233-4455-8899-aabbccddeeff",
    updatedAt: completed.updatedAt,
  };
  await page.route("**/api/outreach-result", (route) =>
    route.fulfill({ status: 404, json: { error: "Not available yet." } }),
  );
  await openWorkspace(page, [failed]);
  await navigate(page, "Your plan");
  const history = page.getByRole("region", { name: "Outreach history" });
  await expect(history).toContainText(
    "Previous rehearsal is not in this view.",
  );
  await expect(history).toContainText(
    "The browser rehearsal did not finish. No provider was dialed.",
  );
  await expect(
    history.getByRole("heading", { name: "Appointments & agreements" }),
  ).toHaveCount(0);
  await history.getByText("Rehearsal activity", { exact: true }).click();
  await expect(
    history
      .getByRole("list", { name: "Rehearsal activity, oldest first" })
      .getByRole("listitem"),
  ).toHaveText([/Outreach prepared/, /Rehearsal interrupted/]);
  await page.context().setOffline(true);
  await expect(history).toContainText("Saved history is still available.");
  await expect(
    history.getByRole("button", { name: "Refresh outreach" }),
  ).toBeDisabled();
  await expect(
    history.getByRole("button", { name: "Reopen rehearsal" }),
  ).toBeDisabled();
  await history.getByRole("button", { name: "Prepare follow-up" }).click();
  const editor = page.getByRole("dialog", { name: "Follow-up rehearsal" });
  const question = editor.getByRole("textbox", {
    name: "Your question or another goal",
  });
  await question.fill("Keep this draft while offline.");
  await expect(
    editor.getByRole("button", { name: "Open rehearsal" }),
  ).toBeDisabled();
  await page.context().setOffline(false);
  await expect(
    editor.getByRole("button", { name: "Open rehearsal" }),
  ).toBeEnabled();
  await expect(question).toHaveValue("Keep this draft while offline.");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(
    history.getByRole("button", { name: "Prepare follow-up" }),
  ).toBeFocused();
});

test("narrow history wraps long notes and keeps next-step editing and controls usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const longStep =
    "Confirm these accessibility arrangements with admissions before the proposed visit. ".repeat(
      4,
    );
  const record: OutreachRecord = {
    ...pending,
    ...richResult,
    findings: [rehearsalNote, "Unbroken-reference-".repeat(50)],
    nextSteps: [longStep],
  };
  await openWorkspace(page, [record]);
  await navigate(page, "Your plan");
  const history = page.getByRole("region", { name: "Outreach history" });
  await expect(history.getByText(longStep, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const summarize = history.getByRole("button", {
    name: `Summarize for plan: ${longStep}`,
    exact: true,
  });
  await summarize.focus();
  await page.keyboard.press("Enter");
  const title = history.getByRole("textbox", {
    name: "Summarize this next step for your plan",
  });
  await title.fill("Confirm accessibility arrangements");
  await title.press("Tab");
  await expect(
    history.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    history.getByRole("button", { name: "Add to plan", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    history.getByRole("button", {
      name: `Added to plan: ${longStep}`,
      exact: true,
    }),
  ).toBeDisabled();
  expect((await persisted(page)).tasks[0].title).toBe(
    "Confirm accessibility arrangements",
  );
  for (const control of await history.locator("button, summary, a").all()) {
    if (await control.isVisible()) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await testInfo.attach("320px outreach history", {
    body: await history.screenshot(),
    contentType: "image/png",
  });
});

test("empty history points to provider outreach and keyboard validation keeps the editor usable", async ({
  page,
}) => {
  await openWorkspace(page);
  await navigate(page, "Your plan");
  const history = page.getByRole("region", { name: "Outreach history" });
  await expect(history).toContainText("No outreach rehearsals yet.");
  await expect(
    history.getByRole("button", { name: "Refresh outreach" }),
  ).toBeDisabled();
  await history.getByRole("button", { name: "Find a provider" }).click();
  await page
    .locator(".provider-card")
    .getByRole("button", { name: provider.name, exact: true })
    .click();
  const profile = page.getByRole("dialog", {
    name: provider.name,
    exact: true,
  });
  await profile
    .getByRole("button", { name: "Prepare outreach", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", {
    name: "Prepare outreach",
    exact: true,
  });
  const open = editor.getByRole("button", { name: "Open rehearsal" });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("alert")).toHaveText(
    "Choose at least one goal or write a question.",
  );
  const question = editor.getByRole("textbox", {
    name: "Your question or another goal",
  });
  await expect(question).toHaveAttribute("aria-invalid", "true");
  await question.fill("Can we arrange a tour?");
  await expect(question).toHaveAttribute("aria-invalid", "false");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(
    profile.getByRole("button", { name: "Prepare outreach", exact: true }),
  ).toBeFocused();
});
