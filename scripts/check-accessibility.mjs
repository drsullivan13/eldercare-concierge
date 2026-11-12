import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const reports = [];
async function check(name) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  reports.push({
    name,
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
}
for (const path of ["/", "/signup", "/login", "/methodology"]) {
  await page.goto(base + path);
  await check(path);
}
await page.goto(base + "/dashboard?demo=1");
await page.getByRole("heading", { name: "A clearer plan." }).waitFor();
await check("overview");
await page
  .getByRole("button", { name: "Find care", exact: true })
  .first()
  .click();
await page.locator(".provider-card").first().waitFor();
await check("search");
await page.locator(".provider-card .provider-title").first().click();
await check("provider detail");
await page.getByRole("button", { name: "Close dialog", exact: true }).click();
await page
  .locator(".side-nav")
  .getByRole("button", { name: "Your plan", exact: true })
  .click();
await check("plan");
await page
  .getByRole("button", { name: "Add a next step", exact: true })
  .first()
  .click();
await check("task dialog");
await page.getByRole("button", { name: "Close dialog", exact: true }).click();
await page
  .getByRole("button", { name: "Our research standards", exact: true })
  .click();
await check("standards");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/dashboard?demo=1");
await page.getByRole("heading", { name: "A clearer plan." }).waitFor();
await check("mobile overview");
await page
  .getByRole("button", { name: "Find care", exact: true })
  .last()
  .click();
await page.locator(".provider-card").first().waitFor();
await check("mobile search");
writeFileSync("artifacts/accessibility.json", JSON.stringify(reports, null, 2));
console.log(
  JSON.stringify(
    reports.map((r) => ({
      name: r.name,
      violations: r.violations.map((v) => ({
        id: v.id,
        count: v.nodes.length,
      })),
    })),
  ),
);
await browser.close();
