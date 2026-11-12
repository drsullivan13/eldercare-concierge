import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SearchProvider, SearchResponse } from "../../src/lib/providers";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";
import type { NursingStaffingResearch } from "../../src/lib/nursing-staffing-types";

test.describe.configure({ timeout: 180_000 });

async function openProfile(page: Page, provider: SearchProvider, zip: string) {
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for your family.",
  );
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill(zip);
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
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: provider.name, exact: true }),
  });
  await card.getByRole("button", { name: "View details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: provider.name, exact: true });
  await expect(dialog.locator(".daily-life")).toBeVisible();
  return dialog;
}

async function readableFacts(dialog: Locator) {
  const result = await dialog.locator(".daily-life").evaluate((element) => {
    const scope =
      element.closest(".property-overview") ??
      element.closest(".daily-life-costs") ??
      element;
    const headings =
      element
        .closest(".location-research")
        ?.querySelectorAll(".section-title h3, .section-title > span") ?? [];
    return {
      sizes: [
        ...scope.querySelectorAll("p, a, h4, h5, dt, dd, summary, small"),
        ...headings,
      ].map((node) => parseFloat(getComputedStyle(node).fontSize)),
      width: element.clientWidth,
      scroll: element.scrollWidth,
    };
  });
  expect(result.sizes.every((size) => size >= 16)).toBe(true);
  expect(result.scroll).toBeLessThanOrEqual(result.width + 1);
}

async function staffingDetails(
  dialog: Locator,
  staffing: NursingStaffingResearch,
) {
  const section = dialog.getByRole("region", { name: "CMS staffing hours" });
  await expect(section).toHaveCount(1);
  await expect(section).toContainText(/hours per resident-day/i);
  await expect(section).toContainText("Apr 1, 2026 to Jun 30, 2026");
  await expect(section).toContainText(staffing.staffingPeriod.label);
  for (const [label, key] of [
    ["Total nursing care", "total"],
    ["Registered nurses (RNs)", "rn"],
    ["Licensed practical nurses (LPNs)", "lpn"],
    ["Nurse aides", "aide"],
    ["Weekend total", "weekendTotal"],
    ["Weekend RNs (included in total)", "weekendRn"],
  ] as const) {
    const row = section.locator("dl > div").filter({
      has: dialog.page().getByText(label, { exact: true }),
    });
    const metric = staffing.metrics[key];
    await expect(row).toBeVisible();
    await expect(row.locator("dd")).toHaveText(
      metric.status === "reported"
        ? metric.value.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : metric.status === "suppressed"
          ? "Suppressed by CMS"
          : "Not published",
    );
  }
  const details = section.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("Apr 1, 2025 to Mar 31, 2026");
  await expect(details).toContainText(staffing.turnoverPeriod.label);
  for (const key of ["totalTurnover", "rnTurnover", "census"] as const) {
    const metric = staffing.metrics[key];
    await expect(details).toContainText(
      metric.status === "reported"
        ? `${metric.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}${metric.unit === "percent" ? "%" : ""}`
        : metric.status === "suppressed"
          ? "Suppressed by CMS"
          : "Not published",
    );
  }
  await expect(details).toContainText("not a staff headcount");
  await expect(details).toContainText("not the staffing measurement period");
  for (const metric of Object.values(staffing.metrics)) {
    if (metric.footnote) await expect(details).toContainText(metric.footnote);
  }
  await expect(
    details.getByRole("link", { name: "CMS Provider Information dataset" }),
  ).toHaveAttribute("href", staffing.sourceUrl);
  await readableFacts(dialog);
  await details.locator("summary").click();
}

for (const entry of [
  {
    id: "ma-alr-evans-park-at-newton-corner",
    zip: "02459",
    expected: "Chef-prepared seasonal menus",
  },
  {
    id: "north-jersey-doh-nj13a012",
    zip: "07960",
    expected: "Housekeeping; Laundry Service",
  },
  { id: "cms-315009", zip: "07960", expected: "4.24" },
  { id: "cms-225281", zip: "02459", expected: "Suppressed by CMS" },
  {
    id: "ma-alr-brightview-arlington",
    zip: "02459",
    expected: "three chef-prepared meals daily",
  },
  {
    id: "north-jersey-doh-nj13a021",
    zip: "07960",
    expected: "Three chef-prepared meals daily",
  },
  {
    id: "abc-home-healthcare",
    zip: "02459",
    expected: "managed by nurses and certified geriatric care managers",
  },
]) {
  test(`real ${entry.id} daily life facts, staffing and gaps survive both profile panes`, async ({
    page,
    request,
  }) => {
    const search = await request.get("/api/search", {
      params: { zip: entry.zip, radius: "50" },
    });
    const results: SearchResponse = await search.json();
    const provider = results.providers.find((item) => item.id === entry.id)!;
    expect(provider).toBeDefined();
    const response = await request.get("/api/research", {
      params: { id: entry.id },
    });
    const data: LocationResearchResponse = await response.json();
    const dialog = await openProfile(page, provider, entry.zip);
    await expect(dialog.locator(".overview-life")).toContainText(
      entry.expected,
    );
    await readableFacts(dialog);
    if (data.nursingStaffing) {
      await staffingDetails(dialog, data.nursingStaffing);
      await expect(dialog.locator(".daily-life-gaps")).toContainText(
        "staff-to-resident ratio",
      );
    }
    if (entry.id === "cms-315009") {
      await expect(dialog.locator(".daily-life")).toContainText("0.56");
      await expect(dialog.locator(".daily-life")).toContainText(
        /hours per resident-day/i,
      );
      await expect(dialog.locator(".daily-life")).toContainText(
        "not a simultaneous staff-to-resident ratio",
      );
      await expect(dialog.locator(".daily-life")).toContainText(
        "No source-linked everyday-life offerings",
      );
      await expect(dialog.locator(".daily-life")).toContainText(
        "Licensed practical nurses",
      );
      await expect(dialog.locator(".daily-life")).toContainText(
        "Apr 1, 2026 to Jun 30, 2026",
      );
      await expect(
        dialog.locator(".daily-life").getByRole("link", { name: /CMS · CCN/ }),
      ).toHaveAttribute(
        "href",
        "https://www.medicare.gov/care-compare/details/nursing-home/315009",
      );
    }
    if (entry.id === "cms-225281") {
      await expect(dialog.locator(".daily-life-staffing dd")).toHaveCount(6);
      for (const value of await dialog
        .locator(".daily-life-staffing dd")
        .all()) {
        await expect(value).toHaveText("Suppressed by CMS");
      }
      await expect(dialog.locator(".daily-life-staffing")).toContainText(
        "could not be validated by CMS",
      );
    }
    if (entry.id === "abc-home-healthcare") {
      await expect(dialog.locator(".daily-life")).toContainText(
        "An office that arranges care, not a residential community.",
      );
    }
    await dialog
      .getByRole("tab", { name: "Costs & perks", exact: true })
      .click();
    const life = dialog.locator(".daily-life");
    await expect(life).toContainText(entry.expected);
    await readableFacts(dialog);
    if (data.nursingStaffing) {
      await staffingDetails(dialog, data.nursingStaffing);
      await dialog.locator(".staffing-evidence").screenshot({
        path: test.info().outputPath("staffing-at-a-glance.png"),
      });
    }
    await dialog.screenshot({
      path: test.info().outputPath("daily-life-costs.png"),
    });
    for (const fact of data.facts.filter(
      (fact) =>
        ["care", "amenity", "activity", "dining"].includes(fact.kind) &&
        data.sources.find((source) => source.id === fact.sourceId)?.kind !==
          "regulator",
    )) {
      const article = life
        .locator(".offering-fact")
        .filter({ has: page.locator("p", { hasText: fact.text }) });
      await expect(article).toHaveCount(1);
      await expect(article.getByRole("link")).toHaveAttribute(
        "href",
        data.sources.find((source) => source.id === fact.sourceId)!.url,
      );
    }
    for (const fact of data.dailyLife?.facts ?? []) {
      const article = life.locator(".offering-fact").filter({
        has: page.getByText(fact.text, { exact: true }),
      });
      await expect(article).toHaveCount(1);
      await expect(article.getByRole("link")).toHaveAttribute(
        "href",
        data.dailyLife!.sources.find((source) => source.id === fact.sourceId)!
          .url,
      );
    }
    if (
      data.dailyLife?.facts.some(
        (fact) => fact.kind === "trip" || fact.kind === "transport",
      )
    ) {
      await expect(life.locator(".daily-life-gaps")).not.toContainText(
        "transport arrangements",
      );
    }
    await expect(
      life.getByRole("heading", {
        name:
          provider.locationKind === "office"
            ? "Service location & access"
            : "Location & access",
        exact: true,
      }),
    ).toBeVisible();
    await expect(life).not.toContainText("State-licensed setting");
    if (entry.id === "north-jersey-doh-nj13a012") {
      await expect(life).toContainText("Third-party listing · MyLivingChoice");
      await expect(life.locator(".daily-life-gaps")).toContainText(
        "meals & dining",
      );
    }
  });
}

for (const mismatch of ["absent", "provider", "ccn"] as const) {
  test(`no legacy CMS hours when staffing research is ${mismatch}`, async ({
    page,
    request,
  }) => {
    const results: SearchResponse = await (
      await request.get("/api/search", {
        params: { zip: "07960", radius: "50" },
      })
    ).json();
    const provider = results.providers.find(
      (item) => item.id === "cms-315009",
    )!;
    expect(provider.cms?.totalNurseHours).toBeGreaterThan(0);
    const data: LocationResearchResponse = await (
      await request.get("/api/research", { params: { id: provider.id } })
    ).json();
    expect(data.nursingStaffing).toBeTruthy();
    if (mismatch === "absent") delete data.nursingStaffing;
    else if (mismatch === "provider")
      data.nursingStaffing!.providerId = "cms-225281";
    else data.nursingStaffing!.ccn = "225281";
    await page.route("**/api/research?**", (route) =>
      route.fulfill({ json: data }),
    );
    const dialog = await openProfile(page, provider, "07960");
    for (const tab of ["Overview", "Costs & perks"]) {
      await dialog.getByRole("tab", { name: tab, exact: true }).click();
      await expect(dialog.locator(".daily-life-staffing")).toHaveCount(0);
      await expect(dialog.locator(".daily-life-gaps")).toContainText(
        "Staff levels and staff-to-resident ratios are not established here",
      );
      await expect(dialog.locator(".daily-life")).not.toContainText(
        "hours per resident-day",
      );
    }
  });
}

test("explicit provider ratio retains its scope without inventing shift coverage", async ({
  page,
  request,
}) => {
  const results: SearchResponse = await (
    await request.get("/api/search", { params: { zip: "07960", radius: "50" } })
  ).json();
  const provider = results.providers.find((item) => item.id === "cms-315009")!;
  const data: LocationResearchResponse = await (
    await request.get("/api/research", { params: { id: provider.id } })
  ).json();
  const text = "Published day-shift aide-to-resident ratio is 1:8.";
  data.dailyLife = {
    providerId: provider.id,
    checkedAt: "2026-11-12",
    sources: [
      {
        id: "ratio-source",
        url: "https://example.com/care-team",
        title: "Care team",
        publisher: "Provider",
        checkedAt: "2026-11-12",
        publishedAt: "2026-10-01",
        access: "full-page",
        excerpt: text,
        locationEvidence: provider.name,
      },
    ],
    facts: [
      {
        id: "ratio",
        text,
        quote: text,
        sourceId: "ratio-source",
        evidence: "provider-reported",
        kind: "staffing",
        numeric: {
          value: 8,
          unit: "staff-to-resident-ratio",
          population: "Day-shift aides in the nursing unit",
          period: "October 2026",
        },
      },
    ],
    notes: [],
  };
  await page.route("**/api/research?**", (route) =>
    route.fulfill({ json: data }),
  );
  const dialog = await openProfile(page, provider, "07960");
  for (const tab of ["Overview", "Costs & perks"]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    const life = dialog.locator(".daily-life");
    await expect(life.getByText(text, { exact: true })).toBeVisible();
    await expect(life).toContainText(
      "Source scope · Day-shift aides in the nursing unit · October 2026",
    );
    await expect(life.locator(".daily-life-gaps")).toContainText(
      "it is not a guarantee for every shift",
    );
    await expect(life.locator(".daily-life-gaps")).not.toContainText(
      "ratios are not established",
    );
    await staffingDetails(dialog, data.nursingStaffing!);
  }
});

test("unavailable and suppressed staffing metrics keep distinct labels and units", async ({
  page,
  request,
}) => {
  const results: SearchResponse = await (
    await request.get("/api/search", { params: { zip: "07960", radius: "50" } })
  ).json();
  const provider = results.providers.find((item) => item.id === "cms-315009")!;
  const data: LocationResearchResponse = await (
    await request.get("/api/research", { params: { id: provider.id } })
  ).json();
  const staffing = data.nursingStaffing!;
  staffing.metrics.weekendRn = {
    ...staffing.metrics.weekendRn,
    status: "unavailable",
    value: null,
    footnote: "Weekend RN hours were not published.",
  };
  staffing.metrics.totalTurnover = {
    ...staffing.metrics.totalTurnover,
    status: "suppressed",
    value: null,
    footnote: "CMS suppressed turnover for this reporting period.",
  };
  staffing.metrics.census = {
    ...staffing.metrics.census,
    status: "unavailable",
    value: null,
  };
  await page.route("**/api/research?**", (route) =>
    route.fulfill({ json: data }),
  );
  const dialog = await openProfile(page, provider, "07960");
  for (const tab of ["Overview", "Costs & perks"]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    await staffingDetails(dialog, staffing);
    const section = dialog.locator(".staffing-evidence");
    await expect(section).not.toContainText("Suppressed by CMS%");
    await expect(section).not.toContainText("Not published%");
    await expect(section).not.toContainText("null");
    await expect(section).not.toContainText("NaN");
  }
});
