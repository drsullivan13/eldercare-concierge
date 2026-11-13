import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createEmptyWorkspace } from "../../src/lib/workspace";

const href = "/dashboard?demo=1&compareDemo=morris-plains-florham-park";
const ids = ["north-jersey-doh-nj13a012", "north-jersey-doh-nj60a001"];
const names = [
  "ARBOR TERRACE MORRIS PLAINS",
  "BRIGHTON GARDENS OF FLORHAM PARK",
];
const key = "harbor.demo.workspace.v1";
const savedIds = ["north-jersey-doh-nj5a004", "north-jersey-doh-nj25284"];

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("#workspace-navigation")
    .getByRole("button", { name: new RegExp(`^${name}(?: \\d+)?$`) })
    .click();
}

async function expectPair(dialog: Locator) {
  await expect(
    dialog.getByRole("button", { name: names[0], exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: names[1], exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: `${names[0]}, published prices` }),
  ).toContainText("$6,915");
  await expect(
    dialog.getByRole("group", { name: `${names[1]}, published prices` }),
  ).toContainText("$4,500");
  await expect(
    dialog
      .getByRole("region", { name: "Places comparison" })
      .locator("blockquote"),
  ).toHaveCount(2);
}

test("the keyboard demo preserves shortlist and manual selections and drills into the exact provider", async ({
  page,
}) => {
  const workspace = createEmptyWorkspace();
  workspace.profile.zip = "07928";
  workspace.savedProviderIds = savedIds;
  workspace.notes[savedIds[0]] = "Keep this family note.";
  await page.addInitScript(
    ({ key, workspace }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(workspace));
    },
    { key, workspace },
  );
  await page.goto("/dashboard?demo=1");
  const entry = page.getByRole("link", { name: "Open North Jersey demo" });
  await expect(entry).toHaveAttribute("href", href);
  await navigate(page, "Your shortlist");
  const choices = page.getByRole("checkbox", { name: /^Compare / });
  await expect(choices).toHaveCount(2);
  await choices.nth(0).check();
  await choices.nth(1).check();
  await navigate(page, "Overview");
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  const lookup = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/providers" &&
      url.searchParams.get("ids") === ids.join(",")
    );
  });
  await entry.focus();
  await page.keyboard.press("Enter");
  const request = await lookup;
  expect(new URL(request.url()).searchParams.get("market")).toBe(
    "north-jersey",
  );
  await expect(page).toHaveURL(href);
  const dialog = page.getByRole("dialog", {
    name: "North Jersey comparison demo",
  });
  await expectPair(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  await navigate(page, "Your shortlist");
  await expect(choices.nth(0)).toBeChecked();
  await expect(choices.nth(1)).toBeChecked();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const manual = page.getByRole("dialog", {
    name: "Compare places",
    exact: true,
  });
  await expect(
    manual.getByRole("button", { name: "BROOKDALE EMERSON", exact: true }),
  ).toBeVisible();
  await expect(
    manual.getByRole("button", { name: names[0], exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await navigate(page, "Overview");
  await entry.click();
  await expectPair(dialog);
  await dialog.getByRole("button", { name: names[0], exact: true }).click();
  const provider = page.getByRole("dialog", { name: names[0], exact: true });
  await expect(provider).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(
    provider.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
});

test("a shared URL reloads the exact pair with bounded mobile overflow and accessible controls", async ({
  page,
}) => {
  await page.goto(href);
  const dialog = page.getByRole("dialog", {
    name: "North Jersey comparison demo",
  });
  await expectPair(dialog);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.reload();
  await expectPair(dialog);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  const widths = await dialog.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
    viewport: window.innerWidth,
    outer: element.getBoundingClientRect().width,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.width + 1);
  expect(widths.outer).toBeLessThanOrEqual(widths.viewport);
  const results = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByRole("button", { name: "Close dialog" }).focus();
  await page.keyboard.press("Tab");
  // Chrome can visit browser chrome at the boundary of a native modal. The
  // next tab stop must wrap inside the dialog, never into the dashboard.
  if (await page.evaluate(() => document.activeElement === document.body))
    await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  const entry = page.getByRole("link", { name: "Open North Jersey demo" });
  await expect(entry).toBeFocused();
  await expect(page).toHaveURL("/dashboard?demo=1");
  await entry.click();
  await expectPair(dialog);
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await page.goForward();
  await expectPair(dialog);
});

for (const failure of ["http", "missing", "wrong-pair", "malformed"] as const) {
  test(`demo ${failure} failure never opens a partial pair and can retry`, async ({
    page,
  }) => {
    let fail = true;
    await page.route("**/api/providers?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("ids") !== ids.join(",") || !fail) {
        await route.continue();
        return;
      }
      if (failure === "http") {
        await route.fulfill({ status: 503, json: { error: "Unavailable" } });
      } else if (failure === "missing") {
        await route.fulfill({ json: { providers: [] } });
      } else if (failure === "malformed") {
        await route.fulfill({ json: { providers: {} } });
      } else {
        const response = await route.fetch({
          url: `${url.origin}/api/providers?ids=${savedIds.join(",")}`,
        });
        await route.fulfill({ response });
      }
    });
    await page.goto("/dashboard?demo=1");
    await expect(
      page.getByRole("link", { name: "Open North Jersey demo" }),
    ).toBeVisible();
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.getByRole("link", { name: "Open North Jersey demo" }).click();
    const dialog = page.getByRole("dialog", {
      name: "North Jersey comparison demo",
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "Could not load both",
    );
    await expect(
      dialog.getByRole("region", { name: "Places comparison" }),
    ).toHaveCount(0);
    fail = false;
    await dialog.getByRole("button", { name: "Retry demo" }).click();
    await expectPair(dialog);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
  });
}

test("a comparison shows Chatham Hills' readable account and separates the staff perspective", async ({
  page,
  request,
}) => {
  const catalog = await (
    await request.get("/api/reviews?id=cms-315120")
  ).json();
  const readable = catalog.accounts.find(
    (account: {
      relationship: string;
      representation: string;
      summary: string;
    }) =>
      account.relationship !== "staff" &&
      account.representation === "original-summary" &&
      account.summary,
  );
  expect(readable).toBeTruthy();
  const workspace = createEmptyWorkspace();
  workspace.profile.zip = "07928";
  workspace.savedProviderIds = ["cms-315120", ids[0]];
  await page.addInitScript(
    ({ key, workspace }) =>
      localStorage.setItem(key, JSON.stringify(workspace)),
    { key, workspace },
  );
  await page.goto("/dashboard?demo=1");
  await navigate(page, "Your shortlist");
  const choices = page.getByRole("checkbox", { name: /^Compare / });
  await expect(choices).toHaveCount(2);
  await choices.nth(0).check();
  await choices.nth(1).check();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const cell = page.getByRole("group", {
    name: /chatham hills.*a review insight/i,
  });
  await expect(cell).toContainText(readable.summary);
  await expect(cell.getByRole("link").first()).toHaveAttribute(
    "href",
    readable.url,
  );
  await expect(
    cell.locator("details").filter({ hasText: "Staff perspective" }),
  ).not.toHaveAttribute("open", "");
});
