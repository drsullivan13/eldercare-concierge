import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Provider, SearchResponse } from "../../src/lib/providers";
import type { Workspace } from "../../src/lib/workspace";

const WORKSPACE_KEY = "harbor.demo.workspace.v1";
const REMOVED = "Removed from your shortlist";
const ADDED = "Added to your shortlist";
const PLAN_ADDED = "Added to your plan";
const EXPORTED = "Your care plan has been exported.";

async function openWorkspace(page: Page, savedCount = 1) {
  const response = await page.request.get(
    "/api/search?zip=07928&radius=25&category=all&sort=distance",
  );
  expect(response.ok()).toBe(true);
  const { providers } = (await response.json()) as SearchResponse;
  expect(providers.length).toBeGreaterThanOrEqual(3);
  const workspace: Workspace = {
    profile: {
      name: "Care circle",
      relationship: "A parent",
      zip: "07928",
      careTypes: [],
    },
    savedProviderIds: providers.slice(0, savedCount).map(({ id }) => id),
    notes: {
      [providers[0].id]: "Ask about visiting hours.",
      [providers[2].id]: "Keep this unrelated research question.",
    },
    tasks: [
      {
        id: "notification-existing-task",
        title: "Discuss weekend visits",
        category: "Family",
        dueDate: "2026-12-01",
        status: "todo",
        providerId: providers[0].id,
      },
    ],
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  await page.addInitScript(
    ({ key, workspace }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(workspace));
    },
    { key: WORKSPACE_KEY, workspace },
  );
  await page.goto("/dashboard?demo=1");
  await expect(page.locator(".app-shell")).toBeVisible();
  return { providers, workspace };
}

async function navigate(page: Page, name: "Find care" | "Your plan") {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.locator(".sidebar-overlay")).toHaveCount(0);
}

function card(page: Page, provider: Pick<Provider, "name">) {
  return page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: provider.name, exact: true }),
  });
}

function notifications(page: Page) {
  return page.getByRole("region", { name: /^(Workspace )?Notifications$/i });
}

function notice(page: Page, title: string) {
  return notifications(page)
    .locator('[data-slot="toast"]:not([data-ending-style])')
    .filter({ has: page.getByText(title, { exact: true }) });
}

async function persisted(page: Page): Promise<Workspace> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    WORKSPACE_KEY,
  );
}

async function freezeClock(page: Page) {
  await page.clock.install({ time: new Date("2026-11-12T12:00:00.000Z") });
  await page.clock.pauseAt(new Date("2026-11-12T12:00:01.000Z"));
}

async function rejectWorkspaceWrites(page: Page) {
  const original = await page.evaluateHandle(() => Storage.prototype.setItem);
  await page.evaluate((workspaceKey) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === workspaceKey)
        throw new DOMException("Storage is unavailable", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  }, WORKSPACE_KEY);
  return async () => {
    await page.evaluate((setItem) => {
      Storage.prototype.setItem = setItem;
    }, original);
    await original.dispose();
  };
}

async function expectTouchTarget(control: Locator) {
  const bounds = await control.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

test("shortlist Undo changes only membership and preserves intervening workspace edits", async ({
  page,
}) => {
  const { providers, workspace } = await openWorkspace(page, 2);
  const [provider, other, newlySaved] = providers;
  await navigate(page, "Find care");
  // Use the real clock while moving between dialogs so focus, scrolling and
  // informational notices follow the same lifecycle as a normal session.
  await card(page, provider)
    .getByRole("button", { name: `Remove ${provider.name}`, exact: true })
    .click();
  const removal = notice(page, REMOVED).filter({ hasText: provider.name });
  await expect(removal).toBeVisible();
  await expect(
    removal.locator('[data-slot="toast-description"]'),
  ).toContainText(provider.name);
  await expect(
    removal.locator('[data-slot="toast-description"]'),
  ).toContainText(/Undo.*available|available.*Undo/i);

  await card(page, provider)
    .getByRole("button", { name: provider.name, exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: provider.name, exact: true });
  await detail.getByText("Your questions & notes", { exact: true }).click();
  const note = "Ask about weekend visits and transport.";
  await detail
    .getByRole("textbox", { name: `Notes about ${provider.name}`, exact: true })
    .fill(note);
  await detail
    .getByRole("button", { name: "Update note", exact: true })
    .click();
  await expect(
    detail.getByRole("button", { name: "Note added to workspace" }),
  ).toBeVisible();
  await detail
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await card(page, newlySaved)
    .getByRole("button", { name: `Save ${newlySaved.name}`, exact: true })
    .click();

  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".profile-button").click();
  const profile = page.getByRole("dialog", { name: "Your care workspace" });
  await profile
    .getByRole("textbox", { name: "Your first name" })
    .fill("Updated circle");
  await profile
    .getByRole("combobox", { name: "Who are you researching care for?" })
    .selectOption("Someone I support");
  await profile.getByRole("button", { name: "Save & continue" }).click();
  await expect(profile).toHaveCount(0);
  if (await page.locator(".sidebar-overlay").isVisible())
    await page.getByRole("button", { name: "Close menu" }).first().click();

  await navigate(page, "Your plan");
  await page
    .getByRole("button", {
      name: "Complete Discuss weekend visits",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Add a next step", exact: true })
    .first()
    .click();
  const taskDialog = page.getByRole("dialog", {
    name: "Add a next step",
    exact: true,
  });
  await taskDialog
    .getByRole("textbox", { name: "Task", exact: true })
    .fill("Arrange a visit");
  await taskDialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Visits");
  await taskDialog.getByLabel(/Due date/).fill("2026-12-03");
  await taskDialog.getByRole("button", { name: "Add to my plan" }).click();
  await page
    .getByRole("button", { name: "Add a next step", exact: true })
    .first()
    .focus();
  await page.mouse.move(1, 1);
  await expect(removal).toBeVisible({ timeout: 12_000 });
  await expect(removal).toBeVisible();

  const beforeUndo = await persisted(page);
  expect(beforeUndo.profile).toEqual({
    ...workspace.profile,
    name: "Updated circle",
    relationship: "Someone I support",
  });
  expect(beforeUndo.notes).toEqual({ ...workspace.notes, [provider.id]: note });
  expect(beforeUndo.savedProviderIds).toEqual([other.id, newlySaved.id]);
  expect(beforeUndo.tasks).toEqual([
    { ...workspace.tasks[0], status: "done" },
    {
      id: expect.any(String),
      title: "Arrange a visit",
      category: "Visits",
      dueDate: "2026-12-03",
      status: "todo",
    },
  ]);
  await removal.getByRole("button", { name: /^Undo/ }).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected Undo button");
    button.click();
    button.click();
  });
  await expect
    .poll(async () => (await persisted(page)).savedProviderIds)
    .toEqual([provider.id, other.id, newlySaved.id]);
  const afterUndo = await persisted(page);
  expect(afterUndo.savedProviderIds).toHaveLength(3);
  expect(afterUndo).toEqual({
    ...beforeUndo,
    savedProviderIds: [provider.id, other.id, newlySaved.id],
    updatedAt: expect.any(String),
  });
  await expect(removal).toHaveCount(0);
});

test("newer same-provider intent defeats stale Undo and rapid toggles use current membership", async ({
  page,
}) => {
  const { providers } = await openWorkspace(page);
  const provider = providers[0];
  await navigate(page, "Find care");
  await card(page, provider)
    .getByRole("button", { name: `Remove ${provider.name}`, exact: true })
    .click();
  const oldRemoval = await notice(page, REMOVED).elementHandle();
  expect(oldRemoval).not.toBeNull();
  const oldTitleId = await oldRemoval!.evaluate((toast) =>
    toast.querySelector('[data-slot="toast-title"]')?.getAttribute("id"),
  );
  expect(oldTitleId).toBeTruthy();
  await card(page, provider)
    .getByRole("button", { name: `Save ${provider.name}`, exact: true })
    .evaluate((button) => {
      if (!(button instanceof HTMLButtonElement))
        throw new Error("Expected shortlist button");
      button.click();
      button.click();
    });
  await expect
    .poll(async () => (await persisted(page)).savedProviderIds)
    .toEqual([]);
  const newest = notice(page, REMOVED).filter({
    hasNot: page.locator(`[id=${JSON.stringify(oldTitleId)}]`),
  });
  await expect(newest).toHaveCount(1);
  await expect(newest).toBeVisible();
  if (
    await oldRemoval!.evaluate(
      (toast) => toast.isConnected && !toast.hasAttribute("data-ending-style"),
    )
  ) {
    await oldRemoval!.evaluate((toast) =>
      toast
        .querySelector<HTMLButtonElement>('[data-slot="toast-action"]')!
        .click(),
    );
    expect((await persisted(page)).savedProviderIds).toEqual([]);
  } else {
    await expect
      .poll(() =>
        oldRemoval!.evaluate(
          (toast) =>
            !toast.isConnected || toast.hasAttribute("data-ending-style"),
        ),
      )
      .toBe(true);
  }
  await newest.getByRole("button", { name: /^Undo/ }).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected Undo button");
    button.click();
    button.click();
  });
  await expect
    .poll(async () => (await persisted(page)).savedProviderIds)
    .toEqual([provider.id]);
  expect(
    (await persisted(page)).savedProviderIds.filter((id) => id === provider.id),
  ).toHaveLength(1);
  await oldRemoval!.dispose();
});

test("rejected removal never announces success and rejected Undo remains retryable", async ({
  page,
}) => {
  const { providers } = await openWorkspace(page);
  const provider = providers[0];
  await navigate(page, "Find care");
  const beforeRemoval = await persisted(page);
  const restoreRemovalWrites = await rejectWorkspaceWrites(page);
  await card(page, provider)
    .getByRole("button", { name: `Remove ${provider.name}`, exact: true })
    .click();
  await expect(page.locator(".page-error")).toContainText(
    "could not save this change",
  );
  expect(await persisted(page)).toEqual(beforeRemoval);
  await expect(notice(page, REMOVED)).toHaveCount(0);
  await expect(
    card(page, provider).getByRole("button", {
      name: `Remove ${provider.name}`,
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await restoreRemovalWrites();

  await card(page, provider)
    .getByRole("button", { name: `Remove ${provider.name}`, exact: true })
    .click();
  await expect(notice(page, REMOVED)).toBeVisible();
  const titleId = await notice(page, REMOVED)
    .locator('[data-slot="toast-title"]')
    .getAttribute("id");
  expect(titleId).not.toBeNull();
  const removal = notifications(page)
    .locator('[data-slot="toast"]:not([data-ending-style])')
    .filter({ has: page.locator(`[id=${JSON.stringify(titleId)}]`) });
  const beforeUndo = await persisted(page);
  const restoreUndoWrites = await rejectWorkspaceWrites(page);
  const undo = removal.getByRole("button", { name: /^Undo/ });
  await undo.click();
  await expect(page.locator(".page-error")).toContainText(
    "could not save this change",
  );
  expect(await persisted(page)).toEqual(beforeUndo);
  await expect(removal).toBeVisible();
  await expect(removal).toContainText(/could not restore.*try Undo again/i);
  await expect(
    page
      .locator('[aria-live="assertive"]')
      .filter({ hasText: /could not restore/i }),
  ).toContainText(provider.name);
  await expect(undo).toBeEnabled();
  await expect(notice(page, ADDED)).toHaveCount(0);
  await restoreUndoWrites();
  await undo.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected Undo button");
    button.click();
    button.click();
  });
  await expect
    .poll(async () => (await persisted(page)).savedProviderIds)
    .toEqual([provider.id]);
  expect(await persisted(page)).toEqual({
    ...beforeUndo,
    savedProviderIds: [provider.id],
    updatedAt: expect.any(String),
  });
  await expect(removal).toHaveCount(0);
});

test("updates queued during the first notification chunk load arrive once without losing older messages", async ({
  page,
}) => {
  await openWorkspace(page, 0);
  await navigate(page, "Your plan");
  await freezeClock(page);
  await page.getByText("Ideas for your next steps", { exact: true }).click();
  let release = () => {};
  const delivery = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldChunks = 0;
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith(".js")) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const source = await response.text();
    const notificationChunk =
      route.request().url().includes("dashboard-notifications") ||
      source.includes("dashboard-notification-undo");
    if (notificationChunk) {
      heldChunks++;
      await delivery;
    }
    await route.fulfill({ response });
  });
  const titles = [
    "Coordinate a visit or care assessment",
    "Agree on a family update routine",
    "Agree on a family update routine",
    "Check equipment and delivery arrangements",
    "Plan travel and who can be there",
  ];
  try {
    await page.getByRole("button", { name: titles[0], exact: true }).click();
    await expect.poll(() => heldChunks).toBeGreaterThan(0);
    for (const title of titles.slice(1))
      await page.getByRole("button", { name: title, exact: true }).click();
    const tasks = (await persisted(page)).tasks;
    expect(tasks).toHaveLength(6);
    expect(new Set(tasks.map(({ id }) => id)).size).toBe(6);
    expect(tasks.slice(1).map(({ title }) => title)).toEqual(titles);
    await expect(notifications(page)).toHaveCount(0);
  } finally {
    release();
  }

  const descriptions: string[] = [];
  const deliveredTitles = new Set<string>();
  for (let remaining = titles.length; remaining > 0; remaining--) {
    await expect(notice(page, PLAN_ADDED)).toHaveCount(Math.min(3, remaining));
    const current = notice(page, PLAN_ADDED).first();
    descriptions.push(
      (await current
        .locator('[data-slot="toast-description"]')
        .textContent())!.trim(),
    );
    const titleId = await current
      .locator('[data-slot="toast-title"]')
      .getAttribute("id");
    expect(titleId).not.toBeNull();
    expect(deliveredTitles.has(titleId!)).toBe(false);
    deliveredTitles.add(titleId!);
    await current.locator('[data-slot="toast-close"]').click();
  }
  expect(descriptions.sort()).toEqual([...titles].sort());
  await expect(notifications(page)).toHaveCount(0);
  await page.clock.runFor(6_000);
  await expect(notifications(page)).toHaveCount(0);
});

test("dismissing the final notice leaves the dashboard clickable and later notices actionable", async ({
  page,
}) => {
  await openWorkspace(page, 0);
  await navigate(page, "Your plan");
  await page.getByText("Ideas for your next steps", { exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "Agree on a family update routine",
    exact: true,
  });
  const region = page.locator('[data-slot="toast-region"]');

  for (let delivery = 0; delivery < 2; delivery++) {
    await trigger.click();
    const toast = notice(page, PLAN_ADDED);
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(notifications(page)).toHaveCount(0);
    await expect
      .poll(() =>
        region.evaluate((host) => {
          const bounds = host.getBoundingClientRect();
          const target = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          );
          return target !== null && !host.contains(target);
        }),
      )
      .toBe(true);
  }
});

for (const kind of ["plan", "export"] as const) {
  test(`identical ${kind} messages create separate notices with a fresh five-second lifetime`, async ({
    page,
  }) => {
    await openWorkspace(page, 0);
    await navigate(page, "Your plan");
    await freezeClock(page);
    if (kind === "plan")
      await page
        .getByText("Ideas for your next steps", { exact: true })
        .click();
    const trigger = page.getByRole("button", {
      name:
        kind === "plan"
          ? "Agree on a family update routine"
          : "Export your plan",
      exact: true,
    });
    const title = kind === "plan" ? PLAN_ADDED : EXPORTED;
    async function send() {
      if (kind === "export") {
        const download = page.waitForEvent("download");
        await trigger.click();
        expect((await download).suggestedFilename()).toBe(
          "harbor-care-plan.md",
        );
      } else {
        await trigger.click();
      }
      await trigger.focus();
      await page.mouse.move(1, 1);
    }
    await send();
    await expect(notice(page, title)).toHaveCount(1);
    const original = await notice(page, title).elementHandle();
    await page.clock.runFor(4_000);
    await expect(notice(page, title)).toHaveCount(1);
    await send();
    await expect(notice(page, title)).toHaveCount(2);
    await page.clock.runFor(1_100);
    await expect(notice(page, title)).toHaveCount(1);
    expect(
      await original!.evaluate(
        (toast) =>
          !toast.isConnected || toast.hasAttribute("data-ending-style"),
      ),
    ).toBe(true);
    await page.clock.runFor(3_800);
    await expect(notice(page, title)).toHaveCount(1);
    await page.clock.runFor(200);
    await expect(notice(page, title)).toHaveCount(0);
    if (kind === "plan") {
      const tasks = (await persisted(page)).tasks.filter(
        ({ title }) => title === "Agree on a family update routine",
      );
      expect(tasks).toHaveLength(2);
      expect(new Set(tasks.map(({ id }) => id)).size).toBe(2);
    }
    await original!.dispose();
  });
}

test("SDK hover and focus pause timers independently", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Hover is a desktop interaction.");
  await openWorkspace(page, 0);
  await navigate(page, "Your plan");
  await freezeClock(page);
  await page.getByText("Ideas for your next steps", { exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "Agree on a family update routine",
    exact: true,
  });
  await trigger.click();
  await trigger.focus();
  await page.mouse.move(1, 1);
  const toast = notice(page, PLAN_ADDED);
  await expect(toast).toBeVisible();
  await page.clock.runFor(2_000);
  await toast.hover();
  await page.clock.runFor(6_000);
  await expect(toast).toBeVisible();
  await toast.focus();
  await trigger.focus();
  await page.clock.runFor(6_000);
  await expect(toast).toBeVisible();
  await toast.focus();
  await page.mouse.move(1, 1);
  await page.clock.runFor(6_000);
  await expect(toast).toBeVisible();
  await trigger.focus();
  await page.clock.runFor(3_100);
  await expect(toast).toHaveCount(0);
});

test("notifications remain usable and announced before and after native provider dialogs", async ({
  page,
  isMobile,
}) => {
  const { providers } = await openWorkspace(page);
  const [provider, other] = providers;
  await navigate(page, "Find care");
  await card(page, provider)
    .getByRole("checkbox", { name: `Compare ${provider.name}`, exact: true })
    .check();
  await card(page, other)
    .getByRole("checkbox", { name: `Compare ${other.name}`, exact: true })
    .check();
  const opener = card(page, provider).getByRole("button", {
    name: provider.name,
    exact: true,
  });
  await opener.click();
  const detail = page.getByRole("dialog", { name: provider.name, exact: true });
  await expect(page.locator("dialog:modal")).toHaveCount(1);
  await detail
    .getByRole("button", { name: "Shortlisted", exact: true })
    .click();
  let removal = notice(page, REMOVED);
  await expect(removal).toBeVisible();
  await expect(removal).not.toHaveAttribute("role", "status");
  await expect(notifications(page)).not.toHaveAttribute(
    "aria-live",
    /polite|assertive/,
  );
  await expect(
    detail.locator('[aria-live="polite"]').filter({ hasText: REMOVED }),
  ).toContainText(provider.name);
  const returnTarget = detail.getByRole("button", {
    name: "Save to shortlist",
    exact: true,
  });
  await returnTarget.focus();
  await page.keyboard.press("F6");
  await expect
    .poll(() =>
      notifications(page).evaluate((region) =>
        region.contains(document.activeElement),
      ),
    )
    .toBe(true);
  await page.keyboard.press("F6");
  await expect(returnTarget).toBeFocused();
  const undo = removal.getByRole("button", { name: /^Undo/ });
  await undo.focus();
  await expect(undo).toBeFocused();
  if (isMobile) {
    await expectTouchTarget(undo);
    await expectTouchTarget(removal.locator('[data-slot="toast-close"]'));
    const bounds = await removal.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await detail.evaluate(
        (dialog) => dialog.scrollWidth <= dialog.clientWidth + 1,
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(removal).toHaveCount(0);
  await expect(detail).toBeVisible();
  expect((await persisted(page)).savedProviderIds).toEqual([]);
  await returnTarget.click();
  await expect(
    detail.getByRole("button", { name: "Shortlisted", exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(opener).toBeFocused();
  await notice(page, ADDED).locator('[data-slot="toast-close"]').click();

  await card(page, provider)
    .getByRole("button", { name: `Remove ${provider.name}`, exact: true })
    .click();
  removal = notice(page, REMOVED);
  await expect(
    page.locator('body [aria-live="polite"]').filter({ hasText: REMOVED }),
  ).toContainText(provider.name);
  const tray = page.locator('[aria-label="Comparison selections"]');
  await expect(tray).toBeVisible();
  const toastBounds = await removal.boundingBox();
  const trayBounds = await tray.boundingBox();
  expect(
    toastBounds!.y + toastBounds!.height <= trayBounds!.y ||
      toastBounds!.y >= trayBounds!.y + trayBounds!.height ||
      toastBounds!.x + toastBounds!.width <= trayBounds!.x ||
      toastBounds!.x >= trayBounds!.x + trayBounds!.width,
    "The notification must not cover comparison controls.",
  ).toBe(true);
  await opener.click();
  await expect(detail).toBeVisible();
  await removal.getByRole("button", { name: /^Undo/ }).focus();
  await expect(removal.getByRole("button", { name: /^Undo/ })).toBeFocused();
  await removal.getByRole("button", { name: /^Undo/ }).click();
  await expect(
    detail.getByRole("button", { name: "Shortlisted", exact: true }),
  ).toBeVisible();
  await expect(detail).toBeVisible();
  await detail
    .getByRole("button", { name: "Shortlisted", exact: true })
    .click();
  await expect(notice(page, REMOVED)).toBeVisible();
  await detail
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(opener).toBeFocused();
  await notice(page, REMOVED).getByRole("button", { name: /^Undo/ }).click();
  await expect
    .poll(async () => (await persisted(page)).savedProviderIds)
    .toEqual([provider.id]);
  await expect(
    card(page, provider).getByRole("button", {
      name: `Remove ${provider.name}`,
      exact: true,
    }),
  ).toBeVisible();
});
