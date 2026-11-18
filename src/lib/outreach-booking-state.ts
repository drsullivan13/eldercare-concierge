// Only the existing booking ledger determines confirmation. No draft, rehearsal,
// start time offered by a scheduler, or submitted phone call is confirmation.
export function outreachBookingState(row: Record<string, unknown>) {
  const statuses = [
    "searching",
    "submitting",
    "unknown",
    "confirmed",
    "past",
    "expired",
    "unavailable",
    "failed",
  ];
  const sources = ["phone", "calendly", "highlevel"];
  if (
    !statuses.includes(String(row.status)) ||
    !sources.includes(String(row.source))
  )
    throw new Error("Invalid booking state");
  const confirmed = row.status === "confirmed" || row.status === "past";
  const pending = ["searching", "submitting", "unknown"].includes(
    String(row.status),
  );
  return {
    bookingId: row.id,
    providerId: row.provider_id,
    status: row.status,
    source: row.source,
    startsAt: confirmed ? row.starts_at : null,
    endsAt: confirmed ? row.ends_at : null,
    timezone: row.timezone,
    createdAt: row.created_at,
    nextAction: confirmed
      ? "review_confirmation"
      : pending
        ? "wait_for_receipt"
        : row.status === "unavailable"
          ? "choose_another_window"
          : "contact_office",
  };
}
