import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import source38 from "../../research/north-jersey/review-release/source-checks/visiting-angels-scotch-plains.json";
import { computeExperienceScore } from "../../src/lib/experience-score";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";
import type { IndividualReviewsResponse } from "../../src/lib/individual-reviews";

async function search(page: Page, zip: string, name: string) {
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for your family.",
  );
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill(zip);
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Provider or town" }).fill(name);
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.locator(".result-skeleton")).toHaveCount(0);
}

async function checkLayout(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    dialog: document.querySelector("dialog")!.clientWidth,
    contents: document.querySelector("dialog")!.scrollWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.contents).toBeLessThanOrEqual(widths.dialog + 1);
  expect(
    (
      await new AxeBuilder({ page })
        .include("dialog")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test("direct card entry separates source counts, reads actual individual records and explains exact score weights", async ({
  page,
  request,
}, testInfo) => {
  const id = "lifeplan-brooksby-village";
  const response = await request.get("/api/reviews", { params: { id } });
  expect(response.ok()).toBe(true);
  const catalog: IndividualReviewsResponse = await response.json();
  const evidence: LocationResearchResponse = await (
    await request.get("/api/research", { params: { id } })
  ).json();
  await search(page, "02459", "Brooksby");
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: "Brooksby Village", exact: true }),
  });
  await expect(card).toContainText(
    `Based on ${evidence.experience.reviewCount}`,
  );
  const entry = card.getByRole("button", {
    name: /Read \d+ reviews|Browse \d+ review links/,
  });
  await entry.click();
  const dialog = page.getByRole("dialog", {
    name: "Brooksby Village",
    exact: true,
  });
  await expect(
    dialog.getByRole("tab", { name: "Reviews", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByText("Checking for additional individual records…"),
  ).toHaveCount(0);
  const withText = catalog.accounts.filter(
    (account) => account.excerpt.trim() || account.summary.trim(),
  ).length;
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    `${withText} reviews here`,
  );
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    `${evidence.experience.reviewCount} source ratings used`,
  );
  const visible = dialog.locator(".public-reviews [data-review-account]");
  expect(await visible.count()).toBeLessThanOrEqual(6);
  expect(await visible.count()).toBeGreaterThan(0);
  if (catalog.accounts.length > 6) {
    await dialog.getByRole("button", { name: "Next accounts" }).click();
    await expect(dialog.locator(".review-page-heading")).toBeFocused();
    await expect(dialog.locator(".review-page-heading")).toContainText(
      "Accounts 7",
    );
    await dialog.getByRole("button", { name: "Previous accounts" }).click();
    await expect(dialog.locator(".review-page-heading")).toBeFocused();
    await expect(dialog.locator(".review-page-heading")).toContainText(
      "Accounts 1",
    );
  }
  await dialog
    .getByRole("checkbox", { name: "Family & resident accounts" })
    .check();
  const family = catalog.accounts.filter((account) =>
    ["family", "resident"].includes(account.relationship),
  );
  await expect(visible).toHaveCount(Math.min(6, family.length));
  for (const account of await visible.all())
    await expect(account.locator(".review-meta")).toContainText(
      /Self-described (family|resident)/,
    );
  await dialog
    .getByRole("checkbox", { name: "Family & resident accounts" })
    .uncheck();
  await dialog.locator(".experience-method summary").click();
  await expect(dialog.locator(".score-source-weights")).toContainText(
    "100.00%",
  );
  await expect(dialog.locator(".experience-method")).toContainText(
    "square root",
  );
  await expect(dialog.locator(".experience-method")).toContainText(
    "Shared or syndicated sources contribute once",
  );
  await expect(dialog.locator(".score-purpose")).toContainText(
    "perks do not add points",
  );
  await checkLayout(page);
  await dialog.locator(".review-page-heading").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("individual-reviews.png"),
  });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(entry).toBeFocused();
});

test("real retained 38-rating source remains excluded and never implies 38 readable accounts", async ({
  page,
  request,
}, testInfo) => {
  const id = "north-jersey-hp-hp0320800";
  const original: LocationResearchResponse = await (
    await request.get("/api/research", { params: { id } })
  ).json();
  expect(source38.identityText).toContain("38 ratings");
  expect(source38.scopeQa.assessment).toContain("employee");
  const sources: LocationResearchResponse["sources"] = [
    {
      id: "retained-38-source",
      url: source38.url,
      title: source38.title,
      publisher: "MyLivingChoice",
      kind: "review-platform",
      checkedAt: source38.checkedAt,
      publishedAt: null,
      access: "full-page",
    },
  ];
  const reviewAggregates: LocationResearchResponse["reviewAggregates"] = [
    {
      sourceId: sources[0].id,
      platform: "MyLivingChoice",
      sourceFamily: "google",
      rating: 5,
      scale: 5,
      count: 38,
      asOf: source38.checkedAt,
      scope: "mixed employee and consumer",
      notes: [source38.scopeQa.assessment],
    },
  ];
  const evidence = {
    ...original,
    sources,
    reviewAggregates,
    reviews: [],
    experience: computeExperienceScore({
      sources,
      reviewAggregates,
      asOfDate: "2026-11-12",
    }),
  };
  await page.route(`**/api/research?id=${id}`, (route) =>
    route.fulfill({ json: evidence }),
  );
  await page.route(`**/api/reviews?id=${id}`, (route) =>
    route.fulfill({
      json: { providerId: id, accounts: [], sources: [], notes: [] },
    }),
  );
  await search(page, "07076", "BASS SERVICES");
  const card = page
    .locator("article.provider-card")
    .filter({ hasText: "BASS SERVICES" });
  await card
    .getByRole("button", {
      name: /Explore review sources|Read \d+ reviews|Browse \d+ review links/,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "38 source ratings reported",
  );
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "No individual accounts here",
  );
  await expect(dialog.locator(".experience-overview")).toContainText(
    "Not rated yet",
  );
  await expect(dialog.locator(".review-excluded")).toContainText(
    "Not an exact-location consumer aggregate",
  );
  await expect(dialog.locator(".public-reviews article")).toHaveCount(0);
  await checkLayout(page);
  await dialog.locator(".review-count-clarity").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("real-38-source-count.png"),
  });
});

test("individual review API follows exact-ID validation and never accepts extra parameters", async ({
  request,
}) => {
  for (const query of [
    "",
    "?id=BAD",
    "?id=lifeplan-brooksby-village&extra=1",
    "?id=all-care&id=all-care",
  ]) {
    const response = await request.get(`/api/reviews${query}`);
    expect(response.status()).toBe(400);
  }
  expect(
    (await request.get("/api/reviews?id=unknown-exact-provider")).status(),
  ).toBe(404);
});

test("actual North Hill source keeps 38 mixed-campus ratings distinct from four nursing-unit accounts", async ({
  page,
  request,
}, testInfo) => {
  const id = "cms-225281";
  const response = await request.get("/api/reviews", { params: { id } });
  expect(response.ok()).toBe(true);
  const catalog: IndividualReviewsResponse = await response.json();
  const source = catalog.sources.find((item) => item.reportedCount === 38)!;
  expect(source).toBeTruthy();
  expect(source.scopeNote).toContain(
    "38 ratings across North Hill and Pines Edge",
  );
  expect(catalog.accounts).toHaveLength(4);
  const evidence: LocationResearchResponse = await (
    await request.get("/api/research", { params: { id } })
  ).json();
  expect(evidence.experience.value).toBeNull();
  expect(evidence.experience.reviewCount).toBe(0);
  await search(page, "02492", "SKILLED NURSING FACILITY AT NORTH HILL");
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", {
      name: "SKILLED NURSING FACILITY AT NORTH HILL (THE)",
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "Read 4 reviews", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "4 reviews here",
  );
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "38 source ratings reported",
  );
  await expect(dialog.locator(".review-source-scope")).toContainText(
    source.scopeNote!,
  );
  await expect(dialog.locator(".public-reviews article")).toHaveCount(4);
  for (const account of catalog.accounts)
    await expect(
      dialog.locator(`.public-reviews a[href="${account.url}"]`),
    ).toHaveCount(1);
  await expect(dialog.locator(".experience-overview")).toContainText(
    "Not rated yet",
  );
  await checkLayout(page);
  await dialog.locator(".review-count-clarity").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("actual-north-hill-38-ratings.png"),
  });
});

test("review paging keeps the family filter and returns keyboard focus after recoverable catalog failure", async ({
  page,
  request,
}) => {
  const id = "lifeplan-brooksby-village";
  const response = await request.get("/api/reviews", { params: { id } });
  const original: IndividualReviewsResponse = await response.json();
  const template = original.accounts[0];
  expect(template).toBeTruthy();
  const accounts = Array.from({ length: 14 }, (_, index) => ({
    ...template,
    id: `paging-fixture-${index}`,
    url: `https://example.org/paging-fixture/${index}`,
    excerpt: "",
    summary: "",
    aspects: [],
    notes: [],
    rating: null,
    scale: null,
    relationship: index < 8 ? ("family" as const) : ("unknown" as const),
    representation: "link-only" as const,
  }));
  let unavailable = true;
  await page.route(`**/api/reviews?id=${id}`, (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: { error: "Controlled catalog failure" },
        })
      : route.fulfill({ json: { ...original, accounts } }),
  );
  await search(page, "02459", "Brooksby");
  await page
    .locator("article.provider-card")
    .filter({
      has: page.getByRole("button", { name: "Brooksby Village", exact: true }),
    })
    .getByRole("button", { name: /Read \d+ reviews|Browse \d+ review links/ })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Brooksby Village",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "Showing retained location accounts only",
  );
  unavailable = false;
  await dialog
    .getByRole("button", { name: "Retry individual reviews" })
    .click();
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "14 review links here",
  );
  await dialog
    .getByRole("checkbox", { name: "Family & resident accounts" })
    .check();
  await expect(dialog.locator(".review-page-heading")).toContainText(
    "Accounts 1–6 of 8",
  );
  await dialog.getByRole("button", { name: "Next accounts" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".review-page-heading")).toBeFocused();
  await expect(dialog.locator(".review-page-heading")).toContainText(
    "Accounts 7–8 of 8",
  );
  await expect(dialog.locator(".public-reviews article")).toHaveCount(1);
  await expect(
    dialog.locator(".public-reviews [data-review-account]"),
  ).toHaveCount(2);
  await dialog.locator(".public-reviews details > summary").click();
  await expect(
    dialog.getByRole("checkbox", { name: "Family & resident accounts" }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Next accounts" }),
  ).toBeDisabled();
  await expect(
    dialog.locator(".public-reviews .review-meta").first(),
  ).toContainText("Self-described family");
  await checkLayout(page);
});

test("actual Chatham source shows original summaries, keeps the building concern and groups the staff link", async ({
  page,
  request,
}, testInfo) => {
  const id = "cms-315120";
  const response = await request.get("/api/reviews", { params: { id } });
  expect(response.ok()).toBe(true);
  const catalog: IndividualReviewsResponse = await response.json();
  expect(catalog.accounts).toHaveLength(5);
  const summaries = catalog.accounts.filter(
    (account) => account.representation === "original-summary",
  );
  expect(summaries).toHaveLength(4);
  await search(page, "07928", "CHATHAM HILLS");
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", {
      name: "CHATHAM HILLS SUBACUTE CARE CENTER",
      exact: true,
    }),
  });
  await card.locator("button.provider-review-entry").click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Checking for additional individual records…"),
  ).toHaveCount(0);
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "4 reviews here + 1 link",
  );
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "224 source ratings used",
  );
  await expect(dialog.locator(".review-source-scope")).toContainText(
    "both an employee and a family member",
  );
  await expect(dialog.locator(".public-reviews blockquote")).toHaveCount(0);
  await expect(dialog.locator(".public-reviews .review-summary")).toHaveCount(
    4,
  );
  for (const account of summaries) {
    const narrative = dialog.locator(
      `[data-review-account][id$="-account-${account.id}"]`,
    );
    await expect(narrative).toContainText(account.summary);
    await expect(narrative).toContainText("Harbor summary");
    await expect(narrative.getByRole("link")).toHaveAttribute(
      "href",
      account.url,
    );
  }
  await expect(dialog.locator(".public-reviews")).toContainText(
    "building needs updating",
  );
  const browse = dialog.getByText("Browse 1 original account", { exact: true });
  await expect(browse).toBeVisible();
  await browse.click();
  const staff = catalog.accounts.find(
    (account) => account.relationship === "staff",
  )!;
  const staffRow = dialog.locator(
    `[data-review-account][id$="-account-${staff.id}"]`,
  );
  await expect(staffRow).toBeVisible();
  await expect(staffRow).toContainText("Self-described staff");
  await expect(staffRow.getByRole("link")).toHaveAttribute("href", staff.url);
  await checkLayout(page);
  await dialog.locator(".review-count-clarity").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("chatham-original-summaries.png"),
  });
  await dialog
    .getByRole("checkbox", { name: "Family & resident accounts" })
    .check();
  await expect(dialog.locator(".review-page-heading")).toBeFocused();
  await expect(
    dialog.locator(".public-reviews [data-review-account]"),
  ).toHaveCount(4);
  await expect(
    dialog.getByText("Browse 1 original account", { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator(".review-count-clarity")).toContainText(
    "224 source ratings used",
  );
});
