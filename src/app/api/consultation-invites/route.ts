import { bookingAdmin } from "@/lib/supabase/booking-admin";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import {
  confirmedCalendarBooking,
  consultationCalendar,
  deliverConsultationInvite,
} from "@/lib/consultation-invite";

export const dynamic = "force-dynamic";
async function serve(request: Request, write: boolean) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  });
  const send = (body: unknown, status: number) =>
    Response.json(body, { status, headers });
  try {
    if (write && !isSameOriginRequest(request))
      return send({ error: "Cross-site request refused." }, 403);
    const client = await createClient(headers);
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user)
      return send({ error: "Sign in to view the invitation." }, 401);
    const bookingId = write
      ? (await request.json().catch(() => null))?.bookingId
      : new URL(request.url).searchParams.get("bookingId");
    if (
      typeof bookingId !== "string" ||
      !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(bookingId)
    )
      return send({ error: "Invalid booking ID." }, 400);
    const key = { userId: user.id, bookingId };
    const booking = await confirmedCalendarBooking(client, key);
    if (!booking)
      return send({ error: "No upcoming confirmed consultation found." }, 404);
    if (!write) {
      headers.set(
        "Content-Type",
        "text/calendar; charset=utf-8; method=PUBLISH",
      );
      headers.set(
        "Content-Disposition",
        'attachment; filename="harbor-consultation.ics"',
      );
      return new Response(consultationCalendar(booking), { headers });
    }
    if (booking.invite_delivery !== "harbor")
      return send(
        {
          error: "The agency manages calendar delivery for this consultation.",
        },
        409,
      );
    return send(await deliverConsultationInvite(bookingAdmin(), key), 200);
  } catch {
    return send(
      {
        error:
          "Could not retrieve the invitation. Your appointment is still recorded.",
      },
      503,
    );
  }
}
export const POST = (request: Request) => serve(request, true);
export const GET = (request: Request) => serve(request, false);
