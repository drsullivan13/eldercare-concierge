-- Server-owned receipts; signed-in families can read their own history.
create table if not exists public.consultation_bookings (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  provider_id text not null,
  agency_name text not null,
  callback_phone text,
  invitee_name text,
  invitee_email text not null,
  source text not null check (source in ('phone','calendly')),
  call_sid text unique,
  status text not null check (status in ('searching','submitting','confirmed','unknown','unavailable','failed','past')),
  window_start timestamptz not null,
  window_end timestamptz not null check (window_end > window_start),
  timezone text not null,
  created_at timestamptz not null default now(),
  starts_at timestamptz,
  ends_at timestamptz,
  event_uri text,
  invitee_uri text,
  check (status not in ('confirmed','past') or (starts_at is not null and ((source = 'calendly' and event_uri is not null and invitee_uri is not null) or (source='phone' and call_sid is not null))))
);
create unique index if not exists consultation_booking_open
  on public.consultation_bookings(user_id,provider_id)
  where status in ('searching','submitting','unknown','confirmed');
alter table public.consultation_bookings enable row level security;
revoke all on public.consultation_bookings from public, anon, authenticated;
grant select on public.consultation_bookings to authenticated;
grant select,insert,update on public.consultation_bookings to service_role;
drop policy if exists "Read my consultations" on public.consultation_bookings;
create policy "Read my consultations" on public.consultation_bookings
  for select to authenticated using ((select auth.uid()) = user_id);
