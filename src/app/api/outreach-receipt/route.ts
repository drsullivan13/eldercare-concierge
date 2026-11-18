import { bookingAdmin } from "@/lib/supabase/booking-admin";
import {
  handoffResponse,
  isRecord,
  readHandoffObject,
  requestUuid,
  sha256,
} from "../outreach-handoff-response";
import {
  isOutreachServiceAuthorized,
  outreachCredential,
  outreachHandoffInvalid,
  outreachServiceUnauthorized,
} from "../outreach-handoff-service";

function validOutcome(value: unknown) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    !Object.hasOwn(value, "status") ||
    !Object.hasOwn(value, "takeaways") ||
    !Object.hasOwn(value, "nextSteps") ||
    (value.status !== "completed" && value.status !== "failed")
  )
    return false;
  return [value.takeaways, value.nextSteps].every(
    (items) =>
      Array.isArray(items) &&
      items.length <= 6 &&
      items.every(
        (item) =>
          typeof item === "string" &&
          item.trim().length > 0 &&
          Array.from(item).length <= 240 &&
          !item.includes("\u0000"),
      ),
  );
}

export async function POST(request: Request) {
  if (!isOutreachServiceAuthorized(request))
    return outreachServiceUnauthorized();

  const invalid = () =>
    handoffResponse({ error: "Invalid rehearsal receipt." }, 400);
  const unavailable = () =>
    handoffResponse(
      { error: "Rehearsal receipt is temporarily unavailable." },
      503,
    );

  try {
    const body = await readHandoffObject(
      request,
      ["runId", "runKey", "outcome"],
      invalid,
      invalid,
      12 * 1024,
    );
    if (body instanceof Response) return body;
    const { runId, runKey, outcome } = body;
    if (
      typeof runId !== "string" ||
      !requestUuid.test(runId) ||
      typeof runKey !== "string" ||
      !outreachCredential.test(runKey) ||
      !validOutcome(outcome)
    )
      return invalid();

    const normalizedRunId = runId.toLowerCase();
    const { data, error } = await bookingAdmin().rpc(
      "record_outreach_rehearsal_receipt",
      {
        p_run_id: normalizedRunId,
        p_run_key_digest: sha256(runKey).toString("hex"),
        p_outcome: outcome,
      },
    );
    if (error) {
      if (error.code === "23505")
        return handoffResponse(
          { error: "Rehearsal receipt already recorded." },
          409,
        );
      if (error.code === "23514" || error.code === "22P05") return invalid();
      return unavailable();
    }
    if (data === null) return outreachHandoffInvalid();
    if (
      !isRecord(data) ||
      data.runId !== normalizedRunId ||
      typeof data.requestId !== "string" ||
      !requestUuid.test(data.requestId) ||
      !validOutcome(data.outcome) ||
      !isRecord(outcome) ||
      !isRecord(data.outcome) ||
      data.outcome.status !== outcome.status ||
      JSON.stringify(data.outcome.takeaways) !==
        JSON.stringify(outcome.takeaways) ||
      JSON.stringify(data.outcome.nextSteps) !==
        JSON.stringify(outcome.nextSteps) ||
      typeof data.createdAt !== "string" ||
      !Number.isFinite(Date.parse(data.createdAt))
    )
      return unavailable();
    return handoffResponse({ recorded: true });
  } catch {
    return unavailable();
  }
}
