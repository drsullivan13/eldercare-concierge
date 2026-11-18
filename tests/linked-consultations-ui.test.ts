import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import {
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

test(
  "linked consultations are lazy, distinguish pending receipts and require real-request consent",
  { timeout: 60000 },
  async () => {
    const bundled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client'; import {LinkedConsultations} from './src/components/dashboard/linked-consultations'; createRoot(document.getElementById('root')).render(<LinkedConsultations requestId="11111111-1111-4111-8111-111111111111" providerId="office" email="family@example.invalid"/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      loader: { ".css": "empty", ".module.css": "empty" },
      tsconfig: "tsconfig.json",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const browser = await launchWorkspaceBrowser();
    try {
      const page = await browser.newPage();
      let reads = 0;
      let occupied = false;
      let confirmed = false;
      const submitted: Record<string, unknown>[] = [];
      await page.route("https://harbor.test/api/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/outreach-bookings") {
          reads++;
          assert.equal(
            url.searchParams.get("requestId"),
            "11111111-1111-4111-8111-111111111111",
          );
          await route.fulfill({
            json: {
              bookings: [
                {
                  bookingId: "pending",
                  providerId: "office",
                  status: confirmed ? "confirmed" : "unknown",
                  source: "phone",
                  startsAt: confirmed ? "2099-12-01T12:00:00Z" : null,
                  timezone: "America/New_York",
                  nextAction: confirmed
                    ? "review_confirmation"
                    : "wait_for_receipt",
                },
              ],
            },
          });
        } else if (route.request().method() === "GET")
          await route.fulfill({
            json: {
              configured: true,
              source: "phone",
              phoneRequired: true,
              bookings: occupied
                ? [
                    {
                      id: "unrelated",
                      provider_id: "office",
                      agency_name: "Unrelated appointment",
                      status: "confirmed",
                      source: "phone",
                      timezone: "America/New_York",
                      starts_at: "2099-12-02T12:00:00Z",
                      ends_at: "2099-12-02T13:00:00Z",
                    },
                  ]
                : [],
            },
          });
        else {
          submitted.push(route.request().postDataJSON());
          await route.fulfill({
            json: {
              booking: {
                id: "booking",
                provider_id: "office",
                agency_name: "Office",
                status: "unknown",
                source: "phone",
                timezone: "America/New_York",
                starts_at: null,
                ends_at: null,
              },
            },
          });
        }
      });
      await openWorkspacePage(page, {});
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      await expect(
        page.getByText("Actual consultations for this request"),
      ).toBeVisible();
      assert.equal(reads, 0);
      await page.getByText("Actual consultations for this request").click();
      await expect(
        page.getByText("Awaiting receipt", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/No consultation is confirmed yet/),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Request an actual consultation with this office",
        })
        .click();
      await page.getByLabel("Your name").fill("Family member");
      await page.getByLabel("Callback number").fill("2015551234");
      const start = new Date(Date.now() + 86400000).toISOString().slice(0, 16),
        end = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
      await page.getByLabel("Available from").fill(start);
      await page.getByLabel("Available until").fill(end);
      const submit = page.getByRole("button", {
        name: "Ask Harbor to call and book",
      });
      await expect(submit).toBeDisabled();
      await page.getByRole("checkbox").check();
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect.poll(() => submitted.length).toBe(1);
      assert.equal(
        submitted[0].outreachRequestId,
        "11111111-1111-4111-8111-111111111111",
      );
      await expect(
        page.getByRole("button", { name: "Close consultation request" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close consultation request" })
        .click();
      occupied = true;
      await page
        .getByRole("button", {
          name: "Request an actual consultation with this office",
        })
        .click();
      await expect(
        page.getByText(/already has an active consultation request/),
      ).toBeVisible();
      await expect(page.getByText(/Unrelated appointment/)).toHaveCount(0);
      await expect(
        page.getByText("Consultation confirmed", { exact: true }),
      ).toHaveCount(0);
      confirmed = true;
      await page
        .getByRole("button", { name: "Refresh linked consultations" })
        .click();
      await expect(
        page.getByText("Consultation confirmed", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Care has not been arranged/)).toBeVisible();
      await expect(page.getByText(/Unrelated appointment/)).toHaveCount(0);
      await page.close();
    } finally {
      await browser.close();
    }
  },
);
