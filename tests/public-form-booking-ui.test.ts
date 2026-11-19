import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import {
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

test(
  "signed-in family approves one booking window and sees its durable status after a lost response",
  { timeout: 60000 },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';
      import {AgencyConsultation} from './src/components/dashboard/agency-consultation';
      import {PublicFormBooking} from './src/components/dashboard/public-form-booking';
      createRoot(document.getElementById('root')).render(location.hash === '#plan' ? <PublicFormBooking email="pilot@example.test" historyOnly/> : <AgencyConsultation providerId="north-jersey-hp-hp0265900" email="pilot@example.test"/>);`,
        loader: "tsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      platform: "browser",
      loader: { ".module.css": "empty" },
      tsconfig: "tsconfig.json",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const browser = await launchWorkspaceBrowser();
    try {
      const page = await browser.newPage({ timezoneId: "America/Los_Angeles" });
      await page.clock.install({ time: new Date("2026-11-19T10:00:00Z") });
      const email = "pilot@example.test";
      let job: {
        id: string;
        status: string;
        windowStart: string;
        windowEnd: string;
        startTime: string | null;
        receipt: string | null;
      } | null = null;
      const posts: Record<string, unknown>[] = [];
      await page.route("https://harbor.test/api/**", async (route) => {
        if (new URL(route.request().url()).pathname === "/api/consultations")
          return route.fulfill({
            json: {
              configured: false,
              publicUrl: "https://elderlysaviorhc.com/book-now",
              bookings: [],
            },
          });
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          posts.push(body);
          assert.deepEqual(body, {
            requestId: body.requestId,
            action: "bookWindow",
            providerId: "north-jersey-hp-hp0265900",
            windowStart: "2026-11-30T15:00:00.000Z",
            windowEnd: "2026-11-30T17:00:00.000Z",
            name: "Test Family",
            phone: "2015550123",
            expectedEmail: email,
            consentVersion: "elderly-savior-v1",
          });
          assert.match(body.requestId, /^[a-f0-9-]{36}$/);
          job = {
            id: body.requestId,
            status: "queued_booking",
            windowStart: body.windowStart,
            windowEnd: body.windowEnd,
            startTime: null,
            receipt: null,
          };
          return route.abort();
        }
        return route.fulfill({ json: { email, job } });
      });
      await openWorkspacePage(page, {});
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(
        page.getByRole("link", { name: "Open the agency’s booking calendar" }),
      ).toBeVisible();
      await page.getByLabel("Earliest start").fill("2026-11-30T07:00");
      await page.getByLabel("Latest finish").fill("2026-11-30T09:00");
      await expect(page.getByText(/New Jersey time/)).toContainText("10:00");
      await page.getByLabel("Full name").fill("Test Family");
      await page.getByLabel("US phone number").fill("2015550123");
      const book = page.getByRole("button", { name: "Book for me" });
      await expect(book).toBeDisabled();
      await page.getByRole("checkbox", { name: /I authorize Harbor/ }).check();
      await book.click();
      await expect(page.getByRole("alert")).toBeVisible();
      await page.getByRole("button", { name: "Check booking status" }).click();
      await expect(
        page.getByText(/Harbor received your approval/),
      ).toBeVisible();
      await expect(book).toHaveCount(0);
      Object.assign(job!, {
        status: "unknown",
        startTime: "2026-11-30T15:15:00Z",
      });
      await page.clock.fastForward(4000);
      await expect(page.getByRole("status")).toHaveText(
        "Awaiting verification",
      );
      await expect(page.getByText(/Requested start ·/)).toContainText("10:15");
      await expect(book).toHaveCount(0);
      Object.assign(job!, {
        status: "confirmed",
        startTime: "2026-11-30T15:15:00Z",
        receipt: "Office receipt 123",
      });
      await page.getByRole("button", { name: "Refresh status" }).click();
      await expect(page.getByRole("status")).toHaveText("Scheduled");
      await expect(page.getByText(/Requested start ·/)).toHaveCount(0);
      await page.evaluate(() => {
        location.hash = "plan";
      });
      await page.reload();
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(
        page.getByRole("heading", {
          name: "Latest Elderly Savior consultation",
        }),
      ).toBeVisible();
      await expect(page.getByText(/Appointment ·/)).toContainText("10:15");
      await expect(
        page.getByText("Agency receipt · Office receipt 123"),
      ).toBeVisible();
      await expect(book).toHaveCount(0);
      assert.equal(posts.length, 1);
    } finally {
      await browser.close();
    }
  },
);
