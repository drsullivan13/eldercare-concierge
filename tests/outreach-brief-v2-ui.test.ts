import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import {
  launchWorkspaceBrowser,
  openWorkspacePage,
} from "./helpers/workspace-browser";

test(
  "family editor preserves legacy launch and submits explicitly entered v2 context",
  { timeout: 60000 },
  async () => {
    const bundled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client'; import {OutreachEditor} from './src/components/dashboard/outreach'; createRoot(document.getElementById('root')).render(<OutreachEditor provider={{providerId:'north-jersey-hp-hp0000216',providerName:'Practice office',phone:''}} homeCare accountRequestId={()=>'11111111-1111-4111-8111-111111111111'} launch={()=>{throw Error('legacy launch')}} error="" close={()=>{}}/>);`,
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
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const posts: Array<{ brief: Record<string, unknown> }> = [];
      await page.route("**/api/outreach-requests", async (route) => {
        posts.push(route.request().postDataJSON());
        await route.fulfill({
          status: 503,
          json: { error: "Retain the draft" },
        });
      });
      await openWorkspacePage(page, {});
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      await page.getByRole("button", { name: "Open rehearsal" }).click();
      await expect(page.getByRole("alert")).toContainText("Please retry");
      assert.equal(posts.length, 1);
      assert.equal("briefVersion" in posts[0].brief, false);
      posts.length = 0;
      await page
        .getByText("More context for this rehearsal (optional)")
        .click();
      await page.getByLabel("Practice family").selectOption("home-care-priya");
      await page
        .getByLabel("Known answers (optional)", { exact: true })
        .fill("Mock weekend coverage discussed");
      await page
        .getByLabel("Other outstanding questions (optional)", { exact: true })
        .fill("Who arranges backup?");
      await page
        .getByLabel("Your question or another goal")
        .fill("Can short visits begin next week?");
      await page.getByRole("button", { name: "Open rehearsal" }).click();
      await expect(page.getByRole("alert")).toContainText("Please retry");
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].brief, {
        briefVersion: 2,
        knownAnswers: ["Mock weekend coverage discussed"],
        outstandingQuestions: ["Who arranges backup?"],
        scenarioId: "home-care-priya",
        topics: [],
        timing: "Next week",
        situation:
          "My father is 79 and lives alone in Edison. After missed medications and a minor car accident, I’m looking from Chicago for 8–15 hours of light help each week and rides.",
        question: "Can short visits begin next week?",
      });
      await expect(
        page.getByRole("textbox", {
          name: "Known answers (optional)",
          exact: true,
        }),
      ).toHaveValue("Mock weekend coverage discussed");
      await page.getByLabel("Practice family").selectOption("home-care-rob");
      await expect(
        page.getByRole("textbox", {
          name: "Known answers (optional)",
          exact: true,
        }),
      ).toHaveValue("");
      await expect(
        page.getByRole("textbox", {
          name: "Other outstanding questions (optional)",
          exact: true,
        }),
      ).toHaveValue("");
      await expect(
        page.getByLabel("Your question or another goal"),
      ).toHaveCount(1);
    } finally {
      await browser.close();
    }
  },
);
