import { expect, test, type Locator, type Page } from "@playwright/test";
import type { OutreachBrief, OutreachRecord } from "../../src/lib/outreach";
import type { SearchProvider, SearchResponse } from "../../src/lib/providers";
import type { Workspace } from "../../src/lib/workspace";

type OutreachResultResponse = {
  state: "opened" | "connected" | "completed" | "failed";
  updatedAt: string;
  findings: string[];
  nextSteps: string[];
};

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
  path = "/dashboard",
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
  const encoded = new URLSearchParams(url.hash.slice(1)).get("outreach")!;
  const brief: OutreachBrief = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );
  expect(url.search).toBe("");
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
