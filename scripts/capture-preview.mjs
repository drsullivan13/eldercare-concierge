import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://localhost:3000/");
await page.screenshot({ path: "docs/screenshots/landing.png", fullPage: true });
await page.goto("http://localhost:3000/dashboard?demo=1");
await page.getByRole("heading", { name: "A clearer plan." }).waitFor();
await page.screenshot({
  path: "docs/screenshots/dashboard.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Find care", exact: true })
  .first()
  .click();
await page.locator(".provider-card").first().waitFor();
await page.screenshot({ path: "docs/screenshots/search.png" });
await page
  .getByRole("button", { name: "Nursing & rehabilitation", exact: true })
  .click();
await page.locator(".provider-card").first().waitFor();
await page.locator(".provider-title").first().click();
await page.locator(".inspection-history article.source-item").first().waitFor();
await page.screenshot({ path: "docs/screenshots/evidence.png" });
await page.getByRole("button", { name: "Close dialog", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://localhost:3000/dashboard?demo=1");
await page.getByRole("heading", { name: "A clearer plan." }).waitFor();
await page.screenshot({ path: "docs/screenshots/mobile.png", fullPage: true });
console.log(JSON.stringify({ screenshots: 5, uncaughtErrors: errors }));
await browser.close();
