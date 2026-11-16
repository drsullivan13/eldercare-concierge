-- Apply after bookings, invites, and both HighLevel upgrades. The worker can only read
-- scheduler receipts and deliver an already-confirmed invite. It never starts an appointment.
begin;
create schema if not exists harbor_consultations;
revoke all on schema harbor_consultations from public,anon,authenticated;
grant usage on schema harbor_consultations to service_role;
alter table public.consultation_bookings add column if not exists next_recovery_at timestamptz not null default now();
alter table public.consultation_bookings drop constraint if exists consultation_bookings_status_check;
alter table public.consultation_bookings add constraint consultation_bookings_status_check check
  (status in ('searching','submitting','confirmed','unknown','unavailable','failed','past','expired'));
create table if not exists harbor_consultations.recovery_tickets (
  id uuid primary key default gen_random_uuid(), expires_at timestamptz not null default now()+interval '2 minutes'
);
revoke all on harbor_consultations.recovery_tickets from public,anon,authenticated;
grant select,delete on harbor_consultations.recovery_tickets to service_role;

create or replace view harbor_consultations.due_bookings with (security_invoker = true) as
select b.id from public.consultation_bookings b left join public.consultation_invites i on i.booking_id=b.id
where b.next_recovery_at<=now() and (
  (b.status in ('searching','submitting','unknown') and b.window_end<=now())
  or (b.status='searching' and b.created_at<now()-interval '5 minutes')
  or (b.source in ('calendly','highlevel') and b.status in ('submitting','unknown')
      and b.starts_at is not null and b.created_at<now()-interval '30 seconds')
  or (b.status='confirmed' and b.starts_at>now() and (b.source='phone' or (b.source='highlevel' and b.invite_delivery='harbor'))
      and (i.status is null or i.status in ('ready','sending')))
);
revoke all on harbor_consultations.due_bookings from public,anon,authenticated;
grant select on harbor_consultations.due_bookings to service_role;

create or replace function public.claim_consultation_recovery(p_ticket uuid)
returns setof public.consultation_bookings language plpgsql security invoker set search_path='' as $$
begin
  delete from harbor_consultations.recovery_tickets where id=p_ticket and expires_at>now();
  if not found then raise exception 'Invalid recovery ticket' using errcode='28000'; end if;
  return query
  with due as (
    select b.id from public.consultation_bookings b join harbor_consultations.due_bookings d on d.id=b.id
    order by b.next_recovery_at,b.created_at limit 4 for update of b skip locked
  )
  update public.consultation_bookings b
  set next_recovery_at=now()+case when b.window_end<now() then interval '30 seconds' else interval '2 minutes' end
  from due where b.id=due.id returning b.*;
end $$;
revoke all on function public.claim_consultation_recovery(uuid) from public,anon,authenticated;
grant execute on function public.claim_consultation_recovery(uuid) to service_role;
commit;
