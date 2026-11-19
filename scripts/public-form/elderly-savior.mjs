import { randomUUID } from "node:crypto";
// This adapter drives the same public, mobile calendar a family uses. It has no agency API credentials.
const bookingUrl = "https://elderlysaviorhc.com/book-now";
const widget = "#calendarAppointmentBookingMain";
const timezone = "America/New_York";
const consentVersion = "elderly-savior-v1";
const contactTerms =
  "By submitting this form, I agree to be contacted by Elderly Savior Homecare LLC by phone call, text message, or email regarding home care services, appointments, referrals, and related marketing communications. I understand that calls or messages may be automated, pre-recorded, or use an AI voice assistant. Message and data rates may apply. I understand that consent is not required to purchase services. I may opt out at any time by replying STOP to text messages, requesting not to be called, or contacting Elderly Savior Homecare directly at (973) 855-4461.";
const optionalTerms =
  "By checking this box, I consent to receive marketing and promotional text messages from Elderly Savior Homecare LLC about special offers, discounts, program updates among others. Frequency may vary. Message & data rates may apply. Text HELP for assistance, reply STOP to opt out.";
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: timezone,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const dayLabel = (instant, month, weekday) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month,
    day: "numeric",
    year: "numeric",
    weekday,
  }).format(instant);
const normalize = (value) =>
  value.replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();

function verifiedPage(page) {
  const url = new URL(page.url());
  if (
    url.origin !== new URL(bookingUrl).origin ||
    url.pathname.replace(/\/$/, "") !== "/book-now"
  )
    throw new Error("Unexpected booking page");
}

function trustedReceiptUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === new URL(bookingUrl).origin &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function receiptResult(status) {
  // The worker stores and forwards this string. Never include page text, URLs or errors.
  const messages = {
    confirmed:
      "Office calendar confirmed the approved Google Meet consultation.",
    pending: "Office calendar reported a request pending confirmation.",
    unknown: "Office calendar confirmation could not be verified.",
  };
  return { status, receipt: messages[status] };
}

async function observeReceipt(page, start) {
  const dates = [
    dayLabel(start, "short", "short"),
    dayLabel(start, "long"),
    dayLabel(start, "short"),
  ];
  const time = timeFormat.format(start);
  const deadline = Date.now() + 15_000;
  // Poll across document replacement, not a stale locator or a disappearing submit button.
  // Both the deadline and sample count bound observation; submission is never retried.
  for (let sample = 0; sample <= 60; sample++) {
    if (!trustedReceiptUrl(page.url())) return receiptResult("unknown");
    try {
      const snapshot = await page.evaluate((widget) => {
        const root = document.querySelector(widget);
        const scope = root || document.body;
        if (!scope) return { url: location.href, regions: [] };
        const boundaries =
          "main, [role=main], section, article, [role=dialog], [role=status], [role=alert]";
        const regions = new Set(scope.querySelectorAll(boundaries));
        if (root) regions.add(root);
        // A plain div wrapping a receipt heading is also a region, never the whole body.
        const headings = scope.querySelectorAll(
          "h1,h2,h3,h4,h5,h6,[role=heading]",
        );
        for (const heading of headings) {
          const parent = heading.parentElement;
          if (parent !== document.body && parent !== document.documentElement)
            regions.add(
              parent.matches("header") ? parent.closest(boundaries) : parent,
            );
        }
        regions.delete(null);
        const excluded =
          "footer,nav,aside,[role=contentinfo],[role=navigation],script,style,template,noscript,[hidden],[aria-hidden=true],[inert]";
        const rendered = {
          text(element, owned = false) {
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
            );
            const parts = [];
            for (let node; (node = walker.nextNode());) {
              if (!node.textContent.trim()) continue;
              let visible = true;
              for (let p = node.parentElement; p; p = p.parentElement) {
                const style = getComputedStyle(p);
                if (
                  p.matches(excluded) ||
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
          },
        };
        return {
          url: location.href,
          invalid:
            root &&
            [
              ...root.querySelectorAll("[aria-invalid=true], :user-invalid"),
            ].some((field) =>
              field.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
              }),
            ),
          regions: [...regions].map((region) => {
            const text = rendered.text(region, true);
            const confirmed = [
              ...region.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]"),
            ].some((heading) => {
              let owner = heading.parentElement;
              while (owner && !regions.has(owner)) owner = owner.parentElement;
              return (
                owner === region &&
                /^(?:your )?(?:appointment|meeting|booking|consultation) (?:is |has been )?confirmed[!.]?$/i.test(
                  rendered.text(heading),
                )
              );
            });
            return { text, confirmed, widget: !!root };
          }),
        };
      }, widget);
      if (!trustedReceiptUrl(snapshot.url) || !trustedReceiptUrl(page.url()))
        return receiptResult("unknown");
      if (snapshot.url !== page.url()) continue;
      let confirmed = false;
      let pending = false;
      let rejected = Boolean(snapshot.invalid);
      for (const region of snapshot.regions) {
        const text = normalize(region.text);
        if (
          !region.widget &&
          !region.confirmed &&
          !/\b(?:appointment|meeting|booking|consultation)\b/i.test(text)
        )
          continue;
        rejected ||=
          /\b(?:not confirmed|(?:booking|appointment|meeting|consultation|scheduling) (?:failed|rejected|cancelled|canceled)|(?:unable|failed|could not|cannot) to (?:book|schedule|confirm)|(?:slot|time).{0,30}(?:unavailable|no longer available)|something went wrong)\b/i.test(
            text,
          );
        pending ||=
          /\b(?:(?:will|need to|needs to|must).{0,50}confirm|pending confirmation|awaiting confirmation|request (?:was |has been )?received|(?:appointment|meeting|booking|consultation) (?:is )?pending)\b/i.test(
            text,
          );
        const times = [
          ...text.matchAll(/(?<![\w:])\d{1,2}:\d{2}\s*[AP]M(?![\w:])/gi),
        ].map(([value]) => value.toUpperCase().padStart(8, "0"));
        // Never accept the requested start when it appears only as the end of another appointment.
        const hasTime =
          times[0] === time &&
          (times.length === 1 ||
            (times.length === 2 &&
              times[1] === timeFormat.format(new Date(+start + 30 * 60_000))));
        confirmed ||=
          region.confirmed &&
          dates.some((date) =>
            new RegExp(`(?:^|[^\\w])${date}(?=$|[^\\w])`).test(text),
          ) &&
          hasTime &&
          /(?:^|[^\w/])America\/New_York(?=$|[^\w/])/.test(text) &&
          /\bGoogle Meet\b/.test(text);
      }
      // Negative or provisional evidence always outranks a simultaneous success heading.
      if (rejected)
        return {
          status: "unknown",
          receipt: "The agency form reported a booking or validation error.",
        };
      if (pending) return receiptResult("pending");
      if (confirmed) return receiptResult("confirmed");
    } catch {
      // Navigation can destroy the execution context between samples.
    }
    if (sample === 60 || Date.now() >= deadline) break;
    await page.waitForTimeout(
      Math.max(0, Math.min(250, deadline - Date.now())),
    );
  }
  return receiptResult("unknown");
}

function slotInstant(date, label) {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(label);
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] > 59)
    throw new Error("Unexpected time on calendar");
  const hour = (+m[1] % 12) + (m[3] === "PM" ? 12 : 0);
  const utc = Date.parse(date + "T00:00:00Z") + (hour * 60 + +m[2]) * 60_000;
  // Eastern daylight and standard time. Round-trip rejects ambiguous and nonexistent clock times.
  const matches = [4, 5]
    .map((offset) => new Date(utc + offset * 3_600_000))
    .filter(
      (d) =>
        dayFormat.format(d) === date &&
        timeFormat.format(d) === label.padStart(8, "0"),
    );
  if (matches.length !== 1) throw new Error("Unclear time on calendar");
  return matches[0].toISOString();
}

async function openDay(page, date) {
  const noon = new Date(date + "T12:00:00Z");
  if (
    !/^\d{4}-\d\d-\d\d$/.test(date) ||
    !Number.isFinite(+noon) ||
    dayFormat.format(noon) !== date
  )
    throw new Error("Invalid date");
  page.setDefaultTimeout(8000);
  await page.goto(bookingUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  verifiedPage(page);
  const root = page.locator(widget);
  await root
    .getByRole("heading", { name: "Client Booking", exact: true })
    .waitFor();
  const cookies = page.getByRole("button", { name: "Decline", exact: true });
  if (await cookies.isVisible()) await cookies.click();
  await root.locator(".vdpCell.selectable:visible").first().waitFor();
  const id = date.split("-").map(Number).join("-");
  const cell = root.locator(`td.vdpCell[data-id="${id}"]:not(.outOfRange)`);
  // A 31-day approval can span three calendar months around February.
  for (
    let advanced = 0;
    !(await cell.isVisible()) && advanced < 2;
    advanced++
  ) {
    const first = root.locator("td.vdpCell:not(.outOfRange):visible").first();
    const previous = await first.getAttribute("data-id");
    const next = root.getByRole("button", { name: "Next month" });
    if (!(await next.isEnabled())) return [];
    await next.click();
    await root
      .locator(`td.vdpCell[data-id="${previous}"]:not(.outOfRange):visible`)
      .waitFor({ state: "hidden" });
    await root.locator(".vdpCell.selectable:visible").first().waitFor();
  }
  if (
    !(await cell.isVisible()) ||
    !(await cell.evaluate((e) => e.classList.contains("selectable")))
  )
    return [];
  await cell.click();
  await root.getByRole("heading", { name: "Choose Time Slot" }).waitFor();
  const text = normalize(await root.innerText());
  if (
    !text.includes(dayLabel(noon, "long")) ||
    !text.includes(timezone) ||
    !/Duration\s*:\s*30 min\b/.test(text)
  )
    throw new Error("Unexpected consultation details");
  const times = root.locator("li.widgets-time-slot");
  await times.first().waitFor();
  const labels = await times.allInnerTexts();
  return labels.map((label) => ({
    label: label.trim(),
    iso: slotInstant(date, label.trim()),
  }));
}

export async function readSlots(page, date) {
  return (await openDay(page, date)).map((slot) => slot.iso);
}

async function reviewFields(page, root, job, start) {
  const summary = normalize(await root.innerText());
  const end = new Date(+start + 30 * 60_000);
  const range = timeFormat.format(start) + " - " + timeFormat.format(end);
  if (
    !summary.includes(dayLabel(start, "short", "short")) ||
    !summary.includes(range) ||
    !summary.includes(timezone)
  )
    return false;
  const choices = root
    .locator(".meeting-location-container")
    .filter({ hasText: /^\s*Google Meet\s*$/ });
  await choices.click();
  if (!(await choices.locator(".radio-container.selected").count()))
    return false;
  const group = root.getByRole("group", { name: "T & C", exact: true });
  const boxes = group.getByRole("checkbox");
  if ((await boxes.count()) !== 2) return false;
  const [required, optional] = [boxes.nth(0), boxes.nth(1)];
  for (const [index, box, terms] of [
    [0, required, contactTerms],
    [1, optional, optionalTerms],
  ]) {
    if (
      normalize((await box.getAttribute("aria-label")) || "") !== terms ||
      normalize(await group.locator("p").nth(index).innerText()) !== terms
    )
      return false;
  }
  // If a human-verification prompt is presented, leave it to the attendee.
  const challenge = root.locator(
    'iframe[src*="challenges.cloudflare.com"]:visible, iframe[title*="challenge" i]:visible',
  );
  if (
    (await challenge.count()) ||
    (await root
      .getByText(
        /verify (?:you are|that you are) human|complete (?:the )?captcha/i,
      )
      .isVisible())
  )
    return false;
  verifiedPage(page);
  const [first, ...rest] = job.name.trim().split(/\s+/);
  if (!first || !rest.length) return false;
  for (const [label, value] of [
    ["First Name", first],
    ["Last Name", rest.join(" ")],
    ["Email", job.email],
    ["Phone", job.phone],
    ["Message", job.message],
  ]) {
    verifiedPage(page);
    const field = root.getByPlaceholder(label, { exact: true });
    await field.fill(value);
    await field.blur();
    const actual = await field.inputValue();
    if (label === "Phone") {
      const digits = (s) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (digits(actual) !== digits(value)) return false;
    } else if (actual !== value) return false;
  }
  await optional.uncheck();
  await required.check();
  verifiedPage(page);
  return (await required.isChecked()) && !(await optional.isChecked());
}

// Observe the real, trusted click separately from the durable permission to attempt it.
// The opaque marker survives navigation through Playwright's console channel. No form data is retained.
async function observeSubmitClick(page, submit, saveClick) {
  const marker = randomUUID();
  let saved;
  const observe = (message) => {
    if (message.type() === "debug" && message.text() === marker && !saved)
      saved = Promise.resolve()
        .then(saveClick)
        .catch(() => {});
  };
  await submit.evaluate((button, marker) => {
    button.addEventListener(
      "click",
      (event) => {
        if (event.isTrusted) console.debug(marker);
      },
      { once: true, capture: true },
    );
  }, marker);
  page.on("console", observe);
  return {
    get observed() {
      return Boolean(saved);
    },
    async close() {
      page.off("console", observe);
      await saved;
    },
  };
}

export async function submitApproved(
  page,
  job,
  beforeClick,
  saveClick = () => {},
) {
  if (
    job?.consentVersion !== consentVersion ||
    job.meeting !== "Google Meet" ||
    !job.message ||
    typeof beforeClick !== "function"
  )
    return { status: "needs_human" };
  let claimed = false;
  let click;
  try {
    const start = new Date(job.startTime);
    if (!Number.isFinite(+start) || +start <= Date.now())
      return { status: "unavailable" };
    const slots = await openDay(page, dayFormat.format(start));
    const match = slots.find((s) => s.iso === start.toISOString());
    if (!match) return { status: "unavailable" };
    const root = page.locator(widget);
    await root.getByText(match.label, { exact: true }).click();
    await root.getByRole("button", { name: "Select", exact: true }).click();
    if (!(await reviewFields(page, root, job, start)))
      return { status: "needs_human" };
    const submit = root.getByRole("button", {
      name: "Schedule meeting",
      exact: true,
    });
    verifiedPage(page);
    await submit.click({ trial: true });
    click = await observeSubmitClick(page, submit, saveClick);
    if ((await beforeClick()) !== true) return { status: "needs_human" };
    claimed = true;
    verifiedPage(page);
    try {
      await submit.click({ timeout: 3000 });
    } catch {
      // A click error may follow a successful submission/navigation. Observe, never resubmit.
    }
    const result = await observeReceipt(page, start);
    if (result.status === "unknown")
      result.receipt =
        (click.observed
          ? "The browser observed a click on Schedule meeting. "
          : "Harbor could not verify a click on Schedule meeting. ") +
        result.receipt;
    return result;
  } catch {
    return claimed
      ? {
          status: "unknown",
          receipt: click?.observed
            ? "The browser observed a click on Schedule meeting. The office response could not be read."
            : "Harbor could not verify a click on Schedule meeting.",
        }
      : {
          status: "needs_human",
          receipt: "Harbor stopped before attempting the final booking click.",
        };
  } finally {
    await click?.close();
  }
}
