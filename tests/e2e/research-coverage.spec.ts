import { test, expect } from "@playwright/test";

test("research filters expose Facebook findings and score gaps, with a complete catalog checklist", async ({
  page,
  request,
}) => {
  await page.goto("/dashboard?demo=1");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  const filter = page.getByRole("combobox", { name: "Research filter" });
  await expect(filter).toBeVisible();
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("evidence") === "facebook",
  );
  await filter.selectOption("facebook");
  const result = await (await response).json();
  expect(result.total).toBeGreaterThan(0);
  await expect(page.locator("article.provider-card")).toHaveCount(result.total);
  for (const card of await page.locator("article.provider-card").all())
    await expect(card).toContainText("Facebook findings");
  await expect(page.getByLabel("Experience research coverage")).toContainText(
    `${result.total} locations with Facebook findings`,
  );
  const unrated = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("evidence") === "unrated",
  );
  await filter.selectOption("unrated");
  await unrated;
  await expect(page.locator(".experience-card-score")).toHaveCount(0);
  await expect(page.locator(".experience-card-unrated").first()).toContainText(
    "Not enough evidence to score",
  );
  await page.getByText("Research coverage & method", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download catalog research checklist" })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /^harbor-experience-research-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const coverage = await (await request.get("/api/research-coverage")).json();
  expect(coverage.total).toBe(521);
  expect(coverage.scored + coverage.unscored).toBe(521);
  expect(coverage.facebookCovered).toBe(22);
  expect(coverage.facebookWithFindings).toBe(10);
  expect(
    coverage.locations.filter((r: { score: number | null }) => r.score !== null)
      .length,
  ).toBe(coverage.scored);
});
