import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import data from "../../src/data/facebook-research.json";
import catalog from "../../src/data/providers.json";
import type { FacebookResearchDataset } from "../../src/lib/facebook-research";
import type { LocationResearchResponse } from "../../src/lib/location-research-types";
import { getFamilyExperience } from "../../src/lib/facebook-research";

const snapshot = data as unknown as FacebookResearchDataset;
const assigned = Object.entries(snapshot.locations);
const names = new Map(catalog.map((p) => [p.id, p.name]));
async function open(page: Page, id: string) {
  await page.goto("/dashboard?demo=1");
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
  const name = names.get(id)!;
  await page.getByPlaceholder("Search by name or town").fill(name);
  const loaded = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/search" &&
      new URL(r.url()).searchParams.get("q") === name,
  );
  await page
    .locator("form.research-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await loaded;
  const card = page
    .locator("article.provider-card")
    .filter({ has: page.getByRole("button", { name, exact: true }) })
    .filter({
      has: page.locator(
        `.provider-symbol.symbol-${catalog.find((p) => p.id === id)!.category}`,
      ),
    });
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
  await dialog
    .locator(".research-tabs")
    .getByRole("button", { name: "Reviews", exact: true })
    .click();
  if (count) {
    await expect(dialog.locator(".family-experience")).toHaveText(familyText);
    await dialog
      .getByText("How Harbor uses these accounts", { exact: true })
      .click();
    await expect(dialog.locator(".family-experience-method")).toContainText(
      "the same published score",
    );
    await expect(dialog.locator(".family-experience-method")).toContainText(
      "Each thread counts once",
    );
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

test("public methodology explains family-experience tie-only ordering and campus scope", async ({
  page,
}) => {
  await page.goto("/methodology");
  const policy = page.locator("#family-accounts");
  await expect(
    policy.getByRole("heading", {
      name: "How resident and family accounts affect ordering",
    }),
  ).toBeVisible();
  await expect(policy).toContainText("Each thread counts once");
  await expect(policy).toContainText("the same published score");
  await expect(policy).toContainText("These accounts do not change that score");
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
  await expect(section).toContainText(location.coverageExplanation);
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
    await expect(result.section).toContainText(location.coverageExplanation);
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
