import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import {
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

test(
  "family follow-ups survive reload and retry without duplicate tasks or appointment claims",
  { timeout: 60000 },
  async () => {
    const bundled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client'; import {AccountOutreachHistory} from './src/components/dashboard/account-outreach'; createRoot(document.getElementById('root')).render(<AccountOutreachHistory available={false}/>);`,
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
      const page = await browser.newPage({ timezoneId: "America/New_York" });
      const requestId = "11111111-1111-4111-8111-111111111111";
      const rows: Record<string, unknown>[] = [];
      const posts: Record<string, unknown>[] = [];
      let reads = 0,
        patches = 0;
      await page.route("https://harbor.test/api/**", async (route) => {
        const req = route.request();
        if (new URL(req.url()).pathname !== "/api/outreach-followups") {
          await route.fulfill({
            json: {
              requests: [
                {
                  requestId,
                  providerId: "office",
                  providerName: "Office",
                  status: "requested",
                  createdAt: "2026-11-18T12:00:00Z",
                },
              ],
              reports: [],
              receipts: [],
              bookings: [],
            },
          });
          return;
        }
        if (req.method() === "GET") {
          reads++;
          assert.equal(new URL(req.url()).search, "");
          await route.fulfill({
            json: { followups: rows, serverNow: "2026-11-18T16:00:00Z" },
          });
        } else if (req.method() === "POST") {
          const body = req.postDataJSON();
          posts.push(body);
          if (!rows.length)
            rows.push({ ...body, status: "open", dueAt: body.dueAt ?? null });
          await route.fulfill({
            status: posts.length === 1 ? 503 : 200,
            json: { replayed: posts.length > 1 },
          });
        } else {
          patches++;
          rows[0].status = "done";
          await route.fulfill({
            status: patches === 1 ? 503 : 200,
            json: { replayed: patches > 1 },
          });
        }
      });
      await openWorkspacePage(page, {});
      const mount = () =>
        page.addScriptTag({ content: bundled.outputFiles[0].text });
      await mount();
      const region = page.getByRole("region", { name: "Family follow-ups" });
      await expect(
        region.getByText("No family follow-ups recorded yet."),
      ).toBeVisible();
      assert.equal(reads, 1);
      await region
        .getByText("Record a family follow-up", { exact: true })
        .click();
      await region
        .getByLabel("Short summary (no transcripts)")
        .fill("Ask about weekend care");
      await region.getByLabel(/Due date and time/).fill("2026-11-17T09:00");
      await region
        .getByRole("button", { name: "Save family follow-up" })
        .click();
      await expect(region.getByRole("alert")).toContainText("retained");
      await region
        .getByRole("button", { name: "Save family follow-up" })
        .click();
      await expect(
        region.getByText("Ask about weekend care", { exact: true }),
      ).toBeVisible();
      assert.deepEqual(posts[0], posts[1]);
      assert.equal(posts[0].source, "user_reported");
      assert.equal(posts[0].dueAt, "2026-11-17T14:00:00.000Z");
      await expect(region).toContainText("Overdue");
      await expect(region).toContainText("America/New_York");
      await page.reload();
      await mount();
      await expect(
        region.getByText("Ask about weekend care", { exact: true }),
      ).toBeVisible();
      const complete = region.getByRole("button", {
        name: "Mark done: Ask about weekend care",
      });
      await complete.click();
      await expect(region.getByRole("alert")).toBeVisible();
      await complete.click();
      await expect(region.getByText(/Marked done by family/)).toBeVisible();
      assert.equal(patches, 2);
      assert.equal(rows.length, 1);
      assert.equal(reads, 4);
      await expect(
        page.getByText("Consultation confirmed", { exact: true }),
      ).toHaveCount(0);
      assert.equal(await page.evaluate(() => localStorage.length), 0);
    } finally {
      await browser.close();
    }
  },
);
