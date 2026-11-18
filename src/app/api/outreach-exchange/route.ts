import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getProviderEntry } from "@/lib/markets";
import { bookingAdmin } from "@/lib/supabase/booking-admin";
import {
  handoffResponse,
  isRecord,
  readHandoffField,
  requestUuid,
  sha256,
} from "../outreach-handoff-response";

export async function POST(request: Request) {
  const secret = process.env.HARBOR_OUTREACH_SERVICE_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  if (
    !secret ||
    secret.length < 32 ||
    !timingSafeEqual(sha256(authorization), sha256(`Bearer ${secret}`))
  )
    return handoffResponse({ error: "Unauthorized." }, 401);

  const invalid = () =>
    handoffResponse({ error: "Outreach handoff is unavailable." }, 404);
  const unavailable = () =>
    handoffResponse(
      { error: "Outreach exchange is temporarily unavailable." },
      503,
    );

  try {
    const token = await readHandoffField(
      request,
      "token",
      /^[0-9a-f]{64}$/,
      invalid,
    );
    if (typeof token !== "string") return token;

    const runId = randomUUID();
    const runKey = randomBytes(32).toString("hex");
    const { data, error } = await bookingAdmin().rpc(
      "exchange_outreach_handoff",
      {
        p_token_digest: sha256(token).toString("hex"),
        p_run_id: runId,
        p_run_key_digest: sha256(runKey).toString("hex"),
      },
    );
    if (error) return unavailable();
    if (data === null) return invalid();
    if (
      !isRecord(data) ||
      data.runId !== runId ||
      typeof data.requestId !== "string" ||
      !requestUuid.test(data.requestId) ||
      typeof data.providerId !== "string" ||
      !isRecord(data.brief)
    )
      return unavailable();

    const { requestId, providerId, brief } = data;
    const entry = getProviderEntry(providerId);
    if (entry?.market.state !== "NJ" || entry.provider.category !== "home-care")
      return invalid();
    return handoffResponse({
      runId,
      runKey,
      requestId,
      providerId,
      providerName: entry.provider.name,
      phone: entry.provider.phone || null,
      brief,
    });
  } catch {
    return unavailable();
  }
}
