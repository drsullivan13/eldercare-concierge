import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import catalogue from "../../src/data/providers.json";
import zipPoints from "../../src/data/ma-zips.json";
import type { Provider, SearchResponse } from "../../src/lib/providers";
import type { InspectionEvidence } from "../../src/lib/inspections";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";

const DEMO_KEY = "harbor.demo.workspace.v1";
const actualRecords = catalogue as Provider[];
const actualById = new Map(
  actualRecords.map((provider) => [provider.id, provider]),
);
const center = zipPoints["02459"];
const inspectionSnapshot = JSON.parse(
  readFileSync("src/data/inspection-history.json", "utf8"),
) as {
  sources: InspectionEvidence["sources"];
  facilities: Record<
    string,
    {
      healthCitations: {
        total: number;
        records: InspectionEvidence["healthCitations"]["records"];
      } | null;
    }
  >;
};

// An independent spherical-cosine calculation checks the API's Haversine output.
function referenceMiles(lat: number, lng: number) {
  const rad = Math.PI / 180;
  const a = center.lat * rad,
    b = lat * rad,
    delta = (center.lng - lng) * rad;
  const cosine =
    Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(delta);
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * 3958.7613;
}

async function searchAPI(
  request: APIRequestContext,
  extra: Record<string, string> = {},
) {
  const response = await request.get("/api/search", {
    params: {
      zip: "02459",
      radius: "10",
      category: "all",
      sort: "distance",
      ...extra,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as SearchResponse;
}

async function openDemo(page: Page, fromLanding = false) {
  await page.goto(fromLanding ? "/" : "/dashboard?demo=1");
  if (fromLanding) {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "next chapter",
    );
    await page
      .getByRole("link", {
        name: /^(Open your care workspace|Explore the demo)$/,
      })
      .click();
  }
  await expect(page).toHaveURL(/\/dashboard\?demo=1/);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Harbor home" }),
  ).toBeVisible();
  await page.getByText("About your workspace", { exact: true }).click();
  await expect(
    page.getByText(/Real provider records\. Your plan stays in this browser\./),
  ).toBeVisible();
  await page.getByText("About your workspace", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for",
  );
}

async function searchTenMiles(page: Page) {
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("10");
  const result = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("zip") === "02459" &&
      url.searchParams.get("radius") === "10"
    );
  });
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  const response = await result;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as SearchResponse;
  await expect(page.locator(".search-summary")).toContainText(
    "Newton Center, 02459",
  );
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".provider-card").first()).toContainText(
    body.providers[0].name,
  );
  return body;
}

async function navigate(
  page: Page,
  name: "Overview" | "Find care" | "Your shortlist" | "Your plan",
) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  // The shortlist's accessible name includes its current count.
  const accessibleName =
    name === "Your shortlist" ? /^Your shortlist(?: \d+)?$/ : name;
  await page
    .locator(".side-nav")
    .getByRole("button", { name: accessibleName, exact: true })
    .click();
  await expect(page.locator(".sidebar-overlay")).toHaveCount(0);
}

function card(page: Page, provider: Provider) {
  return page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: provider.name, exact: true }),
  });
}

test("care alerts remain visible while source detail is disclosed on demand", async ({
  page,
}) => {
  const provider = actualRecords.find(
    (record) => record.cms?.abuse && record.cms?.specialFocus,
  )!;
  await openDemo(page);
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByPlaceholder("Search by name or town").fill(provider.name);
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const option = card(page, provider);
  await expect(
    option.locator(".provider-alert").filter({ hasText: /abuse/i }),
  ).toBeVisible();
  await expect(
    option.locator(".provider-alert").filter({ hasText: /special.focus/i }),
  ).toBeVisible();
  for (const alert of await option.locator(".provider-alert span").all()) {
    expect(
      await alert.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1,
      ),
    ).toBe(true);
  }
  await option.getByRole("button", { name: "View details" }).click();
  const dialog = page.getByRole("dialog", { name: provider.name, exact: true });
  await expect(dialog.locator(".detail-warnings")).toContainText(/abuse/i);
  await expect(dialog.locator(".detail-warnings")).toBeVisible();
  await expect(
    dialog.locator(".source-disclosure .source-list"),
  ).not.toBeVisible();
  await dialog.getByRole("tab", { name: "Details", exact: true }).click();
  await dialog.locator(".source-disclosure summary").click();
  await expect(dialog.locator(".source-disclosure .source-list")).toBeVisible();
});

test("a failed shortlist lookup preserves saved IDs and notes in the downloaded plan and can retry", async ({
  page,
}) => {
  const provider = actualRecords[0];
  await page.addInitScript(
    ({ id, key }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          profile: {
            name: "",
            relationship: "A parent",
            zip: "02459",
            careTypes: [],
          },
          savedProviderIds: [id],
          notes: { [id]: "Ask about overnight staffing." },
          tasks: [],
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    { id: provider.id, key: DEMO_KEY },
  );
  await page.route("**/api/providers?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unavailable" }),
    }),
  );
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for",
  );
  await navigate(page, "Your shortlist");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your saved providers could not be loaded",
  );
  await expect(
    page.getByRole("heading", { name: "No saved places yet." }),
  ).not.toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export plan", exact: true }).click();
  const path = await (await pendingDownload).path();
  expect(path).not.toBeNull();
  const exported = readFileSync(path!, "utf8");
  expect(exported).toContain(`Provider ID: ${provider.id}`);
  expect(exported).toContain("Ask about overnight staffing.");
  await page.unroute("**/api/providers?*");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(card(page, provider)).toBeVisible();
});

async function noDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test("real search API respects coordinates, radius, evidence and nursing-home-only CMS ordering", async ({
  request,
}) => {
  const body = await searchAPI(request);
  expect(body.origin.zip).toBe("02459");
  expect(body.origin.city).toBe("Newton Center");
  expect(body.radius).toBe(10);
  expect(body.catalogTotal).toBe(actualRecords.length);
  const expected = actualRecords.filter(
    (provider) =>
      provider.lat !== null &&
      provider.lng !== null &&
      referenceMiles(provider.lat, provider.lng) <= 10,
  );
  expect(new Set(body.providers.map((provider) => provider.id))).toEqual(
    new Set(expected.map((provider) => provider.id)),
  );
  expect(body.total).toBe(expected.length);
  expect(body.providers[0].id).toBe("ma-alr-adelaide-of-newton-centre");
  for (const [index, provider] of body.providers.entries()) {
    const sourceRecord = actualById.get(provider.id)!;
    expect(provider.name).toBe(sourceRecord.name);
    expect(provider.distanceMiles!).toBeLessThanOrEqual(10);
    expect(provider.distanceMiles!).toBeCloseTo(
      referenceMiles(sourceRecord.lat!, sourceRecord.lng!),
      5,
    );
    expect(provider.sources).toEqual(sourceRecord.sources);
    expect(provider.sources.length).toBeGreaterThan(0);
    for (const source of provider.sources) {
      expect(new URL(source.url).protocol).toMatch(/^https?:$/);
      expect(source.supports.length).toBeGreaterThan(0);
      expect(source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    if (index)
      expect(body.providers[index - 1].distanceMiles!).toBeLessThanOrEqual(
        provider.distanceMiles!,
      );
  }
  const nursing = await searchAPI(request, {
    category: "nursing-home",
    sort: "cms-rating",
  });
  expect(nursing.providers.length).toBeGreaterThan(1);
  for (const [index, provider] of nursing.providers.entries()) {
    expect(provider.category).toBe("nursing-home");
    if (index) {
      const previous = nursing.providers[index - 1];
      expect(previous.cms?.overall ?? -1).toBeGreaterThanOrEqual(
        provider.cms?.overall ?? -1,
      );
      if (previous.cms?.overall === provider.cms?.overall)
        expect(previous.distanceMiles!).toBeLessThanOrEqual(
          provider.distanceMiles!,
        );
    }
  }
  for (const category of [
    "all",
    "assisted-living",
    "home-care",
    "home-health",
    "staffing",
    "life-plan",
  ]) {
    const invalid = await request.get("/api/search", {
      params: { zip: "02459", radius: "10", category, sort: "cms-rating" },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toContain(
      "only for the nursing-home category",
    );
  }
});

test("landing to demo: search real providers, save two, compare, inspect sources and persist a bounded note", async ({
  page,
}) => {
  await openDemo(page, true);
  await noDocumentOverflow(page);
  const body = await searchTenMiles(page);
  const [first, second] = body.providers;
  await expect(
    page
      .getByRole("combobox", { name: "Sort results" })
      .locator('option[value="cms-rating"]'),
  ).toHaveCount(0);
  for (const provider of [first, second]) {
    const result = card(page, provider);
    await expect(result).toContainText(
      `${provider.distanceMiles!.toFixed(1)} mi`,
    );
    await result
      .getByRole("button", { name: `Save ${provider.name}`, exact: true })
      .click();
    await expect(
      result.getByRole("button", {
        name: `Remove ${provider.name}`,
        exact: true,
      }),
    ).toBeVisible();
    await result
      .getByRole("checkbox", { name: `Compare ${provider.name}`, exact: true })
      .check();
  }
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const comparison = page.getByRole("dialog", { name: "Compare places" });
  await expect(comparison).toBeVisible();
  for (const provider of [first, second]) {
    await expect(
      comparison.getByRole("button", { name: provider.name, exact: true }),
    ).toBeVisible();
    await expect(
      comparison.getByRole("group", {
        name: `${provider.name}, consumer experience`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await comparison
    .getByText("Clinical ratings, availability & records", { exact: true })
    .click();
  await expect(
    comparison.getByRole("group", {
      name: `${first.name}, CMS overall`,
      exact: true,
    }),
  ).toContainText("Not applicable");
  await expect(
    comparison.getByRole("group", {
      name: `${first.name}, Availability`,
      exact: true,
    }),
  ).toContainText("Not confirmed live");
  await noDocumentOverflow(page);
  await comparison.getByRole("button", { name: "Close dialog" }).click();
  await card(page, first).getByRole("button", { name: "View details" }).click();
  const detail = page.getByRole("dialog", { name: first.name, exact: true });
  await detail.getByRole("tab", { name: "Details", exact: true }).click();
  await detail.locator(".source-disclosure summary").click();
  await expect(detail.locator(".source-list")).toBeVisible();
  for (const [index, source] of first.sources.entries()) {
    const link = detail.locator(".source-list a").nth(index);
    await expect(link).toHaveAttribute("href", source.url);
    await expect(link).toContainText(source.title);
    await expect(link).toContainText(source.supports);
    await expect(link).toContainText(`Retrieved ${source.checkedAt}`);
    await expect(link).toHaveAttribute("target", "_blank");
  }
  await detail.getByText("Your questions & notes", { exact: true }).click();
  const notes = detail.getByRole("textbox", {
    name: `Notes about ${first.name}`,
  });
  await expect(notes).toHaveAttribute("maxlength", "2000");
  await notes.fill("x".repeat(2050));
  await expect(notes).toHaveValue("x".repeat(2000));
  const text = "Ask about itemized fees, accessibility and cancellation terms.";
  await notes.fill(text);
  await detail.getByRole("button", { name: "Update note" }).click();
  await expect(
    detail.getByRole("button", { name: "Note added to workspace" }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Close dialog" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) || "{}").notes,
        DEMO_KEY,
      ),
    )
    .toEqual({ [first.id]: text });
  await expect
    .poll(async () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) || "{}").savedProviderIds,
        DEMO_KEY,
      ),
    )
    .toEqual([first.id, second.id]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for",
  );
  await navigate(page, "Your shortlist");
  await expect(page.locator(".provider-card")).toHaveCount(2);
  await card(page, first).getByRole("button", { name: "View details" }).click();
  await page
    .getByRole("dialog", { name: first.name })
    .getByText("Your questions & notes", { exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: first.name })
      .getByRole("textbox", { name: `Notes about ${first.name}` }),
  ).toHaveValue(text);
});

test("CMS sort is exposed only for nursing homes and the map keeps actual result coordinates", async ({
  page,
}) => {
  await openDemo(page);
  await searchTenMiles(page);
  const nursingResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("category") === "nursing-home",
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category", exact: true })
    .selectOption("nursing-home");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  expect((await nursingResponse).status()).toBe(200);
  const sort = page.getByRole("combobox", { name: "Sort results" });
  await expect(sort.locator('option[value="cms-rating"]')).toHaveCount(1);
  const sortedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("sort") === "cms-rating",
  );
  await sort.selectOption("cms-rating");
  const sorted = (await (await sortedResponse).json()) as SearchResponse;
  await expect(page.locator(".provider-card").first()).toContainText(
    sorted.providers[0].name,
  );
  await page.getByRole("button", { name: "Map view", exact: true }).click();
  await expect(page.getByLabel("Map of care locations")).toBeVisible();
  await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(
    sorted.providers.length + 2,
  );
  await noDocumentOverflow(page);
  const assistedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("category") ===
        "assisted-living",
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category", exact: true })
    .selectOption("assisted-living");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const assisted = (await (await assistedResponse).json()) as SearchResponse;
  expect(
    assisted.providers.every(
      (provider) => provider.category === "assisted-living",
    ),
  ).toBe(true);
  await expect(sort).toHaveValue("distance");
  await expect(sort.locator('option[value="cms-rating"]')).toHaveCount(0);
  await expect(page.locator(".provider-card .rating")).toHaveCount(0);
  await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(
    assisted.providers.length + 2,
  );
});

test("families filter and compare options, then use the place section selector with a keyboard", async ({
  page,
}) => {
  await openDemo(page);
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("life-plan");
  await page
    .getByRole("region", { name: "Search nearby care" })
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Sort results" })
    .selectOption("experience");
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("category") === "life-plan" &&
      url.searchParams.get("sort") === "experience" &&
      url.searchParams.get("evidence") === "pricing"
    );
  });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Research filter" })
    .selectOption("pricing");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const results = (await (await filtered).json()) as SearchResponse;
  expect(results.providers.length).toBeGreaterThanOrEqual(2);
  const selected = results.providers.slice(0, 2);
  for (const provider of selected) {
    await card(page, provider)
      .getByRole("checkbox", { name: `Compare ${provider.name}`, exact: true })
      .check();
  }
  const researchLoaded = Promise.all(
    selected.map((provider) =>
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/research" &&
          url.searchParams.get("id") === provider.id &&
          response.status() === 200
        );
      }),
    ),
  );
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const researchResponses = await researchLoaded;
  const comparison = page.getByRole("dialog", { name: "Compare places" });
  const tableArea = comparison.getByRole("region", {
    name: "Places comparison",
  });
  await expect(tableArea).toHaveAttribute("tabindex", "0");
  await expect(
    comparison.getByRole("heading", { name: "Published prices", exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByRole("heading", { name: "A review insight", exact: true }),
  ).toBeVisible();
  await expect(comparison).toContainText("not clinical quality or safety");
  for (const [index, provider] of selected.entries()) {
    const prices = comparison.getByRole("group", {
      name: `${provider.name}, published prices`,
      exact: true,
    });
    await expect(prices).not.toHaveAttribute("aria-busy", "true");
    await expect(prices).toContainText(
      "Published prices, not a personal quote.",
    );
    await expect(prices.getByRole("link").first()).toHaveAttribute(
      "href",
      /^https?:/,
    );
    const research = (await researchResponses[
      index
    ].json()) as LocationResearchResponse;
    expect(research.providerId).toBe(provider.id);
    const perks = comparison.getByRole("group", {
      name: `${provider.name}, everyday perks`,
      exact: true,
    });
    const publishedPerks = research.facts
      .filter((fact) =>
        ["dining", "amenity", "activity", "room", "care"].includes(fact.kind),
      )
      .map((fact) => fact.text);
    expect(publishedPerks.length).toBeGreaterThan(0);
    await expect(perks.locator("p").first()).toBeVisible();
    for (const text of await perks.locator("p").allTextContents()) {
      expect(publishedPerks).toContain(text);
    }
    const morePrices = prices.getByText(/^More prices \(/);
    if (await morePrices.isVisible()) await morePrices.click();
    const costs = research.facts.filter((fact) => fact.kind === "cost");
    expect(costs.length).toBeGreaterThan(0);
    for (const cost of costs) {
      await expect(prices).toContainText(cost.text);
      if (cost.amount) {
        await expect(prices).toContainText(
          new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }).format(cost.amount.min),
        );
      }
    }
    const insight = comparison.getByRole("group", {
      name: `${provider.name}, a review insight`,
      exact: true,
    });
    await expect(insight).toContainText(
      "One selected account, not a survey. Relationship unverified.",
    );
    const accountLink = insight.getByRole("link").first();
    const accountUrls = [
      ...research.reviews.map((review) => review.url),
      ...research.sources.map((source) => source.url),
      ...(research.facebookResearch?.findings.map(
        (finding) => finding.sourceUrl,
      ) ?? []),
    ];
    expect(accountUrls).toContain(await accountLink.getAttribute("href"));
    await expect(accountLink).toHaveAttribute("target", "_blank");
    const quote = insight.getByRole("blockquote");
    await expect(quote).toBeVisible();
    const selectedText = (await quote.innerText())
      .slice(1, -1)
      .replace(/…$/, "");
    const publishedAccounts = [
      ...research.reviews.map((review) => review.excerpt),
      ...(research.facebookResearch?.findings.map(
        (finding) => finding.excerpt ?? "",
      ) ?? []),
    ];
    expect(
      publishedAccounts.some((text) => text.startsWith(selectedText)),
    ).toBe(true);
  }
  await tableArea.focus();
  await expect(tableArea).toBeFocused();
  await tableArea.press("ArrowRight");
  if (
    await tableArea.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    )
  ) {
    await expect
      .poll(() => tableArea.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  }
  await noDocumentOverflow(page);
  await comparison
    .getByRole("button", { name: selected[0].name, exact: true })
    .click();
  await expect(comparison).toHaveCount(0);
  const detail = page.getByRole("dialog", {
    name: selected[0].name,
    exact: true,
  });
  const sections = detail.getByRole("tablist", { name: "Provider profile" });
  await expect(sections.getByRole("tab", { selected: true })).toHaveText(
    "Overview",
  );
  const overview = sections.getByRole("tab", { name: "Overview", exact: true });
  await overview.focus();
  for (const [key, label, content] of [
    ["ArrowRight", "Costs & perks", "Care, amenities & everyday life"],
    ["ArrowRight", "Reviews", "Selected public experiences"],
    ["End", "Details", "About this provider"],
    ["Home", "Overview", "At a glance"],
  ]) {
    await page.keyboard.press(key);
    const tab = sections.getByRole("tab", { name: label, exact: true });
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(tab).toHaveAttribute("tabindex", "0");
    const panel = detail.getByRole("tabpanel", { name: label, exact: true });
    await expect(panel).toHaveAttribute(
      "id",
      (await tab.getAttribute("aria-controls"))!,
    );
    await expect(panel).toContainText(content);
    await expect(sections.getByRole("tab", { selected: true })).toHaveCount(1);
  }
  await noDocumentOverflow(page);
});

test("personal planning tasks add, toggle, persist and delete in the local demo", async ({
  page,
}) => {
  await openDemo(page);
  await navigate(page, "Your plan");
  const title = "Arrange equipment delivery before the move";
  await page
    .getByRole("button", { name: "Add a next step", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add a next step",
    exact: true,
  });
  await dialog.getByRole("textbox", { name: "Task", exact: true }).fill(title);
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Equipment");
  await dialog.getByLabel(/Due date/).fill("2026-12-01");
  await dialog.getByRole("button", { name: "Add to my plan" }).click();
  const task = page.locator(".plan-task").filter({ hasText: title });
  await expect(task).toBeVisible();
  await expect(task).toContainText("Equipment");
  await task
    .getByRole("button", { name: `Complete ${title}`, exact: true })
    .click();
  await expect(
    task.getByRole("button", { name: `Reopen ${title}`, exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        ({ key, title }) =>
          JSON.parse(localStorage.getItem(key) || "{}").tasks?.find(
            (task: { title: string }) => task.title === title,
          )?.status,
        { key: DEMO_KEY, title },
      ),
    )
    .toBe("done");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for",
  );
  await navigate(page, "Your plan");
  await expect(
    task.getByRole("button", { name: `Reopen ${title}`, exact: true }),
  ).toBeVisible();
  await task
    .getByRole("button", { name: `Reopen ${title}`, exact: true })
    .click();
  await expect(
    task.getByRole("button", { name: `Complete ${title}`, exact: true }),
  ).toBeVisible();
  await task
    .getByRole("button", { name: `Delete ${title}`, exact: true })
    .click();
  await expect(task).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(
        ({ key, title }) =>
          JSON.parse(localStorage.getItem(key) || "{}").tasks?.some(
            (task: { title: string }) => task.title === title,
          ),
        { key: DEMO_KEY, title },
      ),
    )
    .toBe(false);
  await noDocumentOverflow(page);
});

test("empty and unsupported searches are honest errors, with working mobile navigation", async ({
  page,
  request,
}) => {
  await openDemo(page);
  await searchTenMiles(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const input = page.getByPlaceholder("Search by name or town");
  await input.fill("NoSuchHarborProvider_7c84");
  const empty = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("q") ===
        "NoSuchHarborProvider_7c84",
  );
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  expect((await empty).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "No matching options in this search." }),
  ).toBeVisible();
  await expect(page.locator(".provider-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await input.fill("");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("01103");
  const outside = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("zip") === "01103",
  );
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  expect((await outside).status()).toBe(400);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "outside the Boston pilot area",
  );
  await expect(page.locator(".provider-card")).toHaveCount(0);
  const unknown = await request.get("/api/search", {
    params: { zip: "00000" },
  });
  expect(unknown.status()).toBe(400);
  expect((await unknown.json()).error).toContain("not recognized");
  const nonMA = await request.get("/api/search", { params: { zip: "10001" } });
  expect(nonMA.status()).toBe(400);
  expect((await nonMA.json()).error).toContain(
    "outside the supported Massachusetts and North Jersey markets",
  );
  await navigate(page, "Your shortlist");
  await expect(
    page.getByRole("heading", {
      name: "No saved places yet.",
    }),
  ).toBeVisible();
  await navigate(page, "Overview");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for",
  );
  await noDocumentOverflow(page);
});

test("protected API never returns a workspace to an anonymous browser or silently uses demo state", async ({
  request,
  page,
  baseURL,
}) => {
  const get = await request.get("/api/workspace");
  const getBody = await get.json();
  if (get.status() === 503) {
    expect(getBody.code).toBe("NOT_CONFIGURED");
    expect(getBody.error).toContain("not configured");
  } else {
    expect(get.status()).toBe(401);
    expect(getBody.error).toContain("Sign in");
  }
  expect(getBody.workspace).toBeUndefined();
  expect(get.headers()["cache-control"]).toContain("no-store");
  const put = await request.put("/api/workspace", {
    data: { workspace: { user_id: "somebody-else" } },
  });
  expect(put.status()).toBe(get.status());
  expect((await put.json()).workspace).toBeUndefined();
  const browserOrigin = new URL(baseURL!).origin;
  const sameOriginPut = await request.put("/api/workspace", {
    headers: { Origin: browserOrigin },
    data: { workspace: {} },
  });
  expect(sameOriginPut.status()).toBe(get.status());
  const maliciousPut = await request.put("/api/workspace", {
    headers: { Origin: "https://evil.example" },
    data: { workspace: {} },
  });
  expect(maliciousPut.status()).toBe(403);
  await page.goto("/auth/callback?next=https://evil.example/");
  await expect(page).toHaveURL(
    (url) =>
      url.origin === browserOrigin &&
      ((url.pathname === "/login" &&
        url.searchParams.get("error") === "auth_callback") ||
        (url.pathname === "/dashboard" &&
          url.searchParams.get("demo") === "1")),
  );
  expect(new URL(page.url()).origin).toBe(browserOrigin);
  const accountsDisabled = new URL(page.url()).pathname === "/dashboard";
  if (accountsDisabled) {
    // Backend configuration and account activation are separate: the current product needs neither sign-in nor SMTP.
    await page.getByText("About your workspace", { exact: true }).click();
    await expect(
      page.getByText(
        /Real provider records\. Your plan stays in this browser\./,
      ),
    ).toContainText("Your plan stays in this browser.");
    await expect(
      page.locator('a[href="/signup"], a[href="/login"]'),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Email address" }),
    ).toHaveCount(0);
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "Open your care workspace", exact: true }),
    ).toHaveAttribute("href", "/dashboard?demo=1");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Find care", exact: true }),
    ).toHaveAttribute("href", "/dashboard?demo=1");
    await expect(
      page.getByRole("link", { name: "Log in", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No sign-in needed. Your plan stays in this browser.", {
        exact: true,
      }),
    ).toBeVisible();
    for (const entry of ["/signup", "/login", "/dashboard"]) {
      await page.goto(entry);
      await expect(page).toHaveURL(/\/dashboard\?demo=1$/);
      await page.getByText("About your workspace", { exact: true }).click();
      await expect(
        page.getByText(
          /Real provider records\. Your plan stays in this browser\./,
        ),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Find care for",
      );
      await expect(
        page.locator('a[href="/signup"], a[href="/login"]'),
      ).toHaveCount(0);
      await expect(
        page.getByText("Account sign-in is being connected.", { exact: false }),
      ).toHaveCount(0);
    }
    return;
  }
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  const configured = get.status() === 401;
  const login = page.getByRole("button", { name: "Log in", exact: true });
  if (configured) await expect(login).toBeEnabled();
  else await expect(login).toBeDisabled();
  await page.goto("/signup");
  const signup = page.getByRole("button", {
    name: "Create account",
    exact: true,
  });
  if (configured) {
    await expect(signup).toBeEnabled();
    await expect(
      page.getByText("Account sign-in is being connected.", { exact: false }),
    ).toHaveCount(0);
  } else {
    await expect(signup).toBeDisabled();
    await expect(
      page.getByText("Account sign-in is being connected.", { exact: false }),
    ).toBeVisible();
  }
  // Deliberately do not submit signup: confirmation stays enabled and no email is sent by this test.
});

test("nursing-home detail shows actual CMS findings, bounded history, published sources, empty records and retry recovery", async ({
  page,
  request,
}) => {
  const nursing = await searchAPI(request, { category: "nursing-home" });
  const provider = nursing.providers.find(
    (item) =>
      item.cms &&
      (inspectionSnapshot.facilities[item.cms.ccn]?.healthCitations?.total ??
        0) > 5,
  )!;
  expect(provider).toBeDefined();
  const ccn = provider.cms!.ccn;
  const result = await request.get("/api/evidence", { params: { ccn } });
  expect(result.status()).toBe(200);
  const evidence = (await result.json()) as InspectionEvidence;
  const original = inspectionSnapshot.facilities[ccn].healthCitations!;
  const latest = [...original.records].sort(
    (a, b) =>
      (b.surveyDate ?? "").localeCompare(a.surveyDate ?? "") ||
      a.id.localeCompare(b.id),
  );
  expect(evidence.ccn).toBe(ccn);
  expect(evidence.providerId).toBe(provider.id);
  expect(evidence.healthCitations.total).toBe(original.total);
  // Source fields remain exact; the API additionally explains the original severity code.
  expect(evidence.healthCitations.records).toMatchObject(latest.slice(0, 5));
  expect(evidence.sources).toEqual(inspectionSnapshot.sources);
  const bounded = await request.get("/api/evidence", {
    params: { ccn, limit: "25" },
  });
  expect(bounded.status()).toBe(200);
  const maximum = (await bounded.json()) as InspectionEvidence;
  expect(maximum.maximumLimit).toBe(25);
  expect(maximum.healthCitations.returned).toBe(Math.min(25, original.total));
  expect(maximum.healthCitations.records.length).toBeLessThanOrEqual(25);
  const invalidQueries: Array<Record<string, string>> = [
    { ccn, limit: "26" },
    { ccn: "wrong" },
  ];
  for (const params of invalidQueries) {
    expect((await request.get("/api/evidence", { params })).status()).toBe(400);
  }
  expect(
    (
      await request.get("/api/evidence", { params: { ccn: "999999" } })
    ).status(),
  ).toBe(404);
  await openDemo(page);
  await searchTenMiles(page);
  const categoryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("category") === "nursing-home",
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category", exact: true })
    .selectOption("nursing-home");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await categoryResponse;
  await card(page, provider)
    .getByRole("button", { name: "View details" })
    .click();
  const detail = page.getByRole("dialog", { name: provider.name, exact: true });
  const history = detail.locator(".inspection-history");
  await detail.getByRole("tab", { name: "Details", exact: true }).click();
  await detail.getByText("Care quality & inspections", { exact: true }).click();
  await expect(
    history.getByRole("heading", { name: "Inspection findings & penalties" }),
  ).toBeVisible();
  await expect(history.locator("article.source-item")).toHaveCount(5);
  await expect(history.locator("article.source-item").first()).toContainText(
    latest[0].description,
  );
  await expect(history.locator("article.source-item").first()).toContainText(
    latest[0].tag,
  );
  if (evidence.healthCitations.records[0].scopeSeverityLabel) {
    await expect(history.locator("article.source-item").first()).toContainText(
      evidence.healthCitations.records[0].scopeSeverityLabel!,
    );
  }
  await expect(history).toContainText(
    "Descriptions are CMS's brief descriptions, not full survey narratives.",
  );
  for (const source of evidence.sources) {
    await expect(
      history.getByRole("link", { name: new RegExp(`CMS ${source.title}`) }),
    ).toHaveAttribute("href", source.url);
  }
  await expect(
    history.getByRole("link", {
      name: "Open this nursing home in Care Compare",
    }),
  ).toHaveAttribute("href", evidence.careCompareUrl);
  await expect(
    history.getByRole("link", { name: "CMS data dictionary" }),
  ).toHaveAttribute("href", evidence.dictionaryUrl);
  await expect(
    history.getByRole("link", { name: "How CMS defines scope & severity" }),
  ).toHaveAttribute("href", evidence.scopeSeverityGuideUrl);
  const more = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/evidence" &&
      new URL(response.url()).searchParams.get("ccn") === ccn &&
      new URL(response.url()).searchParams.get("limit") === "10",
  );
  await history.getByRole("button", { name: "Show 5 more findings" }).click();
  expect((await more).status()).toBe(200);
  await expect(history.locator("article.source-item")).toHaveCount(10);
  await noDocumentOverflow(page);
  await detail.getByRole("button", { name: "Close dialog" }).click();

  let failEvidence = true;
  await page.route("**/api/evidence?*", async (route) => {
    if (failEvidence) {
      await route.fulfill({
        status: 503,
        json: { error: "Controlled transient error for recovery test" },
      });
    } else await route.continue();
  });
  await card(page, provider)
    .getByRole("button", { name: "View details" })
    .click();
  await detail.getByRole("tab", { name: "Details", exact: true }).click();
  await detail.getByText("Care quality & inspections", { exact: true }).click();
  await expect(history.getByRole("alert")).toContainText("could not be loaded");
  await expect(history.locator("article.source-item")).toHaveCount(0);
  const retry = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/evidence" &&
      response.status() === 200,
  );
  failEvidence = false;
  await history.getByRole("button", { name: "Try again" }).click();
  await retry;
  await expect(history.locator("article.source-item").first()).toContainText(
    latest[0].description,
  );
  await page.unroute("**/api/evidence?*");
  await detail.getByRole("button", { name: "Close dialog" }).click();

  const zero = nursing.providers.find(
    (item) =>
      item.cms &&
      inspectionSnapshot.facilities[item.cms.ccn]?.healthCitations?.total === 0,
  )!;
  expect(zero).toBeDefined();
  const zeroResponse = await request.get("/api/evidence", {
    params: { ccn: zero.cms!.ccn },
  });
  expect(zeroResponse.status()).toBe(200);
  const empty = (await zeroResponse.json()) as InspectionEvidence;
  expect(empty.healthCitations.available).toBe(true);
  expect(empty.healthCitations.total).toBe(0);
  expect(empty.healthCitations.records).toEqual([]);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByPlaceholder("Search by name or town").fill(zero.name);
  const zeroSearch = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("q") === zero.name,
  );
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await zeroSearch;
  await card(page, zero).getByRole("button", { name: "View details" }).click();
  await page
    .getByRole("dialog", { name: zero.name, exact: true })
    .getByRole("tab", { name: "Details", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: zero.name, exact: true })
    .getByText("Care quality & inspections", { exact: true })
    .click();
  const emptyHistory = page
    .getByRole("dialog", { name: zero.name, exact: true })
    .locator(".inspection-history");
  await expect(emptyHistory).toContainText(
    "No health citation rows were present for this CCN in this snapshot. This is not a finding that the home is free of problems.",
  );
  await expect(emptyHistory.locator("article.source-item")).toHaveCount(0);
});

test("continuing-care campuses retain separate identities and label ZIP estimates", async ({
  page,
  request,
}) => {
  const campuses = await searchAPI(request, {
    radius: "50",
    category: "life-plan",
  });
  expect(campuses.providers).toHaveLength(7);
  expect(
    campuses.providers.filter((p) => p.locationKind === "zip"),
  ).toHaveLength(2);
  expect(campuses.providers.every((p) => p.cms === undefined)).toBe(true);
  await openDemo(page);
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category", exact: true })
    .selectOption("life-plan");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.locator(".provider-card")).toHaveCount(7);
  await expect(
    page
      .getByRole("combobox", { name: "Sort results" })
      .locator('option[value="cms-rating"]'),
  ).toHaveCount(0);
  const approximate = campuses.providers.find((p) => p.locationKind === "zip")!;
  await expect(card(page, approximate)).toContainText("ZIP estimate");
  await card(page, approximate)
    .getByRole("button", { name: "View details" })
    .click();
  const detail = page.getByRole("dialog", {
    name: approximate.name,
    exact: true,
  });
  await expect(detail.locator(".cms-ratings")).toHaveCount(0);
  await detail.getByRole("tab", { name: "Details", exact: true }).click();
  await detail.locator(".source-disclosure summary").click();
  await expect(detail.locator(".source-list")).toContainText("Census");
  await expect(detail).toContainText("ZIP");
  await noDocumentOverflow(page);
});

test("a browser storage failure never claims a new shortlist item or note was saved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "harbor.demo.workspace.v1")
        throw new DOMException(
          "Storage unavailable for this test",
          "QuotaExceededError",
        );
      return original.call(this, key, value);
    };
  });
  await openDemo(page);
  await page.getByText("About your workspace", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Demo not saved");
  await page.getByText("About your workspace", { exact: true }).click();
  const body = await searchTenMiles(page);
  const provider = body.providers[0];
  await card(page, provider)
    .getByRole("button", { name: `Save ${provider.name}`, exact: true })
    .click();
  await expect(
    card(page, provider).getByRole("button", {
      name: `Save ${provider.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".page-error")).toContainText(
    "could not save this change",
  );
  await expect(page.locator(".toast")).toHaveCount(0);
  await card(page, provider)
    .getByRole("button", { name: "View details" })
    .click();
  const detail = page.getByRole("dialog", { name: provider.name, exact: true });
  await detail.getByText("Your questions & notes", { exact: true }).click();
  await detail
    .getByRole("textbox", { name: `Notes about ${provider.name}` })
    .fill("Ask about visiting hours.");
  await detail
    .getByRole("button", { name: "Update note", exact: true })
    .click();
  await expect(
    detail.getByRole("button", {
      name: "Note added to workspace",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    detail.locator(".detail-notes").getByRole("status"),
  ).toContainText("could not save this change");
});
