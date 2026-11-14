import { expect, test, type Page } from "@playwright/test";
import { getMarket } from "../../src/lib/markets";
import type { LocationDescriptionResponse } from "../../src/lib/location-description-types";
import { CATEGORY_LABELS, type Provider } from "../../src/lib/providers";
import { evidenceDate } from "../../src/components/evidence-date";

test.describe.configure({ timeout: 45_000 });
const campusId = "north-jersey-campus-cedar-crest-village-07444";
const unitId = "cms-315491";
const officeId = "cms-317058";
const providers = getMarket("north-jersey")!.providers;
const campus = providers.find(({ id }) => id === campusId)!;
const unit = providers.find(({ id }) => id === unitId)!;
const office = providers.find(({ id }) => id === officeId)!;

function description(
  provider: Provider,
  scope: LocationDescriptionResponse["scope"],
  basis: LocationDescriptionResponse["basis"] = "provider",
): LocationDescriptionResponse {
  return {
    schemaVersion: 1,
    marketId: "north-jersey",
    checkedAt: "2026-11-13",
    providerId: provider.id,
    summary: `This description applies only to ${provider.name}.`,
    scope,
    basis,
    sources: [
      {
        url: provider.sources[0].url,
        publisher: provider.sources[0].publisher,
        title: provider.sources[0].title,
        checkedAt: "2026-11-13",
      },
    ],
    limitations: [
      "Current availability is not established by this description.",
    ],
  };
}

async function search(page: Page, zip = "07960", name = "Cedar Crest") {
  await page.goto("/dashboard?demo=1");
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill(zip);
  await page
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Provider or town" }).fill(name);
  const loaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/search" && url.searchParams.get("q") === name;
  });
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await loaded;
  await expect(page.locator(".result-skeleton")).toHaveCount(0);
}

async function openProfile(page: Page, provider: Provider) {
  const card = page
    .locator(".provider-card")
    .filter({
      has: page.getByRole("button", { name: provider.name, exact: true }),
    })
    .filter({
      has: page.getByText(CATEGORY_LABELS[provider.category], { exact: true }),
    })
    .filter({
      has: page.locator(".provider-address").filter({ hasText: provider.zip }),
    });
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: provider.name, exact: true });
  await expect(
    dialog.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  return dialog;
}

test("the published sidecar loads one real campus description directly before location and access", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/api/location-description", {
    params: { id: campusId },
  });
  expect(response.status()).toBe(200);
  const data: LocationDescriptionResponse = await response.json();
  expect(data.providerId).toBe(campusId);
  expect(data.scope).toBe("campus");
  expect(data).not.toHaveProperty("locations");
  await search(page);
  const dialog = await openProfile(page, campus);
  const section = dialog.getByRole("region", { name: "Location description" });
  await expect(section.getByText(data.summary, { exact: true })).toBeVisible();
  await expect(
    section.getByRole("heading", { name: "Provider description", exact: true }),
  ).toBeVisible();
  for (const source of data.sources) {
    const link = section
      .locator("a")
      .filter({
        hasText: `Description source · ${source.publisher} · checked ${evidenceDate(source.checkedAt)}`,
      })
      .and(section.locator(`a[href="${source.url}"]`));
    await expect(link).toHaveAttribute("href", source.url);
    await expect(link).toHaveAttribute("title", source.title);
    await expect(link).toHaveAttribute("target", "_blank");
  }
  await section.getByText("Source limitations", { exact: true }).click();
  for (const limitation of data.limitations)
    await expect(section.getByText(limitation, { exact: true })).toBeVisible();
  expect(
    await section.evaluate((element) =>
      element.nextElementSibling?.classList.contains("overview-location"),
    ),
  ).toBe(true);
  const width = await dialog.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  await page.screenshot({
    path: testInfo.outputPath("campus-description.png"),
  });
});

for (const id of [
  "cms-317008",
  unitId,
  "north-jersey-hp-hp0144800",
  "north-jersey-hp-hp0015318",
]) {
  test(`the real published ${id} description preserves location safeguards`, async ({
    page,
    request,
  }, testInfo) => {
    const provider = providers.find((p) => p.id === id)!;
    const response = await request.get("/api/location-description", {
      params: { id },
    });
    expect(response.status()).toBe(200);
    const data: LocationDescriptionResponse = await response.json();
    expect(data.providerId).toBe(id);
    expect(data.basis).toBe(
      ["cms-317008", "north-jersey-hp-hp0015318"].includes(id)
        ? "provider"
        : "official-listing",
    );
    await search(page, provider.zip, provider.name);
    const dialog = await openProfile(page, provider);
    const section = dialog.getByRole("region", {
      name: "Location description",
    });
    await expect(
      section.getByText(data.summary, { exact: true }),
    ).toBeVisible();
    await expect(section).toContainText(
      "Current care availability is not established.",
    );
    await expect(section.locator("a")).toHaveCount(data.sources.length);
    if (data.limitations.length) {
      await expect(
        section.getByText(data.limitations[0], { exact: true }),
      ).not.toBeVisible();
      const disclosure = section.getByText("Source limitations", {
        exact: true,
      });
      await disclosure.focus();
      await page.keyboard.press("Enter");
      await expect(
        section.getByText(data.limitations[0], { exact: true }),
      ).toBeVisible();
    }
    const overview = dialog.getByRole("region", { name: "Property overview" });
    if (data.scope === "service-area") {
      await expect(overview).toContainText("Mailing address only.");
      await expect(
        overview.getByRole("link", { name: /Get directions/ }),
      ).toHaveCount(0);
    } else if (data.scope === "agency-office") {
      await expect(overview).toContainText(
        "Agency office, not a residential community.",
      );
      await expect(
        overview.getByRole("link", {
          name: "Get directions to the office",
          exact: true,
        }),
      ).toBeVisible();
    } else {
      await expect(overview).toContainText("Facility description.");
      await expect(overview).not.toContainText("Campus description.");
    }
    const width = await dialog.evaluate((e) => ({
      client: e.clientWidth,
      scroll: e.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    await page.screenshot({
      path: testInfo.outputPath(`${id}-description.png`),
    });
  });
}

test("campus and nursing-unit descriptions keep their own identity and explicit scope", async ({
  page,
}) => {
  const responses = new Map([
    [campusId, description(campus, "campus")],
    [unitId, description(unit, "facility")],
  ]);
  await page.route("**/api/location-description?**", (route) =>
    route.fulfill({
      json: responses.get(
        new URL(route.request().url()).searchParams.get("id")!,
      ),
    }),
  );
  await search(page);
  let dialog = await openProfile(page, campus);
  const section = () =>
    dialog.getByRole("region", { name: "Location description" });
  await expect(section()).toContainText(responses.get(campusId)!.summary);
  await expect(section()).toContainText(
    "Campus description. Individual care units may differ.",
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  dialog = await openProfile(page, unit);
  await expect(section()).toContainText(responses.get(unitId)!.summary);
  await expect(section()).toContainText("Facility description.");
  await expect(section()).not.toContainText(responses.get(campusId)!.summary);
  await expect(section()).not.toContainText("Campus description.");
});

test("an agency office retains office directions and safeguards even with ZIP-level precision", async ({
  page,
}) => {
  expect(office.locationKind).toBe("zip");
  const data = description(office, "agency-office");
  await page.route("**/api/location-description?**", (route) =>
    route.fulfill({ json: data }),
  );
  await search(page, "07960", office.name);
  const dialog = await openProfile(page, office);
  const overview = dialog.getByRole("region", { name: "Property overview" });
  await expect(overview).toContainText(data.summary);
  await expect(overview).toContainText(
    "Agency office, not a residential community.",
  );
  await expect(overview).toContainText(
    "An office that arranges care, not a residential community.",
  );
  await expect(overview).toContainText(
    "Exact location point not confirmed; distance and map use ZIP area estimate.",
  );
  await expect(
    overview.getByRole("link", {
      name: "Get directions to the office",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    overview.getByRole("heading", { name: "Service location & access" }),
  ).toBeVisible();
});

test("official-listing fallback discloses limited facts and service-area scope", async ({
  page,
}) => {
  const data = description(office, "service-area", "official-listing");
  await page.route("**/api/location-description?**", (route) =>
    route.fulfill({ json: data }),
  );
  await search(page, "07960", office.name);
  const dialog = await openProfile(page, office);
  const section = dialog.getByRole("region", { name: "Location description" });
  await expect(section).toContainText(data.summary);
  await expect(
    section.getByRole("heading", { name: "Official listing description" }),
  ).toBeVisible();
  await expect(section).toContainText(
    "Limited to facts in an official listing, not a provider-authored description.",
  );
  await expect(section).toContainText(
    "Service-area description, not a verified visitable location.",
  );
  await section.getByText("Source limitations", { exact: true }).click();
  await expect(
    section.getByText(data.limitations[0], { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("heading", { name: "Provider description", exact: true }),
  ).toHaveCount(0);
});

test("missing descriptions stay hidden while unknown providers return a real 404", async ({
  page,
  request,
}) => {
  const missing = await request.get(
    "/api/location-description?id=north-jersey-unknown-provider",
  );
  expect(missing.status()).toBe(404);
  await page.route("**/api/location-description?**", (route) =>
    route.fulfill({
      status: 404,
      json: { error: "No description is published." },
    }),
  );
  await search(page);
  const loaded = page.waitForResponse("**/api/location-description?**");
  const dialog = await openProfile(page, campus);
  await loaded;
  await expect(
    dialog.getByRole("region", { name: "Location description" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("heading", { name: "Location & access", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Retry location description" }),
  ).toHaveCount(0);
});

for (const failure of [
  "network",
  "wrong-ID",
  "HTTP",
  "invalid-JSON",
  "unsafe-source",
] as const) {
  test(`${failure} failure never displays a description and recovers with retry`, async ({
    page,
  }) => {
    let requests = 0;
    let recover = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const data = description(campus, "campus");
    await page.route("**/api/location-description?**", async (route) => {
      requests += 1;
      if (!recover) {
        if (failure === "network") return route.abort("failed");
        if (failure === "wrong-ID")
          return route.fulfill({ json: { ...data, providerId: unitId } });
        if (failure === "HTTP") return route.fulfill({ status: 503 });
        if (failure === "invalid-JSON")
          return route.fulfill({ contentType: "application/json", body: "{" });
        return route.fulfill({
          json: {
            ...data,
            sources: [{ ...data.sources[0], url: "javascript:alert(1)" }],
          },
        });
      }
      await held;
      return route.fulfill({ json: data });
    });
    await search(page);
    const dialog = await openProfile(page, campus);
    const retry = dialog.getByRole("button", {
      name: "Retry location description",
    });
    await expect(retry).toBeVisible();
    await expect(dialog).toContainText(
      "The location description could not be loaded.",
    );
    await expect(dialog.getByText(data.summary, { exact: true })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole("heading", { name: "Location & access", exact: true }),
    ).toBeVisible();
    const failedRequests = requests;
    recover = true;
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(
      dialog.getByRole("region", { name: "Location description" }),
    ).toHaveCount(0);
    release();
    await expect(dialog.getByText(data.summary, { exact: true })).toBeVisible();
    await expect(retry).toHaveCount(0);
    expect(requests).toBe(failedRequests + 1);
  });
}

test("switching providers aborts an in-flight description and cannot show a late response in another profile", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finished!: () => void;
  const delivered = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let aborted!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const first = description(campus, "campus");
  const second = description(unit, "facility");
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/location-description" &&
      url.searchParams.get("id") === campusId
    )
      aborted();
  });
  await page.route("**/api/location-description?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("id") === campusId) {
      started();
      await held;
      try {
        await route.fulfill({ json: first });
      } finally {
        finished();
      }
    } else await route.fulfill({ json: second });
  });
  await search(page);
  const firstDialog = await openProfile(page, campus);
  await requested;
  await expect(
    firstDialog.getByRole("region", { name: "Location description" }),
  ).toHaveCount(0);
  await firstDialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const dialog = await openProfile(page, unit);
  await expect(dialog.getByText(second.summary, { exact: true })).toBeVisible();
  release();
  await delivered;
  await cancelled;
  await expect(dialog.getByText(second.summary, { exact: true })).toBeVisible();
  await expect(dialog.getByText(first.summary, { exact: true })).toHaveCount(0);
});

test("Massachusetts profiles keep their overview and do not request the NJ sidecar", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/location-description")
      requests += 1;
  });
  const provider = getMarket()!.providers.find(
    ({ id }) => id === "lifeplan-brooksby-village",
  )!;
  await search(page, "02459", provider.name);
  const dialog = await openProfile(page, provider);
  await expect(
    dialog.getByRole("heading", { name: "Location & access", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Get directions", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("region", { name: "Location description" }),
  ).toHaveCount(0);
  expect(requests).toBe(0);
});
