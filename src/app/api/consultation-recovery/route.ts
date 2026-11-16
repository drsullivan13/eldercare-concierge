import { bookingAdmin } from "@/lib/supabase/booking-admin";
import { recoverConsultation } from "@/lib/recover-consultation";

export const maxDuration = 60;
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (
    typeof payload?.ticket !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(payload.ticket)
  )
    return new Response(null, { status: 403 });
  try {
    const { data, error } = await bookingAdmin().rpc(
      "claim_consultation_recovery",
      { p_ticket: payload.ticket },
    );
    if (error)
      return new Response(null, { status: error.code === "28000" ? 403 : 503 });
    const results = await Promise.allSettled(
      (data ?? []).map(recoverConsultation),
    );
    return Response.json(
      {
        processed: results.length,
        failed: results.filter((row) => row.status === "rejected").length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return new Response(null, { status: 503 });
  }
}
