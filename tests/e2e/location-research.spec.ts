import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import catalogue from "../../src/data/providers.json";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";
import type { IndividualReviewsResponse } from "../../src/lib/individual-reviews";

const providers = new Map(catalogue.map((p) => [p.id, p]));
test.describe.configure({ timeout: 180_000 });
async function openSearch(page: Page, category = "all") {
  await page.goto("/dashboard?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find care for your family.",
  );
  await page
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption(category);
  await page.getByRole("textbox", { name: "Search ZIP code" }).fill("02459");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#search-filters")).toBeHidden();
}
async function searchName(page: Page, name: string) {
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByPlaceholder("Search by name or town").fill(name);
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("q") === name,
  );
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
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
  const research = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/research" && url.searchParams.get("id") === id
    );
  });
  await card(page, id).getByRole("button", { name: "View details" }).click();
  await research;
  const dialog = page.getByRole("dialog", {
    name: providers.get(id)!.name,
    exact: true,
  });
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("tablist", { name: "Provider profile" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  return dialog;
}
async function showPane(
  dialog: Locator,
  name: "Overview" | "Costs & perks" | "Reviews" | "Details",
) {
  const tab = dialog.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("tabpanel", { name, exact: true }),
  ).toBeVisible();
}
async function expandFacts(dialog: Locator) {
  for (const disclosure of await dialog
    .locator("details.offering-more")
    .all()) {
    if ((await disclosure.getAttribute("open")) === null)
      await disclosure.locator("summary").click();
  }
}
async function findAccount(dialog: Locator, account: Locator) {
  const previous = dialog.getByRole("button", {
    name: "Previous accounts",
    exact: true,
  });
  while ((await previous.count()) && (await previous.isEnabled()))
    await previous.click();
  const next = dialog.getByRole("button", {
    name: "Next accounts",
    exact: true,
  });
  for (let page = 0; page < 100; page++) {
    if (await account.count()) return account;
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  await expect(account).toHaveCount(1);
  return account;
}
async function accountLinks(dialog: Locator) {
  const links: string[] = [];
  const next = dialog.getByRole("button", {
    name: "Next accounts",
    exact: true,
  });
  for (let page = 0; page < 100; page++) {
    links.push(
      ...(await dialog
        .locator(".public-reviews article a")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("href")!),
        )),
    );
    if (!(await next.count()) || (await next.isDisabled())) return links;
    await next.click();
  }
  throw new Error("Individual review pagination did not terminate.");
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
    await showPane(dialog, "Costs & perks");
    await expandFacts(dialog);
    const panel = dialog.locator(".research-panel");
    await expect(
      panel.getByRole("heading", { name: "Care, amenities & everyday life" }),
    ).toBeVisible();
    for (const fact of data.facts.filter(
      (f) =>
        ["care", "amenity", "activity", "dining"].includes(f.kind) &&
        data.sources.find((source) => source.id === f.sourceId)?.kind !==
          "regulator",
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
              minimumFractionDigits: 0,
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
    await showPane(dialog, "Details");
    await expandFacts(dialog);
    for (const fact of data.facts.filter(
      (f) =>
        f.kind === "capacity" ||
        (["care", "amenity", "activity", "dining"].includes(f.kind) &&
          data.sources.find((source) => source.id === f.sourceId)?.kind ===
            "regulator"),
    )) {
      const article = panel
        .locator(".offering-fact")
        .filter({ has: page.locator("p", { hasText: fact.text }) });
      await expect(article).toBeVisible();
      await expect(article.getByRole("link")).toHaveAttribute(
        "href",
        data.sources.find((s) => s.id === fact.sourceId)!.url,
      );
    }
    if (data.facts.some((f) => f.kind === "capacity")) {
      const capacity = panel
        .locator("details")
        .filter({ hasText: "What capacity figures mean" });
      await expect(capacity.locator("p")).toBeHidden();
      await capacity.locator("summary").click();
      await expect(capacity.locator("p")).toBeVisible();
      await expect(capacity).toContainText(
        "They cannot tell us how many rooms are open.",
      );
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
  await showPane(dialog, "Details");
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
  await showPane(dialog, "Details");
  panel = dialog.locator(".research-panel");
  await expect(
    panel.getByRole("heading", { name: "A waitlist is published" }),
  ).toBeVisible();
  await expect(panel).toContainText("No wait duration");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  const nursing = catalogue.find((p) => p.category === "nursing-home")!;
  dialog = await openLocation(page, nursing.id);
  await showPane(dialog, "Details");
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
  await showPane(dialog, "Reviews");
  let panel = dialog.locator(".research-panel");
  await expect(panel.locator(".experience-number")).toHaveText("7.4/10");
  await expect(panel).toContainText("44 source-reported ratings");
  await expect(panel).toContainText("1 source family");
  const method = panel.locator(".experience-method");
  const quote = panel.locator(".public-reviews blockquote").first();
  await expect(quote).toBeVisible();
  const quoteBounds = await quote.boundingBox();
  const methodBounds = await method.locator("summary").boundingBox();
  expect(quoteBounds!.y + quoteBounds!.height).toBeLessThan(methodBounds!.y);
  await expect(method.locator("p").first()).not.toBeVisible();
  await method.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(method.locator("p").first()).toBeVisible();
  await expect(method).toContainText(
    "Reviewers are not independently authenticated",
  );
  await expect(panel.locator(".review-excluded").first()).toBeVisible();
  const catalogResponse = await request.get("/api/reviews", {
    params: { id: data.providerId },
  });
  expect(catalogResponse.status()).toBe(200);
  const catalog: IndividualReviewsResponse = await catalogResponse.json();
  expect((await accountLinks(dialog)).sort()).toEqual(
    catalog.accounts.map(({ url }) => url).sort(),
  );
  await panel
    .getByRole("checkbox", { name: "Family & resident accounts" })
    .check();
  const selected = catalog.accounts.filter((r) =>
    ["family", "resident"].includes(r.relationship),
  );
  const selectedLinks = await accountLinks(dialog);
  expect(selectedLinks.sort()).toEqual(selected.map(({ url }) => url).sort());
  await expect(panel.locator(".experience-number")).toHaveText("7.4/10");
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  for (const id of [
    "lifeplan-carleton-willard-village",
    "ma-alr-maplewood-at-weston",
    "ma-alr-adelaide-of-newton-centre",
  ]) {
    dialog = await openLocation(page, id);
    await showPane(dialog, "Reviews");
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
  request,
}) => {
  await openSearch(page);
  await page
    .getByRole("combobox", { name: "Sort results" })
    .selectOption("experience");
  const prompt = page.getByRole("region", {
    name: "Choose a care type to rank by experience",
  });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("not clinical quality or safety");
  await expect(
    page.getByRole("combobox", { name: "Sort results" }),
  ).toHaveValue("distance");
  const ranked = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" &&
      url.searchParams.get("sort") === "experience"
    );
  });
  await prompt
    .getByRole("combobox", { name: "Care type for experience" })
    .selectOption("life-plan");
  await ranked;
  await expect(prompt).toBeHidden();
  await expect(
    page.getByRole("combobox", { name: "Sort results" }),
  ).toHaveValue("experience");
  await expect(page.locator(".result-skeleton")).toHaveCount(0);
  const ids = [
    "lifeplan-brooksby-village",
    "lifeplan-linden-ponds",
    "lifeplan-carleton-willard-village",
  ];
  for (const id of ids) await card(page, id).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Compare places",
    exact: true,
  });
  for (const id of ids.slice(0, 2)) {
    const name = providers.get(id)!.name;
    await expect(
      dialog.getByRole("button", { name, exact: true }),
    ).toBeVisible();
    const prices = dialog.getByRole("group", {
      name: `${name}, published prices`,
      exact: true,
    });
    await expect(prices).toContainText("Published, not a personal quote.");
    await prices.getByText("Rates & sources", { exact: true }).click();
    const response = await request.get("/api/research", { params: { id } });
    expect(response.ok()).toBe(true);
    const research: LocationResearchResponse = await response.json();
    const firstCost = research.facts.find((fact) => fact.kind === "cost")!;
    await expect(prices.getByRole("link").first()).toHaveAttribute(
      "href",
      research.sources.find((source) => source.id === firstCost.sourceId)!.url,
    );
    await expect(
      dialog.getByRole("group", {
        name: `${name}, everyday perks`,
        exact: true,
      }),
    ).not.toBeEmpty();
    const insight = dialog.getByRole("group", {
      name: `${name}, a review insight`,
      exact: true,
    });
    await expect(insight).toContainText(
      "One selected account, not a survey. Relationship unverified.",
    );
    await expect(insight.getByRole("link").first()).toHaveAttribute(
      "href",
      /^https:/,
    );
  }
  const brooksbyPrices = dialog.getByRole("group", {
    name: `${providers.get(ids[0])!.name}, published prices`,
    exact: true,
  });
  await expect(brooksbyPrices).toContainText("$2,523");
  await expect(brooksbyPrices).toContainText("/ month");
  await expect(
    dialog
      .getByRole("group", {
        name: `${providers.get(ids[0])!.name}, a review insight`,
        exact: true,
      })
      .getByRole("blockquote"),
  ).toHaveText("“The food is generally awful.”");
  await dialog
    .getByText("Clinical ratings, availability & records", { exact: true })
    .click();
  for (const id of ids.slice(0, 2))
    await expect(
      dialog.getByRole("group", {
        name: `${providers.get(id)!.name}, Availability`,
        exact: true,
      }),
    ).toContainText("Not confirmed live.");
  await expect(
    dialog.getByRole("group", {
      name: `${providers.get(ids[0])!.name}, Availability`,
      exact: true,
    }),
  ).toContainText("Waitlist published");
  await dialog
    .getByRole("combobox", { name: "Compare pair" })
    .selectOption(ids[0]);
  await expect(
    dialog.getByRole("button", {
      name: providers.get(ids[0])!.name,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", {
      name: providers.get(ids[2])!.name,
      exact: true,
    }),
  ).toBeVisible();
  await noOverflow(page);
  await dialog
    .getByRole("button", { name: providers.get(ids[2])!.name, exact: true })
    .click();
  const profile = page.getByRole("dialog", {
    name: providers.get(ids[2])!.name,
    exact: true,
  });
  await expect(
    profile.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await profile.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Compare", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Care category" })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Research filter" })
    .selectOption("pricing");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Sort results" }),
  ).toHaveValue("distance");
  await expect(
    page.getByRole("button", { name: "Compare", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("article.provider-card").first()).toBeVisible();
  for (const item of await page.locator("article.provider-card").all())
    await expect(item).toContainText("Published costs");
  await page.getByText("Sources & evidence", { exact: true }).click();
  await expect(page.locator(".research-filter-note")).toContainText(
    "Unresearched options may have the same offerings",
  );
  await noOverflow(page);
});

test("comparison selections survive an evidence filter that hides their result cards", async ({
  page,
}) => {
  await openSearch(page, "life-plan");
  const ids = ["lifeplan-brooksby-village", "lifeplan-linden-ponds"];
  for (const id of ids) {
    await card(page, id)
      .getByRole("checkbox", {
        name: `Compare ${providers.get(id)!.name}`,
        exact: true,
      })
      .check();
    if (id === ids[0]) {
      await expect(
        page.getByRole("button", { name: "Compare", exact: true }),
      ).toBeDisabled();
    }
  }
  await expect(
    page.getByRole("button", { name: "Compare", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("textbox", { name: "Provider or town" }).fill("");
  await page
    .getByRole("combobox", { name: "Research filter" })
    .selectOption("openings");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Compare", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const comparison = page.getByRole("dialog", {
    name: "Compare places",
    exact: true,
  });
  for (const id of ids)
    await expect(
      comparison.getByRole("button", {
        name: providers.get(id)!.name,
        exact: true,
      }),
    ).toBeVisible();
});

test("profile tabs expose one named pane and support arrow, Home, End and Escape keys", async ({
  page,
}) => {
  await openSearch(page);
  const dialog = await openLocation(page, "lifeplan-brooksby-village");
  const overview = dialog.getByRole("tab", { name: "Overview", exact: true });
  await overview.focus();
  for (const [key, name] of [
    ["ArrowRight", "Costs & perks"],
    ["End", "Details"],
    ["Home", "Overview"],
    ["ArrowLeft", "Details"],
  ]) {
    await page.keyboard.press(key);
    const tab = dialog.getByRole("tab", { name, exact: true });
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(tab).toHaveAttribute("tabindex", "0");
    await expect(dialog.getByRole("tab", { selected: true })).toHaveCount(1);
    const panel = dialog.getByRole("tabpanel", { name, exact: true });
    await expect(panel).toBeVisible();
    await expect(tab).toHaveAttribute(
      "aria-controls",
      (await panel.getAttribute("id"))!,
    );
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("research failures recover on retry and wrong-location payloads never display foreign claims", async ({
  page,
}) => {
  let unavailable = true;
  await page.route(
    "**/api/research?id=lifeplan-brooksby-village",
    async (route) => {
      if (unavailable)
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
  unavailable = false;
  await dialog.getByRole("button", { name: "Retry location research" }).click();
  await expect(
    dialog.getByRole("region", { name: "Property overview" }),
  ).toBeVisible();
  await showPane(dialog, "Costs & perks");
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
  const accounts = dialog.locator(".public-reviews article");
  const overview = dialog.locator(".property-overview");
  await expect(
    overview.getByRole("button", { name: "Price details & source" }),
  ).toBeVisible();
  await expect(overview.locator(".overview-rate")).toContainText("$2,523");
  await expect(overview.locator("blockquote")).toBeVisible();
  const caveat = overview.locator(".overview-caveat");
  await expect(caveat.locator("p")).toBeHidden();
  await caveat.locator("summary").click();
  await expect(caveat.locator("p")).toBeVisible();
  await expect(caveat).toContainText(
    "Relationships are not independently verified",
  );
  await overview
    .getByRole("button", { name: "Read concerns", exact: true })
    .click();
  await expect(
    dialog.getByRole("tab", { name: "Reviews", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const unfavorable = accounts.filter({
    hasText: "The food is generally awful.",
  });
  await expect(unfavorable).toBeFocused();
  await expect(unfavorable.locator("blockquote")).toHaveText(
    "“The food is generally awful.”",
  );
  await expect(unfavorable.locator(".review-concern")).toBeVisible();
  await expect(unfavorable.locator(".review-concern")).toHaveText(
    data.reviews.find((review) => review.rating === 2)!.summary,
  );
  const context = unfavorable.locator("details");
  await expect(unfavorable.locator(".sentiment-negative")).not.toBeVisible();
  await context.locator("summary").click();
  await expect(unfavorable.locator(".review-meta")).toContainText("Caring.com");
  await expect(unfavorable.locator(".review-meta")).toContainText(
    "Self-described family",
  );
  await expect(unfavorable.locator(".review-meta")).toContainText(
    "Sep 29, 2025",
  );
  await expect(
    unfavorable
      .locator(".review-meta")
      .getByText("Caring.com", { exact: true }),
  ).toBeVisible();
  await expect(
    unfavorable.locator(".review-meta").getByText(/Sep 29, 2025/),
  ).toBeVisible();
  await expect(unfavorable.locator(".sentiment-negative")).toContainText(
    "food",
  );
  await expect(unfavorable.locator(".sentiment-negative")).toBeVisible();
  await expect(unfavorable.getByRole("link")).toHaveAttribute(
    "href",
    data.reviews.find((review) => review.rating === 2)!.url,
  );

  const reddit = await findAccount(
    dialog,
    accounts.filter({
      has: page.locator(
        'a[href="https://www.reddit.com/r/SalemMA/comments/1c6njun/assisted_living/"]',
      ),
    }),
  );
  await expect(reddit.locator("blockquote")).toHaveCount(0);
  await expect(reddit.locator(".review-summary")).toContainText(
    "Research summary",
  );
  await reddit.locator("summary").click();
  await expect(reddit.locator(".review-meta")).toContainText(
    "Date not published",
  );
  await expect(
    reddit.getByRole("link", { name: "Read the original account on Reddit" }),
  ).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/SalemMA/comments/1c6njun/assisted_living/",
  );

  const syndicated = await findAccount(
    dialog,
    accounts.filter({
      hasText: "Lots of opportunities to choose from in terms of activities.",
    }),
  );
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
    const account = await findAccount(
      dialog,
      accounts
        .filter({ has: page.locator(`a[href="${review.url}"]`) })
        .filter({ hasText: review.excerpt || review.summary }),
    );
    await expect(account).toHaveCount(1);
    if (review.excerpt)
      await expect(account.locator("blockquote")).toHaveText(
        `“${review.excerpt}”`,
      );
  }
  const studio = dialog
    .locator(".fact-cost")
    .filter({ hasText: "Independent-living studio entrance fee" });
  await showPane(dialog, "Costs & perks");
  await expandFacts(dialog);
  await expect(studio.locator(".cost-label")).toHaveText(
    "Entrance fee · One-time",
  );
  expect((await studio.innerText()).match(/\$113,000/g)).toHaveLength(1);
  expect((await studio.innerText()).match(/\$226,000/g)).toHaveLength(1);
  await expect(studio).toContainText("90%");
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
  await showPane(dialog, "Reviews");
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
  await dialog
    .getByRole("button", { name: "Read concerns", exact: true })
    .click();
  const first = dialog
    .locator(".public-reviews article")
    .filter({ hasText: "some nurses that were wonderful" });
  await expect(first.locator("blockquote")).toHaveText(
    "“some nurses that were wonderful”",
  );
  await expect(first.locator(".review-concern")).toContainText(
    "concerns with administration communication",
  );
  await first.getByText("Account context", { exact: true }).click();
  await expect(first.locator(".review-meta")).toContainText("A Place for Mom");
  await expect(first.locator(".review-meta")).toContainText(
    "Self-described family",
  );
  await expect(first.locator(".sentiment-negative")).toContainText(
    "communication",
  );
  await expect(first.locator(".sentiment-negative")).toBeVisible();
  await expect(first).toContainText(
    "concerns with administration communication",
  );
  await showPane(dialog, "Costs & perks");
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
  await dialog
    .getByRole("button", {
      name: "Price details & source",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole("tabpanel", { name: "Costs & perks", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "How care is delivered" }),
  ).toBeVisible();
  await showPane(dialog, "Overview");
  await dialog.getByRole("button", { name: "All perks & services" }).click();
  await expect(
    dialog.getByRole("tabpanel", { name: "Costs & perks", exact: true }),
  ).toBeVisible();
  await showPane(dialog, "Overview");
  await dialog
    .getByRole("button", { name: "Explore reviews & family discussions" })
    .click();
  await expect(
    dialog.getByRole("tabpanel", { name: "Reviews", exact: true }),
  ).toBeVisible();
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
  await showPane(dialog, "Costs & perks");
  await expect(dialog).not.toContainText(
    "Room layouts have not been researched",
  );
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  dialog = await openLocation(page, "abc-home-healthcare");
  await showPane(dialog, "Costs & perks");
  await expandFacts(dialog);
  const assessment = dialog
    .locator(".fact-cost")
    .filter({ hasText: "no-cost initial home-care assessment" });
  await expect(assessment.locator(".offering-price")).toHaveText("$0 one-time");
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
  await showPane(dialog, "Details");
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
  await dialog.getByText("Your questions & notes", { exact: true }).click();
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
