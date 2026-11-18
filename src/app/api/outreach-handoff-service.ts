import { timingSafeEqual } from "node:crypto";
import { getProviderEntry } from "@/lib/markets";
import {
  handoffResponse,
  isRecord,
  requestUuid,
  sha256,
} from "./outreach-handoff-response";

export const outreachCredential = /^[0-9a-f]{64}$/;

export function isOutreachServiceAuthorized(request: Request) {
  const secret = process.env.HARBOR_OUTREACH_SERVICE_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  return (
    !!secret &&
    secret.length >= 32 &&
    timingSafeEqual(sha256(authorization), sha256(`Bearer ${secret}`))
  );
}

export function outreachServiceUnauthorized() {
  return handoffResponse({ error: "Unauthorized." }, 401);
}

export function outreachHandoffInvalid() {
  return handoffResponse({ error: "Outreach handoff is unavailable." }, 404);
}

export function outreachRunDetails(
  data: unknown,
  runId: string,
  unavailable: () => Response,
) {
  if (data === null) return outreachHandoffInvalid();
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
    return outreachHandoffInvalid();
  return {
    runId,
    requestId,
    providerId,
    providerName: entry.provider.name,
    phone: entry.provider.phone || null,
    brief,
  };
}
