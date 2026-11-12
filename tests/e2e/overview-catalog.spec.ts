import { expect, test, type Page } from "@playwright/test";
import type { IndividualReviewsResponse } from "../../src/lib/individual-reviews";
import type { SearchResponse } from "../../src/lib/providers";

async function openOverview(page: Page, zip: string, name: string) {
  await page.goto("/dashboard?demo=1");
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill(zip);
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("textbox", { name: "Provider or town" }).fill(name);
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const card = page.locator(".provider-card").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  return dialog;
}

test("catalog-only Overview offers readable reviews without fetching their text until navigation", async ({
  page,
  request,
}, testInfo) => {
  const id = "north-jersey-doh-nj07015";
  const response = await request.get("/api/reviews", { params: { id } });
  expect(response.ok()).toBe(true);
  const catalog: IndividualReviewsResponse = await response.json();
  const readable = catalog.accounts.filter(
    (account) => account.excerpt.trim() || account.summary.trim(),
  );
  expect(readable.length).toBeGreaterThan(0);
  expect(readable.every((account) => !account.excerpt && account.summary)).toBe(
    true,
  );
  let reviewRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/reviews") reviewRequests += 1;
  });
  const dialog = await openOverview(page, "07068", "BENCHMARK AT ROSELAND");
  const overview = dialog.getByRole("region", { name: "Property overview" });
  const entry = overview.getByRole("button", {
    name: `Read ${readable.length} reviews`,
    exact: true,
  });
  await expect(entry).toBeVisible();
  await expect(overview).not.toContainText("No review excerpt yet");
  await expect(overview.locator("blockquote")).toHaveCount(0);
  await expect(overview).toContainText("research summaries");
  expect(reviewRequests).toBe(0);
  await entry.scrollIntoViewIfNeeded();
  const widths = await dialog.evaluate((element) => ({
    width: element.clientWidth,
    contents: element.scrollWidth,
  }));
  expect(widths.contents).toBeLessThanOrEqual(widths.width + 1);
  await page.screenshot({ path: testInfo.outputPath("roseland-overview.png") });
  await entry.click();
  await expect(
    dialog.getByRole("tab", { name: "Reviews", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".public-reviews article")).toHaveCount(
    catalog.accounts.length,
  );
  expect(reviewRequests).toBeGreaterThan(0);
  for (const account of readable) {
    const review = dialog.locator(".public-reviews article").filter({
      hasText: account.summary,
    });
    await expect(review.locator(".review-summary")).toContainText(
      "Research summary",
    );
    await expect(review.locator("blockquote")).toHaveCount(0);
    await expect(
      review.getByRole("link", { name: /Read the original account/ }),
    ).toHaveAttribute("href", account.url);
  }
});

test("Brooksby keeps its attributed excerpt, concerns and direct account navigation", async ({
  page,
}, testInfo) => {
  const dialog = await openOverview(page, "02459", "Brooksby Village");
  const overview = dialog.getByRole("region", { name: "Property overview" });
  await expect(overview.locator("blockquote")).toHaveText(
    "“The food is generally awful.”",
  );
  await expect(overview).toContainText("Self-described family · Caring.com");
  await expect(overview).toContainText("Selected reviews include concerns.");
  await overview.locator(".overview-caveat summary").click();
  await expect(overview.locator(".overview-caveat")).toContainText(
    "Sep 29, 2025",
  );
  await expect(overview.locator(".overview-caveat")).toContainText(
    "Relationships are not independently verified.",
  );
  const entry = overview.getByRole("button", { name: "Full review & context" });
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("brooksby-overview.png") });
  await entry.click();
  const account = dialog.locator(".public-reviews article").filter({
    hasText: "The food is generally awful.",
  });
  await expect(account).toBeFocused();
  await expect(
    account.getByRole("link", { name: /Read the original account/ }),
  ).toHaveAttribute(
    "href",
    "https://www.caring.com/senior-living/massachusetts/peabody/brooksby-village-peabody-massachusetts-01960",
  );
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  await overview
    .getByRole("button", { name: "Read concerns", exact: true })
    .click();
  await expect(account).toBeFocused();
});

for (const scenario of [
  {
    name: "link-only",
    counts: { total: 3, withText: 0 },
    label: "Browse 3 review links",
  },
  { name: "mixed", counts: { total: 3, withText: 2 }, label: "Read 2 reviews" },
  {
    name: "unknown",
    counts: undefined,
    label: "Explore reviews & family discussions",
  },
]) {
  test(`Overview distinguishes ${scenario.name} coverage from readable review counts`, async ({
    page,
  }) => {
    await page.route("**/api/search?**", async (route) => {
      const response = await route.fetch();
      const result: SearchResponse = await response.json();
      for (const provider of result.providers) {
        if (provider.id === "north-jersey-doh-nj07015" && provider.research) {
          provider.research.individualReviews = scenario.counts;
        }
      }
      await route.fulfill({ response, json: result });
    });
    const dialog = await openOverview(page, "07068", "BENCHMARK AT ROSELAND");
    const overview = dialog.getByRole("region", { name: "Property overview" });
    await expect(
      overview.getByRole("button", { name: scenario.label, exact: true }),
    ).toBeVisible();
    await expect(overview).not.toContainText(
      /Read 0 reviews|0 reviews available/,
    );
    if (scenario.name === "link-only") {
      await expect(overview).not.toContainText("research summaries");
    }
    if (scenario.name === "mixed") {
      await expect(
        overview.getByRole("button", {
          name: "Browse 1 more review link",
          exact: true,
        }),
      ).toBeVisible();
    }
  });
}
