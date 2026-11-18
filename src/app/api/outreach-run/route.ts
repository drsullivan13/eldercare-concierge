import { bookingAdmin } from "@/lib/supabase/booking-admin";
import {
  handoffResponse,
  readHandoffObject,
  requestUuid,
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
    handoffResponse({ error: "Outreach run is temporarily unavailable." }, 503);

  try {
    const body = await readHandoffObject(
      request,
      ["runId", "runKey"],
      outreachHandoffInvalid,
    );
    if (body instanceof Response) return body;

    const { runId, runKey } = body;
    if (
      typeof runId !== "string" ||
      !requestUuid.test(runId) ||
      typeof runKey !== "string" ||
      !outreachCredential.test(runKey)
    )
      return outreachHandoffInvalid();

    const normalizedRunId = runId.toLowerCase();
    const { data, error } = await bookingAdmin().rpc("authorize_outreach_run", {
      p_run_id: normalizedRunId,
      p_run_key_digest: sha256(runKey).toString("hex"),
    });
    if (error) return unavailable();
    const details = outreachRunDetails(data, normalizedRunId, unavailable);
    return details instanceof Response ? details : handoffResponse(details);
  } catch {
    return unavailable();
  }
}
