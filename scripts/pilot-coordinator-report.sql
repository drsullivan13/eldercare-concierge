-- Run through psql, not as a migration. No objects, grants, or state changes.
\set ON_ERROR_STOP on
\if :{?as_of}
\else
  \set as_of now
\endif
\if :{?page_size}
\else
  \set page_size 100
\endif
\if :{?page_offset}
\else
  \set page_offset 0
\endif
begin isolation level repeatable read read only;
set local timezone = 'UTC';
with parameters as (
  select :'as_of'::timestamptz as as_of,
    greatest(1, least(1000, :'page_size'::integer)) as page_size,
    greatest(0, :'page_offset'::bigint) as page_offset
), exceptions as (
  select 'callback_overdue_human_reported'::text as exception,
    md5(f.owner_id::text || ':' || f.followup_id::text) as record_key,
    f.followup_id as record_id, r.provider_id, f.due_at as attention_at,
    'Review the human-reported callback with the family; completion is unverified.'::text as next_action,
    f.owner_id as sort_owner
  from public.outreach_followups f
  join public.outreach_requests r on r.owner_id = f.owner_id and r.request_id = f.request_id
  cross join parameters p
  where f.kind = 'promised_callback' and f.source = 'user_reported'
    and f.status = 'open' and f.due_at < p.as_of
  union all
  select 'consultation_unknown', md5(b.id::text), b.id, b.provider_id,
    b.created_at, 'Reconcile booking with the provider before any new booking attempt.', b.user_id
  from public.consultation_bookings b where b.status = 'unknown'
  union all
  select case when i.status = 'review' then 'invitation_needs_review'
      when i.status = 'ready' then 'invitation_retry'
      when i.first_attempt_at <= p.as_of - interval '23 hours' then 'invitation_needs_review'
      else 'invitation_stale_sending' end,
    md5(b.id::text), b.id, b.provider_id,
    case when i.status = 'sending' then i.lease_at else i.first_attempt_at end,
    case when i.status = 'review' or (i.status = 'sending' and i.first_attempt_at <= p.as_of - interval '23 hours')
      then 'Review invitation evidence manually; do not infer delivery or resend automatically.'
      else 'Review invitation state and use the existing guarded retry workflow if appropriate.' end,
    b.user_id
  from public.consultation_invites i
  join public.consultation_bookings b on b.id = i.booking_id
  cross join parameters p
  where i.status in ('review', 'ready') or
    (i.status = 'sending' and (i.lease_at <= p.as_of - interval '30 seconds'
      or i.first_attempt_at <= p.as_of - interval '23 hours'))
), numbered as (
  select exception, record_key, record_id, provider_id, attention_at, next_action,
    row_number() over (order by attention_at, exception, record_id, sort_owner) as row_number,
    count(*) over () as total_rows
  from exceptions
)
select n.row_number, n.total_rows, n.exception, n.record_key, n.record_id,
  n.provider_id, n.attention_at, n.next_action
from numbered n cross join parameters p
order by n.row_number
limit (select page_size from parameters) offset (select page_offset from parameters);
commit;
