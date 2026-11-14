import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function findCare(page: Page) {
  await page.goto("/dashboard?demo=1");
  await page
    .locator("form.quick-search")
    .getByRole("button", {
      name: "Find care",
      exact: true,
    })
    .click();
  await expect(page.locator(".search-summary")).toContainText("Chatham, 07928");
  await expect(
    page.getByRole("heading", { name: "Find care nearby." }),
  ).toBeFocused();
}

test("matching pending and completed submissions reuse results and one request", async ({
  page,
}) => {
  let searches = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/search?*", async (route) => {
    searches++;
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/dashboard?demo=1");
    await expect.poll(() => searches).toBe(1);
    await page
      .locator("form.quick-search")
      .getByRole("button", { name: "Find care", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Find care nearby." }),
    ).toBeFocused();
    expect(searches).toBe(1);
    release();
    const cards = page.locator(".care-search-view .provider-card");
    await expect(cards.first()).toBeVisible();
    const results = await cards.allTextContents();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(
      page.getByRole("form", { name: "Care search filters" }),
    ).toBeHidden();
    await expect(cards).toHaveText(results);
    expect(searches).toBe(1);
  } finally {
    release();
  }
});

for (const failure of ["http", "network"] as const) {
  test(`same search retries after ${failure} failure`, async ({ page }) => {
    const requests: string[] = [];
    await page.route("**/api/search?*", async (route) => {
      requests.push(route.request().url());
      if (requests.length > 1) return route.continue();
      if (failure === "network") return route.abort("failed");
      return route.fulfill({
        status: 503,
        json: { error: "Search unavailable" },
      });
    });
    await page.goto("/dashboard?demo=1");
    const menu = page.getByRole("button", { name: "Open navigation" });
    if (await menu.isVisible()) await menu.click();
    await page
      .locator(".side-nav")
      .getByRole("button", { name: "Find care", exact: true })
      .click();
    await expect(
      page.locator(".care-search-view").getByRole("alert"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const retried = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/search",
    );
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    expect((await retried).status()).toBe(200);
    await expect(
      page.locator(".care-search-view .provider-card").first(),
    ).toBeVisible();
    await expect(
      page.locator(".care-search-view").getByRole("alert"),
    ).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
  });
}

test("filters apply only on submit and every dismissal discards mobile edits", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Mobile drawer behavior");
  const requests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/search") requests.push(url);
  });
  await findCare(page);
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  const drawer = page.getByRole("dialog", { name: "Filter care options" });
  await expect(drawer).toBeHidden();

  for (const dismissal of ["Cancel", "Close filters", "Escape", "backdrop"]) {
    await trigger.click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#search-filters")).toHaveCount(1);
    const before = requests.length;
    await drawer
      .getByRole("textbox", { name: "Search ZIP code" })
      .fill("02459");
    await drawer
      .getByRole("combobox", { name: "Search radius" })
      .selectOption("10");
    await drawer
      .getByRole("combobox", { name: "Care category" })
      .selectOption("assisted-living");
    await drawer
      .getByRole("combobox", { name: "Research filter" })
      .selectOption("pricing");
    await drawer
      .getByRole("combobox", { name: "Provider or town" })
      .fill("Newton");
    await expect(page.locator(".search-summary")).toContainText(
      "Chatham, 07928",
    );
    if (dismissal === "Escape") {
      await drawer.getByRole("textbox", { name: "Search ZIP code" }).focus();
      await page.keyboard.press("Escape");
    } else if (dismissal === "backdrop") {
      await page.mouse.click(5, 5);
    } else {
      await drawer
        .getByRole("button", { name: dismissal, exact: true })
        .click();
    }
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(requests).toHaveLength(before);
    await trigger.click();
    await expect(
      drawer.getByRole("textbox", { name: "Search ZIP code" }),
    ).toHaveValue("07928");
    await expect(
      drawer.getByRole("combobox", { name: "Search radius" }),
    ).toHaveValue("25");
    await expect(
      drawer.getByRole("combobox", { name: "Care category" }),
    ).toHaveValue("all");
    await expect(
      drawer.getByRole("combobox", { name: "Research filter" }),
    ).toHaveValue("all");
    await expect(
      drawer.getByRole("combobox", { name: "Provider or town" }),
    ).toHaveValue("");
    await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  }

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeFocused();
  const close = drawer.getByRole("button", { name: "Close filters" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    drawer.getByRole("button", { name: "Apply filters" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await drawer.getByRole("textbox", { name: "Search ZIP code" }).fill("024");
  await drawer.getByRole("button", { name: "Apply filters" }).click();
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("textbox", { name: "Search ZIP code" }),
  ).toBeFocused();
  await drawer.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await drawer
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("10");
  const applied = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("zip") === "02459" &&
      url.searchParams.get("radius") === "10"
    );
  });
  await drawer.getByRole("button", { name: "Apply filters" }).click();
  expect((await applied).status()).toBe(200);
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".search-summary")).toContainText(
    "Newton Center, 02459",
  );
  await expect(page.locator(".search-summary")).toContainText("10 miles");
});

test("one filter form follows the viewport without losing edits", async ({
  page,
}) => {
  await findCare(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toBeFocused();
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("15");
  for (const width of [768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const form = page.getByRole("form", { name: "Care search filters" });
    await expect(form).toBeVisible();
    await expect(page.locator("#search-filters")).toHaveCount(1);
    await expect(
      form.getByRole("combobox", { name: "Search radius" }),
    ).toHaveValue("15");
    if (width <= 760) {
      await expect(
        page.getByRole("dialog", { name: "Filter care options" }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("dialog")).toBeHidden();
    }
    for (const control of await form.locator("input, select, button").all()) {
      if (!(await control.isVisible())) continue;
      const bounds = await control.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("textbox", { name: "Search ZIP code" }).focus();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("form", { name: "Care search filters" }),
  ).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    page.getByRole("combobox", { name: "Search radius" }),
  ).toHaveValue("25");
});

test("open filters have accessible controls and usable short-screen actions", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Mobile drawer layout");
  await findCare(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Filter care options" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("combobox", { name: "Provider or town" }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include(".care-filter-drawer")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const apply = drawer.getByRole("button", { name: "Apply filters" });
  await apply.scrollIntoViewIfNeeded();
  const bounds = await apply.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
  const evidence = drawer.getByRole("combobox", { name: "Research filter" });
  await evidence.focus();
  await evidence.scrollIntoViewIfNeeded();
  const evidenceBounds = await evidence.boundingBox();
  expect(evidenceBounds!.y + evidenceBounds!.height).toBeLessThanOrEqual(
    bounds!.y,
  );
  await page.screenshot({ path: testInfo.outputPath("filters-320.png") });
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drawer).toBeHidden();
});

test("autocomplete keyboard choices stay inside filters until Apply", async ({
  page,
}) => {
  await page.route("**/api/search-suggestions?*", (route) =>
    route.fulfill({
      json: {
        suggestions: [
          {
            id: "town-chatham",
            kind: "town",
            value: "Chatham",
            detail: "Nearby town",
          },
        ],
      },
    }),
  );
  await findCare(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const form = page.getByRole("form", { name: "Care search filters" });
  const input = form.getByRole("combobox", { name: "Provider or town" });
  await input.fill("Chat");
  await expect(
    page.getByRole("option", { name: "Chatham Nearby town" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.fill("Chath");
  await expect(
    page.getByRole("option", { name: "Chatham Nearby town" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("Chatham");
  await expect(form).toBeVisible();
  const applied = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" && url.searchParams.get("q") === "Chatham"
    );
  });
  await form.getByRole("button", { name: "Apply filters" }).click();
  expect((await applied).status()).toBe(200);
  await expect(form).toBeHidden();
});
