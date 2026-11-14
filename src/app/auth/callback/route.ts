import { NextRequest } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { safeRelativeRedirect } from "@/lib/workspace";
import { ACCOUNTS_ENABLED } from "@/lib/features";

export async function GET(request: NextRequest) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  const next = safeRelativeRedirect(request.nextUrl.searchParams.get("next"));
  if (!ACCOUNTS_ENABLED) {
    headers.set("Location", "/dashboard?demo=1");
    return new Response(null, { status: 303, headers });
  }
  const code = request.nextUrl.searchParams.get("code");
  if (code && isSupabaseConfigured()) {
    try {
      const client = await createClient(headers);
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        headers.set("Location", next);
        return new Response(null, { status: 303, headers });
      }
    } catch {
      /* Return a generic error; never echo authorization codes or provider error text. */
    }
  }
  headers.set(
    "Location",
    next === "/reset-password"
      ? "/forgot-password?error=auth_callback"
      : `/login?error=auth_callback&next=${encodeURIComponent(next)}`,
  );
  return new Response(null, { status: 303, headers });
}
