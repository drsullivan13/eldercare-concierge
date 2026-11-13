import { test, expect, type Locator, type Page } from "@playwright/test";

async function openProfile(page: Page, zip: string, name: string) {
  await page.goto("/dashboard?demo=1");
  await page.getByLabel("Search ZIP code").fill(zip);
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page.locator(".quick-search button[type=submit]").click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Provider or town").fill(name);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page
    .locator(".provider-card")
    .filter({ hasText: name })
    .first()
    .locator(".provider-title")
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  return dialog;
}

async function expectPaneStart(dialog: Locator, name: string) {
  const tab = dialog.getByRole("tab", { name, exact: true });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const panel = dialog.getByRole("tabpanel", { name, exact: true });
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate((element) => {
        const header = element
          .closest("dialog")!
          .querySelector(".profile-top")!;
        const heading = element.querySelector("h3, h4")!;
        return (
          heading.getBoundingClientRect().top -
          header.getBoundingClientRect().bottom
        );
      }),
    )
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBe(0);
}

async function readDeeply(dialog: Locator) {
  await dialog.evaluate((element) => {
    element.scrollTop = 600;
  });
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(200);
}

async function clickInPlace(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test("profile tab switches reveal the pane start by click and keyboard after deep reading", async ({
  page,
}) => {
  const dialog = await openProfile(page, "07960", "Victoria Mews");
  for (const name of ["Overview", "Costs & perks", "Reviews", "Details"]) {
    await dialog.getByRole("tab", { name, exact: true }).click();
    if (name === "Reviews")
      await expect(
        dialog.locator(".public-reviews article").first(),
      ).toBeVisible();
    await expectPaneStart(dialog, name);
  }

  await dialog.getByRole("tab", { name: "Costs & perks", exact: true }).click();
  await readDeeply(dialog);
  const before = await dialog.evaluate((element) => element.scrollTop);
  await clickInPlace(
    page,
    dialog.getByRole("tab", { name: "Costs & perks", exact: true }),
  );
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(before);
  await dialog
    .getByRole("button", { name: "Save to shortlist", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Shortlisted", exact: true }),
  ).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(before);
  await dialog.getByRole("tab", { name: "Details", exact: true }).click();
  await expectPaneStart(dialog, "Details");

  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(dialog.locator(".public-reviews article").first()).toBeVisible();
  await readDeeply(dialog);
  await dialog
    .getByRole("tab", { name: "Reviews", exact: true })
    .evaluate((element) =>
      (element as HTMLElement).focus({ preventScroll: true }),
    );
  await page.keyboard.press("End");
  await expect(
    dialog.getByRole("tab", { name: "Details", exact: true }),
  ).toBeFocused();
  await expectPaneStart(dialog, "Details");
  await page.keyboard.press("Home");
  await expect(
    dialog.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeFocused();
  await expectPaneStart(dialog, "Overview");
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("tab", { name: "Costs & perks", exact: true }),
  ).toBeFocused();
  await expectPaneStart(dialog, "Costs & perks");
  await readDeeply(dialog);
  await dialog
    .getByRole("tab", { name: "Costs & perks", exact: true })
    .evaluate((element) =>
      (element as HTMLElement).focus({ preventScroll: true }),
    );
  await page.keyboard.press("ArrowLeft");
  await expect(
    dialog.getByRole("tab", { name: "Overview", exact: true }),
  ).toBeFocused();
  await expectPaneStart(dialog, "Overview");
});

test("profile tabs retain original price conditions and review concerns", async ({
  page,
}) => {
  const dialog = await openProfile(page, "02459", "Brooksby Village");
  const overview = dialog.getByRole("tab", { name: "Overview", exact: true });
  const monthly = dialog.locator(".fact-cost").filter({
    hasText: "Independent-living studio Monthly Service Package",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await dialog
      .getByRole("tab", { name: "Costs & perks", exact: true })
      .click();
    await expectPaneStart(dialog, "Costs & perks");
    for (const summary of await dialog
      .locator(".offering-more > summary")
      .all())
      await summary.click();
    await expect(monthly).toBeVisible();
    await expect(monthly).toContainText("schedule changes January 1, 2027");
    const atPrice = await dialog.evaluate((element) => element.scrollTop);
    await clickInPlace(
      page,
      dialog.getByRole("tab", { name: "Costs & perks", exact: true }),
    );
    expect(await dialog.evaluate((element) => element.scrollTop)).toBe(atPrice);
    await overview.click();
    await expectPaneStart(dialog, "Overview");
  }
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expectPaneStart(dialog, "Reviews");
  const account = dialog.locator(".public-reviews article").filter({
    hasText: "The food is generally awful.",
  });
  await expect(account.locator("blockquote")).toHaveText(
    "“The food is generally awful.”",
  );
  await expect(account.locator(".review-concern")).toBeVisible();
  await overview.click();
  await expectPaneStart(dialog, "Overview");
});
