-- Apply after outreach-requests.sql and consultation-bookings.sql.
-- Attribution only: scheduler/Twilio receipts remain the booking authority.
begin;
create unique index if not exists outreach_requests_owner_request_provider_idx
  on public.outreach_requests(owner_id, request_id, provider_id);
alter table public.consultation_bookings
  add column if not exists outreach_request_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'consultation_outreach_owner_office_fk'
      and conrelid = 'public.consultation_bookings'::regclass) then
    alter table public.consultation_bookings add constraint consultation_outreach_owner_office_fk
      foreign key (user_id, outreach_request_id, provider_id)
      references public.outreach_requests(owner_id, request_id, provider_id);
  end if;
end $$;
create index if not exists consultation_outreach_timeline_idx
  on public.consultation_bookings(user_id, outreach_request_id, created_at desc, id desc)
  where outreach_request_id is not null;

-- Links can only be asserted on the initial booking claim, never inferred later.
create or replace function harbor_outreach.protect_consultation_link()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.outreach_request_id is distinct from old.outreach_request_id
    or ((old.outreach_request_id is not null or new.outreach_request_id is not null)
      and (new.user_id is distinct from old.user_id or new.provider_id is distinct from old.provider_id)) then
    raise exception using errcode = '23514', message = 'Consultation outreach attribution is immutable';
  end if;
  return new;
end;
$$;
revoke all on function harbor_outreach.protect_consultation_link() from public, anon, authenticated, service_role;
drop trigger if exists consultation_protect_outreach_link on public.consultation_bookings;
create trigger consultation_protect_outreach_link before update on public.consultation_bookings
  for each row execute function harbor_outreach.protect_consultation_link();
commit;
