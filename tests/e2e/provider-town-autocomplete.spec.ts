import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openFilters(page: Page) {
  await page.goto("/dashboard?demo=1");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const input = page.getByRole("combobox", {
    name: "Provider or town",
    exact: true,
  });
  await input.focus();
  await expect(input).toHaveAttribute("aria-describedby", /-hint$/);
  await expect(input).toBeFocused();
  return input;
}

test("real nearby suggestions support keyboard selection and optional free text", async ({
  page,
}) => {
  const input = await openFilters(page);
  await input.fill("cha");
  const town = page.getByRole("option", {
    name: "Chatham Town · NJ",
    exact: true,
  });
  await expect(town).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", /.+/);
  await input.press("Enter");
  await expect(input).toHaveValue("Chatham");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Apply filters", exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: "SUNRISE OF LIVINGSTON", exact: true }),
  ).toHaveCount(0);
  await input.fill("SUNRISE OF LIV");
  const provider = page.getByRole("option", {
    name: /Sunrise of Livingston.*Provider/i,
  });
  await expect(provider).toBeVisible();
  if (test.info().project.name.startsWith("mobile")) await provider.tap();
  else await provider.click();
  await expect(input).toHaveValue("SUNRISE OF LIVINGSTON");

  await input.fill("No such provider 5f9ac77");
  await expect(
    page.getByRole("status").filter({ hasText: "No nearby suggestions" }),
  ).toHaveCount(1);
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(input).toBeFocused();
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("q") === "No such provider 5f9ac77"
    );
  });
  await input.press("Enter");
  expect((await responsePromise).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "No matching options in this search." }),
  ).toBeVisible();
});

test("rapid edits debounce and ignore a superseded response", async ({
  page,
}) => {
  let requestCount = 0;
  let release: () => void = () => {};
  let firstStarted: () => void = () => {};
  let firstFinished: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    firstFinished = resolve;
  });
  await page.route("**/api/search-suggestions?**", async (route) => {
    requestCount++;
    if (new URL(route.request().url()).searchParams.get("q") === "sun") {
      firstStarted();
      await held;
      try {
        await route.fulfill({
          json: {
            suggestions: [
              {
                id: "stale",
                kind: "provider",
                value: "Stale Sunrise",
                detail: "Old response",
              },
            ],
          },
        });
      } finally {
        firstFinished();
      }
    } else await route.continue();
  });
  const input = await openFilters(page);
  await input.fill("s");
  await input.fill("su");
  await input.fill("sun");
  await started;
  expect(requestCount).toBe(1);
  await input.fill("cha");
  await expect(
    page.getByRole("option", { name: "Chatham Town · NJ", exact: true }),
  ).toBeVisible();
  release();
  await finished;
  await expect(page.getByRole("option", { name: /Stale Sunrise/ })).toHaveCount(
    0,
  );
  await expect(input).toHaveValue("cha");
});

test("a changed ZIP cancels pending suggestions for the old geography", async ({
  page,
}) => {
  let release: () => void = () => {};
  let oldStarted: () => void = () => {};
  let oldFinished: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    oldStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    oldFinished = resolve;
  });
  await page.route("**/api/search-suggestions?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("zip") === "07928") {
      oldStarted();
      await held;
      try {
        await route.fulfill({
          json: {
            suggestions: [
              {
                id: "old-town",
                kind: "town",
                value: "Old geography",
                detail: "NJ",
              },
            ],
          },
        });
      } finally {
        oldFinished();
      }
    } else await route.continue();
  });
  const input = await openFilters(page);
  await input.fill("new");
  await started;
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await input.focus();
  await expect(
    page.getByRole("option", { name: "Newton Town · MA", exact: true }),
  ).toBeVisible();
  release();
  await finished;
  await expect(page.getByRole("option", { name: /Old geography/ })).toHaveCount(
    0,
  );
});

test("empty text and invalid scope stay editable without stale options", async ({
  page,
}) => {
  const input = await openFilters(page);
  await input.fill("cha");
  await expect(
    page.getByRole("option", { name: "Chatham Town · NJ", exact: true }),
  ).toBeVisible();
  await input.fill("");
  await expect(page.getByRole("listbox")).toBeHidden();
  await input.fill("c");
  await expect(page.getByRole("listbox")).toBeHidden();
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("bad");
  await input.fill("Chatham");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(input).toHaveValue("Chatham");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await input.focus();
  await expect(
    page.getByRole("status").filter({ hasText: "No nearby suggestions" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "Chatham Town · NJ", exact: true }),
  ).toHaveCount(0);
});

test("network and malformed-response failures retain free text and recover on the next query", async ({
  page,
}) => {
  let mode: "offline" | "malformed" | "real" = "offline";
  await page.route("**/api/search-suggestions?**", async (route) => {
    if (mode === "offline") await route.abort();
    else if (mode === "malformed")
      await route.fulfill({
        json: { suggestions: [{ value: "wrong shape" }] },
      });
    else await route.continue();
  });
  const input = await openFilters(page);
  await input.fill("some free text");
  await expect(
    page.getByRole("status").filter({ hasText: "Suggestions unavailable" }),
  ).toHaveCount(1);
  await expect(input).toHaveValue("some free text");
  mode = "malformed";
  await input.fill("another query");
  await expect(
    page.getByRole("status").filter({ hasText: "Suggestions unavailable" }),
  ).toHaveCount(1);
  await expect(input).toHaveValue("another query");
  mode = "real";
  await input.fill("cha");
  await expect(
    page.getByRole("option", { name: "Chatham Town · NJ", exact: true }),
  ).toBeVisible();
});

test("popup fits the viewport, options have touch targets, and the field passes accessibility checks", async ({
  page,
}) => {
  const input = await openFilters(page);
  await input.fill("cha");
  const option = page.getByRole("option", {
    name: "Chatham Town · NJ",
    exact: true,
  });
  await expect(option).toBeVisible();
  const bounds = await option.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  const list = await page.getByRole("listbox").boundingBox();
  expect(list!.x).toBeGreaterThanOrEqual(0);
  expect(list!.x + list!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const results = await new AxeBuilder({ page })
    .include("#search-filters")
    .analyze();
  expect(results.violations).toEqual([]);
  await input.press("Tab");
  await expect(input).not.toBeFocused();
  await expect(page.getByRole("listbox")).toBeHidden();
});
