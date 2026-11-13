import { expect, test } from "@playwright/test";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";
import type { SearchResponse } from "../../src/lib/providers";
import acquisition from "../../research/north-jersey/experience-acquisition/integration/approved-batches.json";

const approvals = acquisition.batches.flatMap((batch) => batch.approvals);

test("new exact-unit aggregates reach public research and full-region coverage", async ({
  request,
}) => {
  for (const approval of approvals) {
    const { providerId, aggregate: published } = approval;
    const response = await request.get(`/api/research?id=${providerId}`);
    expect(response.ok(), String(providerId)).toBe(true);
    const research: LocationResearchResponse = await response.json();
    const sourceId = `review-release-${approval.id}`;
    const aggregate = research.reviewAggregates.find(
      (a) => a.sourceId === sourceId,
    );
    expect(aggregate).toMatchObject({
      rating: published.rating,
      scale: 5,
      count: published.count,
      scope: "consumer",
      asOf: null,
    });
    expect(research.sources.find((s) => s.id === sourceId)).toMatchObject({
      url: approval.url,
      checkedAt: approval.checkedAt,
      access: "full-page",
    });
    expect(research.experience).toMatchObject({
      value: published.rating * 2,
      reviewCount: published.count,
      independentSourceCount: 1,
      confidence: "limited",
    });
    expect(research).not.toHaveProperty("reviewSamples");
  }
  const coverage = await request.get(
    "/api/research-coverage?market=north-jersey",
  );
  expect(coverage.ok()).toBe(true);
  const body = await coverage.json();
  expect(body).toMatchObject({
    total: 974,
    scored: 56 + approvals.length,
    unscored: 918 - approvals.length,
  });
  expect(body.locations).toHaveLength(974);
});

test("a newly scored nursing unit displays the published mean and count", async ({
  page,
  request,
}) => {
  const response = await request.get(
    "/api/search?zip=07052&radius=5&category=nursing-home&q=Summit%20Ridge",
  );
  const result: SearchResponse = await response.json();
  const provider = result.providers.find((p) => p.id === "cms-315038");
  expect(provider?.research?.experience.value).toBe(8.6);
  expect(provider?.research?.experience.selectedConcerns).toBe(true);
  await page.goto("/dashboard?demo=1");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("07052");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Provider or town" })
    .fill(provider!.name);
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters" })
    .click();
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: provider!.name, exact: true }),
  });
  await expect(card).toContainText("283 Google ratings");
  await card.getByRole("button", { name: "View details" }).click();
  const dialog = page.getByRole("dialog", {
    name: provider!.name,
    exact: true,
  });
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(dialog.locator(".experience-number")).toHaveText("8.6/10");
  await expect(dialog.locator(".experience-overview")).toContainText(
    "283 source-reported ratings",
  );
  await expect(dialog.locator(".score-purpose")).toContainText(
    "not a clinical-quality or safety score",
  );
});
