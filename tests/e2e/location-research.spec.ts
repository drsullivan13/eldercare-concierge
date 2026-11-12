import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import catalogue from "../../src/data/providers.json";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";

const providers = new Map(catalogue.map((p) => [p.id, p]));
async function openSearch(page: Page) {
  await page.goto("/dashboard?demo=1");
  await expect(page.locator(".demo-banner")).toBeVisible();
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Research filter" }),
  ).toBeVisible();
}
async function searchName(page: Page, name: string) {
  await page.getByPlaceholder("Search by name or town").fill(name);
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("q") === name,
  );
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await response;
  await expect(page.locator(".result-skeleton")).toHaveCount(0);
}
function card(page: Page, id: string) {
  const name = providers.get(id)!.name;
  return page
    .locator("article.provider-card")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}
async function openLocation(page: Page, id: string) {
  await searchName(page, providers.get(id)!.name);
  await card(page, id).getByRole("button", { name: "View details" }).click();
  const dialog = page.getByRole("dialog", {
    name: providers.get(id)!.name,
    exact: true,
  });
  await expect(
    dialog.getByRole("heading", {
      name: "Published costs & what they include",
    }),
  ).toBeVisible();
  await expect(dialog.locator(".research-tabs")).toHaveCount(0);
  return dialog;
}
async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    doc: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll("dialog")].map((d) => ({
      client: d.clientWidth,
      scroll: d.scrollWidth,
    })),
  }));
  expect(dimensions.doc).toBeLessThanOrEqual(dimensions.width + 1);
  for (const dialog of dimensions.dialogs)
    expect(dialog.scroll).toBeLessThanOrEqual(dialog.client + 1);
}

test("real west, north-shore, south-shore and campus offerings retain source links, price periods and future dates", async ({
  page,
  request,
}) => {
  await openSearch(page);
  for (const id of [
    "ma-alr-evans-park-at-newton-corner",
    "ma-alr-seasons-of-danvers",
    "ma-alr-allerton-house-at-harbor-park",
    "lifeplan-brooksby-village",
  ]) {
    const response = await request.get("/api/research", { params: { id } });
    expect(response.status()).toBe(200);
    const data = (await response.json()) as LocationResearchResponse;
    expect(data.providerId).toBe(id);
    const dialog = await openLocation(page, id);
    const panel = dialog.locator(".research-panel");
    await expect(
      panel.getByRole("heading", { name: "Care, amenities & everyday life" }),
    ).toBeVisible();
    for (const fact of data.facts.filter((f) =>
      ["care", "amenity", "activity", "dining", "capacity"].includes(f.kind),
    )) {
      const article = panel
        .locator(".offering-fact")
        .filter({ has: page.locator("p", { hasText: fact.text }) });
      await expect(article).toHaveCount(1);
      await expect(article.locator("a.research-source")).toHaveAttribute(
        "href",
        data.sources.find((s) => s.id === fact.sourceId)!.url,
      );
    }
    if (data.facts.some((f) => f.kind === "capacity")) {
      const headings = await panel.locator("h4").allTextContents();
      expect(headings.indexOf("Selected public experiences")).toBeLessThan(
        headings.indexOf("Community size"),
      );
      const capacity = panel
        .locator("details")
        .filter({ hasText: "What capacity figures mean" });
      await expect(capacity.locator("p")).not.toBeVisible();
      await capacity.locator("summary").click();
      await expect(capacity.locator("p")).toBeVisible();
      await expect(capacity).toContainText(
        "They cannot tell us how many rooms are open.",
      );
    }
    for (const fact of data.facts.filter((f) =>
      ["room", "cost"].includes(f.kind),
    )) {
      const article = panel
        .locator(".offering-fact")
        .filter({ has: page.locator("p", { hasText: fact.text }) });
      await expect(article).toHaveCount(1);
      if (fact.amount) {
        if (/\$\s*\d/.test(fact.text)) {
          await expect(article.locator(".offering-price")).toHaveCount(0);
          await expect(article).toContainText(fact.text);
        } else {
          await expect(article.locator(".offering-price")).toContainText(
            fact.amount.min.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 2,
            }),
          );
        }
        await expect(article.locator(".cost-label")).toContainText(
          fact.amount.period === "one-time"
            ? "One-time"
            : `Per ${fact.amount.period}`,
        );
      }
    }
    if (id === "ma-alr-allerton-house-at-harbor-park") {
      await expect(panel).toContainText("FUTURE effective December 1, 2026");
      await expect(panel).toContainText("Source effective date: Dec 1, 2026");
    }
    if (id === "lifeplan-brooksby-village") {
      await expect(panel).toContainText("$113,000–$226,000");
      await expect(panel).toContainText("$2,523 per month");
      await expect(panel).toContainText("90%");
    }
    await dialog.locator(".research-notes summary").click();
    for (const note of data.notes)
      await expect(dialog.locator(".research-notes")).toContainText(note);
    await noOverflow(page);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  }
});

test("published openings, waitlists and unestablished inventory stay distinct; availability task is local and persists once", async ({
  page,
}) => {
  await openSearch(page);
  let dialog = await openLocation(page, "ma-alr-compass-on-the-bay");
  let panel = dialog.locator(".research-panel");
  await expect(
    panel.getByRole("heading", {
      name: "The provider publishes an opening claim",
    }),
  ).toBeVisible();
  await expect(panel).toContainText("Undated provider page");
  await expect(panel).toContainText(
    "not a reservation or a confirmed opening today",
  );
  await expect(panel.locator(".availability-observation p")).toContainText(
    "2 companion suites and 1 private studio",
  );
  const inventory = panel.locator("details").filter({
    has: page.getByText("Published inventory breakdown", { exact: true }),
  });
  await expect(inventory.locator(".fact-availability")).toHaveCount(2);
  for (const fact of await inventory.locator(".fact-availability").all())
    await expect(fact).not.toBeVisible();
  await inventory.locator("summary").click();
  for (const fact of await inventory.locator(".fact-availability").all()) {
    await expect(fact).toBeVisible();
    await expect(fact.locator(".research-source")).toHaveAttribute(
      "href",
      "https://www.seniorlivingresidences.com/communities/boston-compass-on-the-bay/compass-on-the-bay-availability/",
    );
  }
  await inventory.locator("summary").click();
  await panel
    .getByRole("button", { name: "Add an availability check" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Added to your plan" }),
  ).toBeDisabled();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("harbor.demo.workspace.v1")!),
  );
  const added = stored.tasks.filter(
    (task: { title: string; providerId: string }) =>
      task.providerId === "ma-alr-compass-on-the-bay" &&
      task.title.includes("room availability"),
  );
  expect(added).toHaveLength(1);
  expect(added[0].status).toBe("todo");
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  dialog = await openLocation(page, "lifeplan-brooksby-village");
  panel = dialog.locator(".research-panel");
  await expect(
    panel.getByRole("heading", { name: "A waitlist is published" }),
  ).toBeVisible();
  await expect(panel).toContainText("No wait duration");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  const nursing = catalogue.find((p) => p.category === "nursing-home")!;
  dialog = await openLocation(page, nursing.id);
  panel = dialog.locator(".research-panel");
  await expect(
    panel.getByRole("heading", {
      name: "Current availability is not established",
    }),
  ).toBeVisible();
  await expect(panel.locator(".availability-opening-published")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("harbor.demo.workspace.v1")!,
        ).tasks.filter((task: { title: string }) =>
          task.title.includes("room availability"),
        ).length,
    ),
  ).toBe(1);
});

test("actual review sources, excluded populations and selected family accounts never become fabricated quality proof", async ({
  page,
  request,
}) => {
  await openSearch(page);
  const response = await request.get(
    "/api/research?id=lifeplan-brooksby-village",
  );
  const data = (await response.json()) as LocationResearchResponse;
  let dialog = await openLocation(page, data.providerId);
  let panel = dialog.locator(".research-panel");
  await expect(panel.locator(".experience-number")).toHaveText("7.4/10");
  await expect(panel).toContainText("44 reviews reported");
  await expect(panel).toContainText("1 source family");
  const method = panel.locator(".experience-method");
  await expect(method.locator("p").first()).not.toBeVisible();
  await method.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(method.locator("p").first()).toBeVisible();
  await expect(method).toContainText(
    "Reviewers are not independently authenticated",
  );
  await expect(panel.locator(".review-excluded").first()).toBeVisible();
  await expect(panel.locator(".public-reviews article")).toHaveCount(
    data.reviews.length,
  );
  await panel
    .getByRole("checkbox", { name: "Family & resident accounts" })
    .check();
  const selected = data.reviews.filter((r) =>
    ["family", "resident"].includes(r.relationship),
  );
  await expect(panel.locator(".public-reviews article")).toHaveCount(
    selected.length,
  );
  for (const review of selected)
    await expect(
      panel.locator(`a[href="${review.url}"]`).first(),
    ).toBeVisible();
  await expect(panel.locator(".experience-number")).toHaveText("7.4/10");
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  for (const id of [
    "lifeplan-carleton-willard-village",
    "ma-alr-maplewood-at-weston",
    "ma-alr-adelaide-of-newton-centre",
  ]) {
    dialog = await openLocation(page, id);
    panel = dialog.locator(".research-panel");
    await expect(panel.locator(".experience-overview")).toContainText(
      "Not rated yet",
    );
    await expect(panel.locator(".experience-number")).not.toContainText("0.0");
    await expect(panel.locator(".review-excluded").first()).toBeVisible();
    await noOverflow(page);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  }
});

test("research filtering and experience sorting retain category rules and selected comparison records", async ({
  page,
}) => {
  await openSearch(page);
  await expect(
    page
      .getByRole("combobox", { name: "Sort results" })
      .locator('option[value="experience"]'),
  ).toHaveCount(0);
  await page
    .locator(".category-tabs")
    .getByRole("button", { name: "Continuing & tiered care", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Sort results" })
    .selectOption("experience");
  await expect(page.locator(".result-skeleton")).toHaveCount(0);
  const ids = ["lifeplan-brooksby-village", "lifeplan-linden-ponds"];
  for (const id of ids) await card(page, id).getByRole("checkbox").check();
  await page
    .getByRole("combobox", { name: "Research filter" })
    .selectOption("openings");
  await expect(page.locator(".result-skeleton")).toHaveCount(0);
  await page
    .locator(".compare-bar")
    .getByRole("button", { name: "Compare options" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Compare care options" });
  for (const id of ids)
    await expect(
      dialog.getByRole("columnheader", {
        name: providers.get(id)!.name,
        exact: true,
      }),
    ).toBeVisible();
  const availability = dialog.getByRole("row").filter({
    has: page.getByRole("rowheader", {
      name: "Current availability",
      exact: true,
    }),
  });
  await expect(availability.getByRole("cell")).toHaveText([
    "Not confirmed",
    "Not confirmed",
  ]);
  await expect(dialog).toContainText("Published waitlist; confirm timing");
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page
    .locator(".category-tabs")
    .getByRole("button", { name: "All care options", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Sort results" }),
  ).toHaveValue("distance");
  await expect(page.locator(".compare-bar")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Research filter" })
    .selectOption("pricing");
  await expect(page.locator("article.provider-card").first()).toBeVisible();
  for (const item of await page.locator("article.provider-card").all())
    await expect(item).toContainText("Published costs");
  await expect(page.locator(".research-filter-note")).toContainText(
    "Unresearched options may have the same offerings",
  );
  await noOverflow(page);
});

test("research failures recover on retry and wrong-location payloads never display foreign claims", async ({
  page,
}) => {
  let attempt = 0;
  await page.route(
    "**/api/research?id=lifeplan-brooksby-village",
    async (route) => {
      attempt++;
      if (attempt === 1)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Controlled test failure" }),
        });
      else await route.continue();
    },
  );
  await openSearch(page);
  await searchName(page, providers.get("lifeplan-brooksby-village")!.name);
  await card(page, "lifeplan-brooksby-village")
    .getByRole("button", { name: "View details" })
    .click();
  let dialog = page.getByRole("dialog", {
    name: providers.get("lifeplan-brooksby-village")!.name,
    exact: true,
  });
  await expect(
    dialog.locator(".location-research").getByRole("alert"),
  ).toContainText("could not be loaded");
  await dialog.getByRole("button", { name: "Retry location research" }).click();
  await expect(
    dialog.getByRole("heading", {
      name: "Published costs & what they include",
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.route(
    "**/api/research?id=lifeplan-linden-ponds",
    async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.providerId = "lifeplan-brooksby-village";
      await route.fulfill({ response, json });
    },
  );
  await searchName(page, providers.get("lifeplan-linden-ponds")!.name);
  await card(page, "lifeplan-linden-ponds")
    .getByRole("button", { name: "View details" })
    .click();
  dialog = page.getByRole("dialog", {
    name: providers.get("lifeplan-linden-ponds")!.name,
    exact: true,
  });
  await expect(
    dialog.locator(".location-research").getByRole("alert"),
  ).toContainText("did not match this location");
  await expect(dialog.locator(".research-panel")).toHaveCount(0);
});

test("families see sourced costs and an account preview, with a direct path to concerns", async ({
  page,
  request,
}, testInfo) => {
  await openSearch(page);
  const response = await request.get(
    "/api/research?id=lifeplan-brooksby-village",
  );
  const data: LocationResearchResponse = await response.json();
  const dialog = await openLocation(page, data.providerId);
  for (const name of [
    "Care, amenities & everyday life",
    "Room types & living arrangements",
    "Published costs & what they include",
    "A waitlist is published",
    "Selected public experiences",
  ]) {
    await expect(
      dialog.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  const accounts = dialog.locator(".public-reviews article");
  const overview = dialog.locator(".property-overview");
  await expect(
    overview.getByRole("link", { name: "Rooms & pricing" }),
  ).toBeVisible();
  await expect(overview.locator("blockquote")).toBeVisible();
  await overview
    .getByRole("link", { name: "Read an account with concerns" })
    .click();
  const unfavorable = accounts.filter({
    hasText: "The food is generally awful.",
  });
  await expect(unfavorable.locator("blockquote")).toHaveText(
    "“The food is generally awful.”",
  );
  await expect(unfavorable.locator(".review-meta")).toContainText("Caring.com");
  await expect(unfavorable.locator(".review-meta")).toContainText(
    "Self-described family",
  );
  await expect(unfavorable.locator(".review-meta")).toContainText(
    "Sep 29, 2025",
  );
  await expect(unfavorable.locator(".sentiment-negative")).toContainText(
    "food",
  );
  await expect(
    unfavorable.getByText(
      data.reviews.find((review) => review.rating === 2)!.summary,
      { exact: false },
    ),
  ).not.toBeVisible();

  const reddit = accounts.filter({ hasText: "Reddit" });
  await expect(reddit.locator("blockquote")).toHaveCount(0);
  await expect(reddit.locator(".review-summary")).toContainText(
    "Research summary",
  );
  await expect(reddit.locator(".review-meta")).toContainText(
    "Date not published",
  );
  await expect(
    reddit.getByRole("link", { name: "Read the original account on Reddit" }),
  ).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/SalemMA/comments/1c6njun/assisted_living/",
  );

  const syndicated = accounts.filter({ hasText: "Birdeye" });
  await expect(syndicated.locator("blockquote")).toHaveText(
    "“Lots of opportunities to choose from in terms of activities.”",
  );
  await syndicated.locator("summary").click();
  await expect(syndicated).toContainText("Origin labeled Facebook by Birdeye");
  await expect(syndicated).toContainText("Research summary");
  await expect(
    syndicated.getByRole("link", {
      name: "Read the original account on Birdeye",
    }),
  ).toHaveAttribute(
    "href",
    "https://reviews.birdeye.com/brooksby-village-157269641387486",
  );
  for (const review of data.reviews) {
    const account = accounts
      .filter({ has: page.locator(`a[href="${review.url}"]`) })
      .filter({ hasText: review.excerpt || review.summary });
    await expect(account).toHaveCount(1);
    if (review.excerpt)
      await expect(account.locator("blockquote")).toHaveText(
        `“${review.excerpt}”`,
      );
  }
  const studio = dialog
    .locator(".fact-cost")
    .filter({ hasText: "Independent-living studio entrance fee" });
  await expect(studio.locator(".cost-label")).toHaveText(
    "Entrance fee · One-time",
  );
  expect((await studio.innerText()).match(/\$113,000/g)).toHaveLength(1);
  expect((await studio.innerText()).match(/\$226,000/g)).toHaveLength(1);
  await expect(studio).toContainText("90%");
  const sectionOrder = await dialog
    .locator(".research-panel h4")
    .allTextContents();
  expect(sectionOrder.indexOf("Selected public experiences")).toBeLessThan(
    sectionOrder.indexOf("Review ratings & source coverage"),
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include("dialog")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await noOverflow(page);
  await dialog
    .getByRole("heading", { name: "Published costs & what they include" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("visible-family-costs.png"),
  });
  await unfavorable.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("sourced-family-accounts.png"),
  });
});

test("families can open concerns even when a mixed account has a favorable excerpt", async ({
  page,
}) => {
  await openSearch(page);
  const dialog = await openLocation(page, "ma-alr-evans-park-at-newton-corner");
  const first = dialog
    .locator(".public-reviews article")
    .filter({ hasText: "some nurses that were wonderful" });
  await expect(first.locator("blockquote")).toHaveText(
    "“some nurses that were wonderful”",
  );
  await expect(first.locator(".review-meta")).toContainText("A Place for Mom");
  await expect(first.locator(".review-meta")).toContainText(
    "Self-described family",
  );
  await expect(first.locator(".sentiment-negative")).toContainText(
    "communication",
  );
  await first.getByText("Account context", { exact: true }).click();
  await expect(first).toContainText("Research summary");
  await expect(first).toContainText(
    "concerns with administration communication",
  );
  await expect(dialog).toContainText(
    "No numeric ongoing care rate is established here",
  );
  await noOverflow(page);
});

test("office coverage, a free assessment and aggregate review links stay useful without room rates or excerpts", async ({
  page,
  request,
}) => {
  await openSearch(page);
  let dialog = await openLocation(page, "all-care");
  const response = await request.get("/api/research?id=all-care");
  const data: LocationResearchResponse = await response.json();
  expect(data.reviews).toEqual([]);
  const anchors = await dialog
    .locator(".property-overview h4 a")
    .evaluateAll((links) =>
      links.map((link) => {
        const target = document.getElementById(
          (link as HTMLAnchorElement).hash.slice(1),
        );
        return Boolean(target && link.closest("dialog")?.contains(target));
      }),
    );
  expect(anchors).toEqual([true, true, true]);
  expect(data.reviewAggregates.length).toBeGreaterThan(0);
  await expect(dialog.locator(".public-reviews blockquote")).toHaveCount(0);
  await expect(dialog).toContainText(
    "Missing excerpts do not mean no reviews exist",
  );
  for (const aggregate of data.reviewAggregates) {
    const link = dialog.getByRole("link", {
      name: `Read reviews on ${aggregate.platform}`,
      exact: false,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      data.sources.find((source) => source.id === aggregate.sourceId)!.url,
    );
  }
  const provider = providers.get("all-care")!;
  await expect(
    dialog.getByRole("link", { name: "Visit website" }),
  ).toHaveAttribute("href", provider.website!);
  await expect(dialog.locator('a[href^="tel:"]')).toHaveAttribute(
    "href",
    `tel:${provider.phone!.replace(/[^+\d]/g, "")}`,
  );
  await expect(dialog).toContainText("Office location only");
  if (provider.serviceArea)
    await expect(
      dialog.getByText(
        `Provider-reported service area. ${provider.serviceArea}`,
        { exact: true },
      ),
    ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "How care is delivered" }),
  ).toBeVisible();
  await expect(dialog).not.toContainText(
    "Room layouts have not been researched",
  );
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  dialog = await openLocation(page, "abc-home-healthcare");
  const assessment = dialog
    .locator(".fact-cost")
    .filter({ hasText: "no-cost initial home-care assessment" });
  await expect(assessment.locator(".offering-price")).toHaveText(
    "$0.00 one-time",
  );
  await expect(dialog).toContainText(
    "No numeric ongoing care rate is established here",
  );
  await expect(
    dialog
      .locator(".catalog-services li")
      .filter({ hasText: /^Personal care$/ }),
  ).toHaveCount(0);
  await expect(
    dialog
      .locator(".fact-care")
      .filter({ hasText: "Provider advertises Personal care" }),
  ).toHaveCount(1);
  await noOverflow(page);
});

test("admission restrictions retain their source and duplicated availability observations render once", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/research?id=cms-225656");
  const data: LocationResearchResponse = await response.json();
  expect(data.admissionRestriction).toBeDefined();
  await page.route("**/api/research?id=cms-225656", (route) =>
    route.fulfill({
      json: {
        ...data,
        facts: [
          ...data.facts,
          {
            id: "same-retained-availability",
            kind: "availability",
            text: data.availability.text,
            sourceId: data.availability.sourceId ?? data.sources[0].id,
          },
        ],
      },
    }),
  );
  await openSearch(page);
  const dialog = await openLocation(page, data.providerId);
  const restriction = dialog
    .locator(".research-caution")
    .filter({ hasText: "Admission eligibility needs checking" });
  await expect(restriction).toBeVisible();
  await expect(restriction).toContainText(data.admissionRestriction!.text);
  await expect(restriction.getByRole("link")).toHaveAttribute(
    "href",
    data.sources.find(
      (source) => source.id === data.admissionRestriction!.sourceId,
    )!.url,
  );
  await expect(
    dialog.getByText(data.availability.text, { exact: true }),
  ).toHaveCount(1);
  await expect(dialog.getByRole("link", { name: "Visit website" })).toHaveCount(
    0,
  );
  await dialog
    .getByRole("button", { name: "Save to shortlist", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Shortlisted", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("textbox", {
      name: `Notes about ${providers.get(data.providerId)!.name}`,
    })
    .fill("Ask admissions about eligibility.");
  await dialog
    .getByRole("button", { name: "Update note", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Note added to workspace" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Add a follow-up to my plan" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Added to your plan", exact: true }),
  ).toBeDisabled();
  await noOverflow(page);
});
