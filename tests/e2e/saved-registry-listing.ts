import { expect, type Page } from "@playwright/test";
import type { Workspace } from "../../src/lib/workspace";

// A saved registry listing can still be opened when its mailing-only address
// has no coordinates for a radius search.
export async function openSavedRegistryListing(
  page: Page,
  id: string,
  name: string,
) {
  const workspace: Workspace = {
    profile: {
      name: "Care circle",
      relationship: "A parent",
      zip: "07632",
      careTypes: [],
    },
    savedProviderIds: [id],
    notes: {},
    tasks: [],
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  await page.addInitScript((state) => {
    localStorage.setItem("harbor.demo.workspace.v1", JSON.stringify(state));
  }, workspace);
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name: /^Your shortlist/ })
    .click();
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  return dialog;
}
