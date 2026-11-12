import { test, expect, type Locator, type Page } from "@playwright/test";
import type { IndividualReviewsResponse } from "../../src/lib/individual-reviews";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
const id = "cms-315101";
const name = "COMPLETE CARE AT PLAINFIELD LLC";

async function openReviews(page: Page) {
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("07960");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByPlaceholder("Search by name or town").fill(name);
  const loaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/search" && url.searchParams.get("q") === name;
  });
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  expect((await loaded).status()).toBe(200);
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
  const entry = card.locator("button.provider-review-entry");
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAccessibleName(/review/i);
  await entry.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name,
    exact: true,
  });
  await expect(
    dialog.getByRole("tab", { name: "Reviews", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("tabpanel", { name: "Reviews", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("status").filter({ hasText: /Checking for additional/ }),
  ).toHaveCount(0);
  return dialog;
}

async function collectAccounts(page: Page, dialog: Locator) {
  const collected: { id: string; text: string; href: string | null }[] = [];
  const heading = dialog.getByRole("heading", { name: /^Accounts \d/ });
  const next = dialog.getByRole("button", {
    name: "Next accounts",
    exact: true,
  });
  for (let count = 0; count < 100; count++) {
    const articles = dialog.locator(".public-reviews article");
    expect(await articles.count()).toBeGreaterThan(0);
    expect(await articles.count()).toBeLessThanOrEqual(6);
    for (const article of await articles.all()) {
      collected.push({
        id: (await article.getAttribute("id"))!.split("-account-")[1],
        text: await article.innerText(),
        href: await article.getByRole("link").getAttribute("href"),
      });
    }
    if (!(await next.count()) || (await next.isDisabled())) return collected;
    const prior = await heading.innerText();
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(heading).not.toHaveText(prior);
    await expect(heading).toBeFocused();
  }
  throw new Error("Individual review pagination did not reach its last page.");
}

test("keyboard pagination reaches every actual account once and filtering resets the page without changing ratings", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/api/reviews", { params: { id } });
  expect(response.status()).toBe(200);
  const catalog: IndividualReviewsResponse = await response.json();
  expect(catalog.providerId).toBe(id);
  expect(catalog.accounts.length).toBeGreaterThan(6);
  const evidenceResponse = await request.get("/api/research", {
    params: { id },
  });
  expect(evidenceResponse.status()).toBe(200);
  const evidence: LocationResearchResponse = await evidenceResponse.json();
  expect(evidence.experience.value).toBe(9.4);
  expect(evidence.experience.reviewCount).toBe(192);
  const dialog = await openReviews(page);
  const counts = dialog.locator(".review-count-clarity");
  await expect(counts).toContainText(/\b2\b/);
  await expect(counts).toContainText(/\b5\b/);
  await expect(counts).toContainText("192");
  await expect(
    dialog.getByRole("button", { name: "Previous accounts", exact: true }),
  ).toBeDisabled();
  const dimensions = await dialog
    .locator(".public-reviews")
    .evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      sizes: [
        ...element.querySelectorAll(
          "blockquote, .review-summary, .review-link-only",
        ),
      ].map((node) => parseFloat(getComputedStyle(node).fontSize)),
    }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.sizes.every((size) => size >= 16)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("keyboard-review-subset.png"),
  });
  const accounts = await collectAccounts(page, dialog);
  expect(accounts.map(({ id }) => id).sort()).toEqual(
    catalog.accounts.map(({ id }) => id).sort(),
  );
  expect(new Set(accounts.map(({ id }) => id)).size).toBe(
    catalog.accounts.length,
  );
  for (const account of catalog.accounts) {
    const rendered = accounts.find(({ id }) => id === account.id)!;
    expect(rendered.href).toBe(account.url);
    expect(rendered.text).toContain(
      account.excerpt || account.summary || account.publisher,
    );
    expect(rendered.text).toContain(
      account.relationship === "unknown"
        ? "Relationship not established"
        : `Self-described ${account.relationship}`,
    );
  }
  const family = dialog.getByRole("checkbox", {
    name: "Family & resident accounts",
  });
  await family.focus();
  await page.keyboard.press("Space");
  await expect(family).toBeChecked();
  const selected = catalog.accounts.filter(({ relationship }) =>
    ["family", "resident"].includes(relationship),
  );
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.length).toBeLessThan(catalog.accounts.length);
  await expect(
    dialog.getByRole("heading", { name: /^Accounts 1/ }),
  ).toBeFocused();
  expect(
    (await collectAccounts(page, dialog)).map(({ id }) => id).sort(),
  ).toEqual(selected.map(({ id }) => id).sort());
  await expect(counts).toContainText(/\b2\b/);
  await expect(counts).toContainText(/\b5\b/);
  await expect(dialog.locator(".experience-number")).toHaveText("9.4/10");
  await family.focus();
  await page.keyboard.press("Space");
  await expect(
    dialog.getByRole("heading", { name: /^Accounts 1/ }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Previous accounts", exact: true }),
  ).toBeDisabled();
});

for (const failure of ["unavailable", "wrong-location"] as const) {
  test(`individual review ${failure} retains the location accounts and recovers without changing the score`, async ({
    page,
    request,
  }) => {
    const researchResponse = await request.get("/api/research", {
      params: { id },
    });
    const research: LocationResearchResponse = await researchResponse.json();
    let recover = false;
    await page.route(`**/api/reviews?id=${id}`, async (route) => {
      if (recover) return route.continue();
      if (failure === "unavailable")
        return route.fulfill({
          status: 503,
          json: { error: "Controlled acceptance failure" },
        });
      const response = await route.fetch();
      const json: IndividualReviewsResponse = await response.json();
      json.providerId = "another-location";
      json.accounts = json.accounts.map((account) => ({
        ...account,
        excerpt: "Foreign location acceptance sentinel",
      }));
      await route.fulfill({ response, json });
    });
    const dialog = await openReviews(page);
    await expect(
      dialog.getByRole("alert").filter({
        has: page.getByRole("button", { name: "Retry individual reviews" }),
      }),
    ).toBeVisible();
    await expect(dialog).not.toContainText(
      "Foreign location acceptance sentinel",
    );
    await expect(dialog.locator(".experience-number")).toHaveText("9.4/10");
    const retained = await collectAccounts(page, dialog);
    expect(retained.map(({ id }) => id).sort()).toEqual(
      research.reviews.map(({ id }) => id).sort(),
    );
    for (const review of research.reviews)
      expect(retained.some(({ href }) => href === review.url)).toBe(true);
    recover = true;
    await dialog
      .getByRole("button", { name: "Retry individual reviews" })
      .click();
    await expect(dialog.locator(".review-catalog-error")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Next accounts", exact: true }),
    ).toBeEnabled();
    await expect(dialog.locator(".experience-number")).toHaveText("9.4/10");
    await expect(dialog).not.toContainText(
      "Foreign location acceptance sentinel",
    );
  });
}
