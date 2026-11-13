import { expect, test, type Page } from "@playwright/test";
import type { SearchProvider, SearchResponse } from "../../src/lib/providers";

const DEMO_KEY = "harbor.demo.workspace.v1";
const njOffice: SearchProvider = {
  id: "test-nj-office",
  name: "Test New Jersey care office",
  category: "home-care",
  address: "Test address",
  city: "Hoboken",
  state: "NJ",
  zip: "07030",
  lat: 40.744,
  lng: -74.032,
  locationKind: "office",
  description: "Test fixture, not a production provider.",
  services: [],
  officialRecord: false,
  sources: [],
  warnings: [],
  limitations: [],
  distanceMiles: 1.2,
};

function responseFor(zip: string): SearchResponse {
  const nj = zip === "07030";
  return {
    market: nj
      ? { id: "north-jersey", label: "North Jersey", state: "NJ" }
      : { id: "massachusetts", label: "Massachusetts", state: "MA" },
    providers: nj
      ? [njOffice]
      : [
          {
            ...njOffice,
            id: "test-ma-facility",
            name: "Test Massachusetts facility",
            category: "assisted-living",
            city: "Newton Center",
            state: "MA",
            zip,
            lat: 42.33,
            lng: -71.2,
            locationKind: "facility",
          },
        ],
    total: 1,
    origin: nj
      ? { zip, city: "Hoboken", lat: 40.744, lng: -74.032 }
      : { zip, city: "Newton Center", lat: 42.33, lng: -71.2 },
    radius: 25,
    catalogTotal: nj ? 7 : 521,
    asOf: nj ? "2026-11-10" : "2026-11-01",
    categories: { "home-care": nj ? 1 : 0, "assisted-living": nj ? 0 : 1 },
    excludedWithoutCoordinates: nj ? 2 : 0,
    experienceCoverage: {
      scored: 0,
      unscored: 1,
      facebookFindings: 0,
      facebookCovered: 0,
    },
  };
}

async function restoreWorkspace(page: Page, zip: string) {
  await page.addInitScript(
    ({ key, zip }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(
        key,
        JSON.stringify({
          profile: {
            name: "",
            relationship: "A parent",
            zip,
            careTypes: [],
          },
          savedProviderIds: [],
          notes: {},
          tasks: [],
          updatedAt: "2026-11-12T00:00:00.000Z",
        }),
      );
    },
    { key: DEMO_KEY, zip },
  );
}

async function navigate(page: Page, name: string) {
  await expect(page.locator(".app-shell")).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name, exact: true })
    .click();
}

async function openCoverage(page: Page) {
  const sources = page.locator("details.search-evidence");
  if ((await sources.getAttribute("open")) === null)
    await sources.getByText("Sources & evidence", { exact: true }).click();
  const method = page.locator("details.search-research-disclosure");
  if ((await method.getAttribute("open")) === null)
    await method
      .getByText("Research coverage & method", { exact: true })
      .click();
}

async function mockSearch(page: Page) {
  const zips: string[] = [];
  await page.route("**/api/search?**", async (route) => {
    const zip = new URL(route.request().url()).searchParams.get("zip")!;
    zips.push(zip);
    await route.fulfill({ json: responseFor(zip) });
  });
  return zips;
}

test("restored NJ ZIP drives the first search without seeding MA records", async ({
  page,
}) => {
  await restoreWorkspace(page, "07030");
  const zips = await mockSearch(page);
  await page.goto("/dashboard?demo=1");
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toHaveValue("07030");
  await expect(page.locator(".sidebar-bottom")).toContainText("North Jersey");
  expect(zips.length).toBeGreaterThan(0);
  expect(zips.every((zip) => zip === "07030")).toBe(true);
  await navigate(page, "Find care");
  await expect(page.locator(".search-summary")).toContainText("Hoboken, 07030");
  const card = page.locator(".provider-card");
  await expect(card).toContainText("Hoboken, NJ 07030");
  await expect(card).toContainText("1.2 mi · office");
  await expect(card).toContainText("Service at your address is not confirmed");
  await openCoverage(page);
  await expect(page.locator(".search-research-summary")).toContainText(
    "Office distances do not confirm service coverage",
  );
  await expect(page.locator(".catalog-note")).toContainText(
    "North Jersey catalog as of 2026-11-10. 7 records in this market",
  );
  await expect(page.locator(".catalog-note")).toContainText(
    "2 records without usable location coordinates",
  );
  await expect(
    page.getByRole("link", { name: "Download catalog research checklist" }),
  ).toHaveAttribute(
    "href",
    "/api/research-coverage?format=csv&market=north-jersey",
  );
  await expect(page.getByRole("main")).not.toContainText(
    /Boston|Massachusetts/,
  );
  await card.getByRole("button", { name: "View details" }).click();
  await expect(
    page.getByRole("dialog").locator(".inline-notice").first(),
  ).toContainText("Confirm service coverage at your address");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("radio", { name: "Map view", exact: true }).click();
  const markers = page.locator(".leaflet-overlay-pane path");
  await expect(markers).toHaveCount(3);
  await markers.last().hover();
  await expect(page.locator(".leaflet-tooltip")).toContainText(
    "Hoboken, NJ · office; service coverage not confirmed",
  );
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    DEMO_KEY,
  );
  expect(stored.profile.zip).toBe("07030");
  expect(stored.savedProviderIds).toEqual([]);
  expect(stored.tasks).toEqual([]);
  await page.reload();
  await expect(page.locator(".sidebar-bottom")).toContainText("North Jersey");
  expect(zips.every((zip) => zip === "07030")).toBe(true);
});

test("ZIP submission switches market labels, source dates and checklist scope", async ({
  page,
}) => {
  await restoreWorkspace(page, "02459");
  await mockSearch(page);
  await page.goto("/dashboard?demo=1");
  await expect(page.locator(".sidebar-bottom")).toContainText("Massachusetts");
  await navigate(page, "Find care");
  await openCoverage(page);
  await expect(page.locator(".catalog-note")).toContainText(
    "Massachusetts catalog as of 2026-11-01. 521 records in this market",
  );
  await expect(
    page.getByRole("link", { name: "Download catalog research checklist" }),
  ).toHaveAttribute(
    "href",
    "/api/research-coverage?format=csv&market=massachusetts",
  );
  await expect(page.locator(".provider-card")).toContainText(
    "Newton Center, MA 02459",
  );
  await expect(page.locator(".provider-card")).not.toContainText("office");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const zipField = page.getByRole("textbox", { name: "Search ZIP code" });
  await expect(zipField).toHaveAttribute("inputmode", "numeric");
  await expect(zipField).toHaveAttribute("pattern", "[0-9]{5}");
  await expect(zipField).toHaveAttribute("maxlength", "5");
  await expect(zipField).toHaveAttribute("required", "");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("07030");
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.locator(".sidebar-bottom")).toContainText("North Jersey");
  await openCoverage(page);
  await expect(page.locator(".catalog-note")).toContainText(
    "North Jersey catalog as of 2026-11-10. 7 records in this market",
  );
  await expect(
    page.getByRole("link", { name: "Download catalog research checklist" }),
  ).toHaveAttribute(
    "href",
    "/api/research-coverage?format=csv&market=north-jersey",
  );
  await expect(page.getByRole("main")).not.toContainText(
    /Boston|Massachusetts/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("profile ZIP updates search and survives reopening the demo", async ({
  page,
}) => {
  await restoreWorkspace(page, "02459");
  const zips = await mockSearch(page);
  await page.goto("/dashboard?demo=1");
  await expect(page.locator(".sidebar-bottom")).toContainText("Massachusetts");
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".profile-button").click();
  await page
    .getByRole("textbox", { name: "ZIP code to search near" })
    .fill("07030");
  await page.getByRole("button", { name: "Save & continue" }).click();
  const closeMenu = page
    .getByRole("button", { name: "Close menu", exact: true })
    .first();
  if (await closeMenu.isVisible()) await closeMenu.click();
  await expect(page.locator(".sidebar-bottom")).toContainText("North Jersey");
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toHaveValue("07030");
  zips.length = 0;
  await page.reload();
  await expect(page.locator(".sidebar-bottom")).toContainText("North Jersey");
  expect(zips.length).toBeGreaterThan(0);
  expect(zips.every((zip) => zip === "07030")).toBe(true);
});

test("failed market changes do not retain the previous market or catalog", async ({
  page,
}) => {
  await restoreWorkspace(page, "02459");
  await mockSearch(page);
  await page.goto("/dashboard?demo=1");
  await expect(page.locator(".sidebar-bottom")).toContainText("Massachusetts");
  await navigate(page, "Find care");
  await page.route("**/api/search?**", async (route) => {
    await route.fulfill({
      status: 400,
      json: { error: "Unsupported ZIP test fixture" },
    });
  });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("00000");
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Unsupported ZIP test fixture",
  );
  await expect(page.locator(".sidebar-bottom")).toContainText(
    "ZIP-SELECTED CARE SEARCH",
  );
  await expect(page.locator(".sidebar-bottom")).not.toContainText(
    "Massachusetts",
  );
  await expect(page.locator(".provider-card")).toHaveCount(0);
  await expect(page.locator(".catalog-note")).toHaveCount(0);
});

test("live NJ search shows published market results and catalog provenance", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/search?zip=07030&radius=25");
  expect(response.status()).toBe(200);
  const result = await response.json();
  await restoreWorkspace(page, "07030");
  await page.goto("/dashboard?demo=1");
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toHaveValue("07030");
  await navigate(page, "Find care");
  expect(result.market.id).toBe("north-jersey");
  expect(result.market.state).toBe("NJ");
  expect(result.origin.zip).toBe("07030");
  expect(
    result.providers.every(
      (provider: SearchProvider) => provider.state === "NJ",
    ),
  ).toBe(true);
  await expect(page.locator(".sidebar-bottom")).toContainText(
    result.market.label,
  );
  await expect(page.locator(".results-toolbar")).toContainText(
    `${result.total} care ${result.total === 1 ? "option" : "options"}`,
  );
  await openCoverage(page);
  await expect(page.locator(".catalog-note")).toContainText(
    `${result.market.label} catalog as of ${result.asOf}. ${result.catalogTotal} records in this market`,
  );
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    DEMO_KEY,
  );
  expect(stored.profile.zip).toBe("07030");
  expect(stored.savedProviderIds).toEqual([]);
});

test("home-health records cannot publish nursing ratings or request inspections even with a CMS object", async ({
  page,
}) => {
  const home: SearchProvider = {
    ...njOffice,
    id: "cms-317001",
    name: "Adversarial home-health fixture",
    category: "home-health",
    cms: {
      ccn: "317001",
      overall: 5,
      inspections: 4,
      staffing: 3,
      quality: 2,
      totalNurseHours: 9,
      rnHours: 8,
      turnover: 7,
      fines: 6,
      fineAmount: 5000,
      paymentDenials: 4,
      healthDeficiencies: 3,
      abuse: true,
      specialFocus: "Special Focus Facility",
      dataAsOf: "2026-11-10",
    },
  };
  const nursing: SearchProvider = {
    ...home,
    id: "cms-315001",
    name: "Nursing-home control fixture",
    category: "nursing-home",
    cms: { ...home.cms!, ccn: "315001" },
  };
  const inspectionRequests: string[] = [];
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      json: { ...responseFor("07030"), providers: [home, nursing], total: 2 },
    }),
  );
  await page.route("**/api/evidence?**", (route) => {
    inspectionRequests.push(route.request().url());
    return route.fulfill({
      status: 404,
      json: { error: "Fixture has no inspections" },
    });
  });
  await page.route("**/api/home-health-evidence?**", (route) =>
    route.fulfill({
      status: 404,
      json: { error: "Fixture has no home-health evidence" },
    }),
  );
  await restoreWorkspace(page, "07030");
  await page.goto("/dashboard?demo=1");
  await navigate(page, "Find care");
  const homeCard = page
    .locator(".provider-card")
    .filter({ hasText: home.name });
  const nursingCard = page
    .locator(".provider-card")
    .filter({ hasText: nursing.name });
  await expect(homeCard).not.toContainText(
    /CMS overall|CMS abuse|CMS special-focus/,
  );
  await expect(homeCard.locator(".rating")).toHaveCount(0);
  await expect(nursingCard).toContainText("CMS overall");
  await expect(nursingCard).toContainText("CMS abuse icon");
  await expect(nursingCard).toContainText("CMS special-focus status");
  await homeCard.getByRole("button", { name: "View details" }).click();
  const detail = page.getByRole("dialog", { name: home.name, exact: true });
  await detail.getByRole("tab", { name: "Details", exact: true }).click();
  await detail
    .getByText("Care quality & patient surveys", { exact: true })
    .click();
  await expect(detail.locator(".home-health-evidence")).toContainText(
    "No matched CMS home-health evidence",
  );
  await expect(detail).not.toContainText(
    /Ratings for this certified nursing home|CMS abuse|CMS special-focus|Nursing hours|RN hours|nursing staff turnover|Fines in CMS|Payment denials|Latest inspection deficiencies/,
  );
  await expect(detail.locator(".cms-ratings")).toHaveCount(0);
  await expect(detail.locator(".metrics-grid")).toHaveCount(0);
  expect(inspectionRequests).toEqual([]);
  await detail.getByRole("button", { name: "Close dialog" }).click();
  await homeCard
    .getByRole("checkbox", { name: `Compare ${home.name}`, exact: true })
    .check();
  await nursingCard
    .getByRole("checkbox", { name: `Compare ${nursing.name}`, exact: true })
    .check();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const comparison = page.getByRole("dialog", { name: "Compare places" });
  await expect(
    comparison.getByRole("region", { name: "Places comparison" }),
  ).toBeVisible();
  await expect(
    comparison.getByRole("group", {
      name: `${home.name}, warnings`,
      exact: true,
    }),
  ).toContainText("Not a safety clearance");
  await expect(
    comparison.getByRole("group", {
      name: `${nursing.name}, warnings`,
      exact: true,
    }),
  ).toContainText("CMS abuse icon");
  await comparison
    .getByText("Clinical ratings, availability & records", { exact: true })
    .click();
  for (const [label, rating] of [
    ["CMS overall", "5 / 5"],
    ["CMS health inspections", "4 / 5"],
    ["CMS staffing", "3 / 5"],
  ]) {
    await expect(
      comparison.getByRole("group", {
        name: `${home.name}, ${label}`,
        exact: true,
      }),
    ).toHaveText("Not applicable to this care setting");
    await expect(
      comparison.getByRole("group", {
        name: `${nursing.name}, ${label}`,
        exact: true,
      }),
    ).toContainText(rating);
  }
  await comparison.getByRole("button", { name: "Close dialog" }).click();
  await nursingCard.getByRole("button", { name: "View details" }).click();
  const nursingDetail = page.getByRole("dialog", {
    name: nursing.name,
    exact: true,
  });
  await nursingDetail
    .getByRole("tab", { name: "Details", exact: true })
    .click();
  await nursingDetail
    .getByText("Care quality & inspections", { exact: true })
    .click();
  await expect(nursingDetail.locator(".cms-ratings")).toBeVisible();
  await expect(nursingDetail.locator(".metrics-grid")).toBeVisible();
  await expect.poll(() => inspectionRequests.length).toBeGreaterThan(0);
  expect(
    inspectionRequests.every(
      (url) => new URL(url).searchParams.get("ccn") === "315001",
    ),
  ).toBe(true);
});
