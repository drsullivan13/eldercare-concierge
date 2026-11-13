import { expect, test, type Page } from "@playwright/test";
import type { Provider, SearchResponse } from "../../src/lib/providers";
import type { Workspace } from "../../src/lib/workspace";

async function openWorkspace(page: Page, savedCount = 1) {
  const response = await page.request.get(
    "/api/search?zip=07928&radius=25&category=all&sort=distance",
  );
  expect(response.ok()).toBe(true);
  const { providers } = (await response.json()) as SearchResponse;
  expect(providers.length).toBeGreaterThanOrEqual(savedCount);
  const workspace: Workspace = {
    profile: {
      name: "Care circle",
      relationship: "A parent",
      zip: "07928",
      careTypes: [],
    },
    savedProviderIds: providers.slice(0, savedCount).map(({ id }) => id),
    notes: {},
    tasks: [],
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  await page.addInitScript((workspace) => {
    localStorage.setItem("harbor.demo.workspace.v1", JSON.stringify(workspace));
  }, workspace);
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return providers.slice(0, savedCount);
}

async function openShortlist(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name: /^Your shortlist/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your shortlist", exact: true }),
  ).toBeFocused();
}

function card(page: Page, provider: Pick<Provider, "name">) {
  return page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: provider.name, exact: true }),
  });
}

for (const { savedCount, removedIndex, closeWithEscape } of [
  { savedCount: 1, removedIndex: 0, closeWithEscape: true },
  { savedCount: 2, removedIndex: 0, closeWithEscape: false },
  { savedCount: 2, removedIndex: 1, closeWithEscape: true },
  { savedCount: 3, removedIndex: 1, closeWithEscape: false },
  { savedCount: 3, removedIndex: 2, closeWithEscape: false },
]) {
  test(`closing a provider removed at position ${removedIndex + 1} of ${savedCount} restores shortlist focus`, async ({
    page,
  }) => {
    const providers = await openWorkspace(page, savedCount);
    await openShortlist(page);
    const removed = providers[removedIndex];
    const opener = card(page, removed).getByRole("button", {
      name: "View details",
      exact: true,
    });
    await opener.click();
    const dialog = page.getByRole("dialog", {
      name: removed.name,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
      true,
    );
    await dialog
      .getByRole("button", { name: "Shortlisted", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Save to shortlist", exact: true }),
    ).toBeVisible();
    await expect(opener).toHaveCount(0);
    if (closeWithEscape) await page.keyboard.press("Escape");
    else
      await dialog
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(dialog).toHaveCount(0);
    const remaining = providers.filter(({ id }) => id !== removed.id);
    await expect(page.locator("article.provider-card")).toHaveCount(
      remaining.length,
    );
    const target = remaining.length
      ? card(page, remaining[0]).getByRole("button", {
          name: `Remove ${remaining[0].name}`,
          exact: true,
        })
      : page.getByRole("heading", { name: "Your shortlist", exact: true });
    await expect(target).toBeVisible();
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();
    expect(
      await target.evaluate((element) => Boolean(element.closest("[inert]"))),
    ).toBe(false);
    if (!remaining.length)
      await expect(
        page.getByRole("heading", { name: "No saved places yet." }),
      ).toBeVisible();
  });
}

for (const savedCount of [1, 3]) {
  test(`keyboard removal of the last card of ${savedCount} restores visible shortlist focus`, async ({
    page,
  }) => {
    const providers = await openWorkspace(page, savedCount);
    await openShortlist(page);
    const removed = providers[savedCount - 1];
    const remove = card(page, removed).getByRole("button", {
      name: `Remove ${removed.name}`,
      exact: true,
    });
    await remove.focus();
    await expect(remove).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(card(page, removed)).toHaveCount(0);
    await expect(page.locator("article.provider-card")).toHaveCount(
      savedCount - 1,
    );
    const target = page.getByRole("heading", {
      name: "Your shortlist",
      exact: true,
    });
    await expect(target).toBeVisible();
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();
  });
}

test.describe("desktop navigation becoming mobile", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440",
      "Requires a desktop-to-mobile breakpoint transition",
    );
  });

  test("moves focused sidebar navigation to the visible menu", async ({
    page,
  }) => {
    await openWorkspace(page);
    const sidebar = page.locator("aside.sidebar");
    const navigation = sidebar.getByRole("button", {
      name: "Your plan",
      exact: true,
    });
    await navigation.focus();
    await expect(navigation).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole("button", { name: "Open navigation" });
    await expect(menu).toBeVisible();
    await expect(sidebar).toHaveAttribute("inert", "");
    await expect(sidebar).not.toBeInViewport();
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sidebar).not.toHaveAttribute("inert", "");
    await expect(
      sidebar.getByRole("button", { name: "Close menu" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(sidebar).toHaveAttribute("inert", "");
  });

  test("keeps focus in the page when the sidebar becomes inert", async ({
    page,
  }) => {
    await openWorkspace(page);
    const zip = page.getByRole("textbox", { name: "Search ZIP code" });
    await zip.focus();
    await expect(zip).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("aside.sidebar")).toHaveAttribute("inert", "");
    await expect(zip).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).not.toBeFocused();
  });

  test("keeps focus in an open native provider dialog", async ({ page }) => {
    const [provider] = await openWorkspace(page);
    await openShortlist(page);
    await card(page, provider)
      .getByRole("button", { name: "View details", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: provider.name,
      exact: true,
    });
    const save = dialog.getByRole("button", {
      name: "Shortlisted",
      exact: true,
    });
    await save.focus();
    await expect(save).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("aside.sidebar")).toHaveAttribute("inert", "");
    await expect(save).toBeFocused();
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
      true,
    );
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).not.toBeFocused();
  });
});
