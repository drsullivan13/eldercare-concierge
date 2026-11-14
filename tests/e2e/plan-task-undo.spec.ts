import { expect, test, type Page } from "@playwright/test";
import type { Workspace } from "../../src/lib/workspace";

const KEY = "harbor.demo.workspace.v1";
const REMOVED = "Removed from your plan";
const workspace: Workspace = {
  profile: {
    name: "Care circle",
    relationship: "A parent",
    zip: "07928",
    careTypes: [],
  },
  savedProviderIds: ["task-undo-provider"],
  notes: { "task-undo-provider": "Keep these visiting questions." },
  tasks: [
    {
      id: "first",
      title: "Discuss care preferences",
      category: "Care",
      dueDate: "",
      status: "todo",
    },
    {
      id: "linked",
      title: "Arrange weekend visits",
      category: "Visits",
      dueDate: "2026-12-03",
      status: "done",
      providerId: "task-undo-provider",
    },
    {
      id: "last",
      title: "Check coverage",
      category: "Finances",
      dueDate: "2026-12-04",
      status: "todo",
    },
  ],
  updatedAt: "2026-11-01T12:00:00.000Z",
};

async function navigate(page: Page, name: "Overview" | "Your plan") {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name, exact: true })
    .click();
}

async function openPlan(page: Page, initial = workspace) {
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
    },
    { key: KEY, initial },
  );
  await page.goto("/dashboard?demo=1");
  await expect(page.locator(".app-shell")).toBeVisible();
  await navigate(page, "Your plan");
}

async function persisted(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
}

function removal(page: Page, title: string) {
  return page
    .getByRole("region", { name: /^(Workspace )?Notifications$/i })
    .locator('[data-slot="toast"]:not([data-ending-style])')
    .filter({ has: page.getByText(REMOVED, { exact: true }) })
    .filter({ hasText: title });
}

async function deleteTask(page: Page, title: string) {
  await page
    .getByRole("button", { name: `Delete ${title}`, exact: true })
    .click();
}

async function rejectWrites(page: Page) {
  const original = await page.evaluateHandle(() => Storage.prototype.setItem);
  await page.evaluate((workspaceKey) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === workspaceKey)
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  }, KEY);
  return async () => {
    await page.evaluate((setItem) => {
      Storage.prototype.setItem = setItem;
    }, original);
    await original.dispose();
  };
}

test("task Undo restores all fields and position without losing subsequent edits", async ({
  page,
}) => {
  await openPlan(page);
  const task = workspace.tasks[1];
  await deleteTask(page, task.title);
  const notice = removal(page, task.title);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/Undo.*available/i);
  await expect(page.locator(".plan-task")).toHaveCount(2);
  await page
    .getByRole("button", { name: `Complete ${workspace.tasks[2].title}` })
    .click();
  await page
    .getByRole("button", { name: "Add a next step", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add a next step",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Task", exact: true })
    .fill("Arrange transport");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Travel");
  await dialog.getByLabel(/Due date/).fill("2026-12-05");
  await dialog.getByRole("button", { name: "Add to my plan" }).click();
  await expect(dialog).toHaveCount(0);
  await navigate(page, "Overview");
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".profile-button").click();
  const profile = page.getByRole("dialog", { name: "Your care workspace" });
  await profile
    .getByRole("textbox", { name: "Your first name" })
    .fill("Updated circle");
  await profile.getByRole("button", { name: "Save & continue" }).click();
  await expect(profile).toHaveCount(0);

  const beforeUndo = await persisted(page);
  expect(beforeUndo.tasks.map(({ title }) => title)).toEqual([
    workspace.tasks[0].title,
    workspace.tasks[2].title,
    "Arrange transport",
  ]);
  expect(beforeUndo.tasks[1].status).toBe("done");
  expect(beforeUndo.profile.name).toBe("Updated circle");
  await notice.getByRole("button", { name: /^Undo/ }).click();
  await expect(notice).toHaveCount(0);
  const expectedTasks = [
    beforeUndo.tasks[0],
    task,
    ...beforeUndo.tasks.slice(1),
  ];
  expect(await persisted(page)).toEqual({
    ...beforeUndo,
    tasks: expectedTasks,
    updatedAt: expect.any(String),
  });
  await navigate(page, "Your plan");
  await expect(page.locator(".plan-task")).toHaveCount(4);
  const restored = page.locator(".plan-task").nth(1);
  await expect(restored).toContainText(task.title);
  await expect(restored).toContainText("Visits");
  await expect(restored).toContainText("Dec 3");
  await expect(
    restored.getByRole("button", { name: `Reopen ${task.title}` }),
  ).toBeVisible();
  await page.reload();
  await navigate(page, "Your plan");
  expect((await persisted(page)).tasks).toEqual(expectedTasks);
  await expect(page.locator(".plan-task").nth(1)).toContainText(task.title);
});

test("repeated task Undo cannot duplicate or resurrect a later deletion", async ({
  page,
}) => {
  await openPlan(page);
  const task = workspace.tasks[1];
  await deleteTask(page, task.title);
  const undo = await removal(page, task.title)
    .getByRole("button", { name: /^Undo/ })
    .elementHandle();
  expect(undo).not.toBeNull();
  await undo!.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected Undo button");
    button.click();
    button.click();
  });
  await expect(removal(page, task.title)).toHaveCount(0);
  expect((await persisted(page)).tasks).toEqual(workspace.tasks);
  await deleteTask(page, task.title);
  await expect(removal(page, task.title)).toBeVisible();
  await undo!.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected Undo button");
    button.click();
  });
  expect((await persisted(page)).tasks.map(({ id }) => id)).toEqual([
    "first",
    "last",
  ]);
  await removal(page, task.title)
    .getByRole("button", { name: /^Undo/ })
    .click();
  expect((await persisted(page)).tasks).toEqual(workspace.tasks);
  await undo!.dispose();
});

test("task Undo keeps separate deletions independent as the plan shrinks to empty", async ({
  page,
}) => {
  await openPlan(page);
  for (const task of [...workspace.tasks].reverse())
    await deleteTask(page, task.title);
  await expect(
    page.getByText("Add a next step to begin your plan."),
  ).toBeVisible();
  expect((await persisted(page)).tasks).toEqual([]);
  for (const index of [2, 0, 1]) {
    const task = workspace.tasks[index];
    await removal(page, task.title)
      .getByRole("button", { name: /^Undo/ })
      .click();
    await expect(
      page.getByRole("button", { name: `Delete ${task.title}`, exact: true }),
    ).toBeVisible();
  }
  expect((await persisted(page)).tasks).toEqual(workspace.tasks);
  await expect(page.locator(".plan-task")).toHaveCount(3);
});

test("failed task deletion announces no success and failed Undo can be retried", async ({
  page,
}) => {
  await openPlan(page);
  const task = workspace.tasks[1];
  const beforeDelete = await persisted(page);
  const allowDelete = await rejectWrites(page);
  await deleteTask(page, task.title);
  await expect(page.locator(".page-error")).toContainText(
    "could not save this change",
  );
  expect(await persisted(page)).toEqual(beforeDelete);
  await expect(removal(page, task.title)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Delete ${task.title}`, exact: true }),
  ).toBeVisible();
  await allowDelete();
  await deleteTask(page, task.title);
  const notice = removal(page, task.title);
  await expect(notice).toBeVisible();
  const beforeUndo = await persisted(page);
  const allowUndo = await rejectWrites(page);
  await notice.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.locator(".page-error")).toContainText(
    "could not save this change",
  );
  expect(await persisted(page)).toEqual(beforeUndo);
  await expect(
    page.getByRole("button", { name: `Delete ${task.title}`, exact: true }),
  ).toHaveCount(0);
  await expect(notice).toContainText(/could not restore.*try Undo again/i);
  await expect(notice).not.toContainText("this place");
  await expect(
    page
      .locator('[aria-live="assertive"]')
      .filter({ hasText: /could not restore/i }),
  ).toContainText(task.title);
  await expect(notice.getByRole("button", { name: /^Undo/ })).toBeEnabled();
  await allowUndo();
  await notice.getByRole("button", { name: /^Undo/ }).click();
  await expect(notice).toHaveCount(0);
  expect((await persisted(page)).tasks).toEqual(workspace.tasks);
});
