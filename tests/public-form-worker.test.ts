import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../scripts/lib/chromium.mjs";
import "../scripts/public-form/elderly-savior.test.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { findOpening, runJob } from "../scripts/public-form/worker.mjs";

test("an approval covers only complete meetings, including across the Eastern DST boundary", async () => {
  const job = {
    windowStart: "2027-03-14T04:50:00Z",
    windowEnd: "2027-03-14T13:30:00Z",
  };
  const days: string[] = [];
  const read = async (_page: unknown, date: string) => {
    days.push(date);
    return date === "2027-03-13"
      ? []
      : ["2027-03-14T13:15:00Z", "2027-03-14T13:00:00Z"];
  };
  assert.equal(
    await findOpening({}, job, read, () => Date.parse("2027-03-01")),
    "2027-03-14T13:00:00.000Z",
  );
  assert.deepEqual(days, ["2027-03-13", "2027-03-14"]);
  assert.equal(
    await findOpening(
      {},
      { ...job, windowEnd: "2027-03-14T13:29:59Z" },
      read,
      () => Date.parse("2027-03-01"),
    ),
    null,
  );
});
test("lost provider response is unknown after the single durable click claim", async () => {
  const start = new Date(Date.now() + 48 * 3600000).toISOString();
  const job = {
    windowStart: start,
    windowEnd: new Date(Date.parse(start) + 3600000).toISOString(),
  };
  let claims = 0,
    closed = false;
  const outcomes: unknown[][] = [];
  const store = {
    markSubmitting: async () => {
      claims++;
      return true;
    },
    finish: async (...args: unknown[]) => outcomes.push(args),
  };
  const launch = async () => {
    const browser = await chromium.launch(chromiumLaunchOptions);
    browser.on("disconnected", () => {
      closed = true;
    });
    return browser;
  };
  await runJob(
    job,
    store,
    launch,
    async () => [start],
    async (
      _page: unknown,
      _selected: unknown,
      claim: () => Promise<boolean>,
    ) => {
      assert.equal(await claim(), true);
      assert.equal(await claim(), false);
      throw new Error("Office connection closed");
    },
  );
  assert.equal(claims, 1);
  assert.deepEqual(outcomes, [[job, "unknown", undefined, true]]);
  assert.equal(closed, true);
});
