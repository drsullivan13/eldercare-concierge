import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import {
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

test(
  "private request facts retain failed drafts, retry without duplication, and expose dated conflict evidence",
  { timeout: 60000 },
  async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const owner = "22222222-2222-4222-8222-222222222222";
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
      const page = await browser.newPage();
      await page.clock.setFixedTime(new Date("2026-11-18T12:00:00Z"));
      let activeOwner = owner;
      const rows: Record<string, unknown>[] = [];
      const posts: Record<string, unknown>[] = [];
      await page.route("https://harbor.test/api/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname !== "/api/inquiry-facts")
          return route.fulfill({
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
              followups: [],
              reports: [],
              receipts: [],
              bookings: [],
              serverNow: "2026-11-18T12:00:00Z",
            },
          });
        if (req.method() === "GET") {
          assert.equal(url.searchParams.get("requestId"), requestId);
          return route.fulfill({ json: { owner: activeOwner, facts: rows } });
        }
        const body = req.postDataJSON();
        posts.push(body);
        assert.equal(body.expectedOwner, owner);
        if (!rows.some((row) => row.id === body.fact.id)) rows.push(body.fact);
        await route.fulfill({
          status: posts.length === 1 ? 503 : 200,
          json: { owner, fact: body.fact, replayed: posts.length > 1 },
        });
      });
      await openWorkspacePage(page, {});
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      await page
        .getByText("Private office facts for this request", { exact: true })
        .click();
      const detail = page.locator("details").filter({
        has: page.locator("summary", { hasText: "Private office facts" }),
      });
      await detail.getByLabel("Care ZIP", { exact: true }).fill("07928");
      await detail.getByLabel("Valid through (optional)").fill("2026-11-20");
      await detail
        .getByRole("button", { name: "Save private fact", exact: true })
        .click();
      await expect(detail.getByRole("alert")).toContainText("retained");
      await expect(detail.getByLabel("Care ZIP", { exact: true })).toHaveValue(
        "07928",
      );
      await detail.locator("summary").click();
      await detail.locator("summary").click();
      await detail
        .getByRole("button", { name: "Save private fact", exact: true })
        .click();
      await expect(detail.getByRole("status")).toContainText(
        "Private fact saved",
      );
      assert.deepEqual(posts[0], posts[1]);
      assert.equal(rows.length, 1);
      await detail
        .getByLabel(/^Office ZIP coverage/)
        .selectOption("does_not_serve");
      await detail
        .getByRole("button", { name: "Save private fact", exact: true })
        .click();
      await expect(
        detail.getByRole("heading", { name: /Conflicting reports/ }),
      ).toBeVisible();
      await expect(
        detail.getByText(/Serves this ZIP · checked 2026-11-18/),
      ).toBeVisible();
      await expect(
        detail.getByText(/Does not serve this ZIP · checked 2026-11-18/),
      ).toBeVisible();
      assert.equal(rows.length, 2);
      await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
      await detail
        .getByRole("button", { name: "Refresh private facts" })
        .click();
      await expect(
        detail.getByRole("heading", { name: /Expired — check again/ }),
      ).toBeVisible();
      assert.notEqual(
        (posts[2].fact as { id: string }).id,
        (posts[1].fact as { id: string }).id,
      );
      await detail.getByLabel("Care ZIP", { exact: true }).fill("07001");
      await expect(
        detail.getByText("No private responses recorded for this ZIP."),
      ).toBeVisible();
      activeOwner = "33333333-3333-4333-8333-333333333333";
      await detail
        .getByRole("button", { name: "Refresh private facts" })
        .click();
      await expect(detail.getByRole("alert")).toContainText(
        "signed-in account changed",
      );
      await expect(
        detail.getByRole("button", { name: "Save private fact", exact: true }),
      ).toBeDisabled();
    } finally {
      await browser.close();
    }
  },
);
