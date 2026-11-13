import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SearchResponse } from "../../src/lib/providers";

const WORKSPACE_KEY = "harbor.demo.workspace.v1";

async function prepareComparison(page: Page) {
  await page.goto("/dashboard?demo=1");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("07928");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("10");
  const response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("zip") === "07928" &&
      url.searchParams.get("radius") === "10"
    );
  });
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  const result = await response;
  expect(result.ok()).toBe(true);
  const { providers } = (await result.json()) as SearchResponse;
  expect(providers.length).toBeGreaterThanOrEqual(2);
  const provider = providers[0];
  const card = page.locator(".provider-card").filter({
    has: page.getByRole("button", { name: provider.name, exact: true }),
  });
  for (const selected of providers.slice(0, 2)) {
    await page
      .getByRole("checkbox", { name: `Compare ${selected.name}`, exact: true })
      .check();
  }
  await expect(
    page.getByRole("button", { name: "Compare", exact: true }),
  ).toBeEnabled();
  await card
    .getByRole("button", { name: `Save ${provider.name}`, exact: true })
    .click();
  const region = page.locator('[data-slot="toast-region"]');
  await expect(region).toContainText("Added to your shortlist");
  const host = await region.elementHandle();
  expect(host).not.toBeNull();
  await region.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  return { provider, providers, card, region, host: host! };
}

async function expectFullHitboxes(region: Locator, notice = region) {
  const controls = notice.getByRole("button");
  await expect(controls).toHaveCount(2);
  for (const control of await controls.all()) {
    const geometry = await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const region = element.closest('[data-slot="toast-region"]')!;
      const clip = region.getBoundingClientRect();
      const viewport = window.visualViewport!;
      const points = [
        [box.left + box.width / 2, box.top + 1],
        [box.left + box.width / 2, box.bottom - 1],
        [box.left + 1, box.top + box.height / 2],
        [box.right - 1, box.top + box.height / 2],
        [box.left + box.width / 2, box.top + box.height / 2],
      ];
      return {
        label: element.textContent,
        width: box.width,
        height: box.height,
        regionHeight: clip.height,
        insideRegion:
          box.left >= clip.left &&
          box.right <= clip.right &&
          box.top >= clip.top &&
          box.bottom <= clip.bottom,
        insideViewport:
          box.left >= viewport.offsetLeft &&
          box.right <= viewport.offsetLeft + viewport.width &&
          box.top >= viewport.offsetTop &&
          box.bottom <= viewport.offsetTop + viewport.height,
        pointerHits: points.every(([x, y]) =>
          element.contains(document.elementFromPoint(x, y)),
        ),
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry, JSON.stringify(geometry)).toMatchObject({
      insideRegion: true,
      insideViewport: true,
      pointerHits: true,
    });
  }
}

test("shortlist Undo stays above the comparison tray outside a dialog", async ({
  page,
}) => {
  const { card, provider, region } = await prepareComparison(page);
  await card
    .getByRole("button", { name: `Remove ${provider.name}`, exact: true })
    .click();
  await expect(region).toContainText("Removed from your shortlist");
  const tray = page.locator('[aria-label="Comparison selections"]');
  const trayBox = await tray.boundingBox();
  const regionBox = await region.boundingBox();
  expect(trayBox).not.toBeNull();
  expect(regionBox).not.toBeNull();
  expect(regionBox!.y + regionBox!.height).toBeLessThanOrEqual(trayBox!.y);
  await expectFullHitboxes(region);
  await region.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    card.getByRole("button", { name: `Remove ${provider.name}`, exact: true }),
  ).toBeVisible();
});

for (const inDialog of [false, true]) {
  test(`a short screen queues actionable notices and keeps each Undo reachable ${inDialog ? "in a profile" : "in the workspace"}`, async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "Short mobile viewport");
    const { providers, region, card, provider } = await prepareComparison(page);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    for (const selected of providers.slice(1, 3)) {
      await page
        .getByRole("button", { name: `Save ${selected.name}`, exact: true })
        .click();
      await region
        .getByRole("button", { name: "Dismiss", exact: true })
        .click();
    }
    for (const selected of providers.slice(0, 3)) {
      await page
        .getByRole("button", { name: `Remove ${selected.name}`, exact: true })
        .click();
    }
    if (inDialog)
      await card
        .getByRole("button", { name: "View details", exact: true })
        .click();
    await page.setViewportSize({ width: 390, height: 300 });
    for (const selected of providers.slice(0, 3).reverse()) {
      await expect(region.locator('[data-slot="toast"]:visible')).toHaveCount(
        1,
      );
      await expect(region).toContainText(selected.name);
      await expectFullHitboxes(region);
      await region.getByRole("button", { name: "Undo", exact: true }).tap();
      await expect
        .poll(() =>
          page.evaluate(
            (key): string[] =>
              JSON.parse(localStorage.getItem(key)!).savedProviderIds,
            WORKSPACE_KEY,
          ),
        )
        .toContain(selected.id);
    }
    await expect(region.locator('[data-slot="toast"]')).toHaveCount(0);
    if (inDialog)
      await expect(
        page.getByRole("dialog", { name: provider.name, exact: true }),
      ).toBeVisible();
  });
}

test("a native provider dialog keeps full toast hitboxes at 390 by 300", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Short mobile viewport");
  const { card, provider, region, host } = await prepareComparison(page);
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: provider.name, exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  await page.setViewportSize({ width: 390, height: 300 });
  await dialog
    .getByRole("button", { name: "Shortlisted", exact: true })
    .click();
  await expect(region).toContainText("Removed from your shortlist");
  expect(await host.evaluate((element) => element.isConnected)).toBe(true);
  await expect(dialog.locator('[data-slot="toast-region"]')).toHaveCount(1);
  await expectFullHitboxes(region);
  await region.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Shortlisted" }),
  ).toBeVisible();
  await expect(region.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Shortlisted", exact: true })
    .click();
  await expect(region).toContainText("Removed from your shortlist");
  await expectFullHitboxes(region);
  await region.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Save to shortlist" }),
  ).toBeVisible();
});

test("failed dialog Undo reports an accessible SDK error and retries once storage works", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { card, provider, region } = await prepareComparison(page);
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: provider.name, exact: true });
  await expect(dialog).toBeVisible();
  if (testInfo.project.name === "mobile-390")
    await page.setViewportSize({ width: 390, height: 300 });
  await dialog
    .getByRole("button", { name: "Shortlisted", exact: true })
    .click();
  await expect(region).toContainText("Removed from your shortlist");
  const toast = region.locator('[data-slot="toast"]');
  const originalToast = await toast.elementHandle();
  const savedIds = () =>
    page.evaluate(
      (key): string[] =>
        JSON.parse(localStorage.getItem(key)!).savedProviderIds,
      WORKSPACE_KEY,
    );
  expect(await savedIds()).not.toContain(provider.id);
  const restoreStorage = await page.evaluateHandle((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("Test storage failure", "QuotaExceededError");
      return original.call(this, name, value);
    };
    return () => {
      Storage.prototype.setItem = original;
    };
  }, WORKSPACE_KEY);
  await region.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".page-error")).toContainText(
    "could not save this change",
  );
  await expect(toast).toHaveAttribute("data-type", "error");
  await expect(toast).toContainText(provider.name);
  const failure = "Could not restore this place. Try Undo again.";
  await expect(toast).toContainText(failure);
  await expect(toast).toHaveAccessibleDescription(new RegExp(failure));
  await expect(toast).toHaveCount(1);
  expect(await originalToast!.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  const announcement = dialog.locator('[data-ui-sdk-announcer="assertive"]');
  await expect(announcement).toHaveCount(1);
  await expect(announcement).toHaveAttribute("aria-live", "assertive");
  await expect(announcement).toContainText(failure);
  await expect(announcement).toContainText(provider.name);
  expect(await dialog.ariaSnapshot()).toContain(failure);
  await expect(
    dialog.getByRole("button", { name: "Save to shortlist" }),
  ).toBeVisible();
  expect(await savedIds()).not.toContain(provider.id);
  await expectFullHitboxes(region);
  await region.getByRole("button", { name: "Undo", exact: true }).focus();
  await expect(
    region.getByRole("button", { name: "Undo", exact: true }),
  ).toBeFocused();
  await restoreStorage.evaluate((restore) => restore());
  await restoreStorage.dispose();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Shortlisted" }),
  ).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect((await savedIds()).filter((id) => id === provider.id)).toHaveLength(1);
  expect(errors).toEqual([]);
});
