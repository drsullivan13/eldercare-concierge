import { bookingAdmin } from "@/lib/supabase/booking-admin";
import { createClient } from "@/lib/supabase/server";
import { deliverConsultationInvite } from "@/lib/consultation-invite";
import {
  consultationConfig,
  publicBookingUrl,
} from "@/lib/consultation-config";
import { parseInstruction } from "@/lib/consultation-request";
import { isSameOriginRequest } from "@/lib/request-origin";
import { getProviderEntry } from "@/lib/markets";
import { CalendlyBookingError } from "@/lib/calendly-booking";

import {
  consultationPhone,
  phoneConsultationConfigured,
  startPhoneConsultation,
} from "@/lib/phone-consultation";

export const dynamic = "force-dynamic";
const columns =
  "id,agency_name,provider_id,status,starts_at,ends_at,timezone,source,created_at,invite_delivery,window_end,office_callback_pending";
function db() {
  return bookingAdmin().from("consultation_bookings");
}
async function serve(request: Request, write: boolean) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  });
  const send = (body: unknown, status = 200) =>
    Response.json(body, { headers, status });
  try {
    if (write && !isSameOriginRequest(request))
      return send({ error: "Cross-site request refused." }, 403);
    const client = await createClient(headers);
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return send({ error: "Sign in to book consultations." }, 401);
    const params = new URL(request.url).searchParams;
    if (!write) {
      const providerId = params.get("providerId");
      let query = client
        .from("consultation_bookings")
        .select(columns)
        .order("created_at", { ascending: false })
        .eq("user_id", user.id);
      if (providerId) query = query.eq("provider_id", providerId);
      const { data, error } = await query.limit(providerId ? 1 : 100);
      if (error) throw error;
      const config = providerId ? consultationConfig(providerId) : undefined;
      const byPhone = Boolean(
        providerId && phoneConsultationConfigured(providerId),
      );
      return send({
        configured: Boolean(config) || byPhone,
        phoneRequired: config?.phoneRequired || (!config && byPhone),
        source: config?.source ?? (byPhone ? "phone" : null),
        publicUrl: providerId ? publicBookingUrl(providerId) : null,
        bookings: data,
      });
    }
    if (!user.email || !user.email_confirmed_at)
      return send(
        {
          error:
            "Verify your account email to receive a consultation invitation.",
        },
        403,
      );
    let body;
    try {
      body = await request.json();
    } catch {
      return send({ error: "Invalid booking request." }, 400);
    }
    const input = parseInstruction(body, Date.now());
    if (!input)
      return send(
        {
          error:
            "Choose a future window of up to seven days and enter valid contact details.",
        },
        400,
      );
    const { providerId, requestId, startTime, endTime, timezone, name, phone } =
      input;
    // Verify the explicit account request before any scheduler read or write.
    if (input.outreachRequestId) {
      if (user.is_anonymous)
        return send({ error: "Sign in to link an outreach request." }, 401);
      const linked = await client
        .from("outreach_requests")
        .select("request_id")
        .eq("owner_id", user.id)
        .eq("request_id", input.outreachRequestId)
        .eq("provider_id", providerId)
        .maybeSingle();
      if (linked.error) throw linked.error;
      if (!linked.data)
        return send(
          { error: "Outreach request not found for this office." },
          404,
        );
    }
    const config = consultationConfig(providerId);
    const byPhone = !config && phoneConsultationConfigured(providerId);
    if (!config && !byPhone)
      return send(
        { error: "This agency has not connected its scheduler." },
        409,
      );
    const entry = getProviderEntry(providerId);
    const agency = entry?.provider;
    if (entry?.market.id !== "north-jersey" || agency?.category !== "home-care")
      return send({ error: "Unknown home care agency." }, 404);
    const slots = async () =>
      (await config!.slots({ startTime, endTime }))
        .filter(
          (s) =>
            Date.parse(s) >= Date.parse(startTime) &&
            Date.parse(s) < Date.parse(endTime) &&
            Date.parse(s) > Date.now(),
        )
        .sort((a, b) => Date.parse(a) - Date.parse(b));
    if (params.get("preview") === "1")
      return byPhone
        ? send({
            message:
              "The agency shares openings by phone. Harbor can call to arrange a time within your window.",
          })
        : send({ slots: await slots() });
    if ((byPhone || config?.phoneRequired) && !phone)
      return send({ error: "Enter the number the agency should call." }, 400);
    if (byPhone && !consultationPhone(phone))
      return send({ error: "Enter a US callback number." }, 400);
    const now = new Date().toISOString();
    const expired = await db()
      .update({ status: "expired" })
      .eq("user_id", user.id)
      .eq("provider_id", providerId)
      .in("status", ["searching", "submitting", "unknown"])
      .lte("window_end", now);
    if (expired.error) throw expired.error;
    // Claims abandoned before the external write can be safely retired. A submitting claim must be reconciled.
    for (const [from, timeCol, cutoff, to] of [
      [
        "searching",
        "created_at",
        new Date(Date.now() - 5 * 60000).toISOString(),
        "failed",
      ],
      ["confirmed", "starts_at", now, "past"],
    ] as const) {
      const { error } = await db()
        .update({ status: to })
        .eq("user_id", user.id)
        .eq("provider_id", providerId)
        .eq("status", from)
        .lt(timeCol, cutoff);
      if (error) throw error;
    }
    const claim = await db().insert({
      id: requestId,
      ...(input.outreachRequestId
        ? { outreach_request_id: input.outreachRequestId }
        : {}),
      user_id: user.id,
      provider_id: providerId,
      agency_name: agency.name,
      callback_phone: byPhone ? phone : null,
      invitee_name: byPhone ? name : null,
      source: config?.source ?? "phone",
      invite_delivery: config?.inviteDelivery ?? "harbor",
      invitee_email: user.email,
      status: "searching",
      window_start: startTime,
      window_end: endTime,
      timezone,
    });
    if (claim.error) {
      if (claim.error.code !== "23505") throw claim.error;
      let read = await db()
        .select(`${columns},outreach_request_id`)
        .eq("user_id", user.id)
        .eq("provider_id", providerId)
        .eq("id", requestId)
        .maybeSingle();
      if (read.error) throw read.error;
      if (
        read.data &&
        (read.data.outreach_request_id ?? null) !==
          (input.outreachRequestId ?? null)
      )
        return send(
          {
            error:
              "This booking ID belongs to a different request. Refresh your booking history.",
          },
          409,
        );
      // Linked submissions must never borrow another open or legacy booking.
      if (!read.data && input.outreachRequestId)
        return send(
          {
            error:
              "An existing booking needs review before this request can be booked.",
          },
          409,
        );
      if (!read.data)
        read = await db()
          .select(`${columns},outreach_request_id`)
          .eq("user_id", user.id)
          .eq("provider_id", providerId)
          .in("status", ["searching", "submitting", "confirmed", "unknown"])
          .maybeSingle();
      if (read.error || !read.data)
        return send(
          { error: "Refresh your booking history before trying again." },
          409,
        );
      const booking = { ...read.data };
      delete booking.outreach_request_id;
      return send({ booking });
    }
    async function change(
      from: string,
      to: string,
      patch: Record<string, unknown> = {},
    ) {
      const { data, error } = await db()
        .update({ ...patch, status: to })
        .eq("user_id", user!.id)
        .eq("id", requestId)
        .eq("status", from)
        .select(columns)
        .single();
      if (error) throw error;
      return data;
    }
    if (byPhone) {
      await change("searching", "submitting");
      let call;
      try {
        call = await startPhoneConsultation({
          providerId,
          requestId,
          timezone,
          startTime,
          endTime,
          phone: phone!,
          name,
          email: user.email,
        });
      } catch {
        return send({ booking: await change("submitting", "unknown") });
      }
      const { error } = await db()
        .update({ call_sid: call.callSid })
        .eq("id", requestId)
        .eq("user_id", user.id)
        .is("call_sid", null);
      if (error) throw error;
      const saved = await db()
        .select(columns)
        .eq("id", requestId)
        .eq("user_id", user.id)
        .single();
      if (saved.error) throw saved.error;
      return send({ booking: saved.data });
    }
    let options;
    try {
      options = await slots();
    } catch {
      return send({ booking: await change("searching", "failed") });
    }
    for (const slot of options) {
      await change("searching", "submitting", { starts_at: slot });
      let receipt;
      try {
        receipt = await config!.book({
          endTime,
          startTime: slot,
          name,
          email: user.email,
          phone,
          timezone,
          requestId,
        });
      } catch (error) {
        if (
          error instanceof CalendlyBookingError &&
          error.kind === "unavailable"
        ) {
          await change("submitting", "searching", { starts_at: null });
          continue;
        }
        const status =
          error instanceof CalendlyBookingError &&
          ["invalid", "rejected"].includes(error.kind)
            ? "failed"
            : "unknown";
        return send({ booking: await change("submitting", status) });
      }
      const booking = await change("submitting", "confirmed", {
        event_uri: receipt.eventUri,
        invitee_uri: receipt.inviteeUri,
        starts_at: receipt.startTime,
        ends_at: receipt.endTime ?? null,
      });
      if (
        booking.source === "highlevel" &&
        booking.invite_delivery === "harbor"
      )
        await deliverConsultationInvite(bookingAdmin(), {
          userId: user.id,
          bookingId: requestId,
        }).catch(() => {});
      return send({ booking });
    }
    return send({
      booking: await change("searching", "unavailable"),
    });
  } catch {
    return send(
      {
        error:
          "Booking service unavailable. Check your booking history before trying again.",
      },
      503,
    );
  }
}
export const GET = (request: Request) => serve(request, false);
export const POST = (request: Request) => serve(request, true);
