import { expect, test } from "@playwright/test";
import type { SearchResponse } from "../../src/lib/providers";

test("experience sorting asks for a care type and comparison keeps one selection", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1");
  const zip = page.getByRole("textbox", { name: "Search ZIP code" });
  await expect(zip).toHaveAttribute("inputmode", "numeric");
  await expect(zip).toHaveAttribute("pattern", "[0-9]{5}");
  await expect(zip).toHaveAttribute("maxlength", "5");
  await expect(zip).toHaveAttribute("required", "");
  await zip.fill("02459");
  await page
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("all");
  await page
    .getByRole("region", { name: "Search nearby care" })
    .getByRole("button", { name: "Find care" })
    .click();
  await expect(page.locator(".provider-card").first()).toBeVisible();

  const filters = page.getByRole("button", { name: "Filters", exact: true });
  await expect(filters).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("combobox", { name: "Care category" }),
  ).not.toBeVisible();
  const sort = page.getByRole("combobox", { name: "Sort results" });
  await sort.selectOption("experience");
  const prompt = page.getByRole("region", {
    name: "Choose a care type to rank by experience",
  });
  await expect(prompt).toContainText("not clinical quality or safety");
  await expect(sort).toHaveValue("distance");
  const careType = prompt.getByRole("combobox", {
    name: "Care type for experience",
  });
  await expect(careType).toBeFocused();
  await prompt.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(prompt).not.toBeVisible();
  await expect(sort).toHaveValue("distance");
  await sort.selectOption("experience");
  const sortedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("category") === "nursing-home" &&
      url.searchParams.get("sort") === "experience"
    );
  });
  await careType.selectOption("nursing-home");
  const response = await sortedResponse;
  expect(response.status()).toBe(200);
  const results: SearchResponse = await response.json();
  expect(results.providers.length).toBeGreaterThanOrEqual(4);
  expect(
    results.providers.every((provider) => provider.category === "nursing-home"),
  ).toBe(true);
  await expect(
    page.locator(".provider-card").first().getByRole("button", {
      name: results.providers[0].name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(sort).toHaveValue("experience");
  await expect(prompt).not.toBeVisible();

  const checks = page.getByRole("checkbox", { name: /^Compare / });
  const tray = page.getByLabel("Comparison selections");
  await checks.nth(0).focus();
  await checks.nth(0).press("Space");
  await expect(checks.nth(0)).toBeChecked();
  await expect(tray).toContainText("1 of 3 selected");
  await expect(
    tray.getByRole("button", { name: "Compare", exact: true }),
  ).toBeDisabled();
  await checks.nth(1).check();
  await checks.nth(2).check();
  await expect(tray).toContainText("3 of 3 selected");
  await checks.nth(3).click();
  await expect(checks.nth(3)).not.toBeChecked();
  await expect(tray).toContainText("3 of 3 selected");
  await tray.getByRole("button", { name: "Compare", exact: true }).click();
  const comparison = page.getByRole("dialog", {
    name: "Compare places",
    exact: true,
  });
  await expect(comparison).toBeVisible();
  const [first, second, third] = results.providers;
  await expect(
    comparison.getByRole("button", { name: first.name, exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByRole("button", { name: second.name, exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByRole("button", { name: third.name, exact: true }),
  ).toHaveCount(0);
  await comparison
    .getByRole("combobox", { name: "Compare pair", exact: true })
    .selectOption(first.id);
  await expect(
    comparison.getByRole("button", { name: first.name, exact: true }),
  ).toHaveCount(0);
  await expect(
    comparison.getByRole("button", { name: third.name, exact: true }),
  ).toBeVisible();
  await comparison.getByRole("button", { name: "Close dialog" }).click();
  await expect(checks.nth(0)).toBeChecked();
  await expect(checks.nth(1)).toBeChecked();
  await expect(checks.nth(2)).toBeChecked();
  await tray.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(tray).toHaveCount(0);
  await expect(checks.nth(0)).not.toBeChecked();
  await expect(checks.nth(1)).not.toBeChecked();
  await expect(checks.nth(2)).not.toBeChecked();
});

test("collapsed filters apply care types and mobile controls remain usable without clipping", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await page
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("life-plan");
  await page
    .getByRole("region", { name: "Search nearby care" })
    .getByRole("button", { name: "Find care" })
    .click();
  await expect(page.locator(".provider-card").first()).toBeVisible();

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    const category = page.getByRole("combobox", { name: "Care category" });
    await expect(category).toHaveValue("life-plan");
    await category.selectOption("assisted-living");
    await expect(page.locator(".search-summary")).toContainText(
      "Continuing & tiered care",
    );
    const response = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/search" &&
        url.searchParams.get("category") === "assisted-living"
      );
    });
    await page.getByRole("button", { name: "Apply filters" }).click();
    expect((await response).status()).toBe(200);
    await expect(page.locator(".search-summary")).toContainText(
      "Assisted living",
    );
    await expect(category).not.toBeVisible();
    await expect(page.locator(".provider-card").first()).toBeVisible();
    await filters.click();
    await category.selectOption("life-plan");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.locator(".search-summary")).toContainText(
      "Continuing & tiered care",
    );
    await expect(page.locator(".provider-card").first()).toBeVisible();

    const controls = [
      filters,
      page.getByRole("combobox", { name: "Sort results" }),
      page.getByRole("radio", { name: "Map view", exact: true }),
      page.getByRole("radio", { name: "List view", exact: true }),
      page
        .locator(".provider-card")
        .first()
        .getByRole("button", { name: "View details" }),
      page.locator(".provider-card").first().locator(".compare-check"),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByRole("combobox", { name: "Sort results" })
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
});
