import { observeWixReceipt } from "./wix-receipt.mjs";
import { randomUUID } from "node:crypto";

const origin = "https://www.wellcarenurses.com";
const bookingUrl = origin + "/booking-calendar/free-assessment";
const consentVersion = "wellcare-v1";
const terms =
  "By completing your booking, you agree to receive related phone notifications.";
const timezone = "America/New_York";
const messageLabel =
  "Could you kindly share what you hope to achieve in this meeting?";
const noAvailability =
  /^(?:No availability|No available time slots|No sessions available)[.!]?$/i;
const active = new WeakSet();
const attempted = new WeakSet();
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const format = (date, options) =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }).format(
    date,
  );
const dateOf = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const dateLabel = (date) =>
  format(date, { month: "long", day: "numeric", year: "numeric" });
const timeLabel = (date) =>
  format(date, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();

function trustedUrl(value, path) {
  try {
    const url = new URL(value);
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      (!path || url.pathname.replace(/\/$/, "") === path)
    );
  } catch {
    return false;
  }
}

function verifyPage(page, path) {
  if (!trustedUrl(page.url(), path))
    throw new Error("Unexpected provider page");
}

function result(status, observed = false) {
  // These strings are persisted. Never forward page text, URLs or exception messages.
  const receipts = {
    confirmed: "Wellcare confirmed the approved online Free Assessment.",
    pending: "Wellcare reported an assessment request pending confirmation.",
    unknown: "The Wellcare booking outcome could not be verified.",
    needs_human:
      "Harbor stopped before attempting the final Wellcare booking click.",
    unavailable: "The approved Wellcare appointment is unavailable.",
  };
  return {
    status,
    receipt:
      (status === "unknown"
        ? observed
          ? "The browser observed a click on Book Now. "
          : "Harbor could not verify a click on Book Now. "
        : "") + receipts[status],
  };
}

function instant(date, label) {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(normalize(label));
  if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59)
    throw new Error("Unrecognized time");
  const hours = (+match[1] % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  const local = `${date}T${String(hours).padStart(2, "0")}:${match[2]}:00`;
  const candidates = [4, 5]
    .map((offset) => new Date(Date.parse(local + "Z") + offset * 3_600_000))
    .filter(
      (value) =>
        dateOf(value) === date &&
        timeLabel(value) ===
          `${+match[1]}:${match[2]} ${match[3].toLowerCase()}`,
    );
  if (candidates.length !== 1) throw new Error("Ambiguous calendar time");
  return { iso: candidates[0].toISOString(), local };
}

function matchingDetails(text, start, receipt = false) {
  text = normalize(text);
  const dates = text.match(/\b[A-Z][a-z]+ \d{1,2}, \d{4}\b/g) || [];
  const times = [
    ...text.matchAll(/(?<![\w:])\d{1,2}:\d{2}\s*[ap]m(?![\w:])/gi),
  ].map(([value]) => normalize(value).toLowerCase().replace(/^0/, ""));
  const durations =
    text.match(/\b\d+\s*(?:min(?:utes)?|hours?|hrs?)\b/gi) || [];
  const zones = text.match(/\b(?:[ECMP][DS]T|UTC|GMT)\b/g) || [];
  const expectedZone = format(start, { timeZoneName: "short" })
    .split(" ")
    .at(-1);
  return (
    /\bFree Assessment\b/.test(text) &&
    (/\bAvailable Online\b/i.test(text) ||
      (receipt && !/\bin[ -]person\b/i.test(text))) &&
    dates.length > 0 &&
    dates.every((date) => date === dateLabel(start)) &&
    times.length > 0 &&
    times.every((time) => time === timeLabel(start)) &&
    (receipt || durations.length > 0) &&
    durations.every((duration) => /^30\s*min(?:utes)?$/i.test(duration)) &&
    zones.every((zone) => zone === expectedZone)
  );
}

function publicReference(text) {
  // Legacy UUIDs are opaque. Other identifiers must be explicitly labelled public,
  // bounded and code-shaped, never an arbitrary name, phone, email or URL.
  const uuid =
    /\b(?:Booking|Appointment) reference:\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\s|[.!]?(?:\s|$)|$)/i.exec(
      text,
    )?.[1];
  if (uuid) return uuid;
  const token = /\bPublic (?:booking|appointment) reference:\s*(\S+)/i
    .exec(text)?.[1]
    ?.replace(/[.!]$/, "");
  return token &&
    /^(?=.{8,64}$)(?=.*[A-Z])(?=.*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(token)
    ? token
    : undefined;
}

async function openDay(page, date) {
  const noon = new Date(date + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(+noon) ||
    dateOf(noon) !== date
  )
    throw new Error("Invalid calendar date");
  page.setDefaultTimeout(8000);
  await page.goto(bookingUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  verifyPage(page, "/booking-calendar/free-assessment");
  const main = page.getByRole("main");
  await main
    .getByRole("heading", { name: "Select a date and time", exact: true })
    .waitFor();
  const month = format(noon, { month: "long", year: "numeric" });
  const calendar = main
    .getByRole("grid", { name: month, exact: true })
    .or(main.getByRole("table", { name: month, exact: true }));
  for (let step = 0; !(await calendar.isVisible()) && step < 2; step++) {
    verifyPage(page, "/booking-calendar/free-assessment");
    const next = main.getByRole("button", { name: "next month", exact: true });
    if (!(await next.isEnabled())) return [];
    const previous = await main
      .locator('[role="grid"],table')
      .getAttribute("aria-label");
    await next.click();
    if (previous)
      await main
        .getByRole("grid", { name: previous, exact: true })
        .or(main.getByRole("table", { name: previous, exact: true }))
        .waitFor({ state: "hidden" });
  }
  if (!(await calendar.isVisible())) return [];
  const day = +date.slice(-2);
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
  const label =
    format(noon, { weekday: "long" }) +
    ", " +
    format(noon, { month: "long" }) +
    ` ${day}${suffix}, ${noon.getUTCFullYear()}`;
  const button = calendar.getByRole("button", { name: label, exact: true });
  if (!(await button.isVisible()) || !(await button.isEnabled())) return [];
  await button.click();
  const group = main.getByRole("group", {
    name:
      "Availability for " +
      format(noon, { weekday: "long", month: "long", day: "numeric" }),
    exact: true,
  });
  await group.waitFor();
  const more = main.getByRole("button", { name: "More details", exact: true });
  if (
    (await more.isVisible()) &&
    (await more.getAttribute("aria-expanded")) !== "true"
  )
    await more.click();
  await group
    .getByRole("radio")
    .first()
    .or(group.getByText(noAvailability, { exact: true }))
    .waitFor();
  if (await group.getByText(noAvailability, { exact: true }).isVisible()) {
    verifyPage(page, "/booking-calendar/free-assessment");
    return [];
  }
  const details = main.locator('[data-hook="booking-details-wrapper"]');
  await details.waitFor();
  await page.waitForFunction(
    ({ element, date }) => {
      const text = element.innerText;
      return (
        text.includes(date) &&
        /\d{1,2}:\d{2}\s*[ap]m/i.test(text) &&
        /\b\d+\s*(?:min(?:utes)?|hours?|hrs?)\b/i.test(text)
      );
    },
    { element: await details.elementHandle(), date: dateLabel(noon) },
    { timeout: 8000 },
  );
  const zone =
    /(?:Time zone: )?Eastern (Standard|Daylight) Time \((EST|EDT)\)/.exec(
      normalize(await main.innerText()),
    );
  const expected = format(noon, { timeZoneName: "short" }).split(" ").at(-1);
  if (
    !zone ||
    zone[2] !== expected ||
    (zone[1] === "Standard" ? "EST" : "EDT") !== expected
  )
    throw new Error("Unverified calendar timezone");
  const showAll = group.getByRole("button", {
    name: "Show all sessions",
    exact: true,
  });
  if (await showAll.isVisible()) await showAll.click();
  const radios = group.getByRole("radio");
  const slots = [];
  for (const radio of await radios.all()) {
    if (!(await radio.isVisible()) || !(await radio.isEnabled())) continue;
    const label = await radio.getAttribute("aria-label");
    const slot = instant(date, label || "");
    if ((await radio.getAttribute("id")) !== slot.local)
      throw new Error("Mismatched calendar slot");
    slots.push({ ...slot, label });
  }
  const summary = normalize(await details.innerText());
  if (
    !/\bFree Assessment\b/.test(summary) ||
    !/\bAvailable Online\b/i.test(summary) ||
    !/\b30 min\b/.test(summary) ||
    (slots.length &&
      !slots.some((slot) => matchingDetails(summary, new Date(slot.iso))))
  )
    throw new Error("Unverified calendar service");
  verifyPage(page, "/booking-calendar/free-assessment");
  return slots;
}

export async function readSlots(page, date) {
  return (await openDay(page, date)).map((slot) => slot.iso);
}

async function review(page, job, start, filled = false) {
  verifyPage(page, "/booking-form");
  const main = page.getByRole("main");
  const more = main.getByRole("button", { name: "More details", exact: true });
  if (
    (await more.isVisible()) &&
    (await more.getAttribute("aria-expanded")) !== "true"
  )
    await more.click();
  const text = await main.innerText();
  if (
    !(await main
      .getByRole("heading", { name: "Client Details", exact: true })
      .isVisible()) ||
    !(await main.getByText("Free Assessment", { exact: true }).isVisible()) ||
    !(await main.getByText(/^Available Online$/i).isVisible()) ||
    !matchingDetails(text, start)
  )
    throw new Error("Unverified booking details");
  const disclosure = main.locator('[data-hook="sms-notification"]');
  if (
    (await disclosure.count()) !== 1 ||
    !(await disclosure.isVisible()) ||
    !(await disclosure.evaluate((element, expected) => {
      if (element.innerText.replace(/\s+/g, " ").trim() !== expected)
        return false;
      // Inspect the complete provider booking/consent area, including sibling paragraphs.
      // Only the known details panel and action buttons are outside the consent contract.
      const parent = element.parentElement;
      const title = parent.querySelector(
        '[data-hook="booking-details-section-title"]',
      );
      if (!title) return false;
      let details = title;
      while (details.parentElement !== parent) details = details.parentElement;
      const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
      const parts = [];
      for (let node; (node = walker.nextNode());) {
        const owner = node.parentElement;
        if (details.contains(owner) || owner.closest("button")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (
          owner.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          range.getClientRects().length
        )
          parts.push(node.textContent);
      }
      return parts.join(" ").replace(/\s+/g, " ").trim() === expected;
    }, terms)) ||
    /captcha|verify (?:you are|that you are) human/i.test(
      await main.innerText(),
    ) ||
    (await main.locator("iframe:visible").count()) ||
    (await main.getByRole("checkbox").count()) ||
    (await main.getByRole("combobox").count())
  )
    throw new Error("Unverified booking terms");
  const fields = [
    [main.getByRole("textbox", { name: /^name\s*\*?$/i }), job.name],
    [main.getByRole("textbox", { name: /^email\s*\*?$/i }), job.email],
    [
      main.getByRole("textbox", { name: "Phone Number. Phone", exact: true }),
      job.phone.replace(/^\+1/, ""),
    ],
    [main.getByRole("textbox", { name: messageLabel, exact: true }), ""],
  ];
  if ((await main.locator("input:visible,textarea:visible").count()) !== 4)
    throw new Error("Unexpected booking fields");
  const message = fields[3][0];
  if (
    (await message.getAttribute("data-hook")) !== "text-area" ||
    (await message.evaluate(
      (field) =>
        field.tagName !== "TEXTAREA" ||
        field.required ||
        field.getAttribute("aria-required") === "true",
    ))
  )
    throw new Error("Unexpected message field");
  for (const [field, value] of fields) {
    if ((await field.count()) !== 1 || !(await field.isEditable()))
      throw new Error("Unverified booking field");
    const observed = await field.inputValue();
    if (
      filled &&
      ((await field.getAttribute("type")) === "tel"
        ? observed.replace(/\D/g, "")
        : observed) !== value
    )
      throw new Error("Changed contact details");
  }
  return { main, fields, text };
}

async function observeClick(page, submit, reviewed, job, onObservedClick) {
  const marker = randomUUID();
  const expected = {
    marker,
    url: page.url(),
    text: reviewed.text,
    values: [
      ["Name", job.name],
      ["Email", job.email],
      ["Phone Number. Phone", job.phone.replace(/^\+1/, "")],
      [messageLabel, ""],
    ],
  };
  let saved;
  const observe = (message) => {
    if (message.type() === "debug" && message.text() === marker && !saved)
      saved = Promise.resolve()
        .then(() => onObservedClick())
        .catch(() => {});
  };
  page.on("console", observe);
  try {
    await submit.evaluate((button, expected) => {
      const root = button.closest("main,[role=main]");
      const fields = expected.values.map(([label]) =>
        [...root.querySelectorAll("input,textarea")].filter(
          (field) => field.getAttribute("aria-label") === label,
        ),
      );
      let consumed = false;
      // Synchronous capture closes the last check-to-click gap. Also block a second click.
      const guard = (event) => {
        if (!event.composedPath().includes(button)) return;
        if (
          consumed ||
          !event.isTrusted ||
          location.href !== expected.url ||
          !button.isConnected ||
          root.innerText !== expected.text ||
          root.querySelectorAll("input,textarea").length !==
            expected.values.length ||
          fields.some(
            (matches, index) =>
              matches.length !== 1 ||
              !matches[0].isConnected ||
              (matches[0].type === "tel"
                ? matches[0].value.replace(/\D/g, "")
                : matches[0].value) !== expected.values[index][1],
          )
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        consumed = true;
        console.debug(expected.marker);
      };
      window[expected.marker] = guard;
      window.addEventListener("click", guard, true);
    }, expected);
  } catch (error) {
    page.off("console", observe);
    throw error;
  }
  return {
    get observed() {
      return Boolean(saved);
    },
    async close() {
      page.off("console", observe);
      await page
        .evaluate((marker) => {
          window.removeEventListener("click", window[marker], true);
          delete window[marker];
        }, marker)
        .catch(() => {});
      await saved;
    },
  };
}

async function observeReceipt(page, start, network) {
  const deadline = Date.now() + 15_000;
  for (let sample = 0; sample <= 60; sample++) {
    if (!trustedUrl(page.url())) return result("unknown");
    try {
      const snapshot = await page.evaluate(() => {
        const main = document.querySelector("main,[role=main]");
        if (!main) return { url: location.href, regions: [] };
        const boundaries =
          "main,[role=main],section,article,[role=dialog],[role=status],[role=alert]";
        const regions = new Set([main, ...main.querySelectorAll(boundaries)]);
        for (const heading of main.querySelectorAll(
          "h1,h2,h3,h4,[role=heading]",
        )) {
          if (heading.parentElement !== document.body)
            regions.add(heading.parentElement);
        }
        const visibleText = (element, owned = false) => {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          const parts = [];
          for (let node; (node = walker.nextNode());) {
            let visible = true;
            for (let p = node.parentElement; p; p = p.parentElement) {
              const style = getComputedStyle(p);
              if (
                p.matches(
                  "footer,nav,aside,script,style,template,[hidden],[aria-hidden=true],[inert]",
                ) ||
                style.display === "none" ||
                style.visibility !== "visible" ||
                Number(style.opacity) === 0 ||
                style.contentVisibility === "hidden" ||
                style.clip !== "auto" ||
                style.clipPath !== "none" ||
                (owned &&
                  p !== element &&
                  element.contains(p) &&
                  regions.has(p) &&
                  !p.matches("[role=status],[role=alert]"))
              ) {
                visible = false;
                break;
              }
            }
            const range = document.createRange();
            range.selectNodeContents(node);
            if (visible && range.getClientRects().length)
              parts.push(node.textContent);
          }
          return parts.join(" ").replace(/\s+/g, " ").trim();
        };
        return {
          url: location.href,
          invalid: [
            ...main.querySelectorAll("[aria-invalid=true],:user-invalid"),
          ].some((field) =>
            field.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            }),
          ),
          regions: [...regions].map((region) => ({
            text: visibleText(region, true),
            headings: [...region.querySelectorAll("h1,h2,h3,h4,[role=heading]")]
              .filter(
                (heading) =>
                  regions.has(heading.parentElement) &&
                  heading.parentElement === region,
              )
              .map((heading) => visibleText(heading)),
          })),
        };
      });
      if (!trustedUrl(snapshot.url) || !trustedUrl(page.url()))
        return result("unknown");
      if (snapshot.url !== page.url()) continue;
      let confirmed = false;
      let pending = false;
      let reference;
      let rejected = Boolean(snapshot.invalid);
      for (const region of snapshot.regions) {
        rejected ||=
          /\b(?:not confirmed|(?:booking|appointment|assessment|request) (?:was |is |has been )?(?:failed|rejected|declined|cancelled|canceled)|(?:cannot|could not|unable to|failed to) (?:confirm|book|schedule)|(?:slot|time).{0,30}(?:unavailable|no longer available)|something went wrong)\b/i.test(
            region.text,
          );
        pending ||=
          /\b(?:pending confirmation|awaiting confirmation|request (?:was |has been )?received|(?:booking|appointment|assessment) (?:is )?pending|we will contact you to confirm)\b/i.test(
            region.text,
          );
        if (
          region.headings.some((heading) =>
            /^(?:(?:your )?(?:booking|appointment|assessment) (?:is |has been )?confirmed|thanks for booking|you[’']re booked)[!.]?$/i.test(
              heading,
            ),
          ) &&
          matchingDetails(region.text, start, true)
        ) {
          confirmed = true;
          reference = publicReference(region.text);
        }
      }
      if (rejected) return result("unknown");
      if (pending)
        return network.evidence?.status === "pending"
          ? network.evidence
          : result("pending");
      if (network.evidence?.status === "confirmed") return network.evidence;
      if (confirmed) {
        const receipt = result("confirmed");
        if (reference)
          receipt.receipt += ` Appointment reference: ${reference}.`;
        return receipt;
      }
    } catch {
      // Navigation may replace the execution context. Observe again, never submit again.
    }
    if (sample === 60 || Date.now() >= deadline) break;
    await page.waitForTimeout(
      Math.max(0, Math.min(250, deadline - Date.now())),
    );
  }
  return network.evidence || result("unknown");
}

export async function submitApproved(
  page,
  job,
  beforeClick,
  onObservedClick = () => {},
) {
  if (
    job?.consentVersion !== consentVersion ||
    job.meeting !== "Available Online" ||
    !["name", "email", "phone"].every(
      (key) => typeof job[key] === "string" && job[key].trim(),
    ) ||
    typeof beforeClick !== "function" ||
    typeof onObservedClick !== "function" ||
    active.has(page) ||
    attempted.has(page)
  )
    return result("needs_human");
  active.add(page);
  let claimed = false;
  let click;
  let network;
  try {
    const start = new Date(job.startTime);
    if (
      !Number.isFinite(+start) ||
      +start <= Date.now() ||
      start.getUTCSeconds() ||
      start.getUTCMilliseconds()
    )
      return result("unavailable");
    const slots = await openDay(page, dateOf(start));
    const slot = slots.find((value) => value.iso === start.toISOString());
    if (!slot) return result("unavailable");
    const main = page.getByRole("main");
    const radio = main.getByRole("radio", { name: slot.label, exact: true });
    await radio.press("Space");
    await main
      .getByRole("radio", { name: slot.label, exact: true, checked: true })
      .waitFor();
    const details = main.locator('[data-hook="booking-details-wrapper"]');
    if (!matchingDetails(await details.innerText(), start))
      return result("needs_human");
    verifyPage(page, "/booking-calendar/free-assessment");
    await main.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByRole("heading", { name: "Client Details", exact: true })
      .waitFor();
    const { fields } = await review(page, job, start);
    for (const [field, value] of fields) {
      await review(page, job, start);
      verifyPage(page, "/booking-form");
      await field.fill(value);
      await field.blur();
    }
    await review(page, job, start, true);
    const submit = page
      .getByRole("main")
      .getByRole("button", { name: "Book Now", exact: true });
    await submit.click({ trial: true });
    if ((await beforeClick()) !== true) return result("needs_human");
    claimed = true;
    attempted.add(page);
    const reviewed = await review(page, job, start, true);
    network = observeWixReceipt(page, start);
    click = await observeClick(page, submit, reviewed, job, onObservedClick);
    try {
      await submit.click({ timeout: 3000 });
    } catch {
      // A timeout may follow a delivered click. The final click is never retried.
    }
    const receipt = await observeReceipt(page, start, network);
    if (!click.observed) return result("unknown");
    return receipt.status === "unknown" ? result("unknown", true) : receipt;
  } catch {
    return result(claimed ? "unknown" : "needs_human", click?.observed);
  } finally {
    network?.close();
    await click?.close();
    active.delete(page);
  }
}
