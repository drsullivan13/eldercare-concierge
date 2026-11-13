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
  await expect(dialog.locator(".overview-location")).toBeVisible();
  return dialog;
}

async function readableFacts(dialog: Locator) {
  const result = await dialog.locator(".daily-life").evaluate((element) => {
    const headings =
      element
        .closest(".location-research")
        ?.querySelectorAll(".section-title h3, .section-title > span") ?? [];
    return {
      sizes: [
        ...element.querySelectorAll(
          "p, li, a, h4, h5, h6, dt, dd, summary, small, sup",
        ),
        ...headings,
      ].map((node) => ({
        text: node.textContent?.slice(0, 100),
        size: parseFloat(getComputedStyle(node).fontSize),
        sourceDetail: Boolean(
          node.closest(
            ".daily-life-sources, .daily-life-date, .daily-life-attribution",
          ),
        ),
      })),
      width: element.clientWidth,
      scroll: element.scrollWidth,
    };
  });
  expect(
    result.sizes.filter(
      ({ size, sourceDetail }) =>
        size < (sourceDetail ? 12 : 16) || (sourceDetail && size > 13),
    ),
  ).toEqual([]);
  expect(result.scroll).toBeLessThanOrEqual(result.width + 1);
}

function sourceDate(value: string) {
  return new Date(
    `${value}${value.length === 7 ? "-01" : ""}T00:00:00Z`,
  ).toLocaleDateString("en-US", {
    month: "short",
    ...(value.length === 7 ? {} : { day: "numeric" }),
    year: "numeric",
    timeZone: "UTC",
  });
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
    const row = section.locator(":scope > dl > div").filter({
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
  await expect(
    section.getByRole("heading", { name: "Weekend care", exact: true }),
  ).toBeVisible();
  await expect(section).toContainText(
    "These are daily averages, not a simultaneous staff-to-resident ratio, a headcount or a promise of coverage on any shift.",
  );
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
  await expect(details).toContainText(
    `CMS processing date · ${sourceDate(staffing.processingDate)}`,
  );
  await expect(
    details.getByRole("link", { name: /CMS · CCN/ }),
  ).toHaveAttribute("href", staffing.careCompareUrl);
  await expect(details.getByRole("link", { name: /CMS · CCN/ })).toContainText(
    `checked ${sourceDate(staffing.retrievedAt.slice(0, 10))}`,
  );
  const sourceUrls = await details
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(new Set(sourceUrls).size).toBe(sourceUrls.length);
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
    id: "north-jersey-doh-nj60a004",
    zip: "07960",
    expected: "Three chef-prepared meals daily",
  },
  {
    id: "ma-alr-fenno-house",
    zip: "02459",
    expected: "Two onsite restaurant-style meals daily",
  },
  {
    id: "ma-alr-evans-park-at-newton-corner",
    zip: "02459",
    expected: "Chef-prepared seasonal menus",
  },
  {
    id: "north-jersey-doh-nj13a012",
    zip: "07960",
    expected: "Housekeeping",
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
  test(`real ${entry.id} daily life facts and staffing belong to distinct tabs`, async ({
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
    await expect(dialog.locator(".daily-life")).toHaveCount(0);
    const overview = dialog.getByRole("region", { name: "Property overview" });
    await expect(overview.getByRole("button")).toHaveCount(0);
    await expect(overview.locator("blockquote")).toHaveCount(0);
    await expect(overview).not.toContainText(
      /What people say|review links|Read concerns/,
    );
    await expect(dialog.locator(".overview-location")).toContainText(
      provider.address,
    );
    const preserved: string[] = [];
    for (const tab of ["Costs & perks", "Details"] as const) {
      await dialog.getByRole("tab", { name: tab, exact: true }).click();
      const life = dialog.locator(".daily-life");
      await expect(life).toBeVisible();
      await readableFacts(dialog);
      const care = tab === "Details";
      await expect(life.locator(".staffing-evidence")).toHaveCount(
        care && data.nursingStaffing ? 1 : 0,
      );
      await expect(
        life.getByRole("region", {
          name: care
            ? /Meals|Social life|Everyday comforts|Companionship|Everyday help/
            : /Staff roles|Care team|Care & daily|Services arranged/,
        }),
      ).toHaveCount(0);
      if (care && data.nursingStaffing)
        await staffingDetails(dialog, data.nursingStaffing);
      const disclosure = life.locator(".daily-life-sources");
      if (await disclosure.count()) {
        await expect(disclosure).not.toHaveAttribute("open", "");
        await disclosure.locator("summary").focus();
        await disclosure.locator("summary").press("Enter");
        await expect(disclosure).toHaveAttribute("open", "");
        await expect(disclosure).toContainText(
          "Reported offerings, not independently verified.",
        );
        await expect(disclosure).toContainText(
          "Search-only evidence has not been checked on the full page.",
        );
        await readableFacts(dialog);
        const links = await disclosure
          .getByRole("link")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("href")),
          );
        expect(new Set(links).size).toBe(links.length);
        const texts = await disclosure
          .locator(".daily-life-source-fact > p:first-child")
          .allTextContents();
        preserved.push(...texts);
        for (const text of texts) {
          const legacy = data.facts.find((fact) => fact.text === text);
          const acquired = data.dailyLife?.facts.find(
            (fact) => fact.text === text,
          );
          const source = legacy
            ? data.sources.find((source) => source.id === legacy.sourceId)
            : data.dailyLife?.sources.find(
                (source) => source.id === acquired?.sourceId,
              );
          expect(source).toBeDefined();
          const original = disclosure
            .locator(".daily-life-source-fact")
            .filter({
              has: page.getByText(text, { exact: true }),
            });
          await expect(original).toHaveCount(1);
          await expect(
            original.locator("..").getByRole("link"),
          ).toHaveAttribute("href", source!.url);
          await expect(original.locator(".daily-life-date")).toContainText(
            `Checked ${sourceDate(source!.checkedAt)}`,
          );
          const asOf = legacy?.asOf ?? (acquired && source!.publishedAt);
          if (asOf)
            await expect(original.locator(".daily-life-date")).toContainText(
              `${legacy ? "Source effective date" : "Source publication date"} · ${sourceDate(asOf)}`,
            );
          if (source!.access === "search-result")
            await expect(original.locator(".daily-life-date")).toContainText(
              "search result only",
            );
        }
      }
      await expect(life.locator(".daily-life-group details")).toHaveCount(
        care && data.nursingStaffing ? 1 : 0,
      );
      if (!care) {
        if (!entry.id.startsWith("cms-") && entry.id !== "abc-home-healthcare")
          await expect(life).toContainText(entry.expected);
        if (
          data.dailyLife?.facts.some(
            (fact) => fact.kind === "trip" || fact.kind === "transport",
          )
        )
          await expect(life.locator(".daily-life-gaps")).not.toContainText(
            "transport arrangements",
          );
        await expect(dialog.locator(".fact-care")).toHaveCount(0);
        await expect(
          life.getByRole("heading", { name: /Location & access/ }),
        ).toHaveCount(0);
        await expect(life).not.toContainText("State-licensed setting");
        if (entry.id === "north-jersey-doh-nj60a004") {
          const meals = life.getByRole("region", { name: "Meals & dining" });
          await expect(meals.locator(".daily-life-bullet-text")).toHaveText([
            "Three chef-prepared meals daily",
            "24-hour bistro with complimentary snacks and drinks",
            "Room Service",
          ]);
          await expect(meals.locator("h5 + ul")).toHaveCount(1);
          const comforts = life.getByRole("region", {
            name: "Everyday comforts & transport",
          });
          await expect(comforts.locator(".daily-life-bullet-text")).toHaveText([
            "Weekly housekeeping and laundry",
            "Library, chapel and salon",
            "Transportation for medical visits and recreation",
            "Gathering / Activity Spaces",
            "Pet Friendly",
            "Arts and Crafts",
            "Games",
            "Social Activities",
          ]);
          for (const bullet of await comforts
            .locator(".daily-life-bullet-text")
            .all())
            await expect(bullet).toBeVisible();
          expect(
            (
              await life.locator(".daily-life-group > ul").allTextContents()
            ).join(" "),
          ).not.toMatch(
            /Operator lists|MyLivingChoice lists|Confirm these details/,
          );
          for (const fact of data.facts.filter(
            (fact) => fact.kind === "room",
          )) {
            const room = dialog.locator(".fact-room").filter({
              has: page.getByText(fact.text, { exact: true }),
            });
            await expect(room).toHaveCount(1);
            await expect(room).toBeVisible();
            await expect(room.getByRole("link")).toHaveAttribute(
              "href",
              data.sources.find((source) => source.id === fact.sourceId)!.url,
            );
          }
          await dialog.screenshot({
            path: test.info().outputPath("victoria-mews-costs-perks.png"),
          });
        }
        if (entry.id === "ma-alr-evans-park-at-newton-corner") {
          await expect(
            life
              .getByRole("region", { name: "Everyday comforts & transport" })
              .locator(".daily-life-bullet-text"),
          ).toHaveText([
            "Weekly housekeeping, laundry and linen service",
            "Scheduled transportation",
            "Fitness center, demonstration kitchen, theater and bistro/pub",
          ]);
        }
        if (entry.id === "north-jersey-doh-nj13a012") {
          await expect(disclosure).toContainText(
            "Third-party listing · MyLivingChoice",
          );
          await expect(life.locator(".daily-life-gaps")).toContainText(
            "meals & dining",
          );
        }
        if (entry.id === "cms-315009")
          await expect(life).toContainText(
            "No source-linked everyday-life offerings",
          );
        if (entry.id === "cms-225281")
          await expect(
            life.getByRole("region", { name: "Meals & dining" }),
          ).toContainText(
            "The unit advertises dining choices, kitchens/fireplaces, pastoral services and recreational programming for nursing residents.",
          );
      } else {
        if (entry.id === "abc-home-healthcare")
          await expect(life).toContainText(entry.expected);
        await expect(
          dialog.locator(
            ".fact-cost, .fact-room, .fact-dining, .fact-activity",
          ),
        ).toHaveCount(0);
        if (entry.id === "cms-315009") {
          await expect(life).toContainText("0.56");
          await expect(life).toContainText(entry.expected);
          await expect(life).toContainText(/hours per resident-day/i);
          await expect(life.locator(".daily-life-gaps")).toContainText(
            "staff-to-resident ratio",
          );
        }
        if (entry.id === "cms-225281") {
          const staffing = life.locator(".daily-life-staffing");
          await expect(staffing.locator(":scope > dl dd")).toHaveCount(6);
          for (const value of await staffing.locator(":scope > dl dd").all())
            await expect(value).toHaveText("Suppressed by CMS");
          await expect(staffing).toContainText("could not be validated by CMS");
        }
      }
      if (entry.id === "ma-alr-fenno-house") {
        await expect(
          life.locator(".daily-life-attribution").first(),
        ).toMatchAriaSnapshot('- superscript: "[1, search only]"');
        await expect(disclosure).toContainText("Provider · Fenno House");
        await expect(disclosure).toContainText("search result only");
      }
    }
    const expected = [
      ...data.facts
        .filter(
          (fact) =>
            ["care", "amenity", "activity", "dining"].includes(fact.kind) &&
            data.sources.find((source) => source.id === fact.sourceId)?.kind !==
              "regulator",
        )
        .map((fact) => fact.text),
      ...(data.dailyLife?.facts ?? []).map((fact) => fact.text),
    ];
    expect(preserved.toSorted()).toEqual([...new Set(expected)].toSorted());
    await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
    await expect(
      dialog.locator(".daily-life, .fact-cost, .fact-room"),
    ).toHaveCount(0);
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
    for (const tab of ["Details"]) {
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
      {
        id: "coverage",
        text: "Aides advertise 24 hours of support daily for this unit.",
        quote: "Aides advertise 24 hours of support daily for this unit.",
        sourceId: "ratio-source",
        evidence: "provider-reported",
        kind: "staffing",
        numeric: {
          value: 24,
          unit: "hours-per-day",
          population: "Aide support in the nursing unit",
          period: null,
        },
      },
    ],
    notes: [],
  };
  await page.route("**/api/research?**", (route) =>
    route.fulfill({ json: data }),
  );
  const dialog = await openProfile(page, provider, "07960");
  for (const tab of ["Details"]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    const life = dialog.locator(".daily-life");
    await expect(
      life.locator(".daily-life-bullet-text").filter({ hasText: text }),
    ).toBeVisible();
    await expect(life).toContainText(
      "Source scope · Day-shift aides in the nursing unit · October 2026",
    );
    await expect(life).toContainText(
      "Source scope · Aide support in the nursing unit · period not published · coverage hours, not a staff-to-resident ratio",
    );
    const sources = life.locator(".daily-life-sources");
    await sources.locator("summary").click();
    await expect(sources.locator(".daily-life-source-fact")).toHaveCount(2);
    for (const original of await sources
      .locator(".daily-life-source-fact")
      .all())
      await expect(original).toContainText(
        "Checked Nov 12, 2026 · Source publication date · Oct 1, 2026",
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
  for (const tab of ["Details"]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    await staffingDetails(dialog, staffing);
    const section = dialog.locator(".staffing-evidence");
    await expect(section).not.toContainText("Suppressed by CMS%");
    await expect(section).not.toContainText("Not published%");
    await expect(section).not.toContainText("null");
    await expect(section).not.toContainText("NaN");
  }
});
