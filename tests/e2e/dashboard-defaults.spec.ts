import { expect, test } from "@playwright/test";

test("fresh demo starts in Chatham and an explicitly chosen ZIP stays selected", async ({
  page,
}) => {
  const firstSearch = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/search",
  );
  await page.goto("/dashboard?demo=1");
  const zip = page.getByRole("textbox", { name: "Search ZIP code" });
  await expect(zip).toHaveValue("07928");
  const response = await firstSearch;
  expect(new URL(response.url()).searchParams.get("zip")).toBe("07928");
  expect(response.status()).toBe(200);
  expect((await response.json()).origin).toMatchObject({
    zip: "07928",
    city: "Chatham",
  });
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("harbor.demo.workspace.v1")!).profile
          .zip,
    ),
  ).toBe("07928");
  await zip.fill("02459");
  await page
    .locator("form.quick-search")
    .getByRole("button", { name: "Find care", exact: true })
    .click();
  await expect(page.locator(".search-summary")).toContainText(
    "Newton Center, 02459",
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search ZIP code" }),
  ).toHaveValue("02459");
  await page
    .getByRole("combobox", { name: "Search radius" })
    .selectOption("10");
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/search" && url.searchParams.get("radius") === "10"
    );
  });
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  expect(new URL((await filtered).url()).searchParams.get("zip")).toBe("02459");
  await expect(page.locator(".search-summary")).toContainText(
    "Newton Center, 02459",
  );
});
