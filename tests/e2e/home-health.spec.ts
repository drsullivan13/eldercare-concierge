import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import catalogue from "../../src/data/providers.json";
import type { HomeHealthEvidenceResponse } from "../../src/lib/home-health";

// Expected values come from retained CMS rows, independently of the API's
// normalized snapshot. Explicit identities prevent a plausible network average
// or a different affiliate's scores from satisfying these checks.
const matches: Record<string, string[]> = {
  "vna-care": ["227068", "227098"],
  "south-shore-vna": ["227082"],
  "mgb-home-care": ["227207"],
  "croi-health": ["227241"],
  "all-care": ["227263"],
  "bilh-at-home": ["227495"],
};
type RawRow = Record<string, string>;
function retainedRows(file: string) {
  return JSON.parse(
    readFileSync(`src/data/inputs/home-health/${file}`, "utf8"),
  ) as RawRow[];
}
const qualityRows = retainedRows("matched-6jpm-sxkc.json");
const surveyRows = retainedRows("matched-ccn4-8vby.json");
const surveyDates = retainedRows("matched-fa88-6ff2.json");
const clinicalDates = retainedRows("matched-c886-nwpj.json");
const surveyColumns = {
  "professional-care":
    "Percent of patients who reported that their home health team gave care in a professional way",
  communication:
    "Percent of patients who reported that their home health team communicated well with them",
  "medicines-pain-home-safety":
    "Percent of patients who reported that their home health team discussed medicines, pain, and home safety with them",
  "overall-care-9-or-10":
    "Percent of patients who gave their home health agency a rating of 9 or 10 on a scale from 0 (lowest) to 10 (highest)",
  "definitely-recommend":
    "Percent of patients who reported YES, they would definitely recommend the home health agency to friends and family",
};
const clinicalColumns = [
  "How often the home health team began their patients' care in a timely manner",
  "How often patients got better at walking or moving around",
  "How often patients got better at getting in and out of bed",
  "How often patients got better at bathing",
  "How often patients' breathing improved",
  "How often patients got better at taking their drugs correctly by mouth",
  "PPH Risk-Standardized Rate",
];

function rawFor(rows: RawRow[], ccn: string) {
  const row = rows.find(
    (item) => item["CMS Certification Number (CCN)"] === ccn,
  );
  expect(row, `retained CMS row for ${ccn}`).toBeDefined();
  return row!;
}

async function openHomeHealth(page: Page) {
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
  await page
    .locator(".category-tabs")
    .getByRole("button", { name: "Skilled home health", exact: true })
    .click();
  await expect(page.locator("article.provider-card")).toHaveCount(6);
}

async function openProvider(page: Page, providerId: string) {
  const provider = catalogue.find((item) => item.id === providerId)!;
  const card = page.locator("article.provider-card").filter({
    has: page.getByRole("button", { name: provider.name, exact: true }),
  });
  await card.getByRole("button", { name: "View details" }).click();
  return page.getByRole("dialog", { name: provider.name, exact: true });
}

async function noHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.width + 1);
}

test("home-health API preserves all seven CMS identities, values and reporting periods, and rejects unrelated queries", async ({
  request,
}) => {
  const seen = new Set<string>();
  for (const [providerId, ccns] of Object.entries(matches)) {
    const response = await request.get("/api/home-health-evidence", {
      params: { providerId },
    });
    expect(response.status()).toBe(200);
    const data = (await response.json()) as HomeHealthEvidenceResponse;
    expect(data.providerId).toBe(providerId);
    expect(data.releasedAt).toBe("2026-10-21");
    expect(data.retrieved).toBe("2026-11-12");
    expect(data.agencies.map((agency) => agency.ccn).sort()).toEqual(
      [...ccns].sort(),
    );
    for (const agency of data.agencies) {
      seen.add(agency.ccn);
      const quality = rawFor(qualityRows, agency.ccn);
      const survey = rawFor(surveyRows, agency.ccn);
      expect(agency.cmsProviderName).toBe(quality["Provider Name"]);
      expect(agency.cmsAddress.street).toBe(quality.Address);
      expect(agency.cmsAddress.zip).toBe(quality["ZIP Code"]);
      expect(agency.qualityOfPatientCare.starRating.value).toBe(
        Number(quality["Quality of patient care star rating"]),
      );
      expect(agency.patientExperience.summaryStarRating.value).toBe(
        Number(survey["HHCAHPS Survey Summary Star Rating"]),
      );
      expect(agency.patientExperience.completedSurveys.value).toBe(
        Number(survey["Number of completed Surveys"]),
      );
      expect(agency.patientExperience.responseRate.value).toBe(
        Number(survey["Survey response rate"]),
      );
      expect(agency.patientExperience.period).toMatchObject({
        start: "2025-04-01",
        end: "2026-03-31",
      });
      expect(
        surveyDates.every(
          (row) =>
            row["Measure Date Range"] === "April 1, 2025 to March 31, 2026",
        ),
      ).toBe(true);
      expect(
        agency.patientExperience.measures.map((measure) => measure.id).sort(),
      ).toEqual(Object.keys(surveyColumns).sort());
      for (const measure of agency.patientExperience.measures) {
        const column = surveyColumns[measure.id as keyof typeof surveyColumns];
        expect(measure.percent.sourceColumn).toBe(column);
        expect(measure.percent.value).toBe(Number(survey[column]));
        expect(measure.percent.rawValue).toBe(survey[column]);
        expect(measure.percent.footnoteCodes).toEqual([]);
      }
      expect(
        agency.qualityOfPatientCare.components
          .map((measure) => measure.rate.sourceColumn)
          .sort(),
      ).toEqual([...clinicalColumns].sort());
      for (const measure of agency.qualityOfPatientCare.components) {
        const column = measure.rate.sourceColumn;
        expect(measure.rate.value).toBe(Number(quality[column]));
        expect(measure.rate.rawValue).toBe(quality[column]);
        const dateName =
          column === "PPH Risk-Standardized Rate"
            ? "How often patients were admitted to the hospital for a potentially-preventable condition while receiving home health care"
            : column;
        expect(
          clinicalDates.find((row) => row["Measure Name"] === dateName)?.[
            "Measure Date Range"
          ],
        ).toBe("January 01, 2025-December 31, 2025");
        expect(measure.period).toMatchObject({
          start: "2025-01-01",
          end: "2025-12-31",
        });
      }
    }
  }
  expect([...seen].sort()).toEqual(Object.values(matches).flat().sort());

  // A CCN is not a catalog provider ID, and a valid nursing home cannot borrow
  // a home-health result. No unrelated query may leak an agency payload.
  const nursingId = catalogue.find(
    (provider) => provider.category === "nursing-home",
  )!.id;
  const invalid = [
    { query: "", status: 400 },
    { query: "?providerId=", status: 400 },
    { query: "?providerId=VNA%20Care", status: 400 },
    { query: "?providerId=vna-care&providerId=all-care", status: 400 },
    { query: "?providerId=vna-care&ccn=227068", status: 400 },
    { query: "?ccn=227068", status: 400 },
    { query: "?providerId=227068", status: 404 },
    { query: "?providerId=not-in-catalog", status: 404 },
    { query: `?providerId=${encodeURIComponent(nursingId)}`, status: 404 },
  ];
  for (const { query, status } of invalid) {
    const response = await request.get(`/api/home-health-evidence${query}`);
    expect(response.status()).toBe(status);
    const body = await response.json();
    expect(body.error).toEqual(expect.any(String));
    expect(body.agencies).toBeUndefined();
  }
});

test("families can inspect separate agency results, five patient measures and dated clinical detail without nursing-home evidence", async ({
  page,
  request,
}) => {
  await openHomeHealth(page);
  for (const [providerId, ccns] of Object.entries(matches)) {
    const response = await request.get("/api/home-health-evidence", {
      params: { providerId },
    });
    expect(response.status()).toBe(200);
    const expected = (await response.json()) as HomeHealthEvidenceResponse;
    const dialog = await openProvider(page, providerId);
    const panel = dialog.locator(".home-health-evidence");
    await expect(panel.locator(".hh-agency")).toHaveCount(ccns.length);
    await expect(panel).toContainText("CMS release: Oct 21, 2026");
    await expect(panel).toContainText(
      "Clinical quality and patient experience are separate measures.",
    );
    await expect(dialog.locator(".inspection-history")).toHaveCount(0);
    await expect(dialog.locator(".cms-ratings")).toHaveCount(0);
    if (ccns.length === 2) {
      await expect(panel).toContainText("2 matched CMS agencies");
      // VNA's published patient-survey values differ: a network average of 3.5
      // would fail these exact, agency-scoped assertions.
      await expect(
        panel.locator('[data-ccn="227068"] .hh-ratings > div').nth(1),
      ).toContainText("4 / 5");
      await expect(
        panel.locator('[data-ccn="227098"] .hh-ratings > div').nth(1),
      ).toContainText("3 / 5");
    }
    for (const agency of expected.agencies) {
      const unit = panel.locator(`.hh-agency[data-ccn="${agency.ccn}"]`);
      await expect(
        unit.getByRole("heading", {
          name: agency.cmsProviderName,
          exact: true,
        }),
      ).toBeVisible();
      await expect(unit).toContainText(agency.cmsAddress.street);
      await expect(unit).toContainText("may include multiple offices");
      const rawQuality = rawFor(qualityRows, agency.ccn);
      const rawSurvey = rawFor(surveyRows, agency.ccn);
      await expect(unit.locator(".hh-ratings > div").nth(0)).toContainText(
        `${rawQuality["Quality of patient care star rating"]} / 5`,
      );
      await expect(unit.locator(".hh-ratings > div").nth(1)).toContainText(
        `${rawSurvey["HHCAHPS Survey Summary Star Rating"]} / 5`,
      );
      await expect(unit).toContainText(
        "Survey period: April 1, 2025–March 31, 2026",
      );
      await expect(
        unit.locator(".hh-survey-context > div").nth(0),
      ).toContainText(
        Number(rawSurvey["Number of completed Surveys"]).toLocaleString(
          "en-US",
        ),
      );
      await expect(
        unit.locator(".hh-survey-context > div").nth(1),
      ).toContainText(`${rawSurvey["Survey response rate"]}%`);
      const surveyList = unit.locator(":scope > dl.hh-measures");
      await expect(surveyList.locator(":scope > div")).toHaveCount(5);
      for (const measure of agency.patientExperience.measures) {
        const row = surveyList
          .locator(":scope > div")
          .filter({ has: page.locator("dt", { hasText: measure.label }) });
        await expect(row.locator("dd")).toHaveText(
          `${rawSurvey[surveyColumns[measure.id as keyof typeof surveyColumns]]}%`,
        );
      }
      await expect(unit).toContainText("participating respondents");
      const clinical = unit.locator("details.hh-clinical-details");
      await expect(clinical.locator("dl")).not.toBeVisible();
      await clinical
        .getByText("See the clinical quality measures", { exact: true })
        .click();
      await expect(clinical.locator("dl")).toBeVisible();
      await expect(clinical.locator("dl > div")).toHaveCount(7);
      for (const measure of agency.qualityOfPatientCare.components) {
        const row = clinical
          .locator("dl > div")
          .filter({ has: page.locator("dt", { hasText: measure.label }) });
        await expect(row.locator("dd")).toHaveText(
          `${Number(rawQuality[measure.rate.sourceColumn]).toLocaleString("en-US")}%`,
        );
        await expect(row).toContainText(measure.period.label);
      }
    }
    await expect(
      panel.getByRole("link", { name: "CMS patient survey data" }),
    ).toHaveAttribute(
      "href",
      "https://data.cms.gov/provider-data/dataset/ccn4-8vby",
    );
    await expect(
      panel.getByRole("link", { name: "CMS home-health clinical data" }),
    ).toHaveAttribute(
      "href",
      "https://data.cms.gov/provider-data/dataset/6jpm-sxkc",
    );
    await expect(
      panel.getByRole("link", {
        name: "Measure definitions & reporting notes",
      }),
    ).toHaveAttribute("href", /HHS_Data_Dictionary\.pdf$/);
    await noHorizontalOverflow(page);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  }
});

test("a temporary home-health evidence failure offers a retry and recovers the actual snapshot", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/home-health-evidence?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("providerId") !==
      "south-shore-vna"
    )
      return route.continue();
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Controlled temporary failure" }),
      });
    } else {
      await route.continue();
    }
  });
  await openHomeHealth(page);
  const dialog: Locator = await openProvider(page, "south-shore-vna");
  const panel = dialog.locator(".home-health-evidence");
  await expect(panel.getByRole("alert")).toContainText(
    "snapshot could not be loaded",
  );
  await expect(panel.locator(".hh-agency")).toHaveCount(0);
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel.locator('[data-ccn="227082"]')).toBeVisible();
  await expect(panel.locator(".hh-ratings > div").nth(0)).toContainText(
    "2.5 / 5",
  );
  await expect(panel.locator(".hh-ratings > div").nth(1)).toContainText(
    "4 / 5",
  );
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
  await noHorizontalOverflow(page);
});
