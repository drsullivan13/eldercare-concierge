import { chromium, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

// Use a Vercel-authorized share URL when the deployment is protected. The URL
// stays in this process; neither the share value nor cookies enter the report.
const entry = process.env.HARBOR_PREVIEW_URL;
if (!entry)
  throw new Error("Set HARBOR_PREVIEW_URL to the authorized preview URL.");
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(entry);
  const origin = new URL(page.url()).origin;
  if (origin !== new URL(entry).origin)
    throw new Error("Preview authorization did not reach the app origin.");
  await page.goto(origin);
  await expect(
    page.getByRole("link", { name: "Open your care workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Log in", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Open your care workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard\?demo=1$/);
  await expect(page.locator(".demo-banner")).toContainText(
    "Your plan stays in this browser.",
  );
  await expect(page.locator('a[href="/signup"]')).toHaveCount(0);

  // Use the browser's authenticated network path, including its proxy and
  // deployment-protection cookie, exactly as the app's own fetches do.
  async function get(path) {
    return page.evaluate(async (requestPath) => {
      const response = await fetch(requestPath);
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.json(),
      };
    }, path);
  }

  const search = await get(
    "/api/search?zip=02459&radius=10&category=nursing-home",
  );
  expect(search.status).toBe(200);
  const results = search.body;
  expect(results.catalogTotal).toBe(521);
  expect(results.providers.length).toBeGreaterThan(0);
  expect(
    results.providers.every(
      (p) => p.distanceMiles <= 10 && p.category === "nursing-home",
    ),
  ).toBe(true);
  const inspections = await get(
    `/api/evidence?ccn=${results.providers[0].cms.ccn}`,
  );
  expect(inspections.status).toBe(200);
  const homeHealth = await get("/api/home-health-evidence?providerId=vna-care");
  expect(homeHealth.status).toBe(200);
  const evidence = homeHealth.body;
  expect(
    evidence.agencies.map((a) => [
      a.ccn,
      a.patientExperience.summaryStarRating.value,
    ]),
  ).toEqual([
    ["227068", 4],
    ["227098", 3],
  ]);
  const anonymous = await get("/api/workspace");
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers["cache-control"]).toContain("no-store");

  const research = await get("/api/research?id=lifeplan-brooksby-village");
  expect(research.status).toBe(200);
  expect(research.body.experience.value).toBe(7.4);
  expect(research.body.experience.confidence).toBe("limited");
  expect(research.body.experience.reviewCount).toBe(44);
  expect(research.body.availability.status).toBe("waitlist-published");
  expect(
    research.body.facts.some(
      (f) => f.amount?.period === "one-time" && f.amount.min === 113000,
    ),
  ).toBe(true);
  const reviewed = await get(
    "/api/search?zip=02459&radius=50&category=assisted-living&evidence=reviews&sort=experience",
  );
  expect(reviewed.status).toBe(200);
  expect(reviewed.body.providers.length).toBeGreaterThan(0);
  expect(
    reviewed.body.providers.every(
      (p) => p.distanceMiles <= 50 && p.research.experience.value !== null,
    ),
  ).toBe(true);

  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  const card = page.locator("article.provider-card").first();
  await expect(card).toBeVisible();
  const name = await card.locator(".provider-title").innerText();
  await card.getByRole("button", { name: `Save ${name}`, exact: true }).click();
  await expect(
    card.getByRole("button", { name: `Remove ${name}`, exact: true }),
  ).toBeVisible();
  await page.reload();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("harbor.demo.workspace.v1")),
  );
  expect(stored.savedProviderIds.length).toBe(1);

  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await page
    .getByPlaceholder("Search by name or town")
    .fill("Sunrise of Newton");
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  const sunrise = page
    .locator("article.provider-card")
    .filter({
      has: page.getByRole("button", { name: "Sunrise of Newton", exact: true }),
    });
  await sunrise.getByRole("button", { name: "View evidence" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator(".research-tabs")
    .getByRole("button", { name: "Reviews", exact: true })
    .click();
  await expect(dialog.locator(".experience-number")).toHaveText("8.2/10");
  await dialog
    .locator(".research-tabs")
    .getByRole("button", { name: "Rooms & costs", exact: true })
    .click();
  await expect(dialog.locator(".offering-price").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();

  for (const path of ["/signup", "/login", "/dashboard"]) {
    await page.goto(origin + path);
    await expect(page).toHaveURL(/\/dashboard\?demo=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "A clearer plan",
    );
    await expect(
      page.getByRole("textbox", { name: "Email address", exact: true }),
    ).toHaveCount(0);
  }
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/hosted-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "A clearer plan",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/hosted-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  const report = {
    origin,
    checkedAt: new Date().toISOString(),
    passed: true,
    catalogTotal: results.catalogTotal,
    nursingResultsWithin10Miles: results.providers.length,
    homeHealthCcns: evidence.agencies.map((a) => a.ccn),
    locationResearch: {
      score: research.body.experience.value,
      reportedReviews: research.body.experience.reviewCount,
      availability: research.body.availability.status,
      categoryReviewResults: reviewed.body.providers.length,
      tabsVerified: true,
    },
    anonymousWorkspaceStatus: anonymous.status,
    appSignInRequired: false,
    localSaveReload: true,
    mobileOverflow: false,
    uncaughtErrors: errors,
  };
  writeFileSync("artifacts/hosted-smoke.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
