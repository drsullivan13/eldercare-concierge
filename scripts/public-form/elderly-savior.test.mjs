import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../lib/chromium.mjs";
import { readSlots, submitApproved } from "./elderly-savior.mjs";

// Mirror the booking widget inside the public office page, including its unrelated second form.
const contact =
  "By submitting this form, I agree to be contacted by Elderly Savior Homecare LLC by phone call, text message, or email regarding home care services, appointments, referrals, and related marketing communications. I understand that calls or messages may be automated, pre-recorded, or use an AI voice assistant. Message and data rates may apply. I understand that consent is not required to purchase services. I may opt out at any time by replying STOP to text messages, requesting not to be called, or contacting Elderly Savior Homecare directly at (973) 855-4461.";
const marketing =
  "By checking this box, I consent to receive marketing and promotional text messages from Elderly Savior Homecare LLC about special offers, discounts, program updates among others. Frequency may vary. Message & data rates may apply. Text HELP for assistance, reply STOP to opt out.";
const day = "2099-07-01";
const startTime = day + "T14:00:00.000Z";
const job = {
  startTime,
  consentVersion: "elderly-savior-v1",
  name: "Alex Example",
  meeting: "Google Meet",
  email: "alex@example.invalid",
  phone: "2025550176",
  message: "Fictional test.",
};
const dateLabel = "Wed, Jul 1, 2099";
function fixture(result, terms) {
  return `<main id="calendarAppointmentBookingMain">
    <h4>Client Booking</h4>
    <table><tr><td data-id="2099-7-1" class="selectable vdpCell">1</td></tr></table>
    <section id="times" hidden>July 1, 2099 America/New_York
    <h4>Choose Time Slot</h4>Duration : 30 min<ul><li class="widgets-time-slot">10:00 AM</li></ul>
    <button id="select" hidden>Select</button></section>
    <section id="details" hidden>10:00 AM - 10:30 AM, ${dateLabel} America/New_York
    <div class="meeting-location-container"><span class="radio-container"></span><span class="meeting-location-icon">
      <svg></svg>
    </span><p>Google Meet</p></div>
    <input placeholder="First Name"><input placeholder="Last Name"><input placeholder="Phone"><input placeholder="Email"><textarea placeholder="Message"></textarea>
    <fieldset><legend>T &amp; C</legend>${[terms, marketing].map((t) => `<label><input type="checkbox" aria-label="${t}"><p>${t}</p></label>`).join("")}</fieldset>
    <button id="schedule">Schedule meeting</button></section></main>
    <aside><input placeholder="Email"><button>Schedule meeting</button></aside>
    <script>
    const root=document.querySelector('main'),show=id=>document.querySelector(id).hidden=false;
    document.querySelector('td').onclick=()=>show('#times');
    document.querySelector('li').onclick=()=>show('#select');
    document.querySelector('#select').onclick=()=>show('#details');
    document.querySelector('.meeting-location-container').onclick=()=>document.querySelector('.radio-container').classList.add('selected');
    window.submits=0;
    document.querySelector('#schedule').onclick=()=>{
      window.submits++;
      window.sent=Array.from(root.querySelectorAll('input,textarea')).map(e=>e.type==='checkbox'?e.checked:e.value);
      root.innerHTML=${JSON.stringify(result)};
    };
    </script>`;
}
test("public-form worker scopes to the office widget and requires office evidence and an exclusive claim", async () => {
  const browser = await chromium.launch(chromiumLaunchOptions);
  try {
    const page = await browser.newPage();
    let html;
    await page.route("**/*", (route) =>
      route.request().url() === "https://elderlysaviorhc.com/book-now"
        ? route.fulfill({ contentType: "text/html", body: html })
        : route.abort(),
    );
    const confirmed = `<h3>Appointment confirmed</h3> ${dateLabel} 10:00 AM America/New_York Google Meet`;
    html = fixture(confirmed, contact);
    assert.deepEqual(await readSlots(page, day), [startTime]);
    let claims = 0;
    const claim = async () => {
      claims++;
      return true;
    };
    assert.equal((await submitApproved(page, job, claim)).status, "confirmed");
    assert.equal(claims, 1);
    assert.deepEqual(
      await page.evaluate(() => [
        window.submits,
        window.sent,
        document.querySelector("aside input").value,
      ]),
      [
        1,
        [
          "Alex",
          "Example",
          "2025550176",
          "alex@example.invalid",
          "Fictional test.",
          true,
          false,
        ],
        "",
      ],
    );
    html = fixture(confirmed.replace("10:00 AM", "11:00 AM"), contact);
    assert.equal((await submitApproved(page, job, claim)).status, "unknown");
    html = fixture(
      "<h3>Request received</h3>We will contact you to confirm.",
      contact,
    );
    assert.equal((await submitApproved(page, job, claim)).status, "pending");
    html = fixture(confirmed, contact + " Different terms.");
    assert.equal(
      (await submitApproved(page, job, claim)).status,
      "needs_human",
    );
    assert.equal(claims, 3);
    html = fixture(confirmed, contact);
    assert.equal(
      (await submitApproved(page, job, async () => false)).status,
      "needs_human",
    );
    assert.equal(await page.evaluate(() => window.submits), 0);
  } finally {
    await browser.close();
  }
});
