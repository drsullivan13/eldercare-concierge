import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../lib/chromium.mjs";
import { readSlots, submitApproved } from "./wellcare.mjs";

const origin = "https://www.wellcarenurses.com";
const calendarUrl = origin + "/booking-calendar/free-assessment";
const day = "2026-11-30";
const job = {
  startTime: "2026-11-30T16:30:00.000Z",
  consentVersion: "wellcare-v1",
  meeting: "Available Online",
  name: "Alex Example",
  email: "alex@example.invalid",
  phone: "2025550176",
};
const terms =
  "By completing your booking, you agree to receive related phone notifications.";
const summary =
  "<p>Free Assessment</p><p>November 30, 2026 at 11:30 am</p><p>Available Online</p><p>30 min</p>";
const confirmed = `<section><h2>Booking confirmed</h2>${summary}</section>`;
const uuid = "6c87e36d-879b-45e9-b33b-b6dd4883daef";
let browser;

before(async () => {
  browser = await chromium.launch(chromiumLaunchOptions);
});
after(async () => {
  await browser?.close();
});

function fixture(options = {}) {
  const form = `<main><h1>Client Details</h1>
    <label>Name*<input id="name" aria-label="Name" required></label><label>Email*<input id="email" type="email" aria-label="Email" required></label>
    <label>Phone Number*<input id="phone" type="tel" aria-label="Phone Number. Phone" required></label>
    <label>Could you kindly share what you hope to achieve in this meeting?<textarea id="message" data-hook="text-area" aria-label="Could you kindly share what you hope to achieve in this meeting?"></textarea></label>
    <div id="provider-booking">
    <div id="summary"><h2 data-hook="booking-details-section-title">Booking Details</h2>${(options.summary ?? summary).replace(/<p>(\d+ min)<\/p>/g, '<div id="duration" hidden><p data-hook="booking-details-duration">$1</p><span data-hook="booking-details-duration-aria">$1utes</span></div>')}<button id="form-more" aria-expanded="false">More details</button></div>
    ${options.extra ?? ""}
    <div data-hook="sms-notification"><p id="terms" data-hook="sms-notification-text">${options.terms ?? terms}</p>${options.consentExtra ?? ""}</div><button id="book">Book Now</button></div></main>
    <aside><label>Email<input></label><button>Book Now</button></aside>`;
  return `<main><h1>Schedule your service</h1><h2>Select a date and time</h2>
    <p>${options.zone ?? "Time zone: Eastern Standard Time (EST)"}</p>
    <table aria-label="November 2026"><tr><td><button id="day" aria-label="Monday, November 30th, 2026">30</button></td></tr></table>
    <fieldset id="times" hidden><legend>Availability for Monday, November 30</legend><div id="loaded" hidden>
      <label><input type="radio" name="time" id="${options.radioId ?? day + "T11:30:00"}" aria-label="11:30 am">11:30 am</label>
    </div></fieldset>
    <div data-hook="booking-details-wrapper" hidden></div>
    <button id="more">More details</button><button id="next" disabled>Next</button></main>
    <script>
    window.submits=0;window.fills=0;window.clickTrusted=[];
    document.addEventListener('input',event=>{
      if (event.target.matches('input:not([type=radio]),textarea')) window.fills++;
    });
    document.querySelector('#day').onclick=()=>{
      document.querySelector('#times').hidden=false;
      setTimeout(()=>{
        document.querySelector('#loaded').hidden=false;
        ${options.noAvailability ? `document.querySelector('#loaded').innerHTML='<p>No availability</p>';` : ""}
        setTimeout(()=>{
          document.querySelector('[data-hook="booking-details-wrapper"]').innerHTML=${JSON.stringify(options.calendarSummary ?? summary)};
        },${options.detailsDelay ?? 0});
        document.querySelector('#next').disabled=false;
      },${options.loadDelay ?? 0});
    };
    document.querySelector('#more').onclick=()=>document.querySelector('[data-hook]').hidden=false;
    document.querySelector('#next').onclick=()=>{
      ${options.formOrigin ? `location.href=${JSON.stringify(options.formOrigin + "/booking-form")};return;` : ""}
      history.pushState({},'', '/booking-form');
      document.body.innerHTML=${JSON.stringify(form)};
      document.querySelector('#form-more').onclick=()=>{
        const duration=document.querySelector('#duration');
        if(duration) duration.hidden=false;
        document.querySelector('#form-more').setAttribute('aria-expanded','true');
      };
      ${options.onForm ?? ""}
      document.querySelector('#book').onclick=async (event)=>{
        window.submits++;
        window.clickTrusted.push(event.isTrusted);
        window.sent=['name','email','phone'].map(id=>document.getElementById(id).value);
        ${options.onSubmit ?? ""}
        ${
          options.destination
            ? `location.href=${JSON.stringify(options.destination)};`
            : `document.querySelector('main').innerHTML=${JSON.stringify(options.receipt ?? confirmed)};`
        }
      };
    };
    </script>`;
}

async function setup(t, options = {}) {
  t.mock.method(Date, "now", () => Date.parse("2026-11-19T12:00:00Z"));
  const page = await browser.newPage({ timezoneId: "America/New_York" });
  t.after(() => page.close());
  // Accelerate only the bounded receipt polling, not browser interaction or visibility checks.
  page.waitForTimeout = async () => {};
  const requests = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    requests.push({ url: request.url(), method: request.method() });
    if (request.url() === calendarUrl)
      return route.fulfill({
        contentType: "text/html",
        body: fixture(options),
      });
    if (
      options.formOrigin &&
      request.url() === options.formOrigin + "/booking-form"
    )
      return route.fulfill({
        contentType: "text/html",
        body:
          "<main><h1>Client Details</h1>" +
          summary +
          "<p>" +
          terms +
          "</p></main>",
      });
    if (options.destination && request.url() === options.destination)
      return route.fulfill({
        contentType: "text/html",
        body: "<main>" + (options.receipt ?? confirmed) + "</main>",
      });
    if (request.resourceType() === "fetch")
      return route.fulfill({
        status: 201,
        headers: { "access-control-allow-origin": "*" },
        body: "Private response",
      });
    return route.abort();
  });
  return { page, requests };
}

function counters() {
  const state = { claims: 0, signals: [] };
  state.claim = async () => {
    state.claims++;
    return true;
  };
  state.observed = (...args) => {
    state.signals.push(args);
  };
  return state;
}

// Intercept only the final browser action to exercise delivery failure and last-moment drift.
function finalAction(page, action, installation = false) {
  const original = page.getByRole.bind(page);
  page.getByRole = (...args) => {
    const root = original(...args);
    const child = root.getByRole.bind(root);
    root.getByRole = (...nested) => {
      const locator = child(...nested);
      if (nested[0] === "button" && nested[1]?.name === "Book Now") {
        const click = locator.click.bind(locator);
        locator.click = (options) =>
          options?.trial
            ? click(options)
            : action(locator, () => click(options));
        if (installation) {
          locator.click = click;
          const evaluate = locator.evaluate.bind(locator);
          let installed = false;
          locator.evaluate = async (...evaluation) => {
            if (!installed) {
              installed = true;
              await action(locator);
            }
            return evaluate(...evaluation);
          };
        }
      }
      return locator;
    };
    return root;
  };
}

test("discovers the verified Wix local-time radio as an Eastern UTC instant without contact filling", async (t) => {
  const { page, requests } = await setup(t);
  assert.deepEqual(await readSlots(page, day), [job.startTime]);
  assert.deepEqual(
    await page.evaluate(() => [window.fills, window.submits]),
    [0, 0],
  );
  assert.ok(requests.every((request) => request.method === "GET"));
  await assert.rejects(readSlots(page, "2026-02-30"));
});

test("waits for asynchronous slots and details, not merely the availability group", async (t) => {
  const { page } = await setup(t, { loadDelay: 700, detailsDelay: 400 });
  assert.deepEqual(await readSlots(page, day), [job.startTime]);
  assert.deepEqual(
    await page.evaluate(() => [window.fills, window.submits]),
    [0, 0],
  );
});

test("returns no slots only after an explicit rendered no-availability state", async (t) => {
  const { page } = await setup(t, { loadDelay: 700, noAvailability: true });
  assert.deepEqual(await readSlots(page, day), []);
});

test("fills only approved fields, claims once, observes a trusted click, and confirms the matching assessment", async (t) => {
  const { page, requests } = await setup(t, {
    receipt: confirmed.replace(
      "</section>",
      `<p>Appointment reference: ${uuid}</p><p>Private attendee text must not escape.</p></section>`,
    ),
  });
  const state = counters();
  const receipt = await submitApproved(page, job, state.claim, state.observed);
  assert.equal(receipt.status, "confirmed");
  assert.equal(
    receipt.receipt,
    `Wellcare confirmed the approved online Free Assessment. Appointment reference: ${uuid}.`,
  );
  assert.equal(state.claims, 1);
  assert.deepEqual(state.signals, [[]]);
  assert.deepEqual(
    await page.evaluate(() => [
      window.submits,
      window.clickTrusted,
      window.sent,
      document.querySelector("aside input").value,
    ]),
    [1, [true], [job.name, job.email, job.phone], ""],
  );
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("leaves the known optional textarea empty, including when a message was supplied", async (t) => {
  const { page } = await setup(t, {
    onSubmit: "window.sentMessage=document.querySelector('#message').value;",
  });
  const state = counters();
  assert.equal(
    (
      await submitApproved(
        page,
        { ...job, message: "Approved but optional" },
        state.claim,
        state.observed,
      )
    ).status,
    "confirmed",
  );
  assert.equal(await page.evaluate(() => window.sentMessage), "");
});

test("public references are bounded codes, never arbitrary page text or contact data", async (t) => {
  for (const [label, expected] of [
    ["Public booking reference: WC-2026-A1B2", "WC-2026-A1B2"],
    [`Appointment reference: ${uuid}.`, uuid],
    ["Booking reference: WC-2026-A1B2", undefined],
    [`Public booking reference: ${job.email}`, undefined],
    [`Public booking reference: ${job.phone}`, undefined],
    ["Public booking reference: Alex Example", undefined],
    ["Public booking reference: https://example.invalid/private", undefined],
    ["Public booking reference: " + "A1-".repeat(30), undefined],
    [`Booking reference: ${uuid}@example.invalid`, undefined],
  ]) {
    await t.test(label, async (t) => {
      const { page } = await setup(t, {
        receipt: confirmed.replace("</section>", `<p>${label}</p></section>`),
      });
      const state = counters();
      const receipt = await submitApproved(
        page,
        job,
        state.claim,
        state.observed,
      );
      assert.equal(receipt.status, "confirmed");
      assert.equal(
        receipt.receipt,
        "Wellcare confirmed the approved online Free Assessment." +
          (expected ? ` Appointment reference: ${expected}.` : ""),
      );
    });
  }
});

test("only an exact HTTPS provider origin can supply a receipt", async (t) => {
  for (const [destination, expected] of [
    [origin + "/thank-you", "confirmed"],
    ["https://wellcarenurses.com/thank-you", "unknown"],
    ["https://www.wellcarenurses.com.example.invalid/thank-you", "unknown"],
    ["https://foreign.invalid/thank-you", "unknown"],
    ["http://www.wellcarenurses.com/thank-you", "unknown"],
  ]) {
    await t.test(destination, async (t) => {
      const { page } = await setup(t, { destination });
      const state = counters();
      assert.equal(
        (await submitApproved(page, job, state.claim, state.observed)).status,
        expected,
      );
      assert.deepEqual(state.signals, [[]]);
      assert.equal(state.claims, 1);
    });
  }
});

test("receipt ambiguity, mismatched details, and denial cannot become confirmation", async (t) => {
  for (const [label, receipt, expected] of [
    ["generic thanks", "<h2>Thank you!</h2>" + summary, "unknown"],
    ["wrong time", confirmed.replace("11:30 am", "12:00 pm"), "unknown"],
    ["wrong date", confirmed.replace("November 30", "November 29"), "unknown"],
    [
      "wrong service",
      confirmed.replace("Free Assessment", "Nursing Visit"),
      "unknown",
    ],
    ["wrong duration", confirmed.replace("30 min", "60 min"), "unknown"],
    [
      "wrong location",
      confirmed.replace("Available Online", "In person"),
      "unknown",
    ],
    [
      "wrong timezone",
      confirmed.replace("</section>", "<p>PST</p></section>"),
      "unknown",
    ],
    [
      "date and service on native confirmation",
      "<section><h2>Thanks for booking!</h2><p>Free Assessment</p><p>November 30, 2026 at 11:30 am</p></section>",
      "confirmed",
    ],
    [
      "generic thanks",
      "<section><h2>Thanks for booking!</h2></section>",
      "unknown",
    ],
    [
      "receipt omits duration",
      confirmed.replace("<p>30 min</p>", ""),
      "confirmed",
    ],
    [
      "hidden details",
      "<section><h2>Booking confirmed</h2><div hidden>" +
        summary +
        "</div></section>",
      "unknown",
    ],
    [
      "split evidence",
      "<section><h2>Booking confirmed</h2></section><section>" +
        summary +
        "</section>",
      "unknown",
    ],
    ["unrelated footer", "<footer>" + confirmed + "</footer>", "unknown"],
    ["denied", confirmed + "<p role=alert>Appointment rejected</p>", "unknown"],
    ["validation", confirmed + '<input aria-invalid="true">', "unknown"],
    [
      "pending overrides confirmed",
      confirmed + "<p>Request received. We will contact you to confirm.</p>",
      "pending",
    ],
    [
      "request only",
      "<h2>Request received</h2><p>Awaiting confirmation.</p>",
      "pending",
    ],
    [
      "unsafe reference",
      confirmed.replace(
        "</section>",
        `<p>Booking reference: ${job.email}</p></section>`,
      ),
      "confirmed",
    ],
  ]) {
    await t.test(label, async (t) => {
      const { page } = await setup(t, { receipt });
      const state = counters();
      const actual = await submitApproved(
        page,
        job,
        state.claim,
        state.observed,
      );
      assert.equal(actual.status, expected);
      assert.equal(state.claims, 1);
      assert.deepEqual(state.signals, [[]]);
      assert.equal(await page.evaluate(() => window.submits), 1);
      assert.doesNotMatch(
        actual.receipt,
        /alex|Private|example\.invalid|2025550176/,
      );
      if (expected === "unknown")
        assert.match(actual.receipt, /browser observed a click on Book Now/);
    });
  }
});

test("calendar evidence fails closed without filling or claiming", async (t) => {
  for (const options of [
    { radioId: "2026-11-30T12:00:00" },
    { calendarSummary: summary.replace("30 min", "60 min") },
    { calendarSummary: summary.replace("Available Online", "In person") },
    { calendarSummary: summary.replace("Free Assessment", "Paid Visit") },
    { calendarSummary: summary.replace("November 30", "November 29") },
    { zone: "Time zone: Pacific Standard Time (PST)" },
  ]) {
    await t.test(JSON.stringify(options), async (t) => {
      const { page } = await setup(t, options);
      const state = counters();
      assert.equal(
        (await submitApproved(page, job, state.claim, state.observed)).status,
        "needs_human",
      );
      assert.equal(state.claims, 0);
      assert.deepEqual(state.signals, []);
      assert.deepEqual(
        await page.evaluate(() => [window.fills, window.submits]),
        [0, 0],
      );
    });
  }
});

test("every form evidence gate runs before the first contact fill", async (t) => {
  for (const options of [
    { summary: summary.replace("November 30", "November 29") },
    { summary: summary.replace("11:30 am", "12:00 pm") },
    { summary: summary.replace("Free Assessment", "Paid Visit") },
    { summary: summary.replace("Available Online", "In person") },
    { summary: summary.replace("<p>30 min</p>", "") },
    { summary: summary.replace("30 min", "60 min") },
    { summary: summary + "<p>PST</p>" },
    { terms: terms + " Additional consent." },
    {
      consentExtra:
        "<p>I agree to promotional messages and cancellation fees.</p>",
    },
    { extra: "<p>I agree to promotional messages and cancellation fees.</p>" },
    { terms: `<span hidden>${terms}</span>` },
    { extra: '<label><input type="checkbox">Marketing consent</label>' },
    { extra: "<p>Verify you are human</p>" },
    { extra: "<label>Address<input></label>" },
    { onForm: "document.querySelector('#message').required=true;" },
    {
      onForm:
        "document.querySelector('#message').setAttribute('aria-label','Other request');",
    },
  ]) {
    await t.test(JSON.stringify(options), async (t) => {
      const { page } = await setup(t, options);
      const state = counters();
      assert.equal(
        (await submitApproved(page, job, state.claim, state.observed)).status,
        "needs_human",
      );
      assert.equal(state.claims, 0);
      assert.deepEqual(state.signals, []);
      assert.deepEqual(
        await page.evaluate(() => [window.fills, window.submits]),
        [0, 0],
      );
    });
  }
  await t.test("foreign details form", async (t) => {
    const { page } = await setup(t, { formOrigin: "https://foreign.invalid" });
    const state = counters();
    assert.equal(
      (await submitApproved(page, job, state.claim, state.observed)).status,
      "needs_human",
    );
    assert.equal(state.claims, 0);
    assert.deepEqual(state.signals, []);
  });
});

test("capture compares approved values across the observer-installation gap", async (t) => {
  const { page } = await setup(t);
  finalAction(
    page,
    () =>
      page.locator("#email").evaluate((field) => {
        field.value = "unapproved@example.invalid";
      }),
    true,
  );
  const state = counters();
  assert.equal(
    (await submitApproved(page, job, state.claim, state.observed)).status,
    "unknown",
  );
  assert.equal(state.claims, 1);
  assert.deepEqual(state.signals, []);
  assert.equal(await page.evaluate(() => window.submits), 0);
});

test("separate consent paragraphs introduced before final review or final click block submission", async (t) => {
  for (const phase of ["claim", "observer", "click"]) {
    await t.test(phase, async (t) => {
      const { page } = await setup(t);
      const change = () =>
        page.locator('[data-hook="sms-notification"]').evaluate((block) => {
          block.insertAdjacentHTML(
            "beforeend",
            "<p>I accept promotional messages and cancellation fees.</p>",
          );
        });
      if (phase === "click")
        finalAction(page, async (_locator, click) => {
          await change();
          await click();
        });
      if (phase === "observer") {
        finalAction(page, change, true);
      }
      const state = counters();
      const receipt = await submitApproved(
        page,
        job,
        async () => {
          state.claims++;
          if (phase === "claim") await change();
          return true;
        },
        state.observed,
      );
      assert.equal(receipt.status, "unknown");
      assert.equal(state.claims, 1);
      assert.deepEqual(state.signals, []);
      assert.equal(await page.evaluate(() => window.submits), 0);
    });
  }
});

test("rechecks details, terms, contact values, and origin after the durable claim", async (t) => {
  for (const change of [
    [
      "#summary",
      "textContent",
      "Free Assessment November 29, 2026 at 11:30 am Available Online 30 min",
    ],
    [
      "#summary",
      "textContent",
      "Free Assessment November 30, 2026 at 12:00 pm Available Online 30 min",
    ],
    [
      "#summary",
      "textContent",
      "Free Assessment November 30, 2026 at 11:30 am In person 30 min",
    ],
    [
      "#summary",
      "textContent",
      "Free Assessment November 30, 2026 at 11:30 am Available Online 60 min",
    ],
    [
      "#summary",
      "textContent",
      "Paid Visit November 30, 2026 at 11:30 am Available Online 30 min",
    ],
    ["#terms", "textContent", terms + " Changed."],
    ["#email", "value", "other@example.invalid"],
    ["#name", "value", "Other Person"],
    ["#phone", "value", "2025550199"],
    null,
  ]) {
    await t.test(JSON.stringify(change), async (t) => {
      const { page } = await setup(t);
      const state = counters();
      const receipt = await submitApproved(
        page,
        job,
        async () => {
          state.claims++;
          if (change)
            await page.evaluate(([selector, key, value]) => {
              document.querySelector(selector)[key] = value;
            }, change);
          else
            await page.goto("https://foreign.invalid/changed").catch(() => {});
          return true;
        },
        state.observed,
      );
      assert.equal(receipt.status, "unknown");
      assert.equal(state.claims, 1);
      assert.deepEqual(state.signals, []);
      if (change) assert.equal(await page.evaluate(() => window.submits), 0);
    });
  }
});

test("a denied claim or invalid job never clicks", async (t) => {
  for (const override of [
    { consentVersion: "unapproved" },
    { meeting: "Google Meet" },
    { meeting: "Online" },
    { email: "" },
    { name: "" },
    { phone: "" },
    { startTime: "invalid" },
    { startTime: "2026-11-30T16:00:00.000Z" },
    { startTime: "2026-11-18T16:30:00.000Z" },
    null,
  ]) {
    await t.test(JSON.stringify(override), async (t) => {
      const { page } = await setup(t);
      const state = counters();
      const receipt = await submitApproved(
        page,
        { ...job, ...override },
        async () => {
          state.claims++;
          return false;
        },
        state.observed,
      );
      assert.ok(["needs_human", "unavailable"].includes(receipt.status));
      assert.equal(state.claims, override === null ? 1 : 0);
      assert.deepEqual(state.signals, []);
      if (override === null)
        assert.equal(await page.evaluate(() => window.submits), 0);
    });
  }
});

test("synthetic or undelivered clicks are not evidence, and capture blocks last-moment drift", async (t) => {
  for (const mode of ["synthetic", "undelivered", "drift"]) {
    await t.test(mode, async (t) => {
      const { page } = await setup(t);
      finalAction(page, async (locator, click) => {
        if (mode === "synthetic")
          await locator.evaluate((button) => button.click());
        if (mode === "undelivered") throw new Error("Delivery failed");
        if (mode === "drift") {
          await page.locator("#terms").evaluate((element) => {
            element.textContent += " Changed.";
          });
          await click();
        }
      });
      const state = counters();
      const receipt = await submitApproved(
        page,
        job,
        state.claim,
        state.observed,
      );
      assert.equal(receipt.status, "unknown");
      assert.match(receipt.receipt, /could not verify a click/);
      assert.equal(state.claims, 1);
      assert.deepEqual(state.signals, []);
      assert.equal(await page.evaluate(() => window.submits), 0);
    });
  }
});

test("an uncertain click is never retried, including repeated calls on the same page", async (t) => {
  const { page } = await setup(t, {
    onSubmit: "document.querySelector('#book').click();",
    receipt: "<p>Ambiguous result</p>",
  });
  let actions = 0;
  finalAction(page, async (_locator, click) => {
    actions++;
    await click();
    throw new Error("Timeout after delivered click");
  });
  const state = counters();
  assert.equal(
    (await submitApproved(page, job, state.claim, state.observed)).status,
    "unknown",
  );
  assert.equal(
    (await submitApproved(page, job, state.claim, state.observed)).status,
    "needs_human",
  );
  assert.equal(actions, 1);
  assert.equal(state.claims, 1);
  assert.deepEqual(state.signals, [[]]);
  assert.equal(await page.evaluate(() => window.submits), 1);
});

test("Wix shared endpoint HTTP responses are never treated as provider acknowledgement", async (t) => {
  const { page } = await setup(t, {
    onSubmit:
      "await fetch('https://www.wixapis.com/bookings/v2/bookings', {method:'POST'});",
    receipt: "<h2>Thank you</h2>",
  });
  const state = counters();
  const receipt = await submitApproved(page, job, state.claim, state.observed);
  assert.equal(receipt.status, "unknown");
  assert.deepEqual(state.signals, [[]]);
  assert.doesNotMatch(receipt.receipt, /HTTP|Private response/);
});
