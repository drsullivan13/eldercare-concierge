import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type BookingKey = { bookingId: string; userId: string };
type CalendarBooking = {
  id: string;
  agency_name: string;
  invitee_email: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  timezone: string;
};
type DeliveryStatus = "accepted" | "pending" | "unconfigured" | "review";
const mailbox = /^[^\s@,;:<>"\\]+@[^\s@,;:<>"\\]+\.[^\s@,;:<>"\\]+$/;

const stamp = (date: string) =>
  new Date(date)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const calendarText = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replace(/[\r\n]+/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
function fold(line: string) {
  let out = "",
    bytes = 0;
  for (const character of line) {
    const n = Buffer.byteLength(character);
    if (bytes + n > 75) {
      out += "\r\n ";
      bytes = 1;
    }
    out += character;
    bytes += n;
  }
  return out;
}
export function consultationCalendar(
  booking: CalendarBooking,
  sender?: string,
) {
  const address = booking.invitee_email;
  if (sender && (!mailbox.test(sender) || !mailbox.test(address)))
    throw new Error("Invalid calendar address.");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Harbor//Consultations//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${sender ? "REQUEST" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${booking.id}@harbor-consultations`,
    `DTSTAMP:${stamp(booking.created_at)}`,
    `DTSTART:${stamp(booking.starts_at)}`,
  ];
  if (
    booking.ends_at &&
    Date.parse(booking.ends_at) > Date.parse(booking.starts_at)
  )
    lines.push(`DTEND:${stamp(booking.ends_at)}`);
  lines.push(
    `SUMMARY:${calendarText("Consultation with " + booking.agency_name)}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
  );
  if (sender)
    lines.push(
      `ORGANIZER:mailto:${sender}`,
      `ATTENDEE;RSVP=FALSE:mailto:${address}`,
    );
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
export async function confirmedCalendarBooking(
  client: SupabaseClient,
  key: BookingKey,
): Promise<
  (CalendarBooking & { invite_delivery: "harbor" | "agency" }) | null
> {
  const { data, error } = await client
    .from("consultation_bookings")
    .select(
      "id,agency_name,invitee_email,starts_at,ends_at,created_at,timezone,invite_delivery",
    )
    .eq("id", key.bookingId)
    .eq("user_id", key.userId)
    .eq("status", "confirmed")
    .or(
      "and(source.eq.phone,call_sid.not.is.null),and(source.eq.highlevel,event_uri.not.is.null,invitee_uri.not.is.null)",
    )
    .gt("starts_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function deliverConsultationInvite(
  client: SupabaseClient,
  key: BookingKey,
): Promise<{ status: DeliveryStatus }> {
  const booking = await confirmedCalendarBooking(client, key);
  if (!booking || booking.invite_delivery !== "harbor")
    throw new Error(
      "A confirmed consultation with Harbor invitation delivery is required.",
    );
  const token = process.env.RESEND_API_KEY,
    sender = process.env.HARBOR_INVITE_FROM;
  if (!token || !sender || !mailbox.test(sender))
    return { status: "unconfigured" };
  // The address is snapshotted at booking time. An address change cannot redirect this invitation.
  const { data, error } = await client.auth.admin.getUserById(key.userId);
  if (error) throw error;
  if (
    !data.user.email_confirmed_at ||
    !data.user.email ||
    data.user.email.toLowerCase() !== booking.invitee_email.toLowerCase()
  )
    return { status: "review" };
  const lease = randomUUID();
  const claim = await client.rpc("claim_consultation_invite", {
    p_booking_id: key.bookingId,
    p_user_id: key.userId,
    p_lease_id: lease,
  });
  if (claim.error) throw claim.error;
  if (["pending", "review", "accepted"].includes(claim.data))
    return { status: claim.data };
  if (claim.data !== "send")
    throw new Error("This calendar delivery could not be claimed.");
  const calendar = consultationCalendar(booking, sender);
  const when = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: booking.timezone,
  }).format(new Date(booking.starts_at));
  const payload = {
    from: sender,
    to: [booking.invitee_email],
    subject: "Your Harbor consultation is scheduled",
    text: `Your consultation with ${booking.agency_name} is scheduled for ${when}. Open the attached invitation to add it to your calendar.`,
    attachments: [
      {
        filename: "harbor-consultation.ics",
        content: Buffer.from(calendar).toString("base64"),
        content_type: "text/calendar; charset=utf-8; method=REQUEST",
      },
    ],
  };
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `consultation-invite/${booking.id}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  } catch {
    return { status: "pending" };
  }
  const result = await response.json().catch(() => null);
  let update;
  if (response.ok && typeof result?.id === "string" && result.id)
    update = { status: "accepted", email_id: result.id };
  else if (
    response.status === 409 &&
    result?.name === "invalid_idempotent_request"
  )
    update = { status: "review" };
  else if ([400, 401, 403, 404, 413, 422, 429].includes(response.status))
    update = { status: "ready" };
  else return { status: "pending" }; // Provider may already have accepted this email.
  const saved = await client
    .from("consultation_invites")
    .update(update)
    .eq("booking_id", booking.id)
    .eq("lease_id", lease)
    .eq("status", "sending")
    .select("status")
    .maybeSingle();
  if (saved.error) throw saved.error;
  return {
    status:
      saved.data?.status === "accepted"
        ? "accepted"
        : saved.data?.status === "review"
          ? "review"
          : "pending",
  };
}
