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
    .filter({ hasText: /^Google Meet$/ });
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

export async function submitApproved(page, job, beforeClick) {
  if (
    job?.consentVersion !== consentVersion ||
    job.meeting !== "Google Meet" ||
    !job.message ||
    typeof beforeClick !== "function"
  )
    return { status: "needs_human" };
  let claimed = false;
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
    if ((await beforeClick()) !== true) return { status: "needs_human" };
    claimed = true;
    verifiedPage(page);
    await submit.click({ timeout: 3000 });
    // Wait for the office's receipt in this calendar, never infer success from a click or a vanished slot.
    await submit.waitFor({ state: "hidden", timeout: 10000 });
    await root
      .getByText(/confirmed|thank you|requested|received/i)
      .first()
      .waitFor({ timeout: 5000 });
    verifiedPage(page);
    const text = normalize(await root.innerText());
    if (
      /will.{0,50}confirm|pending confirmation|request (?:was |has been )?received/i.test(
        text,
      )
    )
      return { status: "pending" };
    const dates = [
      dayLabel(start, "short", "short"),
      dayLabel(start, "long"),
      dayLabel(start, "short"),
    ];
    const explicit = await root
      .getByRole("heading", {
        name: /^(?:your )?(?:appointment|meeting|booking|consultation) (?:is |has been )?confirmed[!.]?$/i,
      })
      .isVisible();
    if (
      explicit &&
      dates.some((d) => text.includes(d)) &&
      text.includes(timeFormat.format(start)) &&
      text.includes(timezone) &&
      text.includes("Google Meet")
    ) {
      return {
        status: "confirmed",
        receipt:
          "Office calendar confirmed a Google Meet consultation at " +
          start.toISOString(),
      };
    }
    return { status: "unknown" };
  } catch {
    return { status: claimed ? "unknown" : "needs_human" };
  }
}
