import { test, expect, type Page, type Locator } from "@playwright/test";
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
  await card(page, id).getByRole("button", { name: "View evidence" }).click();
  const dialog = page.getByRole("dialog", {
    name: providers.get(id)!.name,
    exact: true,
  });
  await expect(dialog.locator(".research-tabs")).toBeVisible();
  return dialog;
}
async function tab(dialog: Locator, name: string) {
  const button = dialog
    .locator(".research-tabs")
    .getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  return dialog.locator(".research-panel");
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
    let panel = dialog.locator(".research-panel");
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
    if (data.facts.some((f) => f.kind === "capacity"))
      await expect(panel).toContainText(
        "They cannot tell us how many rooms are open.",
      );
    panel = await tab(dialog, "Rooms & costs");
    for (const fact of data.facts.filter((f) =>
      ["room", "cost"].includes(f.kind),
    )) {
      const article = panel
        .locator(".offering-fact")
        .filter({ has: page.locator("p", { hasText: fact.text }) });
      await expect(article).toHaveCount(1);
      if (fact.amount) {
        await expect(article.locator(".offering-price")).toContainText(
          fact.amount.min.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }),
        );
        await expect(article.locator(".offering-price")).toContainText(
          fact.amount.period === "one-time"
            ? "one-time"
            : `/ ${fact.amount.period}`,
        );
      }
    }
    if (id === "ma-alr-allerton-house-at-harbor-park") {
      await expect(panel).toContainText("FUTURE effective December 1, 2026");
      await expect(panel).toContainText("Source effective date: Dec 1, 2026");
    }
    if (id === "lifeplan-brooksby-village") {
      await expect(panel).toContainText("$113,000.00–$226,000.00 one-time");
      await expect(panel).toContainText("$2,523.00 / month");
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
  let panel = await tab(dialog, "Availability");
  await expect(
    panel.getByRole("heading", {
      name: "The provider publishes an opening claim",
    }),
  ).toBeVisible();
  await expect(panel).toContainText("Undated provider page");
  await expect(panel).toContainText(
    "not a reservation or a confirmed opening today",
  );
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
  panel = await tab(dialog, "Availability");
  await expect(
    panel.getByRole("heading", { name: "A waitlist is published" }),
  ).toBeVisible();
  await expect(panel).toContainText("No wait duration");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  const nursing = catalogue.find((p) => p.category === "nursing-home")!;
  dialog = await openLocation(page, nursing.id);
  panel = await tab(dialog, "Availability");
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
  let panel = await tab(dialog, "Reviews");
  await expect(panel.locator(".experience-number")).toHaveText("7.4/10");
  await expect(panel).toContainText("44 reviews reported");
  await expect(panel).toContainText("1 source family");
  await expect(panel).toContainText(
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
    panel = await tab(dialog, "Reviews");
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
    await expect(item).toContainText("Published cost details");
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
    .getByRole("button", { name: "View evidence" })
    .click();
  let dialog = page.getByRole("dialog", {
    name: providers.get("lifeplan-brooksby-village")!.name,
    exact: true,
  });
  await expect(
    dialog.locator(".location-research").getByRole("alert"),
  ).toContainText("could not be loaded");
  await dialog.getByRole("button", { name: "Retry location research" }).click();
  await expect(dialog.locator(".research-tabs")).toBeVisible();
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
    .getByRole("button", { name: "View evidence" })
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
