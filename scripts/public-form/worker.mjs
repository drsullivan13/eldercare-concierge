import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { readSlots, submitApproved } from "./elderly-savior.mjs";

const halfHour = 30 * 60_000;
const easternDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export async function findOpening(page, job, read = readSlots, now = Date.now) {
  const first = Math.max(+new Date(job.windowStart), now());
  const last = +new Date(job.windowEnd) - halfHour;
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last < first ||
    last - first > 7 * 86400000
  )
    return null;
  const endDate = easternDate.format(last);
  for (let date = easternDate.format(first); date <= endDate;) {
    const eligible = (await read(page, date))
      .map(Date.parse)
      .filter((t) => t >= first && t > now() && t <= last);
    if (eligible.length) return new Date(Math.min(...eligible)).toISOString();
    // Increment the calendar label in UTC, independent of Eastern DST changes.
    date = new Date(Date.parse(date + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  }
  return null;
}

export async function runJob(
  job,
  store,
  launch = () => chromium.launch(),
  read = readSlots,
  submit = submitApproved,
) {
  let browser;
  let claimed = false;
  let result;
  try {
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 780 },
      isMobile: true,
      hasTouch: true,
      timezoneId: "America/New_York",
      acceptDownloads: false,
    });
    const startTime = await findOpening(page, job, read);
    if (!startTime) result = { status: "unavailable" };
    else
      result = await submit(
        page,
        {
          ...job,
          startTime,
          meeting: "Google Meet",
          message: "Please send the consultation details to my email.",
        },
        async () => {
          if (claimed) return false;
          claimed = await store.markSubmitting(job, startTime);
          return claimed;
        },
        () => store.markClickObserved(job),
      );
  } catch {
    result = { status: claimed ? "unknown" : "needs_human" };
  } finally {
    await browser?.close().catch(() => {});
  }
  if (claimed && !["confirmed", "pending", "unknown"].includes(result.status))
    result = { status: "unknown" };
  if (
    !claimed &&
    !["unavailable", "failed", "needs_human"].includes(result.status)
  )
    result = { status: "failed" };
  await store.finish(job, result.status, result.receipt, claimed);
  return result.status;
}

async function main() {
  const { openStore } = await import("./worker-store.mjs");
  const store = openStore(process.env.HARBOR_WORKER_DATABASE_URL);
  const once = process.argv.includes("--once");
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      stopping = true;
    });
  try {
    do {
      const job = await store.claim();
      if (job) console.info("Booking job completed:", await runJob(job, store));
      if (!job && !once && !stopping) await delay(15000);
    } while (!once && !stopping);
  } finally {
    await store.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "Booking worker stopped. Check database connectivity and worker permissions.",
    );
    process.exitCode = 1;
  });
}
