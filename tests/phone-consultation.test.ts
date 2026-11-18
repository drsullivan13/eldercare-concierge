import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  agencySlot,
  callURL,
  officeCallbackIntent,
  startPhoneConsultation,
} from "../src/lib/phone-consultation";
import { POST } from "../src/app/api/consultation-call/route";

test("an alternate appointment must fit in full and resolve unambiguously in New Jersey", () => {
  const start = "2030-11-03T04:00:00Z",
    end = "2030-11-03T10:00:00Z";
  assert.equal(agencySlot("11030130", start, end, 0), undefined);
  assert.equal(
    agencySlot("11030230", start, end, 0),
    "2030-11-03T07:30:00.000Z",
  );
  assert.equal(agencySlot("11030455", start, end, 0), undefined);
  assert.equal(agencySlot("11030030", start, end, Date.parse(end)), undefined);
  assert.equal(
    agencySlot("03100230", "2030-03-10T05:00:00Z", "2030-03-10T10:00:00Z", 0),
    undefined,
  );
});

test("the authenticated call flow reserves an alternate slot only after readback and office confirmation", async (t) => {
  const id = crypto.randomUUID(),
    sid = "CA" + "a".repeat(32),
    account = "AC" + "b".repeat(32),
    token = "fixture",
    provider = "fictional-office";
  const vars = {
    TWILIO_ACCOUNT_SID: account,
    TWILIO_AUTH_TOKEN: token,
    HARBOR_BOOKING_ORIGIN: "https://harbor.example",
    HARBOR_PHONE_AGENCIES: JSON.stringify({ [provider]: "+19735550100" }),
    HARBOR_BOOKING_FROM: "+19735550101",
    RESEND_API_KEY: "test",
    HARBOR_INVITE_FROM: "harbor@example.org",
    NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
    SUPABASE_SECRET_KEY: "test",
  };
  for (const [k, v] of Object.entries(vars)) {
    const old = process.env[k];
    process.env[k] = v;
    t.after(() => {
      if (old === undefined) delete process.env[k];
      else process.env[k] = old;
    });
  }
  const row = {
    id,
    user_id: crypto.randomUUID(),
    provider_id: provider,
    source: "phone",
    invite_delivery: "harbor",
    call_sid: null,
    status: "submitting",
    office_callback_pending: false,
    window_start: "2099-06-01T13:00:00Z",
    window_end: "2099-06-01T17:00:00Z",
    starts_at: null,
    invitee_name: "Test Family",
    callback_phone: "+19735550102",
  };
  let reachedInvite = false;
  let raceCallback = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api.twilio.com") {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("To"), "+19735550100");
        assert.equal(body.get("Url"), callURL(id, "offer"));
        return Response.json({ sid }, { status: 201 });
      }
      assert.equal(url.hostname, "db.example");
      if (row.status === "confirmed" && url.searchParams.has("user_id")) {
        reachedInvite = true;
        return Response.json(row);
      }
      if (init?.method === "PATCH") {
        if (raceCallback && url.searchParams.has("office_callback_pending")) {
          row.office_callback_pending = true;
          row.status = "unknown";
          raceCallback = false;
        }
        if (
          url.searchParams.get("office_callback_pending") === "eq.false" &&
          row.office_callback_pending
        )
          return Response.json([]);
        Object.assign(row, JSON.parse(String(init.body)));
        return Response.json([{ id }]);
      }
      return Response.json(row);
    },
  );
  assert.deepEqual(
    await startPhoneConsultation({
      providerId: provider,
      phone: row.callback_phone,
      requestId: id,
    }),
    { callSid: sid },
  );
  function webhook(
    step: string,
    extra: Record<string, string> = {},
    at?: string,
    signed = true,
  ) {
    const url = callURL(id, step, at);
    const params = new URLSearchParams({
      AccountSid: account,
      CallSid: sid,
      To: "+19735550100",
      From: "+19735550101",
      ...extra,
    });
    const data = [...params.keys()]
      .sort()
      .map((k) => k + params.get(k))
      .join("");
    return POST(
      new Request(url, {
        method: "POST",
        body: params,
        headers: {
          "x-twilio-signature": signed
            ? createHmac("sha1", token)
                .update(url + data)
                .digest("base64")
            : "invalid",
        },
      }),
    );
  }
  assert.equal((await webhook("offer", {}, undefined, false)).status, 403);
  assert.match(
    await (await webhook("offer")).text(),
    /automated scheduling assistant/,
  );
  assert.match(
    await (await webhook("choice", { Digits: "2" })).text(),
    /Enter two digits/,
  );
  assert.match(
    await (await webhook("custom", { Digits: "06011500" })).text(),
    /Enter two digits/,
  );
  const review = await (await webhook("custom", { Digits: "06011030" })).text();
  assert.match(review, /Once you have reserved it/);
  assert.equal(row.status, "submitting");
  const spoken = await (
    await webhook("choice", {
      SpeechResult: "We can offer Monday at ten thirty AM.",
    })
  ).text();
  assert.match(spoken, /10:30 AM/);
  const callbackReview = await (
    await webhook("choice", {
      SpeechResult:
        "We can probably do Tuesday, but the scheduler has to call you.",
    })
  ).text();
  assert.match(callbackReview, /No appointment is reserved/);
  assert.match(callbackReview, /callback-confirm/);
  assert.equal(row.office_callback_pending, false);
  assert.equal(
    (await webhook("callback-confirm", { Digits: "1" }, undefined, false))
      .status,
    403,
  );
  // A negative or dependent offer cannot become an appointment or callback.
  for (const words of [
    "We cannot do Monday at ten AM, the scheduler won't call you.",
    "If Monday at ten AM works, the scheduler will call you.",
    "We can probably do Monday at ten AM.",
  ]) {
    const answer = await (
      await webhook("choice", { SpeechResult: words })
    ).text();
    assert.doesNotMatch(answer, /Once you have reserved it|callback-confirm/);
  }
  assert.match(
    await (
      await webhook("callback-confirm", { SpeechResult: "not confirmed" })
    ).text(),
    /Please offer a time/,
  );
  assert.equal(row.office_callback_pending, false);
  assert.match(
    await (await webhook("callback-confirm", { Digits: "1" })).text(),
    /No appointment has been reserved/,
  );
  assert.equal(row.office_callback_pending, true);
  assert.equal(row.status, "unknown");
  assert.equal(row.starts_at, null);
  for (const status of ["completed", "failed", "no-answer"]) {
    await webhook("status", { CallStatus: status });
    assert.equal(row.status, "unknown");
    assert.equal(row.office_callback_pending, true);
  }
  await webhook("confirm", { Digits: "1" }, "2099-06-01T14:30:00.000Z");
  await webhook("callback-confirm", { Digits: "1" });
  assert.equal(row.status, "unknown");
  assert.equal(row.starts_at, null);
  assert.equal(reachedInvite, false);
  // A completed-call status that read stale data cannot overwrite a callback.
  row.office_callback_pending = false;
  row.status = "submitting";
  raceCallback = true;
  await webhook("status", { CallStatus: "failed" });
  assert.equal(row.office_callback_pending, true);
  assert.equal(row.status, "unknown");
  // An appointment readback that read stale data cannot overwrite a callback.
  row.office_callback_pending = false;
  raceCallback = true;
  await webhook("confirm", { Digits: "1" }, "2099-06-01T14:30:00.000Z");
  assert.equal(row.office_callback_pending, true);
  assert.equal(row.starts_at, null);
  // Expired windows cannot accept a fresh callback.
  row.office_callback_pending = false;
  const windowEnd = row.window_end;
  row.window_end = "2000-01-01T00:00:00Z";
  await webhook("callback-confirm", { Digits: "1" });
  assert.equal(row.office_callback_pending, false);
  row.window_end = windowEnd;
  // Restore the fixture to exercise the independent appointment outcome.
  row.office_callback_pending = false;
  row.status = "submitting";
  // Simulate a temporarily unavailable mail account after the office has accepted the call.
  delete process.env.RESEND_API_KEY;
  const acknowledged = await webhook(
    "confirm",
    { SpeechResult: "confirmed" },
    "2099-06-01T14:30:00.000Z",
  );
  assert.match(await acknowledged.text(), /recorded the appointment/);
  assert.equal(row.status, "confirmed");
  assert.equal(row.starts_at, "2099-06-01T14:30:00.000Z");
  assert.equal(reachedInvite, false);
  assert.equal(
    (await webhook("status", { CallStatus: "completed" })).status,
    204,
  );
  assert.equal(reachedInvite, true);
});

test("office callback intent requires an unambiguous commitment to call", () => {
  for (const words of [
    "We will call you back.",
    "The scheduler has to call you.",
    "We can probably do Tuesday, but the scheduler has to call you.",
  ])
    assert.equal(officeCallbackIntent(words), true, words);
  for (const words of [
    "The scheduler will not call you.",
    "If Tuesday works, we will call you.",
    "Maybe we will call you.",
    "We can do Tuesday.",
  ])
    assert.equal(officeCallbackIntent(words), false, words);
});
