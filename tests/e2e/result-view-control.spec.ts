import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function findCare(page: Page) {
  await page.goto("/dashboard?demo=1");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  await expect(page.locator(".provider-card").first()).toBeVisible();
}

test("result view has one tab stop and arrow keys select and wrap", async ({
  page,
}) => {
  await findCare(page);
  const group = page.getByRole("radiogroup", { name: "Result view" });
  const list = group.getByRole("radio", { name: "List view", exact: true });
  const map = group.getByRole("radio", { name: "Map view", exact: true });
  await expect(group.getByRole("radio")).toHaveCount(2);
  await expect(list).toBeChecked();
  await expect(map).not.toBeChecked();

  await list.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(list).not.toBeFocused();
  await expect(map).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(list).toBeFocused();

  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    await page.keyboard.press(key);
    await expect(map).toBeFocused();
    await expect(map).toBeChecked();
    await expect(list).not.toBeChecked();
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.keyboard.press(key);
    await expect(list).toBeFocused();
    await expect(list).toBeChecked();
    await expect(map).not.toBeChecked();
    await expect(page.locator(".leaflet-container")).toHaveCount(0);
  }

  await map.click();
  await expect(map).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(list).not.toBeFocused();
  await expect(map).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(map).toBeFocused();
  await page.keyboard.press("Space");
  await expect(map).toBeChecked();
  await list.click();
  await expect(list).toBeChecked();
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
});

test("result view stays accessible with 44px targets at narrow widths", async ({
  page,
}, testInfo) => {
  await findCare(page);
  const group = page.getByRole("radiogroup", { name: "Result view" });

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const radio of await group.getByRole("radio").all()) {
      await expect(radio).toBeVisible();
      const bounds = await radio.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }

  const accessibility = await new AxeBuilder({ page })
    .include(".result-view-control")
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.keyboard.press("Tab");
  await group.getByRole("radio", { name: "List view" }).focus();
  await group.screenshot({
    path: testInfo.outputPath("result-view-control-focus.png"),
  });
});
