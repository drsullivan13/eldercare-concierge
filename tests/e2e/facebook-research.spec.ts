import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import data from "../../src/data/facebook-research.json";
import catalog from "../../src/data/providers.json";
import type { FacebookResearchDataset } from "../../src/lib/facebook-research";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";
import { getFamilyExperience } from "../../src/lib/facebook-research";
import { markets } from "../../src/lib/markets";
import { publicResearchNotes } from "../../src/lib/public-location-research";

const snapshot = data as unknown as FacebookResearchDataset;
const assigned = Object.entries(snapshot.locations);
const providers = markets.flatMap((market) => market.providers);
const names = new Map(providers.map((p) => [p.id, p.name]));
test.describe.configure({ timeout: 180_000 });
async function open(page: Page, id: string) {
  await page.goto("/dashboard?demo=1");
  await page
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption(providers.find((provider) => provider.id === id)!.category);
  await page
    .getByRole("textbox", { name: "Search ZIP code" })
    .fill(
      providers.find((provider) => provider.id === id)!.state === "NJ"
        ? "07960"
        : "02459",
    );
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("50");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care" })
    .click();
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  await expect(filters).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#search-filters")).toBeHidden();
  await filters.click();
  const name = names.get(id)!;
  await page.getByPlaceholder("Search by name or town").fill(name);
  await page.getByPlaceholder("Search by name or town").press("Tab");
  const loaded = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("q") === name,
  );
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await loaded;
  const card = page
    .locator("article.provider-card")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await expect(card).toHaveCount(1);
  const count = getFamilyExperience(id)?.distinctThreadCount ?? 0;
  const familyText = `${count} Facebook ${count === 1 ? "thread" : "threads"} with resident or family accounts`;
  if (count)
    await expect(card.locator(".family-experience")).toHaveText(familyText);
  else await expect(card.locator(".family-experience")).toHaveCount(0);
  await expect(card.locator(".family-experience-method")).toHaveCount(0);
  const research = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/research" &&
      new URL(r.url()).searchParams.get("id") === id,
  );
  await card.getByRole("button", { name: "View details" }).click();
  expect((await (await research).json()).providerId).toBe(id);
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(
    dialog.getByRole("tablist", { name: "Provider profile" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(
    dialog.getByRole("tabpanel", { name: "Reviews", exact: true }),
  ).toBeVisible();
  if (count) {
    const selection = dialog.getByText("How these accounts were selected", {
      exact: true,
    });
    const method = dialog.locator(".family-experience-method");
    await expect(selection).toBeVisible();
    await expect(method).toBeHidden();
    await selection.focus();
    await page.keyboard.press("Enter");
    await expect(method).toBeVisible();
    await expect(dialog.locator(".family-experience")).toHaveText(familyText);
    await dialog
      .getByText("How Harbor uses these accounts", { exact: true })
      .click();
    await expect(method.locator("p").first()).toBeVisible();
    await expect(dialog.locator(".family-experience-method")).toContainText(
      "not a representative survey",
    );
    await expect(dialog.locator(".family-experience-method")).toContainText(
      "Each thread counts once",
    );
    await selection.focus();
    await page.keyboard.press("Space");
    await expect(method).toBeHidden();
    await selection.focus();
    await page.keyboard.press("Enter");
    await expect(method.locator("p").first()).toBeVisible();
    await expect(dialog.locator(".family-experience")).toBeVisible();
  } else {
    await expect(dialog.locator(".family-experience")).toHaveCount(0);
  }
  const section = dialog.getByRole("region", {
    name: "Facebook findings",
    exact: true,
  });
  await expect(section).toBeVisible();
  return { card, dialog, section };
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    sections: [...document.querySelectorAll(".fb-research, dialog")].map(
      (e) => ({ client: e.clientWidth, scroll: e.scrollWidth }),
    ),
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  for (const s of size.sections)
    expect(s.scroll).toBeLessThanOrEqual(s.client + 1);
}

test("North Jersey family findings expose the summary, original thread and observation provenance", async ({
  page,
}) => {
  for (const id of [
    "north-jersey-campus-cedar-crest-village-07444",
    "north-jersey-doh-nj60a004",
  ]) {
    const location = markets.find((market) => market.id === "north-jersey")!
      .facebookResearch!.locations[id];
    const finding = location.findings[0];
    const { section } = await open(page, id);
    const article = section.locator(".fb-research-finding");
    await expect(article).toHaveCount(1);
    await expect(
      article.getByText(finding.summary, { exact: false }),
    ).toBeVisible();
    await expect(article.locator("blockquote")).toHaveText(
      `“${finding.excerpt}”`,
    );
    await expect(article).toContainText("Post date:");
    await expect(
      article.getByRole("link", { name: "Facebook source", exact: true }),
    ).toHaveAttribute("href", finding.threadUrl);
    const provenance = article.locator(".fb-research-provenance");
    await expect(provenance.locator("p").first()).not.toBeVisible();
    await provenance.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(provenance.locator("p").first()).toBeVisible();
    for (const observationId of finding.sourceObservationIds)
      await expect(provenance).toContainText(observationId);
    await expect(provenance).toContainText(
      "Collected rows, not independent people or households.",
    );
    await expect(provenance).toContainText("Editorial review:");
    await article.getByText("Context and limits", { exact: true }).click();
    for (const limit of publicResearchNotes(finding.limitations))
      await expect(article.getByText(limit, { exact: true })).toBeVisible();
    await noOverflow(page);
    const accessibility = await new AxeBuilder({ page })
      .include(".fb-research")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  }
});

test("North Jersey held, unresolved, empty and unsearched coverage remain distinct", async ({
  page,
}) => {
  const market = markets.find((item) => item.id === "north-jersey")!;
  const locations = market.facebookResearch!.locations;
  const unsearched = market.providers.find(
    (provider) =>
      provider.category === "nursing-home" &&
      !Object.hasOwn(locations, provider.id),
  )!;
  for (const [id, label] of [
    ["north-jersey-campus-lantern-hill-07974", "Collected material withheld"],
    ["north-jersey-doh-nj60a002", "Partial coverage"],
    ["cms-315329", "No relevant result in this search"],
    [unsearched.id, "Not searched in this pilot"],
  ]) {
    const { section } = await open(page, id);
    await expect(section.locator(".fb-research-status")).toHaveText(label);
    await expect(section.locator(".fb-research-finding")).toHaveCount(0);
    await expect(section.getByRole("combobox")).toHaveCount(0);
    await section
      .getByText("What this Facebook search covered", { exact: true })
      .click();
    if (Object.hasOwn(locations, id)) {
      await expect(section).toContainText(
        publicResearchNotes([locations[id].coverageExplanation]).join(" "),
      );
      await expect(section.locator(".fb-research-counts")).toContainText(
        `${locations[id].withheldCount} withheld`,
      );
    } else {
      await expect(section).toContainText(
        "does not mean no relevant posts exist",
      );
      await expect(section.locator(".fb-research-counts")).toHaveCount(0);
    }
    await noOverflow(page);
  }
});

test("public methodology explains qualitative family accounts and campus scope", async ({
  page,
}) => {
  await page.goto("/methodology");
  const policy = page.locator("#family-accounts");
  await expect(
    policy.getByRole("heading", {
      name: "Resident and family accounts",
    }),
  ).toBeVisible();
  await expect(policy).toContainText("qualitative context");
  await expect(policy).toContainText("not a rating");
  await expect(policy).not.toContainText("the same published score");
  await expect(policy).toContainText(
    "separately licensed nursing and assisted-living units have their own records",
  );
});

test("actual curated Facebook findings show sources, keyboard expansion and kind filters without changing the numerical score", async ({
  page,
  request,
}, testInfo) => {
  const [id, location] = [...assigned].sort(
    (a, b) => b[1].findings.length - a[1].findings.length,
  )[0];
  expect(location.findings.length).toBeGreaterThan(3);
  const response = await request.get("/api/research", { params: { id } });
  expect(response.status()).toBe(200);
  const actual = (await response.json()) as LocationResearchResponse;
  expect(actual.facebookResearch?.publishedObservationCount).toBe(
    location.publishedObservationCount,
  );
  const { dialog, section } = await open(page, id);
  await expect(section).toContainText("Qualitative context only");
  await expect(section).toContainText("not a representative survey");
  await expect(section.locator(".fb-research-caution")).not.toBeVisible();
  await expect(section.locator(".fb-research-dates")).not.toBeVisible();
  await section
    .getByText("What this Facebook search covered", { exact: true })
    .click();
  await expect(section.locator(".fb-research-caution")).toBeVisible();
  await expect(section.locator(".fb-research-dates")).toContainText(
    "Editorial review:",
  );
  await expect(section.locator(".fb-research-counts")).toContainText(
    `${location.publishedObservationCount} published`,
  );
  await expect(section).toContainText(
    publicResearchNotes([location.coverageExplanation]).join(" "),
  );
  await expect(section.locator(".fb-research-finding")).toHaveCount(3);
  const first = section.locator(".fb-research-finding").first();
  await expect(first).toContainText(location.findings[0].summary);
  await expect(first.locator(".fb-research-limits")).not.toBeVisible();
  await first.getByText("Context and limits", { exact: true }).click();
  await expect(first.locator(".fb-research-limits")).toBeVisible();
  await expect(
    first.getByRole("link", { name: "Facebook source", exact: true }),
  ).toHaveAttribute("href", new URL(location.findings[0].sourceUrl).href);
  const score = await dialog.locator(".experience-number").textContent();
  const expand = section.getByRole("button", {
    name: `Show all ${location.findings.length} Facebook findings`,
    exact: true,
  });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(section.locator(".fb-research-finding")).toHaveCount(
    location.findings.length,
  );
  await expect(
    section.getByRole("button", { name: "Show fewer Facebook findings" }),
  ).toHaveAttribute("aria-expanded", "true");
  await noOverflow(page);
  await section.locator(".fb-research-heading").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("facebook-expanded.png"),
    animations: "disabled",
  });
  const accessibility = await new AxeBuilder({ page })
    .include(".fb-research")
    .include("dialog .family-experience")
    .include("dialog .family-experience-method")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await section
    .getByText("What this Facebook search covered", { exact: true })
    .click();
  await first.getByText("Context and limits", { exact: true }).click();
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("facebook-expanded-findings.png"),
    animations: "disabled",
  });
  await section
    .getByRole("button", { name: "Show fewer Facebook findings" })
    .focus();
  await page.keyboard.press("Space");
  await expect(section.locator(".fb-research-finding")).toHaveCount(3);
  const type = location.findings[0].kind;
  await section
    .getByRole("combobox", { name: "Facebook finding type" })
    .selectOption(type);
  const filtered = location.findings.filter((f) => f.kind === type);
  await expect(section.locator(".fb-research-finding")).toHaveCount(
    Math.min(3, filtered.length),
  );
  for (const [i, finding] of filtered.slice(0, 3).entries())
    await expect(section.locator(".fb-research-finding").nth(i)).toContainText(
      finding.summary,
    );
  await expect(dialog.locator(".experience-number")).toHaveText(score!);
  await expect(
    section.locator(".experience-number,.review-aspects"),
  ).toHaveCount(0);
  await noOverflow(page);
});

test("searched empty/withheld coverage is distinct from an actual catalog location not searched in the pilot", async ({
  page,
  request,
}) => {
  for (const status of [
    "withheld",
    "no-relevant-result",
    "findings-available",
  ]) {
    const [id, location] = assigned.find(([, v]) => v.status === status)!;
    const result = await open(page, id);
    const coverage = result.section.locator(".fb-research-coverage");
    await expect(coverage.locator(".fb-research-dates")).not.toBeVisible();
    await coverage.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(coverage.locator(".fb-research-dates")).toBeVisible();
    await expect(result.section).toContainText(
      publicResearchNotes([location.coverageExplanation]).join(" "),
    );
    await expect(
      result.section.locator(".fb-research-status"),
    ).not.toContainText("Not searched");
    await expect(result.section.locator(".fb-research-finding")).toHaveCount(
      Math.min(3, location.findings.length),
    );
    if (!location.findings.length)
      await expect(result.section.getByRole("combobox")).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page })
      .include(".fb-research")
      .include("dialog .family-experience")
      .include("dialog .family-experience-method")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await noOverflow(page);
  }
  const outside = catalog.find(
    (p) =>
      p.category === "nursing-home" && !Object.hasOwn(snapshot.locations, p.id),
  )!.id;
  const response = await request.get("/api/research", {
    params: { id: outside },
  });
  expect((await response.json()).facebookResearch).toBeUndefined();
  const result = await open(page, outside);
  await expect(result.section).toContainText("Not searched in this pilot");
  await expect(result.section).toContainText(
    "does not mean no relevant posts exist",
  );
  await noOverflow(page);
  const accessibility = await new AxeBuilder({ page })
    .include(".fb-research")
    .include("dialog .family-experience")
    .include("dialog .family-experience-method")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
