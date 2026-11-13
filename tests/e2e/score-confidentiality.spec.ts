import { expect, test } from "@playwright/test";

const privateScoreDetails =
  /methodVersion|includedSources|excludedSources|normalizedRating|sampleDiagnostics|narrativeDiagnostics|aggregateRange|reviewSamples|sourceFamily|minimumReportedReviews|singleFamilyMinimum|weightedAverage|square root|weighted calculation|180 days|365 days|730 days|30 reported reviews from one family/i;

test("public pages, research downloads and loaded client scripts keep scoring details private", async ({
  page,
  request,
}) => {
  const scripts = new Set<string>();
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.add(response.url());
  });
  for (const path of [
    "/api/research?id=lifeplan-brooksby-village",
    "/api/research?id=cms-315066",
    "/api/reviews?id=cms-315066",
    "/api/research-coverage?market=massachusetts",
    "/api/research-coverage?market=north-jersey&format=csv",
    "/api/search?zip=02459&radius=50",
    "/api/providers?ids=lifeplan-brooksby-village,cms-315066",
  ]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(await response.text(), path).not.toMatch(privateScoreDetails);
  }
  await page.goto("/methodology");
  await expect(page.locator("#experience")).toContainText(
    "original platform averages and review counts remain visible",
  );
  await expect(page.locator("main")).not.toContainText(
    /square root|weighted|threshold|EXPERIENCE V2|scores tie|five each/i,
  );
  await page.goto("/dashboard?demo=1");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Provider or town" })
    .fill("Brooksby");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: "Brooksby Village", exact: true }),
  });
  await card
    .getByRole("button", { name: /Read \d+ reviews|Browse \d+ review links/ })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Brooksby Village",
    exact: true,
  });
  await expect(dialog.locator(".experience-overview")).toContainText(
    "44 source-reported ratings",
  );
  await dialog.locator(".experience-method summary").click();
  await expect(dialog.locator(".experience-method")).toContainText(
    "Reviewers are not independently authenticated",
  );
  await expect(dialog).not.toContainText(
    /square root|weighted calculation|Publication requirements|scores tie/i,
  );
  expect(scripts.size).toBeGreaterThan(0);
  for (const url of scripts) {
    const response = await request.get(url);
    expect(response.ok(), url).toBe(true);
    expect(await response.text(), url).not.toMatch(privateScoreDetails);
  }
});
