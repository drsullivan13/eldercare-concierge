import { expect, test, type Page } from "@playwright/test";
import type { SearchProvider, SearchResponse } from "../../src/lib/providers";
import { createEmptyWorkspace, type Workspace } from "../../src/lib/workspace";
import { homeCareProvider } from "../helpers/home-care-outreach";

test.use({ timezoneId: "America/Los_Angeles" });

const key = "harbor.demo.workspace.v1";
const invitationBody =
  "Hello,\n\nThank you for speaking with us. Our family would like to invite you for an in-home introduction.\n\nWould Tuesday, November 17, 2026 at 5:30 PM EST (New Jersey time) work for you? Please confirm or suggest another time.\n\nThank you";

async function start(page: Page, provider: SearchProvider) {
  await page.clock.setFixedTime(new Date("2026-11-14T15:00:00.000Z"));
  const workspace = createEmptyWorkspace();
  workspace.profile.zip = "07928";
  workspace.profile.careTypes = ["home-care"];
  await page.addInitScript(
    ({ key, workspace }) => {
      localStorage.setItem(key, JSON.stringify(workspace));
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (value: string) => {
            document.documentElement.dataset.copiedDraft = value;
          },
        },
      });
    },
    { key, workspace },
  );
  const search: SearchResponse = {
    market: { id: "north-jersey", label: "North Jersey", state: "NJ" },
    providers: [provider],
    total: 1,
    origin: { zip: "07928", city: "Chatham", lat: 40.74, lng: -74.38 },
    radius: 25,
    catalogTotal: 1,
    asOf: "2026-11-14",
    categories: { [provider.category]: 1 },
    excludedWithoutCoordinates: 0,
    experienceCoverage: {
      scored: 0,
      unscored: 1,
      facebookFindings: 0,
      facebookCovered: 0,
    },
  };
  await page.route("**/api/search?**", (route) =>
    route.fulfill({ json: search }),
  );
  await page.route("**/api/providers?**", (route) =>
    route.fulfill({ json: { providers: [provider] } }),
  );
  await page.route("**/api/research?**", (route) =>
    route.fulfill({ status: 404, json: { error: "No test research" } }),
  );
  await page.goto("/dashboard?demo=1");
  await page
    .getByRole("button", { name: "Find in-home care", exact: true })
    .click();
  await page
    .locator(".provider-card")
    .getByRole("button", { name: provider.name, exact: true })
    .click();
  return page.getByRole("dialog", { name: provider.name, exact: true });
}

function stored(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
}

test("Los Angeles dates become exact Eastern invitation drafts, never sent or recorded automatically", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const provider = { ...homeCareProvider, id: "north-jersey-hp-hp0022500" };
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  const dialog = await start(page, provider);
  await expect(
    dialog.getByRole("button", {
      name: "Agency interview & introduction",
      exact: true,
    }),
  ).toHaveClass(/button-primary/);
  await expect(
    dialog.getByRole("button", { name: "Voice rehearsal", exact: true }),
  ).toHaveClass(/button-outline/);
  await dialog
    .getByRole("button", {
      name: "Agency interview & introduction",
      exact: true,
    })
    .click();
  const workflow = dialog.getByRole("region", {
    name: "Agency interview & in-home introduction",
    exact: true,
  });
  const draft = workflow.getByRole("region", { name: "Family outreach draft" });
  await expect(draft.getByLabel("Call, email or form draft")).toContainText(
    "Could we arrange a phone interview",
  );
  await workflow
    .getByLabel("Interview status or actual outcome")
    .selectOption("suitable");
  await workflow
    .getByLabel("Actual interview date and time")
    .fill("2026-11-12T10:00");
  await expect(workflow).toContainText("Input time zone: America/Los_Angeles");
  await expect(
    workflow.getByLabel("In-home introduction date and time"),
  ).toBeDisabled();
  await expect(draft).not.toContainText("Thank you for speaking with us");
  expect((await stored(page)).homeCareOutreach).toBeUndefined();
  await workflow
    .getByRole("button", { name: "Record interview details" })
    .click();
  await expect(
    workflow.getByLabel("In-home introduction date and time"),
  ).toBeEnabled();
  await expect(draft.getByRole("link")).toHaveCount(0);
  await workflow
    .getByLabel("In-home introduction date and time")
    .fill("2026-11-12T10:00");
  await expect(draft.getByRole("link")).toHaveCount(0);
  await workflow
    .getByLabel("In-home introduction date and time")
    .fill("2026-11-11T10:00");
  await expect(draft.getByRole("link")).toHaveCount(0);
  await workflow
    .getByLabel("In-home introduction date and time")
    .fill("2026-11-17T14:30");
  const message = draft.getByLabel("Call, email or form draft");
  await expect(message).toHaveValue(invitationBody);
  const email = draft.getByRole("link", {
    name: "Draft an email",
    exact: true,
  });
  const href = new URL((await email.getAttribute("href"))!);
  expect(href.pathname).toBe("bergenhomecare@gmail.com");
  expect(href.searchParams.get("subject")).toBe("In-home introduction");
  expect(href.searchParams.get("body")).toBe(invitationBody);
  await draft.getByRole("button", { name: "Copy draft" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied-draft",
    invitationBody,
  );
  await email.evaluate((link) =>
    link.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    }),
  );
  await email.click();
  expect((await stored(page)).homeCareOutreach?.[provider.id]).toMatchObject({
    stage: "interview",
    interview: {
      status: "completed",
      outcome: "suitable",
      occurredAt: "2026-11-12T18:00:00.000Z",
    },
  });
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  expect((await stored(page)).homeCareOutreach?.[provider.id]).toMatchObject({
    stage: "introduction",
    introduction: { status: "proposed", startsAt: "2026-11-17T22:30:00.000Z" },
  });
  await workflow
    .getByLabel("Family-recorded confirmation status")
    .selectOption("confirmed");
  expect((await stored(page)).homeCareOutreach?.[provider.id]).toHaveProperty(
    "introduction.status",
    "proposed",
  );
  await workflow
    .getByRole("button", { name: "Record introduction details" })
    .click();
  expect((await stored(page)).homeCareOutreach?.[provider.id]).toHaveProperty(
    "introduction.status",
    "confirmed",
  );
  await expect(message).toHaveValue(invitationBody);
  expect(writes).toEqual([]);
  expect(
    await workflow.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await workflow
    .getByLabel("Interview status or actual outcome")
    .selectOption("not-suitable");
  await expect(draft.getByRole("link")).toHaveCount(0);
  await expect(
    workflow.getByLabel("In-home introduction date and time"),
  ).toBeDisabled();
});

test("an agency without published contact routes still has a copyable interview request", async ({
  page,
}) => {
  const provider = {
    ...homeCareProvider,
    phone: undefined,
    website: undefined,
    sources: [],
  };
  const dialog = await start(page, provider);
  await dialog
    .getByRole("button", {
      name: "Agency interview & introduction",
      exact: true,
    })
    .click();
  const workflow = dialog.getByRole("region", {
    name: "Agency interview & in-home introduction",
    exact: true,
  });
  const draft = workflow.getByRole("region", { name: "Family outreach draft" });
  await expect(draft.getByLabel("Call, email or form draft")).toContainText(
    "What times are available?",
  );
  await expect(
    draft.getByLabel("Agency contact routes").getByRole("link"),
  ).toHaveCount(0);
  await workflow
    .getByLabel("Interview status or actual outcome")
    .selectOption("scheduled");
  await workflow
    .getByLabel("Interview date and time", { exact: true })
    .fill("2026-11-16T09:30");
  await expect(draft.getByLabel("Call, email or form draft")).toContainText(
    "Monday, November 16, 2026 at 12:30 PM EST (New Jersey time)",
  );
  expect((await stored(page)).homeCareOutreach).toBeUndefined();
});

for (const category of [
  "home-health",
  "staffing",
  "assisted-living",
] as const) {
  test(`${category} keeps its existing outreach without the home-care agency workflow`, async ({
    page,
  }) => {
    const dialog = await start(page, { ...homeCareProvider, category });
    await expect(
      dialog.getByRole("button", { name: "Prepare outreach", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Agency interview & introduction",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("region", { name: "Family outreach draft" }),
    ).toHaveCount(0);
  });
}
