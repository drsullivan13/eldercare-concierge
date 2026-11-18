export const FOLLOWUP_COLUMNS =
  "followup_id,request_id,kind,assignee,note,due_at,source,channel,status,created_at,completed_at";
export const FOLLOWUP_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseFollowup(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  const keys = [
    "followupId",
    "requestId",
    "kind",
    "assignee",
    "note",
    "dueAt",
    "source",
    "channel",
  ];
  if (
    Object.keys(b).some((k) => !keys.includes(k)) ||
    typeof b.followupId !== "string" ||
    !FOLLOWUP_UUID.test(b.followupId) ||
    typeof b.requestId !== "string" ||
    !FOLLOWUP_UUID.test(b.requestId) ||
    typeof b.kind !== "string" ||
    !["promised_callback", "next_action"].includes(b.kind) ||
    typeof b.assignee !== "string" ||
    !["office", "family", "coordinator"].includes(b.assignee) ||
    typeof b.note !== "string" ||
    !b.note.trim() ||
    [...b.note].length > 500 ||
    b.source !== "user_reported" ||
    typeof b.channel !== "string" ||
    !["phone", "email", "other"].includes(b.channel)
  )
    return null;
  // Require an explicit offset, never interpret a family wall-clock in server TZ.
  if (
    b.dueAt !== undefined &&
    (typeof b.dueAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        b.dueAt,
      ) ||
      !Number.isFinite(Date.parse(b.dueAt)))
  )
    return null;
  return {
    followupId: b.followupId.toLowerCase(),
    requestId: b.requestId.toLowerCase(),
    kind: b.kind,
    assignee: b.assignee,
    note: b.note,
    dueAt: b.dueAt ? new Date(b.dueAt as string).toISOString() : null,
    channel: b.channel,
  };
}
export function serializeFollowup(r: Record<string, unknown>) {
  return {
    followupId: r.followup_id,
    requestId: r.request_id,
    kind: r.kind,
    assignee: r.assignee,
    note: r.note,
    dueAt: r.due_at,
    source: r.source,
    channel: r.channel,
    status: r.status,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}
