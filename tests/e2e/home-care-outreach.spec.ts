import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SearchResponse } from "../../src/lib/providers";
import { createEmptyWorkspace, type Workspace } from "../../src/lib/workspace";
import { homeCareProvider as provider } from "../helpers/home-care-outreach";

const key = "harbor.demo.workspace.v1";
const search: SearchResponse = {
  market: { id: "north-jersey", label: "North Jersey", state: "NJ" },
  providers: [provider],
  total: 1,
  origin: { zip: "07928", city: "Chatham", lat: 40.74, lng: -74.38 },
  radius: 25,
  catalogTotal: 1,
  asOf: "2026-11-13",
  categories: { "home-care": 1 },
  excludedWithoutCoordinates: 0,
  experienceCoverage: {
    scored: 0,
    unscored: 1,
    facebookFindings: 0,
    facebookCovered: 0,
  },
};

async function start(page: Page, contact = true) {
  await page.clock.setFixedTime(new Date("2026-11-14T15:00:00.000Z"));
  const agency = contact
    ? provider
    : { ...provider, phone: undefined, website: undefined, sources: [] };
  const workspace = {
    ...createEmptyWorkspace(),
    profile: {
      name: "Private family name",
      relationship: "A parent",
      zip: "07928",
      careTypes: [],
    },
    notes: { untouched: "Existing family note" },
  };
  await page.addInitScript(
    ({ key, workspace }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(workspace));
    },
    { key, workspace },
  );
  await page.route("**/api/search?**", (route) =>
    route.fulfill({ json: { ...search, providers: [agency] } }),
  );
  await page.route("**/api/providers?**", (route) =>
    route.fulfill({ json: { providers: [agency] } }),
  );
  await page.route("**/api/research?**", (route) =>
    route.fulfill({ status: 404, json: { error: "No test research" } }),
  );
  await page.goto("/dashboard?demo=1");
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".side-nav")
    .getByRole("button", { name, exact: true })
    .click();
}

async function open(page: Page) {
  await navigate(page, "Find care");
  await page
    .locator(".provider-card")
    .getByRole("button", { name: provider.name, exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: provider.name, exact: true });
  await detail
    .getByRole("button", {
      name: "Agency interview & introduction",
      exact: true,
    })
    .click();
  return detail.getByRole("region", {
    name: "Agency interview & in-home introduction",
    exact: true,
  });
}

function stored(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
}

async function suitable(workflow: Locator) {
  await workflow
    .getByLabel("Interview status or actual outcome")
    .selectOption("suitable");
  await workflow
    .getByLabel("Actual interview date and time")
    .fill("2026-11-12T10:00");
  await workflow
    .getByLabel("Family interview notes")
    .fill("Confirm backup coverage.");
  await workflow
    .getByRole("button", { name: "Record interview details" })
    .click();
  await expect(
    workflow.getByLabel("In-home introduction date and time"),
  ).toBeEnabled();
}

test("home-care-outreach records a real interview before a family-proposed or confirmed introduction and reopens from the plan", async ({
  page,
}) => {
  await start(page);
  let workflow = await open(page);
  const contacts = workflow.getByLabel("Agency contact routes");
  await expect(
    contacts.getByRole("link", { name: "Call 9735550100" }),
  ).toHaveAttribute("href", "tel:9735550100");
  await expect(
    contacts.getByRole("link", { name: "Draft an email" }),
  ).toHaveAttribute("href", /^mailto:care@agency\.example\.invalid\?subject=/);
  await expect(
    contacts.getByRole("link", { name: "Care inquiry", exact: true }),
  ).toHaveAttribute("href", "https://agency.example.invalid/contact");
  await expect(workflow.getByRole("region", { name: "Family outreach draft" })).toBeVisible();
  await expect(
    workflow.getByLabel("In-home introduction date and time"),
  ).toBeDisabled();
  expect((await stored(page)).homeCareOutreach).toBeUndefined();
  await page
    .context()
    .route("https://agency.example.invalid/**", (route) =>
      route.fulfill({
        body: "<p>Test contact page</p>",
        contentType: "text/html",
      }),
    );
  const popupEvent = page.context().waitForEvent("page");
  await contacts
    .getByRole("link", { name: "Care inquiry", exact: true })
    .click();
  await (await popupEvent).close();
  expect((await stored(page)).homeCareOutreach).toBeUndefined();
  await workflow
    .getByLabel("Interview status or actual outcome")
    .selectOption("scheduled");
  await workflow
    .getByLabel("Interview date and time", { exact: true })
    .fill("2026-11-16T09:30");
  await workflow
    .getByRole("button", { name: "Record interview details" })
    .click();
  await expect
    .poll(
      async () =>
        (await stored(page)).homeCareOutreach?.[provider.id].interview.status,
    )
    .toBe("scheduled");
  const scheduled = (await stored(page)).homeCareOutreach![provider.id];
  await page.reload();
  workflow = await open(page);
  await expect(
    workflow.getByLabel("Interview date and time", { exact: true }),
  ).toHaveValue("2026-11-16T09:30");
  expect((await stored(page)).homeCareOutreach![provider.id]).toEqual(
    scheduled,
  );
  await suitable(workflow);
  await workflow
    .getByLabel("In-home introduction date and time")
    .fill("2026-11-17T14:30");
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  await expect(workflow).toContainText(
    "confirm the proposed in-home introduction",
  );
  expect((await stored(page)).homeCareOutreach![provider.id]).toMatchObject({
    stage: "introduction",
    interview: { status: "completed", outcome: "suitable" },
    introduction: { status: "proposed" },
  });
  await workflow
    .getByLabel("Family-recorded confirmation status")
    .selectOption("confirmed");
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  await expect(workflow).toContainText("confirmed by your family");
  await workflow
    .getByLabel("In-home introduction date and time")
    .fill("2026-11-18T15:00");
  await expect(
    workflow.getByLabel("Family-recorded confirmation status"),
  ).toHaveValue("proposed");
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  await workflow
    .getByLabel("Family-recorded confirmation status")
    .selectOption("confirmed");
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  await page.reload();
  await navigate(page, "Your plan");
  const plan = page.getByRole("region", {
    name: "Agency interviews and introductions",
  });
  await expect(plan).toContainText("confirmed by your family");
  await expect(plan.locator("time")).toHaveCount(1);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export your plan", exact: true })
    .first()
    .click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  let exported = "";
  for await (const chunk of stream!) exported += chunk.toString();
  expect(exported).toContain("Family-recorded confirmation: confirmed");
  expect(exported).toContain("Confirm backup coverage.");
  await plan
    .getByRole("button", { name: `Open agency workflow for ${provider.name}` })
    .click();
  workflow = page.getByRole("region", {
    name: "Agency interview & in-home introduction",
    exact: true,
  });
  await expect(
    workflow.getByLabel("Family-recorded confirmation status"),
  ).toHaveValue("confirmed");
  await expect(
    workflow.getByLabel("In-home introduction date and time"),
  ).toHaveValue("2026-11-18T15:00");
  const findings = await new AxeBuilder({ page })
    .include("dialog[open]")
    .analyze();
  expect(findings.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await workflow.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const saved = await stored(page);
  expect(saved.savedProviderIds).toEqual([]);
  expect(saved.notes).toEqual({ untouched: "Existing family note" });
  expect(saved.outreach).toBeUndefined();
});

test("home-care-outreach corrections remove stale confirmation and every unsuccessful outcome stays gated", async ({
  page,
}) => {
  await start(page);
  const workflow = await open(page);
  await suitable(workflow);
  await workflow
    .getByLabel("In-home introduction date and time")
    .fill("2026-11-17T14:30");
  await workflow
    .getByLabel("Family-recorded confirmation status")
    .selectOption("confirmed");
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  for (const outcome of [
    "not-suitable",
    "declined",
    "no-response",
    "reschedule",
  ]) {
    await workflow
      .getByLabel("Interview status or actual outcome")
      .selectOption(outcome);
    if (outcome === "not-suitable")
      await workflow
        .getByLabel("Actual interview date and time")
        .fill("2026-11-12T10:00");
    await workflow
      .getByRole("button", { name: "Record interview details" })
      .click();
    await expect(
      workflow.getByLabel("In-home introduction date and time"),
    ).toBeDisabled();
    const record = (await stored(page)).homeCareOutreach![provider.id];
    expect(record.stage).toBe("interview");
    expect(record).not.toHaveProperty("introduction");
  }
  await suitable(workflow);
  await expect(
    workflow.getByLabel("In-home introduction date and time"),
  ).toHaveValue("");
  await expect(
    workflow.getByLabel("Family-recorded confirmation status"),
  ).toHaveValue("proposed");
  await workflow
    .getByLabel("In-home introduction date and time")
    .fill("2026-11-11T09:00");
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  await expect(workflow.getByRole("alert")).toContainText(
    "after the interview",
  );
  expect((await stored(page)).homeCareOutreach![provider.id].stage).toBe(
    "interview",
  );
  await workflow
    .getByLabel("Interview status or actual outcome")
    .selectOption("suitable");
  await workflow
    .getByLabel("Actual interview date and time")
    .fill("2026-11-20T09:00");
  await workflow
    .getByRole("button", { name: "Record interview details" })
    .click();
  await expect(workflow.getByRole("alert")).toContainText(
    "cannot have happened in the future",
  );
});

test("home-care-outreach missing contacts stay missing and failed demo writes never claim success", async ({
  page,
}) => {
  await start(page, false);
  const workflow = await open(page);
  await expect(
    workflow.getByLabel("Agency contact routes").getByRole("link"),
  ).toHaveCount(0);
  await expect(workflow).toContainText("No contact route is published");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Test storage failure");
    };
  });
  await workflow
    .getByLabel("Interview status or actual outcome")
    .selectOption("scheduled");
  await workflow
    .getByLabel("Interview date and time", { exact: true })
    .fill("2026-11-16T09:30");
  await workflow
    .getByRole("button", { name: "Record interview details" })
    .click();
  await expect(workflow.getByRole("alert")).toContainText(
    "could not be applied",
  );
  await expect(workflow.getByRole("status")).toContainText(
    "could not save this change",
  );
  expect((await stored(page)).homeCareOutreach).toBeUndefined();
});
