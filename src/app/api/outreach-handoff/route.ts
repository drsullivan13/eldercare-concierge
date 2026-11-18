import { randomBytes } from "node:crypto";
import { isSameOriginRequest } from "@/lib/request-origin";
import { bookingAdmin } from "@/lib/supabase/booking-admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  handoffResponse,
  isRecord,
  readHandoffField,
  requestUuid,
  sha256,
} from "../outreach-handoff-response";

export async function POST(request: Request) {
  const headers = new Headers();
  const respond = (body: unknown, status = 200) => {
    headers.set("Vary", "Cookie");
    return handoffResponse(body, status, headers);
  };
  const unavailable = () =>
    respond({ error: "Outreach handoff is temporarily unavailable." }, 503);
  if (!isSameOriginRequest(request))
    return respond({ error: "Cross-site requests are not permitted." }, 403);

  try {
    if (!isSupabaseConfigured()) return unavailable();
    const client = await createClient(headers);
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError?.name === "AuthRetryableFetchError") return unavailable();
    if (authError || !user || user.is_anonymous)
      return respond({ error: "Sign in to start an outreach rehearsal." }, 401);
    if (!user.email || !user.email_confirmed_at)
      return respond(
        { error: "Verify your email to start an outreach rehearsal." },
        403,
      );

    const requestId = await readHandoffField(
      request,
      "requestId",
      requestUuid,
      () => respond({ error: "Invalid outreach handoff request." }, 400),
      respond,
    );
    if (typeof requestId !== "string") return requestId;

    const token = randomBytes(32).toString("hex");
    const { data, error } = await bookingAdmin().rpc("issue_outreach_handoff", {
      p_owner_user_id: user.id,
      p_request_id: requestId.toLowerCase(),
      p_token_digest: sha256(token).toString("hex"),
    });
    if (error) return unavailable();
    if (data === null)
      return respond({ error: "Outreach request is unavailable." }, 404);
    if (!isRecord(data) || typeof data.expiresAt !== "string")
      return unavailable();
    return respond({ token, expiresAt: data.expiresAt });
  } catch {
    return unavailable();
  }
}
