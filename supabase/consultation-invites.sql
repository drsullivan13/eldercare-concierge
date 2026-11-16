-- Apply after consultation-bookings.sql. Only the server can claim or send email.
create table if not exists public.consultation_invites (
  booking_id uuid primary key references public.consultation_bookings(id) on delete cascade,
  status text not null check (status in ('ready','sending','accepted','review')),
  first_attempt_at timestamptz not null default now(),
  lease_at timestamptz not null default now(),
  lease_id uuid not null,
  email_id text
);
alter table public.consultation_invites enable row level security;
revoke all on public.consultation_invites from public,anon,authenticated;
grant select,insert,update on public.consultation_invites to service_role;

create or replace function public.claim_consultation_invite(p_booking_id uuid,p_user_id uuid,p_lease_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare delivery public.consultation_invites;
begin
  if not exists(select 1 from public.consultation_bookings
    where id=p_booking_id and user_id=p_user_id and source='phone'
    and status='confirmed' and call_sid is not null and starts_at>now()) then
    return 'missing';
  end if;
  insert into public.consultation_invites(booking_id,status,lease_id)
    values(p_booking_id,'sending',p_lease_id) on conflict do nothing;
  if found then return 'send'; end if;
  select * into strict delivery from public.consultation_invites
    where booking_id=p_booking_id for update;
  if delivery.status in ('accepted','review') then return delivery.status; end if;
  if delivery.status='sending' then
    -- Resend retains an idempotency key for 24 hours. Keep a margin for clocks and transit.
    if delivery.first_attempt_at <= now()-interval '23 hours' then
      update public.consultation_invites set status='review' where booking_id=p_booking_id;
      return 'review';
    end if;
    if delivery.lease_at > now()-interval '30 seconds' then return 'pending'; end if;
  end if;
  update public.consultation_invites set lease_id=p_lease_id,lease_at=now(),status='sending',
    first_attempt_at=case when status='ready' then now() else first_attempt_at end
    where booking_id=p_booking_id;
  return 'send';
end;
$$;
revoke all on function public.claim_consultation_invite(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_consultation_invite(uuid,uuid,uuid) to service_role;
