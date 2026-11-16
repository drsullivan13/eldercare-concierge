import { bookingAdmin } from "./supabase/booking-admin";
import { consultationConfig } from "./consultation-config";
import { deliverConsultationInvite } from "./consultation-invite";

type Recoverable = {
  id: string;
  user_id: string;
  provider_id: string;
  source: string;
  status: string;
  invitee_email: string;
  invite_delivery: string;
  starts_at: string | null;
  window_end: string;
};
export async function recoverConsultation(row: Recoverable) {
  const client = bookingAdmin();
  const owner = { userId: row.user_id, bookingId: row.id };
  if (
    ["searching", "unknown", "submitting"].includes(row.status) &&
    Date.parse(row.window_end) <= Date.now()
  ) {
    const { error } = await client
      .from("consultation_bookings")
      .update({ status: "expired" })
      .eq("id", row.id)
      .in("status", ["searching", "unknown", "submitting"])
      .lte("window_end", new Date().toISOString());
    if (error) throw error;
    return;
  }
  if (row.status === "searching") {
    const { error } = await client
      .from("consultation_bookings")
      .update({ status: "failed" })
      .eq("id", row.id)
      .eq("status", "searching")
      .lt("created_at", new Date(Date.now() - 300000).toISOString());
    if (error) throw error;
    return;
  }
  if (row.status === "confirmed") {
    await deliverConsultationInvite(client, owner);
    return;
  }
  const scheduler = consultationConfig(row.provider_id);
  if (
    !scheduler?.reconcile ||
    scheduler.source !== row.source ||
    !row.starts_at
  )
    return;
  const receipt = await scheduler.reconcile({
    startTime: row.starts_at,
    endTime: row.window_end,
    email: row.invitee_email,
    requestId: row.id,
  });
  if (!receipt) return;
  const result = await client
    .from("consultation_bookings")
    .update({
      status: "confirmed",
      starts_at: receipt.startTime,
      ends_at: receipt.endTime ?? null,
      event_uri: receipt.eventUri,
      invitee_uri: receipt.inviteeUri,
    })
    .eq("id", row.id)
    .eq("user_id", row.user_id)
    .in("status", ["unknown", "submitting"])
    .select("id")
    .maybeSingle();
  if (result.error) throw result.error;
  if (
    result.data &&
    row.source === "highlevel" &&
    row.invite_delivery === "harbor"
  )
    await deliverConsultationInvite(client, owner);
}
