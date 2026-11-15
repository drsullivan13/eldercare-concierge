import { expect, test, type Page } from "@playwright/test";
import retainedNJZips from "../../research/north-jersey/geography/nj-zips.json";
import {
  CATEGORY_LABELS,
  type SearchProvider,
  type SearchResponse,
} from "../../src/lib/providers";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";
import type { IndividualReviewsResponse } from "../../src/lib/individual-reviews";

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
  await page
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("all");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
}

async function openProvider(page: Page, provider: SearchProvider) {
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Provider or town" })
    .fill(provider.name);
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const card = page
    .locator(".provider-card")
    .filter({
      has: page.getByRole("button", { name: provider.name, exact: true }),
    })
    .filter({
      has: page.getByText(CATEGORY_LABELS[provider.category], { exact: true }),
    });
  await card.getByRole("button", { name: "View details" }).click();
  return page.getByRole("dialog", { name: provider.name, exact: true });
}

for (const fixture of [
  {
    id: "cms-315523",
    council: "CMS lists a resident council only.",
    medicareOnly: true,
  },
  {
    id: "cms-315369",
    council: "CMS lists both a resident council and a family council.",
    medicareOnly: false,
  },
  {
    id: "cms-315512",
    council: "CMS lists neither a resident nor a family council.",
    medicareOnly: true,
  },
]) {
  test(`CMS program participation and councils reach Details for ${fixture.id}`, async ({
    page,
    request,
  }) => {
    const response = await request.get(`/api/providers?ids=${fixture.id}`);
    expect(response.status()).toBe(200);
    const { providers }: { providers: SearchProvider[] } =
      await response.json();
    const provider = providers[0];
    expect(provider.id).toBe(fixture.id);
    const researchResponse = await request.get(
      `/api/research?id=${fixture.id}`,
    );
    expect(researchResponse.status()).toBe(200);
    const research: LocationResearchResponse = await researchResponse.json();
    const participation = research.facts.find(
      (fact) => fact.id === `${fixture.id}-cms-program-participation`,
    )!;
    const council = research.facts.find(
      (fact) => fact.id === `${fixture.id}-cms-councils`,
    )!;
    expect(council.text).toBe(fixture.council);
    expect(participation.asOf).toBe("2026-10-01");
    expect(participation.text).toContain(
      fixture.medicareOnly
        ? "Medicaid participation is not reported."
        : "Medicare and Medicaid participation",
    );
    await openSearch(page, provider.zip);
    const detail = await openProvider(page, provider);
    await detail.getByRole("tab", { name: "Details", exact: true }).click();
    const section = detail
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Licensing & care setting",
          exact: true,
        }),
      })
      .last();
    const more = section.locator(".offering-more summary");
    if (await more.count()) await more.click();
    for (const fact of [participation, council]) {
      const item = section
        .locator(".offering-fact")
        .filter({ hasText: fact.text });
      await expect(item).toBeVisible();
      await expect(item).toContainText("Oct 1, 2026");
      await expect(item.getByRole("link")).toHaveAttribute(
        "href",
        "https://data.cms.gov/provider-data/dataset/4pq5-n9py",
      );
      await expect(item.getByRole("link")).toContainText(
        "checked Nov 12, 2026",
      );
    }
  });
}

test("new office services reach Details without replacing the registry contact or claiming an opening", async ({
  page,
  request,
}) => {
  const id = "north-jersey-hp-hp0368100";
  const response = await request.get(`/api/providers?ids=${id}`);
  const { providers }: { providers: SearchProvider[] } = await response.json();
  const provider = providers[0];
  expect(provider.phone).toBe("(551) 404-0571");
  const researchResponse = await request.get(`/api/research?id=${id}`);
  const research: LocationResearchResponse = await researchResponse.json();
  const fact = research.facts.find(
    (fact) => fact.id === `${id}-office-services`,
  )!;
  expect(fact.text).toContain(
    "551-343-9333, different from the retained registry phone",
  );
  expect(research.availability.status).toBe("not-published");
  await openSearch(page, provider.zip);
  const detail = await openProvider(page, provider);
  await detail.getByRole("tab", { name: "Details", exact: true }).click();
  const more = detail.locator(".offering-more summary");
  for (const summary of await more.all()) await summary.click();
  await expect(
    detail
      .getByRole("region", { name: "Care team & visit support", exact: true })
      .getByText(fact.text, { exact: true }),
  ).toBeVisible();
  await expect(detail).toContainText("Current availability is not established");
  await expect(
    detail.getByRole("link", { name: "Call (551) 404-0571", exact: true }),
  ).toHaveAttribute("href", "tel:5514040571");
});

test("real NJ details show unknown evidence without retrying a legitimate research gap and retain catalog source links", async ({
  page,
  request,
}) => {
  const search = await request.get(
    "/api/search?zip=07083&radius=10&category=home-care",
  );
  expect(search.status()).toBe(200);
  const result: SearchResponse = await search.json();
  const provider = result.providers.find(
    (provider) => !provider.research && provider.sources.length > 0,
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
  const tabs = detail.getByRole("tablist", { name: "Provider profile" });
  const overview = tabs.getByRole("tab", { name: "Overview", exact: true });
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await overview.focus();
  await overview.press("ArrowRight");
  const costs = tabs.getByRole("tab", { name: "Costs & perks", exact: true });
  await expect(costs).toBeFocused();
  await expect(costs).toHaveAttribute("aria-selected", "true");
  await expect(overview).toHaveAttribute("tabindex", "-1");
  await expect(detail.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    await costs.evaluate((tab) => tab.id),
  );
  await expect(evidence.locator(".daily-life-gaps")).toContainText(
    /not established|not researched/i,
  );
  await expect(evidence.locator(".daily-life .offering-fact")).toHaveCount(0);
  await expect(
    evidence.getByRole("button", { name: "Retry location research" }),
  ).toHaveCount(0);
  await expect(evidence).not.toContainText("Research checked");
  await expect(evidence).toContainText("Pricing is not published here");
  await costs.press("End");
  await expect(
    tabs.getByRole("tab", { name: "Details", exact: true }),
  ).toBeFocused();
  await expect(evidence).toContainText(
    "Current availability is not established",
  );
  await tabs
    .getByRole("tab", { name: "Details", exact: true })
    .press("ArrowLeft");
  await expect(
    tabs.getByRole("tab", { name: "Reviews", exact: true }),
  ).toBeFocused();
  await expect(evidence).toContainText("Not rated yet");
  await expect(evidence).toContainText(
    "No location-matched ratings have been researched yet",
  );
  await expect(evidence.locator(".experience-number")).not.toContainText("/10");

  await detail.getByRole("tab", { name: "Details", exact: true }).click();
  await detail.locator(".source-disclosure summary").click();
  const links = await detail
    .locator(".source-list a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const source of provider!.sources) expect(links).toContain(source.url);
});

test("Morristown care detail displays its published location-matched experience score", async ({
  page,
  request,
}) => {
  const response = await request.get(
    "/api/search?zip=07960&category=nursing-home&q=CareOne",
  );
  const result: SearchResponse = await response.json();
  const provider = result.providers.find((entry) => entry.id === "cms-315488");
  expect(provider?.research?.experience.value).toBe(8);
  expect(provider?.research?.experience.reviewCount).toBe(185);
  await openSearch(page, "07960");
  const detail = await openProvider(page, provider!);
  const evidence = detail.locator(".location-research");
  await detail.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(evidence.locator(".experience-number")).toContainText("8");
  await expect(evidence).toContainText("185");
  await expect(evidence).toContainText("MyLivingChoice");
  const accountsResponse = await request.get("/api/reviews", {
    params: { id: provider!.id },
  });
  expect(accountsResponse.status()).toBe(200);
  const accounts: IndividualReviewsResponse = await accountsResponse.json();
  const withText = accounts.accounts.filter(
    ({ excerpt, summary }) => excerpt || summary,
  ).length;
  await expect(evidence.locator(".review-count-clarity")).toContainText(
    new RegExp(`\\b${withText || accounts.accounts.length}\\b`),
  );
  await expect(evidence.locator(".review-count-clarity")).toContainText("185");
  await expect(evidence.locator(".experience-number")).toHaveText("8.0/10");
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
    "/api/search?zip=07083&radius=10&category=home-care",
  );
  expect(gapSearch.status()).toBe(200);
  const gaps: SearchResponse = await gapSearch.json();
  const unresearched = gaps.providers.find((entry) => !entry.research);
  expect(unresearched).toBeDefined();
  const gapResponse = await request.get(`/api/research?id=${unresearched!.id}`);
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
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page.getByRole("button", { name: "Apply filters" }).click();
  const detail = await openProvider(page, provider);
  const evidence = detail.locator(".location-research");
  await detail.getByRole("tab", { name: "Costs & perks", exact: true }).click();
  await expect(evidence.locator(".daily-life-gaps")).toContainText(
    /not established|not researched/i,
  );
  await expect(evidence.locator(".daily-life .offering-fact")).toHaveCount(0);
  await detail.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(evidence).toContainText("Not rated yet");
  await expect(evidence.locator(".experience-number")).not.toContainText("/10");
  await expect(evidence.locator(".fb-research")).toContainText(
    retained.facebookResearch!.findings[0].summary,
  );
  await expect(evidence.locator(".fb-research")).not.toContainText(
    "When experience scores tie",
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
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("08002");
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const error = page.getByRole("main").getByRole("alert");
  await expect(error).toContainText("published North Jersey coverage");
  await expect(error).not.toContainText(/pending/i);
  await expect(page.locator(".provider-card")).toHaveCount(0);
  const middlesex = await request.get("/api/search?zip=08901");
  expect(middlesex.status()).toBe(200);
  const expanded: SearchResponse = await middlesex.json();
  expect(expanded.market.id).toBe("north-jersey");
  expect(expanded.origin).toMatchObject({
    zip: "08901",
    city: "New Brunswick",
  });
  for (const zip of ["08002", "07000"]) {
    const response = await request.get(`/api/search?zip=${zip}`);
    expect(response.status(), zip).toBe(400);
    const { error } = await response.json();
    expect(error).toMatch(/not recognized.*published North Jersey coverage/i);
    expect(error).not.toMatch(/pending/i);
  }
});
