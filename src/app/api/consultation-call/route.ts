import { bookingAdmin } from "@/lib/supabase/booking-admin";
import { deliverConsultationInvite } from "@/lib/consultation-invite";
import {
  agencySlot,
  callURL,
  consultationMinutes,
  consultationPhone,
  fitsWindow,
  officeTime,
  officeCallbackIntent,
  spokenOfficeSlot,
  verifiedOffice,
  verifyCall,
  xmlText,
} from "@/lib/phone-consultation";

export const dynamic = "force-dynamic";
const say = (words: string) => "<Say>" + xmlText(words) + "</Say>";
function reply(message: string, action?: string) {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
      (action ?? say(message) + "<Hangup/>") +
      "</Response>",
    { headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" } },
  );
}
function ask(url: string, words: string, digits: number, speech = false) {
  return reply(
    "",
    '<Gather action="' +
      xmlText(url) +
      '" method="POST" timeout="8" numDigits="' +
      digits +
      '" input="' +
      (speech ? "dtmf speech" : "dtmf") +
      '">' +
      say(words) +
      "</Gather>" +
      say("I didn't receive an answer. Thank you for your time.") +
      "<Hangup/>",
  );
}
const yes = (s: string) =>
  /^(yes|yes please|confirmed|confirm|one)[.!]?$/i.test(s.trim());
export async function POST(request: Request) {
  const body = new URLSearchParams(await request.text());
  if (!verifyCall(request, body)) return new Response(null, { status: 403 });
  const query = new URL(request.url).searchParams;
  const id = query.get("id") ?? "",
    step = query.get("step"),
    sid = body.get("CallSid") ?? "";
  if (!/^[a-f\d-]{36}$/i.test(id) || !/^CA[a-f\d]{32}$/i.test(sid))
    return new Response(null, { status: 400 });
  const client = bookingAdmin();
  const table = () => client.from("consultation_bookings");
  const { data: r, error } = await table()
    .select(
      "id,user_id,provider_id,source,call_sid,status,window_start,window_end,starts_at,invitee_name,callback_phone,office_callback_pending",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return new Response(null, { status: 503 });
  if (
    !r ||
    r.source !== "phone" ||
    !verifiedOffice(r.provider_id, body.get("To")) ||
    consultationPhone(body.get("From")) !==
      consultationPhone(process.env.HARBOR_BOOKING_FROM) ||
    (r.call_sid && r.call_sid !== sid)
  )
    return new Response(null, { status: 403 });
  if (!r.call_sid) {
    const bound = await table()
      .update({ call_sid: sid })
      .eq("id", id)
      .is("call_sid", null)
      .select("id");
    if (bound.error || !bound.data?.length)
      return new Response(null, { status: 503 });
  }
  async function update(values: Record<string, unknown>) {
    const result = await table()
      .update(values)
      .eq("id", id)
      .eq("call_sid", sid)
      .in("status", ["submitting", "unknown"])
      .eq("office_callback_pending", false)
      .gt("window_end", new Date().toISOString())
      .select("id");
    if (result.error) throw Error("Could not save agency response");
    return Boolean(result.data?.length);
  }
  function sendInvite() {
    return deliverConsultationInvite(client, {
      bookingId: id,
      userId: r!.user_id,
    });
  }
  if (r.status === "confirmed") {
    if (step === "status") {
      await sendInvite();
      return new Response(null, { status: 204 });
    }
    return reply("This consultation is confirmed. Thank you.");
  }
  if (!["submitting", "unknown"].includes(r.status))
    return reply("This request is closed. Thank you.");
  if (r.office_callback_pending || Date.parse(r.window_end) <= Date.now())
    return step === "status"
      ? new Response(null, { status: 204 })
      : reply(
          "This request is awaiting an office callback or is closed. No appointment has been reserved. Thank you.",
        );
  if (step === "status") {
    const status = body.get("CallStatus");
    if (["busy", "failed", "no-answer", "canceled"].includes(status ?? ""))
      await update({ status: "failed" });
    else if (status === "completed") await update({ status: "unknown" });
    return new Response(null, { status: 204 });
  }
  const digits = body.get("Digits") ?? "",
    speech = body.get("SpeechResult") ?? "";
  const phone = consultationPhone(r.callback_phone);
  if (!phone)
    return reply("The family's callback number is unavailable. Thank you.");
  const at = query.get("at") ?? "";
  const valid = (time: string) =>
    fitsWindow(time, r.window_start, r.window_end);
  if (step === "callback-confirm" && (digits === "1" || yes(speech))) {
    const saved = await update({
      status: "unknown",
      office_callback_pending: true,
      starts_at: null,
      ends_at: null,
    });
    return reply(
      saved
        ? "Thank you. The family will wait for your office to call back. No appointment has been reserved."
        : "The request has already been updated. Thank you.",
    );
  }
  if (
    ["choice", "custom", "confirm"].includes(step ?? "") &&
    officeCallbackIntent(speech)
  ) {
    return ask(
      callURL(id, "callback-confirm"),
      "Please confirm: your office will call " +
        r.invitee_name +
        " at " +
        phone.slice(2).split("").join(" ") +
        " to arrange a consultation within the requested window, between " +
        officeTime(r.window_start) +
        " and " +
        officeTime(r.window_end) +
        " Eastern. No appointment is reserved. Say confirmed or press one to record this pending callback. Press two to offer an appointment instead.",
      1,
      true,
    );
  }
  if (step === "offer") {
    const first = new Date(
      Math.ceil(
        Math.max(Date.now() + 60000, Date.parse(r.window_start)) / 900000,
      ) * 900000,
    ).toISOString();
    const intro =
      "Hello. I'm Harbor, an automated scheduling assistant calling on behalf of a family about home care. ";
    if (valid(first))
      return ask(
        callURL(id, "choice", first),
        intro +
          "Could your office call the family for a free fifteen-minute consultation on " +
          officeTime(first) +
          " Eastern time? Say yes or press one to hear the details, or say another weekday and time, such as Tuesday at ten A M. You can also press two to use the keypad. Press nine if there are no openings.",
        1,
        true,
      );
    return ask(
      callURL(id, "custom"),
      intro +
        "The family is available between " +
        officeTime(r.window_start) +
        " and " +
        officeTime(r.window_end) +
        " Eastern. Please enter an available start as two digits each for month, day, hour in twenty-four-hour time, and minute.",
      8,
    );
  }
  if (step === "choice" && digits === "9") {
    await update({ status: "unavailable" });
    return reply("Thank you. I'll let the family know.");
  }
  const tentative =
    /\b(if|unless|once|after|probably|perhaps|maybe|might|no|not|never|cannot|can't|won't|don't|doesn't)\b/i.test(
      speech,
    );
  const alternate =
    speech && !tentative
      ? spokenOfficeSlot(speech, r.window_start, r.window_end)
      : undefined;
  const offered =
    alternate ??
    (step === "custom" ? agencySlot(digits, r.window_start, r.window_end) : at);
  if (
    (step === "choice" && (digits === "1" || yes(speech)) && valid(at)) ||
    (step === "custom" && offered) ||
    (["choice", "custom", "confirm"].includes(step ?? "") && alternate)
  ) {
    const number = phone.slice(2).split("").join(" ");
    return ask(
      callURL(id, "confirm", offered!),
      "Please reserve " +
        officeTime(offered!) +
        " Eastern for a free fifteen-minute consultation. Your office will call " +
        r.invitee_name +
        " at " +
        number +
        ". Once you have reserved it, say confirmed or press one. Press two to offer a different time.",
      1,
      true,
    );
  }
  if (step === "confirm" && valid(at) && (digits === "1" || yes(speech))) {
    const saved = await update({
      status: "confirmed",
      starts_at: at,
      ends_at: new Date(
        Date.parse(at) + consultationMinutes * 60000,
      ).toISOString(),
    });
    if (!saved)
      return reply("The request has already been updated. Thank you.");
    // Twilio delivers the completed-call callback after this acknowledgement.
    return reply(
      "Thank you. I've recorded the appointment for " +
        officeTime(at) +
        " Eastern.",
    );
  }
  return ask(
    callURL(id, "custom"),
    "Please offer a time between " +
      officeTime(r.window_start) +
      " and " +
      officeTime(r.window_end) +
      " Eastern. Say the weekday and time with A M or P M, or use the keypad. Enter two digits each for month, day, hour in twenty-four-hour time, and minute.",
    8,
    true,
  );
}
