import { test, expect } from "@playwright/test";
import type { SearchResponse } from "../../src/lib/providers";

test("experience ranking requires a care type and keeps clinical quality separate", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1");
  await page
    .getByRole("region", { name: "Search nearby care" })
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  const sort = page.getByRole("combobox", { name: "Sort results" });
  await sort.selectOption("experience");
  const prompt = page.getByRole("region", {
    name: "Choose a care type to rank by experience",
  });
  await expect(prompt).toContainText("not clinical quality or safety");
  await expect(sort).toHaveValue("distance");
  await expect(
    prompt.getByRole("combobox", { name: "Care type for experience" }),
  ).toBeFocused();
  await prompt.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(prompt).toHaveCount(0);
  await expect(sort).toHaveValue("distance");
  await sort.selectOption("experience");
  const response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("sort") === "experience" &&
      url.searchParams.get("category") === "assisted-living"
    );
  });
  await prompt
    .getByRole("combobox", { name: "Care type for experience" })
    .selectOption("assisted-living");
  const result: SearchResponse = await (await response).json();
  expect(result.total).toBeGreaterThan(0);
  expect(
    result.providers.every(
      (provider) => provider.category === "assisted-living",
    ),
  ).toBe(true);
  await expect(prompt).toHaveCount(0);
  await expect(sort).toHaveValue("experience");
  await expect(page.locator(".search-summary")).toContainText(
    "Assisted living",
  );
  await expect(page.locator("article.provider-card")).toHaveCount(
    Math.min(18, result.total),
  );
});

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
  await expect(filter).not.toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(filter).toBeVisible();
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("evidence") === "facebook",
  );
  await filter.selectOption("facebook");
  await page.getByRole("button", { name: "Apply filters" }).click();
  const result = await (await response).json();
  expect(result.total).toBeGreaterThan(0);
  await expect(page.locator("article.provider-card")).toHaveCount(result.total);
  for (const card of await page.locator("article.provider-card").all())
    await expect(card).toContainText(
      /Facebook findings|Facebook threads? with resident or family accounts/,
    );
  await page.getByText("Sources & evidence", { exact: true }).click();
  await page.getByText("Research coverage & method", { exact: true }).click();
  await expect(page.getByLabel("Experience research coverage")).toContainText(
    `${result.total} locations with Facebook findings`,
  );
  const unrated = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("evidence") === "unrated",
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await filter.selectOption("unrated");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await unrated;
  await expect(page.locator(".experience-card-score")).toHaveCount(0);
  await expect(page.locator(".experience-card-unrated").first()).toContainText(
    "Not enough evidence to score",
  );
  await page.getByText("Sources & evidence", { exact: true }).click();
  await page.getByText("Research coverage & method", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download catalog research checklist" })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /^harbor-experience-research-massachusetts-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const coverage = await (
    await request.get("/api/research-coverage?market=massachusetts")
  ).json();
  expect(coverage.market.id).toBe("massachusetts");
  expect(coverage.total).toBe(521);
  expect(coverage.scored + coverage.unscored).toBe(521);
  expect(coverage.facebookCovered).toBe(22);
  expect(coverage.facebookWithFindings).toBe(10);
  expect(
    coverage.locations.filter((r: { score: number | null }) => r.score !== null)
      .length,
  ).toBe(coverage.scored);
});
