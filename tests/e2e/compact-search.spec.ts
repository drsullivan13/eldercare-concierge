import { expect, test } from "@playwright/test";
import type { CompactSearchResponse } from "../../src/lib/providers";

test("compact results retain every map option while cards paginate and retry", async ({
  page,
}) => {
  let first: CompactSearchResponse | undefined;
  let secondAttempts = 0;
  await page.route("**/api/search?*", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("response")).toBe("compact");
    expect(url.searchParams.get("pageSize")).toBe("18");
    if (url.searchParams.get("page") === "2" && ++secondAttempts === 1) {
      return route.fulfill({
        status: 503,
        json: { error: "More options unavailable" },
      });
    }
    const response = await route.fetch();
    if (url.searchParams.get("page") === "1") first = await response.json();
    await route.fulfill({ response });
  });
  await page.goto("/dashboard?demo=1");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find in-home care", exact: true })
    .click();
  const cards = page.locator(".care-search-view .provider-card");
  await expect(cards).toHaveCount(18);
  expect(first?.pagination.hasMore).toBe(true);
  expect(first?.markers?.length).toBe(first?.total);
  const initial = await cards.allTextContents();
  await page.getByRole("radio", { name: "Map view", exact: true }).click();
  const located = first!.markers!.filter(
    (marker) => marker.lat !== null && marker.lng !== null,
  );
  // The radius and searched ZIP add two paths ahead of the complete marker set.
  const paths = page.locator(".care-map .leaflet-interactive");
  await expect(paths).toHaveCount(located.length + 2);
  const marker = located.find(
    (item) => !first!.providers.some((provider) => provider.id === item.id),
  )!;
  const hydration = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/providers" &&
      new URL(response.url()).searchParams.get("ids") === marker.id,
  );
  await paths.nth(located.indexOf(marker) + 2).dispatchEvent("click");
  await hydration;
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: marker.name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog" })
    .click();
  await page
    .getByRole("button", { name: "Show more options", exact: true })
    .click();
  await expect(
    page.locator(".care-search-view").getByRole("alert"),
  ).toContainText("More options unavailable");
  await expect(cards).toHaveText(initial);
  await page
    .getByRole("button", { name: "Show more options", exact: true })
    .click();
  await expect(cards).toHaveCount(Math.min(36, first!.total));
  expect(secondAttempts).toBe(2);
  const displayed = await cards.allTextContents();
  expect(new Set(displayed).size).toBe(displayed.length);
});

test("changing sort cancels a pending card page without appending stale options", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pageRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    pageRequested = resolve;
  });
  await page.route("**/api/search?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("page") !== "2")
      return route.continue();
    const response = await route.fetch();
    pageRequested();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/dashboard?demo=1");
    await page
      .locator("form.quick-search")
      .getByRole("button", { name: "Find in-home care", exact: true })
      .click();
    const cards = page.locator(".care-search-view .provider-card");
    await expect(cards).toHaveCount(18);
    await page
      .getByRole("button", { name: "Show more options", exact: true })
      .click();
    await requested;
    await page
      .getByRole("combobox", { name: "Sort results" })
      .selectOption("experience");
    await expect(cards).toHaveCount(18);
    const sorted = await cards.allTextContents();
    release();
    await expect(cards).toHaveText(sorted);
    await expect(
      page.getByRole("button", { name: "Show more options", exact: true }),
    ).toBeEnabled();
  } finally {
    release();
  }
});

test("opening a card cancels slower off-page map details", async ({ page }) => {
  let first!: CompactSearchResponse;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const lookup = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let completed!: () => void;
  const completion = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route("**/api/search?*", async (route) => {
    const response = await route.fetch();
    first = await response.json();
    await route.fulfill({ response });
  });
  await page.route("**/api/providers?*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("market"))
      return route.continue();
    const response = await route.fetch();
    requested();
    await pending;
    await route.fulfill({ response });
    completed();
  });
  try {
    await page.goto("/dashboard?demo=1");
    await page
      .locator("form.quick-search")
      .getByRole("button", { name: "Find in-home care", exact: true })
      .click();
    const cards = page.locator(".care-search-view .provider-card");
    await expect(cards).toHaveCount(18);
    await page.getByRole("radio", { name: "Map view", exact: true }).click();
    const located = first.markers!.filter(
      (marker) => marker.lat !== null && marker.lng !== null,
    );
    const marker = located.find(
      (item) => !first.providers.some((provider) => provider.id === item.id),
    )!;
    const paths = page.locator(".care-map .leaflet-interactive");
    await expect(paths).toHaveCount(located.length + 2);
    await paths.nth(located.indexOf(marker) + 2).dispatchEvent("click");
    await lookup;
    const cardName = await cards.first().locator(".provider-title").innerText();
    await cards
      .first()
      .getByRole("button", { name: "View details", exact: true })
      .click();
    const selected = page
      .getByRole("dialog")
      .getByRole("heading", { name: cardName, exact: true });
    await expect(selected).toBeVisible();
    release();
    await completion;
    await expect(selected).toBeVisible();
  } finally {
    release();
  }
});
