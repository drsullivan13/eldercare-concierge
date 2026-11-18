import { randomBytes, randomUUID } from "node:crypto";
import { bookingAdmin } from "@/lib/supabase/booking-admin";
import {
  handoffResponse,
  readHandoffField,
  sha256,
} from "../outreach-handoff-response";
import {
  isOutreachServiceAuthorized,
  outreachCredential,
  outreachHandoffInvalid,
  outreachRunDetails,
  outreachServiceUnauthorized,
} from "../outreach-handoff-service";

export async function POST(request: Request) {
  if (!isOutreachServiceAuthorized(request))
    return outreachServiceUnauthorized();

  const unavailable = () =>
    handoffResponse(
      { error: "Outreach exchange is temporarily unavailable." },
      503,
    );

  try {
    const token = await readHandoffField(
      request,
      "token",
      outreachCredential,
      outreachHandoffInvalid,
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
    const details = outreachRunDetails(data, runId, unavailable);
    return details instanceof Response
      ? details
      : handoffResponse({ ...details, runKey });
  } catch {
    return unavailable();
  }
}
