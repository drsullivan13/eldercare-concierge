import { expect, test, type Page } from "@playwright/test";
import retainedNJZips from "../../research/north-jersey/geography/nj-zips.json";
import type { SearchProvider, SearchResponse } from "../../src/lib/providers";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";

async function openSearch(page: Page, zip: string) {
  await page.addInitScript((zip) => {
    localStorage.setItem(
      "harbor.demo.workspace.v1",
      JSON.stringify({
        profile: { name: "", relationship: "A parent", zip, careTypes: [] },
        savedProviderIds: [],
        notes: {},
        tasks: [],
        updatedAt: "2026-11-12T00:00:00.000Z",
      }),
    );
  }, zip);
  await page.goto("/dashboard?demo=1");
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toHaveValue(zip);
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
}

async function openProvider(page: Page, provider: SearchProvider) {
  await page
    .getByRole("textbox", { name: "Provider or town" })
    .fill(provider.name);
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  const card = page.locator(".provider-card").filter({
    has: page.getByRole("button", { name: provider.name, exact: true }),
  });
  await card.getByRole("button", { name: "View details" }).click();
  return page.getByRole("dialog", { name: provider.name, exact: true });
}

test("real NJ details show unknown evidence without retrying a legitimate research gap and retain catalog source links", async ({
  page,
  request,
}) => {
  const search = await request.get(
    "/api/search?zip=07083&radius=25&category=assisted-living",
  );
  expect(search.status()).toBe(200);
  const result: SearchResponse = await search.json();
  const provider = result.providers.find(
    (provider) =>
      !provider.research?.detailsAvailable && provider.sources.length > 0,
  );
  expect(provider).toBeDefined();
  const response = await request.get(`/api/research?id=${provider!.id}`);
  expect(response.status()).toBe(200);
  const research: LocationResearchResponse = await response.json();
  expect(research.checkedAt).toBeNull();
  expect(research.providerDetailsReviewed).toBe(false);
  expect(research.sources).toEqual([]);
  expect(research.experience.value).toBeNull();

  await openSearch(page, "07083");
  const detail = await openProvider(page, provider!);
  const evidence = detail.locator(".location-research");
  await expect(evidence).toContainText(
    "Amenities and activities have not been researched yet",
  );
  await expect(
    evidence.getByRole("button", { name: "Retry location research" }),
  ).toHaveCount(0);
  await expect(evidence).not.toContainText("Research checked");
  await evidence
    .getByRole("button", { name: "Rooms & costs", exact: true })
    .click();
  await expect(evidence).toContainText("Pricing has not been established");
  await evidence
    .getByRole("button", { name: "Availability", exact: true })
    .click();
  await expect(evidence).toContainText(
    "Current availability is not established",
  );
  await expect(evidence).toContainText("not been researched");
  await evidence.getByRole("button", { name: "Reviews", exact: true }).click();
  await expect(evidence).toContainText("Not rated yet");
  await expect(evidence).toContainText(
    "No location-matched ratings have been researched yet",
  );
  await expect(evidence.locator(".experience-number")).not.toContainText("/10");

  await detail.locator(".source-disclosure summary").click();
  const links = await detail
    .locator(".source-list a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const source of provider!.sources) expect(links).toContain(source.url);
});

test("Facebook-only detail responses display retained findings and original links without inventing a score", async ({
  page,
  request,
}) => {
  const search = await request.get(
    "/api/search?zip=02459&radius=50&evidence=facebook",
  );
  expect(search.status()).toBe(200);
  const result: SearchResponse = await search.json();
  const provider = result.providers[0];
  expect(provider).toBeDefined();
  const response = await request.get(`/api/research?id=${provider.id}`);
  expect(response.status()).toBe(200);
  const retained: LocationResearchResponse = await response.json();
  expect(retained.facebookResearch?.findings.length).toBeGreaterThan(0);
  const gapSearch = await request.get(
    "/api/search?zip=07083&radius=25&category=assisted-living",
  );
  expect(gapSearch.status()).toBe(200);
  const gaps: SearchResponse = await gapSearch.json();
  const gapResponse = await request.get(
    `/api/research?id=${gaps.providers[0].id}`,
  );
  expect(gapResponse.status()).toBe(200);
  const gap: LocationResearchResponse = await gapResponse.json();
  expect(gap.sources).toEqual([]);
  expect(gap.reviewAggregates).toEqual([]);
  expect(gap.experience.value).toBeNull();
  await page.route(`**/api/research?id=${provider.id}`, (route) =>
    route.fulfill({
      json: {
        ...gap,
        providerId: provider.id,
        facebookResearch: retained.facebookResearch,
      },
    }),
  );

  await openSearch(page, "02459");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  const detail = await openProvider(page, provider);
  const evidence = detail.locator(".location-research");
  await expect(evidence).toContainText(
    "Amenities and activities have not been researched yet",
  );
  await evidence.getByRole("button", { name: "Reviews", exact: true }).click();
  await expect(evidence).toContainText("Not rated yet");
  await expect(evidence.locator(".experience-number")).not.toContainText("/10");
  await expect(evidence.locator(".fb-research")).toContainText(
    retained.facebookResearch!.findings[0].summary,
  );
  await expect(evidence.locator(".fb-research")).toContainText(
    "They do not affect the experience score",
  );
  await expect(
    evidence
      .locator(".fb-research")
      .getByRole("link", { name: "Facebook source", exact: true })
      .first(),
  ).toHaveAttribute("href", retained.facebookResearch!.findings[0].sourceUrl);
  await expect(
    evidence.getByRole("button", { name: "Retry location research" }),
  ).toHaveCount(0);
});

test("published NJ coverage rejects excluded or unrecognized ZIPs without a pending message", async ({
  page,
  request,
}) => {
  for (const zip of ["07083", "07960", "08812", "07999"] as const) {
    const response = await request.get(`/api/search?zip=${zip}`);
    expect(response.status(), zip).toBe(200);
    const result: SearchResponse = await response.json();
    expect(result.market.id).toBe("north-jersey");
    expect(result.market.state).toBe("NJ");
    expect(result.origin).toEqual({ zip, ...retainedNJZips[zip] });
    expect(result.providers.every((provider) => provider.state === "NJ")).toBe(
      true,
    );
  }
  await openSearch(page, "07083");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("08002");
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  const error = page.getByRole("main").getByRole("alert");
  await expect(error).toContainText("published North Jersey coverage");
  await expect(error).not.toContainText(/pending/i);
  await expect(page.locator(".provider-card")).toHaveCount(0);
  for (const zip of ["08002", "08901", "07000"]) {
    const response = await request.get(`/api/search?zip=${zip}`);
    expect(response.status(), zip).toBe(400);
    const { error } = await response.json();
    expect(error).toMatch(/not recognized.*published North Jersey coverage/i);
    expect(error).not.toMatch(/pending/i);
  }
});
