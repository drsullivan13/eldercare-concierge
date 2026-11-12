import { NextRequest } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { safeRelativeRedirect } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  const code = request.nextUrl.searchParams.get("code");
  if (code && isSupabaseConfigured()) {
    try {
      const client = await createClient(headers);
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        headers.set(
          "Location",
          safeRelativeRedirect(request.nextUrl.searchParams.get("next")),
        );
        return new Response(null, { status: 303, headers });
      }
    } catch {
      /* Return a generic error; never echo authorization codes or provider error text. */
    }
  }
  headers.set("Location", "/login?error=auth_callback");
  return new Response(null, { status: 303, headers });
}
