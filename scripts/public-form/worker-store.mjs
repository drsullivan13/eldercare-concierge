import { randomUUID } from "node:crypto";
import postgres from "postgres";

const pilot = "north-jersey-hp-hp0265900";

export function openStore(connectionString) {
  if (!connectionString)
    throw new Error("Worker database connection required.");
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    ssl: "verify-full",
    onnotice() {},
  });
  return {
    close: () => sql.end({ timeout: 5 }),
    async claim() {
      return sql.begin(async (tx) => {
        // A crash after submission starts leaves an uncertain outcome. Never replay it.
        await tx`update public.public_form_bookings set
          status = case when status = 'submitting' then 'unknown' else 'failed' end,
          worker_lease = null, updated_at = now()
          where provider_id = ${pilot} and
            ((status in ('booking','submitting') and updated_at < now() - interval '15 minutes')
            or (status = 'queued_booking' and window_end <= now()))`;
        const [job] = await tx`update public.public_form_bookings as j set
          status='booking', worker_lease=${randomUUID()}, updated_at=now()
          where j.id = (select id from public.public_form_bookings
            where provider_id=${pilot} and status='queued_booking' and window_end>now()
            order by created_at, id limit 1 for update skip locked)
          returning id, worker_lease as lease, window_start as "windowStart",
            window_end as "windowEnd", invitee_name as name, invitee_phone as phone,
            invitee_email as email, consent_version as "consentVersion"`;
        return job;
      });
    },
    async markSubmitting(job, instant) {
      const rows = await sql`update public.public_form_bookings set
        status='submitting', start_time=${instant}, updated_at=now()
        where id=${job.id} and worker_lease=${job.lease} and status='booking'
          and ${instant}::timestamptz >= window_start and ${instant}::timestamptz > now()
          and ${instant}::timestamptz + interval '30 minutes' <= window_end returning id`;
      return rows.length === 1;
    },
    async finish(job, status, receipt, clicked) {
      // Only allow a confirmation or a pending response after the durable submit claim.
      const allowed = clicked
        ? ["confirmed", "pending", "unknown"]
        : ["failed", "needs_human", "unavailable"];
      if (!allowed.includes(status))
        throw new Error("Invalid terminal transition.");
      const rows =
        await sql`update public.public_form_bookings set status=${status},
        receipt=${receipt || null}, worker_lease=null, updated_at=now()
        where id=${job.id} and worker_lease=${job.lease}
          and status=${clicked ? "submitting" : "booking"} returning id`;
      return rows.length === 1;
    },
  };
}
