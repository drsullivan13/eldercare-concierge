import { expect, test } from "@playwright/test";
import { openSavedRegistryListing } from "./saved-registry-listing";

const offices = [
  {
    id: "north-jersey-hp-hp0347500",
    name: "AMOR HOMECARE OF NJ INC.",
    service: "personal care assistance",
    url: "https://www.njmmis.com/providerDirectory.aspx?nonBilling=False",
  },
  {
    id: "north-jersey-hp-hp0076201",
    name: "LOVING CARE AGENCY INC DBA AVEANNA HEALTHCARE",
    service: "private duty nursing",
    url: "https://www.njmmis.com/providerDirectory.aspx?nonBilling=False",
  },
];

for (const office of offices) {
  test(`NJMMIS care facts retain plan confirmation in ${office.name} details`, async ({
    page,
  }) => {
    const dialog = await openSavedRegistryListing(page, office.id, office.name);
    await dialog.getByRole("tab", { name: "Details", exact: true }).click();
    const care = dialog.locator(".daily-life-care");
    await expect(care).toContainText(
      `New Jersey Medicaid lists this office for ${office.service}.`,
    );
    await expect(care).toContainText(
      "Confirm coverage for this office and service with your health plan.",
    );
    await expect(care).not.toContainText(
      /billing phone|open to new patients|accepts insurance|Internal Medicine|TBI Respite Inpatient/i,
    );
    await care
      .locator(".daily-life-sources")
      .getByText("Sources & full wording", { exact: true })
      .click();
    await expect(
      care.getByRole("link", {
        name: /New Jersey Medicaid \(NJMMIS\).*NJMMIS Home Care Provider directory/,
      }),
    ).toHaveAttribute("href", office.url);
  });
}
