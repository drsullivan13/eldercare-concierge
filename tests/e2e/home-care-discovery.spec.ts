import { expect, test, type Page } from "@playwright/test";
import { createEmptyWorkspace } from "../../src/lib/workspace";
import type { CareCategory, SearchResponse } from "../../src/lib/providers";
import type { IndividualReviewsResponse } from "../../src/lib/individual-reviews";

const key = "harbor.demo.workspace.v1";

async function restoreProfile(page: Page, careTypes: CareCategory[]) {
  const workspace = createEmptyWorkspace();
  workspace.profile = {
    ...workspace.profile,
    name: "Discovery test",
    zip: "07960",
    careTypes,
  };
  workspace.savedProviderIds = ["north-jersey-hp-hp0015347"];
  await page.addInitScript(
    ({ key, workspace }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(workspace));
    },
    { key, workspace },
  );
  return workspace.profile;
}

test("normal dashboard entry finds home-care options and keeps facility search available", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const region = page.getByRole("region", { name: "Search nearby care" });
  await expect(
    region.getByRole("combobox", { name: "Care type", exact: true }),
  ).toHaveValue("home-care");
  await expect(region.getByRole("heading")).toHaveText(
    "Find in-home care for your family.",
  );
  await expect(region).toContainText("Looking for a facility?");
  await region
    .getByRole("button", { name: "Find in-home care", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home-care options." }),
  ).toBeVisible();
  const notice = page.locator(".care-search-view .care-search-guidance");
  await expect(notice).toContainText("report serving your ZIP");
  await expect(notice).toContainText(
    "Confirm your address and staffing",
  );
  const estimate = page
    .locator(".provider-card")
    .filter({ hasText: "Aquinas Healthcare" });
  await expect(estimate).toContainText("ZIP estimate");
  await expect(estimate).toContainText(
    "Service at your address is not confirmed.",
  );

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category" })
    .selectOption("assisted-living");
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Home-care options." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Care category" }),
  ).toHaveValue("home-care");
  await page
    .getByRole("combobox", { name: "Care category" })
    .selectOption("assisted-living");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find care nearby." }),
  ).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".provider-card").first()).toContainText(
    "Assisted living",
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category" })
    .selectOption("home-care");
  await expect(notice).toHaveCount(0);
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(notice).toBeVisible();
});

for (const scenario of [
  {
    careTypes: ["assisted-living"],
    category: "assisted-living",
    cta: "Find care",
  },
  { careTypes: ["home-health"], category: "home-health", cta: "Find care" },
  {
    careTypes: ["home-care", "nursing-home"],
    category: "all",
    cta: "Find care",
  },
] satisfies { careTypes: CareCategory[]; category: string; cta: string }[]) {
  test(`saved ${scenario.careTypes.join(" and ")} preferences survive search and reload`, async ({
    page,
  }) => {
    const profile = await restoreProfile(page, scenario.careTypes);
    await page.goto("/dashboard?demo=1");
    const region = page.getByRole("region", { name: "Search nearby care" });
    await expect(
      region.getByRole("combobox", { name: "Care type", exact: true }),
    ).toHaveValue(scenario.category);
    await expect(region.getByRole("heading")).toHaveText(
      "Find care for your family.",
    );
    await region
      .getByRole("button", { name: scenario.cta, exact: true })
      .click();
    await expect(page.locator(".search-summary")).toContainText(
      "Morristown, 07960",
    );
    await expect(
      page.locator(".care-search-view .care-search-guidance"),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      region.getByRole("combobox", { name: "Care type", exact: true }),
    ).toHaveValue(scenario.category);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).profile,
        key,
      ),
    ).toEqual(profile);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).savedProviderIds,
        key,
      ),
    ).toContain("north-jersey-hp-hp0015347");
  });
}

test("the exact BAYADA branch keeps six source ratings and opens its own review links without a score", async ({
  page,
  request,
}) => {
  const id = "north-jersey-hp-hp0015347";
  const profile = await restoreProfile(page, []);
  const api = await request.get(
    "/api/search?zip=07960&radius=25&category=home-care&q=BAYADA",
  );
  expect(api.ok()).toBe(true);
  const result: SearchResponse = await api.json();
  const branch = result.providers.find((provider) => provider.id === id)!;
  expect(branch.research?.experience.value).toBeNull();
  expect(branch.research?.experience.reviewCount).toBe(6);
  await page.goto("/dashboard?demo=1");
  await page
    .locator(".quick-search")
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("assisted-living");
  await expect(
    page
      .locator(".quick-search")
      .getByRole("button", { name: "Find care", exact: true }),
  ).toBeVisible();
  await page
    .locator(".quick-search")
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("home-care");
  await page
    .getByRole("button", { name: "Find in-home care", exact: true })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Provider or town" }).fill("BAYADA");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const card = page
    .locator(".provider-card")
    .filter({ hasText: "Morristown, NJ 07960" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("6 source-reported ratings");
  await expect(card).toContainText("Not enough evidence to score");
  await expect(card.locator(".experience-card-score")).toHaveCount(0);
  await expect(card).toContainText("Service at your address is not confirmed.");
  await expect(card.locator(".provider-proof")).toHaveCount(0);
  const reviewsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/reviews" && url.searchParams.get("id") === id;
  });
  await card.locator(".provider-review-entry").click();
  const reviews: IndividualReviewsResponse = await (
    await reviewsResponse
  ).json();
  expect(reviews.providerId).toBe(id);
  const dialog = page.getByRole("dialog", { name: branch.name, exact: true });
  await expect(
    dialog.getByRole("tab", { name: "Reviews", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  for (const disclosure of await dialog
    .locator(".public-reviews details")
    .all())
    if (!(await disclosure.getAttribute("open")))
      await disclosure.locator("summary").click();
  for (const account of reviews.accounts)
    await expect(
      dialog
        .locator(".public-reviews a")
        .filter({ hasText: `Original account linked by ${account.publisher}` })
        .first(),
    ).toBeVisible();
  expect(
    await dialog
      .locator(".public-reviews a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual(
    expect.arrayContaining(reviews.accounts.map((account) => account.url)),
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).profile,
      key,
    ),
  ).toEqual(profile);
});

test("home-care overview, results and filters fit a 320px screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/dashboard?demo=1");
  const cta = page.getByRole("button", {
    name: "Find in-home care",
    exact: true,
  });
  await expect(cta).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await cta.click();
  await expect(page.locator(".provider-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-care-320.png") });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const category = page.getByRole("combobox", { name: "Care category" });
  await expect(category).toHaveValue("home-care");
  await category.scrollIntoViewIfNeeded();
  const bounds = await category.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("a family can request just agencies reporting service in Edison and switch back to facilities", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1");
  const start = page.getByRole("region", { name: "Search nearby care" });
  await start.getByRole("textbox", { name: "Search ZIP code" }).fill("08817");
  await start.getByRole("button", { name: "Find in-home care" }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const evidence = page.getByRole("combobox", { name: "Research filter" });
  await evidence.selectOption({ label: "Agency reports serving this ZIP" });
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/search?") &&
      new URL(r.url()).searchParams.get("evidence") === "service-area",
  );
  await page.getByRole("button", { name: "Apply filters" }).click();
  const results: SearchResponse = await (await response).json();
  expect(results.origin.zip).toBe("08817");
  expect(
    results.providers.some((p) => p.id === "north-jersey-hp-hp0374000"),
  ).toBe(true);
  expect(results.providers.every((p) => p.serviceAreaMatch)).toBe(true);
  await expect(page.locator(".provider-card").first()).toContainText(
    /service area includes your searched ZIP/,
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category" })
    .selectOption("assisted-living");
  await expect(evidence).toHaveValue("all");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "Find care nearby." }),
  ).toBeVisible();
});
