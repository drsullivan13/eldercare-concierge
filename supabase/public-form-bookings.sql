begin;
-- The browser worker is granted this role by its operator. It cannot create family approvals.
do $$ begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'harbor_public_form_worker') then
    create role harbor_public_form_worker nologin;
  end if;
end $$;
create schema if not exists harbor_booking_private;
revoke all on schema harbor_booking_private from public, anon;
grant usage on schema harbor_booking_private to authenticated;

create table if not exists public.public_form_bookings (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  check (window_end - window_start between interval '30 minutes' and interval '7 days'),
  status text not null default 'queued_booking' check (status in (
    'queued_booking','booking','submitting',
    'confirmed','pending','unknown','unavailable','needs_human','failed'
  )),
  start_time timestamptz check (start_time >= window_start and start_time + interval '30 minutes' <= window_end),
  approved_at timestamptz not null default now(),
  consent_version text not null,
  invitee_name text not null,
  invitee_phone text not null,
  invitee_email text not null,
  receipt text check (length(receipt) between 1 and 500),
  worker_lease uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('submitting','confirmed','pending','unknown') or start_time is not null),
  check (status <> 'confirmed' or receipt is not null)
);
alter table public.public_form_bookings
  drop constraint if exists public_form_bookings_provider_id_check,
  drop constraint if exists public_form_bookings_consent_version_check,
  drop constraint if exists public_form_bookings_office_consent;
alter table public.public_form_bookings add constraint public_form_bookings_office_consent check (
  (provider_id, consent_version) in (('north-jersey-hp-hp0265900','elderly-savior-v1'),
                                    ('north-jersey-hp-hp0054400','wellcare-v1'))
);
create index if not exists public_form_booking_history on public.public_form_bookings(owner_id, provider_id, created_at desc);
create index if not exists public_form_booking_queue on public.public_form_bookings(created_at)
  where status = 'queued_booking';
alter table public.public_form_bookings enable row level security;
revoke all on public.public_form_bookings from public, anon, authenticated, harbor_public_form_worker;
grant select (id, owner_id, provider_id, window_start, window_end, created_at, status, start_time, receipt)
  on public.public_form_bookings to authenticated;
drop policy if exists "Read own public-form bookings" on public.public_form_bookings;
create policy "Read own public-form bookings" on public.public_form_bookings for select to authenticated
  using (owner_id = (select auth.uid()));
grant usage on schema public to harbor_public_form_worker;
grant select on public.public_form_bookings to harbor_public_form_worker;
grant update (status, start_time, receipt, worker_lease, updated_at) on public.public_form_bookings to harbor_public_form_worker;
drop policy if exists "Worker reads jobs" on public.public_form_bookings;
create policy "Worker reads jobs" on public.public_form_bookings for select to harbor_public_form_worker using (true);
drop policy if exists "Worker records progress" on public.public_form_bookings;
create policy "Worker records progress" on public.public_form_bookings for update to harbor_public_form_worker using (true) with check (true);

-- Only this function may create a job. Read the current verified address from Auth even for direct PostgREST calls.
create or replace function harbor_booking_private.book_window(
  p_request_id uuid, p_provider_id text, p_window_start timestamptz, p_window_end timestamptz,
  p_name text, p_phone text, p_consent_version text, p_expected_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  family uuid := auth.uid();
  verified_email text;
  job public.public_form_bookings;
  checked_at timestamptz;
begin
  select email into verified_email from auth.users
   where id = family and email_confirmed_at is not null and coalesce(is_anonymous, false) = false;
  if coalesce(verified_email, '') = '' then raise exception using errcode='42501', message='Verified account required'; end if;
  if verified_email is distinct from p_expected_email then raise exception using errcode='55000', message='Account email changed'; end if;
  p_name := btrim(p_name);
  if p_request_id is null or ((p_provider_id,p_consent_version) in (('north-jersey-hp-hp0265900','elderly-savior-v1'),
        ('north-jersey-hp-hp0054400','wellcare-v1'))) is not true
    or p_window_start is null or p_window_end is null or not isfinite(p_window_start) or not isfinite(p_window_end)
    or p_name is null
    or length(p_name) not between 3 and 100 or p_name !~ '[^[:space:]]+[[:space:]]+[^[:space:]]+'
    or p_name ~ '[[:cntrl:]]' or p_phone is null or p_phone !~ '^[+]1[2-9][0-9]{9}$'
    or p_window_end - p_window_start not between interval '30 minutes' and interval '7 days' then
    raise exception using errcode='22023', message='Invalid booking approval';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public_form:' || family::text, 0));
  select * into job from public.public_form_bookings where owner_id = family and id = p_request_id;
  checked_at := clock_timestamp();
  if job.id is not null then
    if job.provider_id <> p_provider_id or job.consent_version <> p_consent_version
        or job.window_start <> p_window_start or job.window_end <> p_window_end or job.invitee_name <> p_name
        or job.invitee_phone <> p_phone or job.invitee_email <> verified_email then
      raise exception using errcode='23505', message='Request ID already used';
    end if;
  else
    if p_window_start < checked_at or p_window_end > checked_at + interval '31 days' then
      raise exception using errcode='22023', message='Choose a future window within 31 days';
    end if;
    if exists (select from public.public_form_bookings where owner_id = family and provider_id = p_provider_id
      and (status in ('queued_booking','booking','submitting','pending','unknown')
        or (status = 'confirmed' and start_time + interval '30 minutes' > checked_at))) then
      raise exception using errcode='55000', message='A previous booking needs attention';
    end if;
    if (select count(*) from public.public_form_bookings where owner_id = family
        and created_at >= checked_at - interval '1 hour') >= 6 then
      raise exception using errcode='P0429', message='Hourly booking limit reached';
    end if;
    insert into public.public_form_bookings(id, owner_id, provider_id, window_start, window_end,
      invitee_name, invitee_phone, invitee_email, consent_version)
    values (p_request_id, family, p_provider_id, p_window_start, p_window_end, p_name, p_phone, verified_email, p_consent_version)
    returning * into job;
  end if;
  return jsonb_build_object('id',job.id,'status',job.status,'windowStart',job.window_start,'windowEnd',job.window_end,
    'startTime',job.start_time,'receipt',job.receipt);
end $$;
revoke all on function harbor_booking_private.book_window(uuid,text,timestamptz,timestamptz,text,text,text,text) from public, anon;
grant execute on function harbor_booking_private.book_window(uuid,text,timestamptz,timestamptz,text,text,text,text) to authenticated;
create or replace function public.request_public_form_booking(
  p_request_id uuid, p_provider_id text, p_window_start timestamptz, p_window_end timestamptz,
  p_name text, p_phone text, p_consent_version text, p_expected_email text
) returns jsonb language sql security invoker set search_path = '' as $$
  select harbor_booking_private.book_window(p_request_id,p_provider_id,p_window_start,p_window_end,p_name,p_phone,p_consent_version,p_expected_email)
$$;
revoke all on function public.request_public_form_booking(uuid,text,timestamptz,timestamptz,text,text,text,text) from public, anon;
grant execute on function public.request_public_form_booking(uuid,text,timestamptz,timestamptz,text,text,text,text) to authenticated;

-- Same-office history keeps its defaults; a first request elsewhere recovers contact only.
create or replace function harbor_booking_private.latest_booking_defaults(p_provider_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with latest as (
    select b.invitee_name, b.invitee_phone, b.invitee_email, b.window_start, b.window_end,
           b.status, b.start_time, u.email as current_email
    from public.public_form_bookings b join auth.users u on u.id = b.owner_id
    where b.owner_id = (select auth.uid()) and b.provider_id = p_provider_id
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
    order by b.created_at desc, b.id desc limit 1
  )
  select jsonb_build_object('name', invitee_name, 'phone', invitee_phone,
                            'windowStart', window_start, 'windowEnd', window_end)
  from latest
  where current_email = invitee_email and
    (status in ('failed','unavailable') or
      (status = 'confirmed' and start_time + interval '30 minutes' <= now()))
  union all
  (select jsonb_build_object('name', b.invitee_name, 'phone', b.invitee_phone)
   from public.public_form_bookings b join auth.users u on u.id = b.owner_id
   where p_provider_id in ('north-jersey-hp-hp0265900','north-jersey-hp-hp0054400')
     and b.owner_id = (select auth.uid()) and b.invitee_email = u.email
     and coalesce(u.email, '') <> '' and u.email_confirmed_at is not null
     and not coalesce(u.is_anonymous, false)
     and not exists (
       select from public.public_form_bookings own
       where own.owner_id = b.owner_id and own.provider_id = p_provider_id
     )
   order by b.created_at desc, b.id desc limit 1)
$$;
revoke all on function harbor_booking_private.latest_booking_defaults(text) from public, anon;
grant execute on function harbor_booking_private.latest_booking_defaults(text) to authenticated;
create or replace function public.public_form_booking_defaults(p_provider_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select harbor_booking_private.latest_booking_defaults(p_provider_id)
$$;
revoke all on function public.public_form_booking_defaults(text) from public, anon;
grant execute on function public.public_form_booking_defaults(text) to authenticated;

-- Existing signed-in clients can continue to read their first-office defaults.
create or replace function public.public_form_booking_defaults()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select harbor_booking_private.latest_booking_defaults('north-jersey-hp-hp0265900')
$$;
revoke all on function public.public_form_booking_defaults() from public, anon;
grant execute on function public.public_form_booking_defaults() to authenticated;
drop function if exists harbor_booking_private.latest_booking_defaults();
commit;
