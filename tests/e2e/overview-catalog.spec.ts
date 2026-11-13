import { expect, test, type Page } from "@playwright/test";
import type { IndividualReviewsResponse } from "../../src/lib/individual-reviews";
import type { SearchResponse } from "../../src/lib/providers";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";

async function openOverview(page: Page, zip: string, name: string) {
  await page.goto("/dashboard?demo=1");
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill(zip);
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Provider or town" }).fill(name);
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const card = page.locator(".provider-card").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  return dialog;
}

test("location-only Overview defers readable reviews to the Reviews tab", async ({
  page,
  request,
}, testInfo) => {
  const id = "north-jersey-doh-nj07015";
  const response = await request.get("/api/reviews", { params: { id } });
  expect(response.ok()).toBe(true);
  const catalog: IndividualReviewsResponse = await response.json();
  const readable = catalog.accounts.filter(
    (account) => account.excerpt.trim() || account.summary.trim(),
  );
  expect(readable.length).toBeGreaterThan(0);
  expect(readable.every((account) => !account.excerpt && account.summary)).toBe(
    true,
  );
  let reviewRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/reviews") reviewRequests += 1;
  });
  const dialog = await openOverview(page, "07068", "BENCHMARK AT ROSELAND");
  const overview = dialog.getByRole("region", { name: "Property overview" });
  await expect(overview.getByRole("button")).toHaveCount(0);
  await expect(overview.locator("blockquote")).toHaveCount(0);
  await expect(overview).not.toContainText(/review|research summaries/i);
  expect(reviewRequests).toBe(0);
  const widths = await dialog.evaluate((element) => ({
    width: element.clientWidth,
    contents: element.scrollWidth,
  }));
  expect(widths.contents).toBeLessThanOrEqual(widths.width + 1);
  await page.screenshot({ path: testInfo.outputPath("roseland-overview.png") });
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(
    dialog.getByRole("tab", { name: "Reviews", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".public-reviews article")).toHaveCount(
    catalog.accounts.length,
  );
  expect(reviewRequests).toBeGreaterThan(0);
  for (const account of readable) {
    const review = dialog.locator(".public-reviews article").filter({
      hasText: account.summary,
    });
    await expect(review.locator(".review-summary")).toContainText(
      "Research summary",
    );
    await expect(review.locator("blockquote")).toHaveCount(0);
    await expect(
      review.getByRole("link", { name: /Read the original account/ }),
    ).toHaveAttribute("href", account.url);
  }
});

test("Brooksby keeps its attributed excerpt and concerns in Reviews", async ({
  page,
}, testInfo) => {
  const dialog = await openOverview(page, "02459", "Brooksby Village");
  const overview = dialog.getByRole("region", { name: "Property overview" });
  await expect(overview.locator("blockquote")).toHaveCount(0);
  await expect(overview).not.toContainText(
    /What people say|Selected reviews include concerns/,
  );
  await page.screenshot({ path: testInfo.outputPath("brooksby-overview.png") });
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  const account = dialog.locator(".public-reviews article").filter({
    hasText: "The food is generally awful.",
  });
  await expect(account).toBeVisible();
  await expect(account.locator("blockquote")).toHaveText(
    "“The food is generally awful.”",
  );
  await expect(account.locator(".review-concern")).toBeVisible();
  await account.getByText("Account context", { exact: true }).click();
  await expect(account.locator(".review-meta")).toContainText(
    "Self-described family",
  );
  await expect(account.locator(".review-meta")).toContainText("Caring.com");
  await expect(account.locator(".review-meta")).toContainText("Sep 29, 2025");
  await dialog
    .getByText("How these accounts were selected", { exact: true })
    .click();
  await expect(dialog.locator(".review-sampling")).toContainText(
    "Relationships are self-described, not independently verified.",
  );
  await expect(
    account.getByRole("link", { name: /Read the original account/ }),
  ).toHaveAttribute(
    "href",
    "https://www.caring.com/senior-living/massachusetts/peabody/brooksby-village-peabody-massachusetts-01960",
  );
});

test("destination tabs keep a long supplied excerpt and decimal-price conditions intact", async ({
  page,
}) => {
  const excerpt =
    "This is a deliberately long review fixture, not a published review. The final sentence explains that this account concerns only a short respite stay, not a permanent residence or a different care unit.";
  const price =
    "Independent-living studio: $2,523.50 per month, plus a one-time $750.25 charge. This rate does not cover assisted care. The schedule changes January 1, 2027.";
  await page.route("**/api/research?**", async (route) => {
    const response = await route.fetch();
    const data: LocationResearchResponse = await response.json();
    data.reviews = [{ ...data.reviews[0], excerpt, relationship: "family" }];
    data.facts = [
      ...data.facts.filter((fact) => fact.kind !== "cost"),
      {
        id: "decimal-price-fixture",
        kind: "cost",
        sourceId: data.sources[0].id,
        text: price,
        amount: {
          min: 2523.5,
          max: null,
          currency: "USD",
          period: "month",
          type: "base-rent",
          asOf: null,
        },
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/reviews?**", async (route) => {
    const response = await route.fetch();
    const data: IndividualReviewsResponse = await response.json();
    data.accounts = [{ ...data.accounts[0], excerpt, relationship: "family" }];
    await route.fulfill({ response, json: data });
  });
  const dialog = await openOverview(page, "02459", "Brooksby Village");
  const overview = dialog.getByRole("region", { name: "Property overview" });
  await expect(overview.locator("blockquote")).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(dialog.locator(".public-reviews blockquote")).toHaveText([
    `“${excerpt}”`,
  ]);
  await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(overview).not.toContainText(price);
  await dialog.getByRole("tab", { name: "Costs & perks", exact: true }).click();
  const cost = dialog.locator(".fact-cost");
  await expect(cost.locator("p")).toHaveText(price);
  await expect(cost).toBeVisible();
});

for (const scenario of [
  {
    name: "link-only",
    counts: { total: 3, withText: 0 },
  },
  { name: "mixed", counts: { total: 3, withText: 2 } },
  {
    name: "unknown",
    counts: undefined,
  },
]) {
  test(`Overview omits ${scenario.name} review coverage and counts`, async ({
    page,
  }) => {
    await page.route("**/api/search?**", async (route) => {
      const response = await route.fetch();
      const result: SearchResponse = await response.json();
      for (const provider of result.providers) {
        if (provider.id === "north-jersey-doh-nj07015" && provider.research) {
          provider.research.individualReviews = scenario.counts;
        }
      }
      await route.fulfill({ response, json: result });
    });
    const dialog = await openOverview(page, "07068", "BENCHMARK AT ROSELAND");
    const overview = dialog.getByRole("region", { name: "Property overview" });
    await expect(overview.getByRole("button")).toHaveCount(0);
    await expect(overview.locator("blockquote")).toHaveCount(0);
    await expect(overview).not.toContainText(
      /review|research summaries|What people say/i,
    );
  });
}

for (const location of [
  {
    name: "VISITING HEALTH SERVICES OF NEW JERSEY",
    zip: "07960",
    address: "3 GARRET MOUNTAIN PLAZA, SUITE 400, WOODLAND PARK, NJ 07424",
    street: "3 GARRET MOUNTAIN PLAZA",
    office: true,
  },
  {
    name: "Brooksby Village",
    zip: "02459",
    address: "100 Brooksby Village Drive, Peabody, MA 01960",
    street: "100 Brooksby Village Drive",
    office: false,
  },
  {
    name: "All Care VNA, Hospice and Private Care",
    zip: "02459",
    address: "210 Market Street, Lynn, MA 01901",
    street: "210 Market Street",
    office: true,
  },
]) {
  test(`Overview starts with the published location and useful directions for ${location.name}`, async ({
    page,
  }) => {
    const dialog = await openOverview(page, location.zip, location.name);
    const overview = dialog.getByRole("region", { name: "Property overview" });
    await expect(overview.locator(":scope > div").first()).toHaveClass(
      "overview-location",
    );
    await expect(overview.locator(".overview-address")).toHaveText(
      location.address,
    );
    await expect(dialog.locator(".detail-header")).not.toContainText(
      location.street,
    );
    const directions = overview.getByRole("link", {
      name: location.office ? "Get directions to the office" : "Get directions",
      exact: true,
    });
    await expect(directions).toHaveAttribute(
      "href",
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location.address)}`,
    );
    await expect(directions).toHaveAttribute("target", "_blank");
    const dimensions = await directions.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      fontSize: parseFloat(getComputedStyle(element).fontSize),
    }));
    expect(dimensions.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.fontSize).toBeGreaterThanOrEqual(16);
    if (location.office) {
      await expect(overview).toContainText(
        "An office that arranges care, not a residential community.",
      );
    } else {
      await expect(overview).toContainText(
        "Directions use the published street address.",
      );
      await expect(overview).not.toContainText("not a residential");
    }
    await expect(overview).not.toContainText(
      /entrances|visitor transport|travel times|travel charges/i,
    );
    await expect(overview.getByRole("button")).toHaveCount(0);
    const source = overview.getByRole("link", { name: /Location source/ });
    await expect(source).toHaveCSS("font-size", "13px");
    await expect(overview.locator(".overview-address")).toHaveCSS(
      "font-size",
      "16px",
    );
    await expect(
      overview.locator(
        ".daily-life, .fact-cost, .fact-room, .overview-terms, .overview-rate",
      ),
    ).toHaveCount(0);
  });
}

test("a missing street address never becomes directions to an inferred locality", async ({
  page,
}) => {
  await page.route("**/api/search?**", async (route) => {
    const response = await route.fetch();
    const result: SearchResponse = await response.json();
    for (const provider of result.providers) {
      if (provider.id === "all-care") provider.address = "";
    }
    await route.fulfill({ response, json: result });
  });
  const dialog = await openOverview(
    page,
    "02459",
    "All Care VNA, Hospice and Private Care",
  );
  const location = dialog.locator(".overview-location");
  await expect(location).toContainText("A street address is not established.");
  await expect(
    location.getByRole("link", { name: /Get directions/ }),
  ).toHaveCount(0);
});

for (const entry of [
  { id: "cms-317058", zip: "07960", office: true },
  { id: "north-jersey-hp-hp0144800", zip: "07632", office: true },
  { id: "lifeplan-brooksby-village", zip: "02459", office: false },
]) {
  test(`ZIP precision preserves the care setting across tabs for ${entry.id}`, async ({
    page,
    request,
  }) => {
    const results: SearchResponse = await (
      await request.get("/api/search", {
        params: { zip: entry.zip, radius: "50" },
      })
    ).json();
    const provider = results.providers.find(({ id }) => id === entry.id)!;
    expect(provider).toBeDefined();
    expect(provider.locationKind).toBe("zip");
    const dialog = await openOverview(page, entry.zip, provider.name);
    const location = dialog.locator(".overview-location");
    await expect(
      location.getByRole("heading", {
        name: entry.office ? "Service location & access" : "Location & access",
        exact: true,
      }),
    ).toBeVisible();
    await expect(location).toContainText(
      "Exact location point not confirmed; distance and map use ZIP area estimate.",
    );
    await expect(location).not.toContainText("campus");
    await dialog
      .getByRole("tab", { name: "Costs & perks", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", {
        name: entry.office
          ? "How care is delivered"
          : "Room types & living arrangements",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.locator(".research-question li")).toHaveText(
      entry.office
        ? [
            "Hourly or visit rates and minimum shifts.",
            "Overnight or live-in charges and nursing fees.",
            "Cancellation terms and what insurance covers.",
          ]
        : [
            "Room or rent, assessed care and medication support.",
            "Second-person fees, deposits and annual increases.",
            "Refund terms and any minimum stay.",
          ],
    );
    if (entry.office) {
      await expect(dialog).toContainText(
        "Care is arranged through an office, not a residential room.",
      );
      await expect(dialog.locator(".daily-life-gaps")).toContainText(
        "meal preparation; companionship & outings; transport arrangements",
      );
    } else {
      await expect(
        dialog.getByRole("heading", { name: "Everyday comforts & transport" }),
      ).toBeVisible();
      await expect(dialog).not.toContainText(
        "Care is arranged through an office",
      );
    }
    await dialog.getByRole("tab", { name: "Details", exact: true }).click();
    await expect(
      dialog
        .getByRole("region", { name: "Availability", exact: true })
        .locator(".research-question li"),
    ).toHaveText(
      entry.office
        ? [
            "Service at your address and care needs.",
            "Staff availability, start date and minimum shifts.",
            "Assessment requirements.",
          ]
        : [
            "Care level, room type and move-in window.",
            "Assessment requirements and waitlist position.",
            "Refundable deposit and how long a room can be held.",
          ],
    );
    await expect(dialog.locator(".daily-life-gaps")).toContainText(
      entry.office
        ? "Confirm the assigned roles, visit length and backup coverage."
        : "Ask for staffing by role and shift, including overnight coverage.",
    );
  });
}

test("a published PO box is preserved without directions to a guessed office", async ({
  page,
}) => {
  const dialog = await openOverview(
    page,
    "07632",
    "GARDEN STATE HOME CARE SERVICES LLC",
  );
  const location = dialog.locator(".overview-location");
  await expect(location).toContainText(
    "P.O. BOX 1131, ENGLEWOOD CLIFFS, NJ 07632",
  );
  await expect(location).toContainText("Mailing address only.");
  await expect(location).toContainText(
    "A service-area listing, not a verified residential location.",
  );
  await expect(location).not.toContainText("campus");
  await expect(
    location.getByRole("link", { name: /Get directions/ }),
  ).toHaveCount(0);
});

for (const state of ["loading", "failed", "wrong-provider"] as const) {
  test(`published location stays useful when research is ${state}`, async ({
    page,
  }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      "**/api/research?id=lifeplan-brooksby-village",
      async (route) => {
        if (state === "failed") {
          await route.fulfill({
            status: 503,
            json: { error: "Controlled research failure" },
          });
        } else {
          const response = await route.fetch();
          const data: LocationResearchResponse = await response.json();
          if (state === "loading") await gate;
          else data.providerId = "another-provider";
          await route.fulfill({ response, json: data });
        }
      },
    );
    const dialog = await openOverview(page, "02459", "Brooksby Village");
    const location = dialog.locator(".overview-location");
    await expect(location.locator(".overview-address")).toHaveText(
      "100 Brooksby Village Drive, Peabody, MA 01960",
    );
    await expect(
      location.getByRole("link", { name: "Get directions", exact: true }),
    ).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=100%20Brooksby%20Village%20Drive%2C%20Peabody%2C%20MA%2001960",
    );
    await expect(
      dialog
        .getByRole("region", { name: "Property overview" })
        .getByRole("button"),
    ).toHaveCount(0);
    await expect(
      dialog.locator(".overview-experience, .property-overview blockquote"),
    ).toHaveCount(0);
    if (state === "loading") {
      await expect(
        dialog.locator(".location-research [role=status]"),
      ).toContainText("Loading");
      release();
      await expect(
        dialog.locator(".location-research [role=status]"),
      ).toHaveCount(0);
      await expect(location.locator(".overview-address")).toHaveText(
        "100 Brooksby Village Drive, Peabody, MA 01960",
      );
    } else {
      await expect(
        dialog.locator(".location-research [role=alert]"),
      ).toContainText(
        state === "failed"
          ? "could not be loaded"
          : "did not match this location",
      );
    }
  });
}
