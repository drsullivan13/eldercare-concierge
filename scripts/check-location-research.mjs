import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch();
const reports = [];
mkdirSync("artifacts", { recursive: true });
mkdirSync("docs/screenshots", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(base + "/dashboard?demo=1");
    await page
      .getByRole("combobox", { name: "Search radius" })
      .selectOption("50");
    await page
      .locator("form.quick-search")
      .getByRole("button", { name: "Find care" })
      .click();
    await page.getByPlaceholder("Search by name or town").fill("Brooksby");
    await page
      .locator("form.research-search")
      .getByRole("button", { name: "Search", exact: true })
      .click();
    const card = page.locator("article.provider-card").filter({
      has: page.getByRole("button", {
        name: "Brooksby Village",
        exact: true,
      }),
    });
    await card.getByRole("button", { name: "View details" }).click();
    const dialog = page.getByRole("dialog");
    for (const name of [
      "Life here",
      "Rooms & costs",
      "Availability",
      "Reviews",
    ]) {
      await dialog
        .locator(".research-tabs")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(dialog.locator(".research-panel")).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      reports.push({
        width,
        section: name,
        violations: result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      });
      await dialog.locator(".research-tabs").scrollIntoViewIfNeeded();
      if (name === "Reviews" || name === "Rooms & costs") {
        await page.screenshot({
          path: `docs/screenshots/${name === "Reviews" ? "reviews" : "rooms-costs"}-${width}.png`,
        });
      }
      await dialog.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(
        dialog.getByRole("button", { name: "Close dialog" }),
      ).toBeInViewport();
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
    await context.close();
  }
  writeFileSync(
    "artifacts/location-research-accessibility.json",
    JSON.stringify(reports, null, 2),
  );
  console.log(JSON.stringify(reports));
  if (reports.some((r) => r.violations.length)) process.exitCode = 1;
} finally {
  await browser.close();
}
