import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

const SDK_MODULE = /node_modules\/@ui-sdk|ui-sdk\.toast@1/;
const TOAST_MODULE = /ui-sdk\.toast@1/;
const TABS_MODULE = /createTabsController/;
const NAV_MENU_MODULE = /createNavigationMenuController/;

function sameOriginScript(request: Request) {
  if (request.resourceType() !== "script") return "";
  const url = new URL(request.url());
  const base = new URL(
    test.info().project.use.baseURL ?? "http://127.0.0.1:3000",
  );
  return url.origin === base.origin ? `${url.pathname}${url.search}` : "";
}

async function scriptText(page: Page, path: string) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.ok ? response.text() : "";
  }, path);
}

async function openDashboard(page: Page) {
  const paths = new Set<string>();
  page.on("response", (response) => {
    const path = sameOriginScript(response.request());
    if (path && response.ok()) paths.add(path);
  });
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const initialPaths = [...paths];
  expect(initialPaths.length).toBeGreaterThan(0);
  const joined = async (next: string[]) =>
    (
      await Promise.all(
        next.map((path) =>
          Promise.race([
            scriptText(page, path),
            new Promise<string>((_, reject) =>
              setTimeout(
                () => reject(new Error(`script body unread: ${path}`)),
                5_000,
              ),
            ),
          ]),
        ),
      )
    ).join("\n");
  return {
    initial: await joined(initialPaths),
    addedSince(before: number) {
      return joined([...paths].slice(before));
    },
    count: () => paths.size,
  };
}

async function reachableTabbableCount(root: Locator) {
  return root
    .locator("a, button, input, select, textarea, summary")
    .evaluateAll(
      (elements) =>
        elements.filter((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const onScreen =
            box.right > 0 &&
            box.bottom > 0 &&
            box.left < window.innerWidth &&
            box.top < window.innerHeight;
          return (
            element.tabIndex >= 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            box.width > 0 &&
            box.height > 0 &&
            onScreen
          );
        }).length,
    );
}

async function focusedControl(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      visible:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        box.width > 0 &&
        box.height > 0,
      inSidebar: Boolean(element.closest("aside.sidebar")),
      inMain: Boolean(element.closest(".app-main")),
      mainInert:
        document.querySelector(".app-main")?.hasAttribute("inert") ?? false,
    };
  });
}

test("fresh dashboard defers the toast SDK until a plan notification", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "Initial script contract is checked once on desktop",
  );
  const session = await openDashboard(page);
  expect(session.initial).not.toMatch(SDK_MODULE);

  const beforeDialog = session.count();
  await page.getByRole("button", { name: "Your workspace" }).click();
  const profile = page.getByRole("dialog", { name: "Your care workspace" });
  await expect(profile).toBeVisible();
  await expect(profile).toHaveJSProperty("open", true);
  await page.keyboard.press("Escape");
  await expect(profile).toBeHidden();
  expect(await session.addedSince(beforeDialog)).not.toMatch(SDK_MODULE);

  await page.getByRole("button", { name: "Your plan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /One less thing/ }),
  ).toBeVisible();
  const beforeTask = session.count();
  await page.locator(".plan-suggestions > summary").click();
  await page
    .getByRole("button", { name: "Agree on a family update routine" })
    .click();
  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications).toBeVisible();
  await expect(notifications).toContainText("Added to your plan");
  await expect.poll(() => session.addedSince(beforeTask)).toMatch(TOAST_MODULE);
  const loaded = await session.addedSince(beforeTask);
  expect(loaded).not.toMatch(TABS_MODULE);
  expect(session.initial).not.toMatch(TOAST_MODULE);
});

test.describe("mobile native navigation", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-390",
      "Mobile keyboard contract",
    );
  });

  test("keeps the closed sidebar out of tab order and restores the menu opener", async ({
    page,
  }) => {
    const session = await openDashboard(page);
    const menu = page.getByRole("button", { name: "Open navigation" });
    const sidebar = page.locator("aside.sidebar");
    await expect(menu).toBeVisible();
    await expect(sidebar).not.toBeInViewport();
    expect(await reachableTabbableCount(sidebar)).toBe(0);

    const beforeMenu = session.count();
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(sidebar).toBeInViewport();
    const opened = await focusedControl(page);
    expect(opened?.inSidebar).toBe(true);
    expect(opened?.visible).toBe(true);
    expect(await reachableTabbableCount(sidebar)).toBeGreaterThan(0);
    expect(session.initial).not.toMatch(NAV_MENU_MODULE);
    expect(await session.addedSince(beforeMenu)).not.toMatch(NAV_MENU_MODULE);

    await page.keyboard.press("Escape");
    await expect(sidebar).not.toBeInViewport();
    await expect(menu).toBeFocused();
    expect(await reachableTabbableCount(sidebar)).toBe(0);

    await page.keyboard.press("Enter");
    await expect(sidebar).toBeInViewport();
    await sidebar.getByRole("button", { name: "Close menu" }).click();
    await expect(sidebar).not.toBeInViewport();
    await expect(menu).toBeFocused();
  });

  test("moves from the menu to Your plan and back through the profile dialog", async ({
    page,
  }) => {
    await openDashboard(page);
    const menu = page.getByRole("button", { name: "Open navigation" });
    const sidebar = page.locator("aside.sidebar");
    await menu.focus();
    await page.keyboard.press("Enter");
    await sidebar.getByRole("button", { name: "Your plan" }).focus();
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { name: /One less thing/ });
    await expect(sidebar).not.toBeInViewport();
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();

    await menu.focus();
    await page.keyboard.press("Enter");
    await sidebar.getByRole("button", { name: "Your workspace" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Your care workspace" });
    await expect(dialog).toBeVisible();
    await expect(sidebar).not.toBeInViewport();
    await expect
      .poll(async () => {
        await page.getByRole("button", { name: "Open navigation" }).focus();
        return dialog.evaluate((element) =>
          element.contains(document.activeElement),
        );
      })
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeVisible();
    await expect(menu).toBeFocused();
  });

  test("does not strand focus when an open menu becomes the desktop sidebar", async ({
    page,
  }) => {
    await openDashboard(page);
    const menu = page.getByRole("button", { name: "Open navigation" });
    const sidebar = page.locator("aside.sidebar");
    const close = sidebar.getByRole("button", { name: "Close menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(sidebar).toBeInViewport();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(menu).toBeHidden();
    await expect(close).toBeHidden();
    await expect
      .poll(() => focusedControl(page), { timeout: 2_000 })
      .toMatchObject({ visible: true, inSidebar: true, mainInert: false });
    const focused = await focusedControl(page);
    expect(focused?.tag).not.toBe("BODY");
    expect(focused?.tag).not.toBe("HTML");
    await page.keyboard.press("Tab");
    const next = await focusedControl(page);
    expect(next?.visible).toBe(true);
    expect(next?.tag).not.toBe("BODY");
    expect(next?.tag).not.toBe("HTML");
  });
});
