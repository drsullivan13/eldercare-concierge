import { expect, test, type Locator, type Page } from "@playwright/test";
import reviewedData from "../../src/data/reviewed-home-care-descriptions.json";
import regionalData from "../../src/data/regional-markets.json";
import legacyDescriptions from "../../src/data/location-descriptions.json";
import { getMarket } from "../../src/lib/markets";
import type { LocationDescriptionResponse } from "../../src/lib/location-description-types";
import type {
  Provider,
  CompactSearchResponse,
  SearchResponse,
} from "../../src/lib/providers";
import { evidenceDate } from "../../src/components/evidence-date";
import { openSavedRegistryListing } from "./saved-registry-listing";

const reviewed: Record<
  string,
  { text: string; source: string; checkedAt: string }
> = reviewedData;
const rawProviders = regionalData.find(
  (market) => market.id === "north-jersey",
)!.providers as Provider[];
const homeCare = rawProviders.filter(
  (provider) => provider.category === "home-care",
);
const office = homeCare.find(({ id }) => id === "north-jersey-hp-hp0015318")!;
const mailing = homeCare.find(({ id }) => id === "north-jersey-hp-hp0144800")!;
const previous: Record<string, { summary: string }> =
  legacyDescriptions.locations;
const fixtureText =
  "Browser fixture: this exact agency office arranges help with daily routines at home.";
const fixtureSource = "https://example.org/reviewed-office";

function reviewedFixture(provider: Provider): LocationDescriptionResponse {
  return {
    schemaVersion: 1,
    marketId: "north-jersey",
    providerId: provider.id,
    checkedAt: "2026-11-25",
    summary: fixtureText,
    basis: "provider",
    scope: provider === mailing ? "service-area" : "agency-office",
    sources: [
      {
        url: fixtureSource,
        title: "Reviewed exact-office fixture",
        publisher: provider.name,
        checkedAt: "2026-11-25",
      },
    ],
    limitations: [],
  };
}

async function noLegacyDescription(container: Locator, provider: Provider) {
  await expect(container).not.toContainText(provider.description);
  if (previous[provider.id])
    await expect(container).not.toContainText(previous[provider.id].summary);
  await expect(container.locator(".detail-description")).toHaveCount(0);
  await expect(
    container.getByRole("heading", {
      name: "Official listing description",
      exact: true,
    }),
  ).toHaveCount(0);
}

async function officeFacts(dialog: Locator, provider: Provider) {
  await expect(dialog.locator(".overview-address")).toContainText(
    provider.address,
  );
  await expect(dialog.locator(".overview-address")).toContainText(
    `${provider.city}, NJ ${provider.zip}`,
  );
  await expect(
    dialog.locator(`a[href="tel:${provider.phone!.replace(/[^+\d]/g, "")}"]`),
  ).toBeVisible();
  if (provider.website)
    await expect(
      dialog.getByRole("link", { name: "Visit website", exact: true }),
    ).toHaveAttribute("href", provider.website);
  const overview = dialog.getByRole("region", { name: "Property overview" });
  if (provider === mailing) {
    await expect(overview).toContainText("Mailing address only.");
    await expect(
      overview.getByRole("link", { name: /Get directions/ }),
    ).toHaveCount(0);
  } else {
    await expect(overview).toContainText(
      "An office that arranges care, not a residential community.",
    );
    await expect(
      overview.getByRole("link", {
        name: "Get directions to the office",
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(overview).toContainText(
    "Office proximity does not confirm service at your address or staff availability.",
  );
}

async function fixtureSearch(
  page: Page,
  provider: Provider,
  description: LocationDescriptionResponse | null,
  fullSearchFallback = false,
) {
  const record = { ...provider, locationDescription: description };
  let lookups = 0;
  await page.route("**/api/providers?**", (route) => {
    if (new URL(route.request().url()).searchParams.get("ids") !== provider.id)
      return route.continue();
    lookups += 1;
    return route.fulfill({ json: { providers: [record] } });
  });
  await page.route("**/api/search?**", async (route) => {
    const response = await route.fetch();
    const result: SearchResponse = await response.json();
    const card = {
      id: provider.id,
      name: provider.name,
      category: provider.category,
      city: provider.city,
      state: provider.state,
      zip: provider.zip,
      lat: provider.lat,
      lng: provider.lng,
      locationKind: provider.locationKind,
      services: provider.services,
      warnings: provider.warnings,
      ...(description && {
        locationDescription: { summary: description.summary },
      }),
      distanceMiles: 0,
      coreqPercent: null,
    };
    await route.fulfill({
      response,
      json: {
        ...result,
        providers: [
          fullSearchFallback ? { ...record, distanceMiles: 0 } : card,
        ],
        total: 1,
        markers: [card],
        pagination: { page: 1, pageSize: 18, totalPages: 1, hasMore: false },
      },
    });
  });
  await page.goto("/dashboard?demo=1");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find in-home care", exact: true })
    .click();
  const card = page.locator(".care-search-view .provider-card");
  await expect(card).toHaveCount(1);
  await expect(card).not.toContainText(provider.description);
  if (description)
    await expect(card.locator(".provider-description")).toHaveText(
      description.summary,
    );
  else await expect(card.locator(".provider-description")).toHaveCount(0);
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: provider.name, exact: true });
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  expect(lookups).toBe(fullSearchFallback ? 0 : 1);
  return dialog;
}

test("live NJ home-care publication coverage, response shape and missing 404 follow the reviewed file", async ({
  request,
}) => {
  expect(
    Object.keys(reviewed).every((id) =>
      homeCare.some((provider) => provider.id === id),
    ),
  ).toBe(true);
  const selected = homeCare.filter(
    (provider) =>
      Object.hasOwn(reviewed, provider.id) ||
      provider.id === office.id ||
      provider.id === mailing.id,
  );
  const batches = Array.from(
    { length: Math.ceil(selected.length / 100) },
    (_, index) => selected.slice(index * 100, (index + 1) * 100),
  );
  await Promise.all(
    batches.map(async (batch) => {
      const response = await request.get("/api/providers", {
        params: {
          ids: batch.map(({ id }) => id).join(","),
          market: "north-jersey",
        },
      });
      expect(response.status()).toBe(200);
      const result: { providers: Provider[] } = await response.json();
      expect(result.providers.map(({ id }) => id).sort()).toEqual(
        batch.map(({ id }) => id).sort(),
      );
      for (const provider of result.providers) {
        const publication = reviewed[provider.id];
        expect(provider.description).toBe(publication?.text ?? "");
        if (publication)
          expect(provider.locationDescription).toMatchObject({
            summary: publication.text,
            basis: "provider",
            checkedAt: publication.checkedAt,
            sources: [expect.objectContaining({ url: publication.source })],
          });
        else expect(provider.locationDescription).toBeNull();
        const original = batch.find(({ id }) => id === provider.id)!;
        for (const field of [
          "address",
          "city",
          "state",
          "zip",
          "phone",
          "website",
          "services",
          "sources",
        ] as const)
          expect(provider[field]).toEqual(original[field]);
      }
    }),
  );
  const scopes = new Set<string>();
  const publications = Object.entries(reviewed).filter(([id]) => {
    const provider = homeCare.find((entry) => entry.id === id)!;
    const scope = /\bP\.?\s*O\.?\s*BOX\b|\bPOST OFFICE BOX\b/i.test(
      provider.address,
    )
      ? "service-area"
      : "agency-office";
    if (scopes.has(scope)) return false;
    scopes.add(scope);
    return true;
  });
  for (let start = 0; start < publications.length; start += 8) {
    await Promise.all(
      publications.slice(start, start + 8).map(async ([id, publication]) => {
        const response = await request.get("/api/location-description", {
          params: { id },
        });
        expect(response.status()).toBe(200);
        const data: LocationDescriptionResponse = await response.json();
        expect(Object.keys(data).sort()).toEqual(
          [
            "schemaVersion",
            "marketId",
            "providerId",
            "checkedAt",
            "summary",
            "basis",
            "scope",
            "sources",
            "limitations",
          ].sort(),
        );
        expect(data).toMatchObject({
          schemaVersion: 1,
          marketId: "north-jersey",
          providerId: id,
          summary: publication.text,
          checkedAt: publication.checkedAt,
          basis: "provider",
        });
        expect(["agency-office", "service-area"]).toContain(data.scope);
        expect(data.sources).toEqual([
          expect.objectContaining({
            url: publication.source,
            checkedAt: publication.checkedAt,
          }),
        ]);
      }),
    );
  }
  const missing = homeCare.find(({ id }) => !Object.hasOwn(reviewed, id));
  test.skip(!missing, "Every published NJ home-care office has reviewed text.");
  const response = await request.get("/api/location-description", {
    params: { id: missing!.id },
  });
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: expect.any(String) });
});

for (const responseMode of ["full", "compact", "cards"] as const) {
  test(`live ${responseMode} search does not leak legacy NJ home-care descriptions`, async ({
    request,
  }) => {
    const response = await request.get("/api/search", {
      params: {
        zip: "07087",
        radius: "50",
        category: "home-care",
        q: "BAYADA",
        ...(responseMode === "full" ? {} : { response: responseMode }),
      },
    });
    expect(response.status()).toBe(200);
    const result: CompactSearchResponse = await response.json();
    expect(result.providers.length).toBeGreaterThan(0);
    for (const provider of result.providers) {
      expect(provider.category).toBe("home-care");
      if (responseMode === "cards") {
        expect(provider).not.toHaveProperty("description");
        const publication = reviewed[provider.id];
        if (publication)
          expect(provider.locationDescription).toEqual({
            summary: publication.text,
          });
        else expect(provider).not.toHaveProperty("locationDescription");
      } else {
        expect(provider.description).toBe(reviewed[provider.id]?.text ?? "");
      }
    }
    for (const marker of result.markers ?? []) {
      expect(marker).not.toHaveProperty("description");
      expect(marker).not.toHaveProperty("locationDescription");
    }
  });
}

for (const provider of [office, mailing]) {
  test(`reviewed-present route fixture shows sourced ${provider === office ? "office" : "service-area"} text in Overview and Details`, async ({
    page,
  }) => {
    const data = reviewedFixture(provider);
    const dialog = await fixtureSearch(page, provider, data);
    await officeFacts(dialog, provider);
    for (const pane of ["Overview", "Details"] as const) {
      await dialog.getByRole("tab", { name: pane, exact: true }).click();
      const section = dialog.getByRole("region", {
        name: "Location description",
      });
      await expect(
        section.getByRole("heading", {
          name: "Provider description",
          exact: true,
        }),
      ).toBeVisible();
      await expect(section).toContainText(fixtureText);
      await expect(section).toContainText(
        provider === mailing
          ? "Service-area description, not a verified visitable location."
          : "Agency office, not a residential community.",
      );
      const source = section.getByRole("link", {
        name: `Description source · ${provider.name} · checked ${evidenceDate(data.checkedAt)}`,
        exact: true,
      });
      await expect(source).toHaveAttribute("href", fixtureSource);
      await expect(source).toHaveAttribute("title", data.sources[0].title);
      await noLegacyDescription(dialog, provider);
    }
  });
}

for (const fullSearchFallback of [false, true]) {
  for (const failure of ["missing", "HTTP", "network"] as const) {
    test(`missing reviewed text with ${failure} research omits legacy through ${fullSearchFallback ? "full-search fallback" : "card hydration"} including About provider`, async ({
      page,
    }) => {
      let failedResearch = 0;
      await page.route("**/api/research?**", (route) => {
        failedResearch += 1;
        return failure === "network"
          ? route.abort("failed")
          : route.fulfill({
              status: failure === "missing" ? 404 : 503,
              json: { error: "Fixture research unavailable." },
            });
      });
      const dialog = await fixtureSearch(
        page,
        office,
        null,
        fullSearchFallback,
      );
      await expect(
        dialog.getByRole("button", {
          name: "Retry location research",
          exact: true,
        }),
      ).toBeVisible();
      expect(failedResearch).toBeGreaterThan(0);
      await officeFacts(dialog, office);
      await expect(
        dialog.getByRole("region", { name: "Location description" }),
      ).toHaveCount(0);
      await noLegacyDescription(dialog, office);
      await dialog.getByRole("tab", { name: "Details", exact: true }).click();
      await noLegacyDescription(dialog, office);
      await expect(
        dialog.getByRole("region", { name: "Location description" }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("heading", {
          name: "About this provider",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("link", { name: "Visit website", exact: true }),
      ).toHaveAttribute("href", office.website!);
    });
  }
}

test("a live missing home-care description stays omitted when opened from the saved shortlist", async ({
  page,
}) => {
  const provider = [office, mailing, ...homeCare].find(
    ({ id }) => !Object.hasOwn(reviewed, id),
  );
  test.skip(
    !provider,
    "Every published NJ home-care office has reviewed text.",
  );
  const dialog = await openSavedRegistryListing(
    page,
    provider!.id,
    provider!.name,
  );
  await expect(
    dialog.getByRole("region", { name: "Location description" }),
  ).toHaveCount(0);
  await noLegacyDescription(dialog, provider!);
  await dialog.getByRole("tab", { name: "Details", exact: true }).click();
  await noLegacyDescription(dialog, provider!);
  await expect(
    dialog.getByRole("heading", { name: "About this provider", exact: true }),
  ).toHaveCount(0);
});

test("live reviewed home-care text and its exact source appear in both profile panes", async ({
  page,
}) => {
  const provider = homeCare.find(({ id }) => Object.hasOwn(reviewed, id));
  test.skip(
    !provider,
    "Publication has no reviewed home-care text; route fixtures cover the present state.",
  );
  const publication = reviewed[provider!.id];
  const dialog = await openSavedRegistryListing(
    page,
    provider!.id,
    provider!.name,
  );
  for (const pane of ["Overview", "Details"] as const) {
    await dialog.getByRole("tab", { name: pane, exact: true }).click();
    const section = dialog.getByRole("region", {
      name: "Location description",
    });
    await expect(
      section.getByText(publication.text, { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole("link", {
        name: `Description source · ${provider!.name} · checked ${evidenceDate(publication.checkedAt)}`,
        exact: true,
      }),
    ).toHaveAttribute("href", publication.source);
    await noLegacyDescription(dialog, provider!);
  }
});

test("live non-home-care and Massachusetts descriptions retain their catalog wording", async ({
  request,
}) => {
  const controls = [
    getMarket("north-jersey")!.providers.find(({ id }) => id === "cms-317008")!,
    getMarket("massachusetts")!.providers.find(
      ({ category, description }) => category === "home-care" && description,
    )!,
  ];
  for (const provider of controls) {
    const response = await request.get("/api/providers", {
      params: { ids: provider.id },
    });
    expect(response.status()).toBe(200);
    const result: { providers: Provider[] } = await response.json();
    expect(result.providers[0].description).toBe(provider.description);
    expect(provider.description).not.toBe("");
  }
});
