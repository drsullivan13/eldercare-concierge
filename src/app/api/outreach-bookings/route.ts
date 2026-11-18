import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { outreachBookingState } from "@/lib/outreach-booking-state";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  });
  const send = (body: unknown, status = 200) =>
    Response.json(body, { headers, status });
  try {
    const params = new URL(request.url).searchParams;
    const requestId = params.get("requestId");
    if (
      !requestId ||
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        requestId,
      ) ||
      params.getAll("requestId").length !== 1 ||
      [...params.keys()].some((key) => key !== "requestId")
    )
      return send({ error: "Invalid outreach request query." }, 400);
    if (!isSupabaseConfigured())
      return send({ error: "Booking history unavailable." }, 503);
    const client = await createClient(headers);
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user || user.is_anonymous)
      return send({ error: "Sign in to access booking history." }, 401);
    const outreach = await client
      .from("outreach_requests")
      .select("provider_id")
      .eq("owner_id", user.id)
      .eq("request_id", requestId.toLowerCase())
      .maybeSingle();
    if (outreach.error) throw outreach.error;
    if (!outreach.data)
      return send({ error: "Outreach request not found." }, 404);
    const bookings = await client
      .from("consultation_bookings")
      .select(
        "id,provider_id,status,source,starts_at,ends_at,timezone,created_at,window_end,office_callback_pending",
      )
      .eq("user_id", user.id)
      .eq("outreach_request_id", requestId.toLowerCase())
      .eq("provider_id", outreach.data.provider_id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10);
    if (bookings.error) throw bookings.error;
    return send({ bookings: bookings.data.map(outreachBookingState) });
  } catch {
    return send(
      { error: "Booking history temporarily unavailable. Please retry." },
      503,
    );
  }
}
