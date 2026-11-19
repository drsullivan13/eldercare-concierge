import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../scripts/lib/chromium.mjs";
import "../scripts/public-form/elderly-savior.test.mjs";
import "../scripts/public-form/wellcare.test.mjs";
import "../scripts/public-form/wix-receipt.test.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { findOpening, runJob } from "../scripts/public-form/worker.mjs";

async function workerHarness() {
  const bundle = await build({
    stdin: {
      contents: `
        export { runJob } from "./worker.mjs";
        export { openStore } from "./worker-store.mjs";
        export { sqlCalls, sqlResults } from "postgres";
      `,
      resolveDir: fileURLToPath(
        new URL("../scripts/public-form/", import.meta.url),
      ),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "offline-worker",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(?:postgres|playwright|\.\/(?:elderly-savior|wellcare)\.mjs)$/,
            },
            ({ path }) => ({ path, namespace: "offline" }),
          );
          b.onLoad({ filter: /.*/, namespace: "offline" }, ({ path }) => ({
            contents:
              path === "postgres"
                ? `
                  export const sqlCalls = [], sqlResults = [];
                  const sql = (parts, ...values) => {
                    sqlCalls.push({ text: parts.join("?"), values });
                    return Promise.resolve(sqlResults.shift() || []);
                  };
                  sql.array = (values) => values;
                  sql.begin = (callback) => callback(sql);
                  sql.end = async () => {};
                  export default () => sql;
                `
                : path === "playwright"
                  ? `export const chromium = { launch() {
                      throw new Error("No real browsers in the dispatch fixture");
                    } };`
                  : `
                    export const readSlots = (page, date) =>
                      page.readSlots(${JSON.stringify(path)}, date);
                    export const submitApproved = (page, ...args) =>
                      page.submitApproved(${JSON.stringify(path)}, ...args);
                  `,
          }));
        },
      },
    ],
  });
  return (await import(
    "data:text/javascript;base64," +
      Buffer.from(bundle.outputFiles[0].text).toString("base64")
  )) as Pick<
    typeof import("../scripts/public-form/worker-store.mjs"),
    "openStore"
  > & {
    runJob: (
      job: Record<string, unknown>,
      store: Record<string, unknown>,
      launch: () => Promise<unknown>,
      read?: () => Promise<string[]>,
      submit?: () => Promise<{ status: string }>,
    ) => Promise<string>;
    sqlCalls: { text: string; values: unknown[] }[];
    sqlResults: unknown[][];
  };
}

test("default worker dispatch uses only the approved office adapter and preserves its approval", async () => {
  const { runJob: dispatch } = await workerHarness();
  const start = new Date(Date.now() + 48 * 3600000).toISOString();
  for (const [providerId, adapter, meeting, consentVersion] of [
    [
      "north-jersey-hp-hp0265900",
      "./elderly-savior.mjs",
      "Google Meet",
      "elderly-savior-v1",
    ],
    [
      "north-jersey-hp-hp0054400",
      "./wellcare.mjs",
      "Available Online",
      "wellcare-v1",
    ],
  ]) {
    const job = {
      providerId,
      name: "Ada Marie Doe",
      email: "ada@example.test",
      phone: "+12025550101",
      consentVersion,
      windowStart: start,
      windowEnd: new Date(Date.parse(start) + 3600000).toISOString(),
    };
    let reads = 0,
      submits = 0,
      claims = 0,
      closed = false;
    const clicks: unknown[][] = [];
    const outcomes: unknown[][] = [];
    const page = {
      readSlots: async (actual: string) => {
        assert.equal(actual, adapter);
        reads++;
        return [start];
      },
      submitApproved: async (
        actual: string,
        selected: Record<string, unknown>,
        claim: () => Promise<boolean>,
        saveClick: (status: number) => Promise<void>,
      ) => {
        assert.equal(actual, adapter);
        assert.deepEqual(selected, {
          ...job,
          startTime: start,
          meeting,
          message: "Please send the consultation details to my email.",
        });
        submits++;
        assert.equal(await claim(), true);
        assert.equal(await claim(), false);
        await saveClick(202);
        return { status: "pending", receipt: "Agency confirmation pending." };
      },
    };
    const store = {
      markSubmitting: async (actual: unknown, instant: string) => {
        assert.equal(actual, job);
        assert.equal(instant, start);
        claims++;
        return true;
      },
      markClickObserved: async (...args: unknown[]) => {
        clicks.push(args);
      },
      finish: async (...args: unknown[]) => outcomes.push(args),
    };
    assert.equal(
      await dispatch(job, store, async () => ({
        newPage: async () => page,
        close: async () => {
          closed = true;
        },
      })),
      "pending",
    );
    assert.equal(reads, 1);
    assert.equal(submits, 1);
    assert.equal(claims, 1);
    assert.equal(closed, true);
    assert.deepEqual(clicks, [[job, 202]]);
    assert.deepEqual(outcomes, [
      [job, "pending", "Agency confirmation pending.", true],
    ]);
  }

  for (const providerId of [
    "unknown",
    "__proto__",
    "constructor",
    ["north-jersey-hp-hp0054400"],
    null,
    undefined,
  ]) {
    const job = { providerId };
    let launched = false;
    const outcomes: unknown[][] = [];
    const launch = async () => {
      launched = true;
      throw new Error("Unapproved browser launch");
    };
    const store = {
      finish: async (...args: unknown[]) => outcomes.push(args),
    };
    assert.equal(await dispatch(job, store, launch), "needs_human");
    if (providerId !== undefined)
      assert.equal(
        await dispatch(
          job,
          store,
          launch,
          async () => [],
          async () => ({
            status: "confirmed",
          }),
        ),
        "needs_human",
      );
    assert.equal(launched, false);
    assert.ok(
      outcomes.every(
        (args) =>
          args[0] === job &&
          args[1] === "needs_human" &&
          args[2] === undefined &&
          args[3] === false,
      ),
    );
  }
});

test("store claims and recovers both offices and records only the office's click action", async () => {
  const { openStore, sqlCalls, sqlResults } = await workerHarness();
  const store = openStore("offline-test-only");
  const job = {
    id: "job",
    lease: "lease",
    providerId: "north-jersey-hp-hp0054400",
  };
  sqlResults.push([], [job]);
  assert.equal(await store.claim(), job);
  assert.equal(sqlCalls.length, 2);
  for (const call of sqlCalls) {
    assert.match(call.text, /provider_id = any\(\?::text\[\]\)/);
    assert.deepEqual(call.values.find(Array.isArray), [
      "north-jersey-hp-hp0265900",
      "north-jersey-hp-hp0054400",
    ]);
  }
  assert.match(
    sqlCalls[0].text,
    /case when status = 'submitting' then 'unknown' else 'failed' end/,
  );
  assert.match(sqlCalls[0].text, /worker_lease = null/);
  assert.match(sqlCalls[0].text, /interval '15 minutes'/);
  assert.match(
    sqlCalls[0].text,
    /status = 'queued_booking' and window_end <= now\(\)/,
  );
  assert.match(sqlCalls[1].text, /provider_id as "providerId"/);
  assert.match(sqlCalls[1].text, /for update skip locked/);

  await store.markClickObserved(job, 202);
  assert.equal(
    sqlCalls[2].values[0],
    "The browser observed a click on Book Now. The agency form returned HTTP 202.",
  );
  await store.markClickObserved(
    { ...job, providerId: "north-jersey-hp-hp0265900" },
    undefined,
  );
  assert.equal(
    sqlCalls[3].values[0],
    "The browser observed a click on Schedule meeting.",
  );
  await assert.rejects(
    store.markClickObserved({ ...job, providerId: "__proto__" }, 200),
    /Unsupported booking provider/,
  );
  assert.equal(sqlCalls.length, 4);
  await store.close();
});

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
