type Instruction = {
  requestId: string;
  providerId: string;
  outreachRequestId?: string;
  name: string;
  phone?: string;
  startTime: string;
  endTime: string;
  timezone: string;
};
export function parseInstruction(
  value: unknown,
  now: number,
): Instruction | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  const { requestId, providerId, name, startTime, endTime, timezone } = v;
  const rawPhone =
    typeof v.phone === "string"
      ? v.phone.trim().replace(/[-. ()]/g, "")
      : v.phone;
  const phone =
    typeof rawPhone === "string" && /^1?\d{10}$/.test(rawPhone)
      ? "+1" + rawPhone.slice(-10)
      : rawPhone;
  if (
    typeof requestId !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      requestId,
    ) ||
    (v.outreachRequestId !== undefined &&
      (typeof v.outreachRequestId !== "string" ||
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          v.outreachRequestId,
        ))) ||
    typeof providerId !== "string" ||
    !providerId ||
    providerId.length > 200 ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 120 ||
    (phone !== undefined &&
      (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(phone))) ||
    typeof startTime !== "string" ||
    typeof endTime !== "string" ||
    typeof timezone !== "string" ||
    !timezone ||
    timezone.length > 80
  )
    return;
  const start = Date.parse(startTime),
    end = Date.parse(endTime);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= now ||
    end <= start ||
    end - start > 7 * 86400000
  )
    return;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return;
  }
  return {
    requestId,
    ...(typeof v.outreachRequestId === "string"
      ? { outreachRequestId: v.outreachRequestId.toLowerCase() }
      : {}),
    providerId,
    name: name.trim(),
    phone,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    timezone,
  };
}

export type Consultation = {
  source: "phone" | "calendly" | "highlevel";
  invite_delivery?: "agency" | "harbor";
  id: string;
  agency_name: string;
  provider_id: string;
  status: string;
  office_callback_pending?: boolean;
  window_end?: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
};
export function bookingMessage(row: Consultation): string {
  if (row.office_callback_pending) {
    const elapsed =
      row.status === "expired" ||
      (row.window_end && Date.parse(row.window_end) <= Date.now());
    return elapsed
      ? "The office callback was pending when your availability window ended. No consultation was confirmed. Contact the office or choose a new window."
      : "The office said it would call you back. Callback pending; no consultation time is confirmed.";
  }
  if (row.status === "confirmed" || row.status === "past") {
    const when = new Date(row.starts_at!).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: row.timezone,
    });
    return `${row.agency_name} confirmed your consultation for ${when} (${row.timezone}).`;
  }
  if (row.status === "expired")
    return "Your availability window ended without a confirmed agency receipt.";
  if (row.status === "searching")
    return "Harbor is checking the agency’s openings.";
  if (row.status === "submitting" || row.status === "unknown")
    return "Harbor is waiting for the agency’s booking receipt.";
  if (row.status === "unavailable")
    return "The agency has no remaining openings in this window.";
  return "Harbor couldn’t complete the booking request.";
}
