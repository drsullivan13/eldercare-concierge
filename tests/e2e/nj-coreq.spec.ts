import { expect, test } from "@playwright/test";

for (const facility of [
  {
    name: "TROY HILLS CENTER",
    zip: "07054",
    value: "72%",
    ccn: "315138",
    mid: "4491700",
    cell: "AZ306",
    currentCell: "AZ307",
    code: "NS",
  },
  {
    name: "CHRISTIAN HEALTH CARE CENTER",
    zip: "07481",
    value: "92%",
    ccn: "315376",
    mid: "4463501",
    cell: "AZ88",
    currentCell: "AZ89",
    code: "NS",
  },
  {
    name: "NEW COMMUNITY EXTENDED CARE FACILITY",
    zip: "07103",
    value: "86%",
    ccn: "315393",
    mid: "4476701",
    cell: "AZ231",
    currentCell: "AZ232",
    code: "NA",
  },
]) {
  test(`${facility.name} shows source-linked FY2026 history without filling the FY2027 suppression`, async ({
    page,
  }) => {
    await page.goto("/dashboard?demo=1");
    const search = page.getByRole("region", { name: "Search nearby care" });
    await search
      .getByRole("combobox", { name: "Care type", exact: true })
      .selectOption("nursing-home");
    await search.getByLabel("Search ZIP code").fill(facility.zip);
    await search.getByLabel("Search radius").selectOption("5");
    await search.locator('button[type="submit"]').click();
    await page
      .getByRole("button", { name: facility.name, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const survey = dialog.getByRole("region", {
      name: "NJ resident & family survey",
    });
    await expect(survey).toHaveCount(0);
    await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
    await expect(survey).toBeVisible();
    await expect(survey.locator("strong")).toHaveText(facility.value);
    await expect(
      survey.getByText(/Historical result\. FY2026 reporting\/payment year/),
    ).toBeVisible();
    await expect(
      survey.getByText(/No publishable FY2027 CoreQ result/),
    ).toBeVisible();
    await expect(survey).toContainText(
      `FY2027 workbook reports ${facility.code}`,
    );
    await expect(survey).toContainText(
      "does not fill that suppression or describe current satisfaction",
    );
    const workbook = survey.getByRole("link", {
      name: "NJ DHS FY2026 workbook",
      exact: true,
    });
    await expect(workbook).toBeVisible();
    await expect(workbook).toHaveAttribute(
      "href",
      "https://www.nj.gov/humanservices/doas/documents/FY26%20NH%20Rates%20FFS%20Residents%20%20NF%20QIPP%20R1.5.7%20062626%20Final%20R1.1.xlsx",
    );
    await expect(workbook).toHaveAttribute("target", "_blank");
    await expect(workbook).toHaveAttribute("rel", "noreferrer");
    const consumer = dialog.getByRole("region", {
      name: "Review ratings & source coverage",
    });
    const experience = await consumer.textContent();
    await expect(
      dialog.getByRole("heading", {
        name: "Consumer experience index",
        exact: true,
      }),
    ).toBeVisible();
    await survey
      .getByText("Source, scope & definition", { exact: true })
      .click();
    await expect(survey).toContainText(`CMS CCN ${facility.ccn}`);
    await expect(survey).toContainText(`Medicaid Gainwell ID ${facility.mid}`);
    await expect(survey).toContainText(`cell ${facility.cell}`);
    await expect(survey).toContainText(`cell ${facility.currentCell}`);
    expect(
      await survey.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await dialog.getByRole("tab", { name: "Overview", exact: true }).click();
    await expect(survey).toHaveCount(0);
    await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
    await expect(survey.locator("strong")).toHaveText(facility.value);
    await expect(consumer).toHaveText(experience!);
  });
}

test("the certified nursing profile keeps the source-linked CoreQ composite in Reviews only", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1");
  const search = page.getByRole("region", { name: "Search nearby care" });
  await search
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("nursing-home");
  await search.getByLabel("Search ZIP code").fill("07305");
  await search.getByLabel("Search radius").selectOption("5");
  await search.locator('button[type="submit"]').click();
  await page
    .getByRole("button", {
      name: "ACCLAIM REHABILITATION AND NURSING CENTER",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  const survey = dialog.getByRole("region", {
    name: "NJ resident & family survey",
  });
  await expect(
    dialog.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(survey).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(survey).toBeVisible();
  await expect(survey.locator("strong")).toHaveText("96%");
  await expect(survey).toContainText("CoreQ satisfaction composite");
  await expect(survey).toContainText(
    "FY2027 reporting/payment year, not the survey year",
  );
  await expect(
    dialog.getByRole("heading", {
      name: "Consumer experience index",
      exact: true,
    }),
  ).toBeVisible();
  const consumer = dialog.getByRole("region", {
    name: "Review ratings & source coverage",
  });
  const experience = await consumer.textContent();
  await survey.getByText("Source, scope & definition", { exact: true }).click();
  await expect(survey).toContainText("CMS CCN 315083");
  await expect(survey).toContainText("Medicaid Gainwell ID 917532");
  await expect(survey).toContainText("cell AZ8");
  await expect(survey).toContainText(
    "survey period and sample size are not published",
  );
  await expect(
    survey.getByRole("link", { name: "NJ DHS FY2027 workbook" }),
  ).toHaveAttribute(
    "href",
    "https://www.nj.gov/humanservices/doas/documents/FY27%20NH%20Rates%20FFS%20Residents%20%20NF%20QIPP%20UPTD%20073026%20R2.4.2.2%20Final.xlsx",
  );
  await expect(
    survey.getByRole("link", { name: "NJ DHS CoreQ definition" }),
  ).toHaveAttribute(
    "href",
    "https://www.nj.gov/humanservices/doas/resources/nursing/",
  );
  expect(
    await survey.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  for (const pane of ["Overview", "Costs & perks", "Details"]) {
    await dialog.getByRole("tab", { name: pane, exact: true }).click();
    await expect(survey).toHaveCount(0);
  }
  await dialog.getByRole("tab", { name: "Reviews", exact: true }).click();
  await expect(survey.locator("strong")).toHaveText("96%");
  await expect(consumer).toHaveText(experience!);
});

test("a nursing card without consumer experience shows its FY2027 CoreQ composite and opens the same survey", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1");
  const search = page.getByRole("region", { name: "Search nearby care" });
  await search
    .getByRole("combobox", { name: "Care type", exact: true })
    .selectOption("nursing-home");
  await search.getByLabel("Search ZIP code").fill("07922");
  await search.getByLabel("Search radius").selectOption("5");
  await search.locator('button[type="submit"]').click();
  const cardFor = (name: string) =>
    page.locator("article.provider-card").filter({
      has: page.getByRole("button", { name, exact: true }),
    });
  const card = cardFor("RUNNELLS CENTER FOR REHABILITATION & HEALTHCARE");
  const score = card.locator(".experience-card-score");
  await expect(score.locator("strong")).toHaveText("89%");
  await expect(score).toContainText("NJ resident & family survey");
  await expect(score).toContainText(
    "Long-stay satisfaction composite · FY2027 reporting year",
  );
  await expect(card).not.toContainText("Not enough evidence to score");
  await expect(card.locator(".provider-review-entry")).toHaveCount(1);
  const action = card.getByRole("button", {
    name: "View survey & review sources",
    exact: true,
  });
  await expect(action).toBeVisible();
  for (const element of [card, score]) {
    expect(
      await element.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  const bounds = await score.boundingBox();
  const cardBounds = await card.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    cardBounds!.x + cardBounds!.width,
  );

  const ordinary = cardFor("AUTUMN LAKE HEALTHCARE AT BERKELEY HEIGHTS");
  await expect(ordinary.locator(".experience-card-score strong")).toHaveText(
    "9.0/10",
  );
  await expect(ordinary).toContainText("Consumer experience");
  await expect(ordinary).not.toContainText("CoreQ");
  await expect(ordinary).not.toContainText("100%");
  await expect(
    ordinary.getByRole("button", {
      name: "Browse 5 review links",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("View survey & review sources")).toHaveCount(1);

  await action.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("tab", { name: "Reviews", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const survey = dialog.getByRole("region", {
    name: "NJ resident & family survey",
  });
  await expect(survey.locator("strong")).toHaveText("89%");
  await expect(survey).toContainText(
    "FY2027 reporting/payment year, not the survey year",
  );
  await survey.getByText("Source, scope & definition", { exact: true }).click();
  await expect(survey).toContainText("CMS CCN 315009");
  await expect(survey).toContainText("cell AZ271");
  expect(
    await survey.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});
